import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createPool } from './pool.mjs';
import { createPayrollRepository, bootstrapAdmin } from './repository.mjs';

/** All names, amounts and file references are fictitious. No real files are uploaded. */
export async function seedDemo(pool, { password, prefix = 'demo-v1', allowDemo = false } = {}) {
  if (!allowDemo || process.env.NODE_ENV==='production') throw Object.assign(new Error('Demo initialization is disabled'),{code:'PAYROLL_DEMO_DISABLED'});
  const database=(await pool.query('SELECT current_database() AS name')).rows[0].name;
  if (!/^payroll_(demo|test)_[a-z0-9_]+$/.test(database)) throw Object.assign(new Error('Demo data requires a separately named payroll_demo_* or payroll_test_* database'),{code:'PAYROLL_DEMO_DATABASE'});
  const admin = await bootstrapAdmin(pool, { username: 'demo_admin', displayName: '虚拟演示管理员', password });
  const db = createPayrollRepository(pool);
  const base = key => ({ actorId: admin.id, requestKey: `${prefix}:${key}` });
  const companies = [];
  for (const [index, city] of ['苏州','杭州','连云港'].entries()) companies.push(await db.createCompany({ ...base(`company-${index}`), code: `${prefix}-${index}`, name: `${city}虚拟演示公司`, shortName: `${city}演示` }));
  const staff = [];
  for (const [index, company] of companies.entries()) {
    const employee = await db.createEmployee({ ...base(`person-${index}`), name: index < 2 ? '虚拟员工甲' : '虚拟实习生乙' });
    const employment = await db.hireEmployee({ ...base(`hire-${index}`), employeeId: employee.id, companyId: company.id, joinedOn: '2026-08-01', employeeNumber: index < 2 ? '001' : null, department: '演示部门', employeeType: index === 2 ? 'intern' : 'regular', reason: '虚拟样例建档' });
    staff.push({ employee, employment, company });
  }
  const rule = await db.createRuleVersion({ ...base('rule'), version: `${prefix}-fixture`, effectiveFrom: '2026-08-01', engineVersion: 'fixture-only-not-a-payroll-rule', parameters: { notice: '预先填写的虚拟结果，用于展示数据库，不代表生产核算口径' } });
  let batch = await db.createBatch({ ...base('batch'), month: '2026-08-01', name: '2026年8月虚拟工资批次', companyIds: companies.map(c => c.id), workdays: '21.0000' });
  const rawRows = staff.map((s, index) => ({ sheetName: '虚拟工资', rowNumber: index + 2, rawValues: { 姓名: s.employee.name, 工号: index < 2 ? '001' : null, 应发工资: ['10000.10','8000.20','3000.00'][index] }, values: { name: s.employee.name, employeeNumber: index < 2 ? '001' : null, gross: ['10000.10','8000.20','3000.00'][index] }, mappingStatus: 'matched', employeeId: s.employee.id, employmentId: s.employment.id, companyId: s.company.id, mappingReason: '演示中的显式人员关联，不按姓名或工号自动合并' }));
  const file = await db.registerFile({ ...base('file'), batchId: batch.id, kind: 'source', originalName: '虚拟工资样例.json', storageProfile: 'demo-unconfigured', objectKey: `${prefix}/source.json`, sha256: createHash('sha256').update(JSON.stringify(rawRows)).digest('hex'), byteSize: Buffer.byteLength(JSON.stringify(rawRows)), contentType: 'application/json', status: 'missing' });
  const imported = await db.createImport({ ...base('import'), batchId: batch.id, expectedRevision: batch.revision, fileId: file.id, scope: 'net_uploaded', sourceType: 'gross_upload', parserVersion: 'demo-json-v1', rows: rawRows });
  const source = await db.getImport(imported.id);
  const run = await db.createRun({ ...base('run'), batchId: batch.id, expectedRevision: imported.batchRevision, scope: 'net_uploaded', ruleVersionId: rule.id, importIds: [source.id], items: staff.map((s,index) => ({ employeeId: s.employee.id, employmentId: s.employment.id, companyId: s.company.id, sourceRowIds: [source.rows[index].id], values: { name: s.employee.name, company: s.company.name, dept: '演示部门', isIntern: index === 2, gross: ['10000.10','8000.20','3000.00'][index], social: ['800.00','600.00','0.00'][index], fund: ['500.00','400.00','0.00'][index], tax: ['100.00','50.00','0.00'][index], afterTaxTotal: '0.00', net: ['8600.10','6950.20','3000.00'][index], companySocial: ['1600.00','1200.00','0.00'][index], companyFund: ['500.00','400.00','0.00'][index], companyCost: ['12100.10','9600.20','3000.00'][index] } })) });
  const result = await db.getRun(run.id);
  for (const [index,item] of result.items.entries()) await db.reviewItem({ ...base(`review-${index}`), itemId: item.id, outcome: 'accepted', note: '已核对虚拟样例' });
  await db.confirmRun({ ...base('confirm'), batchId: batch.id, runId: run.id, expectedRevision: run.batchRevision });
  batch = await db.getBatch(batch.id);
  return { actorId: admin.id, batchId: batch.id, runId: run.id, status: batch.status, totals: await db.getRunSummary(run.id), notice: '虚拟演示；源文件记录标记missing，不代表已上传存储机器' };
}

async function main() {
  if (process.env.PAYROLL_ALLOW_DEMO !== 'yes') throw new Error('Set PAYROLL_ALLOW_DEMO=yes only for an empty demonstration database');
  const pool = createPool({ connectionString: process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL });
  try { process.stdout.write(JSON.stringify(await seedDemo(pool, { password: process.env.PAYROLL_DEMO_PASSWORD, allowDemo: true }), null, 2) + '\n'); }
  finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(`Demo initialization failed (${error.code || 'configuration'}). Check the demo opt-in, password and database state.\n`); process.exitCode = 1; });
