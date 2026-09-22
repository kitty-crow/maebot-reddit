#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SESSION="${MEMBER_MOD_NOTES_APPLY_TMUX:-mae-member-notes-apply}"
RUN_ROOT="${MEMBER_MOD_NOTES_APPLY_RUN_ROOT:-$ROOT/data/member-mod-notes-apply-runs}"
STATE_ROOT="${MEMBER_MOD_NOTES_APPLY_STATE_ROOT:-$ROOT/data/member-mod-notes-apply-state}"
RATE_INTERVAL_MS="${MEMBER_MOD_NOTES_APPLY_RATE_INTERVAL_MS:-3000}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$RUN_ROOT/$STAMP"
LOG="$RUN_DIR/worker.log"
EXIT_FILE="$RUN_DIR/exit-code.txt"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required for the member Mod Notes apply dashboard." >&2
  exit 1
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "tmux session '$SESSION' already exists." >&2
  echo "Attach with: tmux attach -t '$SESSION'" >&2
  exit 1
fi

if ! [[ "$RATE_INTERVAL_MS" =~ ^[0-9]+$ ]] || (( RATE_INTERVAL_MS < 1000 || RATE_INTERVAL_MS > 60000 )); then
  echo "MEMBER_MOD_NOTES_APPLY_RATE_INTERVAL_MS must be an integer from 1000 to 60000." >&2
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

LIVE_NOTES="$(bun -e '
  import "dotenv/config";
  import { resolve } from "node:path";
  process.stdout.write(resolve(process.cwd(), process.env.REDDIT_MEMBER_MOD_NOTES_FILE?.trim() || "data/memberModNotes.pb"));
')"

LIVE_RATE="$(bun -e '
  import "dotenv/config";
  import { createHash } from "node:crypto";
  import { resolve } from "node:path";
  import { redditConfig } from "./src/env.ts";
  const configured = process.env.REDDIT_RATE_STATE_FILE?.trim();
  if (configured) {
    process.stdout.write(resolve(process.cwd(), configured));
  } else {
    const clientId = redditConfig().auth.legacyOauth?.clientId;
    if (!clientId) throw new Error("Legacy Reddit OAuth client id is required for the shared rate-budget key");
    const key = createHash("sha256").update(clientId).digest("hex").slice(0, 16);
    process.stdout.write(resolve(process.cwd(), "data", `redditRate-${key}.pb`));
  }
')"

STATE_DIR="$STATE_ROOT/$AUDIT_ID"
PERSISTED_NOTES="$STATE_DIR/memberModNotes.pb"
WORK_NOTES="$RUN_DIR/memberModNotes.pb"
WORK_RATE="$RUN_DIR/redditRate.pb"

mkdir -p "$RUN_DIR" "$STATE_DIR"

# Never open the live stores from the apply worker. The main Mae process owns
# their mutexes. Copy only protobuf data, never .lock files, exactly like the
# original isolated audit runner.
if [[ -f "$PERSISTED_NOTES" ]]; then
  cp --reflink=auto -- "$PERSISTED_NOTES" "$WORK_NOTES"
elif [[ -f "$LIVE_NOTES" ]]; then
  cp --reflink=auto -- "$LIVE_NOTES" "$WORK_NOTES"
fi
if [[ -f "$LIVE_RATE" ]]; then
  cp --reflink=auto -- "$LIVE_RATE" "$WORK_RATE"
fi

cat > "$RUN_DIR/manifest.txt" <<EOF
created_utc=$STAMP
audit_id=$AUDIT_ID
base=$BASE
total=$TOTAL
live_member_notes=$LIVE_NOTES
persisted_member_notes=$PERSISTED_NOTES
working_member_notes=$WORK_NOTES
live_rate=$LIVE_RATE
working_rate=$WORK_RATE
rate_interval_ms=$RATE_INTERVAL_MS
EOF

WORKER=(
  env
  MEMBER_MOD_NOTES_NATIVE_APPLY=1
  "REDDIT_MEMBER_MOD_NOTES_FILE=$WORK_NOTES"
  "REDDIT_RATE_STATE_FILE=$WORK_RATE"
  "REDDIT_RATE_MINIMUM_INTERVAL_MS=$RATE_INTERVAL_MS"
  bun run apply:member-notes --
  "$@"
)
printf -v WORKER_Q '%q ' "${WORKER[@]}"
printf -v LOG_Q '%q' "$LOG"
printf -v EXIT_Q '%q' "$EXIT_FILE"
printf -v WORK_NOTES_Q '%q' "$WORK_NOTES"
printf -v PERSISTED_NOTES_Q '%q' "$PERSISTED_NOTES"

DASHBOARD=(
  bun run scripts/applyMemberModNotesTui.ts --
  "--log=$LOG"
  "--audit-id=$AUDIT_ID"
  "--total=$TOTAL"
  "$@"
)
printf -v DASHBOARD_Q '%q ' "${DASHBOARD[@]}"

# The worker is the only process that opens the run-local protobuf stores.
# The dashboard reads only the worker log and immutable audit logs, so it can
# never contend on a MutexProtoBuffStore lock.
# Persist the worker's run-local note state after exit so the exact same audit
# can resume without reposting completed targets. The live Mae store is never
# opened or replaced here.
WORKER_WRAPPER="
set -o pipefail
sync_state() {
  if [[ -f ${WORK_NOTES_Q} ]]; then
    cp --reflink=auto -- ${WORK_NOTES_Q} ${PERSISTED_NOTES_Q}
  fi
}
trap 'sync_state' EXIT
${WORKER_Q}2>&1 | tee -a ${LOG_Q}
rc=\${PIPESTATUS[0]}
printf '%s\\n' \"\$rc\" > ${EXIT_Q}
exit \"\$rc\"
"

tmux new-session -d -s "$SESSION" -n worker -c "$ROOT" "$WORKER_WRAPPER"
tmux new-window -d -t "$SESSION" -n dashboard -c "$ROOT" "$DASHBOARD_Q"
tmux select-window -t "$SESSION:dashboard"

echo "Started isolated native Reddit Mod Notes apply in tmux session '$SESSION'."
echo ""
echo "Live member notes:      $LIVE_NOTES"
echo "Working member notes:   $WORK_NOTES"
echo "Persistent resume copy: $PERSISTED_NOTES"
echo "Live rate state:        $LIVE_RATE"
echo "Working rate state:     $WORK_RATE"
echo "Rate interval:          ${RATE_INTERVAL_MS}ms"
echo "Worker log:             $LOG"
echo ""
echo "Only the worker opens the run-local protobuf stores."
echo "The dashboard uses logs only and opens no protobuf store."
echo "No live .lock file is copied."
echo ""
echo "Attach:     tmux attach -t '$SESSION'"
echo "Detach:     Ctrl-b d"
echo "Dashboard:  q or Esc leaves only the dashboard; the worker keeps running."
