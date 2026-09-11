import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const walk = async directory => {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (['node_modules', '.git', 'test-results'].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    results.push(...(entry.isDirectory() ? await walk(file) : [file]));
  }
  return results;
};
const files = await walk(root);
const problems = [];
let links = 0;
for (const file of files) {
  if (['.js', '.mjs'].includes(path.extname(file))) {
    try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); } catch (e) { problems.push(`${path.relative(root, file)}: ${e.stderr}`); }
  }
  if (!['.html', '.css', '.md'].includes(path.extname(file))) continue;
  const text = await readFile(file, 'utf8');
  const refs = path.extname(file) === '.css' ? [...text.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)].map(m => m[1]) : path.extname(file) === '.html' ? [...text.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]) : [...text.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]);
  for (const ref of refs) {
    if (/^(https?:|mailto:|data:|#)/.test(ref)) continue;
    const target = path.resolve(path.dirname(file), ref.split('#')[0].split('?')[0]);
    try { await stat(target); links++; } catch { problems.push(`${path.relative(root, file)} → missing ${ref}`); }
  }
  if (path.extname(file) === '.html') {
    const ids = [...text.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    if (ids.length !== new Set(ids).size) problems.push(`${path.relative(root, file)}: duplicate IDs`);
  }
}
const manifest = JSON.parse(await readFile(path.join(root, 'assets/manifest.json'), 'utf8'));
for (const asset of manifest) {
  const bytes = await readFile(path.join(root, asset.path));
  if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) problems.push(`Asset integrity: ${asset.path}`);
}
const tokens = JSON.parse(await readFile(path.join(root, 'tokens/tokens.json'), 'utf8'));
const css = await readFile(path.join(root, 'tokens/tokens.css'), 'utf8');
for (const section of ['base','light','dark','mint','blue']) for (const [key, value] of Object.entries(tokens[section])) {
  if (!css.includes(`--ui-${key}: ${value};`)) problems.push(`Token needs regeneration: ${section}.${key}`);
}
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
else console.log(`PASS: ${files.length} files, ${links} local references, ${manifest.length} verified assets, JavaScript syntax and token synchronization.`);
