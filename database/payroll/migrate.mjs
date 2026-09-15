import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPool } from './pool.mjs';

const DEFAULT_DIRECTORY = fileURLToPath(new URL('./migrations/', import.meta.url));
const LOCK = [0x50415952, 0x4d494752]; // Stable payroll / migration advisory lock.
const TABLE = 'public.payroll_schema_migrations';

async function readMigrations(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.name.endsWith('.sql')).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return Promise.all(files.map(async (entry) => {
    if (!entry.isFile()) throw new Error(`Migration must be a regular SQL file: ${entry.name}`);
    const bytes = await readFile(resolve(directory, entry.name));
    if (!bytes.toString('utf8').trim()) throw new Error(`Migration SQL is empty: ${entry.name}`);
    return {
      version: entry.name.slice(0, -4),
      checksum: createHash('sha256').update(bytes).digest('hex'),
      sql: bytes.toString('utf8'),
    };
  }));
}

function verifyHistory(files, history) {
  const byVersion = new Map(files.map((file) => [file.version, file]));
  for (const row of history) {
    const file = byVersion.get(row.version);
    if (!file) throw new Error(`Applied payroll migration is missing: ${row.version}.sql`);
    if (file.checksum !== row.checksum) throw new Error(`Applied payroll migration checksum changed: ${row.version}.sql`);
  }
}

async function locked(pool, callback) {
  const client = await pool.connect();
  let acquired = false;
  let failure;
  let failed = false;
  let discard;
  let result;
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', LOCK);
    acquired = true;
    result = await callback(client);
  } catch (error) {
    failed = true;
    failure = error;
    if (!acquired) discard = error || new Error('Migration lock acquisition failed.');
    // Also repairs an aborted transaction before unlocking this same session.
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      discard = rollbackError;
      failure = new AggregateError([error, rollbackError], 'Migration rollback failed.', { cause: error });
    }
  } finally {
    if (acquired && !discard) {
      try {
        const unlocked = await client.query('SELECT pg_advisory_unlock($1, $2) AS unlocked', LOCK);
        if (unlocked.rows[0]?.unlocked !== true) throw new Error('Payroll migration advisory lock was not held.');
      } catch (unlockError) {
        discard = unlockError;
        failure = failed
          ? new AggregateError([failure, unlockError], 'Migration unlock failed.', { cause: failure })
          : unlockError;
        failed = true;
      }
    }
    try {
      // A failed unlock/rollback must destroy the session, never return a held lock.
      client.release(discard);
    } catch (releaseError) {
      failure = failed
        ? new AggregateError([failure, releaseError], 'Migration cleanup failed.', { cause: failure })
        : releaseError;
      failed = true;
    }
  }
  if (failed) throw failure;
  return result;
}

/** Apply SQL files in filename order. Version = filename without .sql.
 * SQL files must not contain transaction control (BEGIN/COMMIT/ROLLBACK).
 * The supplied pool must use the migration owner, separate from the runtime role.
 * Returns { applied: string[], skipped: string[] }.
 */
export async function migrate(pool, { directory = DEFAULT_DIRECTORY } = {}) {
  return locked(pool, async (client) => {
    // Keep file reads and the complete validation/application cycle under the lock.
    const files = await readMigrations(directory);
    await client.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const { rows: history } = await client.query(`SELECT version, checksum, applied_at FROM ${TABLE} ORDER BY version`);
    verifyHistory(files, history);
    const applied = [];
    const seen = new Set(history.map((row) => row.version));
    for (const file of files) {
      if (seen.has(file.version)) continue;
      await client.query('BEGIN');
      await client.query(file.sql);
      await client.query(`INSERT INTO ${TABLE} (version, checksum) VALUES ($1, $2)`, [file.version, file.checksum]);
      await client.query('COMMIT');
      applied.push(file.version);
    }
    return { applied, skipped: history.map((row) => row.version) };
  });
}

/** Read applied/pending status without creating the tracking table.
 * Optional directory is also accepted for isolated tooling/tests.
 */
export async function migrationStatus(pool, { directory = DEFAULT_DIRECTORY } = {}) {
  return locked(pool, async (client) => {
    const files = await readMigrations(directory);
    const exists = await client.query('SELECT to_regclass($1) AS relation', [TABLE]);
    const history = exists.rows[0]?.relation
      ? (await client.query(`SELECT version, checksum, applied_at FROM ${TABLE} ORDER BY version`)).rows
      : [];
    verifyHistory(files, history);
    const byVersion = new Map(history.map((row) => [row.version, row]));
    return files.map((file) => ({
      version: file.version,
      checksum: file.checksum,
      applied_at: byVersion.get(file.version)?.applied_at ?? null,
      status: byVersion.has(file.version) ? 'applied' : 'pending',
    }));
  });
}

async function main() {
  const [command, ...extra] = process.argv.slice(2);
  if (!['migrate', 'status'].includes(command) || extra.length) {
    throw new Error('Usage: node database/payroll/migrate.mjs <migrate|status>');
  }
  const pool = createPool({
    connectionString: process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL,
    application_name: 'payroll-migrations',
    max: 1,
  });
  try {
    const result = command === 'migrate' ? await migrate(pool) : await migrationStatus(pool);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

if (isMain()) {
  main().catch((error) => {
    // Database diagnostics may include SQL data or credentials. The library
    // propagates the original error; the CLI emits only an actionable safe class.
    const code = /^[A-Z0-9_]{2,40}$/.test(error.code ?? '') ? ` (${error.code})` : '';
    const safe = /^(Usage:|PostgreSQL is not configured:|Invalid PostgreSQL connection configuration:|Applied payroll migration|Migration SQL is empty:|Migration must be a regular SQL file:)/.test(error.message);
    process.stderr.write(`${safe ? error.message : `Payroll migration command failed${code}; check connectivity, owner privileges and migration SQL.`}\n`);
    process.exitCode = 1;
  });
}
