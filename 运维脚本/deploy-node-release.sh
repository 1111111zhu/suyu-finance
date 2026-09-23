#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

deploy_path=${1:?deployment path is required}
release_sha=${2:?release SHA is required}
[[ $deploy_path =~ ^/[A-Za-z0-9._/-]+$ && $deploy_path != / && $deploy_path != *'/../'* && $deploy_path != *'/./'* ]] || { echo 'Unsafe deployment path.' >&2; exit 1; }
[[ $release_sha =~ ^[a-f0-9]{40}$|^[a-f0-9]{64}$ ]] || { echo 'Invalid release SHA.' >&2; exit 1; }

archive="/tmp/suyu-finance-${release_sha}.tar.gz"
release_root="${deploy_path}/releases"
release_dir="${release_root}/${release_sha}"
node_root=/opt/node-v22.13.0
service=suyu-finance.service
unit="/etc/systemd/system/${service}"
runtime_env=/etc/suyu-finance/rd-runtime.env
migration_env=/etc/suyu-finance/rd-migrate.env
backup_root="${deploy_path}/backups/rd"
canary_log="/tmp/suyu-finance-canary-${release_sha}.log"

test -f "$archive" || { echo "Release archive is missing: ${archive}" >&2; exit 1; }
test -x "${node_root}/bin/npm" || { echo "Node.js runtime is missing under ${node_root}" >&2; exit 1; }
for tool in curl setsid; do command -v "$tool" >/dev/null || { echo "Missing deployment tool: ${tool}" >&2; exit 1; }; done
for file in "$runtime_env" "$migration_env"; do
  sudo -n test -f "$file" && sudo -n test ! -L "$file" || { echo "Required private configuration is missing: ${file}" >&2; exit 1; }
done
sudo -n true || { echo 'The deployment user needs passwordless sudo for systemd.' >&2; exit 1; }

sudo -n install -d -m 755 -o "$(id -un)" -g "$(id -gn)" "$release_root"
sudo -n install -d -m 700 -o "$(id -un)" -g "$(id -gn)" "$backup_root"
export PATH="${node_root}/bin:${PATH}"

# A release directory is immutable after a successful build. An incomplete
# attempt is left for inspection, rather than silently overwriting its files.
if [[ -d $release_dir ]]; then
  [[ -f ${release_dir}/DEPLOYED_COMMIT && $(<"${release_dir}/DEPLOYED_COMMIT") == "$release_sha" ]] || {
    echo "Release directory already exists but is incomplete: ${release_dir}" >&2; exit 1;
  }
else
  stage_dir=$(mktemp -d "${release_root}/.${release_sha}.XXXXXXXX")
  tar -xzf "$archive" -C "$stage_dir"
  cd "$stage_dir"
  npm ci --no-audit --no-fund
  NODE_OPTIONS=--max-old-space-size=1536 npm run build
  printf '%s\n' "$release_sha" >"${stage_dir}/DEPLOYED_COMMIT"
  mv -- "$stage_dir" "$release_dir"
fi
rm -f -- "$archive"
cd "$release_dir"

# The website's existing database is never replaced during a release. The
# logical dump precedes every migration and can be restored on another host.
(
  set -a
  # Administrator-installed shell assignments. The private file is not copied
  # into a release or printed to CI.
  # shellcheck source=/dev/null
  . <(sudo -n cat "$migration_env")
  set +a
  [[ -n ${RD_DATABASE_MIGRATION_URL:-} && -n ${RD_DB_RUNTIME_USER:-} ]] || {
    echo 'RD migration connection and runtime role are required.' >&2; exit 1;
  }
  backup_dir=$(bash 运维脚本/rd-db-backup.sh "$backup_root")
  echo "RD backup complete: ${backup_dir}"
  node database/rd/migrate.mjs migrate
  node database/rd/provision.mjs grant-runtime
)

canary_pid=''
cleanup_canary() {
  if [[ -n $canary_pid ]]; then
    kill -- "-${canary_pid}" >/dev/null 2>&1 || true
    wait "$canary_pid" >/dev/null 2>&1 || true
    canary_pid=''
  fi
}
trap cleanup_canary EXIT
set -a
# shellcheck source=/dev/null
. <(sudo -n cat "$runtime_env")
set +a
[[ -n ${RD_DATABASE_URL:-} ]] || { echo 'RD runtime connection is required.' >&2; exit 1; }
[[ -n ${RD_API_TOKEN:-} ]] || { echo 'RD API token is required for health checks.' >&2; exit 1; }
check_path() {
  local port=$1 path=$2
  if [[ $path == /api/rd/* ]]; then
    printf 'header = "Authorization: Bearer %s"\n' "$RD_API_TOKEN" | \
      curl --config - --retry 20 --retry-all-errors --retry-connrefused --retry-delay 2 --fail --silent --show-error \
        "http://127.0.0.1:${port}${path}" >/dev/null
  else
    curl --retry 20 --retry-all-errors --retry-connrefused --retry-delay 2 --fail --silent --show-error \
      "http://127.0.0.1:${port}${path}" >/dev/null
  fi
}
setsid npm run start -- --host 127.0.0.1 --port 3001 >"$canary_log" 2>&1 &
canary_pid=$!
for path in / /policy /api/rd/platforms /api/rd/projects; do
  check_path 3001 "$path" || { echo "Canary check failed at ${path}; see ${canary_log}." >&2; exit 1; }
done
cleanup_canary
trap - EXIT
unset RD_DATABASE_URL

unit_backup=''
if sudo -n test -f "$unit"; then
  unit_backup="/tmp/${service}.${release_sha}.bak"
  sudo -n cp "$unit" "$unit_backup"
fi
sudo -n tee "$unit" >/dev/null <<UNIT
[Unit]
Description=Suyu Finance web application
After=network.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=${release_dir}
Environment=NODE_ENV=production
Environment=PATH=${node_root}/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=${runtime_env}
ExecStart=${node_root}/bin/npm run start -- --host 127.0.0.1 --port 3000
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT

rollback() {
  echo 'Production health check failed; restoring the prior website service.' >&2
  if [[ -n $unit_backup ]]; then
    sudo -n cp "$unit_backup" "$unit"
    sudo -n systemctl daemon-reload
    sudo -n systemctl restart "$service" || true
  else
    sudo -n systemctl stop "$service" || true
  fi
}

sudo -n systemctl daemon-reload
sudo -n systemctl enable "$service" >/dev/null
if ! sudo -n systemctl restart "$service"; then rollback; exit 1; fi
for path in / /api/rd/platforms /api/rd/projects; do
  if ! check_path 3000 "$path"; then
    rollback
    exit 1
  fi
done

sudo -n ln -sfn "$release_dir" "${deploy_path}/current"
echo "Deployed ${release_sha} to ${deploy_path}."
