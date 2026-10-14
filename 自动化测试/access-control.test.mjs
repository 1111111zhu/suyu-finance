import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyMember,localAccess,requireAccess,authResponse} from '../server/access/session.mjs';
test('only explicit manager tag grants payroll; descendant finance grants rd',()=>{
 const member={userid:'u1',status:1,department:[12]};const departments=[{id:10,parentid:1},{id:11,parentid:10},{id:12,parentid:11}];
 assert.equal(classifyMember(member,{userlist:[{userid:'u1'}]},departments,10),'manager');
 assert.equal(classifyMember(member,{userlist:[],partylist:[12]},departments,10),'finance');
 assert.equal(classifyMember({...member,status:2},{userlist:[{userid:'u1'}]},departments,10),'none');
 assert.equal(classifyMember({...member,department:[99]},{userlist:[]},departments,10),'none');
});
test('preview requires explicit dev env and exact loopback host, finance cannot payroll',async()=>{
 const saved={NODE_ENV:process.env.NODE_ENV,RD_LOCAL_PREVIEW:process.env.RD_LOCAL_PREVIEW,SUYU_LOCAL_PREVIEW_ROLE:process.env.SUYU_LOCAL_PREVIEW_ROLE};
 try{
 process.env.NODE_ENV='development';process.env.RD_LOCAL_PREVIEW='1';process.env.SUYU_LOCAL_PREVIEW_ROLE='finance';
 const request=new Request('http://127.0.0.1:3220/api/rd/projects',{headers:{host:'127.0.0.1:3220',cookie:'suyu_preview_role=finance'}});
 assert.equal(localAccess(request),true);assert.equal((await requireAccess(request)).role,'finance');await assert.rejects(requireAccess(request,'payroll'),e=>e.status===403);
 process.env.SUYU_LOCAL_PREVIEW_ROLE='manager';assert.equal((await requireAccess(request)).role,'manager');
 assert.equal(localAccess(new Request('http://example.com',{headers:{host:'example.com'}})),false);
 process.env.NODE_ENV='production';assert.equal(localAccess(request),false);await assert.rejects(requireAccess(request),e=>e.status===401);
 }finally{for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
test('production preview role endpoint never available',async()=>{const before=process.env.NODE_ENV;try{process.env.NODE_ENV='production';const response=await authResponse(new Request('http://127.0.0.1:3220/api/auth/preview-role',{method:'POST',headers:{host:'127.0.0.1:3220'}}));assert.equal(response.status,404);}finally{if(before===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=before;}});
import {routeCapability} from '../server/access/policy.mjs';
test('research uploads calculations exports and mutations allow finance; payroll is separate',()=>{
 for(const path of ['/salary/index.html','/salary-preview/index.html','/api/payroll/session'])assert.equal(routeCapability(path),'payroll',path);
 for(const path of ['/api/rd/export','/api/rd/result-exports','/api/rd/projects/x/documents/y','/api/rd/projects/x/ledger','/api/rd/compute','/api/rd/image-import'])for(const method of ['GET','POST','PUT'])assert.equal(routeCapability(path,method),'rd');
 assert.equal(routeCapability('/api/rd/projects','POST'),'rd');
 for(const path of ['/api/rd/analysis','/api/rd/monthly-totals','/api/rd/payroll-sync','/rd-cost/labor'])assert.equal(routeCapability(path),'rd',path);
});
test('encoded static and API paths cannot bypass route classification',()=>{
 for(const path of ['/%73alary/index.html','/%2573alary/index.html','/salary%2findex.html','//salary/index.html'])assert.equal(routeCapability(path),'payroll',path);
});
