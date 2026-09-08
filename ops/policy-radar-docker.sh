#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${POLICY_APP_DIR:-/opt/suyu-finance}"
BRANCH="${POLICY_BRANCH:-项目申报}"
LOCK_FILE="${POLICY_LOCK_FILE:-/tmp/suyu-policy-radar.lock}"
IMAGE_BASE="${POLICY_IMAGE:-rd-cost-console}"
CONTAINER="${POLICY_CONTAINER:-rd-cost-console}"
STAMP="$(date -u +%Y%m%d%H%M%S)"
CANDIDATE="${CONTAINER}-candidate-${STAMP}"
IMAGE="${IMAGE_BASE}:${STAMP}"
READY_IMAGE="${IMAGE_BASE}:ready-${STAMP}"

docker_cmd() { sudo -n docker "$@"; }
cleanup() { docker_cmd rm -f "$CANDIDATE" >/dev/null 2>&1 || true; }
trap cleanup EXIT

exec 9>"$LOCK_FILE"
flock -n 9 || { echo "policy deployment already running"; exit 0; }
cd "$APP_DIR"

if [[ -d .git ]] && git fetch --quiet origin "$BRANCH" </dev/null; then
  git checkout --quiet "$BRANCH"
  git pull --ff-only --quiet origin "$BRANCH" </dev/null
else
  echo "GitHub pull unavailable; using the verified rules and source currently deployed in $APP_DIR"
fi

docker_cmd build -t "$IMAGE" .
docker_cmd run -d --name "$CANDIDATE" "$IMAGE" >/dev/null
docker_cmd exec "$CANDIDATE" npm run sync:policies
docker_cmd exec "$CANDIDATE" npm run check:policy-integrity
docker_cmd exec "$CANDIDATE" node --input-type=module -e \
  'const r=await fetch("http://127.0.0.1:3000/policy");if(!r.ok)process.exit(1);console.log(`candidate /policy ${r.status}`)'
docker_cmd commit "$CANDIDATE" "$READY_IMAGE" >/dev/null
docker_cmd rm -f "$CANDIDATE" >/dev/null

BACKUP="${CONTAINER}-backup-${STAMP}"
if docker_cmd inspect "$CONTAINER" >/dev/null 2>&1; then
  docker_cmd stop "$CONTAINER" >/dev/null
  docker_cmd rename "$CONTAINER" "$BACKUP"
fi
if ! docker_cmd run -d --name "$CONTAINER" --restart unless-stopped -p 3000:3000 "$READY_IMAGE" >/dev/null; then
  docker_cmd rm -f "$CONTAINER" >/dev/null 2>&1 || true
  if docker_cmd inspect "$BACKUP" >/dev/null 2>&1; then
    docker_cmd rename "$BACKUP" "$CONTAINER"
    docker_cmd start "$CONTAINER" >/dev/null
  fi
  exit 1
fi

docker_cmd exec "$CONTAINER" node --input-type=module -e \
  'const r=await fetch("http://127.0.0.1:3000/policy");if(!r.ok)process.exit(1);console.log(`production /policy ${r.status}`)'
echo "policy deployment complete: ${STAMP}, branch=${BRANCH}, image=${READY_IMAGE}, backup=${BACKUP}"
