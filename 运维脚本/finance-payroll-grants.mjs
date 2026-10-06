import { createPool } from '../database/payroll/pool.mjs';
const role = process.env.PAYROLL_RUNTIME_ROLE;
if (!/^[a-z][a-z0-9_]{0,62}$/.test(role || '')) throw new Error('Invalid PAYROLL_RUNTIME_ROLE');
const pool = createPool({ connectionString: process.env.DATABASE_MIGRATION_URL });
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = (await client.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=$1', [role])).rows[0];
    if (!r || r.rolsuper || r.rolcreatedb || r.rolcreaterole) throw new Error('Expected restricted runtime role');
    await client.query(`GRANT USAGE ON SCHEMA payroll TO "${role}"`);
    await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA payroll TO "${role}"`);
    const tables = ['companies','employees','employments','employment_changes','rule_versions','batches','batch_companies','files','imports','source_rows','runs','run_sources','items','adjustments','run_adjustments','reviews','email_drafts','audit_events','requests'];
    await client.query(`GRANT INSERT ON ${tables.map(t => 'payroll.' + t).join(',')} TO "${role}"`);
    for (const [table, columns] of Object.entries({ employments: 'left_on', batches: 'status,revision,current_run_id,stage,workdays,makeup_dates,settings,updated_at', files: 'status,sha256,byte_size', imports: 'sealed', runs: 'status,confirmed_by,confirmed_at,archived_at' })) await client.query(`GRANT UPDATE(${columns}) ON payroll.${table} TO "${role}"`);
    await client.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA payroll TO "${role}"`);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
} finally { await pool.end(); }
