#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="${MEMBER_MOD_NOTES_TMUX:-mae-member-notes}"
LOG_DIR="${MEMBER_MOD_NOTES_LOG_DIR:-$ROOT/logs}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/member-mod-notes-$STAMP.log"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required for the detached member Mod Notes experiment." >&2
  exit 1
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "tmux session '$SESSION' already exists." >&2
  echo "Attach with: tmux attach -t '$SESSION'" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"

ARGS=(bun run experiment:member-notes -- "$@")
printf -v COMMAND '%q ' "${ARGS[@]}"
printf -v LOG_Q '%q' "$LOG"

# Keep the actual Bun process owned by tmux rather than the SSH shell. tee gives
# us a persistent transcript while preserving the same live output on attach.
tmux new-session -d -s "$SESSION" -c "$ROOT" \
  "set -o pipefail; ${COMMAND}2>&1 | tee -a ${LOG_Q}"

echo "Started member Mod Notes experiment in detached tmux session '$SESSION'."
echo "Log: $LOG"
echo ""
echo "Attach live:  tmux attach -t '$SESSION'"
echo "Detach again: Ctrl-b d"
echo "Watch log:    tail -f '$LOG'"
