#!/usr/bin/env bash
# One-time setup of the RD database inside the existing PostgreSQL container.
# Run as root with the stable container name; never print generated credentials.
set +x
set -Eeuo pipefail
umask 077

[[ $# == 1 && $1 =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || {
  echo 'Usage: sudo bash rd-db-bootstrap-existing.sh POSTGRES_CONTAINER' >&2
  exit 1
}
[[ $EUID == 0 ]] || { echo 'Run this one-time setup as root.' >&2; exit 1; }
container=$1
runtime_env=/etc/suyu-finance/rd-runtime.env
migration_env=/etc/suyu-finance/rd-migrate.env
for tool in docker openssl; do command -v "$tool" >/dev/null || { echo "Missing tool: $tool" >&2; exit 1; }; done
docker inspect "$container" >/dev/null
for file in "$runtime_env" "$migration_env"; do
  [[ ! -e $file && ! -L $file ]] || { echo "Private config already exists: $file" >&2; exit 1; }
done

admin_sql() {
  docker exec -i "$container" sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" exec psql --no-psqlrc --no-password --set=ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -At' \
    "$@"
}

existing=$(admin_sql <<'SQL'
SELECT 'database' FROM pg_database WHERE datname='rd_finance'
UNION ALL SELECT 'role' FROM pg_roles WHERE rolname IN ('rd_owner','rd_runtime');
SQL
)
[[ -z $existing ]] || { echo 'RD database or roles already exist; inspect them before retrying.' >&2; exit 1; }

owner_password=$(openssl rand -hex 32)
runtime_password=$(openssl rand -hex 32)
api_token=$(openssl rand -hex 32)
install -d -m 700 -o root -g root /etc/suyu-finance
printf "CREATE ROLE rd_owner LOGIN PASSWORD '%s' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;\nCREATE ROLE rd_runtime LOGIN PASSWORD '%s' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;\n" \
  "$owner_password" "$runtime_password" | admin_sql >/dev/null
admin_sql <<'SQL' >/dev/null
CREATE DATABASE rd_finance OWNER rd_owner;
REVOKE CONNECT ON DATABASE rd_finance FROM PUBLIC;
GRANT CONNECT ON DATABASE rd_finance TO rd_owner, rd_runtime;
SQL
[[ $(admin_sql <<'SQL'
SELECT datname FROM pg_database WHERE datname='rd_finance';
SQL
) == rd_finance ]] || { echo 'RD database creation could not be verified.' >&2; exit 1; }

printf 'RD_DATABASE_MIGRATION_URL=postgresql://rd_owner:%s@127.0.0.1:5432/rd_finance\nRD_DB_RUNTIME_USER=rd_runtime\nRD_DB_CONTAINER=%s\n' \
  "$owner_password" "$container" >"$migration_env"
printf 'RD_DATABASE_URL=postgresql://rd_runtime:%s@127.0.0.1:5432/rd_finance\nRD_API_TOKEN=%s\n' \
  "$runtime_password" "$api_token" >"$runtime_env"
chmod 600 "$migration_env" "$runtime_env"

echo 'Created rd_finance in the existing PostgreSQL service and installed private RD configuration.'
