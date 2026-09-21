#!/usr/bin/env bash
umask 077

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
expected="${1:-}"
build="$(mktemp -d /tmp/mae-reddit-build.XXXXXXXX)"
tmp="$(mktemp -d /tmp/mae-reddit-ci.XXXXXXXX)"

for command in git bun curl tar sha256sum; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing required command: $command" >&2; exit 2; }
done

cleanup() {
  status=$?
  chmod -R u+w "$build" "$tmp" 2>/dev/null || true
  rm -rf "$build" "$tmp"
  exit "$status"
}
trap cleanup EXIT INT TERM

actual="$(git -C "$repo" rev-parse HEAD)" || exit $?
if [ -n "$expected" ] && [ "$actual" != "$expected" ]; then
  printf 'Expected candidate: %s\nActual candidate:   %s\n' "$expected" "$actual" >&2
  exit 1
fi

node_version='24.18.0'
case "$(uname -m)" in
  x86_64|amd64) node_arch='x64' ;;
  aarch64|arm64) node_arch='arm64' ;;
  *) echo "Unsupported CI host architecture for Devvit Node runtime: $(uname -m)" >&2; exit 2 ;;
esac

node_name="node-v${node_version}-linux-${node_arch}"
node_archive="$tmp/${node_name}.tar.xz"
node_sums="$tmp/SHASUMS256.txt"
node_home="$tmp/$node_name"

curl -fsSLo "$node_archive" "https://nodejs.org/dist/v${node_version}/${node_name}.tar.xz" || exit $?
curl -fsSLo "$node_sums" "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" || exit $?
expected_node_sha="$(awk -v file="${node_name}.tar.xz" '$2 == file { print $1 }' "$node_sums")"
[ -n "$expected_node_sha" ] || { echo 'Could not find Node archive checksum.' >&2; exit 2; }
actual_node_sha="$(sha256sum "$node_archive" | awk '{ print $1 }')"
[ "$actual_node_sha" = "$expected_node_sha" ] || { echo 'Node archive checksum mismatch.' >&2; exit 2; }
tar -xJf "$node_archive" -C "$tmp" || exit $?
PATH="$node_home/bin:$PATH"
export PATH

run_clean() {
  env -i \
    HOME="${HOME:-/tmp}" \
    PATH="$PATH" \
    USER="${USER:-mae-ci}" \
    LANG="${LANG:-C.UTF-8}" \
    CI=1 \
    TMPDIR="$tmp" \
    NPM_CONFIG_CACHE="$tmp/npm-cache" \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NODE_OPTIONS="--throw-deprecation" \
    "$@"
}

run_no_warnings() {
  label="$1"
  shift
  log="$tmp/${label}.log"
  if ! run_clean "$@" > >(tee "$log") 2> >(tee -a "$log" >&2); then
    return 1
  fi
  if grep -Eqi '(^|[[:space:]])(npm[[:space:]]+warn|warning:|deprecationwarning|experimentalwarning|module_typeless_package_json)' "$log"; then
    echo "Warning-free CI gate failed in ${label}." >&2
    grep -Ein '(^|[[:space:]])(npm[[:space:]]+warn|warning:|deprecationwarning|experimentalwarning|module_typeless_package_json)' "$log" >&2 || true
    return 1
  fi
}

printf 'Mae reddit host CI\n'
printf '  checkout: %s\n' "$repo"
printf '  candidate SHA: %s\n' "$actual"
printf '  node: %s\n' "$(node --version)"
printf '  npm: %s\n' "$(npm --version)"

cd "$repo" || exit $?

git submodule update --init --recursive || exit $?
run_no_warnings bun-install bun ci || exit $?
run_no_warnings mae-ci bun run ci || exit $?

rm -rf "$repo/devvit/node_modules"
run_no_warnings devvit-install npm --prefix devvit install --no-package-lock --no-audit --no-fund || exit $?
run_no_warnings devvit-ci npm --prefix devvit run ci || exit $?

run_no_warnings bun-build bun build ./src/main.ts --target=bun --outdir "$build" || exit $?
test -s "$build/main.js" || { echo 'Bun production build did not produce main.js.' >&2; exit 1; }

if ! git -C "$repo" diff --quiet --ignore-submodules=dirty || ! git -C "$repo" diff --cached --quiet --ignore-submodules=dirty; then
  echo 'CI modified tracked files in the actual checkout.' >&2
  git -C "$repo" status --short >&2
  exit 1
fi

if git -C "$repo" submodule status --recursive | grep -Eq '^[+-]'; then
  echo 'A submodule moved away from its pinned commit during CI.' >&2
  exit 1
fi

printf 'PASS Mae reddit host CI for %s\n' "$(git -C "$repo" rev-parse --short HEAD)"
