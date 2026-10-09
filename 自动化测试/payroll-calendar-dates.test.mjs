import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import XLSX from 'xlsx';
import { execFileSync } from 'node:child_process';
import { parseSheet, preparePeople, salaryRows } from '../app/salary-directory/roster-model.ts';
const base=new URL('../public/salary/',import.meta.url);
function app(){
 const element={innerHTML:'',value:'',dataset:{},addEventListener(){},querySelectorAll:()=>[],classList:{add(){},remove(){},toggle(){}}};
 const c=vm.createContext({document:{getElementById:()=>({...element}),querySelectorAll:()=>[],addEventListener(){}},window:{XLSX},structuredClone,setTimeout:()=>0,clearTimeout(){},__PAYROLL_TEST__:true});
 const run=code=>vm.runInContext(code,c);
 for(const file of ['payroll-engine.js','payroll-email-engine.js'])run(fs.readFileSync(new URL(file,base),'utf8'));
 run(fs.readFileSync(new URL('index.html',base),'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
 run('render=()=>{};showToast=()=>{};bindView=()=>{};');
 for(const file of ['workbench-core.js','workbench-pages.js','workbench-ui.js'])run(fs.readFileSync(new URL(file,base),'utf8'));
 run('render=()=>{};showToast=()=>{};bindView=()=>{};');
 run(`currentMonth='2026-09';currentWorkdays=22;state.sourceStatus={};sourceRows={};state.liveImport=true;state.payrollStage='gross';state.batches=[{name:'测试批次',month:currentMonth,workdays:22,active:true,draftOrigin:'empty',data:{internDailyRates:{}}}];`);
 return {run,importFiles:run('importFiles'),parse:run('parseXlsxFile')};
}

function calendarBook(date1904=false) {
 const book=XLSX.utils.book_new();book.Workbook={WBProps:{date1904}};
 const sheet=XLSX.utils.aoa_to_sheet([['姓名','工号','入职时间','离职日期','职位','金额','工时'],['测试甲','001',44378,46273,'工程师',1000,0.5],['空日期乙','002','','','工程师',2000,0.25]]);
 sheet.C2.z='yyyy/m/d';sheet.D2.z='yyyy/m/d';sheet.G2.z='hh:mm';
 XLSX.utils.book_append_sheet(book,sheet,'在职');
 return XLSX.write(book,{type:'array',bookType:'xlsx'});
}
function exported(run,gross=true) {
 const sheet=run(`detailSheet(${gross})`),book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'明细');
 const saved=XLSX.read(XLSX.write(book,{type:'array',bookType:'xlsx'}),{type:'array'});
 return XLSX.utils.sheet_to_json(saved.Sheets['明细'],{header:1,defval:'',raw:true}).slice(2).filter(row=>row[0]!=='合计');
}
test('serial dates survive direct payroll upload and both saved exports; blanks do not block',async()=>{
 const a=app(),bytes=calendarBook();
 await a.importFiles([{name:'花名册.xlsx',arrayBuffer:async()=>bytes}],'roster');
 assert.equal(a.run("sourceRows.roster[0]['入职时间']"),'2021-07-01');
 assert.equal(a.run("sourceRows.roster[0]['离职日期']"),'2026-09-08');
 assert.equal(a.run('employees.length'),2);
 for(const gross of [true,false]) {
  if(!gross)a.run("state.payrollStage='net';recalculateEmployees()");
  const rows=exported(a.run,gross);
  const first=rows.find(row=>row[0]==='测试甲'),blank=rows.find(row=>row[0]==='空日期乙');
  assert.equal(first[7],'2021-07-01');assert.equal(first[8],'2026-09-08');
  assert.equal(blank[7],'');assert.equal(blank[8],'');
 }
});

test('personnel preparation preserves original date cells before payroll transfer',()=>{
 const a=app(),E=a.run('PayrollEngine'),book=E.readSpreadsheet(XLSX,calendarBook(),'花名册.xlsx',{cellDates:false});
 const sheet=parseSheet('在职',XLSX.utils.sheet_to_json(book.Sheets['在职'],{header:1,defval:null,raw:true}),E);
 sheet.rows[0].raw['员工状态']='在职';sheet.rows[1].raw['员工状态']='在职';sheet.headers.push('员工状态');
 const prepared=preparePeople(sheet,'active',E),rows=salaryRows(prepared.people,E);
 assert.equal(rows[0]['入职日期'],'2021-07-01');assert.equal(rows[0]['离职日期'],'2026-09-08');
 assert.equal(book.Sheets['在职'].F2.v,1000);assert.equal(book.Sheets['在职'].G2.v,0.5);
 sheet.rows[0].raw['入职时间']='2021/7/1';sheet.rows[0].raw['离职日期']='';
 const raw=salaryRows(preparePeople(sheet,'active',E).people,E)[0];
 assert.equal(raw['入职日期'],'2021/7/1');assert.equal(raw['离职日期']??'','');
});

test('calendar decoding is independent of timezone and honors the 1904 workbook epoch',()=>{
 const bytes=Buffer.from(calendarBook(true)).toString('base64');
 const program=`import fs from 'node:fs';import vm from 'node:vm';import XLSX from 'xlsx';const c=vm.createContext({});vm.runInContext(fs.readFileSync('public/salary/payroll-engine.js','utf8'),c);const b=c.PayrollEngine.readSpreadsheet(XLSX,Buffer.from('${bytes}','base64'),'花名册.xlsx',{cellDates:true});console.log(JSON.stringify([b.Sheets['在职'].C2.v,b.Sheets['在职'].D2.v,b.Sheets['在职'].G2.v]));`;
 for(const TZ of ['Asia/Shanghai','UTC','America/Los_Angeles','Asia/Tokyo']) {
  const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',program],{cwd:new URL('..',import.meta.url),env:{...process.env,TZ},encoding:'utf8'}));
  assert.deepEqual(result,['2025-07-02','2030-09-09',0.5],TZ);
 }
});

test('provided roster matches original Excel calendar cells for every exported employee in both stages',{skip:!process.env.ROSTER_TEST_FILE},async()=>{
 const bytes=fs.readFileSync(process.env.ROSTER_TEST_FILE),original=XLSX.read(bytes,{type:'array',cellDates:false,cellNF:true}),expected=[];
 for(const name of original.SheetNames.filter(n=>/在职|离职/.test(n))) {
  const grid=XLSX.utils.sheet_to_json(original.Sheets[name],{header:1,defval:'',raw:true}),headers=grid[0];
  for(const [index,row] of grid.slice(1).entries()) {
   const get=label=>row[headers.indexOf(label)];
   const date=value=>typeof value==='number'?XLSX.SSF.format('yyyy-mm-dd',value,{date1904:original.Workbook?.WBProps?.date1904}):value||'';
   expected.push({sheetName:name,rowNumber:index+2,name:get('姓名'),id:String(get('工号')||''),company:get('签约公司'),join:date(get('入职时间')),leave:date(get('离职日期'))});
  }
 }
 const a=app();await a.importFiles([{name:'花名册.xlsx',arrayBuffer:async()=>bytes}],'roster');
 const people=a.run('generatedEmployees');assert.ok(people.length>=80);
 for(const gross of [true,false]) {
  if(!gross)a.run("state.payrollStage='net';recalculateEmployees()");
  const rows=exported(a.run,gross);assert.equal(rows.length,people.length);
  for(const row of rows) {
   const person=people.find(p=>p.name===row[0]);
   const matches=expected.filter(e=>e.name===person.name && e.id===person.employeeNumber && e.sheetName===person.rosterSource.sheetName && e.rowNumber===person.rosterSource.rowNumber);
   assert.equal(matches.length,1,person.name+' original row');
   assert.equal(row[7],matches[0].join,person.name+' join');assert.equal(row[8],matches[0].leave,person.name+' leave');
  }
 }
});
