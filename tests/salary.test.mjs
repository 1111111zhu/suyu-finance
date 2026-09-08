import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../public/salary/index.html',import.meta.url),'utf8');
function app(){
 const element={addEventListener(){},classList:{add(){},remove(){},toggle(){}},textContent:''};
 const context=vm.createContext({document:{getElementById:()=>({...element}),querySelectorAll:()=>[],addEventListener(){}},window:{},structuredClone,setTimeout:()=>0,clearTimeout(){}});
 const source=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace("    render('overview');\n  ", '');
 vm.runInContext(source,context);
 vm.runInContext('render=()=>{};showToast=()=>{};',context);
 return code=>vm.runInContext(code,context);
}
test('manual month and fractional days update results and export without losing imported employees',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'测试',是否入离职:'在职'}],salary:[{姓名:'测试',基本工资:1000}],attendance:[{姓名:'测试','事假(天)':0.5}]};state.liveImport=true;");
 assert.equal(run("applyPayrollSettings('2026-02','18.5')"),true);
 assert.equal(run('employees[0].name'),'测试');
 assert.equal(run('employees[0].workdays'),18.5);
 assert.equal(run('employees[0].payableDays'),18);
 assert.equal(run('exportRow(employees[0])[9]'),18.5);
 assert.equal(run('currentBatch().month'),'2026-02');
 assert.equal(run("applyPayrollSettings('2026-03','23')"),true);
 assert.equal(run('employees[0].workdays'),23);
 assert.equal(run('employees[0].name'),'测试');
});
test('other reduction and withholding map and deduct exactly once',()=>{
 for(const [reduction,withholding] of [[100,70],[100,0],[0,70],[0,0]]){
  const run=app();
  run(`sourceRows={roster:[{姓名:'测试'}],salary:[{姓名:'测试',基本工资:1000}],other:[{姓名:'测试',其他减:${reduction},其他代扣:${withholding}}]};state.liveImport=true;recalculateEmployees();`);
  assert.equal(run('employees[0].gross'),1000-reduction);
  assert.equal(run('employees[0].net'),1000-reduction-withholding);
  assert.equal(run('exportRow(employees[0])[30]'),reduction);
  assert.equal(run('exportRow(employees[0])[34]'),withholding);
 }
});
test('invalid manual parameters are rejected without changing results',()=>{
 const run=app();const old=run('currentMonth');
 for(const [month,days] of [['2026-02',''],['2026-02','NaN'],['2026-02','0'],['2026-02','-1'],['2026-02','29'],['2026-13','20']]) assert.equal(run(`applyPayrollSettings('${month}','${days}')`),false);
 assert.equal(run('currentMonth'),old);
 assert.equal(run("validPayrollSettings('2028-02',29)"),true);
});
test('batch switching restores days and imported source data',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲'}],salary:[{姓名:'甲',基本工资:1000}]};state.liveImport=true;applyPayrollSettings('2026-02',18);globalThis.first=currentBatch();globalThis.second={name:'三月',month:'2026-03',workdays:23};state.batches.push(second);setCurrentBatch(second);");
 assert.equal(run('currentWorkdays'),23);
 run("sourceRows={roster:[{姓名:'乙'}],salary:[{姓名:'乙',基本工资:2000}]};state.liveImport=true;setCurrentBatch(first);");
 assert.equal(run('employees[0].name'),'甲');assert.equal(run('employees[0].workdays'),18);
 run('setCurrentBatch(second)');assert.equal(run('employees[0].name'),'乙');assert.equal(run('employees[0].workdays'),23);
});
test('entry and exit attendance formulas remain unchanged apart from manual workdays',()=>{
 const run=app();
 const result=run("calcSalary({status:'入职',join:'2025-01-18',base:6000,post:2000,perfBase:1000,score:.9},'2025-01',22)");
 assert.equal(result.deductDays,12);
 assert.equal(result.effectiveScore,0);
 assert.equal(result.payableDays,10);
 assert.match(run('payrollSettings()'),/待新规则确定后调整/);
});

test('all payroll views render with current parameters',()=>{
 const run=app();
 for(const view of ['Overview','Upload','Mapping','Results','Slip','Batches','Templates']) assert.equal(typeof run(`render${view}()`),'string');
});
