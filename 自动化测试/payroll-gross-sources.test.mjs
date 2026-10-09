import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import XLSX from 'xlsx';

const base=new URL('../public/salary/',import.meta.url);
function app(){
  const element={innerHTML:'',value:'',dataset:{},addEventListener(){},querySelectorAll:()=>[],classList:{add(){},remove(){},toggle(){}}};
  const context=vm.createContext({document:{getElementById:()=>({...element}),querySelectorAll:()=>[],addEventListener(){}},window:{XLSX},structuredClone,setTimeout:()=>0,clearTimeout(){},__PAYROLL_TEST__:true});
  const run=code=>vm.runInContext(code,context);
  for(const file of ['payroll-engine.js','payroll-email-engine.js'])run(fs.readFileSync(new URL(file,base),'utf8'));
  run(fs.readFileSync(new URL('index.html',base),'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
  run('render=()=>{};showToast=()=>{};bindView=()=>{};');
  for(const file of ['workbench-core.js','workbench-pages.js','workbench-ui.js'])run(fs.readFileSync(new URL(file,base),'utf8'));
  run(`sourceRows={roster:[{姓名:'测试员工',工号:'TEST001',公司:'测试公司',一级部门:'研发',员工状态:'在职',入职日期:'2024-01-01',是否实习生:'否'}],salary:[{姓名:'测试员工',基本工资:10000}],attendance:[{姓名:'测试员工',实际出勤天数:22}]};state.liveImport=true;state.payrollStage='gross';currentMonth='2026-09';currentWorkdays=22;recalculateEmployees();state.selectedId=employees[0].id;`);
  return run;
}

test('gross uploads, mapping, employee detail and export need no contributions',()=>{
  const run=app();
  assert.deepEqual(Array.from(run('stageSheets().map(s=>s.key)')),['roster','salary','performance','attendance','other']);
  for(const code of ['PayrollWorkbenchPages.upload()','PayrollWorkbenchPages.mapping()','PayrollWorkbenchUI.ledger(employees[0])','renderGrossResults()'])assert.doesNotMatch(run(code),/个人社保|个人公积金|个税测算参考|data-source-input="(?:social|fund|netSocial|netFund)"/);
  assert.doesNotMatch(run('visibleIssues(employees[0]).join("；")'),/社保|公积金/);
  assert.equal(run('employees[0].gross'),10000);
  assert.equal(run('exportHeaders(true).includes("个人社保")'),false);
  assert.equal(run('exportHeaders(true).includes("个人公积金")'),false);
  assert.equal(run('detailSheet(true)[excelColumn(exportHeaders(true).indexOf("应发工资"))+"3"].v'),10000);
});

test('legacy gross uploads and adjustments cannot affect gross payroll',()=>{
  const run=app();
  run(`sourceRows.social=[{姓名:'测试员工',个人总计:600},{姓名:'测试员工',个人总计:999}];sourceRows.fund=[{姓名:'测试员工',个人缴纳:'无效'}];PayrollWorkbench.data().gross[PayrollWorkbench.key(employees[0])]={social:700,fund:400};recalculateEmployees();`);
  assert.equal(run('employees[0].gross'),10000);
  assert.equal(run('employees[0].social'),0);
  assert.equal(run('employees[0].fund'),0);
  assert.doesNotMatch(run('visibleIssues(employees[0]).join("；")'),/社保|公积金|重复/);
  assert.throws(()=>run('PayrollWorkbench.saveChange(employees[0],"social",100,"调整")'),/第二阶段/);
});

test('gross batch matching directs contributions to net stage',()=>{
  const run=app();
  for(const [file,row] of [['社保.xlsx',{姓名:'测试员工',个人总计:600}],['公积金.xlsx',{姓名:'测试员工',个人缴纳:400}],['数据.xlsx',{姓名:'测试员工',个人社保:600}]]){
    const result=run(`matchSource(${JSON.stringify(file)},[${JSON.stringify(row)}])`);
    assert.equal(result.key,'');assert.match(result.reason,/实发阶段/);
  }
  assert.throws(()=>run('commitSource("social",{filename:"社保.xlsx",rows:[]})'),/实发阶段/);
  run('state.payrollStage="net"');
  assert.equal(run('matchSource("社保.xlsx",[{姓名:"测试员工",个人总计:600}]).key'),'netSocial');
  assert.equal(run('matchSource("公积金.xlsx",[{姓名:"测试员工",个人缴纳:400}]).key'),'netFund');
});

test('net still deducts contributions exactly once with matching export formulas',()=>{
  const run=app();
  run(`sourceRows.netSocial=[{姓名:'测试员工',个人总计:500,公司总计:1000}];sourceRows.netFund=[{姓名:'测试员工',个人缴纳:300,公司缴纳:300}];sourceRows.tax=[{姓名:'测试员工',税:200}];sourceRows.afterTax=[{姓名:'测试员工',其它代扣:100}];state.payrollStage='net';recalculateEmployees();`);
  assert.equal(run('employees[0].net'),8900);assert.equal(run('employees[0].companyCost'),11300);
  assert.match(run('PayrollWorkbenchPages.upload()'),/data-source-input="netSocial"/);
  assert.match(run('PayrollWorkbenchPages.upload()'),/data-source-input="netFund"/);
  assert.equal(run('detailSheet(false)[excelColumn(exportHeaders(false).indexOf("实发工资"))+"3"].v'),8900);
  assert.match(run('detailSheet(false)[excelColumn(exportHeaders(false).indexOf("实发工资"))+"3"].f'),/ROUND/);
  run('state.payrollStage="gross";recalculateEmployees()');
  assert.equal(run('employees[0].gross'),10000);assert.equal(run('employees[0].social'),0);
});

test('gross export round-trip compares equal and net warns only at its own stage',()=>{
  const run=app();
  run(`globalThis.sheet=detailSheet(true);globalThis.rows=PayrollEngine.rowsFromGrid(XLSX.utils.sheet_to_json(sheet,{header:1,defval:null,raw:true}));` .replace('XLSX.utils','window.XLSX.utils'));
  run('state.payrollStage="net";commitSource("grossUpload",{filename:"应发工资.xlsx",rows});recalculateEmployees()');
  assert.equal(run('state.comparison.status'),'equal');
  assert.match(run('visibleIssues(employees[0]).join("；")'),/个人社保未上传/);
  run('state.payrollStage="gross";recalculateEmployees()');
  assert.doesNotMatch(run('visibleIssues(employees[0]).join("；")'),/社保|公积金/);
});


test('legacy cached contribution warnings stay net-only without hiding wage problems',()=>{
  const run=app();
  run(`employees[0].exception='未上传员工基本工资表；社保明细未找到匹配；考勤表实际出勤天数无效';employees[0].deductionIssues=['个人社保未上传，按 0 计算','个人公积金未上传，按 0 计算'];`);
  const issues=Array.from(run('visibleIssues(employees[0],"gross")'));
  assert.equal(issues.length,2);
  assert.match(issues.join('；'),/基本工资/);
  assert.match(issues.join('；'),/出勤/);
  assert.doesNotMatch(run('PayrollWorkbenchUI.detail()'),/个人社保未上传|个人公积金未上传|社保明细|个税测算参考/);
  assert.doesNotMatch(run('detailSheet(true).A3.c[0].t'),/社保|公积金/);
  assert.match(run('visibleIssues(employees[0],"net").join("；")'),/个人社保未上传/);
  assert.match(run('visibleIssues(employees[0],"net").join("；")'),/个人公积金未上传/);
});
