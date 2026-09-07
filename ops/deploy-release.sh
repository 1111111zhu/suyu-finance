#!/usr/bin/env bash
set -Eeuo pipefail

deploy_path=${1:?deployment path is required}
release_sha=${2:?release SHA is required}
archive="/tmp/suyu-finance-${release_sha}.tar.gz"
release_dir="${deploy_path}/releases/${release_sha}"
image="suyu-finance:${release_sha}"
container="rd-cost-console"
canary="${container}-canary"

if [[ ! "$deploy_path" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  echo "Unsafe deployment path: ${deploy_path}" >&2
  exit 1
fi

command -v curl >/dev/null || { echo "curl is not installed" >&2; exit 1; }
test -f "$archive" || { echo "Release archive is missing: ${archive}" >&2; exit 1; }
sudo -n true || { echo "The deployment user needs passwordless sudo" >&2; exit 1; }
sudo -n docker version >/dev/null || { echo "Docker is unavailable through sudo" >&2; exit 1; }
docker_cmd=(sudo -n docker)

sudo -n install -d -m 755 -o "$(id -un)" -g "$(id -gn)" "${deploy_path}/releases"
mkdir -p "$release_dir"
tar -xzf "$archive" -C "$release_dir"
rm -f "$archive"

"${docker_cmd[@]}" build --pull --tag "$image" "$release_dir"

"${docker_cmd[@]}" rm --force "$canary" >/dev/null 2>&1 || true
"${docker_cmd[@]}" run --detach \
  --name "$canary" \
  --publish 127.0.0.1:3001:3000 \
  "$image" >/dev/null

cleanup_canary() {
  "${docker_cmd[@]}" rm --force "$canary" >/dev/null 2>&1 || true
}
trap cleanup_canary EXIT

curl --retry 12 --retry-connrefused --retry-delay 2 --fail --silent --show-error \
  http://127.0.0.1:3001/ >/dev/null
curl --retry 4 --retry-all-errors --retry-delay 2 --fail --silent --show-error \
  http://127.0.0.1:3001/policy >/dev/null

cleanup_canary
trap - EXIT

old_image=$("${docker_cmd[@]}" inspect --format '{{.Config.Image}}' "$container" 2>/dev/null || true)
"${docker_cmd[@]}" rm --force "$container" >/dev/null 2>&1 || true

rollback() {
  echo "Production health check failed; restoring ${old_image:-no previous image}." >&2
  "${docker_cmd[@]}" rm --force "$container" >/dev/null 2>&1 || true
  if [[ -n "$old_image" ]]; then
    "${docker_cmd[@]}" run --detach \
      --name "$container" \
      --restart unless-stopped \
      --publish 127.0.0.1:3000:3000 \
      "$old_image" >/dev/null
  fi
}

if ! "${docker_cmd[@]}" run --detach \
  --name "$container" \
  --restart unless-stopped \
  --publish 127.0.0.1:3000:3000 \
  "$image" >/dev/null; then
  rollback
  exit 1
fi

if ! curl --retry 12 --retry-connrefused --retry-delay 2 --fail --silent --show-error \
  http://127.0.0.1:3000/ >/dev/null; then
  rollback
  exit 1
fi

ln -sfn "$release_dir" "${deploy_path}/current"

# Keep the five newest extracted releases. Images remain available for rollback
# and can be pruned independently during scheduled server maintenance.
mapfile -t stale_releases < <(find "${deploy_path}/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -rn | tail -n +6 | cut -d' ' -f2-)
if (( ${#stale_releases[@]} > 0 )); then
  rm -rf -- "${stale_releases[@]}"
fi

echo "Deployed ${release_sha} to ${deploy_path}."
