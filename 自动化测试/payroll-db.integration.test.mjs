import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from '../database/payroll/pool.mjs';
import { migrate, migrationStatus } from '../database/payroll/migrate.mjs';
import { bootstrapAdmin, createPayrollRepository, verifyPassword } from '../database/payroll/repository.mjs';
import { provisionRuntimeRole } from '../database/payroll/admin.mjs';
import { seedDemo } from '../database/payroll/demo.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let directory, pool, db, actor, pgBin, started = false;
const password = 'Only-for-isolated-payroll-tests-2026';
const req = (extra = {}) => ({ actorId: actor.id, requestKey: randomUUID(), ...extra });

before(async () => {
  if (process.env.PAYROLL_TEST_DATABASE_URL) {
    const url = new URL(process.env.PAYROLL_TEST_DATABASE_URL);
    assert.match(url.pathname, /^\/payroll_test_[a-z0-9_]+$/i, 'Use a dedicated payroll_test_* database');
    pool = createPool({ connectionString: url.toString() });
  } else {
    pgBin = process.env.PG_BIN || '/opt/homebrew/opt/postgresql@17/bin';
    directory = await mkdtemp(join(tmpdir(), 'payroll-pg-test-'));
    execFileSync(join(pgBin, 'initdb'), ['-D', join(directory, 'data'), '-A', 'trust', '-U', 'payroll_test_owner', '--no-locale', '-E', 'UTF8'], { stdio: 'pipe' });
    execFileSync(join(pgBin, 'pg_ctl'), ['-D', join(directory, 'data'), '-l', join(directory, 'postgres.log'), '-o', `-h '' -k ${directory} -p 55439`, '-w', 'start'], { stdio: 'pipe' });
    started = true;
    const admin=createPool({ connectionString:'',host: directory, port: 55439, database: 'postgres', user: 'payroll_test_owner' });
    try { await admin.query('CREATE DATABASE payroll_test_core'); } finally { await admin.end(); }
    pool = createPool({ connectionString:'',host: directory, port: 55439, database: 'payroll_test_core', user: 'payroll_test_owner' });
  }
  await migrate(pool);
  actor = await bootstrapAdmin(pool, { username: 'demo_admin', displayName: '虚拟测试管理员', password });
  db = createPayrollRepository(pool);
}, { timeout: 60_000 });
after(async () => {
  if (pool) await pool.end();
  if (started) execFileSync(join(pgBin, 'pg_ctl'), ['-D', join(directory, 'data'), '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' });
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function fixture({ unresolved = false, scope = 'gross', people = 1 } = {}) {
  const company = await db.createCompany(req({ code: randomUUID(), name: '纯虚拟测试公司', shortName: '演示' }));
  const staff = [];
  for (let i = 0; i < people; i++) {
    const person = await db.createEmployee(req({ name: '虚拟同名员工' }));
    const employment = await db.hireEmployee(req({ employeeId: person.id, companyId: company.id, joinedOn: '2026-01-01', employeeNumber: '001', department: '研发', reason: '测试建档' }));
    staff.push({ person, employment });
  }
  const rule = await db.createRuleVersion(req({ version: randomUUID(), effectiveFrom: '2026-01-01', engineVersion: 'test-fixture', parameters: { fictitious: true } }));
  const batch = await db.createBatch(req({ month: '2026-08-01', name: '虚拟八月批次', companyIds: [company.id], workdays: '21.0000' }));
  const file = await db.registerFile(req({ batchId: batch.id, kind: 'source', originalName: 'virtual.xlsx', storageProfile: 'test', objectKey: `${batch.id}/input.xlsx`, sha256: 'a'.repeat(64), byteSize: '100', status: 'ready' }));
  const rows = staff.map(({ person, employment }, i) => ({ sheetName: '测试', rowNumber: i + 2, rawValues: { 姓名: person.name, 工号: '001' }, values: { name: person.name, employeeNumber: '001', gross: '100.10' }, mappingStatus: 'matched', employeeId: person.id, employmentId: employment.id, companyId: company.id, mappingReason: '人工明确选择虚拟人员' }));
  if (unresolved) rows.push({ sheetName: '测试', rowNumber: rows.length + 2, rawValues: { 姓名: '未知同名' }, mappingStatus: 'unmatched' });
  const imported = await db.createImport(req({ batchId: batch.id, expectedRevision: batch.revision, fileId: file.id, scope, sourceType: scope === 'net_uploaded' ? 'gross_upload' : 'roster', parserVersion: 'test', rows }));
  const source = await db.getImport(imported.id);
  const runInput = { batchId: batch.id, expectedRevision: imported.batchRevision, scope, ruleVersionId: rule.id, importIds: [imported.id], items: staff.map(({ person, employment }, i) => ({ employeeId: person.id, employmentId: employment.id, companyId: company.id, sourceRowIds: [source.rows[i].id], values: { gross: '100.10', net: scope === 'gross' ? null : '90.00', social: '0.00', fund: null, companyCost: '120.10', computedGross: '100.10', grossAdjustment: '0.00' } })) };
  return { company, staff, rule, batch, file, imported, source, rows, runInput };
}
async function reviewedRun(f) {
  const run = await db.createRun(req(f.runInput));
  const result = await db.getRun(run.id);
  for (const item of result.items) await db.reviewItem(req({ itemId: item.id, outcome: 'accepted' }));
  return { ...run, items: result.items };
}

test('migrations are repeatable, versioned and contain the full expected schema', async () => {
  const second = await migrate(pool);
  assert.equal(second.applied.length, 0);
  const state = await migrationStatus(pool);
  assert.equal(state.length, (await readdir(join(root, 'database/payroll/migrations'))).filter(f => f.endsWith('.sql')).length);
  assert.ok(state.every(row => row.checksum.length === 64));
  const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='payroll'");
  assert.ok(tables.rows.length >= 20);
});
test('administrator password is hashed; bootstrap retries do not reset it', async () => {
  const stored = (await pool.query('SELECT password_hash FROM payroll.users WHERE id=$1', [actor.id])).rows[0].password_hash;
  assert.ok(verifyPassword(password, stored)); assert.ok(!verifyPassword('wrong-password', stored));
  const again = await bootstrapAdmin(pool, { username: 'demo_admin', displayName: 'ignored', password: 'a-different-long-password' });
  assert.equal(again.created, false);
  assert.equal((await pool.query('SELECT password_hash FROM payroll.users WHERE id=$1', [actor.id])).rows[0].password_hash, stored);
});
test('duplicate names and reference employee numbers are allowed; candidates require confirmation', async () => {
  const f = await fixture({ people: 2 });
  const found = await db.findEmployeeCandidates({ name: '虚拟同名员工', employeeNumber: '001', companyId: f.company.id, asOf: '2026-08-31' });
  assert.equal(found.candidates.length, 2); assert.equal(found.requiresConfirmation, true);
  assert.notEqual(f.staff[0].person.id, f.staff[1].person.id);
  assert.equal(found.candidates[0].employee_number, '001');
});
test('employment changes, leaving and rehire preserve prior salary snapshots', async () => {
  const f = await fixture(); const run = await reviewedRun(f);
  const old = await db.getRun(run.id);
  await db.changeEmployment(req({ employmentId: f.staff[0].employment.id, effectiveOn: '2026-09-01', employeeNumber: '009', department: '新部门', reason: '测试调岗' }));
  await db.endEmployment(req({ employmentId: f.staff[0].employment.id, leftOn: '2026-09-30', reason: '测试离职' }));
  const nextCompany = await db.createCompany(req({ code: randomUUID(), name: '虚拟新公司', shortName: '新公司' }));
  const rehire = await db.hireEmployee(req({ employeeId: f.staff[0].person.id, companyId: nextCompany.id, joinedOn: '2026-10-01', employeeNumber: '001', department: '市场', reason: '确认原员工复聘' }));
  assert.notEqual(rehire.id, f.staff[0].employment.id);
  const preserved = await db.getRun(run.id);
  assert.deepEqual(preserved.items, old.items);
  assert.equal(preserved.items[0].employee_snapshot.department, '研发');
  assert.equal(preserved.items[0].employee_snapshot.employeeNumber, '001');
});
test('same-month batches and multi-company batches remain independent', async () => {
  const f = await fixture(); const second = await db.createBatch(req({ month: '2026-08-01', name: '补发测试', companyIds: [f.company.id], workdays: '21' }));
  const found = await db.listBatches({ month: '2026-08-01', companyId: f.company.id });
  assert.equal(found.length, 2); assert.notEqual(f.batch.id, second.id);
});
test('company transfer is atomic, creates another employment and does not change employee identity', async () => {
  const f = await fixture();
  await assert.rejects(db.transferEmployment(req({ employmentId: f.staff[0].employment.id, companyId: randomUUID(), leftOn: '2026-08-31', joinedOn: '2026-09-01', reason: '测试失败调动' })), /foreign key/);
  assert.equal((await pool.query('SELECT left_on FROM payroll.employments WHERE id=$1',[f.staff[0].employment.id])).rows[0].left_on,null);
  const company = await db.createCompany(req({ code: randomUUID(), name: '调入虚拟公司', shortName: '调入' }));
  const transfer = await db.transferEmployment(req({ employmentId: f.staff[0].employment.id, companyId: company.id, leftOn: '2026-08-31', joinedOn: '2026-09-01', employeeNumber: null, department: '新部门', reason: '测试跨公司调动' }));
  assert.equal(transfer.employment.employee_id, f.staff[0].person.id);
  assert.notEqual(transfer.employment.id, f.staff[0].employment.id);
});
test('unresolved mappings block confirmation without changing statuses', async () => {
  const f = await fixture({ unresolved: true }); const run = await reviewedRun(f);
  await assert.rejects(db.confirmRun(req({ batchId: f.batch.id, expectedRevision: run.batchRevision, runId: run.id })), /Unresolved employee/);
  assert.equal((await db.getRun(run.id)).status, 'draft');
  assert.equal((await db.getBatch(f.batch.id)).status, 'draft');
});
test('missing mapping reasons and inconsistent employee/employment identities are rejected', async () => {
  const f = await fixture({ people: 2 });
  const input = { ...f.runInput, items: [{ ...f.runInput.items[0], employeeId: f.staff[1].person.id }] };
  await assert.rejects(db.createRun(req(input)), /Source row|foreign key/i);
  assert.equal((await db.listRuns(f.batch.id)).length, 0);
  await assert.rejects(db.createImport(req({ batchId: f.batch.id, expectedRevision: f.imported.batchRevision, fileId: f.file.id, scope: 'gross', sourceType: 'roster', parserVersion: 'test', rows: [{ ...f.rows[0], mappingReason: null }] })), /mapping_reason|check constraint/);
});
test('source replacement creates a new immutable import version; no latest-state overwrite', async () => {
  const f = await fixture();
  const next = await db.createImport(req({ batchId: f.batch.id, expectedRevision: f.imported.batchRevision, fileId: f.file.id, scope: 'gross', sourceType: 'roster', parserVersion: 'test', rows: f.rows }));
  assert.equal(next.version, 2);
  assert.deepEqual((await db.getImport(f.imported.id)).rows, f.source.rows);
  await assert.rejects(pool.query('UPDATE payroll.source_rows SET raw_values=$2 WHERE id=$1', [f.source.rows[0].id, '{}']), /append-only/);
  await assert.rejects(pool.query('UPDATE payroll.imports SET parser_version=$2 WHERE id=$1', [f.imported.id, 'changed']), /immutable/);
});
test('scope switching rejects imports and adjustments belonging to another source', async () => {
  const f = await fixture();
  await assert.rejects(db.createRun(req({ ...f.runInput, scope: 'net_uploaded' })), /scope differs/);
  assert.equal((await db.getBatch(f.batch.id)).revision, f.imported.batchRevision);
});
test('money preserves exact cents, null differs from zero and SQL summaries match detail', async () => {
  const f = await fixture({ people: 2 }); const run = await reviewedRun(f);
  const saved = await db.getRun(run.id);
  assert.equal(saved.items[0].gross, '100.10'); assert.equal(saved.items[0].social, '0.00'); assert.equal(saved.items[0].fund, null);
  const totals = await db.getRunSummary(run.id);
  assert.equal(totals[0].gross, '200.20'); assert.equal(totals[0].company_cost, '240.20'); assert.equal(totals[0].net, null);
  assert.equal(totals[0].missing_net_count, '2');
});
test('makeup dates remain calendar dates in batch reads and frozen calculation snapshots', async () => {
  const f = await fixture();
  const changed = await db.updateBatchSettings(req({ batchId: f.batch.id, expectedRevision: f.imported.batchRevision, workdays: '21', makeupDates: ['2026-08-08','2026-08-15'] }));
  const batch = await db.getBatch(f.batch.id);
  assert.deepEqual(batch.makeup_dates, ['2026-08-08','2026-08-15']);
  const run = await db.createRun(req({ ...f.runInput, expectedRevision: changed.revision }));
  assert.deepEqual((await db.getRun(run.id)).input_snapshot.makeupDates, ['2026-08-08','2026-08-15']);
});
test('confirmed salary is immutable; revision produces a new calculation', async () => {
  const f = await fixture(); const old = await reviewedRun(f);
  await db.confirmRun(req({ batchId: f.batch.id, expectedRevision: old.batchRevision, runId: old.id }));
  await db.archiveBatch(req({ batchId: f.batch.id, expectedRevision: old.batchRevision }));
  await assert.rejects(pool.query('UPDATE payroll.items SET gross=999 WHERE id=$1', [old.items[0].id]), /append-only/);
  await assert.rejects(pool.query('DELETE FROM payroll.employees WHERE id=$1', [f.staff[0].person.id]), /append-only/);
  const revision = await db.reviseBatch(req({ batchId: f.batch.id, expectedRevision: old.batchRevision, reason: '核对后修订' }));
  const fresh = await db.createRun(req({ ...f.runInput, expectedRevision: revision.revision, previousRunId: old.id, items: f.runInput.items.map(i => ({ ...i, values: { ...i.values, gross: '110.10' } })) }));
  assert.equal((await db.getRun(old.id)).status, 'archived');
  assert.equal((await db.getRun(old.id)).items[0].gross, '100.10');
  assert.equal((await db.getRun(fresh.id)).items[0].gross, '110.10');
});
test('concurrent idempotent retries create exactly one result and changed payload is rejected', async () => {
  const f = await fixture(); const request = req(f.runInput);
  const [first, second] = await Promise.all([db.createRun(request), db.createRun(request)]);
  assert.deepEqual(first, second); assert.equal((await db.listRuns(f.batch.id)).length, 1);
  await assert.rejects(db.createRun({ ...request, inputSnapshot: { changed: true } }), { code: 'PAYROLL_IDEMPOTENCY_CONFLICT' });
});
test('concurrent distinct writes at the same revision reject the stale one', async () => {
  const f = await fixture();
  const results = await Promise.allSettled([db.createRun(req(f.runInput)), db.createRun(req(f.runInput))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'PAYROLL_CONFLICT');
});
test('failure halfway through a write rolls back run, items, audit and idempotency record', async () => {
  const f = await fixture(); const request = req({ ...f.runInput, items: [...f.runInput.items, { ...f.runInput.items[0], values: { gross: '1.001' } }] });
  await assert.rejects(db.createRun(request), /precision|decimal|小数|digits/i);
  assert.equal((await db.listRuns(f.batch.id)).length, 0);
  assert.equal((await pool.query('SELECT 1 FROM payroll.requests WHERE request_key=$1', [request.requestKey])).rowCount, 0);
  assert.equal((await db.getBatchHistory(f.batch.id)).filter(r => r.action === 'run.create').length, 0);
});
test('adjustments invalidate confirmation and emails until a new calculation exists', async () => {
  const f = await fixture({ scope: 'net_uploaded' }); const run = await reviewedRun(f);
  const mail = await db.saveEmailDraft(req({ batchId: f.batch.id, expectedRevision: run.batchRevision, runId: run.id, recipients: ['demo@example.invalid'], subject: '虚拟工资说明', generatedBody: '虚拟正文', manualBody: '手工补充虚拟正文' }));
  assert.ok(mail.id); assert.equal((await db.listEmailDrafts(f.batch.id))[0].needs_regeneration, false);
  const change = await db.addAdjustment(req({ batchId: f.batch.id, expectedRevision: run.batchRevision, scope: 'net_uploaded', employeeId: f.staff[0].person.id, employmentId: f.staff[0].employment.id, companyId: f.company.id, sourceRunId: run.id, fieldKey: 'netTarget', beforeValue: '90.00', afterValue: '95.00', reason: '测试人工调整' }));
  assert.equal((await db.listEmailDrafts(f.batch.id))[0].needs_regeneration, true);
  await assert.rejects(db.confirmRun(req({ batchId: f.batch.id, expectedRevision: change.batchRevision, runId: run.id })), { code: 'PAYROLL_STALE' });
  await assert.rejects(db.saveEmailDraft(req({ batchId: f.batch.id, expectedRevision: change.batchRevision, runId: run.id, recipients: ['demo@example.invalid'], subject: '过期正文', generatedBody: '不能标为最新' })), { code: 'PAYROLL_STALE' });
});
test('caller-provided context cannot override the authoritative input snapshot', async () => {
  const f = await fixture();
  const run = await db.createRun(req({ ...f.runInput, inputSnapshot: { basisRevision: f.runInput.expectedRevision + 1, workdays: '999' } }));
  const saved = await db.getRun(run.id);
  assert.equal(saved.input_snapshot.basisRevision, f.runInput.expectedRevision);
  assert.equal(saved.input_snapshot.workdays, '21.0000');
  const modified = await db.updateBatchSettings(req({ batchId: f.batch.id, expectedRevision: run.batchRevision, workdays: '22' }));
  for (const item of saved.items) await db.reviewItem(req({ itemId: item.id, outcome: 'accepted' }));
  await assert.rejects(db.confirmRun(req({ batchId: f.batch.id, expectedRevision: modified.revision, runId: run.id })), { code: 'PAYROLL_STALE' });
});
test('a mapped primary employee cannot silently disappear from confirmed payroll', async () => {
  const f = await fixture({ people: 2 });
  f.runInput.items = f.runInput.items.slice(0, 1);
  const run = await reviewedRun(f);
  await assert.rejects(db.confirmRun(req({ batchId: f.batch.id, expectedRevision: run.batchRevision, runId: run.id })), /missing from calculation/);
});
test('incomplete imports cannot commit and ready file hashes cannot be rewritten', async () => {
  const f = await fixture();
  await assert.rejects(pool.query("INSERT INTO payroll.imports(batch_id,file_id,scope,source_type,version,parser_version,created_by) VALUES($1,$2,'gross','manual',1,'test',$3)", [f.batch.id,f.file.id,actor.id]), /sealed before commit/);
  await assert.rejects(pool.query('UPDATE payroll.files SET sha256=$2 WHERE id=$1', [f.file.id,'b'.repeat(64)]), /cannot be replaced/);
});
test('direct SQL cannot append a correction review to a confirmed result', async () => {
  const f = await fixture(); const run = await reviewedRun(f);
  await db.confirmRun(req({ batchId: f.batch.id, expectedRevision: run.batchRevision, runId: run.id }));
  await assert.rejects(pool.query("INSERT INTO payroll.reviews(run_id,item_id,outcome,created_by) VALUES($1,$2,'needs_correction',$3)", [run.id,run.items[0].id,actor.id]), /Only draft/);
});
test('generated net records the exact gross version and separates net deduction sources', async () => {
  const f = await fixture(); const gross = await reviewedRun(f);
  const net = await db.createRun(req({ ...f.runInput, expectedRevision: gross.batchRevision, scope: 'net_generated', grossRunId: gross.id, importIds: [], items: f.runInput.items.map(i => ({ ...i, values: { ...i.values, net: '90.00' } })) }));
  assert.equal((await db.getRun(net.id)).gross_run_id, gross.id);
  assert.equal((await db.getRun(gross.id)).scope, 'gross');
});
test('demo is fictitious, covers three companies and is repeatable', async () => {
  const prefix = 'integration-' + randomUUID();
  const result = await seedDemo(pool, { password, prefix, allowDemo:true });
  assert.equal(result.totals.length, 3); assert.equal(result.status, 'confirmed');
  const again = await seedDemo(pool, { password, prefix, allowDemo:true });
  assert.deepEqual(again, result);
});
test('a fresh repository restores unfinished sources, adjustments, reviews and employee history', async () => {
  const f = await fixture();
  const run = await reviewedRun(f);
  const adjustment = await db.addAdjustment(req({ batchId: f.batch.id, expectedRevision: run.batchRevision, scope: 'gross', sourceRunId: run.id, employeeId: f.staff[0].person.id, employmentId: f.staff[0].employment.id, companyId: f.company.id, fieldKey: 'gross', beforeValue: '100.10', afterValue: '110.10', reason: '尚未重算的测试修改' }));
  const fresh = createPayrollRepository(pool);
  assert.equal((await fresh.getBatch(f.batch.id)).revision, adjustment.batchRevision);
  const sources = await fresh.listImports(f.batch.id, { scope: 'gross' });
  assert.deepEqual(sources.map(row => row.id), [f.imported.id]);
  assert.deepEqual((await fresh.getImport(sources[0].id)).rows, f.source.rows);
  const changes = await fresh.listAdjustments(f.batch.id, { scope: 'gross' });
  assert.equal(changes[0].id, adjustment.id);
  assert.equal(changes[0].before_value, '100.10');
  assert.equal(changes[0].after_value, '110.10');
  assert.equal(changes[0].reason, '尚未重算的测试修改');
  assert.equal((await fresh.listReviews(run.id))[0].outcome, 'accepted');
  assert.deepEqual(await fresh.listAdjustments(f.batch.id, { scope: 'net_uploaded' }), []);
  const employee = await fresh.getEmployee(f.staff[0].person.id);
  assert.equal(employee.employments[0].id, f.staff[0].employment.id);
  assert.equal(employee.employments[0].changes[0].employee_number, '001');
  await assert.rejects(fresh.listImports(f.batch.id, { scope: 'invalid' }), /Invalid payroll scope/);
});
test('runtime role can use repository but cannot erase history, alter schema or create accounts', async () => {
  const f = await fixture();
  const role = 'payroll_runtime_' + randomUUID().replaceAll('-', '').slice(0, 12);
  await provisionRuntimeRole(pool, { role, password: 'isolated-runtime-test-password-only' });
  const client = await pool.connect();
  const facade = { connect: async () => ({ query: (...args) => client.query(...args), release() {} }), query: (...args) => client.query(...args) };
  try {
    await client.query(`SET ROLE "${role}"`);
    const runtime = createPayrollRepository(facade);
    const company = await runtime.createCompany(req({ code: randomUUID(), name: '运行角色测试公司', shortName: '测试' }));
    assert.ok(company.id);
    const run = await runtime.createRun(req(f.runInput));
    for (const item of (await runtime.getRun(run.id)).items) await runtime.reviewItem(req({ itemId: item.id, outcome: 'accepted' }));
    await runtime.confirmRun(req({ batchId: f.batch.id, expectedRevision: run.batchRevision, runId: run.id }));
    await assert.rejects(client.query('DELETE FROM payroll.companies WHERE id=$1', [company.id]), /permission denied/);
    await assert.rejects(client.query('ALTER TABLE payroll.items ADD COLUMN unauthorized text'), /must be owner|permission denied/);
    await assert.rejects(client.query("INSERT INTO payroll.users(username,password_hash,display_name) VALUES('bad','scrypt$x','bad')"), /permission denied/);
  } finally { await client.query('RESET ROLE'); client.release(); }
});
test('pg_dump and pg_restore preserve rows, file links and constraints in a new database', async t => {
  if (!directory) { t.skip('Local PostgreSQL client tools are required for restore verification'); return; }
  const exportPath = join(directory, 'restore-test.dump');
  const environment = { ...process.env, PGHOST: directory, PGPORT: '55439', PGUSER: 'payroll_test_owner', PGDATABASE: 'payroll_test_core' };
  execFileSync(join(pgBin, 'pg_dump'), ['--format=custom', '--file', exportPath], { env: environment, stdio: 'pipe' });
  const restoreName = 'payroll_test_restore';
  execFileSync(join(pgBin, 'createdb'), [restoreName], { env: environment, stdio: 'pipe' });
  execFileSync(join(pgBin, 'pg_restore'), ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', restoreName, exportPath], { env: environment, stdio: 'pipe' });
  const restored = createPool({ host: directory, port: 55439, database: restoreName, user: 'payroll_test_owner' });
  try {
    for (const table of ['employees','employments','source_rows','items','files','audit_events','requests']) {
      const query = `SELECT count(*)::text AS n FROM payroll.${table}`;
      assert.equal((await restored.query(query)).rows[0].n, (await pool.query(query)).rows[0].n, table);
    }
    const query = 'SELECT id,batch_id,run_id,storage_profile,object_key,sha256 FROM payroll.files ORDER BY id';
    assert.deepEqual((await restored.query(query)).rows, (await pool.query(query)).rows);
    assert.deepEqual((await restored.query('SELECT * FROM payroll.run_company_totals ORDER BY run_id,company_id')).rows, (await pool.query('SELECT * FROM payroll.run_company_totals ORDER BY run_id,company_id')).rows);
    await assert.rejects(restored.query('DELETE FROM payroll.items'), /append-only/);
  } finally { await restored.end(); }
  assert.ok((await readFile(exportPath)).length > 0);
});
test('delivered backup/restore scripts share a snapshot and refuse existing restore targets', async t => {
  if (!directory) { t.skip('Local PostgreSQL client tools are required for restore scripts'); return; }
  const environment = { ...process.env, PATH: `${pgBin}:${process.env.PATH}`, PGHOST: directory, PGPORT: '55439', PGUSER: 'payroll_test_owner', PGDATABASE: 'payroll_test_core' };
  const backup = JSON.parse(execFileSync('bash', [join(root,'运维脚本/payroll-db-backup.sh'),'--output-dir',join(directory,'backups')], { env: environment, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }));
  assert.equal(backup.status, 'complete');
  const metadata = (await readFile(join(backup.backupDirectory,'files.metadata.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.equal(metadata.length, Number((await pool.query('SELECT count(*) AS n FROM payroll.files')).rows[0].n));
  const args = [join(root,'运维脚本/payroll-db-restore.sh'),'--backup-dir',backup.backupDirectory,'--target-db','payroll_test_script_restore','--owner','payroll_test_owner'];
  const restored = JSON.parse(execFileSync('bash', args, { env: environment, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }));
  assert.equal(restored.status, 'restored');
  assert.throws(() => execFileSync('bash', args, { env: environment, stdio: 'pipe' }), error => /already exists/.test(error.stderr.toString()));
  const restoredPool = createPool({ host: directory, port: 55439, database: 'payroll_test_script_restore', user: 'payroll_test_owner' });
  try {
    const columns = 'id,batch_id,run_id,kind,original_name,storage_profile,object_key,sha256,byte_size,content_type,status,created_at';
    assert.deepEqual(JSON.parse(JSON.stringify((await restoredPool.query(`SELECT ${columns} FROM payroll.files ORDER BY id`)).rows)), metadata);
    assert.deepEqual((await restoredPool.query('SELECT * FROM payroll.run_company_totals ORDER BY run_id,company_id')).rows, (await pool.query('SELECT * FROM payroll.run_company_totals ORDER BY run_id,company_id')).rows);
  } finally { await restoredPool.end(); }
});
