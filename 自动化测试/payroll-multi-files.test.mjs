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
 for(const file of ['workbench-core.js','workbench-pages.js','workbench-ui.js'])run(fs.readFileSync(new URL(file,base),'utf8'));
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
