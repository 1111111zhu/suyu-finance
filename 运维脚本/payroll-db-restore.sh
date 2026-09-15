#!/usr/bin/env bash
# Always creates a NEW database. An unsuccessful restore is retained for review;
# no database is dropped, cleaned or automatically retried.
# PGUSER must have CREATEDB and permission to SET ROLE to --owner. Provision all
# roles referenced by the dump's grants first; do not restore as payroll_runtime.
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
import { chmod, lstat, mkdtemp, open, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const USAGE = 'Usage: bash 运维脚本/payroll-db-restore.sh --backup-dir PATH --target-db NEW_NAME --owner ROLE [--maintenance-db postgres]\nConnection: PGHOST/PGPORT/PGUSER/PGPASSFILE; target name and owner must be explicit. Existing databases are never overwritten.';
let client;
let created = false;
let target;
let logDirectory;
function fail(message) { throw new Error(message); }

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log(USAGE); process.exit(0); }
  const values = { '--maintenance-db': 'postgres' };
  const seen = new Set();
  while (args.length) {
    const key = args.shift();
    if (!['--backup-dir', '--target-db', '--owner', '--maintenance-db'].includes(key) || seen.has(key) || !args.length) fail(USAGE);
    seen.add(key); values[key] = args.shift();
  }
  if (!values['--backup-dir'] || !values['--target-db'] || !values['--owner']) fail(USAGE);
  for (const key of ['--target-db', '--owner', '--maintenance-db']) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(values[key])) fail('Restore names must be lowercase SQL identifiers, at most 63 characters.');
  }
  if (['postgres', 'template0', 'template1', values['--maintenance-db']].includes(values['--target-db'])) fail('Restore target must be a new, non-maintenance database.');
  return values;
}

async function checkArtifact(directory, info, filename) {
  if (info?.file !== filename || !/^[a-f0-9]{64}$/.test(info.sha256) || !Number.isSafeInteger(info.bytes) || info.bytes < 0) fail('Backup manifest is invalid.');
  const path = join(directory, filename);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size !== info.bytes) fail('Backup artifact is missing, not a regular file, or has changed size.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest('hex') !== info.sha256) fail('Backup artifact checksum does not match its manifest.');
  return path;
}

function runRestore(args, env, fd) {
  return new Promise((accept, reject) => {
    const child = spawn('pg_restore', args, { stdio: ['ignore', fd, fd], env });
    child.on('error', () => reject(new Error('Could not start pg_restore; install PostgreSQL 17 client tools.')));
    child.on('close', (code) => code === 0 ? accept() : reject(new Error('pg_restore failed; the new target is retained for inspection and must not be used.')));
  });
}

async function checkClientVersion(errorFd) {
  const version = await new Promise((accept, reject) => {
    let output = '';
    const child = spawn('pg_restore', ['--version'], { stdio: ['ignore', 'pipe', errorFd] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', () => reject(new Error('Could not start pg_restore; install PostgreSQL 17 client tools.')));
    child.on('close', (code) => code === 0 ? accept(output) : reject(new Error('Restore could not check pg_restore version.')));
  });
  if (!/\(PostgreSQL\) 17\./.test(version)) fail('Restore requires PostgreSQL 17 pg_restore client tools.');
}

async function main() {
  const args = parseArgs();
  target = args['--target-db'];
  if (!process.env.PGHOST || !process.env.PGUSER) fail('Set PGHOST and PGUSER explicitly.');
  const directory = resolve(args['--backup-dir']);
  if (!(await lstat(directory)).isDirectory()) fail('Backup directory must be a real directory, not a symlink.');
  const manifestPath = join(directory, 'manifest.json');
  const stat = await lstat(manifestPath);
  if (!stat.isFile() || stat.size > 1024 * 1024) fail('Backup manifest must be a regular file under 1 MiB.');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.formatVersion !== 1 || manifest.status !== 'complete' || manifest.schema !== 'payroll') fail('Backup manifest is not a completed payroll backup.');
  if (manifest.database === target) fail('Restore target must differ from the source database name.');
  const dumpPath = await checkArtifact(directory, manifest.dump, 'payroll.dump');
  await checkArtifact(directory, manifest.fileMetadata, 'files.metadata.jsonl');

  logDirectory = await mkdtemp(join(tmpdir(), 'payroll-restore-'));
  await chmod(logDirectory, 0o700);
  const diagnostics = await open(join(logDirectory, 'diagnostics.log'), 'wx', 0o600);
  try {
    await checkClientVersion(diagnostics.fd);
    // Validate archive readability before creating any database.
    await runRestore(['--list', dumpPath], { ...process.env, PGDATABASE: args['--maintenance-db'], PGTZ: 'UTC' }, diagnostics.fd);
    client = new pg.Client({ database: args['--maintenance-db'], application_name: 'payroll-restore', options: '-c timezone=UTC', connectionTimeoutMillis: 10_000 });
    await client.connect();
    const version = Number((await client.query('SHOW server_version_num')).rows[0].server_version_num);
    if (version < 170000 || version >= 180000) fail('Restore requires a PostgreSQL 17 target server.');
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [target]);
    if (exists.rows.length) fail('Restore refused: target database already exists. Choose a new name.');
    const owner = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [args['--owner']]);
    if (!owner.rows.length) fail('Restore owner role does not exist; provision the migration owner first.');
    // CREATE DATABASE itself is the atomic final protection against name races.
    await client.query(`CREATE DATABASE "${target}" OWNER "${args['--owner']}" TEMPLATE template0 ENCODING 'UTF8'`);
    created = true;
    await client.query(`REVOKE CONNECT ON DATABASE "${target}" FROM PUBLIC`);
    await runRestore([
      '--exit-on-error', '--single-transaction', '--no-password', '--no-owner',
      `--role=${args['--owner']}`, `--dbname=${target}`, dumpPath,
    ], { ...process.env, PGDATABASE: target, PGTZ: 'UTC' }, diagnostics.fd);
    console.log(JSON.stringify({ database: target, status: 'restored', diagnostics: logDirectory,
      note: 'New database only. Verify runtime grants and external file/object backups before promotion.' }));
  } finally { await diagnostics.close(); }
}

try { await main(); }
catch (error) {
  const safe = /^(Usage:|Restore |Set PG|Backup |Could not start pg_restore|pg_restore failed)/.test(error.message) && !error.code;
  process.stderr.write(`${safe ? error.message : 'Payroll restore failed; check backup files, connectivity and database creation privileges.'}\n`);
  if (created) process.stderr.write(`New target retained; no database was dropped: ${target}\n`);
  if (logDirectory) process.stderr.write(`Private diagnostics: ${logDirectory}\n`);
  process.exitCode = 1;
} finally {
  if (client) {
    try { await client.end(); }
    catch { process.stderr.write('Restore connection cleanup failed.\n'); process.exitCode = 1; }
  }
}
NODE
