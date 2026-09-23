#!/usr/bin/env bash
# Portable logical backup of the dedicated RD database. The caller supplies the
# restricted owner connection in RD_DATABASE_MIGRATION_URL; no dump enters Git.
set +x
set -Eeuo pipefail
umask 077

if [[ ${1:-} == --help ]]; then
  echo 'Usage: rd-db-backup.sh OUTPUT_ROOT (requires RD_DATABASE_MIGRATION_URL; uses PostgreSQL 17 pg_dump on host or RD_DB_CONTAINER)'
  exit 0
fi
[[ $# == 1 && -n ${RD_DATABASE_MIGRATION_URL:-} ]] || { echo 'Usage: rd-db-backup.sh OUTPUT_ROOT; set RD_DATABASE_MIGRATION_URL.' >&2; exit 1; }
[[ $1 == /* && $1 != / && $1 != */../* && $1 != */./* ]] || { echo 'OUTPUT_ROOT must be a specific absolute directory.' >&2; exit 1; }
script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
command -v node >/dev/null || { echo 'Node.js is required to parse the PostgreSQL connection.' >&2; exit 1; }
{
  IFS= read -r -d '' pg_host
  IFS= read -r -d '' pg_port
  IFS= read -r -d '' pg_user
  IFS= read -r -d '' pg_password
  IFS= read -r -d '' pg_database
} < <(node "${script_dir}/rd-pg-connection.mjs")
[[ -n $pg_host && -n $pg_port && -n $pg_user && -n $pg_password && -n $pg_database ]] || {
  echo 'Could not parse the RD migration connection.' >&2; exit 1;
}
if [[ -n ${RD_DB_CONTAINER:-} ]]; then
  [[ $RD_DB_CONTAINER =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo 'RD_DB_CONTAINER is invalid.' >&2; exit 1; }
  command -v docker >/dev/null || { echo 'Docker is required for container pg_dump.' >&2; exit 1; }
  [[ $(sudo -n docker exec "$RD_DB_CONTAINER" pg_dump --version) == *'PostgreSQL) 17.'* ]] || { echo 'The selected container needs PostgreSQL 17 pg_dump.' >&2; exit 1; }
else
  command -v pg_dump >/dev/null || { echo 'PostgreSQL 17 pg_dump or RD_DB_CONTAINER is required.' >&2; exit 1; }
  [[ $(pg_dump --version) == *'PostgreSQL) 17.'* ]] || { echo 'PostgreSQL 17 pg_dump is required.' >&2; exit 1; }
fi

backup_root=$1
if [[ -L $backup_root ]]; then echo 'Backup root must not be a symlink.' >&2; exit 1; fi
install -d -m 700 "$backup_root"
backup_dir=$(mktemp -d "${backup_root}/rd-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX")
dump_path="${backup_dir}/rd_finance.dump"
diagnostics="${backup_dir}/diagnostics.log"
printf 'incomplete\n' >"${backup_dir}/status"
if [[ -n ${RD_DB_CONTAINER:-} ]]; then
  # Send discrete libpq fields on stdin. Neither docker nor pg_dump receives
  # the password in its command arguments. pg_dump writes the archive to stdout.
  if ! printf '%s\n' "$pg_host" "$pg_port" "$pg_user" "$pg_password" "$pg_database" | \
    sudo -n docker exec -i "$RD_DB_CONTAINER" \
    sh -c 'IFS= read -r PGHOST; IFS= read -r PGPORT; IFS= read -r PGUSER; IFS= read -r PGPASSWORD; IFS= read -r PGDATABASE; export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE; exec pg_dump --no-password --format=custom' \
    >"$dump_path" 2>"$diagnostics"; then
    echo "RD backup failed; private diagnostics retained in ${backup_dir}." >&2
    exit 1
  fi
else
  if ! PGHOST="$pg_host" PGPORT="$pg_port" PGUSER="$pg_user" PGPASSWORD="$pg_password" PGDATABASE="$pg_database" \
    pg_dump --no-password --format=custom --file="$dump_path" 2>"$diagnostics"; then
    echo "RD backup failed; private diagnostics retained in ${backup_dir}." >&2
    exit 1
  fi
fi
sha256=$(sha256sum "$dump_path" | cut -d' ' -f1)
bytes=$(wc -c <"$dump_path" | tr -d '[:space:]')
{
  printf 'format=postgresql-custom-v1\n'
  printf 'created_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'file=rd_finance.dump\n'
  printf 'sha256=%s\n' "$sha256"
  printf 'bytes=%s\n' "$bytes"
} >"${backup_dir}/manifest.txt"
printf 'complete\n' >"${backup_dir}/status"
echo "$backup_dir"
