#!/usr/bin/env bash
# Apply only the reviewed payroll patch to the existing production workspace.
set -Eeuo pipefail
umask 077
export PATH=/opt/node-v22.13.0/bin:$PATH
release_sha=${1:?release SHA required}
[[ $release_sha =~ ^[a-f0-9]{40}$ ]] || { echo INVALID_SHA >&2; exit 1; }
root=/opt/suyu-finance/current
archive=/tmp/suyu-payroll-compute-${release_sha}.tar.gz
test -d "$root/dist" && test -f "$root/package.json" && test -f "$archive"
systemctl is-active --quiet suyu-finance
backup=$(mktemp -d /opt/suyu-finance/backups/payroll-compute-20261010.XXXXXX)
mkdir "$backup/patch"
tar -xzf "$archive" -C "$backup/patch"
# No database migrations, new releases directory, login changes or service config changes.
python3 - "$root" "$backup" <<'PY'
from pathlib import Path
import hashlib,json,sys
root,backup=map(Path,sys.argv[1:]);patch=backup/'patch'
manifest=json.loads((patch/'运维配置/payroll-compute-manifest.json').read_text())
existing=[];new=[]
for item in manifest['files']:
 name=item['path'];relative=Path(name)
 if relative.is_absolute() or '..' in relative.parts:raise SystemExit('Unsafe patch path')
 src=patch/relative;dest=root/relative
 if src.is_symlink() or hashlib.sha256(src.read_bytes()).hexdigest()!=item['after']:raise SystemExit('Patch checksum failed: '+name)
 if dest.is_symlink():raise SystemExit('Destination symlink is unsupported: '+name)
 if item['before']:
  if not dest.is_file() or hashlib.sha256(dest.read_bytes()).hexdigest()!=item['before']:raise SystemExit('Production source differs; preserve it and merge before deployment: '+name)
 elif dest.exists():raise SystemExit('New patch file already exists; inspect before deployment: '+name)
 (existing if dest.exists() else new).append(name)
for name in ['app/page.tsx','package.json']:existing.append(name)
(backup/'existing-files').write_text('\n'.join(existing)+'\n')
(backup/'new-files').write_text('\n'.join(new)+'\n')
package=json.loads((root/'package.json').read_text())
if package['scripts'].get('prebuild'):raise SystemExit('Existing prebuild must be merged before deployment')
PY
cd "$root"
tar -czf "$backup/source.tar.gz" --files-from "$backup/existing-files"
cp -a dist "$backup/dist"
rollback() {
 trap - ERR
 tar -xzf "$backup/source.tar.gz" -C "$root"
 while IFS= read -r file; do [[ -n $file ]] && rm -f -- "$root/$file"; done < "$backup/new-files"
 if test -d dist; then mv dist "$backup/failed-dist"; fi
 cp -a "$backup/dist" dist
 systemctl restart suyu-finance || true
 echo "PAYROLL_ROLLED_BACK backup=$backup" >&2
 exit 1
}
trap rollback ERR
python3 - "$root" "$backup/patch" <<'PY'
from pathlib import Path
import json,re,shutil,sys
root,patch=map(Path,sys.argv[1:]);manifest=json.loads((patch/'运维配置/payroll-compute-manifest.json').read_text())
for item in manifest['files']:
 dest=root/item['path'];dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(patch/item['path'],dest)
page=root/'app/page.tsx';s=page.read_text();s,count=re.subn(r'(/salary/index.html\?embed=1&v=)[^&#"\']+',r'\g<1>20261010-server-compute-v1',s)
if count!=4:raise SystemExit('Expected four payroll navigation URLs; preserve the existing login page')
page.write_text(s)
p=root/'package.json';package=json.loads(p.read_text());package['scripts']['prebuild']='node 自动化脚本/build-payroll-worker-model.mjs';p.write_text(json.dumps(package,ensure_ascii=False,indent=2)+'\n')
PY
node --test 自动化测试/payroll-computation.test.mjs 自动化测试/payroll-computation-api.test.mjs
RD_LOCAL_PREVIEW=1 NODE_OPTIONS=--max-old-space-size=1536 npm run build > "$backup/build.log" 2>&1
test -s dist/server/index.js
systemctl restart suyu-finance
for attempt in $(seq 1 30); do
 if curl --fail --silent http://127.0.0.1:3220/ >/dev/null && [[ $(curl --silent -o /dev/null -w '%{http_code}' http://127.0.0.1:3220/api/payroll/calculations/00000000-0000-0000-0000-000000000000) == 401 ]]; then
  trap - ERR
  printf '%s\n' "$release_sha" > PAYROLL_COMPUTE_COMMIT
  echo "PAYROLL_DEPLOYED commit=$release_sha backup=$backup"
  exit 0
 fi
 sleep 1
done
false
