#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SESSION="${MEMBER_MOD_NOTES_TMUX:-mae-member-notes}"
RUN_ROOT="${MEMBER_MOD_NOTES_RUN_ROOT:-$ROOT/data/member-mod-notes-runs}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$RUN_ROOT/$STAMP"
SNAPSHOT_REPUTATION="$RUN_DIR/reputation.pb"
SNAPSHOT_RATE="$RUN_DIR/redditRate.pb"
NOTES_FILE="$RUN_DIR/memberModNotes.pb"
LOG="$RUN_DIR/member-mod-notes.log"
RATE_INTERVAL_MS="${MEMBER_MOD_NOTES_RATE_INTERVAL_MS:-3000}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required for the detached member Mod Notes experiment." >&2
  exit 1
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "tmux session '$SESSION' already exists." >&2
  echo "Attach with: tmux attach -t '$SESSION'" >&2
  exit 1
fi

if ! [[ "$RATE_INTERVAL_MS" =~ ^[0-9]+$ ]] || (( RATE_INTERVAL_MS < 1000 || RATE_INTERVAL_MS > 60000 )); then
  echo "MEMBER_MOD_NOTES_RATE_INTERVAL_MS must be an integer from 1000 to 60000." >&2
  exit 1
fi

LIVE_REPUTATION="$(bun -e '
  import { redditModerationConfig } from "./src/env.ts";
  const cfg = redditModerationConfig();
  if (cfg === null) throw new Error("REDDIT_MODERATION_ENABLED must be true");
  process.stdout.write(cfg.stateFile);
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
    const clientId = redditConfig().auth.legacyOauth?.clientId;\n    if (!clientId) throw new Error("Legacy Reddit OAuth client id is required for the shared rate-budget key");\n    const key = createHash("sha256").update(clientId).digest("hex").slice(0, 16);
    process.stdout.write(resolve(process.cwd(), "data", `redditRate-${key}.pb`));
  }
')"

if [[ ! -f "$LIVE_REPUTATION" ]]; then
  echo "Live reputation store does not exist: $LIVE_REPUTATION" >&2
  exit 1
fi

mkdir -p "$RUN_DIR"

# Snapshot data only. Never copy the live .lock files. The live bot remains the
# sole owner of its stores while the experiment works exclusively on these files.
cp --reflink=auto -- "$LIVE_REPUTATION" "$SNAPSHOT_REPUTATION"
if [[ -f "$LIVE_RATE" ]]; then
  cp --reflink=auto -- "$LIVE_RATE" "$SNAPSHOT_RATE"
fi

cat > "$RUN_DIR/manifest.txt" <<EOF
created_utc=$STAMP
git_head=$(git rev-parse HEAD)
live_reputation=$LIVE_REPUTATION
snapshot_reputation=$SNAPSHOT_REPUTATION
live_rate=$LIVE_RATE
snapshot_rate=$SNAPSHOT_RATE
member_notes=$NOTES_FILE
rate_interval_ms=$RATE_INTERVAL_MS
EOF

ARGS=(
  env
  "MEMBER_MOD_NOTES_ISOLATED_RUN=1"
  "MEMBER_MOD_NOTES_LIVE_REPUTATION_FILE=$LIVE_REPUTATION"
  "REDDIT_REPUTATION_STATE_FILE=$SNAPSHOT_REPUTATION"
  "REDDIT_RATE_STATE_FILE=$SNAPSHOT_RATE"
  "REDDIT_MEMBER_MOD_NOTES_FILE=$NOTES_FILE"
  "REDDIT_RATE_MINIMUM_INTERVAL_MS=$RATE_INTERVAL_MS"
  bun run experiment:member-notes -- "$@"
)
printf -v COMMAND '%q ' "${ARGS[@]}"
printf -v LOG_Q '%q' "$LOG"

# The Bun process belongs to tmux rather than the SSH shell. tee keeps a durable
# transcript in the same isolated run directory.
tmux new-session -d -s "$SESSION" -c "$ROOT" \
  "set -o pipefail; ${COMMAND}2>&1 | tee -a ${LOG_Q}"

echo "Started isolated member Mod Notes experiment in tmux session '$SESSION'."
echo ""
echo "Live reputation:     $LIVE_REPUTATION"
echo "Snapshot reputation: $SNAPSHOT_REPUTATION"
echo "Live rate state:     $LIVE_RATE"
echo "Snapshot rate state: $SNAPSHOT_RATE"
echo "Member notes:        $NOTES_FILE"
echo "Rate interval:       ${RATE_INTERVAL_MS}ms"
echo "Log:                 $LOG"
echo ""
echo "The experiment does not open the live reputation or rate-state stores."
echo "No live .lock file was copied."
echo ""
echo "Attach live:  tmux attach -t '$SESSION'"
echo "Detach again: Ctrl-b d"
echo "Watch log:    tail -f '$LOG'"
