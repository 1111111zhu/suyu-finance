import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import XLSX from 'xlsx';
const base=new URL('../public/salary/',import.meta.url);
function parser(library=XLSX){
 const element={addEventListener(){},classList:{add(){},remove(){},toggle(){}}};
 const c=vm.createContext({TextDecoder,structuredClone,document:{getElementById:()=>({...element}),querySelectorAll:()=>[],addEventListener(){}},window:{XLSX:library},setTimeout:()=>0,clearTimeout(){},__PAYROLL_TEST__:true});
 for(const file of ['payroll-engine.js','payroll-email-engine.js'])vm.runInContext(fs.readFileSync(new URL(file,base),'utf8'),c);
 vm.runInContext(fs.readFileSync(new URL('index.html',base),'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1],c);
 return {parse:vm.runInContext('parseXlsxFile',c),E:c.PayrollEngine};
}
test('empty Excel tails are excluded without losing original coordinates, late data or preview dimensions',async()=>{
 const sheet=XLSX.utils.aoa_to_sheet([['说明'],[],['','姓名','基本工资'],['','甲',8000]],{origin:'A1'});
 sheet.B101={t:'s',v:'乙'};sheet.C101={t:'n',v:9000};sheet['!ref']='A1:XFD1048576';
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'工资');
 const bytes=new ArrayBuffer(0);
 // Check the range contract directly, avoiding a fragile elapsed-time assertion.
 const original=XLSX.utils.sheet_to_json;const ranges=[];
 XLSX.utils.sheet_to_json=(sheet,options)=>{ranges.push(options.range);return original(sheet,options)};
 try {
 const rows=await parser({...XLSX,read:()=>book}).parse({name:'工资.xlsx',arrayBuffer:async()=>bytes},'salary');
 assert.deepEqual(Array.from(rows,row=>[row.姓名,row.基本工资,row._importSource.rowNumber]),[['甲',8000,4],['乙',9000,101]]);
 assert.equal(ranges[0].e.r,100);assert.equal(ranges[0].e.c,2);
 assert.equal(rows.importItems[0].preview.sheets[0].rowCount,1048576);
 assert.equal(rows.importItems[0].preview.sheets[0].columnCount,16384);
 } finally {XLSX.utils.sheet_to_json=original;}
});
test('header cache preserves aliases, unit suffixes and unknown headers across eviction',()=>{
 const {E}=parser();for(let i=0;i<4200;i++)assert.equal(E.canonicalHeader('自定义'+i),'自定义'+i);
 for(const [input,output] of [['员工姓名','姓名'],['基本工资（元）','基本工资'],['绩效系数','绩效分数'],['实际出勤','实际出勤天数'],['未定义字段','未定义字段']])assert.equal(E.canonicalHeader(input),output);
});
