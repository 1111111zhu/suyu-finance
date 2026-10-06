#!/usr/bin/env bash
# Run only inside the existing authoritative checkout. No clone/release dirs.
set +x
set -Eeuo pipefail
script_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
[[ $(pwd -P) == "$script_root" ]] || { echo 'Run from the existing authoritative checkout.' >&2; exit 1; }
: "${FINANCE_DB_ENV_FILE:?}" "${FINANCE_RUNTIME_ENV_FILE:?}" "${FINANCE_MIGRATION_ENV_FILE:?}" "${FINANCE_WECOM_SECRET_FILE:?}"
compose=(docker compose -f compose.finance.yaml)
"${compose[@]}" config --quiet
"${compose[@]}" build web migrate
"${compose[@]}" up -d --wait postgres
# Caller explicitly enables first initialization only after confirming empty DBs.
if [[ ${FINANCE_FIRST_INSTALL:-0} != 1 ]]; then
  : "${FINANCE_BACKUP_ROOT:?}"
  bash 运维脚本/finance-backup.sh "$FINANCE_BACKUP_ROOT"
fi
"${compose[@]}" stop web
"${compose[@]}" run --rm -T migrate
"${compose[@]}" up -d --wait web
curl --fail --silent --show-error http://127.0.0.1:3220/ >/dev/null
echo '3220 is ready. Complete manager/finance acceptance through the homepage menu.'
