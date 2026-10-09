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


// Independent evaluation of the supported Excel expressions checks recalculated values,
// rather than merely comparing formula text or its cached value.
function recalc(sheet,address,stack=new Set()){
  const cell=sheet[address];if(!cell?.f)return Number(cell?.v)||0;
  assert.ok(!stack.has(address),'circular formula '+address);const next=new Set(stack).add(address);
  let expression=cell.f.replace(/([A-Z]+)(\d+):([A-Z]+)(\d+)/g,(_,a,b,c,d)=>{
    assert.equal(a,c);return Array.from({length:Number(d)-Number(b)+1},(_,i)=>recalc(sheet,a+(Number(b)+i),next)).join(',');
  }).replace(/\b[A-Z]+\d+\b/g,ref=>String(recalc(sheet,ref,next))).replace(/(?<![<>!=])=(?!=)/g,'===');
  const DATE=(y,m,d)=>Date.UTC(y,m-1,d)/86400000;
  const NETWORKDAYS=(a,b)=>{let n=0;for(let d=a;d<=b;d++){const day=new Date(d*86400000).getUTCDay();if(day!==0&&day!==6)n++;}return n;};
  const result=Function('SUM','ROUND','IF','DATE','NETWORKDAYS',`return (${expression})`)((...v)=>v.reduce((a,b)=>a+b,0),(v,d)=>Math.sign(v)*Math.round(Math.abs(v)*10**d+1e-8)/10**d,(condition,a,b)=>condition?a:b,DATE,NETWORKDAYS);
  assert.ok(Number.isFinite(result),address+' '+cell.f);return result;
}
function verify(run,gross,required){
  const sheet=run(`detailSheet(${gross})`),fields=Array.from(run(`exportDescriptors(${gross}).map(d=>d[1])`));
  for(const field of required){const address=XLSX.utils.encode_col(fields.indexOf(field))+'3';assert.ok(sheet[address]?.f,field+' missing formula');}
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'工资表');
  const restored=XLSX.read(XLSX.write(book,{bookType:'xlsx',type:'buffer'}),{type:'buffer'}).Sheets['工资表'];
  for(const [address,cell] of Object.entries(restored))if(cell?.f){assert.equal(cell.f,sheet[address].f);assert.ok(Math.abs(recalc(restored,address)-cell.v)<1e-7,address+' recalculated amount differs: '+cell.f);}
  return {sheet:restored,ref:field=>XLSX.utils.encode_col(fields.indexOf(field))+'3'};
}
const grossComputed=['performancePay','subtotal','sickSubsidy','deductDays','attendanceDeduct','gross'];
const netComputed=['afterTaxTotal','net','companyCost'];
const scenarios=[
  ['ordinary fractional wages',`base:8000.005,post:1200.003,perfBase:1234.567,score:0.913,actualPaidDays:19,sick:1.5,personal:0.5,absent:1,meal:150.255,transit:22.333,otherAdd:3.555`],
  ['equal attendance ignores leave',`base:10000,perfBase:1000,score:0.8,actualPaidDays:22,sick:2`],
  ['departed employee',`base:10000,actualPaidDays:10,status:'离职',leave:'2026-09-15'`],
  ['late new hire',`base:10000,perfBase:2000,score:0.8,actualPaidDays:10,status:'入职',join:'2026-09-16'`],
  ['regularization monthly totals',`regularizationDate:'2026-09-16',probationTotal:9000,regularTotal:12000,actualPaidDays:22`],
  ['regularization salary components',`regularizationDate:'2026-09-16',probationBase:8000,regularBase:10000,probationPost:1000,regularPost:2000,probationPerfBase:1000,regularPerfBase:2000,score:0.8,actualPaidDays:20,sick:2`],
  ['regularization supplied after days',`regularizationDate:'2026-09-16',regularWorkdays:12,probationTotal:9000,regularTotal:12000,actualPaidDays:22`],
  ['intern daily',`isIntern:true,base:0,dailyRate:152.333,actualPaidDays:20.5`],
  ['intern fixed',`isIntern:true,base:3500,actualPaidDays:22`]
];
for(const [name,inputs] of scenarios)test(name+' formulas recalculate in both exports',()=>{
  const run=app();run(`const profile={...employees[0]._input,${inputs}};generatedEmployees=[calcSalary(profile,currentMonth,currentWorkdays)];employees=PayrollEngine.calculateNet(generatedEmployees,{netSocial:[{姓名:'测试员工',个人总计:500,公司总计:1000}],netFund:[{姓名:'测试员工',个人缴纳:300,公司缴纳:300}],tax:[{姓名:'测试员工',税:200}],afterTax:[{姓名:'测试员工',水电代扣:10,餐费代扣:30,其它代扣:20}]});state.payrollStage='net';`);
  verify(run,true,grossComputed);verify(run,false,[...grossComputed,...netComputed]);
});
test('raw inputs stay numeric and edits propagate through performance, subtotal, gross and net',()=>{
  const run=app();run(`sourceRows.salary=[{姓名:'测试员工',基本工资:10000,绩效基数:1000}];sourceRows.performance=[{姓名:'测试员工',绩效系数:0.8}];state.payrollStage='net';recalculateEmployees();`);
  const {sheet,ref}=verify(run,false,[...grossComputed,...netComputed]);
  for(const field of ['base','post','perfBase','effectiveScore','meal','payableDays','social','tax'])assert.equal(sheet[ref(field)].f,undefined,field);
  const before=recalc(sheet,ref('net'));sheet[ref('perfBase')].v+=100;
  assert.equal(recalc(sheet,ref('performancePay')),880);assert.equal(recalc(sheet,ref('net'))-before,80);
});
test('uploaded gross values remain source values while net calculations have formulas',()=>{
  const run=app();run(`sourceRows.grossUpload=[{姓名:'测试员工',公司:'测试公司',一级部门:'研发',基本工资:9000,绩效基数:1000,绩效工资:777,工资小计:9777,应发工资:9654,假勤扣薪天数:2,假勤扣款:123,是否实习生:'否'}];state.payrollStage='net';recalculateEmployees();`);
  const {sheet,ref}=verify(run,false,netComputed);
  for(const field of grossComputed)assert.equal(sheet[ref(field)].f,undefined,field+' imported directly');
  assert.equal(sheet[ref('gross')].v,9654);assert.equal(sheet[ref('subtotal')].v,9777);
});
test('blocked attendance stays blank instead of gaining a zero formula',()=>{
  const run=app();run(`sourceRows.attendance=[{姓名:'测试员工',病假天数:1}];recalculateEmployees();`);
  const {sheet,ref}=verify(run,true,['performancePay','subtotal','sickSubsidy','gross']);
  for(const field of ['deductDays','attendanceDeduct'])assert.ok(!sheet[ref(field)]?.f);
});
test('manual computed adjustments are applied once and Excel retains the final amounts',()=>{
  const run=app();run(`PayrollWorkbench.data().gross[PayrollWorkbench.key(employees[0])]={performancePay:500,sickSubsidy:120,attendanceDeduct:50,grossTarget:11000};state.payrollStage='net';recalculateEmployees();PayrollWorkbench.data().netGenerated[PayrollWorkbench.key(employees[0])]={netTarget:10700};recalculateEmployees();`);
  const {sheet,ref}=verify(run,false,[...grossComputed,...netComputed]);assert.equal(recalc(sheet,ref('gross')),11000);assert.equal(recalc(sheet,ref('net')),10700);
});
test('multiple other-source and deduction rows retain SUM formulas',()=>{
  const run=app();run(`sourceRows.other=[{姓名:'测试员工',其他加:100,其他津贴:50,其他减:10},{姓名:'测试员工',其他加:200,其他津贴:60,其他减:20}];sourceRows.afterTax=[{姓名:'测试员工',餐费代扣:30,水电代扣:10},{姓名:'测试员工',餐费代扣:40,水电代扣:20}];state.payrollStage='net';recalculateEmployees();`);
  const {sheet,ref}=verify(run,false,[...grossComputed,...netComputed,'otherAdd','otherAllow','otherReduction','mealDeduct','utility']);assert.match(sheet[ref('otherAdd')].f,/SUM\(100,200\)/);
});
test('individual slips share calculation formulas and summaries count employees with formulas',()=>{
  const run=app();run(`globalThis.captured=[];downloadXlsx=book=>captured.push(book);state.payrollStage='gross';downloadSlip();state.payrollStage='net';recalculateEmployees();downloadSlip();`);
  const books=run('captured');for(const book of books){const sheet=book.Sheets[book.SheetNames[0]];for(const [address,cell] of Object.entries(sheet))if(cell?.f)assert.ok(Math.abs(recalc(sheet,address)-cell.v)<1e-7);const labels=Object.entries(sheet).filter(([a,c])=>a.startsWith('A')&&grossComputed.some(f=>run(`exportDescriptors(true).find(d=>d[1]===${JSON.stringify(f)})[0]`)===c.v));assert.equal(labels.length,grossComputed.length);for(const [address]of labels)assert.ok(sheet['B'+address.slice(1)].f);}
  const summary=run('summarySheet()');assert.match(summary.B2.f,/COUNTIF/);assert.match(summary.B3.f,/SUM/);
  const desc=Array.from(run('exportDescriptors(false).map(d=>d[1])'));const netCol=XLSX.utils.encode_col(desc.indexOf('net'));assert.match(summary.K2.f,new RegExp(netCol+'\\$3'));
});
