import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseSheet, pickSheet, preparePeople, salaryRows, previousPayrollMonth, occursInPayrollMonth } from '../app/salary-directory/roster-model.ts';

function engine() {
  const context=vm.createContext({Date});
  vm.runInContext(fs.readFileSync(new URL('../public/salary/payroll-engine.js',import.meta.url),'utf8'),context);
  return context.PayrollEngine;
}
const headers=['姓名','工号','签约公司','员工状态','员工类型','入职时间','转正日期','离职日期','银行卡号','开户行'];
const row=(name,status,type='普通员工')=>[name,name+'001','测试公司',status,type,'2025-01-01','2025-03-01',status.includes('离职')?'2026-09-30':'','000123456789','测试银行'];

test('previous payroll month follows Shanghai time across years and UTC month boundaries',()=>{
  assert.equal(previousPayrollMonth(new Date('2026-10-04T10:00:00Z')),'2026-09');
  assert.equal(previousPayrollMonth(new Date('2027-01-01T00:00:00Z')),'2026-12');
  assert.equal(previousPayrollMonth(new Date('2026-09-30T16:01:00Z')),'2026-09');
  assert.equal(previousPayrollMonth(new Date('2026-09-30T15:59:00Z')),'2026-08');
});

test('regularization and departure dates count only within the selected payroll month',()=>{
  assert.equal(occursInPayrollMonth('2026-09-01','2026-09'),true);
  assert.equal(occursInPayrollMonth('2026-09-30','2026-09'),true);
  assert.equal(occursInPayrollMonth('2026-08-31','2026-09'),false);
  assert.equal(occursInPayrollMonth('2026-10-01','2026-09'),false);
  assert.equal(occursInPayrollMonth('2026-02-29','2026-02'),false);
  assert.equal(occursInPayrollMonth('2024-02-29','2024-02'),true);
  assert.equal(occursInPayrollMonth('','2026-09'),false);
});

test('the active sheet wins its explicit role even when the left sheet has more recognized fields',()=>{
  const e=engine();
  const active=parseSheet('2026在职员工',[headers,row('甲','在职'),row('乙','在职（实习）','实习生'),row('新实习丁','入职','实习生'),row('丙','离职')],e);
  const left=parseSheet('离职员工',[headers,row('丁','离职')],e);
  assert.equal(pickSheet([left,active],'active'),'2026在职员工');
  assert.equal(pickSheet([active,left],'left'),'离职员工');
  assert.equal(parseSheet('使用说明',[['项目','说明'],['说明','不要读取在职表']],e),null);
  const result=preparePeople(active,'active',e);
  assert.equal(result.people.length,3);
  assert.equal(result.excluded.length,1);
  assert.equal(result.people[1].values.status,'在职');
  assert.equal(result.people[1].values.isIntern,true);
  assert.equal(result.people.flatMap(person=>person.issues).length,0);
  const transferred=salaryRows(result.people,e);
  assert.equal(transferred.length,3);
  assert.equal(transferred[2].是否入离职,'入职');
  assert.equal(transferred[1].是否实习生,true);
  assert.equal(transferred[0].银行卡号,'000123456789');
  assert.ok(!transferred.some(person=>person.姓名==='丁'||person.姓名==='丙'));
});

test('ambiguous sheets, unknown status, duplicates and real type conflicts stay reviewable',()=>{
  const e=engine();
  const a=parseSheet('在职一',[headers,row('甲','在职')],e);
  const b=parseSheet('在职二',[headers,row('甲','在职')],e);
  assert.equal(pickSheet([a,b],'active'),'');
  const sheet=parseSheet('在职员工',[headers,row('甲','在职'),row('甲','在职'),row('乙','在职/离职'),row('丙','未知')],e);
  const result=preparePeople(sheet,'active',e);
  assert.equal(result.people.length,2);
  assert.equal(result.excluded.length,2);
  assert.ok(result.issues.some(issue=>issue.reason==='duplicate'));
  const missing=parseSheet('在职员工',[['姓名','员工类型'],['甲','实习生']],e);
  assert.equal(preparePeople(missing,'active',e).people.length,0);
  const conflict=parseSheet('在职员工',[[...headers,'是否实习生'],[...row('甲','在职','实习生'),'否']],e);
  assert.ok(preparePeople(conflict,'active',e).people[0].issues.some(issue=>issue.reason==='conflict'));
});

test('manual mapping applies separately per source sheet and Excel dates remain normalized',()=>{
  const e=engine();
  const sheet=parseSheet('在职员工',[['姓名','人员状态','员工类型','入职时间'],['甲','在职','技术人员',43831]],e);
  assert.equal(preparePeople(sheet,'active',e).people.length,0);
  const result=preparePeople(sheet,'active',e,{status:'人员状态',isIntern:'员工类型'});
  assert.equal(result.people.length,1);
  assert.equal(result.people[0].values.isIntern,false);
  assert.equal(result.people[0].values.join,'2020-01-01');
  assert.equal(preparePeople(sheet,'left',e,{status:'人员状态'}).people.length,0);
});

function payroll() {
  const element={addEventListener(){},classList:{add(){},remove(){},toggle(){}},textContent:''};
  const context=vm.createContext({Date,document:{getElementById:()=>({...element}),querySelectorAll:()=>[],addEventListener(){}},window:{},structuredClone,setTimeout:()=>0,clearTimeout(){}});
  vm.runInContext(fs.readFileSync(new URL('../public/salary/payroll-engine.js',import.meta.url),'utf8'),context);
  const source=fs.readFileSync(new URL('../public/salary/index.html',import.meta.url),'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace("    render('overview');\n  ",'');
  vm.runInContext(source,context); vm.runInContext('render=()=>{};showToast=()=>{};',context);
  return code=>vm.runInContext(code,context);
}
test('prepared roster creates a new draft, excludes leavers and keeps the original salary batch intact',()=>{
  const run=payroll();
  run("sourceRows={roster:[{姓名:'原批次员工',员工状态:'在职',员工类型:'正式'}],salary:[{姓名:'原批次员工',基本工资:9000}]};state.liveImport=true;recalculateEmployees();saveBatchData();globalThis.originalBatch=currentBatch();globalThis.originalCount=state.batches.length;");
  const payload={month:'2026-10',filename:'员工信息表.xlsx',sheetName:'在职员工',rows:[{姓名:'甲',员工状态:'在职',员工类型:'技术人员',入职日期:'2025-01-01'},{姓名:'实习乙',员工状态:'入职',员工类型:'实习',是否实习生:true,入职日期:'2026-10-01'}]};
  run(`globalThis.prepared=${JSON.stringify(payload)}`);
  assert.equal(run("receivePreparedRoster(prepared,'transfer-1')"),2);
  assert.equal(run('state.batches.length-originalCount'),1);
  assert.equal(run('currentBatch().month'),'2026-10');
  assert.equal(run('sourceRows.roster.length'),2);
  assert.equal(run('employees.filter(e=>e.isIntern).length'),1);
  assert.equal(run('originalBatch.data.sourceRows.salary[0].基本工资'),9000);
  run("receivePreparedRoster(prepared,'transfer-1')");
  assert.equal(run('state.batches.length-originalCount'),1);
  assert.throws(()=>run("receivePreparedRoster({...prepared,rows:[{姓名:'离职丙',员工状态:'离职',员工类型:'正式',离职日期:'2026-09-30'}]},'transfer-2')"),/非在职/);
  assert.equal(run('state.batches.length-originalCount'),1);
});

test('payroll parameter summary and form reflect the selected draft month and days',()=>{
  const run=payroll();
  run(fs.readFileSync(new URL('../public/salary/workbench-pages.js',import.meta.url),'utf8'));
  run("currentMonth='2026-10';currentWorkdays=19.5;state.payrollStage='gross'");
  const page=run('PayrollWorkbenchPages.upload()');
  assert.doesNotMatch(page,/wb-parambar/);
  assert.match(page,/id="payrollMonth" value="10"/);
  assert.ok(page.indexOf('wb-upload-top')<page.indexOf('wb-run-panel'));
  assert.match(page,/id="payrollSettings"/);
  assert.match(page,/id="payrollDays"[^>]*value="19.5"/);
});
