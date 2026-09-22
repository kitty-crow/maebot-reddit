#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE=""
for arg in "$@"; do
  case "$arg" in
    --base=*) BASE="${arg#--base=}" ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: bash scripts/completeMemberModNotesAudit.sh --base=<full-audit.log>" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$BASE" ]]; then
  echo "Usage: bash scripts/completeMemberModNotesAudit.sh --base=<full-audit.log>" >&2
  exit 1
fi
if [[ ! -f "$BASE" ]]; then
  echo "Base audit log does not exist: $BASE" >&2
  exit 1
fi
BASE="$(realpath "$BASE")"

SESSION="${MEMBER_MOD_NOTES_MISSING_TMUX:-mae-member-notes-missing}"
RUN_ROOT="${MEMBER_MOD_NOTES_RUN_ROOT:-$ROOT/data/member-mod-notes-runs}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$RUN_ROOT/${STAMP}-missing-rerun"
SOURCE_RUN="$(dirname "$BASE")"
SOURCE_REPUTATION="$SOURCE_RUN/reputation.pb"
SNAPSHOT_REPUTATION="$RUN_DIR/reputation.pb"
SNAPSHOT_RATE="$RUN_DIR/redditRate.pb"
NOTES_FILE="$RUN_DIR/memberModNotes.pb"
LOG="$RUN_DIR/member-mod-notes.log"
CANDIDATES="$RUN_DIR/candidates.txt"
FAILED="$RUN_DIR/failed.txt"
RATE_INTERVAL_MS="${MEMBER_MOD_NOTES_RATE_INTERVAL_MS:-3000}"
MAX_USER_ATTEMPTS="${MEMBER_MOD_NOTES_MISSING_ATTEMPTS:-5}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required for detached audit completion." >&2
  exit 1
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
  ACTIVE_MANIFEST="$(
    find "$RUN_ROOT" -type f -path '*-missing-rerun/manifest.txt' -print 2>/dev/null \
      | sort -r \
      | while IFS= read -r manifest; do
          if grep -Fqx "source_audit=$BASE" "$manifest"; then
            printf '%s\n' "$manifest"
            break
          fi
        done
  )"
  if [[ -n "$ACTIVE_MANIFEST" ]]; then
    ACTIVE_RUN="$(dirname "$ACTIVE_MANIFEST")"
    echo "Audit completion worker is already running; reopening its dashboard."
    exec bun run scripts/memberModNotesTui.ts -- "--run=$ACTIVE_RUN"
  fi
  echo "tmux session '$SESSION' already exists but is not associated with this audit." >&2
  exit 1
fi

if [[ ! -f "$SOURCE_REPUTATION" ]]; then
  echo "Original audit reputation snapshot is missing: $SOURCE_REPUTATION" >&2
  exit 1
fi
if ! [[ "$RATE_INTERVAL_MS" =~ ^[0-9]+$ ]] || (( RATE_INTERVAL_MS < 1000 || RATE_INTERVAL_MS > 60000 )); then
  echo "MEMBER_MOD_NOTES_RATE_INTERVAL_MS must be an integer from 1000 to 60000." >&2
  exit 1
fi
if ! [[ "$MAX_USER_ATTEMPTS" =~ ^[0-9]+$ ]] || (( MAX_USER_ATTEMPTS < 1 || MAX_USER_ATTEMPTS > 10 )); then
  echo "MEMBER_MOD_NOTES_MISSING_ATTEMPTS must be an integer from 1 to 10." >&2
  exit 1
fi

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

COMPLETIONS=()
while IFS= read -r manifest; do
  [[ -f "$manifest" ]] || continue
  if grep -Fqx "source_audit=$BASE" "$manifest"; then
    candidate_log="$(dirname "$manifest")/member-mod-notes.log"
    [[ -f "$candidate_log" ]] && COMPLETIONS+=("$candidate_log")
  fi
done < <(find "$RUN_ROOT" -type f -path '*-missing-rerun/manifest.txt' -print 2>/dev/null | sort)

mkdir -p "$RUN_DIR"
MISSING_ARGS=("--base=$BASE")
for completion in "${COMPLETIONS[@]}"; do
  MISSING_ARGS+=("--completion=$completion")
done
bun run scripts/memberModNotesMissing.ts -- "${MISSING_ARGS[@]}" > "$CANDIDATES"

COUNT="$(wc -l < "$CANDIDATES" | tr -d ' ')"
if [[ "$COUNT" -eq 0 ]]; then
  rmdir "$RUN_DIR" 2>/dev/null || true
  echo "The completed-audit result set already covers every attempted member."
  if (( ${#COMPLETIONS[@]} > 0 )); then
    echo "Completion logs already available:"
    printf '  %s\n' "${COMPLETIONS[@]}"
  fi
  exec bash scripts/previewMemberModNotesReconciliation.sh "--base=$BASE"
fi

cp --reflink=auto -- "$SOURCE_REPUTATION" "$SNAPSHOT_REPUTATION"
if [[ -f "$LIVE_RATE" ]]; then
  cp --reflink=auto -- "$LIVE_RATE" "$SNAPSHOT_RATE"
fi
: > "$FAILED"

cat > "$RUN_DIR/manifest.txt" <<EOF
created_utc=$STAMP
git_head=$(git rev-parse HEAD)
source_audit=$BASE
source_reputation=$SOURCE_REPUTATION
snapshot_reputation=$SNAPSHOT_REPUTATION
live_rate=$LIVE_RATE
snapshot_rate=$SNAPSHOT_RATE
member_notes=$NOTES_FILE
candidates=$CANDIDATES
candidate_count=$COUNT
rate_interval_ms=$RATE_INTERVAL_MS
max_user_attempts=$MAX_USER_ATTEMPTS
tmux_session=$SESSION
mode=PREVIEW_ONLY_MISSING_USERS
EOF

WORKER="$RUN_DIR/run.sh"
cat > "$WORKER" <<'WORKER'
#!/usr/bin/env bash
set -euo pipefail

CANDIDATES="$1"
COUNT="$2"
SNAPSHOT_REPUTATION="$3"
SNAPSHOT_RATE="$4"
NOTES_FILE="$5"
RATE_INTERVAL_MS="$6"
MAX_USER_ATTEMPTS="$7"
FAILED="$8"
BASE="$9"

printf '%s\n' '=========================================================================================='
printf 'MAE MEMBER MOD NOTES — MISSING AUDIT COMPLETION\n'
printf 'Missing users: %s\n' "$COUNT"
printf 'Mode: PREVIEW ONLY — completed users are not re-analysed\n'
printf '%s\n\n' '=========================================================================================='

index=0
while IFS= read -r username; do
  [[ -n "$username" ]] || continue
  index=$((index + 1))
  success=0

  for ((attempt = 1; attempt <= MAX_USER_ATTEMPTS; attempt += 1)); do
    printf '\n%s\n' '##########################################################################################'
    printf 'MISSING USER %d/%d: u/%s — attempt %d/%d\n' "$index" "$COUNT" "$username" "$attempt" "$MAX_USER_ATTEMPTS"
    printf '%s\n' '##########################################################################################'

    tmp="$(mktemp)"
    set +e
    env \
      MEMBER_MOD_NOTES_ISOLATED_RUN=1 \
      REDDIT_REPUTATION_STATE_FILE="$SNAPSHOT_REPUTATION" \
      REDDIT_RATE_STATE_FILE="$SNAPSHOT_RATE" \
      REDDIT_MEMBER_MOD_NOTES_FILE="$NOTES_FILE" \
      REDDIT_RATE_MINIMUM_INTERVAL_MS="$RATE_INTERVAL_MS" \
      bun run experiment:member-notes -- --refresh "--user=$username" \
      2>&1 | tee "$tmp"
    command_status=${PIPESTATUS[0]}
    set -e

    if [[ "$command_status" -eq 0 ]] && grep -Eq '^members=1 generated=1 .*failed=0$' "$tmp"; then
      success=1
      rm -f "$tmp"
      break
    fi

    if grep -Eq '(forbidden HTTP 403|not_found HTTP 404)' "$tmp"; then
      printf '\nSNAPSHOT FALLBACK: u/%s — Reddit profile history is inaccessible; using persisted contribution context.\n' "$username"
      rm -f "$tmp"
      fallback_tmp="$(mktemp)"
      set +e
      env \
        MEMBER_MOD_NOTES_ISOLATED_RUN=1 \
        REDDIT_REPUTATION_STATE_FILE="$SNAPSHOT_REPUTATION" \
        REDDIT_MEMBER_MOD_NOTES_FILE="$NOTES_FILE" \
        bun run scripts/buildMemberModNotesFromSnapshot.ts -- "--user=$username" \
        2>&1 | tee "$fallback_tmp"
      fallback_status=${PIPESTATUS[0]}
      set -e
      if [[ "$fallback_status" -eq 0 ]] && grep -Eq '^USER RESULT 1/1: ' "$fallback_tmp"; then
        success=1
      fi
      rm -f "$fallback_tmp"
      break
    fi

    rm -f "$tmp"
    if (( attempt < MAX_USER_ATTEMPTS )); then
      delay=$((attempt * 10))
      printf 'u/%s hit a transient failure; retrying in %ds.\n' "$username" "$delay"
      sleep "$delay"
    fi
  done

  if [[ "$success" -ne 1 ]]; then
    printf '%s\n' "$username" >> "$FAILED"
    printf 'u/%s could not produce a USER RESULT.\n' "$username" >&2
  fi
done < "$CANDIDATES"

printf '\n%s\n' '=========================================================================================='
if [[ -s "$FAILED" ]]; then
  printf 'MISSING AUDIT COMPLETION FINISHED WITH FAILURES\n'
  printf 'Failed users: %s\n' "$(wc -l < "$FAILED" | tr -d ' ')"
  printf 'Failure list: %s\n' "$FAILED"
  printf '%s\n' 'Re-run the launcher later; prior successful completion logs are detected and skipped.'
  printf '%s\n' '=========================================================================================='
  exit 1
fi
printf 'MISSING AUDIT COMPLETION COMPLETE\n'
printf 'Completed users: %s\n' "$COUNT"
printf '%s\n' '=========================================================================================='
printf '\nStarting reconciliation preview for the now-complete audit...\n'
exec bash scripts/previewMemberModNotesReconciliation.sh "--base=$BASE"
WORKER
chmod +x "$WORKER"

ARGS=(
  "$WORKER"
  "$CANDIDATES"
  "$COUNT"
  "$SNAPSHOT_REPUTATION"
  "$SNAPSHOT_RATE"
  "$NOTES_FILE"
  "$RATE_INTERVAL_MS"
  "$MAX_USER_ATTEMPTS"
  "$FAILED"
  "$BASE"
)
printf -v COMMAND '%q ' "${ARGS[@]}"
printf -v LOG_Q '%q' "$LOG"

tmux new-session -d -s "$SESSION" -c "$ROOT" \
  "set -o pipefail; ${COMMAND}2>&1 | tee -a ${LOG_Q}"

echo "Started missing-user audit completion in tmux session '$SESSION'."
echo "Worker survives SSH disconnects; leaving the dashboard does not stop it."
echo ""
echo "Original audit:       $BASE"
echo "Original baseline:    $SOURCE_REPUTATION"
echo "Missing users now:    $COUNT"
echo "Completion state:     $RUN_DIR"
echo ""

exec bun run scripts/memberModNotesTui.ts -- "--run=$RUN_DIR"
