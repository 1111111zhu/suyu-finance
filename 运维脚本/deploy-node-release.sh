#!/usr/bin/env bash
set -Eeuo pipefail

deploy_path=${1:?deployment path is required}
release_sha=${2:?release SHA is required}
archive="/tmp/suyu-finance-${release_sha}.tar.gz"
release_root="${deploy_path}/releases"
release_dir="${release_root}/${release_sha}"
node_root=/opt/node-v22.13.0
service=suyu-finance.service
unit="/etc/systemd/system/${service}"
canary_log="/tmp/suyu-finance-canary-${release_sha}.log"

if [[ ! "$deploy_path" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  echo "Unsafe deployment path: ${deploy_path}" >&2
  exit 1
fi

test -f "$archive" || { echo "Release archive is missing: ${archive}" >&2; exit 1; }
test -x "${node_root}/bin/npm" || { echo "Node.js runtime is missing under ${node_root}" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is not installed" >&2; exit 1; }
command -v setsid >/dev/null || { echo "setsid is not installed" >&2; exit 1; }
sudo -n true || { echo "The deployment user needs passwordless sudo" >&2; exit 1; }

sudo -n install -d -m 755 -o "$(id -un)" -g "$(id -gn)" "$release_root"
mkdir -p "$release_dir"
tar -xzf "$archive" -C "$release_dir"
rm -f "$archive"

export PATH="${node_root}/bin:${PATH}"
cd "$release_dir"
npm ci --no-audit --no-fund
NODE_OPTIONS=--max-old-space-size=1536 npm run build

canary_pid=''
cleanup_canary() {
  if [[ -n "$canary_pid" ]]; then
    kill -- "-${canary_pid}" >/dev/null 2>&1 || true
    wait "$canary_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup_canary EXIT
setsid npm run start -- --host 127.0.0.1 --port 3001 >"$canary_log" 2>&1 &
canary_pid=$!
curl --retry 20 --retry-all-errors --retry-connrefused --retry-delay 2 --fail --silent --show-error \
  http://127.0.0.1:3001/ >/dev/null
curl --retry 4 --retry-all-errors --retry-delay 2 --fail --silent --show-error \
  http://127.0.0.1:3001/policy >/dev/null
cleanup_canary
canary_pid=''
trap - EXIT

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
EnvironmentFile=-/etc/suyu-finance/rd-runtime.env
ExecStart=${node_root}/bin/npm run start -- --host 127.0.0.1 --port 3000
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT

rollback() {
  echo "Production health check failed; restoring the previous service configuration." >&2
  if [[ -n "$unit_backup" ]]; then
    sudo -n cp "$unit_backup" "$unit"
    sudo -n systemctl daemon-reload
    sudo -n systemctl restart "$service" || true
  fi
}

sudo -n systemctl daemon-reload
sudo -n systemctl enable "$service" >/dev/null
if ! sudo -n systemctl restart "$service"; then
  rollback
  exit 1
fi
if ! curl --retry 20 --retry-all-errors --retry-connrefused --retry-delay 2 --fail --silent --show-error \
  http://127.0.0.1:3000/ >/dev/null; then
  rollback
  exit 1
fi

printf '%s\n' "$release_sha" >"${release_dir}/DEPLOYED_COMMIT"
sudo -n ln -sfn "$release_dir" "${deploy_path}/current"

mapfile -t stale_releases < <(find "$release_root" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -rn | tail -n +6 | cut -d' ' -f2-)
if (( ${#stale_releases[@]} > 0 )); then
  rm -rf -- "${stale_releases[@]}"
fi

echo "Deployed ${release_sha} to ${deploy_path}."
