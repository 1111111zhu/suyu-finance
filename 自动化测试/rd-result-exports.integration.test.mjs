import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {zipSync,unzipSync,strToU8} from 'fflate';
import {openTestDatabase} from './helpers/payroll-postgres.mjs';
import {migrate} from '../database/rd/migrate.mjs';
import {recordProjectBatch,recordProjectBatches,validateResultFile} from '../database/rd/batch.mjs';
import {exportResults,validateExportRange} from '../database/rd/result-exports.mjs';

const bytes=Buffer.from(zipSync({'[Content_Types].xml':strToU8('<Types/>'),'xl/workbook.xml':strToU8('<workbook/>')}));
const file={filename:'测算结果.xlsx',base64:bytes.toString('base64')};
const batch=(month,extra={})=>({requestKey:randomUUID(),scope:'苏州',year:2026,month,projects:[{code:'RD-A',total:'0.00',costs:[{category:'直接材料',amount:'0.00'}]}],total:'0.00',resultFile:file,...extra});

test('月份区间和归档输入校验',()=>{
 assert.deepEqual(validateExportRange({startMonth:'2025-12',endMonth:'2026-02'}).months,['2025-12','2026-01','2026-02']);
 for(const range of [['2026-13','2026-14'],['2026-08','2026-03'],['2000-01','2010-01'],['1999-01','2000-01']]) assert.throws(()=>validateExportRange({startMonth:range[0],endMonth:range[1]}));
 assert.equal(validateResultFile(file).content.compare(bytes),0);
 for(const result of [{...file,filename:'../a.xlsx'},{...file,base64:'$$$$'},{...file,base64:'aaaa'},{...file,base64:'A'.repeat(41943044)}]) assert.throws(()=>validateResultFile(result));
});

test('零费用结果逐月归档、跨年、最新快照缺文件阻止回退、原字节ZIP与原子回滚',async()=>{
 const db=await openTestDatabase();
 try {
  await migrate(db.pool);
  await db.pool.query("INSERT INTO rd.platforms(id,name,number) VALUES('p','平台','P'); INSERT INTO rd.projects(id,number,name,status,budget,platform_id) VALUES('a','RD-A','项目','active',0,'p')");
  const first=batch(12,{year:2025});
  await recordProjectBatch(db.pool,first);
  assert.equal((await recordProjectBatch(db.pool,first)).repeated,true);
  await recordProjectBatch(db.pool,batch(1));
  const range={startMonth:'2025-12',endMonth:'2026-01',scope:'苏州'};
  const preview=await exportResults(db.pool,range);
  assert.equal(preview.ready,true);assert.equal(preview.records.length,2);assert.equal(preview.records[0].total,'0.00');
  assert.equal((await db.pool.query('SELECT COUNT(*) AS n FROM rd.ledger_entries')).rows[0].n,'0','零费用也必须能导出');
  assert.equal((await db.pool.query('SELECT payload->\'resultFile\' AS f FROM rd.calculation_runs LIMIT 1')).rows[0].f.base64,undefined);
  const archive=unzipSync((await exportResults(db.pool,range,true)).content);
  assert.equal(Object.keys(archive).length,2);for(const item of Object.values(archive)) assert.deepEqual(Buffer.from(item),bytes);
  assert.equal(Object.keys(unzipSync((await exportResults(db.pool,{...range,startMonth:'2026-01'},true)).content)).length,1);
  const failed=batch(2,{projects:[{code:'MISSING',total:'0.00',costs:[{category:'直接材料',amount:'0.00'}]}]});
  await assert.rejects(recordProjectBatch(db.pool,failed));
  assert.equal((await db.pool.query('SELECT COUNT(*) AS n FROM rd.result_files')).rows[0].n,'2','整批失败不得留下归档');
  await recordProjectBatch(db.pool,batch(1,{resultFile:undefined}));
  await db.pool.query("UPDATE rd.calculation_runs SET created_at='2000-01-01' WHERE scope='苏州' AND period='2026-01-01'");
  assert.equal((await exportResults(db.pool,range)).missing[0].month,'2026-01');
  await assert.rejects(exportResults(db.pool,range,true),/未归档/);
  await recordProjectBatch(db.pool,batch(1));
  await recordProjectBatch(db.pool,batch(3,{scope:'仅区间外主体'}));
  assert.equal((await exportResults(db.pool,{...range,scope:''})).ready,true,'范围外主体不阻止导出');
  await recordProjectBatch(db.pool,batch(1,{scope:'杭州'}));
  assert.deepEqual((await exportResults(db.pool,{...range,scope:''})).missing,[{scope:'杭州',month:'2025-12',reason:'该月尚无已入账的测算结果'}]);
  assert.equal((await exportResults(db.pool,{startMonth:'2026-08',endMonth:'2026-08'})).ready,false);
  await db.pool.query("UPDATE rd.result_files SET sha256=repeat('0',64)");
  await assert.rejects(exportResults(db.pool,range,true),/校验失败/);
 } finally {await db.close();}
});

test('多月原子入账、幂等重试，后续月份失败回滚所有月份与文件',async()=>{
 const db=await openTestDatabase();
 try{
  await migrate(db.pool);
  await db.pool.query("INSERT INTO rd.platforms(id,name,number) VALUES('p','平台','P'); INSERT INTO rd.projects(id,number,name,status,budget,platform_id) VALUES('a','RD-A','项目','active',0,'p')");
  const withAmount=(month,amount,extra={})=>batch(month,{total:amount,projects:[{code:'RD-A',total:amount,costs:[{category:'直接材料',amount}]}],...extra});
  const snapshot=async()=>({runs:(await db.pool.query('SELECT id,scope,period,payload_hash FROM rd.calculation_runs ORDER BY id')).rows,files:(await db.pool.query('SELECT run_id,sha256 FROM rd.result_files ORDER BY run_id')).rows,ledger:(await db.pool.query('SELECT id,entry_date,amount,run_id FROM rd.ledger_entries ORDER BY id')).rows});
  const inputs=[withAmount(4,'2.02'),withAmount(3,'1.01')];
  const success=await recordProjectBatches(db.pool,inputs);
  assert.deepEqual(success.results.map(r=>r.total),['2.02','1.01']);
  const saved=await snapshot();assert.equal(saved.runs.length,2);assert.equal(saved.files.length,2);assert.equal(saved.ledger.length,2);
  assert.ok((await recordProjectBatches(db.pool,inputs)).results.every(r=>r.repeated));
  assert.deepEqual(await snapshot(),saved,'完整多月重试不增加任何费用或文件');
  const invalid=withAmount(4,'20.00');invalid.projects[0].code='MISSING';
  await assert.rejects(recordProjectBatches(db.pool,[invalid,withAmount(3,'10.00')]),/唯一/);
  assert.deepEqual(await snapshot(),saved,'三月先入账但四月失败后，恢复原三月金额及原归档，无孤立文件');
  for(const inputs of [[],[withAmount(1,'1.00'),withAmount(1,'2.00')],[withAmount(1,'1.00'),withAmount(2,'2.00',{scope:'杭州'})],[withAmount(1,'1.00'),withAmount(2,'2.00',{year:2025})],[withAmount(1,'1.00',{resultFile:undefined})]]) await assert.rejects(recordProjectBatches(db.pool,inputs));
  assert.deepEqual(await snapshot(),saved);
 }finally{await db.close();}
});
