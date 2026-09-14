import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import XLSX from 'xlsx';

const base=new URL('../public/salary/',import.meta.url);
async function app(initialHash=''){
  const elements=new Map();
  const element=key=>{
    if(!elements.has(key))elements.set(key,{innerHTML:'',value:'',dataset:{},events:{},classList:{add(){},remove(){},toggle(){}},
      addEventListener(type,handler){this.events[type]=handler;},querySelectorAll(){return [];},querySelector(){return null;},focus(){this.focused=true;},select(){},scrollIntoView(){this.scrolled=true;}});
    return elements.get(key);
  };
  const document={getElementById:element,querySelector:element,querySelectorAll:()=>[],addEventListener(){},body:element('body')};
  const window={XLSX,location:{hash:initialHash},history:{replaceState(a,b,url){window.location.hash=url;}},addEventListener(){},scrollTo(){},confirm:()=>true};
  const context=vm.createContext({document,window,structuredClone,setTimeout:()=>0,clearTimeout(){},__PAYROLL_TEST__:true});
  const run=code=>vm.runInContext(code,context);
  for(const file of ['payroll-engine.js','payroll-email-engine.js'])run(fs.readFileSync(new URL(file,base),'utf8'));
  run(fs.readFileSync(new URL('index.html',base),'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
  run('render=()=>{};showToast=()=>{};bindView=()=>{};');
  for(const file of ['workbench-core.js','workbench-pages.js'])run(fs.readFileSync(new URL(file,base),'utf8'));
  run('PayrollWorkbenchPages.bind=()=>{};');
  run(fs.readFileSync(new URL('workbench-ui.js',base),'utf8'));
  await run('PayrollWorkbenchUI.init()');
  const click=async(dataset,header=false)=>{
    const button={dataset};
    await element(header?'.topbar':'content').events.click({target:{closest:()=>button}});
  };
  return {run,click,element,window};
}


test('default entry opens the first gross upload step even when payroll data exists',async()=>{
  const a=await app();
  assert.equal(a.window.location.hash,'#gross/upload');
  assert.match(a.element('content').innerHTML,/data-stage="gross" data-route="upload"[^>]*aria-current="step"/);
  const b=await app('#net/results');
  assert.equal(b.window.location.hash,'#net/results');
});

test('all four destinations switch stage and view directly, including from utility pages',async()=>{
  const a=await app();
  await a.click({wb:'route',route:'batches'},true);
  for(const stage of ['gross','net'])for(const view of ['upload','results']){
    await a.click({wb:'workflow',stage,route:view});
    assert.equal(a.window.location.hash,`#${stage}/${view}`);
    assert.match(a.element('content').innerHTML,new RegExp(`data-stage="${stage}" data-route="${view}"[^>]*aria-current="step"`));
  }
  await a.click({wb:'workflow',stage:'gross',route:'upload'});
  await a.click({wb:'route',route:'email'},true);
  await a.click({wb:'monthly'},true);
  assert.equal(a.window.location.hash,'#gross/upload');
  assert.match(a.element('.topbar').innerHTML,/邮件发送/);
});


test('workflow checkmarks require real completed work, not just later navigation',async()=>{
  const a=await app();
  await a.click({wb:'workflow',stage:'net',route:'upload'});
  const html=a.element('content').innerHTML;
  assert.match(html,/data-stage="net" data-route="upload"[^>]*aria-current="step"/);
  assert.doesNotMatch(html,/wb-flow-step[^>]*done/);
  assert.doesNotMatch(html,/>✓</);
});

test('pending banner resets restrictive filters and focuses the full pending list',async()=>{
  const a=await app();
  await a.click({wb:'workflow',stage:'net',route:'results'});
  a.run("state.search='不存在';state.dept='不匹配';state.company='不匹配';state.status='不匹配';PayrollWorkbenchUI.ui.page=8;");
  const tab=a.element('pending-tab');
  a.element('content').querySelector=selector=>selector==='[data-filter="issues"]'?tab:null;
  await a.click({wb:'pending'});
  assert.equal(a.run('state.search'),'');
  assert.equal(a.run('state.dept'),'全部部门');
  assert.equal(a.run('state.company'),'全部公司');
  assert.equal(a.run('state.status'),'全部状态');
  assert.equal(a.run('PayrollWorkbenchUI.ui.tab'),'issues');
  assert.equal(a.run('PayrollWorkbenchUI.ui.page'),1);
  assert.ok(tab.focused&&tab.scrolled);
});

test('status filter includes roster statuses and calculated people tags',async()=>{
  const a=await app();
  a.run(`employees=[
    calcSalary({id:'A',name:'在职甲',company:'溯驭',dept:'研发',status:'在职',base:1000,actualPaidDays:22}),
    calcSalary({id:'B',name:'入职乙',company:'溯驭',dept:'研发',status:'入职',base:1000,actualPaidDays:22,join:'2026-09-01'}),
    calcSalary({id:'C',name:'离职丙',company:'溯驭',dept:'研发',status:'离职',base:1000,actualPaidDays:18,leave:'2026-09-20'}),
    {...calcSalary({id:'D',name:'转正丁',company:'溯驭',dept:'研发',status:'在职',base:1000,actualPaidDays:22}),regularizationActive:true},
    {...calcSalary({id:'E',name:'实习戊',company:'溯驭',dept:'研发',status:'在职',base:1000,actualPaidDays:12}),isIntern:true},
    {...calcSalary({id:'F',name:'异动己',company:'溯驭',dept:'研发',status:'在职',base:1000,actualPaidDays:22}),grossAdjustment:100}
  ];state.payrollStage='gross';state.status='全部状态';render('results');`);
  assert.match(a.element('content').innerHTML,/>转正</);
  assert.match(a.element('content').innerHTML,/>实习生</);
  assert.match(a.element('content').innerHTML,/>薪资异动</);
  a.run("state.status='转正';render('results');");
  assert.match(a.element('content').innerHTML,/转正丁/);
  assert.doesNotMatch(a.element('content').innerHTML,/在职甲/);
  a.run("state.status='实习生';render('results');");
  assert.match(a.element('content').innerHTML,/实习戊/);
  assert.doesNotMatch(a.element('content').innerHTML,/转正丁/);
});

test('step navigation respects unsaved edits and import-in-progress guards',async()=>{
  const a=await app();
  await a.click({wb:'workflow',stage:'gross',route:'results'});
  a.run("PayrollWorkbenchUI.ui.draft={employee:structuredClone(employees[0]),field:'otherAdd',value:999,reason:'调整'}");
  a.window.confirm=()=>false;
  await a.click({wb:'workflow',stage:'net',route:'upload'});
  assert.equal(a.window.location.hash,'#gross/results');
  a.run('PayrollWorkbenchUI.ui.draft=null;importSession().busy=true;');
  await a.click({wb:'workflow',stage:'net',route:'upload'});
  assert.equal(a.window.location.hash,'#gross/results');
});
