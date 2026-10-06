#!/usr/bin/env bash
# Runs only on a NEW PostgreSQL volume. Never modifies an existing database.
set +x
set -Eeuo pipefail
for key in RD_DB_NAME RD_DB_OWNER_PASSWORD RD_DB_RUNTIME_PASSWORD PAYROLL_DB_NAME PAYROLL_DB_OWNER_PASSWORD PAYROLL_RUNTIME_PASSWORD; do
  [[ -n ${!key:-} ]] || { echo "Missing $key" >&2; exit 1; }
done
for key in RD_DB_OWNER_PASSWORD RD_DB_RUNTIME_PASSWORD PAYROLL_DB_OWNER_PASSWORD PAYROLL_RUNTIME_PASSWORD POSTGRES_PASSWORD; do
  value=${!key}; [[ ${#value} -ge 20 ]] || { echo "$key requires at least 20 characters" >&2; exit 1; }
done
for name in "$RD_DB_NAME" "$PAYROLL_DB_NAME"; do
  [[ $name =~ ^[a-z][a-z0-9_]{0,62}$ ]] || exit 1
done
[[ $RD_DB_NAME != "$PAYROLL_DB_NAME" ]] || exit 1
# psql literal/identifier substitutions quote secrets without shell interpolation.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v rd_db="$RD_DB_NAME" -v payroll_db="$PAYROLL_DB_NAME" \
  -v rd_owner_pass="$RD_DB_OWNER_PASSWORD" -v rd_runtime_pass="$RD_DB_RUNTIME_PASSWORD" \
  -v payroll_owner_pass="$PAYROLL_DB_OWNER_PASSWORD" -v payroll_runtime_pass="$PAYROLL_RUNTIME_PASSWORD" <<'SQL'
CREATE ROLE rd_owner LOGIN PASSWORD :'rd_owner_pass' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE rd_runtime LOGIN PASSWORD :'rd_runtime_pass' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE payroll_owner LOGIN PASSWORD :'payroll_owner_pass' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE payroll_runtime LOGIN PASSWORD :'payroll_runtime_pass' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE :"rd_db" OWNER rd_owner;
CREATE DATABASE :"payroll_db" OWNER payroll_owner;
REVOKE ALL ON DATABASE :"rd_db" FROM PUBLIC;
REVOKE ALL ON DATABASE :"payroll_db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"rd_db" TO rd_runtime;
GRANT CONNECT ON DATABASE :"payroll_db" TO payroll_runtime;
SQL
for name in "$RD_DB_NAME" "$PAYROLL_DB_NAME"; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$name" -c 'REVOKE CREATE ON SCHEMA public FROM PUBLIC'
done
