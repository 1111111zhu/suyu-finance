import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import XLSX from 'xlsx';
const root=new URL('../public/salary/',import.meta.url);
function app(){
 const element={addEventListener(){},classList:{add(){},remove(){},toggle(){}},textContent:''};
 const c=vm.createContext({structuredClone,document:{getElementById:()=>({...element}),querySelectorAll:()=>[],addEventListener(){}},window:{XLSX},setTimeout:()=>0,clearTimeout(){}});
 vm.runInContext(fs.readFileSync(new URL('payroll-engine.js',root),'utf8'),c);
 const html=fs.readFileSync(new URL('index.html',root),'utf8');vm.runInContext(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace("    render('overview');\n  ",''),c);
 vm.runInContext('render=()=>{};showToast=()=>{};',c);return {E:c.PayrollEngine,run:code=>vm.runInContext(code,c)};
}
test('other addition matches filename, worksheet name, or any containing header',()=>{
 const {E,run}=app();
 for(const [filename,sheet,header] of [['9月其他加明细.xlsx','Sheet1','金额（元）'],['导出.xlsx','其他加补发','金额'],['明细.xlsx','Sheet1','本月其他加（元）']]){
  const rows=E.otherAdditionRowsFromGrid([['公司'],['姓名',header],['甲','￥1,250.50']],filename,sheet);assert.equal(rows[0].其他加,1250.5);rows.sheetName=sheet;
  assert.equal(run(`matchSource(${JSON.stringify(filename)},${JSON.stringify(rows)}).key`),'other');
 }
 assert.equal(run("matchSource('个税其他加.xlsx',[{姓名:'甲',金额:100}]).key"),'other');
 assert.equal(run("matchSource('表.xlsx',Object.assign([{姓名:'甲',金额:100}],{sheetName:'其他加'})).key"),'other');
});
test('addition field takes precedence over other totals and preserves reductions',()=>{
 const {E}=app();const rows=E.otherAdditionRowsFromGrid([['姓名','其他加','其他减','金额'],['甲',300,20,999]],'其他加.xlsx','Sheet1');
 assert.equal(rows[0].其他加,300);assert.equal(rows[0].其他减,20);
 assert.equal(E.otherAdditionRowsFromGrid([['姓名','金额'],['甲',300]],'补发.xlsx','Sheet1'),null);
 assert.throws(()=>E.otherAdditionRowsFromGrid([['姓名','其他加金额','其他加补贴'],['甲',10,20]],'表.xlsx','Sheet1'),/唯一/);
 assert.throws(()=>E.otherAdditionRowsFromGrid([['姓名','金额'],['甲','坏金额']],'其他加.xlsx','Sheet1'),/无效/);
});
test('worksheet named other addition is read beyond the first worksheet',async()=>{
 const {run}=app();const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['说明']]),'说明');
 XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['姓名','金额'],['甲',300],['乙',500]]),'9月其他加');
 const bytes=XLSX.write(w,{type:'array',bookType:'xlsx'});const rows=await run('parseXlsxFile')({name:'补发.xlsx',arrayBuffer:async()=>bytes});assert.equal(rows[1].其他加,500);assert.equal(rows.sheetName,'9月其他加');
 run("currentMonth='2026-09';sourceRows={roster:[{姓名:'甲',工号:'001',入职日期:'2025-01-01'}],salary:[{姓名:'甲',基本工资:10000}],attendance:[{姓名:'甲',实际出勤天数:22}]};state.liveImport=true;state.sourceStatus={roster:{uploaded:true}};recalculateEmployees();");
 const original=run('employees[0].gross');run(`commitSource('other',{filename:'补发.xlsx',rows:${JSON.stringify(rows)}})`);
 assert.equal(run('employees[0].otherAdd'),300);assert.equal(run('employees[0].gross'),original+300);
});
