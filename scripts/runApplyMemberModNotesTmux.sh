#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SESSION="${MEMBER_MOD_NOTES_APPLY_TMUX:-mae-member-notes-apply}"
RUN_ROOT="${MEMBER_MOD_NOTES_APPLY_RUN_ROOT:-$ROOT/data/member-mod-notes-apply-runs}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$RUN_ROOT/$STAMP"
LOG="$RUN_DIR/worker.log"
EXIT_FILE="$RUN_DIR/exit-code.txt"
NOTES_FILE="${REDDIT_MEMBER_MOD_NOTES_FILE:-$ROOT/data/memberModNotes.pb}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required for the member Mod Notes apply dashboard." >&2
  exit 1
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "tmux session '$SESSION' already exists." >&2
  echo "Attach with: tmux attach -t '$SESSION'" >&2
  exit 1
fi

BASE=""
AUDIT_ID=""
for arg in "$@"; do
  case "$arg" in
    --base=*) BASE="${arg#--base=}" ;;
    --expect-audit-id=*) AUDIT_ID="${arg#--expect-audit-id=}" ;;
  esac
done

if [[ -z "$BASE" || -z "$AUDIT_ID" ]]; then
  echo "The apply launcher requires --base=... and --expect-audit-id=..." >&2
  exit 1
fi
if [[ ! -f "$BASE" ]]; then
  echo "Base audit log does not exist: $BASE" >&2
  exit 1
fi
if [[ ! "$AUDIT_ID" =~ ^[0-9a-f]{16}$ ]]; then
  echo "--expect-audit-id must be a 16-character lowercase hexadecimal id." >&2
  exit 1
fi

TOTAL="$(awk '/^Members:[[:space:]]*[0-9]+[[:space:]]*$/ { print $2; exit }' "$BASE")"
if [[ ! "$TOTAL" =~ ^[1-9][0-9]*$ ]]; then
  echo "Could not read a valid Members: count from $BASE" >&2
  exit 1
fi

mkdir -p "$RUN_DIR"
printf 'created_utc=%s\naudit_id=%s\nbase=%s\nnotes=%s\ntotal=%s\n' \
  "$STAMP" "$AUDIT_ID" "$BASE" "$NOTES_FILE" "$TOTAL" > "$RUN_DIR/manifest.txt"

WORKER=(
  env
  MEMBER_MOD_NOTES_NATIVE_APPLY=1
  bun run apply:member-notes --
  "$@"
)
printf -v WORKER_Q '%q ' "${WORKER[@]}"
printf -v LOG_Q '%q' "$LOG"
printf -v EXIT_Q '%q' "$EXIT_FILE"

DASHBOARD=(
  bun run scripts/applyMemberModNotesTui.ts --
  "--log=$LOG"
  "--notes=$NOTES_FILE"
  "--audit-id=$AUDIT_ID"
  "--total=$TOTAL"
)
printf -v DASHBOARD_Q '%q ' "${DASHBOARD[@]}"

# The worker is deliberately non-interactive and writes durable progress to a log.
# The dashboard is a separate process, so leaving it never stops the Reddit apply.
tmux new-session -d -s "$SESSION" -n worker -c "$ROOT" \
  "set -o pipefail; ${WORKER_Q}2>&1 | tee -a ${LOG_Q}; rc=\${PIPESTATUS[0]}; printf '%s\\n' \"\$rc\" > ${EXIT_Q}; exit \"\$rc\""

tmux new-window -d -t "$SESSION" -n dashboard -c "$ROOT" "$DASHBOARD_Q"
tmux select-window -t "$SESSION:dashboard"

echo "Started native Reddit Mod Notes apply in tmux session '$SESSION'."
echo "Worker log: $LOG"
echo "State:      $NOTES_FILE"
echo ""
echo "Attach:     tmux attach -t '$SESSION'"
echo "Detach:     Ctrl-b d"
echo "Dashboard:  q or Esc leaves only the dashboard; the worker keeps running."
