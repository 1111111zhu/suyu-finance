import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import XLSX from 'xlsx';
const base=new URL('../public/salary/',import.meta.url);
function app(){
 const element={innerHTML:'',value:'',dataset:{},addEventListener(){},querySelectorAll:()=>[],classList:{add(){},remove(){},toggle(){}}};
 const c=vm.createContext({document:{getElementById:()=>({...element}),querySelectorAll:()=>[],addEventListener(){}},window:{XLSX},structuredClone,setTimeout:()=>0,clearTimeout(){},__PAYROLL_TEST__:true});
 const run=code=>vm.runInContext(code,c);
 for(const file of ['payroll-engine.js','payroll-email-engine.js'])run(fs.readFileSync(new URL(file,base),'utf8'));
 run(fs.readFileSync(new URL('index.html',base),'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
 run('render=()=>{};showToast=()=>{};bindView=()=>{};');
 for(const file of ['source-preview.js','workbench-core.js','workbench-pages.js','workbench-ui.js'])run(fs.readFileSync(new URL(file,base),'utf8'));
 run('render=()=>{};showToast=()=>{};bindView=()=>{};');
 run(`currentMonth='2026-09';currentWorkdays=22;state.sourceStatus={};sourceRows={};state.liveImport=true;state.payrollStage='gross';state.batches=[{name:'测试批次',month:currentMonth,workdays:22,active:true,draftOrigin:'empty',data:{internDailyRates:{}}}];`);
 return {run,importFiles:run('importFiles'),parse:run('parseXlsxFile')};
}
function file(name,sheets){
 const book=XLSX.utils.book_new();for(const [sheet,grid] of sheets)XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(grid),sheet);
 const bytes=XLSX.write(book,{type:'array',bookType:'xlsx'});
 return {name,size:bytes.byteLength,arrayBuffer:async()=>bytes};
}
const roster=(name,id)=>[['员工姓名','工号','入职日期'],[name,id,'2025-01-01']];
test('explicit other upload maps unnamed amounts by employee through saved batches and XLSX export',async()=>{
 const a=app();await a.importFiles([file('花名册.xlsx',[['人员',[['姓名','工号','入职日期'],['甲','001','2025-01-01'],['乙','002','2025-01-01']]]])],'roster');
 await a.importFiles([file('工资.xlsx',[['工资',[['姓名','基本工资'],['甲',1000],['乙',2000]]]])],'salary');
 await a.importFiles([file('补发明细.xlsx',[['Sheet1',[['员工姓名','金额（元）'],['乙',500],[' 甲 ','￥1,250.50']]],['第二笔',[['姓名','金额'],['甲',49.5]]]])],'other');
 assert.equal(a.run('importSession().items.length'),0);
 assert.deepEqual(Array.from(a.run('employees.map(e=>e.otherAdd)')),[1300,500]);
 assert.deepEqual(Array.from(a.run('employees.map(e=>e.gross)')),[2300,2500]);
 a.run('saveBatchData();globalThis.saved=structuredClone(currentBatch());state.batches.push({...saved,name:"恢复批次",active:false});setCurrentBatch(state.batches[1]);');
 const sheet=a.run('detailSheet(true)'),headers=a.run('exportHeaders(true)'),col=label=>XLSX.utils.encode_col(headers.indexOf(label));
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'应发工资');
 const exported=XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer',cellFormula:true}).Sheets['应发工资'];
 assert.equal(exported[col('其他加')+'3'].v,1300);assert.equal(exported[col('其他加')+'4'].v,500);assert.equal(exported[col('其他加')+'5'].v,1800);
 assert.equal(exported[col('应发工资')+'3'].v,2300);assert.equal(exported[col('应发工资')+'4'].v,2500);assert.equal(exported[col('应发工资')+'5'].v,4800);
 assert.match(exported[col('应发工资')+'3'].f,new RegExp(col('其他加')+'3'));
 assert.equal(a.run('sourceRows.other[0]._importSource.filename'),'补发明细.xlsx');
});
test('explicit unnamed other amounts reject ambiguous or invalid columns without losing prior additions',async()=>{
 const a=app();await a.importFiles([file('补发.xlsx',[['Sheet1',[['姓名','金额'],['甲',100]]]])],'other');
 for(const grid of [[['姓名','金额','总金额'],['甲',200,300]],[['姓名','金额'],['甲','无效']],[['姓名','金额'],['甲',null]],[['姓名','天数'],['甲',2]]]) {
  await a.importFiles([file('补发.xlsx',[['Sheet1',grid]])],'other','replace');
  assert.equal(a.run('sourceRows.other[0].其他加'),100);assert.match(a.run('importSession().summary'),/原有资料已保留/);
 }
});
test('manual module resolution maps plain amounts and preserves explicit zero',async()=>{
 const a=app();await a.importFiles([file('补发.xlsx',[['Sheet1',[['姓名','金额'],['甲',0],['乙',200]]]])]);
 assert.equal(a.run('importSession().items.length'),1);a.run('resolveImport(0,"other")');
 assert.equal(a.run('importSession().items.length'),0);
 assert.equal(a.run('sourceRows.other[0].其他加'),0);assert.equal(a.run('sourceRows.other[1].其他加'),200);
});
test('two roster files merge, repeated upload replaces only that file, all rows retain provenance',async()=>{
 const a=app();
 await a.importFiles([file('花名册A.xlsx',[['人员一',roster('甲','001')]]),file('花名册B.xlsx',[['人员二',roster('乙','002')]])],'roster');
 assert.equal(a.run('employees.length'),2);assert.equal(a.run('state.sourceStatus.roster.files'),2);assert.equal(a.run('importSession().items.length'),0);
 assert.equal(a.run('sourceRows.roster[1]._rosterSource.filename'),'花名册B.xlsx');assert.equal(a.run('sourceRows.roster[1]._rosterSource.rowNumber'),2);
 await a.importFiles([file('花名册A.xlsx',[['人员一',roster('丙','003')]])],'roster');
 assert.deepEqual(Array.from(a.run('employees.map(e=>e.name).sort()')),['丙','乙']);assert.equal(a.run('sourceRows.roster.length'),2);
});
test('all worksheets and mixed modules in one workbook are imported',async()=>{
 const a=app();await a.importFiles([file('资料.xlsx',[
 ['说明',[['说明文本']]],['花名册A',roster('甲','001')],['花名册B',roster('乙','002')],
 ['基本工资',[['姓名','金额'],['甲',1000],['乙',2000]]],['绩效系数',[['姓名','数值'],['甲',1],['乙',0.8]]],
 ['实际出勤天数',[['姓名','天数'],['甲',22],['乙',22]]]])]);
 assert.equal(a.run('employees.length'),2);assert.equal(a.run('sourceRows.roster.length'),2);assert.equal(a.run('sourceRows.salary.length'),2);
 assert.equal(a.run('employees[1].base'),2000);assert.equal(a.run('employees[1].score'),0.8);assert.equal(a.run('importSession().items.length'),0);
});
test('other allowances, additions and reductions recognize headers or either name and combine by employee',async()=>{
 const a=app();await a.importFiles([file('花名册.xlsx',[['人员',roster('甲','001')]]),file('工资.xlsx',[['基本工资',[['姓名','基本工资'],['甲',1000]]]])]);
 await a.importFiles([file('其他津贴.xlsx',[['Sheet1',[['姓名','金额（元）'],['甲',50]]]]),file('补发.xlsx',[['其他加',[['姓名','金额'],['甲',200]]],['其他加第二笔',[['姓名','金额'],['甲',100]]]]),file('减项.xlsx',[['Sheet1',[['姓名','本月其他减（元）'],['甲',20]]]])],'other');
 assert.equal(a.run('employees[0].otherAllow'),50);assert.equal(a.run('employees[0].otherAdd'),300);assert.equal(a.run('employees[0].otherReduction'),20);assert.equal(a.run('employees[0].gross'),1330);
 await a.importFiles([file('补发.xlsx',[['其他加',[['姓名','金额'],['甲',250]]]])],'other');assert.equal(a.run('employees[0].otherAdd'),250);assert.equal(a.run('sourceRows.other.length'),3);
});
test('every financial module recognizes its field in file name, sheet name, or header',async()=>{
 for(const [module,field,value] of [['salary','基本工资',1000],['performance','绩效系数',0.8],['attendance','实际出勤天数',22],['other','其他减',30],['netSocial','个人社保',100],['netFund','个人公积金',80],['tax','个人所得税',50],['afterTax','水电代扣',10],['grossUpload','应发工资',1200]]){
  for(const location of ['file','sheet','header']){
   const a=app();if(['netSocial','netFund','tax','afterTax','grossUpload'].includes(module))a.run(`state.payrollStage='net'`);
   const name=location==='file'?field+'.xlsx':'数据.xlsx',sheet=location==='sheet'?field:'Sheet1',header=location==='header'?field:'金额';
   await a.importFiles([file(name,[[sheet,[['姓名',header],['甲',value]]]])]);
   assert.equal(a.run(`sourceRows.${module}?.length`),1,module+' '+location);assert.equal(a.run('importSession().items.length'),0,module+' '+location);
  }
 }
});
test('ambiguous named amounts fail without overwriting existing data',async()=>{
 const a=app();await a.importFiles([file('其他加.xlsx',[['Sheet1',[['姓名','金额'],['甲',100]]]])],'other');
 await a.importFiles([file('其他加.xlsx',[['Sheet1',[['姓名','金额','总金额'],['甲',200,300]]]])],'other');
 assert.equal(a.run('sourceRows.other[0].其他加'),100);assert.match(a.run('importSession().items[0].error'),/不唯一/);
});
test('new roster file does not prune another file intern rates and batch restore keeps filenames',async()=>{
 const a=app();const grid=(name,id)=>[['姓名','工号','职位','入职日期'],[name,id,'实习生','2025-01-01']];
 await a.importFiles([file('花名册A.xlsx',[['人员',grid('甲','001')]])],'roster');a.run("internDailyRates().甲=120");
 await a.importFiles([file('花名册B.xlsx',[['人员',grid('乙','002')]])],'roster');assert.equal(a.run('internDailyRates().甲'),120);
 a.run('saveBatchData();globalThis.saved=structuredClone(currentBatch());state.batches.push({...saved,name:"第二批次",active:false});setCurrentBatch(state.batches[1]);');
 assert.equal(a.run('sourceRows.roster[0]._importSource.filename'),'花名册A.xlsx');assert.equal(a.run('state.sourceStatus.roster.files'),2);
});
test('all input controls support multiple files at both payroll stages',()=>{
 const a=app();for(const stage of ['gross','net']){
  a.run(`state.payrollStage='${stage}'`);const html=a.run('PayrollWorkbenchPages.upload()');
  const controls=html.match(/<input type="file"[^>]+data-source-input[^>]+>/g);assert.ok(controls.length>=5);assert.ok(controls.every(control=>/multiple/.test(control)));
 }
});

test('multi-file salary, attendance and net deductions calculate every employee with correct source file',async()=>{
 const a=app();await a.importFiles([file('花名册A.xlsx',[['人员',roster('甲','001')]]),file('花名册B.xlsx',[['人员',roster('乙','002')]])]);
 for(const [name,amount] of [['甲',1000],['乙',2000]])await a.importFiles([file(name+'基本工资.xlsx',[['Sheet1',[['姓名','基本工资'],[name,amount]]]]),file(name+'考勤.xlsx',[['Sheet1',[['姓名','实际出勤天数'],[name,22]]]])]);
 assert.equal(a.run('employees[1].gross'),2000);
 assert.equal(a.run('PayrollWorkbench.source(employees[1],"base").filename'),'乙基本工资.xlsx');
 a.run("state.payrollStage='net';recalculateEmployees();render=()=>{}");
 for(const [name,amount] of [['甲',100],['乙',200]])await a.importFiles([file(name+'社保.xlsx',[['Sheet1',[['姓名','个人总计','公司总计'],[name,amount,amount*2]]]]),file(name+'个税.xlsx',[['Sheet1',[['姓名','个税'],[name,50]]]])]);
 assert.equal(a.run('employees[0].net'),850);assert.equal(a.run('employees[1].net'),1750);assert.equal(a.run('state.sourceStatus.netSocial.files'),2);
});
test('salary components and social contributions split by field keep matching by name',async()=>{
 const a=app();await a.importFiles([file('花名册.xlsx',[['人员',roster('甲','001')]]),file('基本工资.xlsx',[['Sheet1',[['姓名','金额'],['甲',1000]]]]),file('岗位工资.xlsx',[['Sheet1',[['姓名','金额'],['甲',300]]]])]);
 assert.equal(a.run('employees[0].gross'),1300);
 a.run("state.payrollStage='net';recalculateEmployees();render=()=>{}");
 await a.importFiles([file('个人社保.xlsx',[['Sheet1',[['姓名','金额'],['甲',100]]]]),file('公司总计.xlsx',[['Sheet1',[['姓名','金额'],['甲',200]]]])]);
 assert.equal(a.run('employees[0].social'),100);assert.equal(a.run('employees[0].companySocial'),200);assert.equal(a.run('employees[0].companyCost'),1500);
});


test('replace swaps the entire selected module atomically, preserving other modules and every new file',async()=>{
 const a=app();await a.importFiles([file('花名册.xlsx',[['人员',roster('甲','001')]])],'roster');
 await a.importFiles([file('工资A.xlsx',[['薪资',[['姓名','基本工资'],['甲',1000]]]]),file('工资B.xlsx',[['薪资',[['姓名','岗位工资'],['甲',200]]]])],'salary');
 const before=a.run('JSON.stringify(sourceRows.roster)');
 await a.importFiles([file('新工资.xlsx',[['一',[['姓名','基本工资'],['甲',3000]]],['二',[['姓名','绩效基数'],['甲',100]]]]),file('岗位.xlsx',[['岗位',[['姓名','岗位工资'],['甲',500]]]])],'salary','replace');
 assert.equal(a.run('employees[0].base'),3000);assert.equal(a.run('employees[0].post'),500);
 assert.equal(a.run('sourceRows.salary.length'),3);assert.equal(a.run('state.sourceStatus.salary.files'),2);
 assert.deepEqual(Array.from(a.run('state.sourceStatus.salary.filenames')),['新工资.xlsx','岗位.xlsx']);assert.equal(a.run('JSON.stringify(sourceRows.roster)'),before);
 assert.deepEqual(Array.from(a.run('Object.keys(state.sourceStatus.salary.previews)')),['新工资.xlsx','岗位.xlsx']);
 const old=a.run('JSON.stringify(currentBatch().data)');
 await a.importFiles([file('有效.xlsx',[['薪资',[['姓名','基本工资'],['甲',9999]]]]),file('坏表.xlsx',[['说明',[['没有姓名和数据']]]])],'salary','replace');
 assert.equal(a.run('JSON.stringify(currentBatch().data)'),old);assert.equal(a.run('employees[0].base'),3000);assert.match(a.run('importSession().summary'),/原有资料已保留/);
});
test('performance reads all matching sheets and defaults only the seven named employees, preserving zero and supplied values',async()=>{
 const a=app(),names=['李辉','刘浩','高玲','王刘超','董清华','赵红英','苏晓建','其他人'];
 await a.importFiles([file('花名册.xlsx',[['人员',[['姓名','工号','入职日期'],...names.map((n,i)=>[n,String(i+1),'2025-01-01'])]]])],'roster');
 await a.importFiles([file('工资.xlsx',[['工资',[['姓名','基本工资','绩效基数'],...names.map(n=>[n,1000,100])]]])],'salary');
 assert.deepEqual(Array.from(a.run('employees.map(e=>e.score)')),[1,1,1,1,1,1,1,0]);
 await a.importFiles([file('月度绩效.xlsx',[
 ['说明',[['填写说明']]],['人员说明',[['姓名','部门'],['李辉','研发']]],
 ['研发',[['姓名'],[],['姓名','绩效系数'],['李辉',0],['刘浩',0.8],['高玲',null]]],
 ['生产',[['姓名','绩效系数'],['王刘超','90%'],['董清华',''],['其他人',0.6]]],
 ['销售',[['姓名','绩效系数'],['赵红英',1.2]]]])],'performance');
 assert.equal(a.run('importSession().items.length'),0);
 assert.deepEqual(Array.from(a.run('employees.map(e=>e.score)')),[0,0.8,1,0.9,1,1.2,1,0.6]);
 assert.equal(a.run('sourceRows.performance.length'),7);assert.equal(a.run('employees[2].performancePay'),100);
 assert.equal(a.run('exportRecord(employees[2],true)["绩效分数"]'),1);
 assert.match(a.run('PayrollWorkbench.source(employees[2],"score").label'),/默认 1/);
 assert.equal(a.run('sourceRows.performance.find(r=>r.姓名==="李辉")._importSource.rowNumber'),4);
 await a.importFiles([file('新的系数.xlsx',[['全员',[['姓名','绩效系数'],['高玲',0.7]]]])],'performance','replace');
 assert.equal(a.run('sourceRows.performance.length'),1);assert.equal(a.run('employees[0].score'),1);assert.equal(a.run('employees[2].score'),0.7);
});
test('defaults appear in exported formula inputs and retain the late-hire precedence',async()=>{
 const a=app();await a.importFiles([file('花名册.xlsx',[['人员',[['姓名','工号','入职日期','是否入离职'],['李辉','1','2026-09-16','入职'],['刘浩','2','2025-01-01','在职']]]])],'roster');
 await a.importFiles([file('工资.xlsx',[['工资',[['姓名','基本工资','绩效基数'],['李辉',1000,100],['刘浩',1000,100]]]])],'salary');
 assert.equal(a.run('employees[0].score'),1);assert.equal(a.run('employees[0].effectiveScore'),0);
 const headers=a.run('exportHeaders(true)'),ws=a.run('detailSheet(true)'),column=XLSX.utils.encode_col(headers.indexOf('绩效分数'));
 assert.equal(ws[column+'3'].v,0);assert.equal(ws[column+'4'].v,1);assert.equal(a.run('employees[1].performancePay'),100);
});
test('preview retains all workbook sheets, escapes cells, is read-only, and survives saved batch restoration',async()=>{
 const a=app(),uploaded=file('绩效.xlsx',[['说明',[['<script>alert(1)</script>']]],['团队A',[['姓名','绩效系数'],['李辉',0.8]]],['团队B',[['姓名','绩效系数'],['刘浩',1]]]]);
 await a.importFiles([uploaded],'performance');
 const before=a.run('JSON.stringify(sourceRows.performance)');
 assert.deepEqual(Array.from(a.run('sourcePreviewFiles("performance")[0].sheets.map(s=>s.name)')),['说明','团队A','团队B']);
 const html=a.run('sourcePreviewTable(sourcePreviewFiles("performance")[0].sheets[0])');assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('<script>'));
 assert.equal(a.run('JSON.stringify(sourceRows.performance)'),before);
 a.run('saveBatchData();globalThis.saved=structuredClone(currentBatch());state.batches.push({...saved,name:"恢复批次",active:false});setCurrentBatch(state.batches[1]);');
 assert.equal(a.run('sourcePreviewFiles("performance")[0].sheets[2].grid[1][0]'),'刘浩');
 for(const stage of ['gross','net']){a.run(`state.payrollStage='${stage}';state.sourceStatus[stageSheets()[0].key]={uploaded:true}`);const html=a.run('PayrollWorkbenchPages.upload()');assert.match(html,/data-upload-mode="replace"/);assert.match(html,/data-source-preview=/);}
});
test('large previews explicitly cap display while import reads beyond the preview, and old batches have a truthful fallback',async()=>{
 const a=app(),grid=[['姓名','绩效系数'],...Array.from({length:250},(_,i)=>['员工'+i,0.8])];
 await a.importFiles([file('绩效.xlsx',[['全部',grid]])],'performance');assert.equal(a.run('sourceRows.performance.length'),250);
 assert.equal(a.run('sourcePreviewFiles("performance")[0].sheets[0].grid.length'),200);assert.equal(a.run('sourcePreviewFiles("performance")[0].sheets[0].rowCount'),251);
 assert.equal(a.run('sourcePreviewFiles("performance")[0].sheets[0].truncated'),true);
 a.run('delete state.sourceStatus.performance.previews;');assert.equal(a.run('sourcePreviewFiles("performance")[0].importedOnly'),true);
});
test('replacement works for second-stage deductions and same-file retries reset their input mode',async()=>{
 const a=app();a.run("state.payrollStage='net'");
 await a.importFiles([file('社保A.xlsx',[['社保',[['姓名','个人总计'],['甲',100]]]]),file('社保B.xlsx',[['社保',[['姓名','个人总计'],['乙',200]]]])],'netSocial');
 const bytes=file('新社保.xlsx',[['社保',[['姓名','个人总计'],['甲',300]]]]);
 a.run('globalThis.input={files:[],value:"old-path",dataset:{sourceInput:"netSocial",importMode:"replace"}}');
 const input=a.run('input');input.files=[bytes];await a.run('handleSourceInput')(input);
 assert.equal(input.value,'');assert.equal(input.dataset.importMode,'append');assert.equal(a.run('sourceRows.netSocial.length'),1);assert.equal(a.run('sourceRows.netSocial[0].个人总计'),300);
});

test('delete clears a complete module and previews, recalculates and persists without affecting other sources',async()=>{
 const a=app();await a.importFiles([file('花名册.xlsx',[['人员',roster('甲','001')]])],'roster');
 await a.importFiles([file('基本工资.xlsx',[['工资',[['姓名','基本工资'],['甲',1000]]]])],'salary');
 await a.importFiles([file('其他加A.xlsx',[['其他加',[['姓名','其他加'],['甲',100]]]]),file('其他加B.xlsx',[['其他加',[['姓名','其他加'],['甲',200]]]])],'other');
 assert.equal(a.run('employees[0].gross'),1300);a.run('state.calculated=true');
 assert.equal(a.run('removeSource("other")'),true);
 assert.equal(a.run('employees[0].gross'),1000);assert.equal(a.run('sourceRows.other'),undefined);assert.equal(a.run('state.sourceStatus.other'),undefined);
 assert.equal(a.run('sourceRows.salary.length'),1);assert.equal(a.run('state.calculated'),false);
 assert.equal(a.run('currentBatch().data.sourceRows.other'),undefined);assert.equal(a.run('currentBatch().sources'),2);
 assert.doesNotMatch(a.run('PayrollWorkbenchPages.upload()'),/data-source-delete="other"/);
 assert.match(a.run('PayrollWorkbenchPages.upload()'),/data-source-delete="salary"/);
});
test('delete uploaded gross restores generated result; roster deletion clears employee scope and intern rates',async()=>{
 const a=app();await a.importFiles([file('花名册.xlsx',[['人员',roster('甲','001')]])],'roster');
 await a.importFiles([file('基本工资.xlsx',[['工资',[['姓名','基本工资'],['甲',1000]]]])],'salary');
 a.run('state.payrollStage="net"');await a.importFiles([file('应发工资.xlsx',[['应发',[['姓名','应发工资'],['甲',2000]]]])],'grossUpload');
 assert.equal(a.run('employees[0].gross'),2000);assert.equal(a.run('removeSource("grossUpload")'),true);
 assert.equal(a.run('employees[0].gross'),1000);assert.equal(a.run('state.grossSource'),'generated');
 assert.equal(a.run('removeSource("salary")'),false);
 a.run('state.payrollStage="gross";internDailyRates().甲=120');assert.equal(a.run('removeSource("roster")'),true);
 assert.equal(a.run('employees.length'),0);assert.equal(a.run('Object.keys(internDailyRates()).length'),0);
});
test('delete is blocked while an import is running',async()=>{
 const a=app();await a.importFiles([file('基本工资.xlsx',[['工资',[['姓名','基本工资'],['甲',1000]]]])],'salary');
 a.run('importSession().busy=true');assert.equal(a.run('removeSource("salary")'),false);assert.equal(a.run('sourceRows.salary.length'),1);
});
