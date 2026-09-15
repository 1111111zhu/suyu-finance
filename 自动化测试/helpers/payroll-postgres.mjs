import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPool } from '../../database/payroll/pool.mjs';
import { migrate } from '../../database/payroll/migrate.mjs';

/** Every caller gets a new empty test database; never migrates the supplied base. */
export async function openTestDatabase() {
  let directory, started = false, admin, pool, created = false;
  const pgBin = process.env.PG_BIN || '/opt/homebrew/opt/postgresql@17/bin';
  const name = 'payroll_test_' + randomUUID().replaceAll('-', '');
  let options;
  async function close() {
    if (pool) { await pool.end(); pool = null; }
    if (admin) {
      try { if (created) await admin.query(`DROP DATABASE "${name}"`); }
      finally { await admin.end(); admin = null; }
    }
    if (started) {
      execFileSync(join(pgBin, 'pg_ctl'), ['-D', join(directory, 'data'), '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' });
      started = false;
    }
    if (directory) { await rm(directory, { recursive: true, force: true }); directory = null; }
  }
  try {
    if (process.env.PAYROLL_TEST_DATABASE_URL) {
      const url = new URL(process.env.PAYROLL_TEST_DATABASE_URL);
      if (!/^\/payroll_test_[a-z0-9_]+$/i.test(url.pathname)) throw new Error('Use a dedicated payroll_test_* database');
      admin = createPool({ connectionString: url.toString() });
      url.pathname = '/' + name;
      options = { connectionString: url.toString() };
    } else {
      directory = await mkdtemp(join(tmpdir(), 'payroll-api-test-'));
      execFileSync(join(pgBin, 'initdb'), ['-D', join(directory, 'data'), '-A', 'trust', '-U', 'payroll_test_owner', '--no-locale', '-E', 'UTF8'], { stdio: 'pipe' });
      execFileSync(join(pgBin, 'pg_ctl'), ['-D', join(directory, 'data'), '-l', join(directory, 'postgres.log'), '-o', `-h '' -k ${directory} -p 55439`, '-w', 'start'], { stdio: 'pipe' });
      started = true;
      options = { connectionString: '', host: directory, port: 55439, database: name, user: 'payroll_test_owner' };
      admin = createPool({ ...options, database: 'postgres' });
    }
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    pool = createPool(options);
    await migrate(pool);
    return { pool, close, connectionOptions: options };
  } catch (error) {
    await close(); throw error;
  }
}
