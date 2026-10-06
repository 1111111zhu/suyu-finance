import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openTestDatabase } from './helpers/payroll-postgres.mjs';
import { migrate } from '../database/rd/migrate.mjs';
import { createRdRepository } from '../database/rd/repository.mjs';

const row = (code, category, amount) => ({
  code, name: code, total: amount, costs: [{ category, amount }],
});
const batch = (projects) => ({
  requestKey: randomUUID(), scope: '苏州', year: 2026, month: 7,
  total: (projects.reduce((sum, item) => sum + Math.round(Number(item.total) * 100), 0) / 100).toFixed(2),
  projects, files: [],
});

test('年度平台编码费用直归平台，不虚挂项目，重算与分析金额一致', async () => {
  const db = await openTestDatabase();
  try {
    await migrate(db.pool);
    await db.pool.query("INSERT INTO rd.platforms(id,name,number) VALUES('aircraft','飞行器平台','RD12602')");
    await db.pool.query("INSERT INTO rd.annual_platforms(code,platform_id,source_year,name,source_row) VALUES('RD12502','aircraft',2025,'飞行器平台',1)");
    await db.pool.query("INSERT INTO rd.projects(id,number,name,status,budget,platform_id,annual_platform_code) VALUES('project-a','RD12502-01','具体项目','active',0,'aircraft','RD12502')");
    const repo = createRdRepository(db.pool);
    const first = batch([row('RD12502', '直接材料', '100.01'), row('RD12502-01', '人员人工', '20.02')]);
    const booked = await repo.confirmProjectBatch(first);
    assert.equal(booked.projectCount, 1);
    assert.equal(booked.platformOnlyCount, 1);
    assert.equal(booked.platformOnlyTotal, '100.01');
    assert.equal((await repo.confirmProjectBatch(first)).repeated, true);
    assert.equal((await repo.getProject('project-a')).actual, 20.02);
    assert.deepEqual((await repo.listPlatforms()).map(item => [item.actual, item.platformOnlyActual]), [[120.03, 100.01]]);
    assert.equal((await repo.listMonthlyTotals()).reduce((sum, item) => sum + Math.round(item.total * 100), 0), 12003);
    assert.equal((await repo.listAnalysis()).reduce((sum, item) => sum + Math.round(item.amount * 100), 0), 12003);
    const direct = (await db.pool.query('SELECT source_code,category,amount FROM rd.platform_ledger_entries')).rows;
    assert.equal(direct.length, 1);
    assert.equal(direct[0].source_code, 'RD12502');

    await repo.confirmProjectBatch(batch([row('RD12502', '直接材料', '3.00'), row('RD12502-01', '人员人工', '7.00')]));
    assert.equal((await repo.getProject('project-a')).actual, 7);
    assert.deepEqual((await repo.listPlatforms()).map(item => [item.actual, item.platformOnlyActual]), [[10, 3]]);
    assert.equal((await repo.listAnalysis()).reduce((sum, item) => sum + Math.round(item.amount * 100), 0), 1000);

    await assert.rejects(repo.confirmProjectBatch(batch([row('RD-UNKNOWN', '直接材料', '1.00')])), /未找到唯一的有效平台归属/);
    assert.equal((await repo.listPlatforms())[0].actual, 10, '平台未知时整批回滚');
  } finally {
    await db.close();
  }
});
