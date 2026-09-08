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

test('all nine modules match dated filenames and fallback header aliases',()=>{
 const run=app();
 for(const [key,name,field] of [['roster','花名册','入职日期'],['salary','员工基本工资表','工资基数'],['performance','绩效考核表','绩效系数'],['attendance','考勤统计表','病假（天）'],['other','其他表','其他减'],['social','社保明细','个人总计'],['fund','公积金明细','个人缴纳'],['utility','人才公寓水电明细','水电费合计'],['meal','餐费明细','餐费合计']]){
  assert.equal(run(`matchSource('2026年9月${name}.xlsx',[{姓名:'甲','${field}':1}]).key`),key);
  assert.equal(run(`matchSource('导出.xlsx',[{姓名:'甲','${field}':1}]).key`),key);
 }
 for(const expression of ["matchSource('社保.xlsx',[{姓名:'甲',个人公积金:1}])","matchSource('社保公积金.xlsx',[{姓名:'甲'}])","matchSource('未知.xlsx',[{姓名:'甲'}])","matchSource('汇总.xlsx',[{姓名:'甲',基本工资:1,餐费合计:2}])"]){assert.equal(run(expression+'.key'),'');}
});
function importApp(){
 const run=app();
 run("parseXlsxFile=async file=>{if(file.error)throw new Error(file.error);return file.rows;};");
 return run;
}
test('multi-file import replaces demo state, updates calculations, queues unknowns and failures',async()=>{
 const run=importApp();
 await run("importFiles([{name:'花名册.xlsx',rows:[{姓名:'甲'}]},{name:'员工基本工资表.xlsx',rows:[{姓名:'甲',基本工资:1000}]},{name:'未知.xlsx',rows:[{姓名:'甲'}]},{name:'坏文件.xlsx',error:'损坏'},{name:'file.xls'},{name:'大文件.xlsx',size:21*1024*1024}])");
 assert.equal(run('employees.length'),1);assert.equal(run('employees[0].gross'),1000);
 assert.equal(run('currentBatch().sources'),2);assert.equal(run('state.sourceStatus.social.uploaded'),false);
 assert.equal(run('importSession().items.length'),4);assert.equal(run('state.calculated'),false);
 assert.equal(run('importSession().busy'),false);
});
test('duplicate files and existing modules wait for explicit replacement; failures retain data',async()=>{
 const run=importApp();
 await run("importFiles([{name:'花名册.xlsx',rows:[{姓名:'甲'}]},{name:'社保1.xlsx',rows:[{姓名:'甲',个人总计:100}]},{name:'社保2.xlsx',rows:[{姓名:'甲',个人总计:200}]}])");
 assert.equal(run('sourceRows.social'),undefined);assert.equal(run('importSession().items.length'),2);
 run("resolveImport(1,'social')");assert.equal(run('sourceRows.social[0].个人总计'),200);
 await run("importFiles([{name:'社保3.xlsx',rows:[{姓名:'甲',个人总计:300}]}])");
 assert.equal(run('sourceRows.social[0].个人总计'),200);
 await run("importFiles([{name:'社保坏.xlsx',error:'损坏'}],'social')");
 assert.equal(run('sourceRows.social[0].个人总计'),200);assert.equal(run('state.sourceStatus.social.uploaded'),true);
 run("resolveImport(1,'social')");assert.equal(run('sourceRows.social[0].个人总计'),300);
});
test('pending manual selection survives rerender and is isolated per batch',async()=>{
 const run=importApp();
 await run("importFiles([{name:'export.xlsx',rows:[{姓名:'甲',金额:1}]}])");
 run("importSession().items[0].key='other';renderImportReview();globalThis.first=currentBatch();globalThis.second={name:'另一批次',month:'2026-03',workdays:22};state.batches.push(second);setCurrentBatch(second);");
 assert.equal(run('importSession().items.length'),0);
 run('setCurrentBatch(first)');assert.equal(run('importSession().items[0].key'),'other');
 run("resolveImport(0,'other')");assert.equal(run('sourceRows.other.length'),1);
});
test('switching batches during parsing cancels import and concurrent requests are ignored',async()=>{
 const run=app();
 run("parseXlsxFile=()=>new Promise(resolve=>{globalThis.finish=resolve;});globalThis.first=currentBatch();globalThis.pending=importFiles([{name:'花名册.xlsx'}]);");
 await run("importFiles([{name:'其他表.xlsx'}])");
 run("globalThis.second={name:'另一批次',month:'2026-03',workdays:22};state.batches.push(second);setCurrentBatch(second);finish([{姓名:'甲'}]);");
 await run('pending');assert.equal(run('sourceRows.roster'),undefined);
 run('setCurrentBatch(first)');assert.equal(run('sourceRows.roster'),undefined);assert.equal(run('importSession().busy'),false);
});
test('uploaded filenames and errors render as text, and bulk input accepts multiple xlsx',async()=>{
 const run=importApp();
 await run("importFiles([{name:'<img src=x onerror=alert(1)>.xlsx',error:'<script>bad</script>'}])");
 const rendered=run('renderUpload()');
 assert.ok(rendered.includes('&lt;img'));assert.ok(rendered.includes('&lt;script&gt;'));
 assert.ok(!rendered.includes('<img src=x'));assert.match(rendered,/accept=".xlsx" multiple/);
 assert.ok(!rendered.includes('data-simulate-all'));
});
