import assert from 'node:assert/strict';
import test from 'node:test';
import { openTestDatabase } from './helpers/payroll-postgres.mjs';
import { createPool } from '../database/payroll/pool.mjs';
import { migrate } from '../database/rd/migrate.mjs';
import { createRdRepository } from '../database/rd/repository.mjs';
import { grantRdRuntimePrivileges, provisionRdRoles } from '../database/rd/provision.mjs';

test('研发项目、台账、重算与旧浏览器数据导入都使用独立 rd schema', async () => {
  const database = await openTestDatabase();
  try {
    await migrate(database.pool);
    const repository = createRdRepository(database.pool);

    const project = await repository.createProject({ number: 'RD2026-900', name: '数据库验证项目', budget: 1000, status: 'active' });
    await repository.recordCalculation({ projectId: project.id, year: 2026, month: 9, labor: 120, freight: 30, other: 50 });
    await repository.recordCalculation({ projectId: project.id, year: 2026, month: 9, labor: 200, freight: 0, other: 0 });
    assert.equal((await repository.getProject(project.id)).actual, 200);
    assert.equal((await repository.listLedger(project.id)).length, 1, '同月测算应替换，而不是重复累计');

    const legacy = {
      requestKey: '9abdb218-1516-4d24-9979-6247037ee9f9',
      projects: [{ id: 'rd-legacy-1', number: 'RD2026-901', name: '旧浏览器项目', status: 'active', budget: 5000, actual: 0, updatedAt: '2026-09-01T00:00:00.000Z' }],
      ledger: [{ id: 'legacy-ledger-1', projectId: 'rd-legacy-1', date: '2026-09-01', category: '人工', amount: 100, description: '历史数据', source: 'manual' }],
    };
    const first = await repository.importLegacy(legacy);
    const repeated = await repository.importLegacy(legacy);
    assert.equal(first.repeated, false);
    assert.equal(repeated.repeated, true, '同一个迁移请求必须幂等');
    assert.equal((await repository.getProject('rd-legacy-1')).actual, 100);

    await repository.removeProject('rd-legacy-1');
    const exported = await repository.exportData();
    assert.equal(exported.projects.length, 1);
    assert.equal(exported.ledger.length, 1, '删除项目必须级联删除其台账');
  } finally {
    await database.close();
  }
});

test('研发数据库角色初始化只向网站运行账户授予必需权限', { skip: Boolean(process.env.PAYROLL_TEST_DATABASE_URL) }, async () => {
  const database = await openTestDatabase();
  let ownerPool;
  let runtimePool;
  try {
    const ownerPassword = 'o'.repeat(32);
    const runtimePassword = 'r'.repeat(32);
    await provisionRdRoles(database.pool, {
      databaseName: database.connectionOptions.database,
      ownerRole: 'rd_test_owner',
      ownerPassword,
      runtimeRole: 'rd_test_runtime',
      runtimePassword,
    });
    const options = { ...database.connectionOptions, connectionString: '', user: 'rd_test_owner', password: ownerPassword };
    ownerPool = createPool(options);
    await migrate(ownerPool);
    await grantRdRuntimePrivileges(ownerPool, { runtimeRole: 'rd_test_runtime' });
    runtimePool = createPool({ ...options, user: 'rd_test_runtime', password: runtimePassword });
    const repository = createRdRepository(runtimePool);
    const project = await repository.createProject({ number: 'RD2026-ROLE', name: '最小权限验证项目', budget: 1, status: 'active' });
    await repository.recordCalculation({ projectId: project.id, year: 2026, month: 9, labor: 1, freight: 0, other: 0 });
    await assert.rejects(runtimePool.query('CREATE TABLE rd.should_not_exist(id integer)'), /permission denied/);
  } finally {
    if (runtimePool) await runtimePool.end();
    if (ownerPool) await ownerPool.end();
    await database.close();
  }
});
