import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const compile=p=>ts.transpileModule(readFileSync(new URL(p,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const roster='data:text/javascript;base64,'+Buffer.from(compile('../app/salary-directory/roster-model.ts')).toString('base64');
const source=compile('../app/salary-directory/analysis-model.ts').replace("'./roster-model'",JSON.stringify(roster));
const {parseCosts,matchCost,personnelTags}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('incomplete company contributions never become zero cost, and matching prioritizes employee ID',()=>{
 const rows=parseCosts([['姓名','工号','应发工资','公司社保','公司公积金'],['甲','1',1000,100,50],['乙','2',2000,'',50]]);
 assert.equal(rows[0].cost,1150);assert.equal(rows[1].cost,null);
 assert.equal(matchCost({values:{name:'改名',employeeNumber:'1'}},rows).cost,1150);
 assert.equal(matchCost({values:{name:'甲',employeeNumber:'3'}},rows),undefined);
 assert.throws(()=>parseCosts([['姓名','应发工资'],['甲',100],['甲',200]]));
});
test('events are restricted to payroll month; internship stays a separate tag',()=>{
 const p={values:{status:'在职',join:'2026-08-10',regularizationDate:'2026-09-15',isIntern:false},raw:{}};
 assert.deepEqual(personnelTags(p,'2026-09'),['转正']);
 assert.deepEqual(personnelTags(p,'2026-10'),['正职']);
 assert.deepEqual(personnelTags({values:{join:'2026-09-10',isIntern:true},raw:{}},'2026-09'),['入职','实习生']);
 assert.deepEqual(personnelTags({values:{status:'离职',leave:'2026-08-10'},raw:{}},'2026-09'),['历史离职']);
});
