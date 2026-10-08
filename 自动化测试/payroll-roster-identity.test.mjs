import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import XLSX from 'xlsx';
const c=vm.createContext({Date});vm.runInContext(fs.readFileSync(new URL('../public/salary/payroll-engine.js',import.meta.url),'utf8'),c);
const check=row=>JSON.parse(JSON.stringify(vm.runInContext(`PayrollEngine.rosterIdentityIssues(${JSON.stringify(row)})`,c)));
test('payroll requires both name and usable employee number',()=>{
 for(const id of [127,0,'001','SX18']) assert.deepEqual(check({姓名:'测试',工号:id}),[]);
 assert.deepEqual(check({姓名:'测试'}),['缺少工号']);
 assert.deepEqual(check({工号:127}),['缺少姓名']);
 assert.deepEqual(check({姓名:'测试',工号:-1}),['工号无效']);
});
test('source roster named employees all have valid employee numbers',{skip:!process.env.ROSTER_TEST_FILE},()=>{
 const w=XLSX.readFile(process.env.ROSTER_TEST_FILE,{cellDates:true});let count=0;
 for(const name of w.SheetNames) {
  const grid=XLSX.utils.sheet_to_json(w.Sheets[name],{header:1,defval:null});
  const rows=JSON.parse(JSON.stringify(vm.runInContext(`PayrollEngine.rowsFromGrid(${JSON.stringify(grid)})`,c)));
  for(const row of rows) {row._rosterSource={departedSheet:/离职/.test(name)};if(!vm.runInContext(`PayrollEngine.rosterRowInMonth(${JSON.stringify(row)},'2026-09')`,c)) continue;assert.deepEqual(check(row),[],JSON.stringify(row));count++;}
 }
 assert.equal(count,84);
});
