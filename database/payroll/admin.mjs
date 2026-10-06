import { pathToFileURL } from 'node:url';
import { createPool } from './pool.mjs';
import { bootstrapAdmin } from './repository.mjs';

export async function provisionRuntimeRole(pool, { role, password }) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(role) || role === 'postgres') throw new Error('Use a dedicated lowercase runtime role name');
  if (typeof password !== 'string' || password.length < 20) throw new Error('Runtime database password must have at least 20 characters');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if ((await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) throw new Error('Role already exists; refusing to change its password or privileges');
    // Identifiers and literals are quoted by PostgreSQL, not concatenated from input.
    const command = (await client.query("SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', $1::text, $2::text) AS sql", [role, password])).rows[0].sql;
    await client.query(command);
    await client.query(`GRANT USAGE ON SCHEMA payroll TO "${role}"`);
    await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA payroll TO "${role}"`);
    const tables = ['companies','employees','employments','employment_changes','rule_versions','batches','batch_companies','files','imports','source_rows','runs','run_sources','items','adjustments','run_adjustments','reviews','email_drafts','audit_events','requests'];
    await client.query(`GRANT INSERT ON ${tables.map(t => 'payroll.' + t).join(',')} TO "${role}"`);
    for (const [table, columns] of Object.entries({ employments: 'left_on', batches: 'status,revision,current_run_id,stage,workdays,makeup_dates,settings,updated_at', files: 'status,sha256,byte_size', imports: 'sealed', runs: 'status,confirmed_by,confirmed_at,archived_at' })) {
      await client.query(`GRANT UPDATE(${columns}) ON payroll.${table} TO "${role}"`);
    }
    await client.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA payroll TO "${role}"`);
    await grantApiPrivileges(client,role);
    await client.query('COMMIT');
    return { role };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

/** Add only the new API grants to an existing restricted role after migrations. */
export async function grantExistingApiRole(pool,{role}) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(role)) throw new Error('Use a dedicated lowercase runtime role name');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const existing=(await client.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=$1',[role])).rows[0];
    if (!existing || existing.rolsuper || existing.rolcreatedb || existing.rolcreaterole) throw new Error('Expected an existing restricted runtime role');
    await grantApiPrivileges(client,role);
    await client.query('COMMIT');
    return {role};
  }catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}
async function grantApiPrivileges(client,role) {
  await client.query(`GRANT SELECT,INSERT ON payroll.workspaces,payroll.workspace_versions TO "${role}"`);
  await client.query(`GRANT UPDATE(name,month,revision,updated_at) ON payroll.workspaces TO "${role}"`);
  await client.query(`GRANT SELECT,INSERT,DELETE ON payroll.auth_sessions,payroll.auth_login_limits TO "${role}"`);
  await client.query(`GRANT UPDATE(failures) ON payroll.auth_login_limits TO "${role}"`);
  await client.query(`GRANT SELECT,INSERT ON payroll.wecom_directory_syncs,payroll.wecom_departments,payroll.wecom_members,
    payroll.wecom_events,payroll.wecom_employee_links,payroll.personnel_rosters,payroll.personnel_roster_rows,
    payroll.workspace_confirmations TO "${role}"`);
  await client.query(`GRANT UPDATE(synced_at,department_count,member_count) ON payroll.wecom_directory_syncs TO "${role}"`);
  await client.query(`GRANT UPDATE(name,parent_id,display_order,leader_userid,active,observed_at) ON payroll.wecom_departments TO "${role}"`);
  await client.query(`GRANT UPDATE(name,department_ids,direct_leader_userid,position,active,observed_at) ON payroll.wecom_members TO "${role}"`);
  await client.query(`GRANT UPDATE(employee_id,reason,updated_by,updated_at) ON payroll.wecom_employee_links TO "${role}"`);
  await client.query(`GRANT UPDATE(employee_id,wecom_userid,linked_by,linked_at) ON payroll.personnel_roster_rows TO "${role}"`);
}

async function main() {
  const pool = createPool({ connectionString: process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL });
  try {
    if (process.argv[2] === 'runtime-role') {
      const result = await provisionRuntimeRole(pool, { role: process.env.PAYROLL_RUNTIME_ROLE, password: process.env.PAYROLL_RUNTIME_PASSWORD });
      process.stdout.write(`Created runtime role ${result.role}; no wage-history DELETE, DDL or account-management permissions.\n`);
    } else if (process.argv[2] === 'api-grants') {
      const result=await grantExistingApiRole(pool,{role:process.env.PAYROLL_RUNTIME_ROLE});
      process.stdout.write(`Updated API grants for ${result.role}; wage history remains protected.\n`);
    } else if (process.argv[2] === 'bootstrap') {
      const result = await bootstrapAdmin(pool, { username: process.env.PAYROLL_ADMIN_USERNAME, displayName: process.env.PAYROLL_ADMIN_NAME || '工资管理员', password: process.env.PAYROLL_ADMIN_PASSWORD });
      process.stdout.write(JSON.stringify(result) + '\n');
    } else throw new Error('Usage: node database/payroll/admin.mjs bootstrap|runtime-role|api-grants');
  } finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(`Payroll setup failed (${error.code || 'configuration'}). Check the role, required environment variables and database state.\n`); process.exitCode = 1; });
