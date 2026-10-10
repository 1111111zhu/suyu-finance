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

const numericSources={基本工资:8123.4567,岗位工资:1123.4567,绩效基数:723.4567,绩效分数:0.87654,实际出勤天数:19.375,餐饮津贴:223.4567,交通津贴:123.4567,其他津贴:43.4567,其他加:33.4567,年假天数:1.375,弹性假天数:0.375,调休假天数:2.375,病假天数:0.625,事假天数:0.875,旷工天数:0.125,其他减:23.4567};
const person=['甲','TEST-A','测试公司','测试部门','测试组','TEST-BANK-A','测试银行','2025-01-02','工程师'];
async function sources(a){
 await a.importFiles([file('花名册.xlsx',[['人员',[['姓名','工号','公司','一级部门','二级部门','银行卡号','开户行','入职日期','职位'],person,['乙','TEST-B','测试公司','测试部门','测试组','TEST-BANK-B','测试银行','2025-01-03','实习生']]]])],'roster');
 await a.importFiles([file('基本工资.xlsx',[['薪资',[['姓名','基本工资（元）','岗位工资（元）','绩效基数（元）'],...['甲','乙'].map(n=>[n,8123.4567,1123.4567,723.4567])]]])],'salary');
 await a.importFiles([file('绩效.xlsx',[['绩效',[['员工姓名','绩效分数'],['甲',0.87654],['乙',0.87654]]]])],'performance');
 await a.importFiles([file('考勤A.xlsx',[['考勤',[['姓名','实际出勤','餐饮津贴','交通津贴','年假','弹性假','调休假','病假','事假','旷工'],['甲',19.375,223.4567,123.4567,1.375,0.375,2.375,0.625,0.875,0.125]]]]),file('考勤B.xlsx',[['考勤',[['姓名','出勤天数','餐补','交通补贴合计','年假（天）','弹性假（天）','调休（天）','病假（天）','事假（天）','旷工（天）'],['乙',19.375,223.4567,123.4567,1.375,0.375,2.375,0.625,0.875,0.125]]]])],'attendance');
 await a.importFiles([file('其他.xlsx',[['其他',[['姓名','其他津贴','其他加','其他减'],['甲',43.4567,33.4567,23.4567],['乙',43.4567,33.4567,23.4567]]]])],'other');
 assert.equal(a.run('importSession().items.length'),0);
}
function exported(a,gross=true){const sheet=a.run(`detailSheet(${gross})`),book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'工资');const restored=XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'}).Sheets['工资'];return {sheet:restored,headers:a.run(`exportHeaders(${gross})`)};}
function cell(output,label,row){return output.sheet[XLSX.utils.encode_col(output.headers.indexOf(label))+row];}
test('every numeric source field matches input across ordinary and intern exports, including leave and source precision',async()=>{
 const a=app();await sources(a);const out=exported(a);
 for(const row of [3,4]){
   for(const [label,expected] of Object.entries(numericSources)){assert.equal(cell(out,label,row)?.v,expected,label+' employee row '+row);assert.equal(cell(out,label,row)?.f,undefined,label+' must remain an input');}
   for(const [label,value] of [['公司','测试公司'],['一级部门','测试部门'],['二级部门','测试组'],['开户行','测试银行']])assert.equal(cell(out,label,row)?.v,value);
 }
 assert.ok(cell(out,'绩效工资',3).f);assert.ok(cell(out,'应发工资',4).f);
 assert.equal(a.run(`generatedEmployees.find(e=>e.name==='乙').gross`),8123.46,'intern allowances/leave are exported but payroll policy still uses the fixed salary');
});
test('blank input fields remain blank, never silently zeroed; deduction formulas still export',async()=>{
 const a=app();await a.importFiles([file('花名册.xlsx',[['人员',[['姓名','工号','公司','二级部门','入职日期'],['甲','TEST-A','测试公司',null,'2025-01-02']]]])],'roster');
 await a.importFiles([file('工资.xlsx',[['工资',[['姓名','基本工资','岗位工资'],['甲',9000,null]]]])],'salary');
 await a.importFiles([file('考勤.xlsx',[['考勤',[['姓名','实际出勤天数','调休假','病假','餐饮津贴'],['甲',22,null,null,null]]]])],'attendance');
 const out=exported(a);for(const label of ['二级部门','岗位工资','调休假天数','病假天数','餐饮津贴'])assert.equal(cell(out,label,3)?.v,undefined,label);
 assert.ok(cell(out,'假勤扣款',3).f);
});
test('restored legacy rows use shared aliases without needing reupload; sick allowance is not mistaken for days',()=>{
 const a=app();a.run(`sourceRows={roster:[{姓名:'甲',工号:'TEST-A',入职日期:'2025-01-02'}],salary:[{姓名:'甲',基本工资:9000}],attendance:[{姓名:'甲',实际出勤:20,调休:1.25,病假:0.5,年假:1,弹性假:2,事假:0.75,旷工:0.25,餐饮津贴:500,交通津贴:100}]};recalculateEmployees();`);
 assert.equal(a.run('employees[0].compensatory'),1.25);assert.equal(a.run('employees[0].sick'),0.5);assert.equal(a.run('employees[0].meal'),500);assert.equal(a.run('employees[0].transit'),100);
 const normalized=a.run(`normalizeSourceFields([{姓名:'甲',病假补贴:88}],'attendance','考勤.xlsx','考勤')`);assert.equal(normalized[0].病假天数,undefined);
});
test('gross source identification takes priority over other-add and deductions; attendance workdays stay attendance',()=>{
 const a=app();a.run(`state.payrollStage='net'`);
 for(const [name,headers,sheetName] of [['九月应发.xlsx',['其他加','应发'], '工资'],['报表.xlsx',['应发总额（元）','其他加'],'工资'],['报表.xlsx',['金额'],'应发表'],['自制应发.xlsx',['应发薪','金额'],'工资']]){
 const rows=[Object.fromEntries(['姓名',...headers].map((h,i)=>[h,i?100:'甲']))];rows.sheetName=sheetName;
 assert.equal(a.run(`matchSource(${JSON.stringify(name)},Object.assign(${JSON.stringify(rows)},{sheetName:${JSON.stringify(sheetName)}})).key`),'grossUpload');
 }
 assert.equal(a.run(`matchSource('考勤.xlsx',[{姓名:'甲',应发薪:22,实际出勤天数:22}]).key`),'attendance');
 assert.equal(a.run(`matchSource('应发薪天数.xlsx',[{姓名:'甲',实际出勤天数:22}]).key`),'attendance');
});
for(const [title,filename,sheetName,header] of [['filename','九月应发.xlsx','工资','金额'],['worksheet','自制报表.xlsx','九月应发','数值'],['header','自制报表.xlsx','工资','应发'],['extended header','自制报表.xlsx','工资','本月应发总额（元）']])test(title+' identifies uploaded gross and its values override generated conflicts',async()=>{
 const a=app();await sources(a);a.run(`state.payrollStage='net';recalculateEmployees();`);
 const uploaded=file(filename,[[sheetName,[['姓名','公司','一级部门','入职日期','离职日期',header,'调休假','病假','其他加'],['甲','上传公司','上传部门','2024-03-04','2026-09-25',9654.123,7.25,2.5,400],['丙','上传公司','上传部门','2025-03-04',null,4000,1,0,100]]]]);
 await a.importFiles([uploaded]);assert.equal(a.run('importSession().items.length'),0);assert.equal(a.run('state.grossSource'),'uploaded');assert.equal(a.run('state.comparison.status'),'different');
 a.run(`sourceRows.netSocial=[{姓名:'甲',个人总计:500,公司总计:1000}];sourceRows.netFund=[{姓名:'甲',个人缴纳:300,公司缴纳:300}];sourceRows.tax=[{姓名:'甲',税:200}];sourceRows.afterTax=[{姓名:'甲',其它代扣:100}];recalculateEmployees();`);
 const employee=a.run(`employees.find(e=>e.name==='甲')`);assert.equal(employee.gross,9654.123);assert.equal(employee.net,8554.12);assert.equal(employee.company,'上传公司');assert.equal(employee.compensatory,7.25);assert.equal(employee.sick,2.5);
 assert.deepEqual(Array.from(a.run('employees.map(e=>e.name)')),['甲','丙'],'uploaded employee scope is authoritative');
 const out=exported(a,false);for(const [label,value] of [['公司','上传公司'],['一级部门','上传部门'],['入职日期','2024-03-04'],['离职日期','2026-09-25'],['应发工资',9654.123],['调休假天数',7.25],['病假天数',2.5]])assert.equal(cell(out,label,3)?.v,value,label);
 assert.equal(cell(out,'应发工资',3).f,undefined);assert.ok(cell(out,'实发工资',3).f);assert.match(a.run('renderComparison()'),/以上传应发表为准/);
});
test('a complete gross export containing other-add is automatically recognized on upload',async()=>{
 const a=app();await sources(a);const ws=a.run('detailSheet(true)'),book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,ws,'应发工资表');const bytes=XLSX.write(book,{type:'array',bookType:'xlsx'});
 a.run(`state.payrollStage='net';recalculateEmployees();`);await a.importFiles([{name:'九月应发.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes}]);
 assert.equal(a.run('importSession().items.length'),0);assert.equal(a.run('state.grossSource'),'uploaded');assert.equal(a.run('sourceRows.grossUpload.length'),2);assert.equal(a.run('employees[0].compensatory'),2.375);assert.equal(a.run('employees[0].sick'),0.625);
});

test('net contribution sources still override legacy contribution columns in the uploaded gross workbook',()=>{
 const a=app();a.run(`sourceRows={grossUpload:[{姓名:'甲',应发:9000,个人社保:999,个人公积金:999}],netSocial:[{姓名:'甲',个人总计:500}],netFund:[{姓名:'甲',个人缴纳:300}]};state.payrollStage='net';recalculateEmployees();`);
 const out=exported(a,false);assert.equal(cell(out,'应发工资',3).v,9000);assert.equal(cell(out,'个人社保',3).v,500);assert.equal(cell(out,'个人公积金',3).v,300);assert.equal(cell(out,'实发工资',3).v,8200);
});
test('non-numeric source markers stay visible without producing Excel VALUE errors in derived wages',()=>{
 const a=app();a.run(`sourceRows={roster:[{姓名:'甲',工号:'TEST-A',入职日期:'2025-01-02'}],salary:[{姓名:'甲',基本工资:9000,绩效基数:'—'}],performance:[{姓名:'甲',绩效系数:'—'}],attendance:[{姓名:'甲',实际出勤天数:22,病假:'—'}],other:[{姓名:'甲',其他减:'—'}]};recalculateEmployees();`);
 const out=exported(a);assert.equal(cell(out,'绩效基数',3).v,'—');assert.equal(cell(out,'病假天数',3).v,'—');assert.match(cell(out,'绩效工资',3).f,/N\(/);assert.match(cell(out,'病假补贴',3).f,/N\(/);assert.match(cell(out,'应发工资',3).f,/N\(/);
});
const attendanceFixture=process.env.PAYROLL_ATTENDANCE_FIXTURE;
test('provided attendance summary imports paired day columns',{skip:!attendanceFixture},()=>{
 const a=app(),book=XLSX.read(fs.readFileSync(attendanceFixture));
 const grid=XLSX.utils.sheet_to_json(book.Sheets['2026年8月考勤表'],{header:1,defval:null});
 a.run(`globalThis.summaryGrid=${JSON.stringify(grid)};globalThis.summaryRows=normalizeSourceFields(PayrollEngine.rowsFromGrid(summaryGrid),'attendance','考勤.xlsx','2026年8月考勤表').filter(r=>r.姓名);`);
 assert.equal(a.run('summaryRows.length'),grid.slice(1).filter(r=>r[1] && !/^(合计|总计|汇总)$/.test(r[1])).length);
 for(const [field,column] of [['年假天数',26],['调休假天数',24],['弹性假天数',28],['病假天数',30],['事假天数',22]]) {
  const actual=JSON.parse(a.run(`JSON.stringify(summaryRows.map(r=>r[${JSON.stringify(field)}]))`));
  const expected=grid.slice(1).filter(r=>r[1] && !/^(合计|总计|汇总)$/.test(r[1])).map(r=>r[column]??null);
  assert.deepEqual(actual,expected,field);
 }
});
test('all leave categories use day columns and never count paired hours',async()=>{
 const a=app();
 const categories=['年假','调休','弹性假','产检假','产假','陪产假','婚假','丧假','哺乳假','病假','事假','旷工'];
 const headers=['姓名',...categories.flatMap(c=>[c+'（H）',c+'（天）'])];
 const values=['甲',...categories.flatMap(()=>[80,0.5])];
 const rows=await a.parse(file('考勤.xlsx',[['考勤',[headers,values]]]),'attendance');
 a.run(`globalThis.dayRows=${JSON.stringify(rows)};`);
 for(const category of categories) assert.equal(a.run(`PayrollEngine.paidLeaveFromRow(dayRows[0]).breakdown[${JSON.stringify(category)}]`),0.5,category);
 assert.equal(a.run('PayrollEngine.paidLeaveFromRow(dayRows[0]).days'),4.5);
 assert.equal(a.run(`PayrollEngine.paidLeaveFromRow({'年假(H)':80,'年假(天)':null,备注:'年假8小时'}).breakdown.年假`),0);
 assert.equal(a.run(`PayrollEngine.paidLeaveFromRow({'年假(H)':80,备注:'年假8小时'}).breakdown.年假`),0);
 assert.equal(a.run(`PayrollEngine.paidLeaveFromRow({备注:'年假0.5天，0.25天，8小时'}).breakdown.年假`),0.75);
});
test('provided local attendance workbook agrees with every source-backed exported field',{skip:!attendanceFixture},async()=>{
 const a=app(), bytes=fs.readFileSync(attendanceFixture),rows=await a.parse({name:'考勤.xlsx',arrayBuffer:async()=>bytes},'attendance');
 const names=[...new Set(rows.map(row=>row.姓名))].filter(Boolean);
 a.run(`sourceRows={roster:${JSON.stringify(names.map((姓名,i)=>({姓名,工号:'FIXTURE-'+i,入职日期:'2025-01-02'})))},attendance:${JSON.stringify(rows)}};recalculateEmployees();`);
 const out=exported(a);
 for(const row of rows){const r=3+Array.from(a.run('employees.map(e=>e.name)')).indexOf(row.姓名);for(const field of ['餐饮津贴','交通津贴','年假天数','弹性假天数','调休假天数','病假天数','事假天数','旷工天数']){
   const header=Object.keys(row).find(h=>a.run(`PayrollEngine.canonicalHeader(${JSON.stringify(h)})`)===field);if(header===undefined)continue;
   const sourceValue=row[header], parsed=a.run(`PayrollEngine.numeric(${JSON.stringify(sourceValue)})`);
   const expected=sourceValue===null||sourceValue===''?undefined:Number.isFinite(parsed)?parsed:sourceValue;
   assert.equal(cell(out,field,r)?.v,expected,field+' source row '+r);
 }}
});
