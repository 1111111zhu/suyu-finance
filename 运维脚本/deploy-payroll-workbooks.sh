#!/usr/bin/env bash
# Incremental deployment: preserve the server's private/newer source and auth.
set -Eeuo pipefail
umask 077
export PATH=/opt/node-v22.13.0/bin:$PATH
sha=${1:?GitHub commit required}
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 1
root=$(readlink -f /opt/suyu-finance/current)
patch=${2:?extracted GitHub source required}
systemctl is-active --quiet suyu-finance
backup=$(mktemp -d /opt/suyu-finance/backups/payroll-workbooks.XXXXXX)
stage=$backup/stage
mkdir "$stage"
# No secret/runtime data leaves this host. Staging remains private.
rsync -a --exclude=node_modules --exclude=dist --exclude=.git --exclude=.local --exclude='.env*' --exclude=.codex_tmp --exclude=editor-assets "$root/" "$stage/"
python3 "$patch/运维脚本/payroll-workbooks-stage.py" prepare "$root" "$stage" "$patch" "$backup"
cd "$stage"
npm install --ignore-scripts --no-audit --no-fund > "$backup/install.log" 2>&1
RD_LOCAL_PREVIEW=1 NODE_OPTIONS=--max-old-space-size=1536 npm run build > "$backup/build.log" 2>&1
test -s dist/server/index.js
# Recheck all source files, including payroll rules/auth, immediately before mutation.
python3 "$patch/运维脚本/payroll-workbooks-stage.py" check "$root" "$stage" "$patch" "$backup"
container=$(docker ps --format '{{.Names}} {{.Image}}' | awk '$2 ~ /^postgres:17/ && $1 ~ /payroll/ {print $1}')
[[ -n $container && $container != *$'\n'* ]]
docker exec "$container" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup/payroll-before.dump"
test -s "$backup/payroll-before.dump"
# A connection-only preflight ensures migration targets this same database.
node --env-file=/etc/suyu-finance/payroll-migrate.env --env-file=/etc/suyu-finance/payroll-api.env "$patch/运维脚本/payroll-workbooks-migrate.mjs" "$stage" "$backup"
python3 "$patch/运维脚本/payroll-workbooks-stage.py" check "$root" "$stage" "$patch" "$backup"
cp -a "$root/dist" "$backup/dist-before"
# Back up touched source; new additive database tables are retained on rollback.
python3 "$patch/运维脚本/payroll-workbooks-stage.py" backup "$root" "$stage" "$patch" "$backup"
installed=0
rollback() {
 trap - ERR
 if [[ $installed == 1 ]]; then
   python3 "$patch/运维脚本/payroll-workbooks-stage.py" restore "$root" "$stage" "$patch" "$backup"
   mv "$root/dist" "$backup/failed-dist"
   cp -a "$backup/dist-before" "$root/dist"
   mv "$root/node_modules" "$backup/failed-node_modules"
   mv "$backup/node_modules-before" "$root/node_modules"
   systemctl restart suyu-finance || true
 fi
 echo "WORKBOOK_ROLLED_BACK backup=$backup" >&2
 exit 1
}
trap rollback ERR
mv "$root/node_modules" "$backup/node_modules-before"
mv "$stage/node_modules" "$root/node_modules"
installed=1
python3 "$patch/运维脚本/payroll-workbooks-stage.py" install "$root" "$stage" "$patch" "$backup"
mv "$root/dist" "$backup/dist-replaced"
mv "$stage/dist" "$root/dist"
chown -R --reference="$backup/dist-before" "$root/dist" "$root/node_modules" "$root/public/salary/editor-assets"
chmod -R a+rX "$root/dist" "$root/node_modules" "$root/public/salary/editor-assets"
systemctl restart suyu-finance
for n in $(seq 1 30); do
 if curl -fsS http://127.0.0.1:3220/ > /dev/null && [[ $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3220/api/payroll/workbooks/roster) == 401 ]]; then
   trap - ERR
   printf '%s\n' "$sha" > "$root/PAYROLL_WORKBOOKS_COMMIT"
   echo "WORKBOOK_DEPLOYED commit=$sha backup=$backup"
   exit 0
 fi
 sleep 1
done
false
