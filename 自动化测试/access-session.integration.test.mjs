import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {createPool} from '../database/payroll/pool.mjs';
import {getAccess,requireAccess,authResponse,configured,closeAccessRuntime} from '../server/access/session.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
test('real PostgreSQL session: revoke expire corp isolation CSRF stale qualification fails closed',{skip:!process.env.RD_DATABASE_URL},async()=>{
 const keys=['NODE_ENV','RD_LOCAL_PREVIEW','WECOM_CORP_ID','WECOM_AGENT_ID','WECOM_APP_SECRET_FILE','WECOM_MANAGER_TAG_ID','WECOM_FINANCE_DEPARTMENT_ID','SUYU_PUBLIC_ORIGIN'];
 const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const corp='integration-'+randomBytes(8).toString('hex'),token=randomBytes(32).toString('base64url');
 const pool=createPool({connectionString:process.env.RD_DATABASE_URL,max:1});
 const request=(method='GET',origin)=>new Request('https://finance.example.invalid/api/rd/projects',{method,headers:{host:'finance.example.invalid',cookie:'__Host-suyu_access='+token,...origin?{origin}:{}}});
 try{
 Object.assign(process.env,{NODE_ENV:'production',RD_LOCAL_PREVIEW:'0',WECOM_CORP_ID:corp,WECOM_AGENT_ID:'1000001',WECOM_APP_SECRET_FILE:'/nonexistent-suyu-test-no-network',WECOM_MANAGER_TAG_ID:'1',WECOM_FINANCE_DEPARTMENT_ID:'2',SUYU_PUBLIC_ORIGIN:'https://finance.example.invalid'});
 assert.equal(configured(),true);
 for(const [agent,host]of [['Mozilla/5.0 Safari/605.1','login.work.weixin.qq.com'],['MicroMessenger/8.0 wxwork/4.1','open.weixin.qq.com']]){
  const login=await authResponse(new Request('https://finance.example.invalid/api/auth/login',{headers:{'user-agent':agent}}));
  assert.equal(login.status,302);
  const location=new URL(login.headers.get('location'));
  assert.equal(location.hostname,host);
  assert.equal(location.searchParams.get('agentid'),'1000001');
  const state=location.searchParams.get('state');
  assert.match(login.headers.get('set-cookie'),new RegExp('suyu_oauth_state='+state+';'));
  assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
  assert.equal(login.headers.get('cache-control'),'no-store');
  const stored=await pool.query('DELETE FROM rd.access_oauth_states WHERE state_hash=$1 RETURNING state_hash',[hash(state)]);
  assert.equal(stored.rowCount,1);
 }
 const handoff=await authResponse(new Request('https://finance.example.invalid/api/auth/callback?code=old-client-code&state=old-client-state',{headers:{'user-agent':'wxwork/4.1'}}));
 assert.equal(handoff.status,302);
 assert.equal(handoff.headers.get('location'),'https://finance.example.invalid/api/auth/login?handoff=1');
 const freshLogin=await authResponse(new Request(handoff.headers.get('location'),{headers:{'user-agent':'wxwork/4.1'}}));
 const freshURL=new URL(freshLogin.headers.get('location'));
 assert.equal(freshURL.hostname,'open.weixin.qq.com');
 assert.equal(new URL(freshURL.searchParams.get('redirect_uri')).searchParams.get('handoff'),'1');
 assert.notEqual(freshURL.searchParams.get('state'),'old-client-state');
 await pool.query('DELETE FROM rd.access_oauth_states WHERE state_hash=$1',[hash(freshURL.searchParams.get('state'))]);
 for(const headers of [{'user-agent':'Safari'},{'user-agent':'wxwork/4.1',cookie:'suyu_oauth_state=different'}])await assert.rejects(authResponse(new Request('https://finance.example.invalid/api/auth/callback?code=x&state=y',{headers})),e=>e.status===403);
 await assert.rejects(authResponse(new Request('https://finance.example.invalid/api/auth/callback?code=x&state=y&handoff=1',{headers:{'user-agent':'wxwork/4.1'}})),e=>e.status===403); // cookies disabled: no redirect loop.
 await pool.query('INSERT INTO rd.access_sessions(token_hash,corp_id,userid,display_name,role) VALUES($1,$2,$3,$4,$5)',[hash(token),corp,'test-user','测试身份','manager']);
 assert.equal((await getAccess(request())).role,'manager');
 await assert.rejects(requireAccess(request('POST','https://evil.invalid'),'payroll'),e=>e.status===403);
 await assert.rejects(requireAccess(request('POST'),'payroll'),e=>e.status===403);
 assert.equal((await requireAccess(request('POST','https://finance.example.invalid'),'payroll')).role,'manager');
 process.env.WECOM_CORP_ID='different-corp';assert.equal(await getAccess(request()),null);process.env.WECOM_CORP_ID=corp;
 await pool.query("UPDATE rd.access_sessions SET role='finance' WHERE token_hash=$1",[hash(token)]);
 await assert.rejects(requireAccess(request(),'payroll'),e=>e.status===403);assert.equal((await requireAccess(request(),'rd')).role,'finance');
 await pool.query("UPDATE rd.access_sessions SET role='manager',checked_at=now()-interval '6 minutes' WHERE token_hash=$1",[hash(token)]);
 // Qualification fails before any external API call: nonexistent private secret file.
 await assert.rejects(requireAccess(request(),'payroll')); // stale manager cannot keep access on refresh failure.
 await pool.query('DELETE FROM rd.access_sessions WHERE token_hash=$1',[hash(token)]);
 await pool.query("INSERT INTO rd.access_sessions(token_hash,corp_id,userid,display_name,role,expires_at) VALUES($1,$2,'test-user','测试身份','manager',now()-interval '1 second')",[hash(token),corp]);
 assert.equal(await getAccess(request()),null);
 await pool.query('DELETE FROM rd.access_sessions WHERE token_hash=$1',[hash(token)]);
 await pool.query("INSERT INTO rd.access_sessions(token_hash,corp_id,userid,display_name,role) VALUES($1,$2,'test-user','测试身份','manager')",[hash(token),corp]);
 const logout=await authResponse(new Request('https://finance.example.invalid/api/auth/logout',{method:'POST',headers:{origin:'https://finance.example.invalid',cookie:'__Host-suyu_access='+token}}));assert.equal(logout.status,200);
 assert.equal(await getAccess(request()),null);
 const oauthState=randomBytes(32).toString('base64url');
 const callback=(state=oauthState)=>new Request('https://finance.example.invalid/api/auth/callback?code=test-code&state='+state,{headers:{cookie:'suyu_oauth_state='+oauthState}});
 await assert.rejects(authResponse(callback('tampered')),e=>e.status===403);
 await pool.query("INSERT INTO rd.access_oauth_states(state_hash,expires_at) VALUES($1,now()-interval '1 second')",[hash(oauthState)]);
 await assert.rejects(authResponse(callback()),e=>e.status===403);
 await pool.query('DELETE FROM rd.access_oauth_states WHERE state_hash=$1',[hash(oauthState)]);
 await pool.query('INSERT INTO rd.access_oauth_states(state_hash) VALUES($1)',[hash(oauthState)]);
 await assert.rejects(authResponse(callback())); // consumed state, private-secret failure before any network.
 await assert.rejects(authResponse(callback()),e=>e.status===403);
 }finally{await pool.query('DELETE FROM rd.access_sessions WHERE token_hash=$1',[hash(token)]);await pool.end();await closeAccessRuntime();for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
