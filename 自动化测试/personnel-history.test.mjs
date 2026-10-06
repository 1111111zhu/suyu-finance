import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFileSync} from 'node:fs';
const code=ts.transpileModule(readFileSync(new URL('../app/salary-directory/payroll-history.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {expenseHistory,personHistory}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const person=(gross)=>({name:'甲',employeeNumber:'1',company:'公司',dept:'研发部',gross,net:gross,cost:gross});
const batch=(month,gross,updatedAt='1')=>({id:month+updatedAt,name:'工资',month,draftOrigin:'empty',personnelAnalysis:{updatedAt,people:[person(gross)]}});
test('monthly results exclude demos and preserve missing amounts',()=>{
 const rows=expenseHistory([batch('2026-08',100),batch('2026-09',200),{...batch('2026-10',300),draftOrigin:'demo'},batch('2026-07',null)]);
 assert.equal(rows.length,3);assert.equal(rows[0].month,'2026-09');assert.equal(rows[2].people[0].gross,null);
 const points=personHistory(person(200),rows);assert.deepEqual(points.map(p=>p.gross),[null,100,200]);
});
test('a draft roster displays people without fabricating salary; latest duplicate month wins',()=>{
 const rows=expenseHistory([{id:'draft',name:'草稿',month:'2026-08',data:{sourceRows:{roster:[{姓名:'甲',工号:'1',公司:'公司'}]}}}]);
 assert.equal(rows[0].people[0].gross,null);
 const history=expenseHistory([batch('2026-08',100,'1'),batch('2026-08',120,'2')]);
 assert.equal(personHistory(person(0),history)[0].gross,120);
});
test('inclusive ranges add latest monthly values once and mark missing months',async()=>{
 const {rangeExpenses,rangeTrend,monthsInRange}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const history=expenseHistory([batch('2026-08',100,'1'),batch('2026-08',120,'2'),batch('2026-09',200)]);
 const rows=rangeExpenses(history,'2026-08','2026-10');assert.equal(rows[0].gross,320);assert.equal(rows[0].missing.gross,1);
 assert.deepEqual(rangeTrend(person(0),history,'2026-08','2026-10').map(p=>p.gross),[120,200,null]);
 assert.deepEqual(monthsInRange('2025-12','2026-02'),['2025-12','2026-01','2026-02']);
 assert.deepEqual(monthsInRange('2026-10','2026-09'),[]);
});
