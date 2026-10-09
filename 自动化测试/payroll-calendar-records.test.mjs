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
  run('render=()=>{};showToast=()=>{};bindView=()=>{};');
  return run;
}

test('gross records take original roster dates even when calculated dates and overrides are stale',()=>{
 const run=app();
 run("sourceRows.roster[0]['入职日期']='2021-07-01';sourceRows.roster[0]['离职日期']='2026/9/18';recalculateEmployees();generatedEmployees[0].join='2021-06-30';generatedEmployees[0].joinRaw='2021-06-30';generatedEmployees[0].leave='2026-09-17';generatedEmployees[0].leaveRaw='2026-09-17'");
 const record=run('exportRecord(generatedEmployees[0],true)');
 assert.equal(record['入职日期'],'2021-07-01');assert.equal(record['离职日期'],'2026/9/18');
 run("sourceRows.roster[0]['入职日期']='';sourceRows.roster[0]['离职日期']=null;sourceRows.roster[0]['劳动合同止']='2026-09-30';recalculateEmployees()");
 const blank=run('exportRecord(generatedEmployees[0],true)');assert.equal(blank['入职日期'],'');assert.equal(blank['离职日期'],'');
});
test('net records continue to use uploaded gross dates and gross amount',()=>{
 const run=app();run("state.payrollStage='net';commitSource('grossUpload',{filename:'应发.xlsx',rows:[{姓名:'测试员工',入职日期:'2021/7/1',离职日期:'2026/9/18',应发工资:9654.123,是否实习生:''}]});recalculateEmployees()");
 const record=run('exportRecord(employees[0],false)');assert.equal(record['入职日期'],'2021/7/1');assert.equal(record['离职日期'],'2026/9/18');assert.equal(record['应发工资'],9654.123);
});
test('real roster records match original calendar cells without creating an Excel',{skip:!process.env.ROSTER_TEST_FILE},async()=>{
 const run=app(),bytes=fs.readFileSync(process.env.ROSTER_TEST_FILE);run('sourceRows={};state.sourceStatus={}');
 await run('importFiles')([{name:'花名册.xlsx',arrayBuffer:async()=>bytes}],'roster');
 const original=XLSX.read(bytes,{type:'array',cellDates:false,cellNF:true}),people=run('generatedEmployees');assert.equal(people.length,84);
 for(let i=0;i<people.length;i++){
  const source=people[i].rosterSource,grid=XLSX.utils.sheet_to_json(original.Sheets[source.sheetName],{header:1,defval:'',raw:true}),row=grid[source.rowNumber-1],record=run(`exportRecord(generatedEmployees[${i}],true)`);
  for(const [label,header] of [['入职日期','入职时间'],['离职日期','离职日期']]){const raw=row[grid[0].indexOf(header)],expected=typeof raw==='number'?XLSX.SSF.format('yyyy-mm-dd',raw,{date1904:original.Workbook?.WBProps?.date1904}):raw||'';assert.equal(record[label],expected,people[i].name+' '+label);}
 }
});
