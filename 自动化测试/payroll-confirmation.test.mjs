import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openTestDatabase} from './helpers/payroll-postgres.mjs';
import {bootstrapAdmin} from '../database/payroll/repository.mjs';
import {createWorkspaceService} from '../server/payroll/workspaces.mjs';
import {createWorkspaceConfirmationService} from '../server/payroll/workspace-confirmation.mjs';
import {createPayrollSummaryService} from '../server/payroll/payroll-summary.mjs';
import {provisionRuntimeRole} from '../database/payroll/admin.mjs';
import {createPool} from '../database/payroll/pool.mjs';

let database,pool,admin,employeeId,workspaces,confirmation,summary;
const corpId='ww-formal-test';
const source={姓名:'甲',签约公司:'测试公司',一级部门:'研发部',二级部门:'应用组',工号:'A001',
  员工状态:'在职',员工类型:'正式',入职时间:'2025-01-03',银行卡号:'0000123456789'};
function snapshot(net=9000,month='2026-08') {
  const result={rosterRow:2,name:'甲',company:'测试公司',dept:'研发部',subdept:'应用组',employeeNumber:'A001',
    status:'在职',join:'2025-01-03',isIntern:false,employmentType:'正式',bankCard:'0000123456789',
    gross:10000,net,base:10000,post:0,perfBase:0,workdays:22,payableDays:22,
    rosterSources:{name:'姓名',company:'签约公司',status:'员工状态',join:'入职时间'},rosterIssues:[],
    payrollSourceBlocked:false,regularizationBlocked:false,payrollBlocked:false};
  return {formatVersion:1,provenance:'user-import',batch:{name:'测试工资',month,workdays:22,
    data:{liveImport:true,payrollStage:'net',sourceStatus:{roster:{filename:'虚拟花名册.xlsx'}},makeupWorkdays:[]}},
    sources:{roster:{rows:[source],sheetName:'花名册',sourceStartRow:2}},
    results:{gross:[{...result,net:10000}],net:[result]}};
}
before(async()=>{
  database=await openTestDatabase();pool=database.pool;
  admin=await bootstrapAdmin(pool,{username:'formal_admin',displayName:'正式确认测试',password:'Fictitious-formal-test-password'});
  employeeId=(await pool.query('INSERT INTO payroll.employees(name,created_by) VALUES($1,$2) RETURNING id',['甲',admin.id])).rows[0].id;
  await pool.query(`INSERT INTO payroll.wecom_members(corp_id,userid,name,department_ids,position,observed_at)
    VALUES($1,'alice','甲','["2"]','职员',now())`,[corpId]);
  await pool.query(`INSERT INTO payroll.wecom_employee_links(corp_id,userid,employee_id,reason,created_by,updated_by)
    VALUES($1,'alice',$2,'管理员逐人确认',$3,$3)`,[corpId,employeeId,admin.id]);
  workspaces=createWorkspaceService(pool);
  confirmation=createWorkspaceConfirmationService({pool,corpId});
  summary=createPayrollSummaryService({pool,corpId});
},{timeout:60000});
after(async()=>{await database?.close();});

test('real saved net workspace requires explicit identity and only confirmed current revision is counted',async()=>{
  const saved=await workspaces.save({actorId:admin.id,requestKey:randomUUID(),snapshot:snapshot()});
  let report=await summary.summary({from:'2026-07',to:'2026-09'});
  assert.equal(report.months[1].missing,true,'an unconfirmed draft contributes nothing');
  await assert.rejects(confirmation.confirm({actorId:admin.id,workspaceId:saved.id,revision:1,
    requestKey:randomUUID(),mappings:[]}),/逐名确认/);
  const mappings=[{resultIndex:0,rosterRow:2,employeeId,reason:'核对企微 UserID 和花名册来源行'}];
  const key=randomUUID();
  const first=await confirmation.confirm({actorId:admin.id,workspaceId:saved.id,revision:1,requestKey:key,mappings});
  assert.equal(first.status,'confirmed');
  assert.deepEqual(await confirmation.confirm({actorId:admin.id,workspaceId:saved.id,revision:1,requestKey:key,mappings}),first);
  report=await summary.summary({from:'2026-07',to:'2026-09'});
  assert.deepEqual(report.months.map(row=>row.totalNet),[null,9000,null]);
  assert.equal(report.months[1].headcount,1);
  assert.equal(report.people[0].userid,'alice');
  assert.equal(report.people[0].months[0].net,null);
  const revised=await workspaces.save({actorId:admin.id,id:saved.id,expectedRevision:1,
    requestKey:randomUUID(),snapshot:snapshot(9500)});
  assert.equal(revised.revision,2);
  report=await summary.summary({from:'2026-08',to:'2026-08'});
  assert.equal(report.months[0].totalNet,9000,'unconfirmed revision cannot replace current formal pay');
  const second=await confirmation.confirm({actorId:admin.id,workspaceId:saved.id,revision:2,
    requestKey:randomUUID(),mappings});
  assert.equal(second.batchId,first.batchId,'same workspace/month revises the formal batch');
  report=await summary.summary({from:'2026-08',to:'2026-08'});
  assert.equal(report.months[0].totalNet,9500);
  assert.equal(report.people.length,1);
  const runs=(await pool.query('SELECT id,status FROM payroll.runs WHERE batch_id=$1 ORDER BY version',[first.batchId])).rows;
  assert.equal(runs.filter(row=>row.status==='confirmed').length,2,'prior confirmed net run remains auditable');
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM payroll.workspace_confirmations')).rows[0].count,2);
});

test('roster calculation conflicts block formalization and leave no batch writes',async()=>{
  const conflicted=snapshot();conflicted.results.net[0].regularizationConflict=true;
  conflicted.results.net[0].exception='转正日期冲突：花名册 2026-08-10，基本工资表 2026-08-11';
  const saved=await workspaces.save({actorId:admin.id,requestKey:randomUUID(),snapshot:conflicted});
  const before=(await pool.query('SELECT count(*)::int AS count FROM payroll.batches')).rows[0].count;
  await assert.rejects(confirmation.confirm({actorId:admin.id,workspaceId:saved.id,revision:1,
    requestKey:randomUUID(),mappings:[{resultIndex:0,rosterRow:2,employeeId,reason:'测试拒绝'}]}),/转正日期冲突/);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM payroll.batches')).rows[0].count,before);
});

test('frozen roster values cannot be silently replaced by a changed payroll result',async()=>{
  const inconsistent=snapshot(9300,'2027-03');
  for(const result of [...inconsistent.results.gross,...inconsistent.results.net]) result.company='另一家公司';
  const saved=await workspaces.save({actorId:admin.id,requestKey:randomUUID(),snapshot:inconsistent});
  await assert.rejects(confirmation.confirm({actorId:admin.id,workspaceId:saved.id,revision:1,
    requestKey:randomUUID(),mappings:[{resultIndex:0,rosterRow:2,employeeId,reason:'需拦截来源不一致'}]}),/原始花名册.*签约公司.*不一致/);
});

test('restricted API role can confirm a new cross-year month but cannot erase formal payroll',async()=>{
  const role='formal_api_'+randomUUID().replaceAll('-','').slice(0,12);
  const password='only-for-formal-runtime-role-tests';
  await provisionRuntimeRole(pool,{role,password});
  const runtime=createPool({...database.connectionOptions,user:role,password});
  try {
    const saved=await createWorkspaceService(runtime).save({actorId:admin.id,requestKey:randomUUID(),snapshot:snapshot(8200,'2025-12')});
    const result=await createWorkspaceConfirmationService({pool:runtime,corpId}).confirm({actorId:admin.id,
      workspaceId:saved.id,revision:1,requestKey:randomUUID(),mappings:[{resultIndex:0,rosterRow:2,
        employeeId,reason:'跨年月份逐人核对'}]});
    assert.equal(result.month,'2025-12');
    const report=await createPayrollSummaryService({pool:runtime,corpId}).summary({from:'2025-12',to:'2026-08'});
    assert.equal(report.months[0].totalNet,8200);
    assert.equal(report.months.at(-1).totalNet,9500);
    assert.equal(report.months.at(-1).cumulativeNet,17700);
    assert.equal(report.months[1].totalNet,null,'gaps are not zero-valued payroll');
    await assert.rejects(runtime.query('DELETE FROM payroll.items'),/permission denied/);
  } finally {await runtime.end();}
});

test('regularization split is checked and formal item retains the roster source row',async()=>{
  const candidate=snapshot(9100,'2027-01');
  candidate.sources.roster.rows[0]={...source,转正日期:'2027-01-15',员工类型:'试用'};
  candidate.sources.salary={rows:[{姓名:'甲',基本工资:10000,转正前工资:8000,转正后工资:12000}],
    sheetName:'员工基本工资',sourceStartRow:2};
  for(const result of [...candidate.results.gross,...candidate.results.net]) {
    Object.assign(result,{regularizationDate:'2027-01-15',employmentType:'正式',
      probationWorkdays:10,regularWorkdays:12,probationSalary:4000,regularSalary:6000});
  }
  const saved=await workspaces.save({actorId:admin.id,requestKey:randomUUID(),snapshot:candidate});
  const confirmed=await confirmation.confirm({actorId:admin.id,workspaceId:saved.id,revision:1,
    requestKey:randomUUID(),mappings:[{resultIndex:0,rosterRow:2,employeeId,reason:'逐行核对转正分段'}]});
  const item=(await pool.query('SELECT source_row_ids FROM payroll.items WHERE run_id=$1',[confirmed.runId])).rows[0];
  const rows=(await pool.query(`SELECT s.id,i.source_type,s.row_number FROM payroll.source_rows s
    JOIN payroll.imports i ON i.id=s.import_id WHERE s.batch_id=$1 ORDER BY i.source_type`,[confirmed.batchId])).rows;
  assert.equal(rows.length,2);
  assert.equal(rows.find(row=>row.source_type==='roster').id,item.source_row_ids[0]);
  const bad=snapshot(9200,'2027-02');
  for(const result of [...bad.results.gross,...bad.results.net]) {
    Object.assign(result,{regularizationDate:'2027-02-15',probationWorkdays:10,regularWorkdays:11,
      probationSalary:4000,regularSalary:6000});
  }
  const badSaved=await workspaces.save({actorId:admin.id,requestKey:randomUUID(),snapshot:bad});
  await assert.rejects(confirmation.confirm({actorId:admin.id,workspaceId:badSaved.id,revision:1,
    requestKey:randomUUID(),mappings:[{resultIndex:0,rosterRow:2,employeeId,reason:'不应通过'}]}),/天数之和/);
});
