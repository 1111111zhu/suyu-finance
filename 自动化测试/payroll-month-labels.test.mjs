import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import XLSX from 'xlsx';
const base=new URL('../public/salary/',import.meta.url);
function app(){
  const el={addEventListener(){},classList:{add(){},remove(){},toggle(){}},textContent:''};
  const context=vm.createContext({Date,document:{getElementById:()=>({...el}),querySelectorAll:()=>[],addEventListener(){}},window:{XLSX},structuredClone,setTimeout:()=>0,clearTimeout(){}});
  vm.runInContext(fs.readFileSync(new URL('payroll-engine.js',base),'utf8'),context);
  vm.runInContext(fs.readFileSync(new URL('index.html',base),'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1],context);
  vm.runInContext('render=()=>{};showToast=()=>{};',context);
  return {context,run:code=>vm.runInContext(code,context)};
}
test('payroll labels derive from dates and position without mandatory status/type columns',()=>{
  const {run}=app();
  for(const [row,tags,status,intern] of [
    [{姓名:'普通',职位:'工程师',入职时间:'2025-01-01',转正日期:'2025-04-01'},['正职'],'在职',false],
    [{姓名:'新人',职位:'工程师',入职时间:'2026/09/15'},['入职'],'入职',false],
    [{姓名:'转正',职位:'工程师',转正日期:46280},['转正'],'在职',false],
    [{姓名:'合同终止',职位:'工程师',劳动合同止:'2026-09-30'},['离职'],'离职',false],
    [{姓名:'离职',离职日期:'2026-09-01'},['离职'],'离职',false],
    [{姓名:'实习',职位:'软件实习生',员工类型:'正式',是否实习生:'否'},['实习生'],'在职',true],
    [{姓名:'重叠',职位:'实习生',入职时间:'2026-09-01',转正日期:'2026-09-15',离职日期:'2026-09-30'},['实习生'],'离职',true]
  ]) {
    const r=JSON.parse(JSON.stringify(run(`PayrollEngine.normalizeRosterRow(${JSON.stringify(row)},undefined,'2026-09')`)));
    assert.deepEqual(r.values.payrollTags,tags);assert.equal(r.values.status,status);assert.equal(r.values.isIntern,intern);assert.deepEqual(r.issues,[]);
  }
  const invalid=run("PayrollEngine.normalizeRosterRow({姓名:'无效',职位:'工程师',转正日期:'2026-09-31'},undefined,'2026-09')");
  assert.ok(invalid.issues.some(i=>i.field==='regularizationDate'));
  assert.equal(run("PayrollEngine.normalizeRosterRow({姓名:'占位',职位:'工程师',转正日期:'/'},undefined,'2026-09').issues.length"),0);
});
test('month labels select the existing hire, departure, regularization and internship pay rules',()=>{
  const {run}=app();
  run(`sourceRows={roster:[{姓名:'正职',职位:'工程师',入职时间:'2025-01-01'},
    {姓名:'入职',职位:'工程师',入职时间:'2026-09-15'},
    {姓名:'离职',职位:'工程师',劳动合同止:'2026-09-20'},
    {姓名:'转正',职位:'工程师',转正日期:'2026-09-15'},
    {姓名:'实习',职位:'实习生'},{姓名:'先离后转',职位:'工程师',离职日期:'2026-09-11',转正日期:'2026-09-12'}],
    salary:['正职','入职','离职','转正','实习'].map(姓名=>({姓名,基本工资:2175,绩效基数:1000,转正前工资:2200,转正后工资:4400})),
    performance:['正职','入职','离职','转正'].map(姓名=>({姓名,绩效系数:1})),
    attendance:['正职','入职','离职','转正','实习'].map(姓名=>({姓名,实际出勤天数:20,事假天数:1}))};
    state.liveImport=true;applyPayrollSettings('2026-09',22);`);
  assert.equal(run("employees.find(e=>e.name==='正职').deductDays"),1);
  assert.equal(run("employees.find(e=>e.name==='入职').effectiveScore"),0);
  assert.equal(run("employees.find(e=>e.name==='离职').deductDays"),1.75);
  assert.equal(run("employees.find(e=>e.name==='转正').gross"),run('PayrollEngine.round((2200*10/22+4400*12/22)*(1-1/21.75))'));
  assert.equal(run("employees.find(e=>e.name==='实习').gross"),2175);
  assert.deepEqual(JSON.parse(JSON.stringify(run("employees.find(e=>e.name==='先离后转').payrollTags"))),['离职']);
  assert.equal(run("employees.find(e=>e.name==='先离后转').regularizationActive"),false);
  assert.equal(run('employees.every(e=>e.payrollTags.length===1)'),true);
  run("applyPayrollSettings('2026-10',22)");
  assert.deepEqual(JSON.parse(JSON.stringify(run("employees.find(e=>e.name==='入职').payrollTags"))),['正职']);
  assert.equal(run("employees.find(e=>e.name==='转正').regularizationActive"),false);
});
test('all roster sheets survive parsing but only current-month departures enter payroll',async()=>{
  const {run,context}=app(),book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['姓名','职位','入职时间'],['正职','工程师','2025-01-01']]),'在职');
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['姓名','职位','离职日期'],['历史','工程师','2026-08-31'],[],['本月','工程师','2026-09-20'],['以后','工程师','2026-10-20']]),'离职');
  const buffer=XLSX.write(book,{type:'buffer',bookType:'xlsx'});
  context.file={name:'花名册.xlsx',arrayBuffer:async()=>buffer};
  context.parsed=await run('parseXlsxFile(file)');
  assert.equal(run('parsed.length'),4);assert.equal(run("parsed.find(r=>r.姓名==='本月')._rosterSource.rowNumber"),4);
  run("sourceRows={roster:parsed};state.liveImport=true;applyPayrollSettings('2026-09',22)");
  assert.deepEqual(JSON.parse(JSON.stringify(run('employees.map(e=>e.name)'))),['正职','本月']);
  assert.equal(run("employees.find(e=>e.name==='本月').status"),'离职');
  run('sourceRows.roster=JSON.parse(JSON.stringify(sourceRows.roster));recalculateEmployees()');
  assert.equal(run("employees.find(e=>e.name==='本月').status"),'离职');
  run("applyPayrollSettings('2026-10',22)");
  assert.deepEqual(JSON.parse(JSON.stringify(run('employees.map(e=>e.name)'))),['正职','以后']);
});
test('supplied roster has no missing status/type payroll errors',{skip:!process.env.ROSTER_TEST_FILE},async()=>{
  const {context,run}=app();const bytes=fs.readFileSync(process.env.ROSTER_TEST_FILE);
  context.file={name:'花名册.xlsx',arrayBuffer:async()=>bytes};
  context.parsed=await run('parseXlsxFile(file)');
  run("sourceRows={roster:parsed};state.liveImport=true;applyPayrollSettings('2026-09',22)");
  assert.ok(run('employees.length')>0);
  assert.equal(run("employees.flatMap(e=>e.rosterIssues).filter(i=>['status','employmentType','isIntern'].includes(i.field)).length"),0);
  const counts=run("employees.reduce((a,e)=>{for(const tag of e.payrollTags)a[tag]=(a[tag]||0)+1;return a},{})");
  console.log('Supplied roster month labels:',JSON.stringify(counts),'employees:',run('employees.length'));
});

test('numeric employee numbers are usable while text leading zeros and bank validation survive',()=>{
 const {run}=app();
 for(const value of [127,0,'001','SX17']) {
  const row=JSON.parse(JSON.stringify(run(`PayrollEngine.normalizeRosterRow({姓名:'测试',工号:${JSON.stringify(value)},职位:'工程师'},undefined,'2026-09')`)));
  assert.equal(row.values.employeeNumber,String(value));
  assert.deepEqual(row.issues,[]);
 }
 for(const value of [-1,1.5,9007199254740992])
  assert.ok(run(`PayrollEngine.normalizeRosterRow({姓名:'测试',工号:${value}},undefined,'2026-09').issues.some(i=>i.field==='employeeNumber' && i.reason==='invalid')`));
 assert.ok(run("PayrollEngine.normalizeRosterRow({姓名:'测试',银行卡号:123456},undefined,'2026-09').issues.some(i=>i.field==='bankCard' && i.reason==='text-required')"));
});

test('attendance days use the new header and accept the legacy header',()=>{
 const {run}=app();
 for(const header of ['实际出勤天数','实发薪天数']) {
  run(`sourceRows={roster:[{姓名:'测试',职位:'工程师'}],attendance:[{姓名:'测试',[${JSON.stringify(header)}]:'20.5'}]};state.liveImport=true;applyPayrollSettings('2026-09',22)`);
  assert.equal(run('employees[0].payableDays'),20.5);
  assert.deepEqual(JSON.parse(JSON.stringify(run('employees[0].paidDayIssues'))),[]);
 }
});
