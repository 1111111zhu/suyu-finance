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
test('entry deduction uses fixed 21.75 and retains late-hire performance treatment',()=>{
 const run=app();
 const result=run("calcSalary({status:'入职',join:'2025-01-18',base:6000,post:2000,perfBase:1000,score:.9},'2025-01',22)");
 assert.equal(result.deductDays,11.75);
 assert.equal(result.effectiveScore,0);
 assert.equal(result.payableDays,10.25);
 assert.match(run('payrollSettings()'),/21.75－计薪月内/);
});

test('all payroll views render with current parameters',()=>{
 const run=app();
 for(const view of ['Overview','Upload','Mapping','Results','Slip','Batches','Templates']) assert.equal(typeof run(`render${view}()`),'string');
});

test('employment workday ranges include the event date and exclude weekends',()=>{
 const run=app();
 assert.equal(run("weekdaysBetween(parseDate('2026-09-01'),parseDate('2026-09-08'))"),6);
 assert.equal(run("weekdaysBetween(parseDate('2026-09-08'),parseDate('2026-09-30'))"),17);
 assert.equal(run("weekdaysBetween(parseDate('2026-09-05'),parseDate('2026-09-06'))"),0);
 assert.equal(run("weekdaysBetween(parseDate('2026-09-30'),parseDate('2026-09-30'))"),1);
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


test('status formulas add all leave categories and use a fixed divisor independent of manual days',()=>{
 const run=app();
 for(const days of [18.5,22,23]) {
  for(const [status,date,expected] of [['在职','',2],['入职','2026-09-17',13.75],['离职','2026-09-14',13.75]]) {
   const result=run(`calcSalary({status:'${status}',join:'${date}',leave:'${date}',personal:.5,absent:.5,sick:1,base:2175},'2026-09',${days})`);
   assert.equal(result.deductDays,expected);
   assert.equal(result.attendanceDeduct,expected*100);
   assert.equal(run(`exportRow(calcSalary({status:'${status}',join:'${date}',leave:'${date}',personal:.5,absent:.5,sick:1},'2026-09',${days}))[28]`),expected);
  }
 }
});
test('entry and exit count the boundary day, zero-workday ranges, and only days in payroll month',()=>{
 const run=app();
 for(const [status,date,month,expected] of [
  ['离职','2026-09-01','2026-09',20.75],
  ['入职','2026-09-30','2026-09',20.75],
  ['入职','2026-01-31','2026-01',21.75],
  ['离职','2026-08-01','2026-08',21.75],
  ['入职','2026-10-01','2026-09',21.75],
  ['离职','2026-08-31','2026-09',21.75],
  ['入职','2026-08-31','2026-09',-.25],
  ['离职','2026-10-01','2026-09',-.25],
  ['入职','2026-09-01','2026-09',-.25]
 ]) assert.equal(run(`calcSalary({status:'${status}',join:'${date}',leave:'${date}'},'${month}',22).deductDays`),expected);
});
test('missing or invalid event dates are flagged for review',()=>{
 const run=app();
 for(const status of ['入职','离职']) for(const date of ['', 'bad', '2026-02-30']) {
  const result=run(`calcSalary({status:'${status}',join:'${date}',leave:'${date}'},'2026-09',22)`);
  assert.equal(result.hasException,true);assert.match(result.exception,/日期缺失或无效/);
 }
});
test('imported roster status drives calculation and exports after changing payroll settings',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲',是否入离职:' 入职 ',入职日期:'2026-09-17'},{姓名:'乙',是否入离职:'离职',离职日期:'2026-09-14'},{姓名:'丙',是否入离职:'在职',入职日期:'2026-09-17'}],attendance:['甲','乙','丙'].map(姓名=>({姓名,'事假(天)':.5,'旷工(天)':.5,'病假(天)':1}))};state.liveImport=true;applyPayrollSettings('2026-09',23);");
 assert.equal(run('employees[0].deductDays'),13.75);
 assert.equal(run('employees[1].deductDays'),13.75);
 assert.equal(run('employees[2].deductDays'),2);
 run("applyPayrollSettings('2026-09',18.5)");
 assert.equal(run('exportRow(employees[0])[28]'),13.75);
 assert.equal(run('exportRow(employees[1])[28]'),13.75);
});

test('six same-name leave fields and employer contributions map by name into 40-column payroll',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲',是否入离职:'在职'},{姓名:'乙',是否入离职:'在职'}],salary:[{姓名:'甲',基本工资:2175},{姓名:'乙',基本工资:2175}],attendance:[{姓名:'乙',年假天数:9},{姓名:'甲',年假天数:1.5,弹性假天数:2,调休假天数:3,病假天数:.5,事假天数:.25,旷工天数:1,'病假(天)':99}],social:[{姓名:'乙',公司总计:888},{姓名:'甲',个人总计:100,公司总计:700}],fund:[{姓名:'乙',公司缴纳:999},{姓名:'甲',个人缴纳:50,公司缴纳:300}]};state.liveImport=true;applyPayrollSettings('2026-09',22);");
 const fields={年假天数:1.5,弹性假天数:2,调休假天数:3,病假天数:.5,事假天数:.25,旷工天数:1,公司缴纳:300,公司总计:700};
 assert.equal(run('exportHeaders().length'),40);
 assert.equal(run('exportRow(employees[0]).length'),40);
 for(const [field,value] of Object.entries(fields)) {
  assert.equal(run(`exportRow(employees[0])[exportHeaders().indexOf('${field}')]`),value);
  assert.equal(run(`mappingRows.some(r=>r[0]==='${field}' && r[2]==='${field}' && r[3]==='同名映射')`),true);
 }
 assert.equal(run('employees[0].deductDays'),1.75);
 assert.equal(run('employees[0].net'),run('employees[0].gross-150'));
 assert.equal(run('employees[1].companySocial'),888);
 assert.equal(run('employees[1].companyFund'),999);
 assert.equal(run('employees[1].annual'),9);
 const gross=run('employees[0].gross'),net=run('employees[0].net');
 run('sourceRows.social[1].公司总计=0;sourceRows.fund[1].公司缴纳=0;recalculateEmployees();');
 assert.equal(run('employees[0].gross'),gross);assert.equal(run('employees[0].net'),net);
});
test('legacy leave aliases and employer-only source identification are supported',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲'}],attendance:[{姓名:'甲','年假（天）':.5,'弹性假(天)':1,'调休假（天）':2}]};state.liveImport=true;recalculateEmployees();");
 assert.equal(run('employees[0].annual'),.5);assert.equal(run('employees[0].flexible'),1);assert.equal(run('employees[0].compensatory'),2);
 for(const [field,key] of [['公司缴纳','fund'],['公司总计','social'],['年假天数','attendance'],['弹性假天数','attendance'],['调休假天数','attendance']]) assert.equal(run(`matchSource('导出.xlsx',[{姓名:'甲','${field}':1}]).key`),key);
 assert.equal(run('exportRow(employees[0])[38]'),0);assert.equal(run('exportRow(employees[0])[39]'),0);
});
test('detail workbook and salary slip include mapped leave and employer contributions',()=>{
 const run=app();
 run("window.XLSX={utils:{aoa_to_sheet:rows=>({rows}),book_new:()=>({}),book_append_sheet:(book,sheet)=>{globalThis.savedSheet=sheet;}}};downloadXlsx=()=>{};employees=[calcSalary({id:'X',name:'甲',status:'在职',annual:1.5,flexible:2,compensatory:3,companyFund:300,companySocial:700})];state.selectedId='X';");
 assert.equal(run('detailSheet().rows[1].length'),40);
 assert.equal(run("detailSheet()['!merges'].at(-1).e.c"),39);
 run('downloadSlip()');
 for(const [label,value] of [['年假天数',1.5],['弹性假天数',2],['调休假天数',3],['公司缴纳',300],['公司总计',700]]) assert.equal(run(`savedSheet.rows.find(r=>r[0]==='${label}')[1]`),value);
 for(const view of ['renderMapping()','renderResults()','renderSlip()']) {
  assert.match(run(view),/年假天数/);assert.match(run(view),/弹性假天数/);assert.match(run(view),/调休假天数/);assert.match(run(view),/公司缴纳/);assert.match(run(view),/公司总计/);
 }
});


test('payable days are the exact difference without clamping, including export and slip',()=>{
 const run=app();
 for(const [workdays,personal,expected] of [[22,1.5,20.5],[18.5,18.5,0],[18.5,20,-1.5]]) {
  run(`employees=[calcSalary({id:'X',name:'甲',status:'在职',personal:${personal}},'2026-09',${workdays})];state.selectedId='X';`);
  assert.equal(run('employees[0].payableDays'),expected);
  assert.equal(run('exportRow(employees[0])[10]'),expected);
  run("window.XLSX={utils:{aoa_to_sheet:rows=>({rows}),book_new:()=>({}),book_append_sheet:(book,sheet)=>{globalThis.savedSheet=sheet;}}};downloadXlsx=()=>{};downloadSlip();");
  assert.equal(run("savedSheet.rows.find(r=>r[0]==='实发薪')[1]"),expected);
 }
 assert.match(run('payrollSettings()'),/实发薪＝应发薪－假勤扣薪天数/);
});


test('September screenshot examples include event day but never count weekends',()=>{
 const run=app();
 for(const [status,date,personal,expectedDays,expectedDeduct] of [
  ['入职','2026-09-08',0,17,4.75],
  ['离职','2026-09-08',0,6,15.75],
  ['入职','2026-09-30',0,1,20.75],
  ['入职','2026-09-17',1,10,12.75],
  ['离职','2026-09-05',0,4,17.75],
  ['离职','2026-09-06',0,4,17.75],
  ['入职','2026-09-05',0,18,3.75],
  ['入职','2026-09-06',0,18,3.75]
 ]) {
  const result=run(`calcSalary({status:'${status}',join:'${date}',leave:'${date}',personal:${personal}},'2026-09',22)`);
  assert.equal(21.75+personal-result.deductDays,expectedDays);
  assert.equal(result.deductDays,expectedDeduct);
  assert.equal(result.payableDays,22-expectedDeduct);
 }
});
test('performance cutoff includes the 15th and is limited to hires in payroll month',()=>{
 const run=app();
 for(const [status,date,score] of [['入职','2026-09-14',.9],['入职','2026-09-15',0],['入职','2026-09-17',0],['入职','2026-08-17',.9],['在职','2026-09-17',.9]]) {
  const result=run(`calcSalary({status:'${status}',join:'${date}',score:.9,perfBase:1000},'2026-09',22)`);
  assert.equal(result.effectiveScore,score);assert.equal(result.performancePay,1000*score);
 }
 assert.match(run('payrollSettings()'),/周六或周日不计工作天数/);
});

test('roster status and dates are preserved in exported rows while date calculations use local calendar dates',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲','是否入离职':'入职',入职日期:new Date(2026,7,17),离职日期:null}],salary:[{姓名:'甲',基本工资:1000}]};state.liveImport=true;recalculateEmployees();");
 assert.equal(run('employees[0].join'),'2026-08-17');
 assert.equal(run("exportRow(employees[0])[6]"),'入职');
 assert.equal(run("exportRow(employees[0])[7]"),'2026-08-17');
 assert.equal(run("exportRow(employees[0])[8]"),'');
 run("sourceRows.roster[0]['是否入离职']=' 入职 ';sourceRows.roster[0]['入职日期']='2026/08/17';recalculateEmployees();");
 assert.equal(run("exportRow(employees[0])[6]"),' 入职 ');
 assert.equal(run("exportRow(employees[0])[7]"),'2026/08/17');
});
