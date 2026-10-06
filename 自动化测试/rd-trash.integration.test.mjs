import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openTestDatabase} from './helpers/payroll-postgres.mjs';
import {migrate} from '../database/rd/migrate.mjs';
import {createRdRepository} from '../database/rd/repository.mjs';
const batch=(projects,month=9)=>({requestKey:randomUUID(),scope:'苏州',year:2026,month,total:projects.reduce((s,p)=>s+Number(p.total),0).toFixed(2),projects});
const row=(code,total)=>({code,total,costs:[{category:'直接材料',amount:total}]});
test('平台与项目回收站保留费用、分批恢复、编码占用及同月归档保护',async()=>{
 const db=await openTestDatabase();
 try{
  await migrate(db.pool);const repo=createRdRepository(db.pool);
  const platform=await repo.manage({action:'create',kind:'platform',name:'平台一',number:'P1'});
  const make=(code)=>repo.createProject({name:code,number:code,platformId:platform.id});
  const a=await make('RD-A'),b=await make('RD-B');
  await repo.recordProjectBatch(batch([row(a.number,'10.01'),row(b.number,'20.02')]));
  const saved=(await db.pool.query('SELECT id,project_id,amount FROM rd.ledger_entries ORDER BY id')).rows;
  await repo.removeProject(a.id);
  assert.equal((await repo.listPlatforms())[0].actual,20.02);
  assert.equal((await repo.listPlatforms())[0].projectCount,1);
  assert.equal((await repo.listTrash())[0].actual,10.01);
  await assert.rejects(repo.getProject(a.id),/not found/);
  await assert.rejects(make('rd-a'),/编码已存在/);
  const other=await repo.manage({action:'create',kind:'platform',name:'平台二',number:'P2'});
  await assert.rejects(repo.createProject({name:'重号',number:'RD-A',platformId:other.id}),/编码已存在/);
  await assert.rejects(repo.recordProjectBatch(batch([row(b.number,'40.00')])),/先恢复/);
  await assert.rejects(repo.recordProjectBatch(batch([row(a.number,'40.00')],10)),/回收站/);
  assert.deepEqual((await db.pool.query('SELECT id,project_id,amount FROM rd.ledger_entries ORDER BY id')).rows,saved);
  await repo.manage({action:'delete',kind:'platform',id:platform.id});
  assert.equal((await repo.listProjects()).length,0);
  await assert.rejects(repo.manage({action:'restore',kind:'project',id:b.id}),/先恢复所属平台/);
  await assert.rejects(make('RD-C'),/平台不存在或已删除/);
  await repo.manage({action:'restore',kind:'platform',id:platform.id});
  assert.deepEqual((await repo.listProjects()).map(p=>p.id),[b.id]);
  assert.equal((await repo.listTrash())[0].id,a.id,'平台恢复不能复活此前单独删除项目');
  await repo.manage({action:'restore',kind:'project',id:a.id});
  assert.equal((await repo.listPlatforms()).find(p=>p.id===platform.id).actual,30.03);
  assert.deepEqual((await db.pool.query('SELECT id,project_id,amount FROM rd.ledger_entries ORDER BY id')).rows,saved);
  await assert.rejects(db.pool.query('DELETE FROM rd.projects WHERE id=$1',[a.id]),/foreign key/);
  await assert.rejects(repo.recordCalculation({projectId:a.id}),/停用/);
  await Promise.all([repo.removeProject(a.id),repo.removeProject(a.id)]);
  assert.equal((await repo.listTrash()).filter(p=>p.id===a.id).length,1);
  await Promise.all([repo.manage({action:'restore',kind:'project',id:a.id}),repo.manage({action:'restore',kind:'project',id:a.id})]);
  assert.equal((await repo.getProject(a.id)).actual,10.01);
  const exports=await repo.exportData();assert.equal(exports.projects.length,2);assert.equal(exports.ledger.length,2);
 }finally{await db.close();}
});
test('新增竞争和删除/重算竞争由相同目录事务锁保护',async()=>{
 const db=await openTestDatabase();
 try{
  await migrate(db.pool);const repo=createRdRepository(db.pool);
  const p=await repo.manage({action:'create',kind:'platform',name:'并发平台',number:'P'});
  const creates=await Promise.allSettled([1,2].map(()=>repo.createProject({name:'并发项目',number:'RD-C',platformId:p.id})));
  assert.equal(creates.filter(r=>r.status==='fulfilled').length,1);
  const project=(await repo.listProjects())[0];
  await repo.recordProjectBatch(batch([row('RD-C','8.00')]));
  await Promise.allSettled([repo.removeProject(project.id),repo.recordProjectBatch(batch([row('RD-C','9.00')]))]);
  const trash=await repo.listTrash();assert.equal(trash.length,1);assert.ok([8,9].includes(trash[0].actual));
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM rd.ledger_entries l JOIN rd.calculation_runs cr ON cr.id=l.run_id WHERE cr.status='confirmed'")).rows[0].n,1,'仅一个有效版本，旧台账保留追溯');
 }finally{await db.close();}
});
test('旧数据迁入必须有有效平台，历史未标记主体测算不得与新批次叠加',async()=>{
 const db=await openTestDatabase();
 try{
  await migrate(db.pool);const repo=createRdRepository(db.pool);
  const p=await repo.manage({action:'create',kind:'platform',name:'历史平台',number:'P-LEGACY'});
  const gone=await repo.manage({action:'create',kind:'platform',name:'已归档平台',number:'P-GONE'});
  await repo.manage({action:'delete',kind:'platform',id:gone.id});
  const legacyProject={id:'legacy-old',number:'RD-OLD',name:'旧项目',status:'active',budget:0,platformId:p.id};
  const legacyLedger={id:'legacy-cost',projectId:'legacy-old',date:'2026-09-15',category:'人工',amount:100,source:'calculation'};
  const payload=platformId=>({requestKey:randomUUID(),projects:[{...legacyProject,platformId}],ledger:[legacyLedger]});
  for(const platformId of [undefined,'missing-platform',gone.id]){
    await assert.rejects(repo.importLegacy(payload(platformId)),error=>error.code==='RD_MANAGEMENT'&&/指定有效平台/.test(error.message));
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM rd.projects')).rows[0].n,0);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM rd.import_requests')).rows[0].n,0);
  }
  await repo.importLegacy(payload(p.id));
  assert.equal((await repo.getProject('legacy-old')).platformId,p.id);
  assert.equal((await repo.listPlatforms())[0].projectCount,1);
  const b=await repo.createProject({number:'RD-NEW',name:'新项目',platformId:p.id});
  await repo.recordProjectBatch(batch([row(b.number,'20.00')]));
  const before=(await db.pool.query('SELECT id,project_id,amount,run_id FROM rd.ledger_entries ORDER BY id')).rows;
  const runsBefore=(await db.pool.query('SELECT count(*)::int AS n FROM rd.calculation_runs')).rows[0].n;
  await assert.rejects(repo.recordProjectBatch(batch([row('RD-OLD','150.00'),row(b.number,'30.00')])),/先核对历史账/);
  assert.deepEqual((await db.pool.query('SELECT id,project_id,amount,run_id FROM rd.ledger_entries ORDER BY id')).rows,before);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM rd.calculation_runs')).rows[0].n,runsBefore);
  assert.equal((await repo.getProject('legacy-old')).actual,100,'不能把旧100元与新150元叠加为250元');
  assert.equal((await repo.getProject(b.id)).actual,20,'整批拒绝时其他项目不得改变');
  await repo.recordProjectBatch(batch([row('RD-OLD','10.00')],10));
  assert.equal((await repo.getProject('legacy-old')).actual,110,'其他月份仍允许正常入账');
 }finally{await db.close();}
});
