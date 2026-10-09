import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import XLSX from 'xlsx';
const root=new URL('../public/salary/',import.meta.url);
function app(library=XLSX){
 const element={addEventListener(){},classList:{add(){},remove(){},toggle(){}},textContent:''};
 const c=vm.createContext({TextDecoder,structuredClone,document:{getElementById:()=>({...element}),querySelectorAll:()=>[],addEventListener(){}},window:{XLSX:library},setTimeout:()=>0,clearTimeout(){}});
 vm.runInContext(fs.readFileSync(new URL('payroll-engine.js',root),'utf8'),c);
 const html=fs.readFileSync(new URL('index.html',root),'utf8');vm.runInContext(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace("    render('overview');\n  ",''),c);
 vm.runInContext('render=()=>{};showToast=()=>{};',c);return {E:c.PayrollEngine,run:code=>vm.runInContext(code,c)};
}
test('workbook, binary, macro, legacy, template, XML and CSV uploads preserve Chinese names and amounts',async()=>{
 const {E,run}=app();const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['姓名','其他加（元）'],['甲',1250.5]]),'其他加');
 for(const [ext,bookType] of [['xlsx','xlsx'],['xls','biff8'],['xlsm','xlsm'],['xlsb','xlsb'],['xlt','biff8'],['xltx','xlsx'],['xltm','xlsm'],['xla','biff8'],['xlam','xlsm'],['xml','xlml']]){
  assert.equal(E.isSpreadsheetFile('加项.'+ext),true);const bytes=XLSX.write(w,{type:'array',bookType});const rows=await run('parseXlsxFile')({name:'加项.'+ext,arrayBuffer:async()=>bytes});
  assert.equal(rows[0].姓名,'甲',ext);assert.equal(rows[0].其他加,1250.5,ext);
 }
 const bytes=new TextEncoder().encode('姓名,其他加（元）\n甲,1250.5\n');const rows=await run('parseXlsxFile')({name:'加项.csv',arrayBuffer:async()=>bytes});assert.equal(rows[0].姓名,'甲');assert.equal(rows[0].其他加,1250.5);
 assert.equal(E.isSpreadsheetFile('file.exe'),false);
});
test('roster skips annual ledger and all other sheets before attempting to parse them',async()=>{
 const book=XLSX.utils.book_new();
 for(const name of ['年假台账','使用说明','2026在职员工','离职员工'])XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['姓名','工号','入职日期','离职日期'],[name==='离职员工'?'乙':'甲','001','2025-01-01',name==='离职员工'?'2026-09-20':'']]),name);
 const seen=[];const library={...XLSX,read:()=>book,utils:{...XLSX.utils,sheet_to_json(sheet,options){const name=book.SheetNames.find(n=>book.Sheets[n]===sheet);seen.push(name);if(!/在职|离职/.test(name))throw new Error('不得读取其他子表');return XLSX.utils.sheet_to_json(sheet,options);}}};
 const {E,run}=app(library);const rows=await run('parseXlsxFile')({name:'花名册.xlsx',arrayBuffer:async()=>new ArrayBuffer(0)});
 assert.deepEqual(seen,['2026在职员工','离职员工']);assert.equal(rows.length,2);assert.equal(E.rosterRowInMonth(rows[1],'2026-09'),true);assert.equal(E.rosterRowInMonth(rows[1],'2026-10'),false);
 assert.equal(E.rosterRowInMonth({姓名:'假名',工号:'009',_rosterSource:{sheetName:'年假台账'}},'2026-09'),false);
});
test('roster without active/departed tabs cannot fall back to annual ledger',async()=>{
 const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['姓名','工号'],['甲','001']]),'年假台账');const bytes=XLSX.write(w,{type:'array',bookType:'xlsx'});
 await assert.rejects(()=>app().run('parseXlsxFile')({name:'花名册.xlsx',arrayBuffer:async()=>bytes}),/在职或离职/);
});
test('provided roster contains only current-month staff from active/departed tabs',{skip:!process.env.ROSTER_TEST_FILE},async()=>{
 const {E,run}=app();const bytes=fs.readFileSync(process.env.ROSTER_TEST_FILE);const rows=await run('parseXlsxFile')({name:'花名册.xlsx',arrayBuffer:async()=>bytes});
 assert.ok(rows.every(row=>E.isRosterSheet(row._rosterSource.sheetName)));
 assert.equal(rows.filter(row=>E.rosterRowInMonth(row,'2026-09')&&E.rosterIdentityIssues(row).length===0).length,84);
});
