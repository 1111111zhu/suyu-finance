import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createCalculationJobs, MAX_INPUT_BYTES} from '../server/payroll/calculation-jobs.mjs';
import {createCalculationResponse} from '../server/payroll/calculation-response.mjs';

const input = () => ({month:'2026-09',workdays:22,stage:'gross',profiles:[],makeupWorkdays:[],
  sourceRows:{roster:[]},sourceStatus:{},liveImport:true,batch:{active:true,name:'测试',month:'2026-09',
    data:{internDailyRates:{}},workbench:{gross:{},netGenerated:{},netUploaded:{},history:[],reviewed:{}}}});
function fakeService(options={}) {
  const workers=[];
  const jobs=createCalculationJobs({...options,workerFactory:()=>{
    const worker=new EventEmitter();worker.terminate=()=>{worker.stopped=true;return Promise.resolve();};
    workers.push(worker);return worker;
  }});
  return {jobs,workers};
}
const request = (path='',method='POST',data=input(),user='甲') => new Request('https://finance.example/api/payroll/calculations'+path,{
  method,headers:{'Content-Type':'application/json','x-test-user':encodeURIComponent(user)},
  ...['GET','DELETE'].includes(method)?{}:{body:JSON.stringify(data)},
});
test('calculation results and cancellation are private to the authenticated owner',async()=>{
  const {jobs,workers}=fakeService();
  const handle=createCalculationResponse({jobs,authorize:async r=>({userid:decodeURIComponent(r.headers.get('x-test-user'))})});
  try {
    const submitted=await handle(request());assert.equal(submitted.status,202);
    const {id}=await submitted.json();
    assert.equal((await handle(request('/'+id,'GET',null,'乙'))).status,404);
    assert.equal((await handle(request('/'+id,'DELETE',null,'乙'))).status,404);
    assert.equal((await handle(request())).status,409);
    workers[0].emit('message',{result:{employees:[{name:'甲',gross:123}]}});
    const result=await (await handle(request('/'+id,'GET'))).json();
    assert.equal(result.status,'completed');assert.equal(result.result.employees[0].gross,123);
    await handle(request('/'+id,'DELETE'));
    assert.equal((await (await handle(request('/'+id,'GET'))).json()).result,undefined);
    assert(workers[0].stopped);
  } finally {jobs.close();}
});
test('queue limits, cancellation and worker errors release the next job',()=>{
  const {jobs,workers}=fakeService({maxJobs:2});
  try {
    const first=jobs.submit('甲',input()),second=jobs.submit('乙',input());
    assert.equal(first.status,'running');assert.equal(second.status,'queued');
    assert.throws(()=>jobs.submit('丙',input()),error=>error.status===429);
    jobs.cancel('乙',second.id);assert.equal(jobs.get('乙',second.id).status,'cancelled');
    const third=jobs.submit('丙',input());
    workers[0].emit('error',new Error('private exception must not reach the response'));
    assert.equal(jobs.get('甲',first.id).status,'failed');
    assert(!jobs.get('甲',first.id).error.includes('private'));
    assert.equal(jobs.get('丙',third.id).status,'running');
    jobs.cancel('丙',third.id);assert(workers[1].stopped);
    assert.equal(jobs.submit('甲',input()).status,'running');
  } finally {jobs.close();}
});
test('timed-out workers terminate, results expire, and retries are allowed',async()=>{
  const {jobs,workers}=fakeService({timeoutMs:15,retentionMs:15});
  try {
    const first=jobs.submit('甲',input());
    await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(jobs.get('甲',first.id).status,'failed');assert(workers[0].stopped);
    await new Promise(resolve=>setTimeout(resolve,25));
    assert.throws(()=>jobs.get('甲',first.id),error=>error.status===404);
    assert.equal(jobs.submit('甲',input()).status,'running');
  } finally {jobs.close();}
});
test('authorization, malformed input and oversized streams never launch workers',async()=>{
  const {jobs,workers}=fakeService();
  const denied=createCalculationResponse({jobs,authorize:async()=>{throw Object.assign(new Error('没有工资权限'),{status:403});}});
  const handle=createCalculationResponse({jobs,authorize:async()=>({userid:'甲'})});
  try {
    assert.equal((await denied(request())).status,403);
    assert.equal((await handle(request('', 'POST', {...input(),workdays:0}))).status,400);
    const bad=new Request('https://finance.example/api/payroll/calculations',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});
    assert.equal((await handle(bad)).status,400);
    const oversized=new Request('https://finance.example/api/payroll/calculations',{method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(MAX_INPUT_BYTES+1)});
    assert.equal((await handle(oversized)).status,413);
    assert.equal(workers.length,0);
  } finally {jobs.close();}
});
test('production worker calculates actual salary through the HTTP contract',async()=>{
  const jobs=createCalculationJobs();
  const handle=createCalculationResponse({jobs,authorize:async()=>({userid:'甲'})});
  try {
    const data=input();
    data.sourceRows={roster:[{姓名:'甲',工号:'001',公司:'测试',一级部门:'研发',入职日期:'2020-01-01',是否入离职:'在职',是否实习生:'否'}],
      salary:[{姓名:'甲',基本工资:8000,岗位工资:2000,绩效基数:1200}],performance:[{姓名:'甲',绩效系数:1}],
      attendance:[{姓名:'甲',实际出勤天数:22,餐补合计:300}],other:[{姓名:'甲',其他加:0}]};
    data.sourceStatus=Object.fromEntries(Object.keys(data.sourceRows).map(key=>[key,{uploaded:true}]));
    const response=await handle(request('','POST',data));assert.equal(response.status,202);
    const {id}=await response.json();let result;
    for(let i=0;i<200;i++) {
      result=await (await handle(request('/'+id,'GET'))).json();
      if(result.status==='completed'||result.status==='failed')break;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(result.status,'completed');assert.equal(result.result.employees[0].gross,11500);
  } finally {jobs.close();}
});
