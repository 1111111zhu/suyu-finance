import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source=await readFile(new URL('../app/projects/hierarchy.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {buildProjectHierarchy,hierarchyTotals}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));

test('explicit relationships keep platform projects independent and retain nested children',()=>{
 const rows=buildProjectHierarchy([
  {number:'RD12501-02',parentNumber:null,actual:1},
  {number:'RD12501',parentNumber:null,actual:2},
  {number:'RD141031-10',parentNumber:'RD141031',actual:3},
  {number:'RD141031-2-1',parentNumber:'RD141031-2',actual:4},
  {number:'RD141031-2',parentNumber:'RD141031',actual:5},
  {number:'RD141031',parentNumber:null,actual:6},
 ]);
 assert.equal(rows.length,6);
 assert.equal(rows.find(r=>r.project.number==='RD12501-02').level,0);
 assert.equal(rows.find(r=>r.project.number==='RD141031-2-1').level,2);
 assert.deepEqual(rows.filter(r=>r.parentCode==='RD141031').map(r=>r.project.number),['RD141031-2','RD141031-10']);
 const totals=hierarchyTotals(rows);
 assert.equal(totals.get('RD141031'),18);
 assert.equal(totals.get('RD141031-2'),9);
 assert.equal(rows.filter(r=>!r.parentCode).reduce((s,r)=>s+totals.get(r.project.number),0),21);
});

test('missing or cross-platform parent remains visible; cyclic metadata loses no records',()=>{
 const rows=buildProjectHierarchy([{number:'RD141031-5',parentNumber:'RD141031',actual:0}]);
 assert.equal(rows[0].parentCode,null);
 const cycle=buildProjectHierarchy([{number:'A',parentNumber:'B'},{number:'B',parentNumber:'A'}]);
 assert.equal(cycle.length,2);
 assert.equal(new Set(cycle.map(r=>r.project.number)).size,2);
});

test('own costs, negative corrections and material detail do not inflate totals',()=>{
 const rows=buildProjectHierarchy([
  {number:'A',parentNumber:null,actual:0.1,materials:[{number:'1'},{number:'2'},{number:'3'}]},
  {number:'B',parentNumber:'A',actual:0.2},
  {number:'C',parentNumber:'A',actual:-0.05},
 ]);
 assert.equal(hierarchyTotals(rows).get('A'),0.25);
});
