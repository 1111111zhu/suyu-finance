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

    const platform=await repository.manage({kind:'platform',action:'create',name:'测试平台',number:'TEST-P'});
    const project = await repository.createProject({ number: 'RD2026-900', name: '数据库验证项目', budget: 1000, status: 'active',platformId:platform.id });
    const input={scope:'测试主体',year:2026,month:9,projects:[{code:project.number,total:'200.00',costs:[{category:'人工',amount:'200.00'}]}],total:'200.00',requestKey:'da382a51-360a-4e92-a6f1-94c07f22b178'};
    await repository.recordProjectBatch(input);
    await repository.recordProjectBatch(input);
    assert.equal((await repository.getProject(project.id)).actual, 200);
    assert.equal((await repository.listLedger(project.id)).length, 1, '同月测算应替换，而不是重复累计');

    const legacy = {
      requestKey: '9abdb218-1516-4d24-9979-6247037ee9f9',
      projects: [{ id: 'rd-legacy-1', number: 'RD2026-901', name: '旧浏览器项目', status: 'active', budget: 5000, platformId:platform.id, actual: 0, updatedAt: '2026-09-01T00:00:00.000Z' }],
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
    assert.equal(exported.ledger.length, 1, '回收站项目台账不进入有效导出');
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
    const platform=await repository.manage({kind:'platform',action:'create',name:'权限平台',number:'ROLE-P'});
    const project = await repository.createProject({platformId:platform.id, number: 'RD2026-ROLE', name: '最小权限验证项目', budget: 1, status: 'active' });
    await repository.recordProjectBatch({scope:'权限测试',year:2026,month:9,requestKey:'991e56c0-e01c-4e41-af36-28c4772d3266',projects:[{code:project.number,total:'1.00',costs:[{category:'人工',amount:'1.00'}]}],total:'1.00'});
    await assert.rejects(runtimePool.query('DELETE FROM rd.projects'), /permission denied/);
    await assert.rejects(runtimePool.query('CREATE TABLE rd.should_not_exist(id integer)'), /permission denied/);
  } finally {
    if (runtimePool) await runtimePool.end();
    if (ownerPool) await ownerPool.end();
    await database.close();
  }
});
