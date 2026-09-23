import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import XLSX from 'xlsx';
import { openTestDatabase } from './helpers/payroll-postgres.mjs';
import { migrate } from '../database/rd/migrate.mjs';
import { importMaster, parseMasterWorkbook } from '../database/rd/import-master.mjs';

const source = '/Users/zhujiaying/Desktop/研发项目命名规则及研发项目平台.xlsx';
const header = ['序号', '项目平台编码', '项目平台名称', '  项目编码', '物料编码', '项目名称', '项目经理', '项目状态', '备注'];

function fixtureBytes() {
  const book = XLSX.utils.book_new();
  const y2025 = [header,
    [1, 'RD12501', '一体化电控平台', 'RD1250101', 44020036, 'bop测试工装系统', '周洪雷', '暂停', null],
    [null, null, null, null, 44020037, 'PCB检测工装', '周洪雷', '暂停', null],
    [null, null, null, null, 44020038, '电堆测试工装', '周洪雷', '暂停', null],
    [], [], [],
    [2, 'RD12503', '氢助力两轮车及平台项目', 'RD1250301', null, null, null, null, null],
  ];
  const y2026 = [header,
    [1, 'RD12601', '一体化电控平台', 'RD1260101', '/', 'Ebike550控制器研发', '仝淼', '运行', null],
  ];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(y2025), '2025年研发项目平台');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(y2026), '2026年研发项目平台');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

test('synthetic workbook preserves actual row numbers, source blanks and material detail rows', () => {
  const data = parseMasterWorkbook(fixtureBytes());
  assert.deepEqual(data.counts, { platforms: 3, projects: 3, details: 5 });
  assert.deepEqual(data.platforms.map(item => item.row), [2, 8, 2]);
  const tooling = data.projects.find(item => item.code === 'RD1250101');
  assert.deepEqual(tooling.details.map(item => item.row), [2, 3, 4]);
  assert.deepEqual(tooling.details.map(item => item.materialCode), ['44020036', '44020037', '44020038']);
  assert.equal(data.projects.find(item => item.code === 'RD1250301').name, null);
});

test('local confirmed workbook matches the signed-off 9/41/43 source counts', { skip: !existsSync(source) }, async () => {
  const data = parseMasterWorkbook(await readFile(source));
  assert.deepEqual(data.counts, { platforms: 9, projects: 41, details: 43 });
  assert.equal(new Set(data.platforms.map(item => item.platformId)).size, 6);
  assert.deepEqual(data.platforms.filter(item => item.year === 2026).map(item => item.row), [2, 8, 14, 15]);
  const tooling = data.projects.find(item => item.code === 'RD1250101');
  assert.equal(tooling.details.length, 3);
  assert.deepEqual(tooling.details.map(item => item.row), [7, 8, 9]);
  assert.deepEqual(tooling.details.map(item => item.materialCode), ['44020036', '44020037', '44020038']);
  assert.equal(data.projects.find(item => item.code === 'RC22505-01').details[0].row, 46);
  assert.equal(data.projects.find(item => item.code === 'RD1250301').name, null);
  assert.equal(data.projects.find(item => item.code === 'RD12502-01').rawStatus, null);
});

test('preview, apply and repeated import keep project IDs and ledger, never delete omissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rd-master-fixture-'));
  const fixture = join(directory, 'master.xlsx');
  let database;
  try {
    await writeFile(fixture, fixtureBytes());
    database = await openTestDatabase();
    await migrate(database.pool);
    const preview = await importMaster(database.pool, fixture);
    assert.equal(preview.applied, false);
    assert.equal(preview.changes.projects.length, 3);
    assert.equal(Number((await database.pool.query('SELECT count(*) FROM rd.projects')).rows[0].count), 0);
    const applied = await importMaster(database.pool, fixture, { apply: true });
    assert.equal(applied.applied, true);
    const project = (await database.pool.query("SELECT id,name,source_name FROM rd.projects WHERE number='RD1250301'")).rows[0];
    assert.equal(project.name, '项目名称待补充');
    assert.equal(project.source_name, null);
    const firstId = (await database.pool.query("SELECT id FROM rd.projects WHERE number='RD1250101'")).rows[0].id;
    await database.pool.query("INSERT INTO rd.ledger_entries(id,project_id,entry_date,category,amount,description,source) VALUES('retained-entry',$1,'2026-09-01','人工',123,'保留费用','manual')", [firstId]);
    await database.pool.query("INSERT INTO rd.projects(id,number,name,status,budget) VALUES('manual-extra','RD-EXTRA','人工新增项目','init',0)");
    const omissionPreview = await importMaster(database.pool, fixture);
    assert.deepEqual(omissionPreview.changes.omissions.map(item => item.code), ['RD-EXTRA']);
    const repeat = await importMaster(database.pool, fixture, { apply: true });
    assert.equal(repeat.repeated, true);
    assert.equal((await database.pool.query("SELECT id FROM rd.projects WHERE number='RD-EXTRA'")).rows[0].id, 'manual-extra');
    assert.equal((await database.pool.query("SELECT id FROM rd.projects WHERE number='RD1250101'")).rows[0].id, firstId);
    assert.equal(Number((await database.pool.query("SELECT amount FROM rd.ledger_entries WHERE id='retained-entry'")).rows[0].amount), 123);
    assert.equal(Number((await database.pool.query('SELECT count(*) FROM rd.project_detail_rows')).rows[0].count), 5);
    assert.equal(Number((await database.pool.query('SELECT count(*) FROM rd.annual_platforms')).rows[0].count), 3);
    assert.equal(Number((await database.pool.query('SELECT count(*) FROM rd.source_documents')).rows[0].count), 1);
    assert.equal(Number((await database.pool.query('SELECT count(*) FROM rd.master_imports')).rows[0].count), 1);
  } finally { if (database) await database.close(); await rm(directory, { recursive: true, force: true }); }
});
