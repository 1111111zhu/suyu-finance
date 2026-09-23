import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {openTestDatabase} from './helpers/payroll-postgres.mjs';
import {migrate} from '../database/rd/migrate.mjs';
import {createRdRepository} from '../database/rd/repository.mjs';
import {recordProjectBatch} from '../database/rd/batch.mjs';
const row=(code,amount)=>({code,name:code,total:amount,costs:[{category:'直接材料',amount}]});
test('逐项目费用入库、平台合计、负数调整、跨年、失败回滚及重算守恒',async()=>{
 const db=await openTestDatabase();
 try{
  await migrate(db.pool);
  await db.pool.query("INSERT INTO rd.platforms(id,name,number) VALUES('p1','平台一','P1'),('p2','平台二','P2')");
  await db.pool.query("INSERT INTO rd.projects(id,number,name,status,budget,platform_id) VALUES('a','RD-A','项目A','active',0,'p1'),('b','RD-B','项目B','active',0,'p1'),('c','RD-C','项目C','active',0,'p2')");
  const repo=createRdRepository(db.pool);
  const batch=(projects,extra={})=>({requestKey:randomUUID(),scope:'苏州',year:2025,month:9,projects,total:(projects.reduce((s,p)=>s+Math.round(Number(p.total)*100),0)/100).toFixed(2),files:[],...extra});
  const first=batch([row('RD-A','100.01'),row('RD-B','20.02'),row('RD-C','-0.03')]);
  await recordProjectBatch(db.pool,first);
  assert.equal((await recordProjectBatch(db.pool,first)).repeated,true);
  assert.deepEqual((await repo.listPlatforms()).map(p=>p.actual),[120.03,-0.03]);
  assert.equal((await repo.listLedger('a'))[0].date,'2025-09-01');
  await assert.rejects(recordProjectBatch(db.pool,batch([row('RD-A','99.00'),row('UNKNOWN','2.00')])),/唯一/);
  assert.equal((await repo.getProject('a')).actual,100.01,'未知项目必须整批回滚');
  await assert.rejects(recordProjectBatch(db.pool,batch([row('RD-A','99.00')],{total:'100.00'})),/总额/);
  await recordProjectBatch(db.pool,batch([row('RD-A','5.00')]));
  assert.equal((await repo.getProject('b')).actual,0,'同范围完整重算必须清除旧项目残留金额');
  await recordProjectBatch(db.pool,batch([row('RD-B','7.00')],{year:2026}));
  await recordProjectBatch(db.pool,batch([row('RD-C','9.00')],{scope:'杭州'}));
  assert.deepEqual((await repo.listPlatforms()).map(p=>p.actual),[12,9],'其他年度、核算主体不受重算影响');
  await Promise.all([recordProjectBatch(db.pool,batch([row('RD-A','2.00')])),recordProjectBatch(db.pool,batch([row('RD-A','3.00')]))]);
  const a=(await repo.getProject('a')).actual;
  assert.ok(a===2||a===3,'并发重算不叠加');
  const total=(await repo.listProjects()).reduce((s,p)=>s+Math.round(p.actual*100),0);
  assert.equal(total,(await repo.listPlatforms()).reduce((s,p)=>s+Math.round(p.actual*100),0));
 }finally{await db.close();}
});
test('截图项目完整合并，同编码三种工装只归集一次',async()=>{
 const c=JSON.parse(await readFile(new URL('../database/rd/catalog.json',import.meta.url)));
 assert.equal(c.platforms.length,6);assert.equal(c.projects.length,41);
 assert.deepEqual(c.platforms.map(p=>c.projects.filter(r=>r[0]===p.id).length),[12,12,1,9,4,3]);
 assert.equal(new Set(c.projects.map(p=>p[1])).size,41);
 assert.deepEqual(c.projects.find(p=>p[1]==='RD1250101')[5],[7,8,9]);
 assert.equal(c.projects.find(p=>p[1]==='RD2260203')[0],'aircraft','杭州项目保留截图平台归属，不按编码前缀猜测');
});
