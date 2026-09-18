import { createHash, randomUUID } from 'node:crypto';
import { withTransaction } from '../payroll/pool.mjs';

const statuses = new Set(['init', 'active', 'completed']);
const sources = new Set(['calculation', 'import', 'manual']);
const idPattern = /^[A-Za-z0-9:_-]{1,120}$/;

function fail(message, code = 'RD_VALIDATION') { throw Object.assign(new Error(message), { code }); }
function text(value, name, max = 300) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`Invalid ${name}`);
  return value.trim();
}
function amount(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 99999999999999.99) fail(`Invalid ${name}`);
  return parsed;
}
function date(value, name = 'date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) fail(`Invalid ${name}`);
  return value;
}
function id(value, name = 'id') {
  if (typeof value !== 'string' || !idPattern.test(value)) fail(`Invalid ${name}`);
  return value;
}
function timestamp(value, name = 'timestamp') {
  if (typeof value !== 'string') fail(`Invalid ${name}`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) fail(`Invalid ${name}`);
  return parsed.toISOString();
}
function project(row) {
  return { id: row.id, number: row.number, name: row.name, status: row.status, budget: Number(row.budget), actual: Number(row.actual ?? 0), updatedAt: new Date(row.updated_at).toISOString() };
}
function ledger(row) {
  return { id: row.id, projectId: row.project_id, date: row.entry_date, category: row.category, amount: Number(row.amount), description: row.description, source: row.source };
}
const projectsSql = `SELECT p.id,p.number,p.name,p.status,p.budget,p.updated_at,COALESCE(SUM(l.amount),0) AS actual
  FROM rd.projects p LEFT JOIN rd.ledger_entries l ON l.project_id=p.id
  GROUP BY p.id ORDER BY p.number`;

export function createRdRepository(pool) {
  async function listProjects() { return (await pool.query(projectsSql)).rows.map(project); }
  async function getProject(projectId) {
    const row = (await pool.query(`SELECT p.id,p.number,p.name,p.status,p.budget,p.updated_at,COALESCE(SUM(l.amount),0) AS actual
      FROM rd.projects p LEFT JOIN rd.ledger_entries l ON l.project_id=p.id
      WHERE p.id=$1 GROUP BY p.id`, [id(projectId, 'project id')])).rows[0];
    if (!row) fail('Project not found', 'RD_NOT_FOUND');
    return project(row);
  }
  async function listLedger(projectId) {
    await getProject(projectId);
    return (await pool.query(`SELECT id,project_id,entry_date::text,category,amount,description,source FROM rd.ledger_entries WHERE project_id=$1 ORDER BY entry_date DESC,created_at DESC`, [id(projectId, 'project id')])).rows.map(ledger);
  }
  async function createProject(input) {
    const number = text(input?.number, 'number', 80).toUpperCase();
    const name = text(input?.name, 'name');
    const status = input?.status ?? 'init';
    if (!statuses.has(status)) fail('Invalid status');
    const budget = amount(input?.budget, 'budget');
    try {
      const row = (await pool.query(`INSERT INTO rd.projects(id,number,name,status,budget) VALUES($1,$2,$3,$4,$5) RETURNING id,number,name,status,budget,updated_at`, [randomUUID(), number, name, status, budget])).rows[0];
      return project(row);
    } catch (error) {
      if (error?.code === '23505') fail('Project number already exists', 'RD_CONFLICT');
      throw error;
    }
  }
  async function removeProject(projectId) {
    const result = await pool.query(`DELETE FROM rd.projects WHERE id=$1 RETURNING id,number,name,status,budget,updated_at`, [id(projectId, 'project id')]);
    if (!result.rows[0]) fail('Project not found', 'RD_NOT_FOUND');
    return project(result.rows[0]);
  }
  async function recordCalculation(input) {
    const projectId = id(input?.projectId, 'project id');
    const year = Number(input?.year ?? new Date().getFullYear());
    const month = Number(input?.month);
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) fail('Invalid calculation period');
    const period = `${year}-${String(month).padStart(2, '0')}-01`;
    const categories = [['人员人工（含社保+公积金）', amount(input?.labor, 'labor')], ['运费', amount(input?.freight, 'freight')], ['其他费用', amount(input?.other, 'other')]];
    return withTransaction(pool, async (client) => {
      const exists = await client.query('SELECT id FROM rd.projects WHERE id=$1 FOR UPDATE', [projectId]);
      if (!exists.rows[0]) fail('Project not found', 'RD_NOT_FOUND');
      await client.query(`DELETE FROM rd.ledger_entries WHERE project_id=$1 AND source='calculation' AND entry_date=$2::date`, [projectId, period]);
      const additions = [];
      for (const [category, value] of categories) {
        if (!value) continue;
        const row = (await client.query(`INSERT INTO rd.ledger_entries(id,project_id,entry_date,category,amount,description,source) VALUES($1,$2,$3,$4,$5,$6,'calculation') RETURNING id,project_id,entry_date::text,category,amount,description,source`, [randomUUID(), projectId, period, category, value, '研发费用本地测算自动入账'])).rows[0];
        additions.push(ledger(row));
      }
      await client.query('UPDATE rd.projects SET updated_at=CURRENT_TIMESTAMP WHERE id=$1', [projectId]);
      return additions;
    });
  }
  async function exportData() {
    const projects = await listProjects();
    const entries = (await pool.query(`SELECT id,project_id,entry_date::text,category,amount,description,source FROM rd.ledger_entries ORDER BY entry_date DESC,created_at DESC`)).rows.map(ledger);
    return { exportedAt: new Date().toISOString(), projects, ledger: entries };
  }
  async function importLegacy(input) {
    const requestKey = text(input?.requestKey, 'request key', 80);
    if (!/^[0-9a-f-]{36}$/i.test(requestKey)) fail('Invalid request key');
    const projects = Array.isArray(input?.projects) ? input.projects : fail('Invalid projects');
    const entries = Array.isArray(input?.ledger) ? input.ledger : fail('Invalid ledger');
    const digest = createHash('sha256').update(JSON.stringify({ projects, ledger: entries })).digest('hex');
    const normalizedProjects = projects.map((item) => ({ id: id(item?.id, 'project id'), number: text(item?.number, 'project number', 80).toUpperCase(), name: text(item?.name, 'project name'), status: statuses.has(item?.status) ? item.status : fail('Invalid project status'), budget: amount(item?.budget, 'project budget'), updatedAt: item?.updatedAt ? timestamp(item.updatedAt, 'project updatedAt') : new Date().toISOString() }));
    if (new Set(normalizedProjects.map((item) => item.id)).size !== normalizedProjects.length || new Set(normalizedProjects.map((item) => item.number)).size !== normalizedProjects.length) fail('Duplicate legacy projects');
    const ids = new Set(normalizedProjects.map((item) => item.id));
    const normalizedEntries = entries.map((item) => ({ id: id(item?.id, 'ledger id'), projectId: id(item?.projectId, 'ledger project id'), date: date(item?.date), category: text(item?.category, 'ledger category', 160), amount: amount(item?.amount, 'ledger amount'), description: typeof item?.description === 'string' && item.description.length <= 1000 ? item.description : '', source: sources.has(item?.source) ? item.source : fail('Invalid ledger source') }));
    if (normalizedEntries.some((item) => !ids.has(item.projectId)) || new Set(normalizedEntries.map((item) => item.id)).size !== normalizedEntries.length) fail('Invalid legacy ledger');
    return withTransaction(pool, async (client) => {
      const previous = (await client.query('SELECT payload_hash,project_count,ledger_count FROM rd.import_requests WHERE request_key=$1', [requestKey])).rows[0];
      if (previous) {
        if (previous.payload_hash !== digest) fail('Migration request was already used with another dataset', 'RD_CONFLICT');
        return { projects: previous.project_count, ledger: previous.ledger_count, repeated: true };
      }
      const conflicts = await client.query('SELECT id,number FROM rd.projects WHERE id = ANY($1::text[]) OR number = ANY($2::text[])', [normalizedProjects.map((item) => item.id), normalizedProjects.map((item) => item.number)]);
      if (conflicts.rowCount) fail('Database already contains a conflicting project; legacy data was not imported', 'RD_IMPORT_CONFLICT');
      for (const item of normalizedProjects) await client.query(`INSERT INTO rd.projects(id,number,name,status,budget,updated_at) VALUES($1,$2,$3,$4,$5,$6)`, [item.id, item.number, item.name, item.status, item.budget, item.updatedAt]);
      for (const item of normalizedEntries) await client.query(`INSERT INTO rd.ledger_entries(id,project_id,entry_date,category,amount,description,source) VALUES($1,$2,$3,$4,$5,$6,$7)`, [item.id, item.projectId, item.date, item.category, item.amount, item.description, item.source]);
      await client.query(`INSERT INTO rd.import_requests(request_key,payload_hash,project_count,ledger_count) VALUES($1,$2,$3,$4)`, [requestKey, digest, normalizedProjects.length, normalizedEntries.length]);
      return { projects: normalizedProjects.length, ledger: normalizedEntries.length, repeated: false };
    });
  }
  return { listProjects, getProject, listLedger, createProject, removeProject, recordCalculation, exportData, importLegacy };
}
