import { after,before,test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openTestDatabase } from './helpers/payroll-postgres.mjs';
import { bootstrapAdmin } from '../database/payroll/repository.mjs';
import { provisionRuntimeRole,grantExistingApiRole } from '../database/payroll/admin.mjs';
import { createAuthService } from '../server/payroll/auth.mjs';
import { seedDemo } from '../database/payroll/demo.mjs';
import { createPayrollServer,createPayrollHandler,loginClientAddress } from '../server/payroll/http.mjs';
import { createWorkspaceService } from '../server/payroll/workspaces.mjs';

let database,pool,server,base,session,admin;
const origin='http://localhost:3000',password='Fictitious-api-test-password-2026';
const snapshot=()=>({formatVersion:1,provenance:'user-import',batch:{name:'纯虚拟接口测试草稿',month:'2026-08',workdays:21,data:{liveImport:true,payrollStage:'gross',sourceStatus:{roster:{uploaded:true,demo:false,filename:'virtual.xlsx'}}},workbench:{history:[],reviewed:{}}},sources:{roster:{rows:[{姓名:'虚拟接口员工',工号:'001',基本工资:null,社保:0}],sheetName:'测试花名册',sourceStartRow:3}},results:{gross:[{name:'虚拟接口员工',gross:0,social:null}],net:[]}});
async function call(path,{method='GET',body,auth=session,headers={}}={}) {
  const response=await fetch(base+'/api/payroll'+path,{method,headers:{Origin:origin,...(body!==undefined?{'Content-Type':'application/json'}:{}),...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,headers:response.headers,json:await response.json()};
}
async function login() {
  const response=await call('/login',{method:'POST',body:{username:'api_admin',password},auth:null});
  assert.equal(response.status,200,JSON.stringify(response.json));
  return {cookie:response.headers.get('set-cookie').split(';')[0],csrfToken:response.json.data.csrfToken};
}
before(async()=>{
  database=await openTestDatabase(); pool=database.pool;
  admin=await bootstrapAdmin(pool,{username:'api_admin',displayName:'虚拟接口管理员',password});
  server=createPayrollServer({pool,publicOrigin:origin});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base='http://127.0.0.1:'+server.address().port;
  session=await login();
},{timeout:60000});
after(async()=>{
  if(server) {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  if(database)await database.close();
});

test('unauthenticated reads fail and session cookies are private with no response cache',async()=>{
  const anon=await call('/workspaces',{auth:null});assert.equal(anon.status,401);
  const status=await call('/session');assert.equal(status.json.data.user.id,admin.id);
  assert.equal(status.headers.get('cache-control'),'no-store');
  assert.equal(JSON.stringify(status.json).includes('password'),false);
  const signed=await call('/login',{method:'POST',body:{username:'api_admin',password},auth:null});
  assert.match(signed.headers.get('set-cookie'),/HttpOnly/);assert.match(signed.headers.get('set-cookie'),/SameSite=Strict/);
  assert.equal(signed.json.data.token,undefined);
});
test('cross-site, missing-origin and missing-CSRF writes never reach payroll storage',async()=>{
  const body={requestKey:randomUUID(),snapshot:snapshot()};
  assert.equal((await call('/workspaces',{method:'POST',body,headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await call('/workspaces',{method:'POST',body,headers:{Origin:''}})).status,403);
  assert.equal((await call('/workspaces',{method:'POST',body,headers:{'X-CSRF-Token':''}})).status,403);
  assert.equal((await call('/login',{method:'POST',body:{username:'api_admin',password},auth:null,headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM payroll.workspaces')).rows[0].n,0);
});
test('saving then restoring a workspace retains raw null/zero, source coordinates and frozen outputs',async()=>{
  const input=snapshot(),requestKey=randomUUID();
  const saved=await call('/workspaces',{method:'POST',body:{requestKey,snapshot:input}});
  assert.equal(saved.status,200,JSON.stringify(saved.json));
  const id=saved.json.data.id;
  const loaded=await call('/workspaces/'+id);
  assert.deepEqual(loaded.json.data.snapshot,input);
  assert.equal(loaded.json.data.revision,1);
  const secondLogin=await login();
  assert.deepEqual((await call('/workspaces/'+id,{auth:secondLogin})).json.data.snapshot,input);
  assert.ok((await call('/workspaces')).json.data.some(row=>row.id===id));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM payroll.items')).rows[0].n,0,'unmapped draft never becomes confirmed payroll');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM payroll.employees')).rows[0].n,0);
});
test('revision conflicts do not overwrite a newer draft and old versions remain readable',async()=>{
  const first=(await call('/workspaces',{method:'POST',body:{requestKey:randomUUID(),snapshot:snapshot()}})).json.data;
  const changed=snapshot();changed.results.gross[0].gross=123.45;
  const body={requestKey:randomUUID(),expectedRevision:1,snapshot:changed};
  const latest=await call('/workspaces/'+first.id,{method:'PUT',body});assert.equal(latest.json.data.revision,2);
  const stale=await call('/workspaces/'+first.id,{method:'PUT',body:{...body,requestKey:randomUUID()}});assert.equal(stale.status,409);
  const old=await call('/workspaces/'+first.id+'/versions/1');assert.equal(old.json.data.snapshot.results.gross[0].gross,0);
  assert.equal((await call('/workspaces/'+first.id)).json.data.snapshot.results.gross[0].gross,123.45);
  assert.equal((await call('/workspaces/'+first.id+'/versions')).json.data.length,2);
  await assert.rejects(pool.query('DELETE FROM payroll.workspace_versions WHERE workspace_id=$1',[first.id]),/append-only/);
});
test('concurrent duplicate submissions return one original version even after a later save',async()=>{
  const body={requestKey:randomUUID(),snapshot:snapshot()};
  const [a,b]=await Promise.all([call('/workspaces',{method:'POST',body}),call('/workspaces',{method:'POST',body})]);
  assert.deepEqual(a.json,b.json);const first=a.json.data;
  await call('/workspaces/'+first.id,{method:'PUT',body:{requestKey:randomUUID(),expectedRevision:1,snapshot:snapshot()}});
  assert.deepEqual((await call('/workspaces',{method:'POST',body})).json,a.json);
  const changed=structuredClone(body);changed.snapshot.batch.name='同请求键不同内容';
  assert.equal((await call('/workspaces',{method:'POST',body:changed})).status,409);
});
test('demo batches, fake empty batches and malformed source data are rejected without writes',async()=>{
  for (const change of [s=>{s.batch.data.liveImport=false;},s=>{s.batch.data.sourceStatus.roster.demo=true;},s=>{s.batch.workbench.demoProfiles=[{}];},s=>{s.provenance='empty';}]) {
    const s=snapshot();change(s);
    const rejected=await call('/workspaces',{method:'POST',body:{requestKey:randomUUID(),snapshot:s}});
    assert.equal(rejected.status,422);assert.equal(rejected.json.error.code,'PAYROLL_DEMO_REJECTED');
  }
  const invalid=snapshot();invalid.sources.roster.sourceStartRow=0;
  assert.equal((await call('/workspaces',{method:'POST',body:{requestKey:randomUUID(),snapshot:invalid}})).status,422);
  const empty=snapshot();empty.provenance='empty';empty.batch.data.liveImport=false;empty.batch.data.sourceStatus={};empty.sources={};empty.results={gross:[],net:[]};
  assert.equal((await call('/workspaces',{method:'POST',body:{requestKey:randomUUID(),snapshot:empty}})).status,200);
});
test('workspace ownership comes from the login session and other accounts cannot read it',async()=>{
  const forged=randomUUID();
  const result=await call('/workspaces',{method:'POST',body:{actorId:forged,requestKey:randomUUID(),snapshot:snapshot()}});
  assert.equal((await pool.query('SELECT owner_id FROM payroll.workspaces WHERE id=$1',[result.json.data.id])).rows[0].owner_id,admin.id);
  const other=(await pool.query("INSERT INTO payroll.users(username,password_hash,display_name) VALUES($1,'scrypt$unused','测试其他账号') RETURNING id",['other_'+randomUUID()])).rows[0];
  const service=createWorkspaceService(pool);
  await assert.rejects(service.get(other.id,result.json.data.id),/未找到/);
  assert.deepEqual(await service.list(other.id),[]);
  await assert.rejects(service.save({actorId:other.id,id:result.json.data.id,requestKey:randomUUID(),expectedRevision:1,snapshot:snapshot()}),/未找到/);
});
test('formal company and employee APIs require an authenticated actor and never merge reference numbers',async()=>{
  const c=await call('/companies',{method:'POST',body:{requestKey:randomUUID(),code:randomUUID(),name:'纯虚拟API公司'}});
  assert.equal(c.status,200);assert.equal(c.json.data.created_by,admin.id);
  for(let n=0;n<2;n++) {
    const e=await call('/employees',{method:'POST',body:{requestKey:randomUUID(),name:'虚拟同名员工'}});
    assert.equal(e.status,200);
    assert.equal((await call('/employments',{method:'POST',body:{requestKey:randomUUID(),employeeId:e.json.data.id,companyId:c.json.data.id,joinedOn:'2026-08-01',employeeNumber:'001'}})).status,200);
  }
  const candidates=await call('/employee-candidates?name='+encodeURIComponent('虚拟同名员工')+'&companyId='+c.json.data.id+'&asOf=2026-08-31');
  assert.equal(candidates.json.data.candidates.length,2);assert.equal(candidates.json.data.requiresConfirmation,true);
});
test('invalid JSON, unknown routes and database errors do not expose queries or passwords',async()=>{
  const response=await fetch(base+'/api/payroll/workspaces',{method:'POST',headers:{Origin:origin,Cookie:session.cookie,'X-CSRF-Token':session.csrfToken,'Content-Type':'application/json'},body:'{broken'});
  assert.equal(response.status,400);
  assert.equal((await call('/seed-demo',{method:'POST',body:{}})).status,404);
  const invalid=await call('/companies',{method:'POST',body:{requestKey:randomUUID(),code:randomUUID(),name:'测试',actorId:'fake'}});
  assert.equal(invalid.status,200);
  const missing=await call('/employments',{method:'POST',body:{requestKey:randomUUID(),employeeId:randomUUID(),companyId:randomUUID(),joinedOn:'2026-08-01'}});
  assert.equal(missing.status,422);assert.doesNotMatch(JSON.stringify(missing.json),/INSERT|foreign key|password_hash|postgres:\/\//);
  assert.throws(()=>createPayrollHandler({pool,publicOrigin:origin,production:true}),/HTTPS/);
});
test('logout revokes the session and disabled accounts cannot continue using an old session',async()=>{
  const auth=await login();
  assert.equal((await call('/logout',{method:'POST',body:{},auth})).status,200);
  assert.equal((await call('/workspaces',{auth})).status,401);
  const disabled=await login();
  await pool.query('UPDATE payroll.users SET enabled=false WHERE id=$1',[admin.id]);
  try { assert.equal((await call('/workspaces',{auth:disabled})).status,401); }
  finally { await pool.query('UPDATE payroll.users SET enabled=true WHERE id=$1',[admin.id]); }
});
test('demo seed is opt-in, rejects production and rejects ordinary database names before any inserts',async()=>{
  await assert.rejects(seedDemo(pool,{password}),{code:'PAYROLL_DEMO_DISABLED'});
  const old=process.env.NODE_ENV;
  try {process.env.NODE_ENV='production';await assert.rejects(seedDemo(pool,{password,allowDemo:true}),{code:'PAYROLL_DEMO_DISABLED'});}
  finally {if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;}
  let queries=0;
  await assert.rejects(seedDemo({query:async()=>{queries++;return {rows:[{name:'payroll'}]};}},{password,allowDemo:true}),{code:'PAYROLL_DEMO_DATABASE'});
  assert.equal(queries,1);
});
test('restricted runtime role supports authenticated workspace writes without wage-history deletion',async()=>{
  const role='payroll_api_'+randomUUID().replaceAll('-','').slice(0,12);
  await provisionRuntimeRole(pool,{role,password:'only-for-payroll-runtime-api-tests'});
  await grantExistingApiRole(pool,{role});
  const client=await pool.connect();
  const facade={connect:async()=>({query:(...args)=>client.query(...args),release(){}}),query:(...args)=>client.query(...args)};
  try {
    await client.query(`SET ROLE "${role}"`);
    const auth=createAuthService(facade);
    const signed=await auth.login({username:'api_admin',password,clientAddress:'192.0.2.44'});
    assert.equal((await auth.authenticate(signed.token)).user.id,admin.id);
    await auth.logout(signed.token);
    assert.equal(await auth.authenticate(signed.token),null);
    const db=createWorkspaceService(facade);
    const saved=await db.save({actorId:admin.id,requestKey:randomUUID(),snapshot:snapshot()});
    assert.equal((await db.get(admin.id,saved.id)).revision,1);
    await assert.rejects(client.query('DELETE FROM payroll.workspace_versions'),/permission denied/);
    await assert.rejects(client.query('TRUNCATE payroll.items'),/permission denied/);
  }finally{await client.query('RESET ROLE');client.release();}
});
test('forwarded client addresses are honored only for an explicitly trusted proxy',()=>{
  const req={socket:{remoteAddress:'::ffff:127.0.0.1'},headers:{'x-real-ip':'203.0.113.10'}};
  assert.equal(loginClientAddress(req,[]),'127.0.0.1');
  assert.equal(loginClientAddress(req,['127.0.0.1']),'203.0.113.10');
  assert.equal(loginClientAddress(req,['192.0.2.1']),'127.0.0.1');
  req.headers['x-real-ip']='203.0.113.10, 192.0.2.1';
  assert.equal(loginClientAddress(req,['127.0.0.1']),'127.0.0.1');
  assert.throws(()=>createPayrollHandler({pool,publicOrigin:origin,trustedProxies:['*']}),/explicit IP/);
});
test('different clients behind the trusted proxy have independent login failure budgets',async()=>{
  const isolated=await openTestDatabase();let proxyServer;
  try {
    await bootstrapAdmin(isolated.pool,{username:'proxy_admin',displayName:'虚拟代理测试',password});
    proxyServer=createPayrollServer({pool:isolated.pool,publicOrigin:origin,trustedProxies:['127.0.0.1']});
    await new Promise(resolve=>proxyServer.listen(0,'127.0.0.1',resolve));
    const target='http://127.0.0.1:'+proxyServer.address().port+'/api/payroll/login';
    const attempt=(ip,username,secret)=>fetch(target,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Real-IP':ip},body:JSON.stringify({username,password:secret})});
    for(let i=0;i<30;i++)assert.equal((await attempt('203.0.113.1','nonexistent_'+i,'invalid')).status,401);
    assert.equal((await attempt('203.0.113.1','proxy_admin',password)).status,429);
    assert.equal((await attempt('203.0.113.2','proxy_admin',password)).status,200);
  }finally{
    if(proxyServer){proxyServer.closeAllConnections();await new Promise(resolve=>proxyServer.close(resolve));}
    await isolated.close();
  }
});
