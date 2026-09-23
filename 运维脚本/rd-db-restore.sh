#!/usr/bin/env bash
# Restore only into a new database. Existing databases are never overwritten.
# PGHOST, PGPORT, PGUSER and PGPASSFILE authenticate a role with CREATEDB and
# permission to SET ROLE to OWNER_ROLE. The owner's role is provisioned first.
set +x
set -Eeuo pipefail
umask 077

if [[ ${1:-} == --help ]]; then
  echo 'Usage: rd-db-restore.sh BACKUP_DIR NEW_DB_NAME OWNER_ROLE (requires PGHOST, PGUSER, PGPASSFILE and PostgreSQL 17 clients)'
  exit 0
fi
[[ $# == 3 ]] || { echo 'Usage: rd-db-restore.sh BACKUP_DIR NEW_DB_NAME OWNER_ROLE' >&2; exit 1; }
backup_dir=$1
target_db=$2
owner_role=$3
[[ $backup_dir == /* && -d $backup_dir && ! -L $backup_dir ]] || { echo 'BACKUP_DIR must be a real absolute directory.' >&2; exit 1; }
for value in "$target_db" "$owner_role"; do
  [[ $value =~ ^[a-z][a-z0-9_]{0,62}$ ]] || { echo 'Database and role must be lowercase SQL identifiers.' >&2; exit 1; }
done
[[ $target_db != postgres && $target_db != template0 && $target_db != template1 ]] || { echo 'Choose a non-maintenance target database.' >&2; exit 1; }
[[ -n ${PGHOST:-} && -n ${PGUSER:-} && -n ${PGPASSFILE:-} && -f $PGPASSFILE ]] || { echo 'Set PGHOST, PGUSER and PGPASSFILE.' >&2; exit 1; }
for tool in pg_restore psql createdb sha256sum; do command -v "$tool" >/dev/null || { echo "Missing tool: ${tool}" >&2; exit 1; }; done
[[ $(pg_restore --version) == *'PostgreSQL) 17.'* ]] || { echo 'PostgreSQL 17 pg_restore is required.' >&2; exit 1; }
[[ $(<"${backup_dir}/status") == complete ]] || { echo 'Backup is incomplete.' >&2; exit 1; }
manifest="${backup_dir}/manifest.txt"
[[ -f $manifest && ! -L $manifest ]] || { echo 'Backup manifest is missing.' >&2; exit 1; }
expected_sha=$(sed -n 's/^sha256=//p' "$manifest")
[[ $expected_sha =~ ^[a-f0-9]{64}$ && $(sed -n 's/^format=//p' "$manifest") == postgresql-custom-v1 ]] || { echo 'Backup manifest is invalid.' >&2; exit 1; }
dump_path="${backup_dir}/rd_finance.dump"
[[ -f $dump_path && ! -L $dump_path ]] || { echo 'Backup dump is missing.' >&2; exit 1; }
[[ $(sha256sum "$dump_path" | cut -d' ' -f1) == "$expected_sha" ]] || { echo 'Backup checksum mismatch.' >&2; exit 1; }
[[ $(wc -c <"$dump_path" | tr -d '[:space:]') == "$(sed -n 's/^bytes=//p' "$manifest")" ]] || { echo 'Backup size mismatch.' >&2; exit 1; }
pg_restore --list "$dump_path" >/dev/null

database_exists=$(psql --no-psqlrc --no-password --dbname=postgres --tuples-only --no-align --set=ON_ERROR_STOP=1 \
  --command="SELECT 1 FROM pg_database WHERE datname = '${target_db}'")
[[ -z $database_exists ]] || { echo 'Target database already exists; restore refused.' >&2; exit 1; }
role_exists=$(psql --no-psqlrc --no-password --dbname=postgres --tuples-only --no-align --set=ON_ERROR_STOP=1 \
  --command="SELECT 1 FROM pg_roles WHERE rolname = '${owner_role}'")
[[ $role_exists == 1 ]] || { echo 'Owner role must be provisioned first.' >&2; exit 1; }
createdb --maintenance-db=postgres --owner="$owner_role" --template=template0 --encoding=UTF8 "$target_db"
echo "Created ${target_db}; restoring. If restore fails, the new database is retained for inspection." >&2
pg_restore --no-password --exit-on-error --single-transaction --no-owner --role="$owner_role" --dbname="$target_db" "$dump_path"
echo "Restored ${target_db}. Verify data and grants before switching the website."
