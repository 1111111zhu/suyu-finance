import { pathToFileURL } from 'node:url';
import { createPool } from '../payroll/pool.mjs';

function required(value, name) {
  if (typeof value !== 'string' || !value) throw new Error(`Set ${name}.`);
  return value;
}

function role(value, name) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value) || value === 'postgres') throw new Error(`${name} must be a dedicated lowercase PostgreSQL role name.`);
  return value;
}

function database(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('RD_DB_NAME must be a lowercase PostgreSQL database name.');
  return value;
}

async function createRestrictedRole(client, name, password) {
  const existing = await client.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=$1', [name]);
  if (existing.rowCount) throw new Error(`Role ${name} already exists; refusing to alter an existing role.`);
  // PostgreSQL quotes the identifier and password literal. They never become part
  // of a shell command or a logged SQL interpolation in this script.
  const sql = (await client.query(
    "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION', $1::text, $2::text) AS sql",
    [name, password],
  )).rows[0].sql;
  await client.query(sql);
}

/** Run once with the disposable PostgreSQL bootstrap administrator. */
export async function provisionRdRoles(pool, { databaseName, ownerRole, ownerPassword, runtimeRole, runtimePassword }) {
  const db = database(databaseName);
  const owner = role(ownerRole, 'RD_DB_OWNER_USER');
  const runtime = role(runtimeRole, 'RD_DB_RUNTIME_USER');
  if (owner === runtime) throw new Error('RD owner and runtime roles must be different.');
  required(ownerPassword, 'RD_DB_OWNER_PASSWORD');
  required(runtimePassword, 'RD_DB_RUNTIME_PASSWORD');
  const client = await pool.connect();
  try {
    await createRestrictedRole(client, owner, ownerPassword);
    await createRestrictedRole(client, runtime, runtimePassword);
    const sql = (await client.query("SELECT format('ALTER DATABASE %I OWNER TO %I', $1::text, $2::text) AS sql", [db, owner])).rows[0].sql;
    await client.query(sql);
    return { database: db, owner, runtime };
  } finally {
    client.release();
  }
}

/** Run after migrations with the schema owner. The web process only receives this role. */
export async function grantRdRuntimePrivileges(pool, { runtimeRole }) {
  const runtime = role(runtimeRole, 'RD_DB_RUNTIME_USER');
  const client = await pool.connect();
  try {
    const attributes = (await client.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=$1', [runtime])).rows[0];
    if (!attributes || attributes.rolsuper || attributes.rolcreatedb || attributes.rolcreaterole) throw new Error('Expected an existing restricted RD runtime role.');
    await client.query('BEGIN');
    await client.query(`GRANT USAGE ON SCHEMA rd TO "${runtime}"`);
    await client.query(`GRANT SELECT,INSERT,DELETE ON rd.projects,rd.ledger_entries,rd.import_requests TO "${runtime}"`);
    await client.query(`GRANT UPDATE(updated_at) ON rd.projects TO "${runtime}"`);
    await client.query('COMMIT');
    return { runtime };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* retain the original error */ }
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const action = process.argv[2];
  if (action === 'provision') {
    const pool = createPool({ connectionString: required(process.env.RD_DATABASE_ADMIN_URL, 'RD_DATABASE_ADMIN_URL'), application_name: 'rd-role-provision', max: 1 });
    try {
      const result = await provisionRdRoles(pool, {
        databaseName: required(process.env.RD_DB_NAME, 'RD_DB_NAME'),
        ownerRole: required(process.env.RD_DB_OWNER_USER, 'RD_DB_OWNER_USER'),
        ownerPassword: required(process.env.RD_DB_OWNER_PASSWORD, 'RD_DB_OWNER_PASSWORD'),
        runtimeRole: required(process.env.RD_DB_RUNTIME_USER, 'RD_DB_RUNTIME_USER'),
        runtimePassword: required(process.env.RD_DB_RUNTIME_PASSWORD, 'RD_DB_RUNTIME_PASSWORD'),
      });
      process.stdout.write(`Created restricted RD roles ${result.owner} and ${result.runtime} for ${result.database}.\n`);
    } finally { await pool.end(); }
  } else if (action === 'grant-runtime') {
    const pool = createPool({ connectionString: required(process.env.RD_DATABASE_MIGRATION_URL, 'RD_DATABASE_MIGRATION_URL'), application_name: 'rd-runtime-grants', max: 1 });
    try {
      const result = await grantRdRuntimePrivileges(pool, { runtimeRole: required(process.env.RD_DB_RUNTIME_USER, 'RD_DB_RUNTIME_USER') });
      process.stdout.write(`Granted the RD application privileges to ${result.runtime}.\n`);
    } finally { await pool.end(); }
  } else {
    throw new Error('Usage: node database/rd/provision.mjs provision|grant-runtime');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { process.stderr.write(`RD role setup failed: ${error.message}\n`); process.exitCode = 1; });
}
