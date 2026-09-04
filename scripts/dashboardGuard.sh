#!/usr/bin/env bash
set -u

SERVICE='reddit'
reason="${1:-source maintenance}"
shift || true
[[ "${1:-}" == '--' ]] || { echo "usage: $0 <reason> -- <command> [args...]" >&2; exit 2; }
shift
(( $# > 0 )) || { echo 'maintenance guard requires a command' >&2; exit 2; }

helper="${MAE_DASHBOARD_PAUSE_HELPER:-$HOME/server/mae/dashboard/scripts/mae_dashboard_pause.sh}"
if [[ -f "$helper" ]]; then
  exec bash "$helper" with "$SERVICE" "$reason" -- "$@"
fi

exec "$@"
