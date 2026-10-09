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


test('gross and net XLSX use roster join date instead of stale employee or uploaded gross dates',()=>{
 const run=app();
 run("sourceRows.roster[0]['入职日期']='2024/3/8';sourceRows.salary[0]['入职日期']='2020-01-01';recalculateEmployees();generatedEmployees[0].join='2021-01-01';generatedEmployees[0].joinRaw='2021-01-01';");
 assert.equal(run('detailSheet(true).H3.v'),'2024/3/8');
 run("state.payrollStage='net';commitSource('grossUpload',{filename:'旧应发.xlsx',rows:[{姓名:'测试员工',入职日期:'2021-06-30',应发工资:10000,是否实习生:''}]});recalculateEmployees();");
 assert.equal(run('detailSheet(false).H3.v'),'2024/3/8');
 assert.equal(run('employees[0].gross'),10000);
 assert.equal(run('detailSheet(false)[excelColumn(exportHeaders().indexOf("应发工资"))+"3"].v'),10000);
 for(const value of [null,'','  ']) {
  run(`sourceRows.roster[0]['入职日期']=${JSON.stringify(value)};recalculateEmployees();`);
  assert.equal(run('detailSheet(true).H3.v'),'');
  assert.equal(run('detailSheet(false).H3.v'),'');
 }
 run('sourceRows.roster=[];recalculateEmployees()');
 assert.equal(run('detailSheet(false).H3.v'),'');
});

test('roster export dates preserve original cells and leave unmatched people blank',()=>{
 const run=app();
 run("sourceRows.roster=[{姓名:'甲',公司:'公司一',入职日期:'2024-03-08'},{姓名:'甲',公司:'公司二',入职日期:'2025-05-06'}]");
 assert.equal(run("exportRecord({name:'甲',company:'公司二',join:'2021-06-30'})['入职日期']"),'2025-05-06');
 assert.equal(run("exportRecord({name:'甲',join:'2021-06-30'})['入职日期']"),'');
 assert.equal(run("exportRecord({name:'乙',join:'2021-06-30'})['入职日期']"),'');
 run("sourceRows.roster=[{姓名:'甲',工号:'002',入职时间:45000}]");
 assert.equal(run("exportRecord({name:'甲',employeeNumber:'001'})['入职日期']"),'');
 assert.equal(run("exportRecord({name:'甲',employeeNumber:'002'})['入职日期']"),45000);
 run("sourceRows.roster=[{姓名:'甲',入职日期:'2024-03-08',入职时间:'2021-06-30'}]");
 assert.equal(run("exportRecord({name:'甲'})['入职日期']"),'2024-03-08');
});

test('serialized XLSX date cells are readable text or empty and money formulas stay intact',()=>{
 const run=app();
 run("globalThis.downloaded=[];downloadXlsx=(book,name)=>downloaded.push({book,name,bytes:window.XLSX.write(book,{bookType:'xlsx',type:'array'})});downloadGross();state.payrollStage='net';recalculateEmployees();downloadCsv();");
 const files=run('downloaded');
 assert.equal(files.length,2);
 for(const file of files) {
  const book=XLSX.read(file.bytes,{type:'array'}), sheet=book.Sheets[book.SheetNames[0]];
  assert.equal(sheet.H3.v,'2024-01-01');assert.equal(sheet.H3.t,'s');
 }
 run("sourceRows.roster[0]['入职日期']='';downloadGross();downloadCsv();");
 for(const file of Array.from(run('downloaded')).slice(2)) {
  const book=XLSX.read(file.bytes,{type:'array'}), sheet=book.Sheets[book.SheetNames[0]];
  assert.equal(sheet.H3?.v ?? '','');
 }
});


test('both exports preserve original join and leave cells without arithmetic or contract-end fallback',()=>{
 const run=app();
 run("sourceRows.roster[0]['入职日期']='2024/1/1';sourceRows.roster[0]['离职日期']='2026/9/18';sourceRows.roster[0]['劳动合同止']='2026-09-30';recalculateEmployees();generatedEmployees[0].leave='2026-09-17';generatedEmployees[0].leaveRaw='2026-09-17';");
 assert.equal(run('detailSheet(true).I3.v'),'2026/9/18');
 assert.equal(run('detailSheet(true).H3.v'),'2024/1/1');
 run("state.payrollStage='net';commitSource('grossUpload',{filename:'旧应发.xlsx',rows:[{姓名:'测试员工',入职日期:'2021-06-30',离职日期:'2026-09-17',应发工资:10000,是否实习生:''}]});recalculateEmployees();");
 assert.equal(run('detailSheet(false).I3.v'),'2026/9/18');
 run("sourceRows.roster[0]['离职日期']='';recalculateEmployees()");
 assert.equal(run('detailSheet(true).I3.v'),'');
 assert.equal(run('detailSheet(false).I3.v'),'');
 run("sourceRows.roster[0]['离职日期']=46283;globalThis.result=exportRecord({name:'测试员工'});");
 assert.equal(run("result['离职日期']"),46283);
 run("sourceRows.roster[0]['入职日期']=new Date(2024,0,1);sourceRows.roster[0]['离职日期']=new Date(2026,8,18);globalThis.result=exportRecord({name:'测试员工'});");
 assert.equal(run("result['入职日期']===sourceRows.roster[0]['入职日期']"),true);
 assert.equal(run("result['离职日期']===sourceRows.roster[0]['离职日期']"),true);
});
