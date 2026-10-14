import {storeArtifact,readArtifact} from './artifact-store.mjs';
import { exportResults } from './result-exports.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { withTransaction } from '../payroll/pool.mjs';
import { confirmProjectBatch, recordProjectBatches } from './batch.mjs';
import { importAnalysisWorkbook } from './analysis-import.mjs';
import { manage as manageCatalogItem, listTrash as listCatalogTrash, lockCatalog } from './management.mjs';

const statuses = new Set(['init', 'active', 'paused', 'stopped', 'completed']);
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
  return { id: row.id, number: row.number, name: row.name, status: row.status, budget: Number(row.budget), actual: Number(row.actual ?? 0), updatedAt: new Date(row.updated_at).toISOString(), platformId:row.platform_id, annualPlatformCode:row.annual_platform_code ?? null, sourceYear:row.source_year,sourceStatus:row.source_status??null,financialEntity:row.financial_entity??null,materials:row.materials??null,parentNumber:row.parent_number??null, sourceName:row.source_name ?? null, projectManager:row.project_manager ?? null, rawStatus:row.raw_status ?? null, sourceRemark:row.source_remark ?? null, sourceRecords:row.source_records, startDate:row.start_date ?? null, endDate:row.end_date ?? null, completedAt:row.completed_at ?? null };
}
function ledger(row) {
  return { id: row.id, projectId: row.project_id, date: row.entry_date, category: row.category, amount: Number(row.amount), description: row.description, source: row.source, runId:row.run_id??null, runStatus:row.run_status??null };
}
const projectsSql = `SELECT p.*,COALESCE(SUM(l.amount),0) AS actual
  FROM rd.projects p LEFT JOIN rd.ledger_entries l ON l.project_id=p.id
    AND (l.run_id IS NULL OR EXISTS (SELECT 1 FROM rd.calculation_runs cr WHERE cr.id=l.run_id AND cr.status='confirmed'))
  WHERE p.deleted_at IS NULL GROUP BY p.id ORDER BY p.number`;

export function createRdRepository(pool) {
  async function listPlatforms() {
    return (await pool.query(`SELECT p.id,p.name,p.number,
      (SELECT count(*)::int FROM rd.projects q WHERE q.platform_id=p.id AND q.deleted_at IS NULL) AS "projectCount",
      COALESCE(project_cost.total,0)+COALESCE(platform_cost.total,0) AS actual,
      COALESCE(platform_cost.total,0) AS "platformOnlyActual"
      FROM rd.platforms p
      LEFT JOIN LATERAL (SELECT SUM(l.amount) AS total FROM rd.ledger_entries l JOIN rd.projects q ON q.id=l.project_id
        WHERE q.platform_id=p.id AND q.deleted_at IS NULL AND (l.run_id IS NULL OR EXISTS (SELECT 1 FROM rd.calculation_runs cr WHERE cr.id=l.run_id AND cr.status='confirmed'))) project_cost ON true
      LEFT JOIN LATERAL (SELECT SUM(e.amount) AS total FROM rd.platform_ledger_entries e JOIN rd.calculation_runs cr ON cr.id=e.run_id
        WHERE e.platform_id=p.id AND cr.status='confirmed') platform_cost ON true
      WHERE p.deleted_at IS NULL ORDER BY p.sort_order,p.id`)).rows.map(p=>({...p,actual:Number(p.actual),platformOnlyActual:Number(p.platformOnlyActual)}));
  }
  async function listProjects() { return (await pool.query(projectsSql)).rows.map(project); }
  async function getProject(projectId) {
    const row = (await pool.query(`SELECT p.*,COALESCE(SUM(l.amount),0) AS actual
      FROM rd.projects p LEFT JOIN rd.ledger_entries l ON l.project_id=p.id
        AND (l.run_id IS NULL OR EXISTS (SELECT 1 FROM rd.calculation_runs cr WHERE cr.id=l.run_id AND cr.status='confirmed'))
      WHERE p.id=$1 AND p.deleted_at IS NULL GROUP BY p.id`, [id(projectId, 'project id')])).rows[0];
    if (!row) fail('Project not found', 'RD_NOT_FOUND');
    return project(row);
  }
  async function listLedger(projectId) {
    await getProject(projectId);
    return (await pool.query(`SELECT l.id,l.project_id,l.entry_date::text,l.category,l.amount,l.description,l.source,l.run_id,cr.status AS run_status FROM rd.ledger_entries l
      LEFT JOIN rd.calculation_runs cr ON cr.id=l.run_id
      WHERE project_id=$1 AND (run_id IS NULL OR EXISTS (SELECT 1 FROM rd.calculation_runs cr WHERE cr.id=l.run_id AND cr.status='confirmed'))
      ORDER BY l.entry_date DESC,l.created_at DESC`, [id(projectId, 'project id')])).rows.map(ledger);
  }
  async function listProjectDocuments(projectId) {
    await getProject(projectId);
    return (await pool.query(`SELECT id,filename,mime_type,created_at FROM rd.project_documents WHERE project_id=$1 ORDER BY created_at DESC`, [id(projectId,'project id')])).rows.map(row=>({id:row.id,filename:row.filename,mimeType:row.mime_type,createdAt:new Date(row.created_at).toISOString()}));
  }
  async function getProjectDocument(projectId,documentId) {
    await getProject(projectId);
    const row=(await pool.query(`SELECT id,filename,mime_type,content,sha256 FROM rd.project_documents WHERE project_id=$1 AND id=$2`,[id(projectId,'project id'),id(documentId,'document id')])).rows[0];
    if(!row)fail('Project document not found','RD_NOT_FOUND');
    row.content=await readArtifact(pool,{kind:'project_document',objectId:row.id,...row});
    return row;
  }
  async function listMonthlyTotals() {
    return (await pool.query(`SELECT p.id AS "projectId",p.platform_id AS "platformId",to_char(l.entry_date,'YYYY-MM') AS month,
      SUM(l.amount)::text AS total FROM rd.ledger_entries l JOIN rd.projects p ON p.id=l.project_id
      WHERE l.run_id IS NULL OR EXISTS (SELECT 1 FROM rd.calculation_runs cr WHERE cr.id=l.run_id AND cr.status='confirmed')
      GROUP BY p.id,p.platform_id,to_char(l.entry_date,'YYYY-MM')
      UNION ALL
      SELECT NULL::text AS "projectId",e.platform_id AS "platformId",to_char(e.entry_date,'YYYY-MM') AS month,
      SUM(e.amount)::text AS total FROM rd.platform_ledger_entries e JOIN rd.calculation_runs cr ON cr.id=e.run_id
      WHERE cr.status='confirmed'
      GROUP BY e.platform_id,to_char(e.entry_date,'YYYY-MM')
      ORDER BY month,"platformId","projectId" NULLS LAST`)).rows.map(row=>({...row,total:Number(row.total)}));
  }
  async function listAnalysis() {
    const rows = (await pool.query(`WITH effective AS (
      SELECT to_char(l.entry_date,'YYYY-MM') AS month,
        COALESCE(cr.scope,'未标主体') AS scope,l.category,l.amount
      FROM rd.ledger_entries l LEFT JOIN rd.calculation_runs cr ON cr.id=l.run_id
      WHERE l.run_id IS NULL OR cr.status='confirmed'
      UNION ALL
      SELECT to_char(e.entry_date,'YYYY-MM') AS month,cr.scope,e.category,e.amount
      FROM rd.platform_ledger_entries e JOIN rd.calculation_runs cr ON cr.id=e.run_id
      WHERE cr.status='confirmed'
      UNION ALL
      SELECT to_char(i.period,'YYYY-MM') AS month,i.scope,d.category,d.amount
      FROM rd.analysis_imports i JOIN rd.analysis_import_lines d ON d.import_id=i.id
      WHERE i.status='active' AND NOT EXISTS (
        SELECT 1 FROM rd.calculation_runs cr
        WHERE cr.scope=i.scope AND cr.period=i.period AND cr.status='confirmed'
      )
    ) SELECT month,scope,category,SUM(amount)::text AS amount
    FROM effective GROUP BY month,scope,category ORDER BY month,scope,category`)).rows;
    return rows.map(row => ({ month:row.month, scope:row.scope, category:row.category, amount:Number(row.amount) }));
  }
  async function setProjectStatus(projectId, nextStatus) {
    const projectIdValue = id(projectId, 'project id');
    if (!statuses.has(nextStatus)) fail('Invalid project status');
    return withTransaction(pool, async client => {
      const current = (await client.query('SELECT id,status FROM rd.projects WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [projectIdValue])).rows[0];
      if (!current) fail('Project not found', 'RD_NOT_FOUND');
      if (current.status === 'completed') fail('已完成项目不能再更改状态。');
      const row = (await client.query(`UPDATE rd.projects SET status=$2,
        completed_at=CASE WHEN $2='completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
        updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`, [projectIdValue,nextStatus])).rows[0];
      return project(row);
    });
  }
  async function createProject(input) {
    const number = text(input?.number, 'number', 80).toUpperCase();
    const name = text(input?.name, 'name');
    const status = input?.status ?? 'init';
    if (!statuses.has(status)) fail('Invalid status');
    const budget = amount(input?.budget ?? 0, 'budget');
    const platformId = text(input?.platformId, 'platform id', 120);
    const startDate = input?.startDate ? date(input.startDate, 'start date') : null;
    const endDate = input?.endDate ? date(input.endDate, 'end date') : null;
    if (startDate && endDate && startDate > endDate) fail('Project start date must be before end date');
    const document = input?.document;
    if (document && (!Buffer.isBuffer(document.content) || typeof document.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(document.sha256))) fail('Invalid initiation document');
    try {
      return await withTransaction(pool, async client => {
        await lockCatalog(client);
        const validPlatform = await client.query('SELECT 1 FROM rd.platforms WHERE id=$1 AND deleted_at IS NULL', [platformId]);
        if (!validPlatform.rowCount) fail('所属平台不存在或已删除，请先恢复平台');
        const duplicateNumber = await client.query('SELECT 1 FROM rd.projects WHERE number=$1 LIMIT 1', [number]);
        if (duplicateNumber.rowCount) fail('项目编码已存在（含回收站），请核对或恢复。','RD_CONFLICT');
        const projectId = randomUUID();
        const row = (await client.query(`INSERT INTO rd.projects(id,number,name,status,budget,platform_id,start_date,end_date)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [projectId, number, name, status, budget, platformId, startDate, endDate])).rows[0];
        const documentId=randomUUID();
        if (document) await client.query(`INSERT INTO rd.project_documents(id,project_id,document_type,filename,sha256,mime_type,content,extracted_text,ocr_status)
          VALUES($1,$2,'initiation_charter',$3,$4,$5,$6,$7,$8)`, [documentId,projectId,text(document.filename,'document filename',255),document.sha256,text(document.mimeType || 'application/octet-stream','document mime type',160),document.content,String(document.extractedText || '').slice(0,100000),document.ocrStatus === 'manual' ? 'manual' : 'completed']);
        if(document) await storeArtifact(client,{kind:'project_document',objectId:documentId,...document});
        return project(row);
      });
    } catch (error) {
      if (error?.code === '23505') fail('Project number already exists', 'RD_CONFLICT');
      throw error;
    }
  }
  async function removeProject(projectId) {
    const row=(await pool.query('SELECT * FROM rd.projects WHERE id=$1',[id(projectId)])).rows[0];
    if(!row) fail('Project not found','RD_NOT_FOUND');
    const existing=project(row);
    await manageCatalogItem(pool,{kind:'project',action:'delete',id:projectId});
    return existing;
  }
  async function recordCalculation(input) {
    fail('逐项目旧版测算已停用，请使用完整批次确认入账');
  }
  async function exportData() {
    const projects = await listProjects();
    const entries = (await pool.query(`SELECT l.id,l.project_id,l.entry_date::text,l.category,l.amount,l.description,l.source,l.run_id,cr.status AS run_status
      FROM rd.ledger_entries l JOIN rd.projects p ON p.id=l.project_id LEFT JOIN rd.calculation_runs cr ON cr.id=l.run_id
      WHERE p.deleted_at IS NULL AND (l.run_id IS NULL OR cr.status='confirmed') ORDER BY l.entry_date DESC,l.created_at DESC`)).rows.map(ledger);
    const calculationRuns=(await pool.query(`SELECT id,scope,period::text,status,confirmed_at,superseded_at,superseded_by,payload FROM rd.calculation_runs ORDER BY period DESC,created_at DESC`)).rows;
    const platformLedger=(await pool.query(`SELECT e.id,e.platform_id AS "platformId",e.source_code AS "sourceCode",e.entry_date::text AS date,e.category,e.amount,e.description,e.run_id AS "runId"
      FROM rd.platform_ledger_entries e JOIN rd.calculation_runs cr ON cr.id=e.run_id WHERE cr.status='confirmed' ORDER BY e.entry_date DESC,e.created_at DESC`)).rows.map(row=>({...row,amount:Number(row.amount)}));
    return { exportedAt: new Date().toISOString(), projects, ledger: entries, platformLedger, calculationRuns };
  }
  async function importLegacy(input) {
    const requestKey = text(input?.requestKey, 'request key', 80);
    if (!/^[0-9a-f-]{36}$/i.test(requestKey)) fail('Invalid request key');
    const projects = Array.isArray(input?.projects) ? input.projects : fail('Invalid projects');
    const entries = Array.isArray(input?.ledger) ? input.ledger : fail('Invalid ledger');
    const digest = createHash('sha256').update(JSON.stringify({ projects, ledger: entries })).digest('hex');
    const normalizedProjects = projects.map((item) => ({ id: id(item?.id, 'project id'), number: text(item?.number, 'project number', 80).toUpperCase(), name: text(item?.name, 'project name'), status: statuses.has(item?.status) ? item.status : fail('Invalid project status'), budget: amount(item?.budget, 'project budget'), platformId: typeof item?.platformId==='string'&&item.platformId.trim()?item.platformId:fail('旧数据迁入必须指定有效平台','RD_MANAGEMENT'), updatedAt: item?.updatedAt ? timestamp(item.updatedAt, 'project updatedAt') : new Date().toISOString() }));
    if (new Set(normalizedProjects.map((item) => item.id)).size !== normalizedProjects.length || new Set(normalizedProjects.map((item) => item.number)).size !== normalizedProjects.length) fail('Duplicate legacy projects');
    const ids = new Set(normalizedProjects.map((item) => item.id));
    const normalizedEntries = entries.map((item) => ({ id: id(item?.id, 'ledger id'), projectId: id(item?.projectId, 'ledger project id'), date: date(item?.date), category: text(item?.category, 'ledger category', 160), amount: amount(item?.amount, 'ledger amount'), description: typeof item?.description === 'string' && item.description.length <= 1000 ? item.description : '', source: sources.has(item?.source) ? item.source : fail('Invalid ledger source') }));
    if (normalizedEntries.some((item) => !ids.has(item.projectId)) || new Set(normalizedEntries.map((item) => item.id)).size !== normalizedEntries.length) fail('Invalid legacy ledger');
    return withTransaction(pool, async (client) => {
      await lockCatalog(client);
      const previous = (await client.query('SELECT payload_hash,project_count,ledger_count FROM rd.import_requests WHERE request_key=$1', [requestKey])).rows[0];
      if (previous) {
        if (previous.payload_hash !== digest) fail('Migration request was already used with another dataset', 'RD_CONFLICT');
        return { projects: previous.project_count, ledger: previous.ledger_count, repeated: true };
      }
      for (const item of normalizedProjects) if (!(await client.query('SELECT 1 FROM rd.platforms WHERE id=$1 AND deleted_at IS NULL',[item.platformId])).rowCount) fail('旧数据迁入必须指定有效平台','RD_MANAGEMENT');
      const conflicts = await client.query('SELECT id,number FROM rd.projects WHERE id = ANY($1::text[]) OR number = ANY($2::text[])', [normalizedProjects.map((item) => item.id), normalizedProjects.map((item) => item.number)]);
      if (conflicts.rowCount) fail('Database already contains a conflicting project; legacy data was not imported', 'RD_IMPORT_CONFLICT');
      for (const item of normalizedProjects) await client.query(`INSERT INTO rd.projects(id,number,name,status,budget,updated_at,platform_id) VALUES($1,$2,$3,$4,$5,$6,$7)`, [item.id, item.number, item.name, item.status, item.budget, item.updatedAt,item.platformId]);
      for (const item of normalizedEntries) await client.query(`INSERT INTO rd.ledger_entries(id,project_id,entry_date,category,amount,description,source) VALUES($1,$2,$3,$4,$5,$6,$7)`, [item.id, item.projectId, item.date, item.category, item.amount, item.description, item.source]);
      await client.query(`INSERT INTO rd.import_requests(request_key,payload_hash,project_count,ledger_count) VALUES($1,$2,$3,$4)`, [requestKey, digest, normalizedProjects.length, normalizedEntries.length]);
      return { projects: normalizedProjects.length, ledger: normalizedEntries.length, repeated: false };
    });
  }
  async function batchSources(runId,index) {
    if(!/^[a-f0-9-]{36}$/i.test(runId))fail('Invalid run id');
    const run=(await pool.query('SELECT payload FROM rd.calculation_runs WHERE id=$1',[runId])).rows[0];
    if(!run)fail('Batch not found','RD_NOT_FOUND');
    const rows=(await pool.query("SELECT object_id,sha256,byte_size FROM rd.artifact_registry WHERE kind='source_document' AND object_id LIKE $1",[runId+':%'])).rows;
    const metadata=(run.payload.sourceFiles||[]).map((file,index)=>({index,name:file.name,sha256:file.sha256,byteSize:Number(file.byteSize),archived:rows.some(row=>row.object_id===runId+':'+index&&row.sha256===file.sha256)}));
    if(index===undefined)return {runId,files:metadata,legacyHashOnly:!metadata.length&&(run.payload.files||[]).length>0};
    if(!Number.isInteger(index)||index<0||!metadata[index]?.archived)fail('Source file not found','RD_NOT_FOUND');
    const file=metadata[index],content=await readArtifact(pool,{kind:'source_document',objectId:runId+':'+index,sha256:file.sha256});
    return {...file,content};
  }
  return { recordProjectBatches: inputs=>recordProjectBatches(pool,inputs), batchSources, recordProjectBatch: input=>confirmProjectBatch(pool,input), exportResults:(input,download)=>exportResults(pool,input,download), listPlatforms, listMonthlyTotals, listAnalysis, importAnalysisWorkbook: input=>importAnalysisWorkbook(pool,input), confirmProjectBatch: input=>confirmProjectBatch(pool,input), listProjects, getProject, listLedger, listProjectDocuments, getProjectDocument, createProject, setProjectStatus, removeProject, recordCalculation, exportData, importLegacy, manage: input=>manageCatalogItem(pool,input), listTrash: ()=>listCatalogTrash(pool) };
}
