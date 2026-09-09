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
 run("sourceRows={roster:[{姓名:'测试',是否入离职:'在职'}],salary:[{姓名:'测试',基本工资:1000}],attendance:[{姓名:'测试',实发薪天数:18,'事假(天)':0.5}]};state.liveImport=true;");
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
  run(`sourceRows={roster:[{姓名:'测试'}],salary:[{姓名:'测试',基本工资:1000}],attendance:[{姓名:'测试',实发薪天数:21.75}],other:[{姓名:'测试',其他减:${reduction},其他代扣:${withholding}}]};state.liveImport=true;recalculateEmployees();`);
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

test('all payroll views render with current parameters',()=>{
 const run=app();
 for(const view of ['Overview','Upload','Mapping','Results','Slip','Batches','Templates']) assert.equal(typeof run(`render${view}()`),'string');
});

test('roster alone allows preview; missing optional source values default to zero',()=>{
 const run=app();
 run("state.sourceStatus=Object.fromEntries(sourceSheets.map(sheet=>[sheet.key,{uploaded:sheet.key==='roster'}]));sourceRows={roster:[{姓名:'甲',是否入离职:'在职'}]};state.liveImport=true;recalculateEmployees();");
 assert.equal(run('hasPayrollRoster()'),true);
 assert.equal(run('missingSourceSheets().length'),9);
 for(const field of ['base','post','perfBase','score','meal','transit','otherAllow','otherAdd','annual','flexible','compensatory','companySocial','companyFund','sick','personal','absent','social','fund','otherReduction','otherDeduct','utility','mealDeduct']) assert.equal(run(`employees[0].${field}`),0,field);
 assert.match(run('renderUpload()'),/计算应发工资/);
 assert.match(run('renderMapping()'),/其余缺失数值按 0 计算/);
});

test('payroll requires the roster only to establish employee scope',()=>{
 const run=app();
 run("state.sourceStatus=Object.fromEntries(sourceSheets.map(sheet=>[sheet.key,{uploaded:false}]));sourceRows={};state.liveImport=true;");
 assert.equal(run('hasPayrollRoster()'),false);
 assert.match(run('renderUpload()'),/请先上传花名册/);
 assert.match(run('renderUpload()'),/data-calculate disabled/);
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
 assert.equal(run('employees.length'),1);assert.equal(run('employees[0].gross'),1000);assert.equal(run('employees[0].payrollBlocked'),false);assert.equal(run('employees[0].hasException'),true);
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



test('six same-name leave fields and employer contributions map by name into 41-column payroll',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲',是否入离职:'在职'},{姓名:'乙',是否入离职:'在职'}],salary:[{姓名:'甲',基本工资:2175},{姓名:'乙',基本工资:2175}],attendance:[{姓名:'乙',实发薪天数:22,年假天数:9},{姓名:'甲',实发薪天数:20,年假天数:1.5,弹性假天数:2,调休假天数:3,病假天数:.5,事假天数:.25,旷工天数:1,'病假(天)':99}],social:[{姓名:'乙',公司总计:888},{姓名:'甲',个人总计:100,公司总计:700}],fund:[{姓名:'乙',公司缴纳:999},{姓名:'甲',个人缴纳:50,公司缴纳:300}]};state.liveImport=true;applyPayrollSettings('2026-09',22);");
 const fields={年假天数:1.5,弹性假天数:2,调休假天数:3,病假天数:.5,事假天数:.25,旷工天数:1,公司缴纳:300,公司总计:700};
 assert.equal(run('exportHeaders().length'),41);
 assert.equal(run('exportRow(employees[0]).length'),41);
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
 assert.equal(run('exportRow(employees[0])[39]'),0);assert.equal(run('exportRow(employees[0])[40]'),0);
});
test('detail workbook and salary slip include mapped leave and employer contributions',()=>{
 const run=app();
 run("window.XLSX={utils:{aoa_to_sheet:rows=>({rows}),book_new:()=>({}),book_append_sheet:(book,sheet)=>{globalThis.savedSheet=sheet;}}};downloadXlsx=()=>{};employees=[calcSalary({actualPaidDays:22,id:'X',name:'甲',status:'在职',annual:1.5,flexible:2,compensatory:3,companyFund:300,companySocial:700})];state.selectedId='X';");
 assert.equal(run('detailSheet().rows[1].length'),41);
 assert.equal(run("detailSheet()['!merges'].at(-1).e.c"),40);
 run('downloadSlip()');
 for(const [label,value] of [['年假天数',1.5],['弹性假天数',2],['调休假天数',3],['公司缴纳',300],['公司总计',700]]) assert.equal(run(`savedSheet.rows.find(r=>r[0]==='${label}')[1]`),value);
 run("state.payrollStage='net'");
 for(const view of ['renderResults()','renderSlip()']) {
  assert.match(run(view),/年假天数/);assert.match(run(view),/弹性假天数/);assert.match(run(view),/调休假天数/);assert.match(run(view),/公司缴纳/);assert.match(run(view),/公司总计/);
 }
});




test('performance cutoff includes the 15th and is limited to hires in payroll month',()=>{
 const run=app();
 for(const [status,date,score] of [['入职','2026-09-14',.9],['入职','2026-09-15',0],['入职','2026-09-17',0],['入职','2026-08-17',.9],['在职','2026-09-17',.9]]) {
  const result=run(`calcSalary({status:'${status}',join:'${date}',score:.9,perfBase:1000},'2026-09',22)`);
  assert.equal(result.effectiveScore,score);assert.equal(result.performancePay,1000*score);
 }
 assert.match(run('payrollSettings()'),/当月 15 日及以后入职/);
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

test('attendance days remain the sole payable-days source while zero leave bypasses deduction',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲',是否入离职:'入职',入职日期:'2026-09-17',实发薪天数:99},{姓名:'乙',是否入离职:'离职',离职日期:'2026-09-05'},{姓名:'丙',是否入离职:'在职'}],salary:['甲','乙','丙'].map(姓名=>({姓名,基本工资:2175})),attendance:[{姓名:'丙',实发薪天数:0},{姓名:'甲',实发薪天数:'18.5',病假天数:1,事假天数:8,旷工天数:2},{姓名:'乙',实发薪天数:20}]};state.liveImport=true;applyPayrollSettings('2026-09',22);");
 for (const [i,paid,deduct] of [[0,18.5,3.25],[1,20,1.75],[2,0,0]]) {
  assert.equal(run(`employees[${i}].payableDays`),paid);
  assert.equal(run(`employees[${i}].deductDays`),deduct);
  assert.equal(run(`employees[${i}].attendanceDeduct`),deduct*100);
  assert.equal(run(`exportRow(employees[${i}])[10]`),paid);
 }
 assert.equal(run('employees[0].effectiveScore'),0);
 assert.equal(run('employees[0].gross'),run('2175-325+2660/21.75*.8'));
 run("applyPayrollSettings('2026-09',21.75)");
 assert.equal(run('employees[0].payableDays'),18.5);assert.equal(run('employees[0].deductDays'),3.25);run("applyPayrollSettings('2026-09',18)");assert.equal(run('employees[0].deductDays'),3.25);
 assert.equal(run('payrollExportReady()'),true);
 assert.equal(run("matchSource('导出.xlsx',[{姓名:'甲',实发薪天数:18.5}]).key"),'attendance');
 assert.match(run('renderMapping()'),/实发薪天数/);
});
test('zero, zero-like and blank leave cells bypass deduction for active and joining employees',()=>{
 const run=app();
 for (const [status,dateField] of [['在职',''],['入职',",join:'2026-09-17'"]]) {
  const result=run(`calcSalary({status:'${status}'${dateField},actualPaidDays:18,sick:0,personal:'0.0',absent:'',annual:5,flexible:2,compensatory:3,base:2175},'2026-09',22)`);
  assert.equal(result.payableDays,18);
  assert.equal(result.deductDays,0);
  assert.equal(result.attendanceDeduct,0);
  assert.equal(result.gross,2175);
 }
 run("sourceRows={roster:[{姓名:'甲'}],attendance:[{姓名:'甲',实发薪天数:'18.5',病假天数:'',事假天数:'0.0',旷工天数:null}]};state.liveImport=true;recalculateEmployees();");
 assert.equal(run('employees[0].payableDays'),18.5);
 assert.equal(run('employees[0].deductDays'),0);
});
test('each nonzero deductible leave field activates the fixed 21.75 formula',()=>{
 const run=app();
 for (const field of ['sick','personal','absent']) {
  const result=run(`calcSalary({actualPaidDays:20,base:2175,${field}:0.5},'2026-09',22)`);
  assert.equal(result.payableDays,20);
  assert.equal(result.deductDays,1.75);
  assert.equal(result.attendanceDeduct,175);
 }
});
test('invalid or missing paid days never fall back and allow exports while retaining missing amounts',()=>{
 for(const raw of [null,undefined,'','  ','abc','50%','—',-1,NaN,Infinity,true,[],{}]) {
  const run=app();
  const literal=raw===undefined?'undefined':Number.isNaN(raw)?'NaN':raw===Infinity?'Infinity':JSON.stringify(raw);
  run(`sourceRows={roster:[{姓名:'甲',实发薪天数:22}],attendance:[{姓名:'甲',事假天数:1,实发薪天数:${literal}}]};state.liveImport=true;recalculateEmployees();window.XLSX={};`);
  for(const field of ['payableDays','deductDays','attendanceDeduct']) assert.equal(run(`employees[0].${field}`),null);
  assert.equal(run('employees[0].gross'),0);
  assert.equal(run('employees[0].net'),0);
  assert.equal(run('payrollExportReady()'),true);assert.equal(run('workbookReady()'),true);
  assert.equal(run('employees[0].hasException'),true);
  assert.match(run('employees[0].exception'),/实发薪天数/);
  assert.equal(run('integer(employees[0].payableDays)'),'—');
 }
 const run=app();run("sourceRows={roster:[{姓名:'甲'}]};state.liveImport=true;recalculateEmployees();");
 assert.equal(run('payrollExportReady()'),true);
 run("sourceRows.attendance=[{姓名:'乙',实发薪天数:22}];recalculateEmployees();");
 assert.equal(run('payrollExportReady()'),true);
});
test('zero-leave paid days survive detail and slip export without clamping or deduction',()=>{
 const run=app();
 for(const paid of [0,0.5,18.5,23]) {
  run(`employees=[calcSalary({id:'X',name:'甲',actualPaidDays:${paid},base:2175},'2026-09',22)];state.selectedId='X';window.XLSX={utils:{aoa_to_sheet:rows=>({rows}),book_new:()=>({}),book_append_sheet:(book,sheet)=>{globalThis.savedSheet=sheet;}}};downloadXlsx=()=>{};globalThis.savedDetail=detailSheet();downloadSlip();`);
  assert.equal(run("savedSheet.rows.find(r=>r[0]==='实发薪天数')[1]"),paid);
  assert.equal(run('employees[0].deductDays'),0);
  assert.equal(run('employees[0].attendanceDeduct'),0);
  assert.equal(run('exportRow(employees[0])[10]'),paid);
  assert.equal(run('savedDetail.rows[2][10]'),paid);
  assert.equal(run('savedDetail.rows[2][28]'),0);
  assert.equal(run('savedDetail.rows[2][29]'),0);
 }
 assert.match(run('payrollSettings()'),/病假、事假、旷工均为 0 或空白时，假勤扣薪天数＝0/);
 run("state.payrollStage='net'");
 assert.match(run('renderSlip()'),/实发薪天数保留考勤表原值/);
});
test('duplicate names warn without blocking payroll, including whitespace-normalized names',()=>{
 for(const key of ['roster','attendance','salary']) {
  const run=app();
  run(`sourceRows={roster:[{姓名:'甲'}],attendance:[{姓名:'甲',实发薪天数:22}],salary:[{姓名:'甲',基本工资:2175}]};sourceRows['${key}'].push({...sourceRows['${key}'][0],姓名:' 甲 '});state.liveImport=true;recalculateEmployees();`);
  assert.equal(run('payrollExportReady()'),true);
  assert.equal(run('employees[0].payableDays'),22);
  assert.equal(run('employees[0].hasException'),true);
  run(`sourceRows['${key}'].pop();recalculateEmployees();`);
  assert.equal(run('payrollExportReady()'),true);
 }
});

test('export diagnostics identify each blocked person, source and raw value safely',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲'},{姓名:'乙'},{姓名:'<丙>'}],attendance:[{姓名:'甲',实发薪天数:21.75},{姓名:'<丙>',实发薪天数:'<bad>'}],social:[{姓名:'甲'},{姓名:'甲'}]};state.liveImport=true;recalculateEmployees();");
 run("state.payrollStage='net'");
 const html=run('renderPayrollIssues()');
 assert.match(html,/3 人需要核对/);assert.match(html,/社保明细存在重复姓名/);assert.match(html,/考勤统计表中未找到此姓名/);assert.match(html,/&lt;bad&gt;/);assert.match(html,/&lt;丙&gt;/);
 assert.ok(!html.includes('<bad>'));assert.match(html,/<td>2<\/td>/);
 run('delete sourceRows.attendance;recalculateEmployees();');assert.match(run('renderPayrollIssues()'),/未上传考勤统计表/);
 run("sourceRows.attendance=[{姓名:'甲'},{姓名:'乙'},{姓名:'<丙>'}];recalculateEmployees();");assert.match(run('renderPayrollIssues()'),/单元格为空/);
});

test('exception cards open a complete list including nonblocking warnings',()=>{
 const run=app();
 run("employees=[calcSalary({id:'A',name:'Alice',actualPaidDays:21,exception:'Review social insurance'}),calcSalary({id:'B',name:'Bob'})];");
 for(const view of ['renderResults()']) assert.match(run(view),/data-go="exceptions"/);
 const details=run('renderExceptions()');
 assert.match(details,/Alice/);assert.match(details,/Bob/);assert.match(details,/Review social insurance/);assert.match(details,/data-employee="A"/);assert.match(details,/data-employee="B"/);
 run('employees=[];');assert.ok(run('renderExceptions()').includes('colspan="7"'));
});

test('mixed valid and invalid employees export the entire workbook with exception notes',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'正常'},{姓名:'缺失'},{姓名:'重复'}],attendance:[{姓名:'正常',实发薪天数:20},{姓名:'重复',实发薪天数:21},{姓名:'重复',实发薪天数:19}],salary:['正常','缺失','重复'].map(姓名=>({姓名,基本工资:2175}))};state.liveImport=true;recalculateEmployees();window.XLSX={utils:{aoa_to_sheet:rows=>({rows}),book_new:()=>({sheets:[]}),book_append_sheet:(book,sheet,name)=>book.sheets.push({sheet,name})}};downloadXlsx=(book)=>{globalThis.exported=book;};downloadCsv();");
 assert.equal(run('exported.sheets[0].sheet.rows.length'),5);
 assert.equal(run('employees[0].net'),2175);
 assert.equal(run('employees[1].net'),2175);
 assert.equal(run('employees[2].net'),2175);
 assert.match(run("exported.sheets[0].sheet.A4.c[0].t"),/考勤统计表中未找到此姓名/);
 assert.match(run('renderExceptions()'),/第 3、4 行/);
 assert.equal(run('exported.sheets[1].sheet.rows.at(-1)[3]'),6525);
 assert.ok(!run('renderResults()').includes('禁止导出'));
});

test('tax names take precedence and exact tax header wins over aliases',()=>{
 const run=app();
 for(const filename of ['2026年9月税.xlsx','工资税额.xlsx','社保个税汇总.xlsx']) assert.equal(run(`matchSource('${filename}',[{姓名:'甲',基本工资:999,税:40}]).key`),'tax');
 assert.equal(run("matchSource('导出.xlsx',Object.assign([{姓名:'甲',金额:40}],{sheetName:'9月税表'})).key"),'tax');
 assert.equal(run("matchSource('导出.xlsx',[{姓名:'甲',税:40}]).key"),'tax');
 run("sourceRows={roster:[{姓名:'甲'}],salary:[{姓名:'甲',基本工资:1000}],tax:[{姓名:'甲',个人所得税:999,税:40}]};sourceRows.attendance=(sourceRows.roster||[]).map(r=>({姓名:r.姓名,实发薪天数:22}));state.liveImport=true;recalculateEmployees();");
 assert.equal(run('employees[0].tax'),40);assert.equal(run('employees[0].net'),960);
});

test('tax matches by name, all personal deductions apply once, employer amounts do not reduce net',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲'},{姓名:'乙'}],salary:[{姓名:'乙',基本工资:2000},{姓名:'甲',基本工资:10000}],other:[{姓名:'甲',其他减:100,其他代扣:70}],social:[{姓名:'甲',个人总计:500,公司总计:3000}],fund:[{姓名:'甲',个人缴纳:400,公司缴纳:4000}],utility:[{姓名:'甲',水电费合计:120}],meal:[{姓名:'甲',餐费合计:200}],tax:[{姓名:'乙',税:20},{姓名:' 甲 ',税:'￥1,234.56'},{姓名:'范围外',税:999}]};sourceRows.attendance=(sourceRows.roster||[]).map(r=>({姓名:r.姓名,实发薪天数:22}));state.liveImport=true;recalculateEmployees();");
 assert.equal(run('employees.length'),2);
 assert.equal(run('employees[0].gross'),9900);
 assert.ok(Math.abs(run('employees[0].net')-7375.44)<1e-8);
 assert.equal(run('employees[1].net'),1980);
 assert.equal(run('exportRow(employees[0])[exportHeaders().indexOf("个税")]'),1234.56);
 run('recalculateEmployees();recalculateEmployees();');
 assert.ok(Math.abs(run('employees[0].net')-7375.44)<1e-8);
});

test('deduction warnings only appear in the net stage, blank tax does not warn',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲'}],salary:[{姓名:'甲',基本工资:1000}],attendance:[{姓名:'甲',实发薪天数:22}]};state.liveImport=true;state.sourceStatus={roster:{uploaded:true}};recalculateEmployees();");
 assert.equal(run('deductionNotice()'),'');
 run("state.payrollStage='net'");assert.match(run('deductionNotice()'),/个税表.*尚未上传/);
 for(const [rows,pattern] of [["[{姓名:'乙',税:50}]",/个税未找到匹配姓名/],["[{姓名:'甲',金额:50}]",/个税缺少金额列/],["[{姓名:'甲',税:'abc'}]",/个税金额不是有效数字/],["[{姓名:'甲',税:'10%'}]",/个税金额不是有效数字/]]) {
  run(`sourceRows.tax=${rows};recalculateEmployees();`);
  assert.equal(run('employees[0].tax'),0);assert.equal(run('employees[0].net'),1000);assert.match(run("visibleIssues(employees[0]).join('；')"),pattern);
  assert.equal(run("visibleIssues(employees[0],'gross').length"),0);
 }
 for(const blank of [null,'','  ']) {
  run(`sourceRows.tax=[{姓名:'甲',税:${JSON.stringify(blank)}}];recalculateEmployees();`);
  assert.equal(run('employees[0].tax'),0);assert.equal(run('visibleIssues(employees[0]).length'),0);
 }
 run("sourceRows.tax=[{姓名:'甲',税:40},{姓名:'甲',税:90}];recalculateEmployees();");
 assert.match(run("visibleIssues(employees[0]).join('；')"),/个税存在重复姓名/);assert.equal(run('employees[0].tax'),40);
});

function captureExports(run) {
 run("window.XLSX={utils:{aoa_to_sheet:rows=>({rows}),book_new:()=>({}),book_append_sheet:(book,sheet,name)=>{book[name]=sheet;}}};downloadXlsx=(book,name)=>{globalThis.savedBook=book;globalThis.savedName=name;};");
}

test('gross export precedes tax upload and remains unchanged; full detail, summary and slip reconcile',async()=>{
 const run=importApp();captureExports(run);
 await run("importFiles([{name:'花名册.xlsx',rows:[{姓名:'甲'}]},{name:'员工基本工资表.xlsx',rows:[{姓名:'甲',基本工资:1000}]},{name:'考勤统计表.xlsx',rows:[{姓名:'甲',实发薪天数:22}]}])");
 run('downloadGross();globalThis.before=JSON.stringify(savedBook);');
 assert.match(run('savedName'),/^应发工资表_.*\.xlsx$/);
 assert.equal(run("savedBook['应发工资表'].rows[1].at(-1)"),'应发工资');
 assert.equal(run("savedBook['应发工资表'].rows[2].at(-1)"),1000);
 assert.equal(run("savedBook['应发工资表'].rows[1].includes('实发工资')"),false);
 assert.equal(run("savedBook['应发工资表']['!merges'].every(m=>m.e.c<32)"),true);
 await run("importFiles([{name:'9月税.xlsx',rows:[{姓名:'甲',税:125.25}]}])");
 assert.equal(run('employees[0].tax'),125.25);assert.equal(run('employees[0].net'),874.75);
 run('downloadGross()');assert.equal(run('JSON.stringify(savedBook)'),run('before'));
 run('downloadCsv()');
 assert.equal(run("savedBook['工资明细表'].rows[2][savedBook['工资明细表'].rows[1].indexOf('个税')]"),125.25);
 assert.equal(run("savedBook['汇总统计'].rows.at(-1).at(-2)"),125.25);
 assert.equal(run("savedBook['汇总统计'].rows.at(-1).at(-1)"),874.75);
 run('downloadSlip()');assert.equal(run("savedBook['工资条'].rows.find(r=>r[0]==='个税')[1]"),125.25);
 run("state.payrollStage='net'");
 for(const view of ['renderUpload()','renderMapping()','renderResults()','renderSlip()']) assert.match(run(view),/个税/);
 assert.match(run('renderResults()'),/data-export-gross/);
 await run("importFiles([{name:'9月税修正.xlsx',rows:[{姓名:'甲',税:50}]}])");
 assert.equal(run('employees[0].tax'),125.25);
 run("resolveImport(0,'tax')");assert.equal(run('employees[0].net'),950);assert.equal(run('employees[0].gross'),1000);
});

test('tax source and deductions remain isolated when switching payroll batches',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲'}],salary:[{姓名:'甲',基本工资:1000}],tax:[{姓名:'甲',税:120}]};sourceRows.attendance=(sourceRows.roster||[]).map(r=>({姓名:r.姓名,实发薪天数:22}));state.liveImport=true;recalculateEmployees();globalThis.first=currentBatch();globalThis.second={name:'下月',month:'2026-10',workdays:22};state.batches.push(second);setCurrentBatch(second);sourceRows={roster:[{姓名:'甲'}],salary:[{姓名:'甲',基本工资:1000}],tax:[{姓名:'甲',税:80}]};sourceRows.attendance=(sourceRows.roster||[]).map(r=>({姓名:r.姓名,实发薪天数:22}));state.liveImport=true;recalculateEmployees();setCurrentBatch(first);");
 assert.equal(run('employees[0].net'),880);
 run('setCurrentBatch(second)');assert.equal(run('employees[0].net'),920);
});


test('all deduction tables distinguish blank, missing, invalid and duplicate rows without changing gross',()=>{
 for(const [key,header,field] of [['social','个人总计','social'],['fund','个人缴纳','fund'],['utility','水电费合计','utility'],['meal','餐费合计','mealDeduct'],['other','其他代扣','otherDeduct'],['tax','税','tax']]) {
  for(const [rows,expected,warning] of [ [[{姓名:'乙',[header]:80}],0,true], [[{姓名:'甲',[header]:null}],0,false], [[{姓名:'甲',[header]:'   '}],0,false], [[{姓名:'甲'}],0,true], [[{姓名:'甲',[header]:'无效'}],0,true], [[{姓名:'甲',[header]:80},{姓名:'甲',[header]:90}],80,true] ]) {
   const run=app();captureExports(run);
   run(`sourceRows={roster:[{姓名:'甲'}],salary:[{姓名:'甲',基本工资:1000}],attendance:[{姓名:'甲',实发薪天数:22}],${key}:${JSON.stringify(rows)}};state.liveImport=true;recalculateEmployees();`);
   assert.equal(run(`employees[0].${field}`),expected,`${key}: ${JSON.stringify(rows)}`);
   assert.equal(run('employees[0].gross'),1000);assert.equal(run('employees[0].net'),1000-expected);
   assert.equal(run('(employees[0].deductionIssues||[]).length>0'),warning);
   if(key!=='other') assert.equal(run("visibleIssues(employees[0],'gross').length"),0);
   run('downloadCsv()');assert.equal(run("savedBook['工资明细表'].rows.length"),3);
  }
 }
});

test('PR10 attendance behavior reconciles across employment states, export, tax and withholding',()=>{
 const run=app();run("state.payrollStage='net'");
 for(const status of ['在职','入职','离职']) for(const paid of [0,20,21.75,22]) for(const leaves of [[0,0,0],[0.5,0,0],[0,1,0],[0,0,2],[0.5,1,2]]) {
  const [sick,personal,absent]=leaves;
  const expected=(status==='离职'?paid!==22:leaves.some(v=>v!==0))?21.75-paid:0;
  run(`employees=[calcSalary({id:'A',name:'甲',status:'${status}',actualPaidDays:${paid},sick:${sick},personal:${personal},absent:${absent},base:2175,tax:80,otherReduction:30,otherDeduct:20},'2026-09',22)];state.selectedId='A';window.XLSX={utils:{aoa_to_sheet:rows=>({rows}),book_new:()=>({}),book_append_sheet:(book,sheet)=>{globalThis.savedSheet=sheet;}}};downloadXlsx=()=>{};downloadSlip();`);
  const e=run('employees[0]');assert.equal(e.payableDays,paid);assert.equal(e.deductDays,expected);assert.equal(e.attendanceDeduct,expected*100);
  assert.equal(e.gross,2175+2660/21.75*sick*.8-expected*100-30);assert.equal(e.net,e.gross-100);
  assert.equal(run('exportRow(employees[0])[28]'),expected);assert.equal(run("savedSheet.rows.find(r=>r[0]==='假勤扣薪天数')[1]"),expected);
 }
});

test('two-stage upload and correction preserve all sources, gross export and batch stage',async()=>{
 const run=importApp();captureExports(run);
 await run("importFiles([{name:'税.xlsx',rows:[{姓名:'甲',税:30}]},{name:'花名册.xlsx',rows:[{姓名:'甲'}]},{name:'员工基本工资表.xlsx',rows:[{姓名:'甲',基本工资:1000}]},{name:'考勤统计表.xlsx',rows:[{姓名:'甲',实发薪天数:22}]}])");
 assert.match(run('renderUpload()'),/已接收扣款表：个税/);
 for(const key of ['roster','salary','performance','attendance','other']) assert.match(run('renderUpload()'),new RegExp('id="file-'+key+'"'));
 for(const key of ['social','fund','utility','meal','tax']) assert.ok(!run('renderUpload()').includes('id="file-'+key+'"'));
 assert.ok(!run('renderResults()').includes('data-export>'));assert.ok(!run('renderResults()').includes('<th>实发工资</th>'));
 run("calculateStage();downloadGross();globalThis.before=JSON.stringify(savedBook);switchPayrollStage('net')");
 assert.equal(run('state.payrollStage'),'net');assert.equal(run('employees[0].net'),970);
 for(const key of ['social','fund','utility','meal','tax']) assert.match(run('renderUpload()'),new RegExp('id="file-'+key+'"'));
 assert.match(run('renderUpload()'),/社保明细.*尚未上传/);
 await run("importFiles([{name:'税修正.xlsx',rows:[{姓名:'甲',税:50}]}])");run("resolveImport(0,'tax');calculateStage();downloadGross()");
 assert.equal(run('JSON.stringify(savedBook)'),run('before'));assert.equal(run('employees[0].net'),950);
 run("switchPayrollStage('gross')");
 await run("importFiles([{name:'员工基本工资修正.xlsx',rows:[{姓名:'甲',基本工资:1200}]}],'salary')");run("resolveImport(0,'salary');calculateStage();switchPayrollStage('net')");
 assert.equal(run('employees[0].gross'),1200);assert.equal(run('employees[0].net'),1150);assert.equal(run('sourceRows.tax[0].税'),50);
 run("globalThis.first=currentBatch();globalThis.second={name:'next',month:'2026-10',workdays:22};state.batches.push(second);setCurrentBatch(second)");
 assert.equal(run('state.payrollStage'),'gross');run('setCurrentBatch(first)');assert.equal(run('state.payrollStage'),'net');assert.equal(run('employees[0].net'),1150);
});

test('gross exports never include deduction warnings or change after invalid deduction upload',async()=>{
 const run=importApp();captureExports(run);
 await run("importFiles([{name:'花名册.xlsx',rows:[{姓名:'甲'}]},{name:'考勤.xlsx',rows:[{姓名:'甲',实发薪天数:22}]},{name:'员工基本工资表.xlsx',rows:[{姓名:'甲',基本工资:1000}]}])");
 run('downloadGross();globalThis.before=JSON.stringify(savedBook)');
 await run("importFiles([{name:'税.xlsx',rows:[{姓名:'甲',税:'无效'}]},{name:'社保.xlsx',rows:[{姓名:'乙',个人总计:80}]}])");
 run('downloadGross()');assert.equal(run('JSON.stringify(savedBook)'),run('before'));assert.equal(run('renderPayrollIssues()'),'');
 run("switchPayrollStage('net')");assert.match(run('renderPayrollIssues()'),/个税金额不是有效数字/);assert.match(run('renderPayrollIssues()'),/社保明细未找到匹配姓名/);
 run('downloadCsv()');assert.match(run("savedBook['工资明细表'].A3.c[0].t"),/个税/);
});


test('departed employees compare expected and actual paid days regardless of leave',()=>{
 const run=app();run("state.payrollStage='net'");
 for (const leave of [0,1]) {
  for (const [expected,paid,days] of [[22,22,0],[20,20,0],[18.5,18.5,0],[22,20,1.75],[22,0,21.75],[23,22,-.25]]) {
   const result=run(`calcSalary({status:'离职',actualPaidDays:'${paid}',base:2175,personal:${leave}},'2026-09','${expected}')`);
   assert.equal(result.deductDays,days);
   assert.equal(result.attendanceDeduct,days*100);
   assert.equal(result.gross,2175-days*100);
  }
 }
 run("sourceRows={roster:[{姓名:'甲',是否入离职:' 离职 '}],salary:[{姓名:'甲',基本工资:2175}],attendance:[{姓名:'甲',实发薪天数:20}]};state.liveImport=true;applyPayrollSettings('2026-09',22);");
 assert.equal(run('employees[0].deductDays'),1.75);
 assert.equal(run('exportRow(employees[0])[29]'),175);
 assert.match(run('renderSlip()'),/应发薪天数与实发薪天数不相等/);
 run("applyPayrollSettings('2026-09',20)");
 assert.equal(run('employees[0].attendanceDeduct'),0);
 assert.match(run('renderSlip()'),/应发薪天数与实发薪天数相等/);
 run("sourceRows.attendance[0].实发薪天数='';recalculateEmployees();");
 assert.equal(run('employees[0].deductDays'),null);
 assert.equal(run('employees[0].attendanceDeduct'),null);
 assert.equal(run('employees[0].gross'),2175);
 assert.equal(run('employees[0].net'),2175);
});


test('missing or invalid paid days only block calculations that need paid days',()=>{
 const run=app();
 for(const status of ['入职','在职','离职']) for(const paid of [null,'','错误']) for(const leave of [0,1]) {
  run(`sourceRows={roster:[{姓名:'甲',是否入离职:'${status}'}],salary:[{姓名:'甲',基本工资:2175}],attendance:[{姓名:'甲',实发薪天数:${JSON.stringify(paid)},事假天数:${leave}}]};state.liveImport=true;applyPayrollSettings('2026-09',22);`);
  const blocked=status==='离职'||leave!==0;
  assert.equal(run('employees[0].payableDays'),null);
  assert.equal(run('employees[0].payrollBlocked'),blocked);
  assert.equal(run('employees[0].hasException'),true);
  for(const i of [28,29]) assert.equal(run(`exportRow(employees[0])[${i}]`),blocked?null:0);
  for(const i of [31,38]) assert.equal(run(`exportRow(employees[0])[${i}]`),2175);
 }
});

test('gross payroll export keeps other reduction independent and only leaves uncomputable attendance fields blank',()=>{
 const run=app();captureExports(run);
 run("sourceRows={roster:[{姓名:'无假勤入职',是否入离职:'入职'},{姓名:'有事假入职',是否入离职:'入职'},{姓名:'异常假勤入职',是否入离职:'入职'}],salary:[{姓名:'无假勤入职',基本工资:2175},{姓名:'有事假入职',基本工资:2175},{姓名:'异常假勤入职',基本工资:2175}],attendance:[{姓名:'无假勤入职',实发薪天数:''},{姓名:'有事假入职',实发薪天数:20,事假天数:1},{姓名:'异常假勤入职',实发薪天数:'',事假天数:1}],other:[{姓名:'无假勤入职',其他减:88},{姓名:'有事假入职',其他减:44},{姓名:'异常假勤入职',其他减:66}]};state.liveImport=true;applyPayrollSettings('2026-09',22);downloadGross();");
 const columns=['假勤扣薪天数','假勤扣款','其他减','应发工资'];
 const columnList=JSON.stringify(columns);
 assert.equal(run("savedName"),'应发工资表_2026-09.xlsx');
 assert.deepEqual(Array.from(run(`${columnList}.map(name=>savedBook['应发工资表'].rows[1].indexOf(name))`)),[28,29,30,31]);
 assert.deepEqual(Array.from(run(`${columnList}.map(name=>savedBook['应发工资表'].rows[2][savedBook['应发工资表'].rows[1].indexOf(name)])`)),[0,0,88,2087]);
 assert.deepEqual(Array.from(run(`${columnList}.map(name=>savedBook['应发工资表'].rows[3][savedBook['应发工资表'].rows[1].indexOf(name)])`)),[1.75,175,44,1956]);
 assert.deepEqual(Array.from(run(`${columnList}.map(name=>savedBook['应发工资表'].rows[4][savedBook['应发工资表'].rows[1].indexOf(name)])`)),[null,null,66,2109]);
 assert.match(run("savedBook['应发工资表'].A5.c[0].t"),/其他工资项目继续生成/);
});
