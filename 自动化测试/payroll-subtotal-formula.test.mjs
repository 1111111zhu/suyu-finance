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

test('both exports retain subtotal formulas and cached amounts through XLSX round-trip',()=>{
  const run=app();
  for(const gross of [true,false]){
    const sheet=run(`detailSheet(${gross})`), address=run(`excelColumn(exportDescriptors(${gross}).findIndex(d=>d[1]==='subtotal'))+'3'`);
    assert.match(sheet[address].f,/^ROUND\(SUM\(/);
    assert.equal(sheet[address].v,10000);
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'工资表');
    const restored=XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'}).Sheets['工资表'];
    assert.equal(restored[address].f,sheet[address].f);assert.equal(restored[address].v,10000);
    assert.match(restored[address.slice(0,-1)+'4'].f,/SUM/);
  }
});
test('special subtotals retain adjustments and daily interns reference attendance',()=>{
  const run=app();
  assert.equal(run(`subtotalFormula({base:1000,post:200,performancePay:300,subtotal:1700},f=>f)`),'ROUND(SUM(base,post,performancePay)+(200),2)');
  assert.equal(run(`subtotalFormula({isIntern:true,internPayMode:'daily',dailyRate:150,actualPaidDays:20,subtotal:3000},f=>f)`),'ROUND(actualPaidDays*150+(0),2)');
  assert.equal(run(`subtotalFormula({isIntern:true,internPayMode:'base',base:3000,subtotal:3000},f=>f)`),'ROUND(SUM(base,post,performancePay),2)');
});
