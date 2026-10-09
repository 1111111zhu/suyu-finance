import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function middleware(){
 const code=fs.readFileSync(new URL('../middleware.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 let accessCalls=0;
 const context={exports:{},requireAccess:async()=>{accessCalls++;return {role:'manager'}},routeCapability:()=> 'payroll',canonicalPath:p=>p,NextResponse:{next:()=>new Response(null),redirect:url=>Response.redirect(url)},Response,URL};
 vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
 return {handle:context.exports.middleware,count:()=>accessCalls};
}
test('authorized salary HTML and scripts cannot reuse a stale browser response',async()=>{
 const app=middleware();
 for(const path of ['/salary/index.html','/salary/payroll-engine.js','/salary/workbench-core.js']){
  const response=await app.handle({url:'https://finance.example'+path,method:'GET'});
  assert.equal(response.headers.get('Cache-Control'),'private, no-store, max-age=0');
 }
 assert.equal(app.count(),3,'cache handling must preserve access checks');
 for(const path of ['/salary/assets/font.woff2','/salary/workbench.css','/salary-directory'])assert.equal((await app.handle({url:'https://finance.example'+path,method:'GET'})).headers.get('Cache-Control'),null);
});
