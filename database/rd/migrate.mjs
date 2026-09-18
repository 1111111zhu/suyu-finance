import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createPool } from '../payroll/pool.mjs';

const DIRECTORY = fileURLToPath(new URL('./migrations/', import.meta.url));
const TRACKING_TABLE = 'public.rd_schema_migrations';
const LOCK = [0x52444649, 0x4e414e43];

async function files() {
  const entries = (await readdir(DIRECTORY, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .sort((left, right) => left.name.localeCompare(right.name));
  return Promise.all(entries.map(async (entry) => {
    const bytes = await readFile(resolve(DIRECTORY, entry.name));
    const sql = bytes.toString('utf8');
    if (!sql.trim()) throw new Error(`RD migration is empty: ${entry.name}`);
    return { version: entry.name.slice(0, -4), sql, checksum: createHash('sha256').update(bytes).digest('hex') };
  }));
}

async function withLock(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', LOCK);
    return await callback(client);
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1, $2)', LOCK); } finally { client.release(); }
  }
}

export async function migrate(pool) {
  return withLock(pool, async (client) => {
    const migrations = await files();
    await client.query(`CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const applied = new Map((await client.query(`SELECT version, checksum FROM ${TRACKING_TABLE}`)).rows.map((row) => [row.version, row.checksum]));
    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        if (applied.get(migration.version) !== migration.checksum) throw new Error(`RD migration checksum changed: ${migration.version}.sql`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(`INSERT INTO ${TRACKING_TABLE}(version, checksum) VALUES ($1, $2)`, [migration.version, migration.checksum]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return { applied: migrations.filter((migration) => !applied.has(migration.version)).map((migration) => migration.version) };
  });
}

async function main() {
  if (process.argv.slice(2).join(' ') !== 'migrate') throw new Error('Usage: node database/rd/migrate.mjs migrate');
  if (!process.env.RD_DATABASE_MIGRATION_URL) throw new Error('Set RD_DATABASE_MIGRATION_URL to the restricted migration connection.');
  const pool = createPool({ connectionString: process.env.RD_DATABASE_MIGRATION_URL, application_name: 'rd-migrations', max: 1 });
  try { process.stdout.write(`${JSON.stringify(await migrate(pool))}\n`); } finally { await pool.end(); }
}

if (process.argv[1] && new URL(`file:${resolve(process.argv[1])}`).href === import.meta.url) {
  main().catch((error) => { process.stderr.write(`RD migration failed: ${error.message}\n`); process.exitCode = 1; });
}
