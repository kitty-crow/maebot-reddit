#!/usr/bin/env bash
umask 077

platform='reddit'
default_ref='feat/devvit-migration'
ref="${1:-$default_ref}"
live="${MAE_LIVE_DIR:-/home/kitty/server/mae/reddit}"
remote="${MAE_CI_REMOTE:-}"

for command in git bun curl tar sha256sum; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing required command: $command" >&2; exit 2; }
done
[ -d "$live" ] || { echo "Live Reddit directory not found: $live" >&2; exit 2; }

if [ -z "$remote" ]; then
  remote="$(git -C "$live" remote get-url origin 2>/dev/null || true)"
fi
[ -n "$remote" ] || remote='git@github.com:kitty-crow/maebot-reddit.git'

root="$(mktemp -d "/tmp/mae-${platform}-ci.XXXXXXXX")"
repo="$root/repo"
build="$root/build"
tmp="$root/tmp"
ephemeral="ci/${platform}-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$tmp"

node_version='24.18.0'
case "$(uname -m)" in
  x86_64|amd64) node_arch='x64' ;;
  aarch64|arm64) node_arch='arm64' ;;
  *) echo "Unsupported CI host architecture for Devvit Node runtime: $(uname -m)" >&2; exit 2 ;;
esac
node_name="node-v${node_version}-linux-${node_arch}"
node_archive="$root/${node_name}.tar.xz"
node_sums="$root/SHASUMS256.txt"
node_home="$root/$node_name"

cleanup() {
  status=$?
  chmod -R u+w "$root" 2>/dev/null || true
  rm -rf "$root"
  exit "$status"
}
trap cleanup EXIT INT TERM

curl -fsSLo "$node_archive" "https://nodejs.org/dist/v${node_version}/${node_name}.tar.xz" || exit $?
curl -fsSLo "$node_sums" "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" || exit $?
expected_node_sha="$(awk -v file="${node_name}.tar.xz" '$2 == file { print $1 }' "$node_sums")"
[ -n "$expected_node_sha" ] || { echo 'Could not find Node archive checksum.' >&2; exit 2; }
actual_node_sha="$(sha256sum "$node_archive" | awk '{ print $1 }')"
[ "$actual_node_sha" = "$expected_node_sha" ] || { echo 'Node archive checksum mismatch.' >&2; exit 2; }
tar -xJf "$node_archive" -C "$root" || exit $?
PATH="$node_home/bin:$PATH"
export PATH

run_clean() {
  env -i     HOME="${HOME:-/tmp}"     PATH="$PATH"     USER="${USER:-mae-ci}"     LANG="${LANG:-C.UTF-8}"     CI=1     TMPDIR="$tmp"     NPM_CONFIG_CACHE="$tmp/npm-cache"     NPM_CONFIG_UPDATE_NOTIFIER=false     NPM_CONFIG_AUDIT=false     NPM_CONFIG_FUND=false     NODE_OPTIONS="--throw-deprecation"     "$@"
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

printf 'Mae %s host CI\n' "$platform"
printf '  ref: %s\n' "$ref"
printf '  live source: %s\n' "$live"
printf '  disposable root: %s\n' "$root"
printf '  disposable branch: %s\n' "$ephemeral"

git clone --quiet --no-checkout "$remote" "$repo" || exit $?
git -C "$repo" fetch --quiet origin "$ref" || exit $?
git -C "$repo" checkout --quiet -b "$ephemeral" FETCH_HEAD || exit $?
git -C "$repo" submodule update --init --recursive || exit $?

cd "$repo"
printf '  candidate SHA: %s\n' "$(git rev-parse HEAD)"
printf '  node: %s\n' "$(node --version)"
printf '  npm: %s\n' "$(npm --version)"

run_no_warnings bun-install bun ci || exit $?
run_no_warnings mae-ci bun run ci || exit $?

run_no_warnings devvit-install npm --prefix devvit install --no-package-lock --no-audit --no-fund || exit $?
run_no_warnings devvit-ci npm --prefix devvit run ci || exit $?

mkdir -p "$build"
run_no_warnings bun-build bun build ./src/main.ts --target=bun --outdir "$build" || exit $?
test -s "$build/main.js" || { echo 'Bun production build did not produce main.js.' >&2; exit 1; }

if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  echo 'Disposable CI checkout was modified by validation.' >&2
  git status --short >&2
  exit 1
fi
if git submodule status --recursive | grep -Eq '^[+-]'; then
  echo 'A submodule moved away from its pinned commit during CI.' >&2
  exit 1
fi

printf 'PASS Mae %s host CI for %s\n' "$platform" "$(git rev-parse --short HEAD)"
printf 'All build/test output was confined to %s and will now be deleted.\n' "$root"
