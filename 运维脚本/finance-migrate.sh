#!/usr/bin/env bash
set +x
set -Eeuo pipefail
: "${RD_DATABASE_MIGRATION_URL:?}" "${DATABASE_MIGRATION_URL:?}"
node database/rd/migrate.mjs migrate
node database/payroll/migrate.mjs migrate
node database/rd/provision.mjs grant-runtime
node database/payroll/admin.mjs api-grants
# Payroll baseline grants for an already provisioned runtime role.
node 运维脚本/finance-payroll-grants.mjs
