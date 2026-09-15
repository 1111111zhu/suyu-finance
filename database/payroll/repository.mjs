import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { withTransaction } from './pool.mjs';
import { normalizePayrollValues, payrollFields } from './fields.mjs';

const scopes = new Set(['gross', 'net_generated', 'net_uploaded']);
const fieldKeys = new Set(payrollFields.map(field => field.key));
const stableJSON = value => JSON.stringify(canonical(value));
function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
  return value;
}
const hash = value => createHash('sha256').update(stableJSON(value)).digest('hex');
const json = value => JSON.stringify(value ?? null);
function fail(message, code = 'PAYROLL_VALIDATION') { const error = new Error(message); error.code = code; throw error; }
function required(value, label) { if (typeof value !== 'string' || !value.trim()) fail(`${label} is required`); return value; }
function scope(value) { if (!scopes.has(value)) fail('Invalid payroll scope'); return value; }
function date(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(`${label} must be a valid YYYY-MM-DD date`);
  return value;
}
function list(value, label) { if (!Array.isArray(value)) fail(`${label} must be an array`); return value; }
async function one(client, text, values) {
  const row = (await client.query(text, values)).rows[0];
  if (!row) fail('Record not found', 'PAYROLL_NOT_FOUND');
  return row;
}

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) fail('Password must contain 12–1024 characters');
  const salt = randomBytes(16).toString('hex');
  const digest = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt}$${digest.toString('hex')}`;
}
export function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 1024 || typeof encoded !== 'string') return false;
  const match = /^scrypt\$32768\$8\$1\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(encoded);
  if (!match) return false;
  const digest = scryptSync(password, match[1], 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(digest, Buffer.from(match[2], 'hex'));
}

/** Privileged bootstrap only; intentionally not a public registration endpoint. */
export async function bootstrapAdmin(pool, { username, displayName, password }) {
  required(username, 'username'); required(displayName, 'displayName');
  const passwordHash = hashPassword(password);
  return withTransaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('payroll-bootstrap',0))");
    const existing = (await client.query('SELECT id, username, display_name FROM payroll.users WHERE username=$1', [username])).rows[0];
    if (existing) return { ...existing, created: false };
    if ((await client.query('SELECT 1 FROM payroll.users LIMIT 1')).rowCount) fail('An administrator already exists; use an administrator-managed account change');
    const user = await one(client, 'INSERT INTO payroll.users(username,display_name,password_hash) VALUES($1,$2,$3) RETURNING id,username,display_name', [username, displayName, passwordHash]);
    await audit(client, user.id, null, 'admin.bootstrap', 'user', user.id);
    return { ...user, created: true };
  });
}
async function audit(client, actorId, batchId, action, entityType, entityId, details = {}) {
  await client.query('INSERT INTO payroll.audit_events(actor_id,batch_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)', [actorId, batchId, action, entityType, entityId, json(details)]);
}
async function lockBatch(client, input, { draft = true } = {}) {
  const batch = await one(client, 'SELECT * FROM payroll.batches WHERE id=$1 FOR UPDATE', [input.batchId]);
  if (!Number.isInteger(input.expectedRevision) || batch.revision !== input.expectedRevision) fail('Batch changed; reload its revision before saving', 'PAYROLL_CONFLICT');
  if (draft && batch.status !== 'draft') fail('Open a revision before changing a confirmed/archived batch', 'PAYROLL_FROZEN');
  return batch;
}
async function touch(client, batchId) {
  return one(client, "UPDATE payroll.batches SET revision=revision+1,updated_at=now() WHERE id=$1 RETURNING id,revision,status,current_run_id", [batchId]);
}

/** Server-only data access. Callers must authenticate actorId before using this layer. */
export function createPayrollRepository(pool) {
  async function mutate(operation, input, body) {
    required(input.requestKey, 'requestKey'); required(input.actorId, 'actorId');
    if (input.requestKey.length > 200) fail('requestKey is too long');
    const payloadHash = hash(input);
    return withTransaction(pool, async client => {
      const actor = await one(client, 'SELECT enabled FROM payroll.users WHERE id=$1', [input.actorId]);
      if (!actor.enabled) fail('Account is disabled', 'PAYROLL_FORBIDDEN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`payroll-request:${input.requestKey}`]);
      const existing = (await client.query('SELECT * FROM payroll.requests WHERE request_key=$1', [input.requestKey])).rows[0];
      if (existing) {
        if (existing.operation !== operation || existing.actor_id !== input.actorId || existing.payload_hash !== payloadHash) fail('Request key was already used for different data', 'PAYROLL_IDEMPOTENCY_CONFLICT');
        return existing.result;
      }
      const result = await body(client);
      // JSON round-trip makes first response identical to an idempotent retry (dates included).
      const serializable = JSON.parse(JSON.stringify(result));
      await client.query('INSERT INTO payroll.requests(request_key,operation,actor_id,payload_hash,result) VALUES($1,$2,$3,$4,$5)', [input.requestKey, operation, input.actorId, payloadHash, json(serializable)]);
      return serializable;
    });
  }

  const api = {
    createCompany: input => mutate('company.create', input, async client => {
      const row = await one(client, 'INSERT INTO payroll.companies(code,name,short_name,created_by) VALUES($1,$2,$3,$4) RETURNING *', [required(input.code, 'code'), required(input.name, 'name'), input.shortName ?? input.name, input.actorId]);
      await audit(client, input.actorId, null, 'company.create', 'company', row.id); return row;
    }),
    createEmployee: input => mutate('employee.create', input, async client => {
      const row = await one(client, 'INSERT INTO payroll.employees(name,created_by) VALUES($1,$2) RETURNING *', [required(input.name, 'name'), input.actorId]);
      await audit(client, input.actorId, null, 'employee.create', 'employee', row.id); return row;
    }),
    hireEmployee: input => mutate('employment.create', input, async client => {
      const row = await one(client, 'INSERT INTO payroll.employments(employee_id,company_id,joined_on,created_by) VALUES($1,$2,$3,$4) RETURNING *', [input.employeeId, input.companyId, date(input.joinedOn, 'joinedOn'), input.actorId]);
      await insertEmploymentChange(client, input, row.id, input.joinedOn);
      await audit(client, input.actorId, null, 'employment.create', 'employment', row.id); return row;
    }),
    changeEmployment: input => mutate('employment.change', input, async client => {
      const employment = await one(client, 'SELECT * FROM payroll.employments WHERE id=$1 FOR UPDATE', [input.employmentId]);
      const effective = date(input.effectiveOn, 'effectiveOn');
      const joined = String(employment.joined_on).slice(0, 10);
      const left = employment.left_on && String(employment.left_on).slice(0, 10);
      if (effective < joined || (left && effective > left)) fail('Change is outside the employment period');
      const change = await insertEmploymentChange(client, input, employment.id, effective);
      await audit(client, input.actorId, null, 'employment.change', 'employment', employment.id, { changeId: change.id }); return change;
    }),
    endEmployment: input => mutate('employment.end', input, async client => {
      required(input.reason, 'reason');
      const row = await one(client, 'UPDATE payroll.employments SET left_on=$2 WHERE id=$1 RETURNING *', [input.employmentId, date(input.leftOn, 'leftOn')]);
      await audit(client, input.actorId, null, 'employment.end', 'employment', row.id, { leftOn: input.leftOn, reason: input.reason }); return row;
    }),
    transferEmployment: input => mutate('employment.transfer', input, async client => {
      required(input.reason, 'reason'); date(input.leftOn, 'leftOn'); date(input.joinedOn, 'joinedOn');
      if (input.joinedOn < input.leftOn) fail('Transfer start must not precede the previous employment end');
      const previous = await one(client, 'SELECT * FROM payroll.employments WHERE id=$1 FOR UPDATE', [input.employmentId]);
      if (previous.left_on) fail('Employment has ended; use hireEmployee for a confirmed rehire');
      await client.query('UPDATE payroll.employments SET left_on=$2 WHERE id=$1', [previous.id, input.leftOn]);
      const next = await one(client, 'INSERT INTO payroll.employments(employee_id,company_id,joined_on,created_by) VALUES($1,$2,$3,$4) RETURNING *', [previous.employee_id, input.companyId, input.joinedOn, input.actorId]);
      await insertEmploymentChange(client, input, next.id, input.joinedOn);
      await audit(client, input.actorId, null, 'employment.transfer', 'employment', previous.id, { newEmploymentId: next.id, leftOn: input.leftOn, joinedOn: input.joinedOn, reason: input.reason });
      return { previousEmploymentId: previous.id, employment: next };
    }),
    async findEmployeeCandidates({ name, companyId, employeeNumber, asOf }) {
      required(name, 'name'); date(asOf, 'asOf');
      const result = await pool.query(`SELECT e.id AS employee_id,e.name,h.id AS employment_id,h.company_id,h.joined_on,h.left_on,c.employee_number,c.department
        FROM payroll.employees e JOIN payroll.employments h ON h.employee_id=e.id
        LEFT JOIN LATERAL (SELECT * FROM payroll.employment_changes WHERE employment_id=h.id AND effective_on <= $4 ORDER BY effective_on DESC LIMIT 1) c ON true
        WHERE ($2::uuid IS NULL OR h.company_id=$2) AND h.joined_on <= $4 AND (h.left_on IS NULL OR h.left_on >= $4)
          AND (e.name=$1 OR ($3::text IS NOT NULL AND c.employee_number=$3)) ORDER BY e.name,h.joined_on,h.id`, [name, companyId ?? null, employeeNumber ?? null, asOf]);
      return { candidates: result.rows, requiresConfirmation: true };
    },
    createRuleVersion: input => mutate('rule.create', input, async client => {
      const row = await one(client, 'INSERT INTO payroll.rule_versions(version,effective_from,effective_to,engine_version,parameters,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [required(input.version, 'version'), date(input.effectiveFrom, 'effectiveFrom'), input.effectiveTo ? date(input.effectiveTo, 'effectiveTo') : null, required(input.engineVersion, 'engineVersion'), json(input.parameters ?? {}), input.actorId]);
      await audit(client, input.actorId, null, 'rule.create', 'rule', row.id); return row;
    }),
    createBatch: input => mutate('batch.create', input, async client => {
      date(input.month, 'month'); if (!input.month.endsWith('-01')) fail('month must be the first day of the payroll month');
      const companyIds = [...new Set(list(input.companyIds, 'companyIds'))]; if (!companyIds.length) fail('At least one company is required');
      for (const value of input.makeupDates ?? []) date(value, 'makeupDates');
      const row = await one(client, 'INSERT INTO payroll.batches(month,name,workdays,makeup_dates,settings,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [input.month, required(input.name, 'name'), input.workdays, input.makeupDates ?? [], json(input.settings ?? {}), input.actorId]);
      for (const companyId of companyIds) await client.query('INSERT INTO payroll.batch_companies(batch_id,company_id) VALUES($1,$2)', [row.id, companyId]);
      await audit(client, input.actorId, row.id, 'batch.create', 'batch', row.id); return row;
    }),
    reviseBatch: input => mutate('batch.revise', input, async client => {
      await lockBatch(client, input, { draft: false }); required(input.reason, 'reason');
      await client.query("UPDATE payroll.batches SET status='draft' WHERE id=$1", [input.batchId]);
      const row = await touch(client, input.batchId);
      await audit(client, input.actorId, input.batchId, 'batch.revise', 'batch', input.batchId, { reason: input.reason }); return row;
    }),
    updateBatchSettings: input => mutate('batch.settings', input, async client => {
      await lockBatch(client, input);
      for (const value of input.makeupDates ?? []) date(value, 'makeupDates');
      await client.query('UPDATE payroll.batches SET workdays=$2,makeup_dates=$3,settings=$4 WHERE id=$1', [input.batchId, input.workdays, input.makeupDates ?? [], json(input.settings ?? {})]);
      const row = await touch(client, input.batchId);
      await audit(client, input.actorId, input.batchId, 'batch.settings', 'batch', input.batchId); return row;
    }),
    registerFile: input => mutate('file.register', input, async client => {
      if (input.kind === 'export' && !input.runId) fail('Exports require a calculation version');
      const row = await one(client, `INSERT INTO payroll.files(batch_id,run_id,kind,original_name,storage_profile,object_key,sha256,byte_size,content_type,status,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [input.batchId, input.runId ?? null, input.kind, required(input.originalName, 'originalName'), required(input.storageProfile, 'storageProfile'), required(input.objectKey, 'objectKey'), input.sha256 ?? null, input.byteSize ?? null, input.contentType ?? null, input.status ?? 'pending', input.actorId]);
      await audit(client, input.actorId, input.batchId, 'file.register', 'file', row.id, { kind: input.kind }); return row;
    }),
    completeFile: input => mutate('file.complete', input, async client => {
      const row = await one(client, "UPDATE payroll.files SET status='ready',sha256=$2,byte_size=$3 WHERE id=$1 AND status IN ('pending','failed') RETURNING *", [input.fileId, input.sha256, input.byteSize]);
      await audit(client, input.actorId, row.batch_id, 'file.complete', 'file', row.id); return row;
    }),
    createImport: input => mutate('import.create', input, async client => {
      await lockBatch(client, input); scope(input.scope);
      const file = await one(client, 'SELECT * FROM payroll.files WHERE id=$1 AND batch_id=$2', [input.fileId, input.batchId]);
      if (file.kind !== 'source' || !['ready','missing'].includes(file.status)) fail('Import requires a ready source file or an explicitly missing legacy original');
      const rows = list(input.rows, 'rows'); if (!rows.length) fail('Import cannot be empty');
      const next = await one(client, 'SELECT COALESCE(MAX(version),0)+1 AS version FROM payroll.imports WHERE batch_id=$1 AND scope=$2 AND source_type=$3', [input.batchId, input.scope, input.sourceType]);
      const imported = await one(client, `INSERT INTO payroll.imports(batch_id,file_id,scope,source_type,version,parser_version,field_mapping,issues,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [input.batchId, input.fileId, input.scope, input.sourceType, next.version, required(input.parserVersion, 'parserVersion'), json(input.fieldMapping ?? {}), json(input.issues ?? []), input.actorId]);
      for (const row of rows) {
        const normalized = normalizePayrollValues(row.values ?? {});
        await client.query(`INSERT INTO payroll.source_rows(import_id,batch_id,sheet_name,row_number,raw_values,normalized_values,mapping_status,employee_id,employment_id,company_id,mapping_reason,issues)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [imported.id, input.batchId, required(row.sheetName, 'sheetName'), row.rowNumber, json(row.rawValues), json(normalized), row.mappingStatus ?? 'unmatched', row.employeeId ?? null, row.employmentId ?? null, row.companyId ?? null, row.mappingReason ?? null, json(row.issues ?? [])]);
      }
      await client.query('UPDATE payroll.imports SET sealed=true WHERE id=$1', [imported.id]);
      const batch = await touch(client, input.batchId);
      await audit(client, input.actorId, input.batchId, 'import.create', 'import', imported.id, { version: imported.version, rowCount: rows.length, scope: input.scope });
      return { id: imported.id, version: imported.version, rowCount: rows.length, batchRevision: batch.revision };
    }),
    createRun: input => mutate('run.create', input, async client => {
      const batch = await lockBatch(client, input); scope(input.scope);
      const imports = [...new Set(list(input.importIds, 'importIds'))];
      const items = list(input.items, 'items');
      if (!imports.length && input.scope !== 'net_generated') fail('A calculation requires source imports');
      const version = (await one(client, 'SELECT COALESCE(MAX(version),0)+1 AS version FROM payroll.runs WHERE batch_id=$1', [input.batchId])).version;
      const run = await one(client, `INSERT INTO payroll.runs(batch_id,version,scope,rule_version_id,previous_run_id,gross_run_id,input_snapshot,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [input.batchId, version, input.scope, input.ruleVersionId, input.previousRunId ?? null, input.grossRunId ?? null, json({ context: input.inputSnapshot ?? {}, month: batch.month, workdays: batch.workdays, makeupDates: batch.makeup_dates, settings: batch.settings, basisRevision: batch.revision }), input.actorId]);
      for (const importId of imports) await client.query('INSERT INTO payroll.run_sources(run_id,import_id,batch_id) VALUES($1,$2,$3)', [run.id, importId, input.batchId]);
      for (const adjustmentId of [...new Set(input.adjustmentIds ?? [])]) await client.query('INSERT INTO payroll.run_adjustments(run_id,adjustment_id,batch_id) VALUES($1,$2,$3)', [run.id, adjustmentId, input.batchId]);
      for (const item of items) {
        const values = normalizePayrollValues(item.values ?? {});
        const columns = Object.keys(values);
        const valueList = Object.values(values);
        const employment = await one(client, `SELECT h.*,e.name,c.name AS company_name,ch.employee_number,ch.department,ch.subdepartment,ch.employee_type,ch.regularization_date
          FROM payroll.employments h JOIN payroll.employees e ON e.id=h.employee_id JOIN payroll.companies c ON c.id=h.company_id
          LEFT JOIN LATERAL (SELECT * FROM payroll.employment_changes WHERE employment_id=h.id AND effective_on <= ($2::date + INTERVAL '1 month - 1 day')::date ORDER BY effective_on DESC LIMIT 1) ch ON true WHERE h.id=$1`, [item.employmentId, batch.month]);
        const snapshot = { employeeId: employment.employee_id, name: employment.name, companyId: employment.company_id, companyName: employment.company_name, employeeNumber: employment.employee_number, department: employment.department, subdepartment: employment.subdepartment, employeeType: employment.employee_type, joinedOn: employment.joined_on, leftOn: employment.left_on, regularizationDate: employment.regularization_date, sourceSnapshot: item.sourceSnapshot ?? {} };
        const parameters = [run.id, input.batchId, item.employeeId, item.employmentId, item.companyId, json(snapshot), list(item.sourceRowIds, 'sourceRowIds'), json(item.calculationDetail ?? {}), json(item.issues ?? []), ...valueList];
        // Column identifiers come exclusively from the static field contract, never raw input.
        await client.query(`INSERT INTO payroll.items(run_id,batch_id,employee_id,employment_id,company_id,employee_snapshot,source_row_ids,calculation_detail,issues${columns.length ? ',' + columns.join(',') : ''}) VALUES(${parameters.map((_, i) => '$' + (i + 1)).join(',')})`, parameters);
      }
      await client.query("UPDATE payroll.runs SET status='draft' WHERE id=$1", [run.id]);
      await client.query('UPDATE payroll.batches SET current_run_id=$2,stage=$3 WHERE id=$1', [input.batchId, run.id, input.scope]);
      const changed = await touch(client, input.batchId);
      await audit(client, input.actorId, input.batchId, 'run.create', 'run', run.id, { version, scope: input.scope, itemCount: items.length });
      return { id: run.id, version, status: 'draft', batchRevision: changed.revision };
    }),
    addAdjustment: input => mutate('adjustment.create', input, async client => {
      await lockBatch(client, input); scope(input.scope); required(input.reason, 'reason');
      if (!fieldKeys.has(input.fieldKey)) fail('Unknown adjustment field');
      normalizePayrollValues({ [input.fieldKey]: input.beforeValue }); normalizePayrollValues({ [input.fieldKey]: input.afterValue });
      const source = await one(client, 'SELECT * FROM payroll.runs WHERE id=$1 AND batch_id=$2 AND scope=$3', [input.sourceRunId, input.batchId, input.scope]);
      if (source.status === 'building') fail('Cannot adjust an incomplete run');
      await one(client, 'SELECT id FROM payroll.items WHERE run_id=$1 AND employee_id=$2 AND employment_id=$3 AND company_id=$4', [source.id, input.employeeId, input.employmentId, input.companyId]);
      if (input.reversesId) {
        const previous = await one(client, 'SELECT * FROM payroll.adjustments WHERE id=$1', [input.reversesId]);
        if (previous.batch_id !== input.batchId || previous.scope !== input.scope || previous.employment_id !== input.employmentId || previous.field_key !== input.fieldKey || previous.operation !== 'set') fail('Reversal must reference the same employee, field, batch and scope');
      }
      const row = await one(client, `INSERT INTO payroll.adjustments(batch_id,scope,employee_id,employment_id,company_id,source_run_id,field_key,before_value,after_value,reason,operation,reverses_id,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`, [input.batchId, input.scope, input.employeeId, input.employmentId, input.companyId, input.sourceRunId, input.fieldKey, json(input.beforeValue), json(input.afterValue), input.reason, input.reversesId ? 'revoke' : 'set', input.reversesId ?? null, input.actorId]);
      const batch = await touch(client, input.batchId);
      await audit(client, input.actorId, input.batchId, 'adjustment.create', 'adjustment', row.id, { field: input.fieldKey, operation: input.reversesId ? 'revoke' : 'set' });
      return { ...row, batchRevision: batch.revision };
    }),
    reviewItem: input => mutate('item.review', input, async client => {
      const item = await one(client, 'SELECT i.id,i.run_id,i.batch_id,r.status FROM payroll.items i JOIN payroll.runs r ON r.id=i.run_id WHERE i.id=$1 FOR UPDATE OF r', [input.itemId]);
      if (item.status !== 'draft') fail('Review belongs to a draft result; revise confirmed results');
      const review = await one(client, 'INSERT INTO payroll.reviews(run_id,item_id,outcome,note,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *', [item.run_id, item.id, input.outcome, input.note ?? '', input.actorId]);
      await audit(client, input.actorId, item.batch_id, 'item.review', 'review', review.id); return review;
    }),
    confirmRun: input => mutate('run.confirm', input, async client => {
      const batch = await lockBatch(client, input);
      if (batch.current_run_id !== input.runId) fail('Only the current calculation can be confirmed');
      const run = await one(client, 'SELECT * FROM payroll.runs WHERE id=$1 AND batch_id=$2 FOR UPDATE', [input.runId, input.batchId]);
      if (run.input_snapshot.basisRevision + 1 !== batch.revision) fail('Inputs or adjustments changed after calculation; create a new run', 'PAYROLL_STALE');
      await client.query("UPDATE payroll.runs SET status='confirmed',confirmed_by=$2,confirmed_at=clock_timestamp() WHERE id=$1", [run.id, input.actorId]);
      await client.query("UPDATE payroll.batches SET status='confirmed',updated_at=now() WHERE id=$1", [input.batchId]);
      await audit(client, input.actorId, input.batchId, 'run.confirm', 'run', run.id); return { id: run.id, status: 'confirmed', batchRevision: batch.revision };
    }),
    archiveBatch: input => mutate('batch.archive', input, async client => {
      const batch = await lockBatch(client, input, { draft: false });
      if (batch.status !== 'confirmed') fail('Confirm the batch before archiving');
      await client.query("UPDATE payroll.runs SET status='archived',archived_at=clock_timestamp() WHERE id=$1", [batch.current_run_id]);
      await client.query("UPDATE payroll.batches SET status='archived',updated_at=now() WHERE id=$1", [batch.id]);
      await audit(client, input.actorId, batch.id, 'batch.archive', 'batch', batch.id); return { id: batch.id, status: 'archived', batchRevision: batch.revision };
    }),
    saveEmailDraft: input => mutate('email.save', input, async client => {
      const batch = await lockBatch(client, input, { draft: false });
      const run = await one(client, "SELECT id,input_snapshot FROM payroll.runs WHERE id=$1 AND batch_id=$2 AND scope <> 'gross' AND status <> 'building'", [input.runId, input.batchId]);
      if (batch.current_run_id !== run.id) fail('Generate the email from the current net calculation');
      if (run.input_snapshot.basisRevision + 1 !== batch.revision) fail('Calculation is stale; recalculate before generating a new email', 'PAYROLL_STALE');
      const row = await one(client, `INSERT INTO payroll.email_drafts(batch_id,run_id,basis_revision,recipients,subject,generated_body,manual_body,details,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [batch.id, run.id, batch.revision, json(list(input.recipients, 'recipients')), input.subject, input.generatedBody, input.manualBody ?? null, json(input.details ?? {}), input.actorId]);
      await audit(client, input.actorId, batch.id, 'email.save', 'email_draft', row.id); return row;
    }),
    async getEmployee(id) {
      const employee = await one(pool, 'SELECT * FROM payroll.employees WHERE id=$1', [id]);
      const employments = (await pool.query('SELECT * FROM payroll.employments WHERE employee_id=$1 ORDER BY joined_on,id', [id])).rows;
      const changes = (await pool.query('SELECT c.* FROM payroll.employment_changes c JOIN payroll.employments e ON e.id=c.employment_id WHERE e.employee_id=$1 ORDER BY c.effective_on,c.id', [id])).rows;
      return { ...employee, employments: employments.map(employment => ({ ...employment, changes: changes.filter(change => change.employment_id === employment.id) })) };
    },
    getBatch: id => one(pool, 'SELECT * FROM payroll.batches WHERE id=$1', [id]),
    async listBatches({ month, companyId, employeeId, limit = 50, offset = 0 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) fail('Invalid pagination');
      return (await pool.query(`SELECT b.* FROM payroll.batches b WHERE ($1::date IS NULL OR b.month=$1)
        AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM payroll.batch_companies bc WHERE bc.batch_id=b.id AND bc.company_id=$2))
        AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM payroll.items i WHERE i.batch_id=b.id AND i.employee_id=$3))
        ORDER BY b.month DESC,b.created_at DESC,b.id LIMIT $4 OFFSET $5`, [month ?? null, companyId ?? null, employeeId ?? null, limit, offset])).rows;
    },
    async listImports(batchId, options = {}) {
      if (options.scope !== undefined) scope(options.scope);
      return (await pool.query('SELECT * FROM payroll.imports WHERE batch_id=$1 AND ($2::text IS NULL OR scope=$2) ORDER BY scope,source_type,version DESC', [batchId, options.scope ?? null])).rows;
    },
    async listAdjustments(batchId, options = {}) {
      if (options.scope !== undefined) scope(options.scope);
      return (await pool.query('SELECT * FROM payroll.adjustments WHERE batch_id=$1 AND ($2::text IS NULL OR scope=$2) ORDER BY created_at,id', [batchId, options.scope ?? null])).rows;
    },
    async listReviews(runId) {
      return (await pool.query('SELECT * FROM payroll.reviews WHERE run_id=$1 ORDER BY created_at,id', [runId])).rows;
    },
    async getImport(id) {
      const imported = await one(pool, 'SELECT * FROM payroll.imports WHERE id=$1', [id]);
      return { ...imported, rows: (await pool.query('SELECT * FROM payroll.source_rows WHERE import_id=$1 ORDER BY sheet_name,row_number', [id])).rows };
    },
    async getRun(id) {
      const run = await one(pool, 'SELECT * FROM payroll.runs WHERE id=$1', [id]);
      return { ...run, items: (await pool.query('SELECT * FROM payroll.items WHERE run_id=$1 ORDER BY company_id,employee_id,employment_id', [id])).rows,
        imports: (await pool.query('SELECT import_id FROM payroll.run_sources WHERE run_id=$1 ORDER BY import_id', [id])).rows.map(r => r.import_id),
        adjustments: (await pool.query('SELECT adjustment_id FROM payroll.run_adjustments WHERE run_id=$1 ORDER BY adjustment_id', [id])).rows.map(r => r.adjustment_id) };
    },
    async listRuns(batchId) { return (await pool.query('SELECT * FROM payroll.runs WHERE batch_id=$1 ORDER BY version DESC', [batchId])).rows; },
    async getRunSummary(runId) { return (await pool.query('SELECT * FROM payroll.run_company_totals WHERE run_id=$1 ORDER BY company_id', [runId])).rows; },
    async listFiles(batchId) { return (await pool.query('SELECT * FROM payroll.files WHERE batch_id=$1 ORDER BY created_at,id', [batchId])).rows; },
    async listEmailDrafts(batchId) { return (await pool.query('SELECT * FROM payroll.email_draft_status WHERE batch_id=$1 ORDER BY created_at,id', [batchId])).rows; },
    async getBatchHistory(batchId) { return (await pool.query('SELECT * FROM payroll.audit_events WHERE batch_id=$1 ORDER BY id', [batchId])).rows; },
  };
  return api;
}

async function insertEmploymentChange(client, input, employmentId, effectiveOn) {
  if (input.employeeNumber !== undefined && input.employeeNumber !== null && typeof input.employeeNumber !== 'string') fail('Reference employee number must be text to preserve leading zeros');
  return one(client, `INSERT INTO payroll.employment_changes(employment_id,effective_on,employee_number,department,subdepartment,employee_type,regularization_date,reason,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [employmentId, effectiveOn, input.employeeNumber ?? null, input.department ?? null, input.subdepartment ?? null, input.employeeType ?? 'regular', input.regularizationDate ? date(input.regularizationDate, 'regularizationDate') : null, input.reason ?? '首次建立任职记录', input.actorId]);
}

export const newRequestKey = () => randomUUID();
