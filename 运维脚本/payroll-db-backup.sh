#!/usr/bin/env bash
# PostgreSQL 17 client tools and the application's pg dependency are required.
# Connection: PGHOST, PGPORT, PGUSER, PGDATABASE, PGPASSFILE (0600); never a URL.
set +x
set -euo pipefail
umask 077
script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir/.."
exec node --input-type=module - "$@" <<'NODE'
import pg from 'pg';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const USAGE = 'Usage: bash 运维脚本/payroll-db-backup.sh --output-dir PATH [--retention-days N]\nConnection: PGHOST/PGPORT/PGUSER/PGDATABASE/PGPASSFILE; PostgreSQL 17 clients. Retention only reports candidates.';
const LOCK = [0x50415952, 0x4d494752];
const METADATA_TABLE = 'payroll.files';
const METADATA_COLUMNS = 'id,batch_id,run_id,kind,original_name,storage_profile,object_key,sha256,byte_size,content_type,status,created_at';
let output;
let client;
let connected = false;

function fail(message) { throw new Error(message); }
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log(USAGE); process.exit(0); }
  const result = { retentionDays: process.env.PAYROLL_BACKUP_RETENTION_DAYS ?? '30' };
  const seen = new Set();
  while (args.length) {
    const key = args.shift();
    if (!['--output-dir', '--retention-days'].includes(key) || seen.has(key) || !args.length) fail(USAGE);
    seen.add(key);
    result[key === '--output-dir' ? 'outputDir' : 'retentionDays'] = args.shift();
  }
  if (!result.outputDir || !/^\d{1,5}$/.test(result.retentionDays)) fail(USAGE);
  result.outputDir = resolve(result.outputDir);
  result.retentionDays = Number(result.retentionDays);
  return result;
}

async function privateJson(path, value) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
}

async function fingerprint(path) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest('hex'), bytes };
}

async function runDump(args, fd, errorFd) {
  return new Promise((accept, reject) => {
    const child = spawn('pg_dump', args, { stdio: ['ignore', fd, errorFd], env: { ...process.env, PGTZ: 'UTC' } });
    child.on('error', () => reject(new Error('Could not start pg_dump; install PostgreSQL 17 client tools.')));
    child.on('close', (code) => code === 0 ? accept() : reject(new Error('pg_dump failed; inspect the private backup diagnostics.')));
  });
}

async function checkClientVersion(errorFd) {
  const version = await new Promise((accept, reject) => {
    let output = '';
    const child = spawn('pg_dump', ['--version'], { stdio: ['ignore', 'pipe', errorFd] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', () => reject(new Error('Could not start pg_dump; install PostgreSQL 17 client tools.')));
    child.on('close', (code) => code === 0 ? accept(output) : reject(new Error('Backup could not check pg_dump version.')));
  });
  if (!/\(PostgreSQL\) 17\./.test(version)) fail('Backup requires PostgreSQL 17 pg_dump client tools.');
}

async function retentionCandidates(root, days) {
  if (days === 0) return [];
  const cutoff = Date.now() - days * 86_400_000;
  const candidates = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^payroll-\d{8}T\d{6}Z-[a-zA-Z0-9]+$/.test(entry.name)) continue;
    const directory = join(root, entry.name);
    const path = join(directory, 'manifest.json');
    let manifest;
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.size > 1024 * 1024) continue;
      manifest = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) continue;
      throw error;
    }
    if (manifest.formatVersion === 1 && manifest.status === 'complete' && manifest.schema === 'payroll'
        && Date.parse(manifest.createdAt) < cutoff) candidates.push(directory);
  }
  return candidates.sort();
}

async function main() {
  const args = parseArgs();
  if (!process.env.PGDATABASE || /[=\s]|:\/\//.test(process.env.PGDATABASE)) fail('Set PGDATABASE to a plain database name; database URLs are not accepted.');
  if (!process.env.PGHOST || !process.env.PGUSER) fail('Set PGHOST and PGUSER explicitly.');
  await mkdir(args.outputDir, { recursive: true, mode: 0o700 });
  if (!(await lstat(args.outputDir)).isDirectory()) fail('Backup output root must be a real directory, not a symlink.');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  output = await mkdtemp(join(args.outputDir, `payroll-${stamp}-`));
  await chmod(output, 0o700);
  const dump = await open(join(output, 'payroll.dump'), 'wx', 0o600);
  const metadata = await open(join(output, 'files.metadata.jsonl'), 'wx', 0o600);
  const diagnostics = await open(join(output, 'diagnostics.log'), 'wx', 0o600);
  try {
    await checkClientVersion(diagnostics.fd);
    client = new pg.Client({ application_name: 'payroll-backup', options: '-c timezone=UTC', connectionTimeoutMillis: 10_000 });
    await client.connect();
    connected = true;
    const version = Number((await client.query('SHOW server_version_num')).rows[0].server_version_num);
    if (version < 170000 || version >= 180000) fail('Backup requires a PostgreSQL 17 source server.');
    // A shared lock prevents migration changes until both artifacts are finished.
    await client.query('SELECT pg_advisory_lock_shared($1, $2)', LOCK);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    if (!/^[0-9A-Fa-f-]+$/.test(snapshot)) fail('Unexpected exported snapshot identifier.');
    await runDump(['--format=custom', '--no-password', `--snapshot=${snapshot}`], dump.fd, diagnostics.fd);
    await dump.sync();
    // The dump and metadata cursor share the same exported MVCC snapshot.
    await client.query(`DECLARE payroll_backup_files NO SCROLL CURSOR FOR SELECT ${METADATA_COLUMNS} FROM ${METADATA_TABLE} ORDER BY id`);
    let rows = 0;
    for (;;) {
      const batch = await client.query('FETCH FORWARD 1000 FROM payroll_backup_files');
      if (!batch.rows.length) break;
      for (const row of batch.rows) { await metadata.writeFile(`${JSON.stringify(row)}\n`); rows += 1; }
    }
    await metadata.sync();
    await client.query('COMMIT');
    await client.query('SELECT pg_advisory_unlock_shared($1, $2)', LOCK);
    await privateJson(join(output, 'retention-candidates.json'), {
      generatedAt: new Date().toISOString(), retentionDays: args.retentionDays,
      action: 'report-only; no files are deleted', candidates: await retentionCandidates(args.outputDir, args.retentionDays),
    });
    await privateJson(join(output, 'manifest.json'), {
      formatVersion: 1, status: 'complete', createdAt: new Date().toISOString(),
      database: process.env.PGDATABASE, schema: 'payroll', serverVersion: version,
      dump: { file: 'payroll.dump', ...await fingerprint(join(output, 'payroll.dump')) },
      fileMetadata: { file: 'files.metadata.jsonl', table: METADATA_TABLE, rows, ...await fingerprint(join(output, 'files.metadata.jsonl')) },
      note: 'File metadata only; external file/object contents must be backed up separately.',
    });
    console.log(JSON.stringify({ backupDirectory: output, status: 'complete', metadataRows: rows, retention: 'report-only' }));
  } finally {
    await Promise.all([dump.close(), metadata.close(), diagnostics.close()]);
  }
}

try { await main(); }
catch (error) {
  if (connected) {
    try { await client.query('ROLLBACK'); }
    catch { process.stderr.write('Backup rollback failed; closing its database connection.\n'); }
  }
  // Only messages created here are printable; pg errors can contain private data.
  const safe = /^(Usage:|Set PG|Backup |Could not start pg_dump|pg_dump failed|Unexpected exported)/.test(error.message) && !error.code;
  process.stderr.write(`${safe ? error.message : 'Payroll backup failed; check connection credentials, permissions and metadata schema.'}\n`);
  if (output) process.stderr.write(`Incomplete or diagnostic output retained privately at: ${output}\n`);
  process.exitCode = 1;
} finally {
  if (client) {
    try { await client.end(); }
    catch { process.stderr.write('Backup connection cleanup failed.\n'); process.exitCode = 1; }
  }
}
NODE
