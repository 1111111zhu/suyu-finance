#!/usr/bin/env python3
"""Hash-guarded incremental patch; no secret or application data is copied back."""
from pathlib import Path
import hashlib,json,re,shutil,sys
mode=sys.argv[1];root,stage,patch,backup=map(Path,sys.argv[2:])
manifest=json.loads((patch/'运维配置/payroll-workbooks-manifest.json').read_text())
files=[x['path'] for x in manifest['files']]
extra=['public/salary/index.html','package.json','package-lock.json']
# Source fingerprint ignores runtime data, generated output, logs and markers.
def fingerprint():
 result={}
 for folder in ['app','server','database','public/salary','salary-editor','自动化脚本']:
  base=root/folder
  if not base.exists():continue
  for p in base.rglob('*'):
   if not p.is_file() or p.is_symlink() or 'editor-assets' in p.parts:continue
   if p.suffix in ['.log','.xlsx','.csv','.dump']:continue
   result[str(p.relative_to(root))]=hashlib.sha256(p.read_bytes()).hexdigest()
 for n in ['package.json','package-lock.json','vite.config.ts','vite.config.mts','vinext.config.ts','tsconfig.json']:
  if (root/n).is_file():result[n]=hashlib.sha256((root/n).read_bytes()).hexdigest()
 return result
if mode=='prepare':
 for item in manifest['files']:
  n=Path(item['path'])
  if n.is_absolute() or '..' in n.parts:raise SystemExit('Unsafe patch path')
  if hashlib.sha256((patch/n).read_bytes()).hexdigest()!=item['after']:raise SystemExit('Patch hash differs: '+str(n))
  p=root/n
  actual=hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
  if actual!=item['before']:raise SystemExit('Server source differs; no files changed: '+str(n))
 (backup/'source-hashes.json').write_text(json.dumps(fingerprint(),sort_keys=True))
 for n in files:
  p=stage/n;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(patch/n,p);p.chmod(0o644)
 p=stage/'public/salary/index.html';s=p.read_text()
 for anchor,new in [('workbench-export','workbook-api'),('workbench-compute','builtin-sheets')]:
  s,count=re.subn(r'(?m)^(\s*<script src="\./'+anchor+r'\.js[^\n]+)',lambda m:'  <script src="./'+new+'.js?v=20261010-server-v1"></script>\n'+m[1],s)
  if count!=1:raise SystemExit('Salary script anchor differs')
 s=re.sub(r'(workbench-(?:import|export)\.js\?v=)[^"\']+',r'\g<1>20261010-server-v1',s);p.write_text(s)
 p=stage/'package.json';j=json.loads(p.read_text());incoming=json.loads((patch/'package.json').read_text())
 for n,v in incoming['dependencies'].items():
  if n.startswith('@univerjs/') or n=='exceljs':j['dependencies'][n]=v
 script=j.setdefault('scripts',{}).get('prebuild','')
 build='node 自动化脚本/build-payroll-editor.mjs'
 j['scripts']['prebuild']=script+' && '+build if script else build
 j['scripts']['build:payroll-editor']=build;p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
elif mode=='check':
 if fingerprint()!=json.loads((backup/'source-hashes.json').read_text()):raise SystemExit('Concurrent source changes detected; no application files changed')
elif mode=='backup':
 existing=[]
 for n in files+extra:
  p=root/n
  if p.exists():
   target=backup/'source-before'/n;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target);existing.append(n)
 (backup/'existing.json').write_text(json.dumps(existing))
elif mode=='install':
 for n in files+extra:
  p=root/n;p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(stage/n,p);p.chmod(0o644)
  parent=p.parent
  while parent!=root:
   parent.chmod(0o755);parent=parent.parent
 shutil.copytree(stage/'public/salary/editor-assets',root/'public/salary/editor-assets')
elif mode=='restore':
 existing=json.loads((backup/'existing.json').read_text())
 for n in files+extra:
  if n in existing:shutil.copy2(backup/'source-before'/n,root/n)
  elif (root/n).is_file():(root/n).unlink()
 if (root/'public/salary/editor-assets').exists():shutil.move(str(root/'public/salary/editor-assets'),str(backup/'failed-editor-assets'))
else:raise SystemExit('Unknown mode')
