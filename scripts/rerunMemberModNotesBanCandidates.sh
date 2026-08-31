#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SESSION="${MEMBER_MOD_NOTES_REVIEW_TMUX:-mae-member-notes-ban-rerun}"
RUN_ROOT="${MEMBER_MOD_NOTES_RUN_ROOT:-$ROOT/data/member-mod-notes-runs}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$RUN_ROOT/${STAMP}-ban-rerun"
SNAPSHOT_REPUTATION="$RUN_DIR/reputation.pb"
SNAPSHOT_RATE="$RUN_DIR/redditRate.pb"
NOTES_FILE="$RUN_DIR/memberModNotes.pb"
LOG="$RUN_DIR/member-mod-notes.log"
CANDIDATES="$RUN_DIR/candidates.txt"
RATE_INTERVAL_MS="${MEMBER_MOD_NOTES_RATE_INTERVAL_MS:-3000}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required for the detached ban-candidate rerun." >&2
  exit 1
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "tmux session '$SESSION' already exists." >&2
  echo "Stop or rename that session before starting another rerun." >&2
  exit 1
fi

if ! [[ "$RATE_INTERVAL_MS" =~ ^[0-9]+$ ]] || (( RATE_INTERVAL_MS < 1000 || RATE_INTERVAL_MS > 60000 )); then
  echo "MEMBER_MOD_NOTES_RATE_INTERVAL_MS must be an integer from 1000 to 60000." >&2
  exit 1
fi

SOURCE_REVIEW="$(
  find "$RUN_ROOT" -type f -name 'NEW-BANS-ONLY.log' -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr \
    | head -1 \
    | cut -d' ' -f2-
)"

if [[ -z "$SOURCE_REVIEW" || ! -f "$SOURCE_REVIEW" ]]; then
  echo "No NEW-BANS-ONLY.log found under $RUN_ROOT." >&2
  exit 1
fi

SOURCE_RUN="$(dirname "$SOURCE_REVIEW")"
SOURCE_REPUTATION="$SOURCE_RUN/reputation.pb"
if [[ ! -f "$SOURCE_REPUTATION" ]]; then
  echo "The source experiment snapshot is missing: $SOURCE_REPUTATION" >&2
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
    const key = createHash("sha256").update(redditConfig().auth.clientId).digest("hex").slice(0, 16);
    process.stdout.write(resolve(process.cwd(), "data", `redditRate-${key}.pb`));
  }
')"

mkdir -p "$RUN_DIR"

sed -nE 's/^!!! REVIEW [0-9]+\/[0-9]+ !!!  u\/([^ ]+).*$/\1/p' "$SOURCE_REVIEW" \
  | awk 'NF && !seen[tolower($0)]++' \
  > "$CANDIDATES"

COUNT="$(wc -l < "$CANDIDATES" | tr -d ' ')"
if [[ "$COUNT" -eq 0 ]]; then
  echo "No ban candidates could be parsed from $SOURCE_REVIEW." >&2
  exit 1
fi

# Use the original preview's immutable reputation snapshot so old and new
# classifier results start from the same reputation baseline. Never copy locks.
cp --reflink=auto -- "$SOURCE_REPUTATION" "$SNAPSHOT_REPUTATION"
if [[ -f "$LIVE_RATE" ]]; then
  cp --reflink=auto -- "$LIVE_RATE" "$SNAPSHOT_RATE"
fi

cat > "$RUN_DIR/manifest.txt" <<EOF
created_utc=$STAMP
git_head=$(git rev-parse HEAD)
source_review=$SOURCE_REVIEW
source_reputation=$SOURCE_REPUTATION
snapshot_reputation=$SNAPSHOT_REPUTATION
live_rate=$LIVE_RATE
snapshot_rate=$SNAPSHOT_RATE
member_notes=$NOTES_FILE
candidates=$CANDIDATES
candidate_count=$COUNT
rate_interval_ms=$RATE_INTERVAL_MS
mode=PREVIEW_ONLY
EOF

WORKER="$RUN_DIR/run.sh"
cat > "$WORKER" <<'WORKER'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' '=========================================================================================='
printf 'MAE BAN-CANDIDATE RE-EVALUATION — CORRECTED MODERATION RULES\n'
printf 'Candidates: %s\n' "$CANDIDATE_COUNT"
printf 'Mode: PREVIEW ONLY — no Reddit writes and no live reputation mutation\n'
printf '%s\n\n' '=========================================================================================='

index=0
while IFS= read -r username; do
  [[ -n "$username" ]] || continue
  index=$((index + 1))

  printf '\n%s\n' '##########################################################################################'
  printf 'RE-EVALUATION %d/%d: u/%s\n' "$index" "$CANDIDATE_COUNT" "$username"
  printf '%s\n' '##########################################################################################'

  env \
    MEMBER_MOD_NOTES_ISOLATED_RUN=1 \
    REDDIT_REPUTATION_STATE_FILE="$SNAPSHOT_REPUTATION" \
    REDDIT_RATE_STATE_FILE="$SNAPSHOT_RATE" \
    REDDIT_MEMBER_MOD_NOTES_FILE="$NOTES_FILE" \
    REDDIT_RATE_MINIMUM_INTERVAL_MS="$RATE_INTERVAL_MS" \
    bun run experiment:member-notes -- --refresh "--user=$username"
done < "$CANDIDATES"

printf '\n%s\n' '=========================================================================================='
printf 'BAN-CANDIDATE RE-EVALUATION COMPLETE\n'
printf 'Candidates processed: %s\n' "$CANDIDATE_COUNT"
printf '%s\n' '=========================================================================================='
WORKER
chmod +x "$WORKER"

export CANDIDATE_COUNT="$COUNT"
export CANDIDATES SNAPSHOT_REPUTATION SNAPSHOT_RATE NOTES_FILE RATE_INTERVAL_MS

printf -v WORKER_Q '%q' "$WORKER"
printf -v LOG_Q '%q' "$LOG"

tmux new-session -d -s "$SESSION" -c "$ROOT" \
  "set -o pipefail; ${WORKER_Q} 2>&1 | tee -a ${LOG_Q}"

echo "Started corrected-rule ban-candidate preview in tmux session '$SESSION'."
echo ""
echo "Source review:        $SOURCE_REVIEW"
echo "Original baseline:    $SOURCE_REPUTATION"
echo "Rerun snapshot:       $SNAPSHOT_REPUTATION"
echo "Candidates:           $COUNT"
echo "Candidate list:       $CANDIDATES"
echo "Member notes:         $NOTES_FILE"
echo "Log:                  $LOG"
echo "Rate interval:        ${RATE_INTERVAL_MS}ms"
echo ""
echo "This rerun is hard-coded PREVIEW ONLY. It cannot apply bans, removals, flairs or Reddit Mod Notes."
echo ""
echo "Watch complete audit live:"
echo "  tail -n +1 -F '$LOG'"
