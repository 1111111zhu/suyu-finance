import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../public/salary/index.html',import.meta.url),'utf8');
function app(){
 const element={addEventListener(){},classList:{add(){},remove(){},toggle(){}},textContent:''};
 const context=vm.createContext({document:{getElementById:()=>({...element}),querySelectorAll:()=>[],addEventListener(){}},window:{},structuredClone,setTimeout:()=>0,clearTimeout(){}});
 const source=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace("    render('overview');\n  ", '');
 vm.runInContext(fs.readFileSync(new URL('../public/salary/payroll-engine.js',import.meta.url),'utf8'),context);
 vm.runInContext(source,context);
 vm.runInContext('render=()=>{};showToast=()=>{};',context);
 return code=>vm.runInContext(code,context);
}
function directory(){
 const context=vm.createContext({document:{getElementById:()=>null},window:{},Date});
 vm.runInContext(fs.readFileSync(new URL('../public/salary/payroll-engine.js',import.meta.url),'utf8'),context);
 vm.runInContext(fs.readFileSync(new URL('../public/salary/personnel-directory.js',import.meta.url),'utf8'),context);
 return code=>vm.runInContext(code,context);
}
test('personnel collection uses payroll roster field mapping without position fallback or bank upload',()=>{
 const run=directory();
 const headers=['银行卡号','职位','员工状态','姓名','工号','签约公司','三级部门','员工类型','入职时间','转正日期'];
 run(`globalThis.testHeaders=${JSON.stringify(headers)}`);
 run('globalThis.testMap=PayrollEngine.rosterFieldMap(testHeaders)');
 assert.equal(run('testMap.map.name'),'姓名');
 assert.equal(run('testMap.map.company'),'签约公司');
 assert.equal(run('testMap.map.regularizationDate'),'转正日期');
 run("globalThis.testRoster={headers:testHeaders,index:0,grid:[testHeaders,['6222000011112222','工程师','入职','张三','001','甲公司','研发三部','试用','2026-09-02','2026-10-01']],mapping:testMap,confirmed:new Set()}");
 const row=JSON.parse(run('JSON.stringify(PersonnelDirectory.normalizedRows(testRoster)[0])'));
 assert.equal(row.values.status,'入职');
 assert.equal(row.values.join,'2026-09-02');
 assert.equal(row.values.regularizationDate,'2026-10-01');
 assert.equal(row.values.bankCard,undefined);
 const payload=JSON.parse(run('JSON.stringify(PersonnelDirectory.rosterRowsForApi({...testRoster,rows:PersonnelDirectory.normalizedRows(testRoster)})[0])'));
 assert.equal(payload.department,null);
 assert.equal(payload.thirdDepartment,'研发三部');
 assert.equal(payload.employeeNumber,'001');
 assert.equal(JSON.stringify(payload).includes('6222000011112222'),false);
 assert.match(run('PersonnelDirectory.render()'),/登录后显示真实人员数据/);
});
test('personnel collection distinguishes current WeCom state, roster history and missing payroll months',()=>{
 const run=directory();
 run("PersonnelDirectory.data.user={username:'admin'};PersonnelDirectory.data.directory={configured:true,syncedAt:'2026-09-24T03:00:00Z',fresh:true,departments:[{id:'1',name:'总公司',parentId:'',order:1}],members:[{userid:'w1',name:'甲',departmentIds:['1'],employeeId:'e1'}]};");
 run("PersonnelDirectory.data.events=[{userid:'w1',type:'regularization_recorded',label:'转正日期（花名册记载）',effectiveOn:'2026-07-05',eventAt:'2026-07-05T00:00:00Z',detectedAt:'2026-09-24T03:00:00Z',source:'花名册',sourceDetail:{fileName:'七月花名册.xlsx',sheetName:'在职',rowNumber:3},reason:'需核对计薪月'}];");
 run("PersonnelDirectory.data.tab='events'");
 const events=run('PersonnelDirectory.render()');
 assert.match(events,/2026-07-05（花名册记载）/);
 assert.match(events,/七月花名册.xlsx/);
 assert.match(events,/导入记录于/);
 run("PersonnelDirectory.data.summary={months:[{month:'2026-06',totalNet:100,headcount:1,averageNet:100,cumulativeNet:100,missing:false},{month:'2026-07',totalNet:null,headcount:null,averageNet:null,cumulativeNet:null,missing:true}],people:[]};PersonnelDirectory.data.tab='payroll'");
 const payroll=run('PersonnelDirectory.render()');
 assert.match(payroll,/月度实发总额柱状图与区间累计实发折线图/);
 assert.match(payroll,/无已确认数据（不计为 0）/);
 assert.match(payroll,/¥ 100.00/);
 run("PersonnelDirectory.data.conflicts=[{field:'department',reason:'花名册部门与企微部门不同',rosterValue:'旧部门',wecomValue:'新部门',rosterSource:{fileName:'七月花名册.xlsx',sheetName:'在职',rowNumber:3}}];PersonnelDirectory.data.tab='conflicts'");
 const conflicts=run('PersonnelDirectory.render()');
 assert.match(conflicts,/七月花名册.xlsx/);
 assert.match(conflicts,/旧部门/);
 assert.doesNotMatch(conflicts,/\[object Object\]/);
 run("PersonnelDirectory.data.tab='current';PersonnelDirectory.data.linkUserid='w1';PersonnelDirectory.data.candidates=[];PersonnelDirectory.data.directory.members[0].employeeId=null");
 assert.match(run('PersonnelDirectory.render()'),/新建工资员工记录并关联/);
});
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
 assert.equal(run('missingSourceSheets().length'),11);
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



test('six same-name leave fields and employer contributions map by name into payroll export',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲',是否入离职:'在职'},{姓名:'乙',是否入离职:'在职'}],salary:[{姓名:'甲',基本工资:2175},{姓名:'乙',基本工资:2175}],attendance:[{姓名:'乙',实发薪天数:22,年假天数:9},{姓名:'甲',实发薪天数:20,年假天数:1.5,弹性假天数:2,调休假天数:3,病假天数:.5,事假天数:.25,旷工天数:1,'病假(天)':99}],social:[{姓名:'乙',公司总计:888},{姓名:'甲',个人总计:100,公司总计:700}],fund:[{姓名:'乙',公司缴纳:999},{姓名:'甲',个人缴纳:50,公司缴纳:300}]};state.liveImport=true;applyPayrollSettings('2026-09',22);");
 const fields={年假天数:1.5,弹性假天数:2,调休假天数:3,病假天数:.5,事假天数:.25,旷工天数:1,公司缴纳公积金:300,公司缴纳社保:700};
 assert.equal(run('exportHeaders().length'),run('PayrollEngine.fields.length+PayrollEngine.netFields.length-8'));
 assert.equal(run('exportRow(employees[0]).length'),run('exportHeaders().length'));
 for(const [field,value] of Object.entries(fields)) {
  assert.equal(run(`exportRow(employees[0])[exportHeaders().indexOf('${field}')]`),value);
  assert.ok(run(`exportHeaders().includes('${field}')`));
 }
 assert.equal(run('employees[0].deductDays'),1.75);
 assert.equal(run('employees[0].net'),run('employees[0].gross'));
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
 assert.equal(run("exportRow(employees[0])[exportHeaders().indexOf('公司缴纳公积金')]"),0);assert.equal(run("exportRow(employees[0])[exportHeaders().indexOf('公司缴纳社保')]"),0);
});
test('detail workbook and salary slip include mapped leave and employer contributions',()=>{
 const run=app();
 run("window.XLSX={utils:{aoa_to_sheet:rows=>({rows}),book_new:()=>({}),book_append_sheet:(book,sheet)=>{globalThis.savedSheet=sheet;}}};downloadXlsx=()=>{};employees=[calcSalary({actualPaidDays:22,id:'X',name:'甲',status:'在职',annual:1.5,flexible:2,compensatory:3,companyFund:300,companySocial:700})];state.selectedId='X';");
 assert.equal(run('detailSheet().rows[1].length'),run('exportHeaders().length'));
 assert.equal(run("detailSheet()['!merges'].at(-1).e.c"),run('exportHeaders().length-1'));
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
 assert.match(run('payrollSettings()'),/15 日（含）以后/);
});

test('payroll labels are exported while original source date text is preserved',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲','是否入离职':'入职',入职日期:new Date(2026,7,17),离职日期:null}],salary:[{姓名:'甲',基本工资:1000}]};state.liveImport=true;applyPayrollSettings('2026-08',22);");
 assert.equal(run('employees[0].join'),'2026-08-17');
 assert.equal(run("exportRow(employees[0])[6]"),'入职');
 assert.equal(run("exportRow(employees[0])[7]"),'2026-08-17');
 assert.equal(run("exportRow(employees[0])[8]"),'');
 run("sourceRows.roster[0]['是否入离职']=' 入职 ';sourceRows.roster[0]['入职日期']='2026/08/17';recalculateEmployees();");
 assert.equal(run("exportRow(employees[0])[6]"),'入职');
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
 assert.equal(run('employees[0].gross'),run('PayrollEngine.round(2175-325+2660/21.75*.8)'));
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
 assert.match(run('payrollSettings()'),/病假 ＋ 事假 ＋ 旷工/);
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
 assert.match(html,/3 人需要核对/);assert.match(html,/社保表存在重复姓名/);assert.match(html,/考勤统计表中未找到此姓名/);assert.match(html,/&lt;bad&gt;/);assert.match(html,/&lt;丙&gt;/);
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
 run("sourceRows={roster:[{姓名:'正常'},{姓名:'缺失'},{姓名:'重复'}],attendance:[{姓名:'正常',实发薪天数:20},{姓名:'重复',实发薪天数:21},{姓名:'重复',实发薪天数:19}],salary:['正常','缺失','重复'].map(姓名=>({姓名,基本工资:2175}))};state.liveImport=true;recalculateEmployees();window.XLSX={utils:{aoa_to_sheet:rows=>({rows}),book_new:()=>({sheets:[]}),book_append_sheet:(book,sheet,name)=>book.sheets.push({sheet,name})}};downloadXlsx=(book)=>{globalThis.exported=book;};state.payrollStage='net';downloadCsv();");
 assert.equal(run('exported.sheets[0].sheet.rows.length'),6);
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
 run("sourceRows={roster:[{姓名:'甲'}],salary:[{姓名:'甲',基本工资:1000}],tax:[{姓名:'甲',个人所得税:999,税:40}]};state.payrollStage='net';sourceRows.attendance=(sourceRows.roster||[]).map(r=>({姓名:r.姓名,实发薪天数:22}));state.liveImport=true;recalculateEmployees();");
 assert.equal(run('employees[0].tax'),40);assert.equal(run('employees[0].net'),960);
});





function captureExports(run) {
 run("window.XLSX={utils:{aoa_to_sheet:rows=>{const sheet={rows};rows.forEach((row,r)=>row.forEach((v,c)=>{if(v!=null)sheet[excelColumn(c)+(r+1)]={t:typeof v==='number'?'n':'s',v};}));return sheet;},book_new:()=>({}),book_append_sheet:(book,sheet,name)=>{book[name]=sheet;}}};downloadXlsx=(book,name)=>{globalThis.savedBook=book;globalThis.savedName=name;};");
}



test('tax source and deductions remain isolated when switching payroll batches',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲'}],salary:[{姓名:'甲',基本工资:1000}],tax:[{姓名:'甲',税:120}]};sourceRows.attendance=(sourceRows.roster||[]).map(r=>({姓名:r.姓名,实发薪天数:22}));state.liveImport=true;state.payrollStage='net';recalculateEmployees();globalThis.first=currentBatch();globalThis.second={name:'下月',month:'2026-10',workdays:22};state.batches.push(second);setCurrentBatch(second);sourceRows={roster:[{姓名:'甲'}],salary:[{姓名:'甲',基本工资:1000}],tax:[{姓名:'甲',税:80}]};sourceRows.attendance=(sourceRows.roster||[]).map(r=>({姓名:r.姓名,实发薪天数:22}));state.liveImport=true;state.payrollStage='net';recalculateEmployees();setCurrentBatch(first);");
 assert.equal(run('employees[0].net'),880);
 run('setCurrentBatch(second)');assert.equal(run('employees[0].net'),920);
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
 run("sourceRows={roster:[{姓名:'甲',是否入离职:' 离职 ',离职日期:'2026-09-20'}],salary:[{姓名:'甲',基本工资:2175}],attendance:[{姓名:'甲',实发薪天数:20}]};state.liveImport=true;applyPayrollSettings('2026-09',22);");
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
  run(`sourceRows={roster:[{姓名:'甲',是否入离职:'${status}',入职日期:'${status==='入职'?'2026-09-10':'2025-01-01'}',离职日期:'${status==='离职'?'2026-09-20':''}'}],salary:[{姓名:'甲',基本工资:2175}],attendance:[{姓名:'甲',实发薪天数:${JSON.stringify(paid)},事假天数:${leave}}]};state.liveImport=true;applyPayrollSettings('2026-09',22);`);
  const blocked=status==='离职'||leave!==0;
  assert.equal(run('employees[0].payableDays'),null);
  assert.equal(run('employees[0].payrollBlocked'),blocked);
  assert.equal(run('employees[0].hasException'),true);
  for(const i of [28,29]) assert.equal(run(`exportRow(employees[0])[${i}]`),blocked?null:0);
  for(const i of [31,run("exportHeaders().indexOf('实发工资')")]) assert.equal(run(`exportRow(employees[0])[${i}]`),2175);
 }
});

test('gross payroll export keeps other reduction independent and only leaves uncomputable attendance fields blank',()=>{
 const run=app();captureExports(run);
 run("sourceRows={roster:[{姓名:'无假勤入职',是否入离职:'入职',入职日期:'2026-09-10'},{姓名:'有事假入职',是否入离职:'入职',入职日期:'2026-09-10'},{姓名:'异常假勤入职',是否入离职:'入职',入职日期:'2026-09-10'}],salary:[{姓名:'无假勤入职',基本工资:2175},{姓名:'有事假入职',基本工资:2175},{姓名:'异常假勤入职',基本工资:2175}],attendance:[{姓名:'无假勤入职',实发薪天数:''},{姓名:'有事假入职',实发薪天数:20,事假天数:1},{姓名:'异常假勤入职',实发薪天数:'',事假天数:1}],other:[{姓名:'无假勤入职',其他减:88},{姓名:'有事假入职',其他减:44},{姓名:'异常假勤入职',其他减:66}]};state.liveImport=true;applyPayrollSettings('2026-09',22);downloadGross();");
 const columns=['假勤扣薪天数','假勤扣款','其他减','应发工资'];
 const columnList=JSON.stringify(columns);
 assert.equal(run("savedName"),'应发工资表_2026-09.xlsx');
 assert.deepEqual(Array.from(run(`${columnList}.map(name=>savedBook['应发工资表'].rows[1].indexOf(name))`)),[28,29,30,31]);
 assert.deepEqual(Array.from(run(`${columnList}.map(name=>savedBook['应发工资表'].rows[2][savedBook['应发工资表'].rows[1].indexOf(name)])`)),[0,0,88,2087]);
 assert.deepEqual(Array.from(run(`${columnList}.map(name=>savedBook['应发工资表'].rows[3][savedBook['应发工资表'].rows[1].indexOf(name)])`)),[1.75,175,44,1956]);
 assert.deepEqual(Array.from(run(`${columnList}.map(name=>savedBook['应发工资表'].rows[4][savedBook['应发工资表'].rows[1].indexOf(name)])`)),[null,null,66,2109]);
 assert.match(run("savedBook['应发工资表'].A5.c[0].t"),/其他工资项目继续生成/);
});

test('explicit internship roster aliases and basic-salary priority are supported',()=>{
 const run=app();
 for(const header of ['是否实习','是否实习生','本月是否为实习生','实习标识']) {
  run(`sourceRows={roster:[{姓名:'正式甲','${header}':'否'},{姓名:'实习甲','${header}':' 是 '}],attendance:[{姓名:'正式甲',实发薪天数:22},{姓名:'实习甲',实发薪天数:18.5}],salary:[{姓名:'正式甲',基本工资:1000},{姓名:'实习甲',基本工资:9999}],other:[{姓名:'实习甲',其他减:500,其他代扣:400}],tax:[{姓名:'实习甲',税:300}]};state.liveImport=true;setInternDailyRate('实习甲',200);recalculateEmployees();`);
  assert.deepEqual(Array.from(run('employees.map(e=>e.name)')),['正式甲','实习甲']);
  assert.equal(run('employees[1].isIntern'),true);
  assert.equal(run('employees[1].net'),9999);
  assert.equal(run('employees[1].base'),9999);
  assert.equal(run('employees[1].tax'),0);
 }
});

test('intern daily rates support bulk updates, single override and batch isolation',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲',是否实习:'是'},{姓名:'乙',是否实习:'Y'}],attendance:[{姓名:'甲',实发薪天数:10},{姓名:'乙',实发薪天数:12}]};state.liveImport=true;recalculateEmployees();");
 assert.equal(run("applyBulkInternRate(['甲','乙'],180)"),true);
 assert.equal(run("setInternDailyRate('乙',220);employees.find(e=>e.name==='乙').net"),2640);
 assert.equal(run("employees.find(e=>e.name==='甲').net"),1800);
 run("globalThis.first=currentBatch();globalThis.second={name:'下月',month:'2026-10',workdays:22,data:{internDailyRates:{}}};state.batches.push(second);setCurrentBatch(second);sourceRows={roster:[{姓名:'甲',是否实习:'是'}],attendance:[{姓名:'甲',实发薪天数:8}]};state.liveImport=true;recalculateEmployees();");
 assert.equal(run("employees.find(e=>e.name==='甲').net"),0);
 run("setCurrentBatch(first)");
 assert.equal(run("employees.find(e=>e.name==='甲').net"),1800);
});

test('reimporting roster prunes only removed or non-intern daily-rate entries',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲',是否实习:'是'},{姓名:'乙',是否实习:'是'}],attendance:[{姓名:'甲',实发薪天数:10},{姓名:'乙',实发薪天数:10}]};state.liveImport=true;applyBulkInternRate(['甲','乙'],100);");
 run("pruneInternDailyRates([{姓名:'甲',是否实习:'是'},{姓名:'乙',是否实习:'否'},{姓名:'丙',是否实习:'是'}]);");
 assert.equal(run("Object.keys(internDailyRates()).sort().join(',')"),'甲');
});

test('intern mapping controls, export contract and salary slip show the basic-salary priority',()=>{
 const run=app();captureExports(run);
 run("sourceRows={roster:[{姓名:'正式',是否实习:'否'},{姓名:'实习',是否实习生:'是'}],attendance:[{姓名:'正式',实发薪天数:22},{姓名:'实习',实发薪天数:7.5}],salary:[{姓名:'正式',基本工资:1000},{姓名:'实习',基本工资:9999}]};state.liveImport=true;setInternDailyRate('实习',300);state.payrollStage='gross';recalculateEmployees();");
 assert.match(run('renderMapping()'),/实习生工资设置/);
 assert.match(run('renderMapping()'),/不模糊匹配其他包含“实习”的列/);
 assert.equal(run('exportHeaders().length'),run('PayrollEngine.fields.length+PayrollEngine.netFields.length-8'));
 assert.equal(run("exportRow(employees.find(e=>e.name==='正式'))[exportHeaders().indexOf('是否实习生')]"),'');
 assert.equal(run("exportRow(employees.find(e=>e.name==='实习'))[exportHeaders().indexOf('是否实习生')]"),'是');
 for(const field of ['日薪','转正日期','转正前应出勤天数','转正后应出勤天数','转正前工资','转正后工资','转正前工资小计','转正后工资小计']) assert.equal(run(`exportHeaders().includes('${field}')`),false);
 assert.equal(run("exportRow(employees.find(e=>e.name==='实习'))[10]"),7.5);
 assert.equal(run("exportRow(employees.find(e=>e.name==='实习'))[exportHeaders().indexOf('实发工资')]"),9999);
 run("state.payrollStage='net';state.selectedId=employees.find(e=>e.name==='实习').id");
 assert.match(run('renderSlip()'),/基本工资/);
 run('downloadSlip()');
 assert.equal(run("savedBook['工资条'].rows.find(r=>r[0]==='计算公式')[1]"),'基本工资');
});

// Revised workflow: stage-owned sources, optional gross override, complete comparison.
function seedPayroll(run) {
 run("sourceRows={roster:[{姓名:'甲',是否入离职:'在职',一级部门:'研发'}],salary:[{姓名:'甲',基本工资:10000}],attendance:[{姓名:'甲',实发薪天数:22}],social:[{姓名:'甲',个人总计:600,公司总计:9999}],fund:[{姓名:'甲',个人缴纳:400,公司缴纳:9999}],other:[{姓名:'甲',其他代扣:999}],utility:[{姓名:'甲',水电费合计:999}],meal:[{姓名:'甲',餐费合计:999}]};state.liveImport=true;state.payrollStage='gross';applyPayrollSettings('2026-09',22);");
}
function netSources(run) {
 run("sourceRows.netSocial=[{姓名:'甲',个人总计:500,公司总计:1000}];sourceRows.netFund=[{姓名:'甲',个人缴纳:300,公司缴纳:300}];sourceRows.tax=[{姓名:'甲',税:200}];sourceRows.afterTax=[{姓名:'甲',水电代扣:20,餐费代扣:30,其它代扣:50,备注:'核对通过'}];switchPayrollStage('net');");
}
test('active employees compare days first and sum sick, personal and absent leave only',()=>{
 const run=app();
 for(const [expected,paid,sick,personal,absent,days] of [[22,22,1,2,3,0],[22,20,1,.5,.25,1.75],[22,20,0,0,0,0],[22,23,0,1,0,1],[18.5,18,0,.5,0,.5]]) {
  const value=run(`calcSalary({status:'在职',actualPaidDays:${paid},base:2175,sick:${sick},personal:${personal},absent:${absent}},'2026-09',${expected})`);
  assert.equal(value.deductDays,days);assert.equal(value.attendanceDeduct,days*100);
 }
});
test('both stages expose their own social and fund inputs with exactly five second-stage slots',()=>{
 const run=app();
 assert.deepEqual(Array.from(run('stageSheets().map(s=>s.key)')),['roster','salary','performance','attendance','other','social','fund']);
 run("switchPayrollStage('net')");
 assert.deepEqual(Array.from(run('stageSheets().map(s=>s.key)')),['grossUpload','tax','netSocial','netFund','afterTax']);
 for(const [file,row,key] of [['社保.xlsx',{姓名:'甲',个人总计:1},'netSocial'],['公积金.xlsx',{姓名:'甲',个人缴纳:1},'netFund'],['税后代扣.xlsx',{姓名:'甲',其它代扣:1},'afterTax'],['应发工资.xlsx',{姓名:'甲',应发工资:1},'grossUpload'],['税.xlsx',{姓名:'甲',税:1},'tax']]) assert.equal(run(`matchSource(${JSON.stringify(file)},[${JSON.stringify(row)}]).key`),key);
 assert.equal(run("matchSource('导出.xlsx',Object.assign([{姓名:'甲',备注:''}],{sheetName:'税后代扣表'})).key"),'afterTax');
});
test('gross contribution columns are informative, second-stage deductions use their own uploads exactly once',()=>{
 const run=app();seedPayroll(run);captureExports(run);
 assert.equal(run('employees[0].gross'),10000);assert.equal(run('employees[0].social'),600);assert.equal(run('employees[0].fund'),400);
 run('downloadGross()');
 assert.equal(run("savedBook['应发工资表'].AG3.t"),'n');assert.equal(run("savedBook['应发工资表'].AG3.v"),600);
 assert.equal(run("savedBook['应发工资表'].AH4.v"),400);
 netSources(run);
 assert.equal(run('employees[0].net'),8900);assert.equal(run('employees[0].companyCost'),11300);
 assert.equal(run('employees[0].afterTaxTotal'),100);assert.equal(run('employees[0].remark'),'核对通过');
 assert.equal(run('sourceRows.social[0].个人总计'),600);
 run("sourceRows.netSocial[0].个人总计=700;recalculateEmployees();switchPayrollStage('gross');");
 assert.equal(run('employees[0].social'),600);assert.equal(run('employees[0].gross'),10000);
});
test('missing second-stage contributions do not fall back to the first stage and never block export',()=>{
 const run=app();seedPayroll(run);captureExports(run);run("switchPayrollStage('net');downloadCsv();");
 assert.equal(run('employees[0].net'),10000);assert.equal(run('employees[0].companyCost'),10000);
 assert.match(run("visibleIssues(employees[0]).join('；')"),/个人社保未上传/);
 assert.ok(run("savedBook['工资明细表'].A3.c[0].t.includes('未上传')"));
});
test('uploaded gross is authoritative, regenerated gross cannot overwrite it, removal restores latest generated gross',()=>{
 const run=app();seedPayroll(run);netSources(run);
 run("commitSource('grossUpload',{filename:'调整应发.xlsx',rows:[{姓名:'甲',应发工资:12000,是否实习生:'否'}]});");
 assert.equal(run('state.grossSource'),'uploaded');assert.equal(run('employees[0].net'),10900);
 assert.equal(run('state.comparison.status'),'different');
 run("sourceRows.salary[0].基本工资=11000;recalculateEmployees();");
 assert.equal(run('generatedEmployees[0].gross'),11000);assert.equal(run('employees[0].gross'),12000);
 assert.equal(run("state.comparison.differences.find(d=>d.field==='应发工资').delta"),1000);
 run('removeUploadedGross()');
 assert.equal(run('state.grossSource'),'generated');assert.equal(run('employees[0].net'),9900);
 assert.equal(run('state.comparison.status'),'not-needed');
});
test('net stage operates on an uploaded gross table without a roster or generated result',()=>{
 const run=importApp();captureExports(run);
 run("globalThis.empty={name:'独立实发',month:'2026-09',workdays:22};state.batches.push(empty);setCurrentBatch(empty);switchPayrollStage('net');");
 assert.equal(run('stageReady()'),false);
 run("commitSource('grossUpload',{filename:'应发.xlsx',rows:[{姓名:'独立员工',应发工资:'￥2,000.50'}]});calculateStage();downloadCsv();");
 assert.equal(run('stageReady()'),true);assert.equal(run('employees[0].net'),2000.5);
 assert.equal(run('state.comparison.status'),'unavailable');
 assert.match(run('renderComparison()'),/未校验：缺少第一阶段生成结果/);
 assert.match(run("savedBook['工资明细表'].A3.c[0].t"),/缺少实习生标识/);
});
test('failed uploads keep the last usable source, show errors and allow calculations and exports',async()=>{
 const run=importApp();seedPayroll(run);netSources(run);captureExports(run);
 run("commitSource('grossUpload',{filename:'正常.xlsx',rows:[{姓名:'甲',应发工资:12000,是否实习生:'否'}]});");
 await run("importFiles([{name:'损坏应发工资.xlsx',error:'无法解析文件'}],'grossUpload')");
 run('calculateStage();downloadCsv()');
 assert.equal(run('employees[0].gross'),12000);assert.equal(run("savedBook['工资明细表'][excelColumn(exportHeaders().indexOf('实发工资'))+'3'].v"),10900);
 assert.match(run('renderResults()'),/无法解析文件/);
 assert.match(run("savedBook['工资明细表'].A2.c[0].t"),/无法解析文件/);
 await run("importFiles([{name:'新应发工资.xlsx',rows:[{姓名:'甲',应发工资:13000,是否实习生:'否'}]}],'grossUpload')");
 assert.equal(run('employees[0].gross'),13000);
});
test('full comparison ignores ordering and display format but distinguishes blank from explicit zero',()=>{
 const run=app();
 run("globalThis.a=[{姓名:'甲',应发工资:1000,个人社保:100,入职日期:'2026-09-01',是否实习生:'否'},{姓名:'乙',应发工资:2000,个人社保:0,入职日期:'2026-09-02',是否实习生:'是'}];globalThis.b=[{姓名:' 乙 ',个人总计:'0.00',应发工资:'2,000.00',入职日期:'2026/9/2',是否实习:'Y'},{是否实习:'否',入职日期:'2026年9月1日',个人社保:'￥100.00',姓名:'甲',应发工资:'1,000.004'}];");
 assert.equal(run('PayrollEngine.compare(a,b).status'),'equal');
 run("b[0].个人总计=''");
 assert.equal(run('PayrollEngine.compare(a,b).differences.length'),1);
 assert.equal(run('PayrollEngine.compare(a,b).differences[0].field'),'个人社保');
});
test('comparison detects personnel, duplicate names, all business fields and schema changes',()=>{
 const run=app();
 run("globalThis.a=[{姓名:'甲',应发工资:1000,岗位工资:100,个人公积金:30},{姓名:'乙',应发工资:2000,岗位工资:200,个人公积金:50},{姓名:'重名',应发工资:1}];globalThis.b=[{姓名:'甲',应发工资:1100,岗位工资:150,新增列:1},{姓名:'丙',应发工资:3000},{姓名:'重名',应发工资:1},{姓名:'重名',应发工资:2}];globalThis.compared=PayrollEngine.compare(a,b);");
 for(const reason of ['上传表新增字段','上传表缺失字段','上传表新增人员','上传表缺失人员','姓名为空或重复，无法唯一比对']) assert.equal(run(`compared.differences.some(d=>d.reason==='${reason}')`),true);
 assert.equal(run("compared.differences.find(d=>d.name==='甲'&&d.field==='岗位工资').delta"),50);
 assert.equal(run("compared.differences.find(d=>d.name==='甲'&&d.field==='应发工资').delta"),100);
});
test('comparison is recalculated on any source update and does not block output; missing people remain traceable',()=>{
 const run=app();seedPayroll(run);netSources(run);captureExports(run);
 run("sourceRows.roster.push({姓名:'乙'});sourceRows.salary.push({姓名:'乙',基本工资:200});sourceRows.attendance.push({姓名:'乙',实发薪天数:22});recalculateEmployees();commitSource('grossUpload',{filename:'应发.xlsx',rows:[{...PayrollEngine.grossRecord(generatedEmployees[0]),应发工资:12000}]});downloadCsv();");
 assert.match(run("savedBook['工资明细表'].A3.c[0].t"),/应发工资.*第一阶段 10000.*上传表 12000/);
 assert.match(run("savedBook['工资明细表'].A2.c[0].t"),/乙：上传表缺失人员/);
 run("commitSource('grossUpload',{filename:'一致.xlsx',rows:generatedEmployees.map(PayrollEngine.grossRecord)});downloadCsv();");
 assert.equal(run('state.comparison.status'),'equal');
 assert.equal(run("(savedBook['工资明细表'].A3.c||[]).some(c=>c.t.includes('上传表 12000'))"),false);
});
test('all second-stage malformed, missing and duplicate amounts warn and retain first numeric entry',()=>{
 const run=app();seedPayroll(run);netSources(run);
 run("sourceRows.netSocial=[{姓名:'甲',个人总计:'坏金额',公司总计:'￥1,000.00'}];sourceRows.netFund=[{姓名:'甲',个人缴纳:'',公司缴纳:300}];sourceRows.tax=[{姓名:'甲',税:40},{姓名:'甲',税:100}];sourceRows.afterTax=[{姓名:'乙',水电代扣:9}];recalculateEmployees();");
 assert.equal(run('employees[0].social'),0);assert.equal(run('employees[0].fund'),0);assert.equal(run('employees[0].tax'),40);assert.equal(run('employees[0].net'),9960);
 const issues=run("visibleIssues(employees[0]).join('；')");
 assert.match(issues,/个人社保金额缺失或无效/);assert.match(issues,/个税姓名重复/);assert.match(issues,/水电代扣未找到匹配/);
});
test('intern marker survives export/reimport, exempting social and fund but deducting tax and post-tax withholding',()=>{
 const run=app();seedPayroll(run);netSources(run);captureExports(run);
 run("sourceRows.grossUpload=[{姓名:'甲',应发工资:3700,是否实习生:'是',日薪:200,实发薪天数:18.5}];recalculateEmployees();downloadCsv();");
 assert.equal(run('employees[0].net'),3400);assert.equal(run('employees[0].afterTaxTotal'),100);assert.equal(run('employees[0].tax'),200);
 assert.equal(run('employees[0].social'),0);assert.equal(run('employees[0].fund'),0);
 assert.equal(run('employees[0].companyCost'),5000);
 assert.equal(run("savedBook['工资明细表'][excelColumn(exportHeaders().indexOf('实发工资'))+'3'].v"),3400);
 assert.match(run("savedBook['工资明细表'][excelColumn(exportHeaders().indexOf('实发工资'))+'3'].f"),/^IF\(AI3="是"/);
});
test('batch switching restores both stage-owned contributions, authoritative gross source and comparison',()=>{
 const run=app();seedPayroll(run);netSources(run);
 run("commitSource('grossUpload',{filename:'调整.xlsx',rows:[{姓名:'甲',应发工资:12000,是否实习生:'否'}]});globalThis.first=currentBatch();globalThis.second={name:'十月',month:'2026-10',workdays:22};state.batches.push(second);setCurrentBatch(second);switchPayrollStage('net');");
 assert.equal(run('state.grossSource'),'none');assert.equal(run('employees.length'),0);
 run("commitSource('grossUpload',{filename:'十月.xlsx',rows:[{姓名:'乙',应发工资:900,是否实习生:'否'}]});setCurrentBatch(first);");
 assert.equal(run('employees[0].net'),10900);assert.equal(run('state.grossSource'),'uploaded');assert.equal(run('state.comparison.status'),'different');
 assert.equal(run('sourceRows.social[0].个人总计'),600);assert.equal(run('sourceRows.netSocial[0].个人总计'),500);
 run('setCurrentBatch(second)');assert.equal(run('employees[0].name'),'乙');assert.equal(run('employees[0].net'),900);
});
test('numeric export cells carry live formulas and cached results matching UI and summaries',()=>{
 const run=app();seedPayroll(run);netSources(run);captureExports(run);run('downloadCsv()');
 const ref=label=>run(`excelColumn(exportHeaders().indexOf('${label}'))+'3'`);
 const cell=label=>run(`savedBook['工资明细表'][${JSON.stringify(ref(label))}]`);
 for(const [label,value] of [['应发工资',10000],['个人社保',500],['个人公积金',300],['税后代扣合计',100],['实发工资',8900],['公司总成本',11300]]) {
  assert.equal(cell(label).t,'n');assert.equal(cell(label).v,value);assert.equal(cell(label).z,'0.00');
 }
 assert.equal(cell('税后代扣合计').f,`ROUND(${ref('其它代扣')}+${ref('水电代扣')}+${ref('餐费代扣')},2)`);
 assert.equal(cell('公司总成本').f,`ROUND(${ref('应发工资')}+${ref('公司缴纳社保')}+${ref('公司缴纳公积金')},2)`);
 assert.equal(run("savedBook['汇总统计'].K2.v"),8900);assert.equal(run("savedBook['汇总统计'].O2.v"),11300);
 assert.match(run("savedBook['工资明细表'][excelColumn(exportHeaders().indexOf('实发工资'))+'4'].f"),/SUM\(/);
});
test('generated grouped headers round-trip through grid parsing without importing total rows',()=>{
 const run=app();seedPayroll(run);captureExports(run);run('downloadGross()');
 run("globalThis.parsed=PayrollEngine.rowsFromGrid(savedBook['应发工资表'].rows);commitSource('grossUpload',{filename:'回读.xlsx',rows:parsed});switchPayrollStage('net');");
 assert.equal(run('parsed.length'),1);assert.equal(run('parsed[0].个人社保'),600);assert.equal(run('parsed[0].是否实习生'),'');assert.equal(run('state.comparison.status'),'equal');
 assert.throws(()=>run("PayrollEngine.rowsFromGrid([['姓名','姓名'],['甲','乙']])"),/重复列/);
 assert.throws(()=>run("PayrollEngine.rowsFromGrid([['其他字段'],['甲']])"),/姓名/);
});

test('regularization uses current-month expected workdays rather than a fixed 21.75 weight',()=>{
 const run=app();
 const employee=`{name:'乙',status:'在职',actualPaidDays:21,regularizationDate:'2026-08-25',probationWorkdays:16,probationBase:9000,regularBase:10000}`;
 run(`globalThis.result=calcSalary(${employee},'2026-08',21)`);
 assert.equal(run('result.regularizationActive'),true);
 assert.equal(run('result.regularizationBlocked'),false);
 assert.equal(run('result.probationWorkdays'),16);
 assert.equal(run('result.regularWorkdays'),5);
 assert.equal(run('result.probationSubtotal'),9000);
 assert.equal(run('result.regularSubtotal'),10000);
 assert.equal(run('PayrollEngine.round(result.gross)'),9238.10);
 assert.equal(run('PayrollEngine.round(result.gross)'),run('PayrollEngine.round(9000/21*16+10000/21*(21-16))'));
 assert.notEqual(run('PayrollEngine.round(result.gross)'),run('PayrollEngine.round(9000/21.75*16+10000/21.75*(21.75-16))'));
 run(`globalThis.differentMonth=calcSalary(${employee},'2026-08',22)`);
 assert.equal(run('differentMonth.regularWorkdays'),6);
 assert.equal(run('PayrollEngine.round(differentMonth.gross)'),run('PayrollEngine.round(9000/22*16+10000/22*6)'));
});

test('regularization fields import from roster, salary and attendance sources and validate the day split',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲',转正日期:'2026-08-17'}],salary:[{姓名:'甲',转正前基本工资:10000,转正后基本工资:20200}],attendance:[{姓名:'甲',实发薪天数:21,转正前应出勤天数:10}]};state.liveImport=true;applyPayrollSettings('2026-08',21);");
 assert.equal(run('employees.length'),1);
 assert.equal(run('employees[0].regularizationDate'),'2026-08-17');
 assert.equal(run('employees[0].regularWorkdays'),11);
 assert.equal(run('employees[0].probationSubtotal'),10000);
 assert.equal(run('employees[0].regularSubtotal'),20200);
 assert.equal(run('employees[0].gross'),15342.86);
 for (const field of ['日薪','转正日期','转正前应出勤天数','转正后应出勤天数','转正前工资','转正后工资','转正前工资小计','转正后工资小计']) assert.equal(run(`exportHeaders().includes('${field}')`),false);
 run("sourceRows.attendance[0].转正后应出勤天数=11.75;recalculateEmployees();");
 assert.equal(run('employees[0].regularizationBlocked'),true);
 assert.match(run('employees[0].exception'),/之和必须等于当月应工作天数/);
 assert.equal(run('employees[0].gross'),0);
});

test('regularization columns and calculations stay absent when no employee has a current-month regularization date',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲',是否入离职:'在职'},{姓名:'乙',是否入离职:'在职',转正日期:''}],salary:[{姓名:'甲',基本工资:10000},{姓名:'乙',基本工资:8000}],attendance:[{姓名:'甲',实发薪天数:21},{姓名:'乙',实发薪天数:21}]};state.liveImport=true;applyPayrollSettings('2026-08',21);");
 assert.equal(run('employees.every(employee=>employee.regularizationActive===false)'),true);
 assert.equal(run('employees[0].gross'),10000);
 for (const field of ['转正日期','转正前应出勤天数','转正后应出勤天数','转正前工资','转正后工资','转正前工资小计','转正后工资小计']) assert.equal(run(`exportHeaders().includes('${field}')`),false);
 assert.doesNotMatch(run('renderGrossResults()'),/转正前工资/);
});

test('regularization total salary headers are captured and workdays are derived from the transfer date',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲',转正日期:'2026-08-17'}],salary:[{姓名:'甲',转正前工资:10000,转正后工资:20200}],attendance:[{姓名:'甲',实发薪天数:21}]};state.liveImport=true;applyPayrollSettings('2026-08',21);");
 assert.equal(run('employees[0].regularizationActive'),true);
 assert.equal(run('employees[0].probationWorkdays'),10);
 assert.equal(run('employees[0].regularWorkdays'),11);
 assert.equal(run('PayrollEngine.round(employees[0].probationSalary)'),run('PayrollEngine.round(10000/21*10)'));
 assert.equal(run('PayrollEngine.round(employees[0].regularSalary)'),run('PayrollEngine.round(20200/21*11)'));
 assert.equal(run('employees[0].gross'),15342.86);
});

test('weekend makeup workdays are included when deriving the pre-regularization segment',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲',转正日期:'2026-08-10'}],salary:[{姓名:'甲',转正前工资:10000,转正后工资:20000}],attendance:[{姓名:'甲',实发薪天数:21}]};state.liveImport=true;applyPayrollSettings('2026-08',21,'2026-08-08');");
 assert.equal(run('employees[0].probationWorkdays'),6);
 assert.equal(run('employees[0].regularWorkdays'),15);
 assert.equal(run('employees[0].gross'),run('PayrollEngine.round(10000/21*6+20000/21*15)'));
});

test('out-of-month transfer dates and incomplete transition salaries warn without blocking output',()=>{
 const run=app();
 run("sourceRows={roster:[{姓名:'甲',转正日期:'2026-07-17'},{姓名:'乙',转正日期:'2026-08-17'}],salary:[{姓名:'甲',转正前工资:10000,转正后工资:20200},{姓名:'乙',转正前工资:10000}],attendance:[{姓名:'甲',实发薪天数:21},{姓名:'乙',实发薪天数:21}]};state.liveImport=true;applyPayrollSettings('2026-08',21);");
 assert.equal(run('employees[0].regularizationActive'),false);
 assert.doesNotMatch(run('employees[0].exception'),/不在当前计薪月份/);
 assert.equal(run('employees[0].gross'),0);
 assert.equal(run('employees[1].regularizationBlocked'),true);
 assert.match(run('employees[1].exception'),/缺少转正前或转正后工资/);
 assert.equal(run('payrollExportReady()'),true);
});
