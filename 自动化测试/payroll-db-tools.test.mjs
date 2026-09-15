import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createPool, withTransaction } from '../database/payroll/pool.mjs';
import { migrate, migrationStatus } from '../database/payroll/migrate.mjs';

const execFile = promisify(execFileCallback);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const LOCK_SQL = 'SELECT pg_advisory_lock($1, $2)';
const UNLOCK_SQL = 'SELECT pg_advisory_unlock($1, $2) AS unlocked';

async function temporary(t) {
  const path = await mkdtemp(join(tmpdir(), 'payroll-db-tools-test-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

function fakePool({ history = [], failOn, rollbackError, unlock = true, connectError, releaseError } = {}) {
  const calls = [];
  let pending = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql === 'ROLLBACK' && rollbackError) throw rollbackError;
      if (failOn?.(sql, values)) throw new Error(`injected failure: ${sql}`);
      if (sql === UNLOCK_SQL) return { rows: [{ unlocked: unlock }] };
      if (sql.startsWith('SELECT to_regclass')) return { rows: [{ relation: history.length ? 'tracking' : null }] };
      if (sql.startsWith('SELECT version')) return { rows: [...history] };
      if (sql === 'BEGIN') pending = [];
      if (sql.startsWith('INSERT INTO public.payroll_schema_migrations')) pending.push({ version: values[0], checksum: values[1], applied_at: '2026-01-01T00:00:00Z' });
      if (sql === 'COMMIT') { history.push(...pending); pending = []; }
      if (sql === 'ROLLBACK') pending = [];
      return { rows: [] };
    },
    release(error) { calls.push({ release: true, error }); if (releaseError) throw releaseError; },
  };
  return {
    calls, history, client,
    async connect() { calls.push({ connect: true }); if (connectError) throw connectError; return client; },
    async query() { throw new Error('pool.query must never be used for a transaction or advisory lock'); },
  };
}

async function migrationFiles(t, files) {
  const directory = await temporary(t);
  for (const [name, sql] of Object.entries(files)) await writeFile(join(directory, name), sql);
  return directory;
}

test('createPool requires explicit configuration and does not disclose malformed URL credentials', async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    assert.throws(() => createPool(), /set DATABASE_URL/);
    assert.throws(() => createPool({ connectionString: 'invalid secret-password' }), (error) => {
      assert.match(error.message, /Invalid PostgreSQL/);
      assert.doesNotMatch(error.message, /secret-password/);
      return true;
    });
    process.env.DATABASE_URL = 'postgresql://runtime:placeholder@localhost/payroll?options=-c%20timezone%3DAsia%2FShanghai';
    const pool = createPool({ max: 2 });
    assert.equal(pool.options.max, 2);
    assert.match(new URL(pool.options.connectionString).searchParams.get('options'), /-c timezone=UTC$/);
    assert.match(pool.options.options, /-c timezone=UTC$/);
    assert.equal(pool.totalCount, 0);
    assert.equal(pool.listenerCount('error'), 0, 'library must not hide pool errors');
    await pool.end();
    const override = createPool({ connectionString: 'postgresql://owner:placeholder@localhost/other' });
    assert.equal(new URL(override.options.connectionString).username, 'owner');
    await override.end();
    delete process.env.DATABASE_URL;
    const explicit = createPool({ host: 'localhost', database: 'payroll', user: 'runtime', options: '-c timezone=Europe/Berlin' });
    assert.match(explicit.options.options, /timezone=Europe\/Berlin -c timezone=UTC$/);
    await explicit.end();
  } finally { if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved; }
});

test('withTransaction pins one client, commits, returns callback value and releases', async () => {
  const pool = fakePool();
  assert.equal(await withTransaction(pool, async (client) => {
    assert.equal(client, pool.client); await client.query('work'); return 42;
  }), 42);
  assert.deepEqual(pool.calls.map((call) => call.sql ?? (call.connect ? 'connect' : 'release')), ['connect', 'BEGIN', 'work', 'COMMIT', 'release']);
});

test('DATE remains YYYY-MM-DD per pool; numeric and other/custom parsers retain their behavior without global overrides', async () => {
  const globalDateParser = pg.types.getTypeParser(1082, 'text');
  const pool = createPool({ connectionString: 'postgresql://runtime:placeholder@localhost/payroll' });
  const parsers = pool.options.types;
  assert.equal(parsers.getTypeParser(1082)('2026-09-15'), '2026-09-15');
  assert.equal(parsers.getTypeParser(1082)('infinity'), 'infinity');
  assert.equal(parsers.getTypeParser(1700)('12345678901234567890.01'), '12345678901234567890.01');
  assert.equal(parsers.getTypeParser(23)('42'), 42);
  assert.equal(parsers.getTypeParser(1184), pg.types.getTypeParser(1184));
  assert.equal(pg.types.getTypeParser(1082), globalDateParser);
  const binaryDate = Buffer.alloc(4); binaryDate.writeInt32BE(0);
  assert.equal(parsers.getTypeParser(1082, 'binary')(binaryDate), '2000-01-01');
  await pool.end();
  const custom = (value) => `custom:${value}`;
  const overridden = createPool({ connectionString: 'postgresql://runtime:placeholder@localhost/payroll', types: { getTypeParser: () => custom }, query_timeout: 1234 });
  assert.equal(overridden.options.types.getTypeParser(1082)('2026-09-15'), '2026-09-15');
  assert.equal(overridden.options.types.getTypeParser(25), custom);
  assert.equal(overridden.options.query_timeout, 1234);
  await overridden.end();
});

test('callback and commit failures roll back; rollback failures retain both errors and discard client', async () => {
  const error = new Error('callback error');
  const pool = fakePool();
  await assert.rejects(withTransaction(pool, () => { throw error; }), (actual) => actual === error);
  assert.deepEqual(pool.calls.filter((c) => c.sql).map((c) => c.sql), ['BEGIN', 'ROLLBACK']);
  assert.equal(pool.calls.at(-1).release, true);
  const commit = fakePool({ failOn: (sql) => sql === 'COMMIT' });
  await assert.rejects(withTransaction(commit, () => 1), /injected failure: COMMIT/);
  assert.equal(commit.calls.at(-2).sql, 'ROLLBACK');
  const rollbackError = new Error('rollback error');
  const broken = fakePool({ rollbackError });
  await assert.rejects(withTransaction(broken, () => { throw error; }), (actual) => {
    assert.deepEqual(actual.errors, [error, rollbackError]); return true;
  });
  assert.equal(broken.calls.at(-1).error, rollbackError);
});

test('DATE arrays preserve dates, nulls and nested arrays without overriding global or unrelated parsers', async () => {
  const globalArrayParser = pg.types.getTypeParser(1182, 'text');
  const pool = createPool({ host: 'localhost', user: 'runtime', database: 'payroll', connectionString: '' });
  const parse = pool.options.types.getTypeParser(1182);
  assert.deepEqual(parse('{2026-08-01,NULL,"2026-09-15",infinity,-infinity}'), ['2026-08-01', null, '2026-09-15', 'infinity', '-infinity']);
  assert.deepEqual(parse('{{2026-08-01,2026-08-02},{2026-09-01,NULL}}'), [['2026-08-01', '2026-08-02'], ['2026-09-01', null]]);
  assert.deepEqual(parse('{}'), []);
  assert.equal(pg.types.getTypeParser(1182, 'text'), globalArrayParser);
  assert.equal(pool.options.types.getTypeParser(1231), pg.types.getTypeParser(1231));
  const binary = Buffer.alloc(40);
  [1, 1, 1082, 3, 1, 4, 0, -1, 4, 1].forEach((value, index) => binary.writeInt32BE(value, index * 4));
  assert.deepEqual(pool.options.types.getTypeParser(1182, 'binary')(binary), ['2000-01-01', null, '2000-01-02']);
  const empty = Buffer.alloc(12); empty.writeInt32BE(1082, 8);
  assert.deepEqual(pool.options.types.getTypeParser(1182, 'binary')(empty), []);
  await pool.end();
});

test('DATE and DATE[] JSON snapshots remain identical across UTC, Shanghai and New York timezones', async () => {
  const source = `
    import { createPool } from ${JSON.stringify(new URL('../database/payroll/pool.mjs', import.meta.url).href)};
    const pool = createPool({ host: 'localhost', user: 'runtime', database: 'payroll', connectionString: '' });
    const types = pool.options.types;
    process.stdout.write(JSON.stringify({ month: types.getTypeParser(1082)('2026-08-01'), makeupDates: types.getTypeParser(1182)('{2026-08-02,2026-08-09}'), money: types.getTypeParser(1700)('10000.10') }));
    await pool.end();
  `;
  for (const timezone of ['UTC', 'Asia/Shanghai', 'America/New_York']) {
    const result = await execFile(process.execPath, ['--input-type=module', '-e', source], { env: { PATH: process.env.PATH, TZ: timezone }, timeout: 10_000 });
    assert.deepEqual(JSON.parse(result.stdout), { month: '2026-08-01', makeupDates: ['2026-08-02', '2026-08-09'], money: '10000.10' });
  }
});

test('connection, BEGIN and release failures are propagated; even falsy thrown values are not swallowed', async () => {
  const pool = fakePool({ connectError: new Error('connect failed') });
  await assert.rejects(withTransaction(pool, () => {}), /connect failed/);
  assert.equal(pool.calls.length, 1);
  const begin = fakePool({ failOn: (sql) => sql === 'BEGIN' });
  let ran = false;
  await assert.rejects(withTransaction(begin, () => { ran = true; }), /BEGIN/);
  assert.equal(ran, false);
  const cleanup = fakePool({ releaseError: new Error('release failed') });
  await assert.rejects(withTransaction(cleanup, () => {}), /release failed/);
  for (const value of [null, undefined, false, 0]) {
    let rejected = false;
    await withTransaction(fakePool(), () => { throw value; }).catch((actual) => { rejected = true; assert.equal(actual, value); });
    assert.equal(rejected, true);
  }
});

test('migrations use sorted filenames, SHA256 and one transaction per SQL while holding the session lock', async (t) => {
  const directory = await migrationFiles(t, { '002_second.sql': 'SELECT 2;', '001_first.sql': 'SELECT 1;', 'ignored.txt': 'ignore' });
  const pool = fakePool();
  assert.deepEqual(await migrate(pool, { directory }), { applied: ['001_first', '002_second'], skipped: [] });
  assert.equal(pool.calls[1].sql, LOCK_SQL);
  assert.equal(pool.calls.at(-2).sql, UNLOCK_SQL);
  assert.equal(pool.calls.at(-1).release, true);
  assert.deepEqual(pool.history.map(({ version, checksum }) => ({ version, checksum })), [
    { version: '001_first', checksum: sha256('SELECT 1;') }, { version: '002_second', checksum: sha256('SELECT 2;') },
  ]);
  const sql = pool.calls.filter((call) => call.sql).map((call) => call.sql);
  assert.equal(sql.filter((q) => q === 'BEGIN').length, 2);
  assert.equal(sql.filter((q) => q === 'COMMIT').length, 2);
  assert.deepEqual(await migrate(pool, { directory }), { applied: [], skipped: ['001_first', '002_second'] });
});

test('all historical checksums/missing files are verified before any pending migration', async (t) => {
  const directory = await migrationFiles(t, { '001_old.sql': 'changed', '002_new.sql': 'new SQL' });
  for (const history of [
    [{ version: '001_old', checksum: sha256('original') }],
    [{ version: '000_missing', checksum: sha256('missing') }],
  ]) {
    const pool = fakePool({ history });
    await assert.rejects(migrate(pool, { directory }), /checksum changed|is missing/);
    assert.equal(pool.calls.some((call) => call.sql === 'new SQL'), false);
    assert.equal(pool.calls.some((call) => call.sql === 'BEGIN'), false);
    assert.equal(pool.calls.at(-2).sql, UNLOCK_SQL);
  }
});

test('failed SQL or history insertion rolls back only the failed migration and releases the lock', async (t) => {
  const directory = await migrationFiles(t, { '001_good.sql': 'good SQL', '002_bad.sql': 'bad SQL' });
  for (const failOn of [
    (sql) => sql === 'bad SQL',
    (sql, values) => sql.startsWith('INSERT INTO') && values[0] === '002_bad',
  ]) {
    const pool = fakePool({ failOn });
    await assert.rejects(migrate(pool, { directory }), /injected failure/);
    assert.deepEqual(pool.history.map((row) => row.version), ['001_good']);
    assert.equal(pool.calls.at(-3).sql, 'ROLLBACK');
    assert.equal(pool.calls.at(-2).sql, UNLOCK_SQL);
    assert.equal(pool.calls.at(-1).release, true);
  }
});

test('migration rollback/unlock failures discard the client; missing directory still unlocks', async (t) => {
  const directory = await migrationFiles(t, { '001.sql': 'bad SQL' });
  const broken = fakePool({ failOn: (sql) => sql === 'bad SQL', rollbackError: new Error('rollback failed') });
  await assert.rejects(migrate(broken, { directory }), AggregateError);
  assert.match(broken.calls.at(-1).error.message, /rollback failed/);
  assert.equal(broken.calls.some((c) => c.sql === UNLOCK_SQL), false);
  const unlock = fakePool({ unlock: false });
  await assert.rejects(migrate(unlock, { directory }), /lock was not held/);
  assert.ok(unlock.calls.at(-1).error);
  const missing = fakePool();
  await assert.rejects(migrate(missing, { directory: join(directory, 'missing') }), { code: 'ENOENT' });
  assert.equal(missing.calls.at(-2).sql, UNLOCK_SQL);
});

test('status reports pending and applied files without creating the tracking table, and rejects drift', async (t) => {
  const directory = await migrationFiles(t, { '001.sql': 'first', '002.sql': 'second' });
  const empty = fakePool();
  assert.deepEqual((await migrationStatus(empty, { directory })).map((row) => row.status), ['pending', 'pending']);
  assert.equal(empty.calls.some((c) => c.sql?.startsWith('CREATE')), false);
  const pool = fakePool({ history: [{ version: '001', checksum: sha256('first'), applied_at: '2026-01-01Z' }] });
  const status = await migrationStatus(pool, { directory });
  assert.deepEqual(status.map((row) => row.status), ['applied', 'pending']);
  assert.equal(status[0].applied_at, '2026-01-01Z');
  await writeFile(join(directory, '001.sql'), 'tampered');
  await assert.rejects(migrationStatus(pool, { directory }), /checksum changed/);
});

// Isolated fake pg and binaries exercise actual shell entry points. No server is
// started, no network is used, and no real environment/database credentials load.
async function scriptSandbox(t) {
  const root = await temporary(t);
  for (const relative of ['运维脚本', 'bin', 'node_modules/pg', 'database/payroll/migrations']) await mkdir(join(root, relative), { recursive: true });
  for (const relative of ['运维脚本/payroll-db-backup.sh', '运维脚本/payroll-db-restore.sh', 'database/payroll/pool.mjs', 'database/payroll/migrate.mjs']) await copyFile(join(ROOT, relative), join(root, relative));
  await writeFile(join(root, 'database/payroll/migrations/001_test.sql'), 'SELECT 1;');
  await writeFile(join(root, 'node_modules/pg/package.json'), JSON.stringify({ type: 'module', exports: './index.js' }));
  await writeFile(join(root, 'node_modules/pg/index.js'), `
import { appendFileSync } from 'node:fs';
function log(value) { appendFileSync(process.env.PG_TEST_LOG, JSON.stringify(value) + '\\n'); }
class Client {
  constructor(options) { this.options = options; this.fetched = false; }
  async connect() { log({ event: 'connect', database: this.options?.database, user: process.env.PGUSER }); }
  async query(sql, values) {
    log({ event: 'query', sql, values });
    if (sql === 'SHOW server_version_num') return { rows: [{ server_version_num: process.env.PG_TEST_SERVER_VERSION || '170006' }] };
    if (sql.includes('pg_export_snapshot')) return { rows: [{ snapshot: '00000003-000000AB-1' }] };
    if (sql.startsWith('SELECT 1 FROM pg_database')) return { rows: process.env.PG_TEST_EXISTS ? [{}] : [] };
    if (sql.startsWith('SELECT 1 FROM pg_roles')) return { rows: [{}] };
    if (sql.startsWith('CREATE DATABASE') && process.env.PG_TEST_RACE) throw new Error('duplicate database');
    if (sql.startsWith('FETCH')) {
      if (this.fetched) return { rows: [] }; this.fetched = true;
      return { rows: [{ id: 'file-1', batch_id: 'batch-1', run_id: null, kind: 'source', original_name: 'wages.xlsx', storage_profile: 'private', object_key: 'payroll/file-1', sha256: 'a'.repeat(64), byte_size: '9007199254740993', content_type: 'application/octet-stream', status: 'ready', created_at: '2026-09-15T00:00:00Z' }] };
    }
    if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] };
    return { rows: [] };
  }
  release(error) { log({ event: 'release', discard: Boolean(error) }); }
  async end() { log({ event: 'end' }); }
}
class Pool {
  constructor(options) { this.options = options; log({ event: 'pool', username: new URL(options.connectionString).username }); }
  async connect() { const c = new Client(); await c.connect(); return c; }
  async end() { log({ event: 'pool-end' }); }
}
export default { Client, Pool };
`);
  const binary = `#!${process.execPath}
const fs = require('node:fs');
const name = require('node:path').basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.PG_TEST_LOG, JSON.stringify({event:'tool',name,args,database:process.env.PGDATABASE})+'\\n');
if (args.includes('--version')) { console.log(name+' (PostgreSQL) '+(process.env.PG_TEST_CLIENT_VERSION || '17.6')); process.exit(0); }
if (process.env.PG_TEST_FAIL === name && !args.includes('--list')) { console.error('injected failure'); process.exit(7); }
if (name === 'pg_dump') process.stdout.write('PGDMP-fixture');
else if (args.includes('--list')) console.log('archive listing fixture');
`;
  for (const name of ['pg_dump', 'pg_restore']) { const file = join(root, 'bin', name); await writeFile(file, binary); await chmod(file, 0o700); }
  const env = {
    PATH: `${join(root, 'bin')}:${dirname(process.execPath)}:/usr/bin:/bin`,
    TMPDIR: root, PGHOST: '127.0.0.1', PGPORT: '5432', PGDATABASE: 'payroll', PGUSER: 'payroll_owner',
    PGPASSWORD: 'not-a-real-secret', PG_TEST_LOG: join(root, 'calls.jsonl'),
  };
  async function invoke(name, args = [], extra = {}) {
    try { return { code: 0, ...await execFile('/bin/bash', [join(root, '运维脚本', name), ...args], { env: { ...env, ...extra }, timeout: 15_000 }) }; }
    catch (error) { return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }; }
  }
  async function events() { try { return (await readFile(env.PG_TEST_LOG, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }
  async function backup(extra = {}) {
    const result = await invoke('payroll-db-backup.sh', ['--output-dir', join(root, 'backups')], extra);
    assert.equal(result.code, 0, result.stderr);
    return JSON.parse(result.stdout).backupDirectory;
  }
  return { root, env, invoke, events, backup };
}

test('backup creates private non-overwriting artifacts using one exported snapshot and reports retention without deletion', async (t) => {
  const sandbox = await scriptSandbox(t);
  const first = await sandbox.backup();
  const second = await sandbox.backup();
  assert.notEqual(first, second);
  assert.equal((await stat(first)).mode & 0o777, 0o700);
  for (const file of await readdir(first)) assert.equal((await stat(join(first, file))).mode & 0o777, 0o600);
  const manifest = JSON.parse(await readFile(join(first, 'manifest.json'), 'utf8'));
  assert.equal(manifest.dump.sha256, sha256('PGDMP-fixture'));
  assert.equal(manifest.fileMetadata.rows, 1);
  const metadata = await readFile(join(first, 'files.metadata.jsonl'), 'utf8');
  assert.equal(manifest.fileMetadata.sha256, sha256(metadata));
  assert.equal(JSON.parse(metadata).byte_size, '9007199254740993');
  const events = await sandbox.events();
  assert.equal(events.filter((e) => e.event === 'connect').length, 2);
  const snapshot = events.findIndex((e) => e.sql?.includes('pg_export_snapshot'));
  const dump = events.findIndex((e) => e.name === 'pg_dump' && e.args.includes('--format=custom'));
  const fetch = events.findIndex((e) => e.sql?.startsWith('FETCH'));
  const commit = events.findIndex((e) => e.sql === 'COMMIT');
  assert.ok(snapshot < dump && dump < fetch && fetch < commit);
  assert.ok(events[dump].args.includes('--snapshot=00000003-000000AB-1'));
  assert.ok(events.find((e) => e.sql?.startsWith('DECLARE')).sql.endsWith('FROM payroll.files ORDER BY id'));
  for (const event of events.filter((e) => e.event === 'tool')) assert.doesNotMatch(JSON.stringify(event.args), /postgres(?:ql)?:\/\/|not-a-real-secret/);
  manifest.createdAt = '2000-01-01T00:00:00Z';
  await writeFile(join(first, 'manifest.json'), JSON.stringify(manifest));
  const third = await sandbox.backup({ PAYROLL_BACKUP_RETENTION_DAYS: '1' });
  assert.ok(JSON.parse(await readFile(join(third, 'retention-candidates.json'), 'utf8')).candidates.includes(first));
  assert.ok(await stat(join(first, 'payroll.dump')));
});

test('backup failure retains private incomplete output without a complete manifest, and rolls back', async (t) => {
  const sandbox = await scriptSandbox(t);
  const result = await sandbox.invoke('payroll-db-backup.sh', ['--output-dir', join(sandbox.root, 'backups')], { PG_TEST_FAIL: 'pg_dump' });
  assert.notEqual(result.code, 0);
  assert.doesNotMatch(result.stdout + result.stderr, /not-a-real-secret/);
  const [folder] = await readdir(join(sandbox.root, 'backups'));
  await assert.rejects(stat(join(sandbox.root, 'backups', folder, 'manifest.json')), { code: 'ENOENT' });
  assert.ok((await sandbox.events()).some((e) => e.sql === 'ROLLBACK'));
});

test('restore validates hashes, creates a new explicit database, and passes only a plain target name to pg_restore', async (t) => {
  const sandbox = await scriptSandbox(t);
  const directory = await sandbox.backup();
  const result = await sandbox.invoke('payroll-db-restore.sh', ['--backup-dir', directory, '--target-db', 'payroll_restore_test', '--owner', 'payroll_owner']);
  assert.equal(result.code, 0, result.stderr);
  const events = await sandbox.events();
  const create = events.findIndex((e) => e.sql?.startsWith('CREATE DATABASE'));
  const restore = events.findIndex((e) => e.name === 'pg_restore' && e.args.includes('--exit-on-error'));
  assert.ok(create >= 0 && create < restore);
  for (const flag of ['--single-transaction', '--exit-on-error', '--no-password', '--no-owner', '--role=payroll_owner', '--dbname=payroll_restore_test']) assert.ok(events[restore].args.includes(flag));
  assert.equal(events[restore].database, 'payroll_restore_test');
  assert.doesNotMatch(JSON.stringify(events), /DROP DATABASE|--clean|postgres(?:ql)?:\/\/|not-a-real-secret/);
});

test('existing targets and concurrent name races never execute a restore or drop any database', async (t) => {
  for (const extra of [{ PG_TEST_EXISTS: '1' }, { PG_TEST_RACE: '1' }]) {
    const sandbox = await scriptSandbox(t);
    const directory = await sandbox.backup();
    const result = await sandbox.invoke('payroll-db-restore.sh', ['--backup-dir', directory, '--target-db', 'existing', '--owner', 'payroll_owner'], extra);
    assert.notEqual(result.code, 0);
    const events = await sandbox.events();
    assert.equal(events.some((e) => e.name === 'pg_restore' && e.args.includes('--exit-on-error')), false);
    assert.equal(events.some((e) => e.sql?.includes('DROP DATABASE')), false);
  }
});

test('tampered backup artifacts fail before any restore command or database creation', async (t) => {
  for (const filename of ['payroll.dump', 'files.metadata.jsonl']) {
    const sandbox = await scriptSandbox(t);
    const directory = await sandbox.backup();
    const content = await readFile(join(directory, filename));
    content[0] ^= 1;
    await writeFile(join(directory, filename), content);
    const result = await sandbox.invoke('payroll-db-restore.sh', ['--backup-dir', directory, '--target-db', 'restore_test', '--owner', 'payroll_owner']);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /checksum/);
    const events = await sandbox.events();
    assert.equal(events.some((e) => e.name === 'pg_restore' || e.sql?.startsWith('CREATE DATABASE')), false);
  }
});

test('restore failure leaves the new database in place and reports failure', async (t) => {
  const sandbox = await scriptSandbox(t);
  const directory = await sandbox.backup();
  const result = await sandbox.invoke('payroll-db-restore.sh', ['--backup-dir', directory, '--target-db', 'restore_test', '--owner', 'payroll_owner'], { PG_TEST_FAIL: 'pg_restore' });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /New target retained/);
  assert.equal((await sandbox.events()).some((e) => e.sql?.includes('DROP DATABASE')), false);
});

test('invalid arguments, URL database names and incompatible clients fail without connecting', async (t) => {
  const sandbox = await scriptSandbox(t);
  const output = join(sandbox.root, 'backups');
  for (const args of [[], ['--output-dir', output, '--retention-days', '-1'], ['--output-dir', output, '--retention-days', '1;rm']]) {
    assert.notEqual((await sandbox.invoke('payroll-db-backup.sh', args)).code, 0);
  }
  assert.notEqual((await sandbox.invoke('payroll-db-backup.sh', ['--output-dir', output], { PGDATABASE: 'postgresql://user:secret@example/payroll' })).code, 0);
  assert.notEqual((await sandbox.invoke('payroll-db-backup.sh', ['--output-dir', output], { PG_TEST_CLIENT_VERSION: '18.1' })).code, 0);
  assert.equal((await sandbox.events()).some((e) => e.event === 'connect'), false);
  assert.equal((await sandbox.invoke('payroll-db-backup.sh', ['--help'])).code, 0);
  assert.equal((await sandbox.invoke('payroll-db-restore.sh', ['--help'])).code, 0);
});

test('migration CLI prioritizes DATABASE_MIGRATION_URL and ends its pool; usage errors are safe', async (t) => {
  const sandbox = await scriptSandbox(t);
  const cli = join(sandbox.root, 'database/payroll/migrate.mjs');
  const env = { ...sandbox.env, DATABASE_URL: 'postgresql://runtime:placeholder@localhost/payroll', DATABASE_MIGRATION_URL: 'postgresql://owner:placeholder@localhost/payroll' };
  const result = await execFile(process.execPath, [cli, 'migrate'], { env });
  assert.deepEqual(JSON.parse(result.stdout), { applied: ['001_test'], skipped: [] });
  const events = await sandbox.events();
  assert.equal(events.find((e) => e.event === 'pool').username, 'owner');
  assert.equal(events.at(-1).event, 'pool-end');
  await assert.rejects(execFile(process.execPath, [cli, 'migrate', 'postgresql://secret-value'], { env }), (error) => {
    assert.match(error.stderr, /Usage:/); assert.doesNotMatch(error.stderr, /secret-value/); return true;
  });
});

test('Compose is database-only, loopback-bound and durable; example has distinct owner/runtime roles', async () => {
  const yaml = await readFile(join(ROOT, 'compose.payroll-db.yaml'), 'utf8');
  assert.match(yaml, /image: postgres:17-bookworm/);
  assert.match(yaml, /127\.0\.0\.1:\$\{PAYROLL_DB_PORT:-5432\}:5432/);
  assert.match(yaml, /payroll-db-data:\/var\/lib\/postgresql\/data/);
  assert.match(yaml, /restart: unless-stopped/);
  assert.match(yaml, /healthcheck:/);
  assert.match(yaml, /max-size: "10m"/);
  assert.match(yaml, /max-file: "3"/);
  assert.equal((yaml.match(/^  [a-z][a-z-]+:\s*$/gm) || []).length, 2);
  const example = await readFile(join(ROOT, 'database/payroll/config.env.example'), 'utf8');
  assert.match(example, /DATABASE_MIGRATION_URL=postgresql:\/\/payroll_owner:REPLACE_WITH_OWNER_SECRET/);
  assert.match(example, /DATABASE_URL=postgresql:\/\/payroll_runtime:REPLACE_WITH_RUNTIME_SECRET/);
});
