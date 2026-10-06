import {before,after,test}from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID}from 'node:crypto';
import {openTestDatabase}from './helpers/payroll-postgres.mjs';
import {migrate}from '../database/rd/migrate.mjs';
import {bootstrapAdmin}from '../database/payroll/repository.mjs';
import {createWorkspaceService}from '../server/payroll/workspaces.mjs';
import {createWorkspaceConfirmationService}from '../server/payroll/workspace-confirmation.mjs';
import {createPayrollSyncService}from '../database/rd/payroll-sync.mjs';
import {createRdRepository}from '../database/rd/repository.mjs';
let database,pool,admin,employeeId,workspace,confirm,service,repo,first,second;
const corpId='ww-rd-isolated-test',projectId='isolated-rd-one';
function snapshot(gross='1000.01',month='2026-08'){
 const roster={姓名:'隔离测试员工',签约公司:'隔离测试公司',一级部门:'研发部',工号:'TEST001',员工状态:'在职',员工类型:'正式',入职时间:'2025-01-03'};
 const result={rosterRow:2,name:roster.姓名,company:roster.签约公司,dept:'研发部',employeeNumber:'TEST001',status:'在职',employmentType:'正式',join:'2025-01-03',isIntern:false,gross:Number(gross),net:800,base:Number(gross),post:0,perfBase:0,workdays:22,payableDays:22,companySocial:100.10,companyFund:50.05,rosterIssues:[],rosterSources:{name:'姓名',company:'签约公司',status:'员工状态',join:'入职时间'},payrollSourceBlocked:false,regularizationBlocked:false,payrollBlocked:false};
 return{formatVersion:1,provenance:'user-import',batch:{name:'隔离测试工资',month,workdays:22,data:{liveImport:true,payrollStage:'net',sourceStatus:{roster:{filename:'isolated-fixture.xlsx'}},makeupWorkdays:[]}},sources:{roster:{rows:[roster],sheetName:'花名册',sourceStartRow:2}},results:{gross:[{...result}],net:[result]}};
}
const input=(run,extra={})=>({requestKey:randomUUID(),runId:run.runId,rule:{version:'gross-company-v1',fields:['gross','company_social','company_fund']},reason:'隔离测试复核',allocations:[{employeeId,projectId,basisPoints:10000,hoursEvidence:'隔离测试工时单'}],...extra});
before(async()=>{
 database=await openTestDatabase();pool=database.pool;await migrate(pool);
 admin=await bootstrapAdmin(pool,{username:'isolated_rd_sync',displayName:'隔离测试',password:'Isolated-rd-sync-test-only-password'});
 employeeId=(await pool.query('INSERT INTO payroll.employees(name,created_by) VALUES($1,$2) RETURNING id',['隔离测试员工',admin.id])).rows[0].id;
 await pool.query(`INSERT INTO payroll.wecom_members(corp_id,userid,name,department_ids,position,observed_at) VALUES($1,'test-user','隔离测试员工','["2"]','测试',now())`,[corpId]);
 await pool.query(`INSERT INTO payroll.wecom_employee_links(corp_id,userid,employee_id,reason,created_by,updated_by) VALUES($1,'test-user',$2,'隔离测试显式身份确认',$3,$3)`,[corpId,employeeId,admin.id]);
 await pool.query("INSERT INTO rd.projects(id,number,name,status,budget) VALUES($1,'TEST-RD-1','隔离研发项目','active',100000)",[projectId]);
 workspace=createWorkspaceService(pool);confirm=createWorkspaceConfirmationService({pool,corpId});service=createPayrollSyncService({rdPool:pool,payrollPool:pool});repo=createRdRepository(pool);
 const saved=await workspace.save({actorId:admin.id,requestKey:randomUUID(),snapshot:snapshot()});
 first=await confirm.confirm({actorId:admin.id,workspaceId:saved.id,revision:1,requestKey:randomUUID(),mappings:[{resultIndex:0,rosterRow:2,employeeId,reason:'显式选择工资员工 ID'}]});
},{timeout:60000});
after(async()=>{await database?.close();});
test('real PostgreSQL sync, retry, sums and aggregate privacy',async()=>{
 const request=input(first);const result=await service.sync(request,'test-manager');assert.equal(result.totals.source,'1150.16');assert.equal(result.totals.allocated,'1150.16');
 assert.deepEqual(await service.sync(request,'test-manager'),result);
 assert.equal((await pool.query('SELECT count(*)::int n FROM rd.payroll_labor_snapshots')).rows[0].n,1);
 const ledger=await repo.listLedger(projectId);assert.equal(ledger.length,1);assert.equal(Number(ledger[0].amount),1150.16);
 const project=await repo.getProject(projectId);assert.equal(project.actual,1150.16);const analysis=await repo.listAnalysis();assert.equal(analysis.find(r=>r.month==='2026-08'&&r.category==='人工费用').amount,1150.16);
 const monthly=await repo.listMonthlyTotals();assert.ok(monthly.some(row=>Number(row.total)===1150.16));
 const finance=await service.list(false);assert.deepEqual(Object.keys(finance[0]).sort(),['month','projects','revision','snapshotId']);
 const serialized=JSON.stringify(finance);for(const hidden of [employeeId,'隔离测试员工','source_batch_id','company_social','gross','personnel'])assert.ok(!serialized.includes(hidden));
 first.snapshotId=result.snapshotId;
});
test('database triggers prevent generic wage ledger edits, deletion and project cascade',async()=>{
 const id=(await repo.listLedger(projectId))[0].id;
 await assert.rejects(pool.query('UPDATE rd.ledger_entries SET amount=1 WHERE id=$1',[id]),{code:'23514'});
 await assert.rejects(pool.query('DELETE FROM rd.ledger_entries WHERE id=$1',[id]),{code:'23514'});
 await assert.rejects(pool.query('DELETE FROM rd.projects WHERE id=$1',[projectId]),{code:'23503'});
 await assert.rejects(pool.query('UPDATE rd.payroll_labor_snapshots SET reason=$1 WHERE id=$2',['tamper',first.snapshotId]));
});
test('confirmed salary revision needs explicit labor supersedes; old snapshots remain unchanged',async()=>{
 const revised=await workspace.save({actorId:admin.id,id:first.workspaceId,expectedRevision:1,requestKey:randomUUID(),snapshot:snapshot('1100.03')});
 second=await confirm.confirm({actorId:admin.id,workspaceId:first.workspaceId,revision:revised.revision,requestKey:randomUUID(),mappings:[{resultIndex:0,rosterRow:2,employeeId,reason:'隔离工资修订确认'}]});
 await assert.rejects(()=>service.sync(input(first,{supersedes:first.snapshotId}),'test-manager'),{code:'RD_CONFLICT'});
 await assert.rejects(()=>service.sync(input(second),'test-manager'),{code:'RD_CONFLICT'});assert.equal((await service.list(true)).find(s=>s.month==='2026-08-01').sourceChanged,true);
 const result=await service.sync(input(second,{supersedes:first.snapshotId}),'test-manager');assert.equal(result.revision,2);assert.equal(result.totals.allocated,'1250.18');
 const ledger=await repo.listLedger(projectId);assert.equal(ledger.length,1);assert.equal(Number(ledger[0].amount),1250.18);
 const snaps=(await pool.query('SELECT totals,revision FROM rd.payroll_labor_snapshots ORDER BY revision')).rows;assert.deepEqual(snaps.map(s=>s.totals.allocated),['1150.16','1250.18']);
 first.snapshotId=result.snapshotId;assert.equal((await service.list(true)).find(s=>s.month==='2026-08-01').sourceChanged,false);
});
test('same version rule mapping cannot change and failure leaves current ledger intact',async()=>{
 await assert.rejects(()=>service.sync(input(second,{supersedes:first.snapshotId,rule:{version:'gross-company-v1',fields:['gross']}}),'test-manager'),/口径版本/);
 assert.equal((await repo.listLedger(projectId)).length,1);assert.equal((await repo.getProject(projectId)).actual,1250.18);
});
test('concurrent different batches with same person/month admit exactly one projection',async()=>{
 const runs=[];for(let i=0;i<2;i++){
  const saved=await workspace.save({actorId:admin.id,requestKey:randomUUID(),snapshot:snapshot('1000.01','2026-09')});
  runs.push(await confirm.confirm({actorId:admin.id,workspaceId:saved.id,revision:1,requestKey:randomUUID(),mappings:[{resultIndex:0,rosterRow:2,employeeId,reason:'并发隔离测试身份确认'}]}));
 }
 const results=await Promise.allSettled(runs.map(run=>service.sync(input(run),'test-manager')));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='RD_CONFLICT').length,1);
 const totals=await repo.listMonthlyTotals();const september=totals.filter(r=>r.month==='2026-09');assert.equal(september.length,1);assert.equal(september[0].total,1150.16);
});
test('existing manual labor blocks wage sync without partial revision',async()=>{
 const other='isolated-manual-conflict';await pool.query("INSERT INTO rd.projects(id,number,name,status,budget) VALUES($1,'TEST-RD-2','已有人工项目','active',100000)",[other]);
 await pool.query("INSERT INTO rd.ledger_entries(id,project_id,entry_date,category,amount,source) VALUES('manual-test',$1,'2026-08-15','研发工资',10,'manual')",[other]);
 await assert.rejects(()=>service.sync(input(second,{supersedes:first.snapshotId,allocations:[{employeeId,projectId:other,basisPoints:10000,hoursEvidence:'测试工时'}]}),'test-manager'),/已有人工费用/);
 assert.equal((await repo.getProject(projectId)).actual,2400.34);
 assert.equal((await pool.query('SELECT count(*)::int n FROM rd.payroll_labor_snapshots WHERE month=\'2026-08-01\'')).rows[0].n,2);
});
test('soft deleted projects and platforms cannot receive wage allocation',async()=>{
 const deleted='isolated-deleted',platform='isolated-platform';
 await pool.query("INSERT INTO rd.projects(id,number,name,status,budget,deleted_at) VALUES($1,'TEST-RD-3','已删除项目','active',1000,now())",[deleted]);
 await assert.rejects(()=>service.sync(input(second,{supersedes:first.snapshotId,allocations:[{employeeId,projectId:deleted,basisPoints:10000,hoursEvidence:'测试工时'}]}),'test-manager'),/已删除/);
 await pool.query("INSERT INTO rd.platforms(id,name,deleted_at) VALUES($1,'已删除平台',now())",[platform]);
 await pool.query("UPDATE rd.projects SET deleted_at=NULL,platform_id=$2 WHERE id=$1",[deleted,platform]);
 await assert.rejects(()=>service.sync(input(second,{supersedes:first.snapshotId,allocations:[{employeeId,projectId:deleted,basisPoints:10000,hoursEvidence:'测试工时'}]}),'test-manager'),/已删除/);
});
test('effective historical monthly labor summary blocks sync until source is reconciled',async()=>{
 const importId=randomUUID();await pool.query(`INSERT INTO rd.analysis_imports(id,scope,period,filename,sha256,source_format,project_count,total,status) VALUES($1,'历史主体','2026-08-01','isolated.xlsx',$2,'fixed-template',1,5,'active')`,[importId,'a'.repeat(64)]);
 await pool.query("INSERT INTO rd.analysis_import_lines(import_id,category,amount) VALUES($1,'人工费用',5)",[importId]);
 await assert.rejects(()=>service.sync(input(second,{supersedes:first.snapshotId}),'test-manager'),/历史人工汇总/);
 assert.equal((await pool.query("SELECT count(*)::int n FROM rd.payroll_labor_snapshots WHERE month='2026-08-01'")).rows[0].n,2);
 await pool.query("UPDATE rd.analysis_imports SET status='superseded',superseded_at=now() WHERE id=$1",[importId]);
 const result=await service.sync(input(second,{supersedes:first.snapshotId}),'test-manager');assert.equal(result.revision,3);assert.equal(result.totals.allocated,'1250.18');
});
