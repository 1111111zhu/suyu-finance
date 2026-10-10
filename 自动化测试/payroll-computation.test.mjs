import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {Worker} from 'node:worker_threads';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=new URL('../public/salary/',import.meta.url);
function input(count=2,stage='gross') {
  const sourceRows={roster:[],salary:[],performance:[],attendance:[],other:[],netSocial:[],netFund:[],tax:[],afterTax:[]};
  for(let i=0;i<count;i++) {
    const name='测试员工'+i;
    sourceRows.roster.push({姓名:name,工号:String(i),公司:'测试公司',一级部门:'研发',是否入离职:'在职',入职日期:'2020-01-01',是否实习生:'否'});
    sourceRows.salary.push({姓名:name,基本工资:8000,岗位工资:2000,绩效基数:1200});
    sourceRows.performance.push({姓名:name,绩效系数:1});
    sourceRows.attendance.push({姓名:name,实际出勤天数:22,餐补合计:300});
    sourceRows.other.push({姓名:name,其他加:0});
    sourceRows.netSocial.push({姓名:name,个人总计:800,公司总计:1200});
    sourceRows.netFund.push({姓名:name,个人缴纳:300,公司缴纳:300});
    sourceRows.tax.push({姓名:name,税:200});
    sourceRows.afterTax.push({姓名:name,餐费代扣:200});
  }
  const key=JSON.stringify(['测试员工0','测试公司','研发']);
  return {month:'2026-09',workdays:22,makeupWorkdays:[],sourceRows,
    sourceStatus:Object.fromEntries(Object.keys(sourceRows).map(k=>[k,{uploaded:true,filename:k+'.xlsx'}])),
    liveImport:true,stage,profiles:[],batch:{name:'测试批次',month:'2026-09',active:true,draftOrigin:'user-import',
      data:{internDailyRates:{}},workbench:{version:1,gross:{[key]:{otherAdd:200}},
        netGenerated:{[key]:{tax:250}},netUploaded:{},history:[],reviewed:{},revision:0}}};
}
function calculate(input) {
  const worker=new Worker(new URL('./helpers/payroll-calculation-thread.mjs',import.meta.url));
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{worker.terminate();reject(new Error('Worker timed out'));},20000);
    worker.on('error',error=>{clearTimeout(timer);worker.terminate();reject(error);});
    worker.on('message',data=>{
      if(!data.result&&!data.error)return;
      clearTimeout(timer);worker.terminate();data.error?reject(new Error(data.error)):resolve(data.result);
    });
    worker.postMessage({id:1,input});
  });
}
test('worker rules cannot drift from the authoritative salary model',()=>{
  execFileSync(process.execPath,[fileURLToPath(new URL('../自动化脚本/build-payroll-worker-model.mjs',import.meta.url)),'--check']);
});
test('worker gross and net preserve manual edits, sources and personnel identity',async()=>{
  const grossInput=input(),before=structuredClone(grossInput),gross=await calculate(grossInput);
  assert.equal(gross.employees.length,2);
  assert.equal(gross.employees[0].gross,11700);
  assert.equal(gross.employees[1].gross,11500);
  assert.equal(gross.employees[0].employeeNumber,'0');
  assert.deepEqual(grossInput,before);
  const netInput=input(2,'net');netInput.sourceRows.afterTax.push({姓名:'测试员工0',餐费代扣:50});
  const net=await calculate(netInput);
  assert.equal(net.employees[0].net,10100); // 11700 - 800 - 300 - 250 - 250
  assert.equal(net.employees[1].net,10000);
  assert.equal(net.rawProfiles.length,2);
  assert.equal(net.generatedEmployees[0].gross,11700);
});
test('payroll source lookup uses names when rows are reordered and employee numbers differ',async()=>{
  const data=input(2,'net');
  for(const [key,rows] of Object.entries(data.sourceRows)) {
    if(key==='roster')continue;
    rows.reverse();
    for(const row of rows){row.工号='源表独立编号';row.姓名=' '+row.姓名+' ';}
  }
  data.sourceRows.netSocial.find(row=>row.姓名.trim()==='测试员工0').个人总计=900;
  data.sourceRows.netSocial.find(row=>row.姓名.trim()==='测试员工1').个人总计=700;
  const result=await calculate(data);
  const byName=new Map(result.employees.map(employee=>[employee.name,employee]));
  assert.equal(byName.get('测试员工0').social,900);
  assert.equal(byName.get('测试员工1').social,700);
  assert.equal(byName.get('测试员工0').employeeNumber,'0');
  assert.equal(byName.get('测试员工1').employeeNumber,'1');
  assert.equal(byName.get('测试员工0').net,10050);
  assert.equal(byName.get('测试员工1').net,10100);
});
test('indexed deduction matching retains duplicate warnings and does not cache stale imports',()=>{
  const c=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('payroll-engine.js',root),'utf8'),c);
  vm.runInContext(`globalThis.rows=[{姓名:'甲',个人总计:100},{姓名:'甲',个人总计:200}];
    globalThis.sources={netSocial:rows,netFund:[{姓名:'甲',个人缴纳:0}],tax:[{姓名:'甲',税:0}]};
    globalThis.base=[{name:'甲',gross:1000}];`,c);
  const a=vm.runInContext('PayrollEngine.calculateNet(base,sources)[0]',c);
  assert.equal(a.social,100);assert(a.deductionIssues.includes('个人社保姓名重复，沿用首条金额'));
  vm.runInContext('rows[0].个人总计=300',c);
  assert.equal(vm.runInContext('PayrollEngine.calculateNet(base,sources)[0].social',c),300);
});
test('large background calculation leaves the main event loop responsive',async()=>{
  let ticks=0;const timer=setInterval(()=>ticks++,5);
  try {const result=await calculate(input(300));assert.equal(result.employees.length,300);assert(ticks>=3);}
  finally {clearInterval(timer);}
});
