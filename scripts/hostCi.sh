#!/usr/bin/env bash
umask 077

platform='reddit'
ref="${1:-}"
live="${MAE_LIVE_DIR:-/home/kitty/server/mae/reddit}"
remote="${MAE_CI_REMOTE:-}"

if ! printf '%s' "$ref" | grep -Eq '^[0-9a-f]{40}$'; then
  echo 'Usage: bash scripts/hostCi.sh <exact-40-character-commit-sha>' >&2
  exit 2
fi

for command in git bun node npm; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing required command: $command" >&2; exit 2; }
done
[ "$(node --version)" = 'v24.18.0' ] || {
  echo "Host CI requires Node v24.18.0; found $(node --version)." >&2
  exit 2
}
[ -d "$live" ] || { echo "Live Reddit directory not found: $live" >&2; exit 2; }

if [ -z "$remote" ]; then
  remote="$(git -C "$live" remote get-url origin 2>/dev/null || true)"
fi
[ -n "$remote" ] || remote='git@github.com:kitty-crow/maebot-reddit.git'

root="$(mktemp -d "/tmp/mae-${platform}-ci.XXXXXXXX")"
repo="$root/repo"
build="$root/build"
tmp="$root/tmp"
home="$root/home"
npm_cache="$root/npm-cache"
ephemeral="ci/${platform}-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$tmp" "$home" "$npm_cache"

cleanup() {
  status=$?
  chmod -R u+w "$root" 2>/dev/null || true
  rm -rf "$root"
  exit "$status"
}
trap cleanup EXIT INT TERM

run_clean() {
  env -i \
    HOME="$home" \
    PATH="$PATH" \
    USER="${USER:-mae-ci}" \
    LANG="${LANG:-C.UTF-8}" \
    CI=1 \
    TMPDIR="$tmp" \
    "$@"
}

must() {
  "$@"
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "Host CI command failed with status $status: $*" >&2
    exit "$status"
  fi
}

printf 'Mae %s host CI\n' "$platform"
printf '  ref: %s\n' "$ref"
printf '  live source: %s\n' "$live"
printf '  disposable root: %s\n' "$root"
printf '  disposable branch: %s\n' "$ephemeral"

must git clone --quiet --no-checkout "$remote" "$repo"
must git -C "$repo" fetch --quiet origin "$ref"
must git -C "$repo" checkout --quiet -b "$ephemeral" FETCH_HEAD
must git -C "$repo" submodule update --init --recursive

cd "$repo" || exit $?
candidate="$(git rev-parse HEAD)"
[ "$candidate" = "$ref" ] || {
  echo "Fetched candidate SHA $candidate does not match requested SHA $ref." >&2
  exit 1
}
printf '  candidate SHA: %s\n' "$candidate"

# Install exactly the Bun dependency graph committed in bun.lock.
must bun ci

# The TypeScript Reddit runtime is self-contained. Legacy Python/common state is
# migration evidence only and is deliberately not a prerequisite for host CI.
# Production protobuf stores are never opened or copied by this script.
must run_clean bun run ci
must mkdir -p "$build"
must run_clean bun build ./src/main.ts --target=bun --outdir "$build"
must test -s "$build/main.js"

# Devvit validation runs with a scrubbed environment so it cannot inherit
# production Reddit, OpenAI, Discord, Telegram, or service credentials.
(
  cd "$repo/devvit" || exit $?
  must env -i \
    HOME="$home" \
    PATH="$PATH" \
    USER="${USER:-mae-ci}" \
    LANG="${LANG:-C.UTF-8}" \
    CI=1 \
    TMPDIR="$tmp" \
    npm_config_cache="$npm_cache" \
    npm install --package-lock=false --no-audit --no-fund
  must env -i \
    HOME="$home" \
    PATH="$PATH" \
    USER="${USER:-mae-ci}" \
    LANG="${LANG:-C.UTF-8}" \
    CI=1 \
    TMPDIR="$tmp" \
    npm_config_cache="$npm_cache" \
    npm run ci
  must rm -rf node_modules dist
)

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
