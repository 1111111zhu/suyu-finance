#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export PATH=/opt/node-v22.13.0/bin:$PATH
release_sha=${1:?release SHA required}
[[ $release_sha =~ ^[a-f0-9]{40}$ ]] || exit 1
root=/opt/suyu-finance/current
archive=/tmp/suyu-payroll-other-add-${release_sha}.tar.gz
test -d "$root/dist" && test -f "$archive"
systemctl is-active --quiet suyu-finance
backup=$(mktemp -d /opt/suyu-finance/backups/payroll-other-add-20261010.XXXXXX)
mkdir "$backup/patch"
tar -xzf "$archive" -C "$backup/patch"
python3 - "$root" "$backup/patch" <<'PY'
from pathlib import Path
import hashlib,json,sys
root,patch=map(Path,sys.argv[1:])
manifest=json.loads((patch/'运维配置/payroll-other-add-manifest.json').read_text())
for item in manifest['files']:
 name=Path(item['path'])
 if name.is_absolute() or '..' in name.parts:raise SystemExit('Unsafe path')
 for base,expected in [(patch,item['after']),(root,item['before'])]:
  p=base/name
  if p.is_symlink() or not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=expected:
   raise SystemExit('Source differs; no production files changed: '+str(p))
PY
cd "$root"
tar -czf "$backup/source.tar.gz" public/salary/index.html public/salary/calculation-model.js public/salary/payroll-engine.js app/page.tsx
cp -a dist "$backup/dist"
rollback() {
 trap - ERR
 tar -xzf "$backup/source.tar.gz" -C "$root"
 if test -d dist; then mv dist "$backup/failed-dist"; fi
 cp -a "$backup/dist" dist
 systemctl restart suyu-finance || true
 echo "ROLLED_BACK backup=$backup" >&2
 exit 1
}
trap rollback ERR
umask 022
python3 - "$root" "$backup/patch" <<'PY'
from pathlib import Path
import json,re,shutil,sys
root,patch=map(Path,sys.argv[1:])
for item in json.loads((patch/'运维配置/payroll-other-add-manifest.json').read_text())['files']:
 shutil.copyfile(patch/item['path'],root/item['path'])
p=root/'app/page.tsx';s=p.read_text()
s,n=re.subn(r'(/salary/index.html\?embed=1&v=)[^&#"\']+',r'\g<1>20261010-other-add-header-v1',s)
if n!=4:raise SystemExit('Payroll navigation contract differs')
p.write_text(s)
PY
node --check public/salary/payroll-engine.js
node --check public/salary/calculation-model.js
RD_LOCAL_PREVIEW=1 NODE_OPTIONS=--max-old-space-size=1536 npm run build > "$backup/build.log" 2>&1
test -s dist/server/index.js
chown -R --reference="$backup/dist" dist
systemctl restart suyu-finance
for attempt in $(seq 1 30); do
 if curl --fail --silent http://127.0.0.1:3220/ >/dev/null && [[ $(curl --silent -o /dev/null -w '%{http_code}' http://127.0.0.1:3220/api/payroll/calculations/00000000-0000-0000-0000-000000000000) == 401 ]]; then
  python3 - "$root" "$backup/patch" <<'PY'
from pathlib import Path
import hashlib,json,sys
root,patch=map(Path,sys.argv[1:])
for item in json.loads((patch/'运维配置/payroll-other-add-manifest.json').read_text())['files']:
 for p in [root/item['path'],root/'dist/client/salary'/Path(item['path']).name]:
  if hashlib.sha256(p.read_bytes()).hexdigest()!=item['after']:raise SystemExit('Live hash differs: '+str(p))
PY
  trap - ERR
  printf '%s\n' "$release_sha" > PAYROLL_OTHER_ADD_COMMIT
  echo "PAYROLL_OTHER_ADD_DEPLOYED commit=$release_sha backup=$backup"
  exit 0
 fi
 sleep 1
done
false
