#!/usr/bin/env bash
set -euo pipefail
umask 077

platform='reddit'
default_ref='feature/reddit-reputation-bootstrap'
ref="${1:-$default_ref}"
live="${MAE_LIVE_DIR:-/home/kitty/server/mae/reddit}"
remote="${MAE_CI_REMOTE:-}"

for command in git bun; do
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

cleanup() {
  status=$?
  chmod -R u+w "$root" 2>/dev/null || true
  rm -rf "$root"
  exit "$status"
}
trap cleanup EXIT INT TERM

run_clean() {
  env -i \
    HOME="${HOME:-/tmp}" \
    PATH="$PATH" \
    USER="${USER:-mae-ci}" \
    LANG="${LANG:-C.UTF-8}" \
    CI=1 \
    TMPDIR="$tmp" \
    "$@"
}

printf 'Mae %s host CI\n' "$platform"
printf '  ref: %s\n' "$ref"
printf '  live source: %s\n' "$live"
printf '  disposable root: %s\n' "$root"
printf '  disposable branch: %s\n' "$ephemeral"

git clone --quiet --no-checkout "$remote" "$repo"
git -C "$repo" fetch --quiet origin "$ref"
git -C "$repo" checkout --quiet -b "$ephemeral" FETCH_HEAD
git -C "$repo" submodule update --init --recursive

cd "$repo"
printf '  candidate SHA: %s\n' "$(git rev-parse HEAD)"
# Install exactly the dependency graph committed in bun.lock.
bun ci

# The TypeScript Reddit runtime is self-contained. Legacy Python/common state is
# migration evidence only and is deliberately not a prerequisite for host CI.
# Production reputation.pb is never opened or copied by this script: validation
# runs only inside the disposable clone with test-owned temporary stores.
run_clean bun run ci
mkdir -p "$build"
run_clean bun build ./src/main.ts --target=bun --outdir "$build"
test -s "$build/main.js"

# CI must not alter source, create tracked candidates, or move submodules.
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
