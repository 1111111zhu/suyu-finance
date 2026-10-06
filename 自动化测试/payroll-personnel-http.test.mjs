import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openTestDatabase} from './helpers/payroll-postgres.mjs';
import {bootstrapAdmin} from '../database/payroll/repository.mjs';
import {createPayrollServer} from '../server/payroll/http.mjs';
import {createWorkspaceConfirmationService} from '../server/payroll/workspace-confirmation.mjs';

let database,server,base,cookie,csrf;
const origin='http://127.0.0.1:3220';
const calls=[];
const personnel={
  snapshot:async()=>({configured:true,syncedAt:'2026-09-24T00:00:00.000Z',fresh:true,
    departments:[{id:'1',name:'公司',parentId:'0',order:0}],members:[{userid:'alice',name:'甲',departmentIds:['1'],employeeId:null}]}),
  sync:async()=>{calls.push('sync');return {memberCount:1,eventCount:0};},
  listEvents:async()=>[],listConflicts:async()=>[],
  importRoster:async input=>{calls.push(['roster',input.actorId,input.rows.length]);return {rosterId:randomUUID(),rowCount:input.rows.length};},
  link:async input=>{calls.push(['link',input.actorId,input.userid]);return {userid:input.userid,employeeId:input.employeeId};}
};
async function req(path,{method='GET',body,headers={}}={}) {
  const response=await fetch(base+path,{method,headers:{Accept:'application/json',...(method==='GET'?{}:{'Content-Type':'application/json',Origin:origin,'X-CSRF-Token':csrf||''}),...(cookie?{Cookie:cookie}:{}),...headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,data:await response.json(),headers:response.headers};
}
before(async()=>{
  database=await openTestDatabase();
  await bootstrapAdmin(database.pool,{username:'route_admin',displayName:'接口测试管理员',password:'Fictitious-route-admin-password'});
  server=createPayrollServer({pool:database.pool,publicOrigin:origin,personnelService:personnel,corpId:'ww-route-test',
    confirmationService:createWorkspaceConfirmationService({pool:database.pool,corpId:'ww-route-test'})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
},{timeout:60000});
after(async()=>{
  if(server) await new Promise(resolve=>server.close(resolve));
  await database?.close();
});

test('personnel routes require administrator session and CSRF for sync/import/link',async()=>{
  assert.equal((await req('/api/payroll/personnel/directory')).status,401);
  const login=await req('/api/payroll/login',{method:'POST',body:{username:'route_admin',password:'Fictitious-route-admin-password'}});
  assert.equal(login.status,200);cookie=login.headers.get('set-cookie')?.split(';')[0];csrf=login.data.data.csrfToken;
  assert.equal((await req('/api/payroll/personnel/directory')).data.data.members[0].userid,'alice');
  assert.equal((await req('/api/payroll/personnel/directory/sync',{method:'POST',body:{requestKey:randomUUID()},headers:{'X-CSRF-Token':'bad'}})).status,403);
  assert.equal((await req('/api/payroll/personnel/directory/sync',{method:'POST',body:{requestKey:randomUUID()}})).status,200);
  assert.deepEqual(calls,['sync']);
  const roster=await req('/api/payroll/personnel/rosters',{method:'POST',body:{requestKey:randomUUID(),source:{fileName:'虚拟.xlsx',sheetName:'花名册'},rows:[{name:'甲'}]}});
  assert.equal(roster.status,200);
  assert.equal(calls[1][0],'roster');
  const summary=await req('/api/payroll/personnel/payroll-summary?from=2025-12&to=2026-01');
  assert.equal(summary.status,200);
  assert.deepEqual(summary.data.data.months.map(item=>item.totalNet),[null,null]);
});
