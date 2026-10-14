import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openTestDatabase} from './helpers/payroll-postgres.mjs';
import {migrate} from '../database/rd/migrate.mjs';
import {authResponse,closeAccessRuntime} from '../server/access/session.mjs';
import {wecomQrURL,wecomQrCallback} from '../server/access/wecom-login.mjs';
const origin='https://finance.example.invalid';

test('QR messages allow only the exact callback with matching state and a code',()=>{
 const callback=origin+'/api/auth/callback?state=expected&code=one-use-code';
 assert.equal(wecomQrCallback(callback,origin,'expected'),callback);
 for(const value of [callback.replace(origin,'https://evil.invalid'),callback.replace('/callback','/logout'),callback.replace('expected','other'),callback+'&state=expected',callback+'&code=other',callback+'#fragment',origin+'/api/auth/callback?state=expected',{},'javascript:alert(1)'])assert.equal(wecomQrCallback(value,origin,'expected'),null);
 const qr=new URL(wecomQrURL({corpId:'wwTestCompany',agentId:'1000001',origin,state:'expected'}));
 assert.equal(qr.origin,'https://open.work.weixin.qq.com');
 assert.equal(qr.pathname,'/wwopen/sso/qrConnect');
 assert.equal(qr.searchParams.get('redirect_uri'),origin+'/api/auth/callback');
 assert.equal(qr.searchParams.get('login_type'),'jssdk');
 assert.equal(qr.searchParams.get('state'),'expected');
});

test('embedded QR issues a single-use DB state and HttpOnly cookie, rejects foreign origins',async t=>{
 const db=await openTestDatabase();await migrate(db.pool);
 const keys=['NODE_ENV','RD_DATABASE_URL','SUYU_PUBLIC_ORIGIN','WECOM_CORP_ID','WECOM_AGENT_ID','WECOM_APP_SECRET_FILE','WECOM_MANAGER_TAG_ID','WECOM_FINANCE_DEPARTMENT_ID'];
 const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 t.after(async()=>{await closeAccessRuntime();await db.close();for(const [key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;});
 const connection=new URL(db.connectionOptions.connectionString||'postgresql://payroll_test_owner@localhost/'+db.connectionOptions.database);
 if(!db.connectionOptions.connectionString){connection.searchParams.set('host',db.connectionOptions.host);connection.searchParams.set('port',String(db.connectionOptions.port));}
 Object.assign(process.env,{NODE_ENV:'production',RD_DATABASE_URL:connection.toString(),SUYU_PUBLIC_ORIGIN:origin,WECOM_CORP_ID:'wwTestCompany',WECOM_AGENT_ID:'1000001',WECOM_APP_SECRET_FILE:'/nonexistent-test-secret',WECOM_MANAGER_TAG_ID:'14',WECOM_FINANCE_DEPARTMENT_ID:'122'});
 const endpoint=origin+'/api/auth/wecom-qr';
 assert.equal((await authResponse(new Request(endpoint))).status,405);
 for(const headers of [{},{origin:'https://evil.invalid'},{origin,'sec-fetch-site':'cross-site'}])await assert.rejects(authResponse(new Request(endpoint,{method:'POST',headers})),error=>error.status===403);
 assert.equal((await db.pool.query('SELECT count(*)::int AS count FROM rd.access_oauth_states')).rows[0].count,0);
 const response=await authResponse(new Request(endpoint,{method:'POST',headers:{origin,'sec-fetch-site':'same-origin'}}));
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const body=await response.json();assert.match(body.state,/^[A-Za-z0-9_-]{43}$/);assert.equal(body.origin,origin);
 assert.equal(new URL(body.url).searchParams.get('state'),body.state);
 assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
 const digest=createHash('sha256').update(body.state).digest('hex');
 assert.equal((await db.pool.query('SELECT state_hash FROM rd.access_oauth_states WHERE state_hash=$1',[digest])).rowCount,1);
 const callback=new Request(origin+'/api/auth/callback?code=test&state='+body.state,{headers:{cookie:'suyu_oauth_state='+body.state}});
 await assert.rejects(authResponse(callback)); // No real API: nonexistent private secret, state still consumed.
 assert.equal((await db.pool.query('SELECT state_hash FROM rd.access_oauth_states WHERE state_hash=$1',[digest])).rowCount,0);
 await assert.rejects(authResponse(callback),error=>error.status===403);
});
