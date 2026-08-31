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
      echo "Usage: bash scripts/previewMemberModNotesReconciliation.sh --base=<full-audit.log>" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$BASE" ]]; then
  echo "Usage: bash scripts/previewMemberModNotesReconciliation.sh --base=<full-audit.log>" >&2
  exit 1
fi
if [[ ! -f "$BASE" ]]; then
  echo "Base audit log does not exist: $BASE" >&2
  exit 1
fi
BASE="$(realpath "$BASE")"

RUN_ROOT="${MEMBER_MOD_NOTES_RUN_ROOT:-$ROOT/data/member-mod-notes-runs}"

COMPLETIONS=()
while IFS= read -r manifest; do
  [[ -f "$manifest" ]] || continue
  if grep -Fqx "source_audit=$BASE" "$manifest"; then
    candidate_log="$(dirname "$manifest")/member-mod-notes.log"
    [[ -f "$candidate_log" ]] && COMPLETIONS+=("$candidate_log")
  fi
done < <(find "$RUN_ROOT" -type f -path '*-missing-rerun/manifest.txt' -print 2>/dev/null | sort)

CORRECTION_DIR="$(
  find "$RUN_ROOT" -maxdepth 1 -type d -name '*-ban-rerun' -print 2>/dev/null \
    | sort -r \
    | while IFS= read -r dir; do
        if [[ -f "$dir/member-mod-notes.log" && -f "$dir/Live_Association6105-retry2.log" ]]; then
          printf '%s\n' "$dir"
          break
        fi
      done
)"

if [[ -z "$CORRECTION_DIR" ]]; then
  echo "Could not find the corrected 12-user ban-candidate rerun with Live_Association6105 retry2." >&2
  exit 1
fi

ARGS=("--base=$BASE")
for completion in "${COMPLETIONS[@]}"; do
  ARGS+=("--completion=$completion")
done
ARGS+=(
  "--overlay=$CORRECTION_DIR/member-mod-notes.log"
  "--overlay=$CORRECTION_DIR/Live_Association6105-retry2.log"
  "--expect-overrides=12"
)

printf '%s\n' '=========================================================================================='
printf '%s\n' 'AUDIT COMPLETION VERIFIED — STARTING RECONCILIATION PREVIEW'
printf 'Base: %s\n' "$BASE"
printf 'Completion logs: %d\n' "${#COMPLETIONS[@]}"
printf 'Corrected overlay: %s\n' "$CORRECTION_DIR"
printf '%s\n' 'Mode: PREVIEW ONLY — no canonical reputation mutation and no Reddit Mod Note writes'
printf '%s\n' '=========================================================================================='

exec bun run scripts/reconcileMemberModNotesAudit.ts -- "${ARGS[@]}"
