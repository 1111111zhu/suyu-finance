#!/usr/bin/env bash
set -Eeuo pipefail

# Server entry point for the daily policy refresh.
# Usage: POLICY_APP_DIR=/srv/suyu-finance ./ops/policy-radar-server.sh
APP_DIR="${POLICY_APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BRANCH="${POLICY_BRANCH:-项目申报}"
LOCK_FILE="${POLICY_LOCK_FILE:-/tmp/suyu-policy-radar.lock}"
NPM="${NPM_BIN:-npm}"

exec 9>"$LOCK_FILE"
flock -n 9 || { echo "policy refresh already running"; exit 0; }
cd "$APP_DIR"

# The server must run exactly the checked-in branch and latest rules document.
git fetch --quiet origin "$BRANCH"
git checkout --quiet "$BRANCH"
git pull --ff-only --quiet origin "$BRANCH"

"$NPM" ci --ignore-scripts
"$NPM" run test:policy
"$NPM" run sync:policies
"$NPM" run check:policy-integrity
"$NPM" run build

echo "policy refresh complete: $(date -u +%FT%TZ), rules=$(node --input-type=module -e 'import fs from "node:fs"; console.log(JSON.parse(fs.readFileSync("public/policies.json")).rulesVersion)')"
