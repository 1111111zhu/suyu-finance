import test from 'node:test';
import assert from 'node:assert/strict';
import {openTestDatabase} from './helpers/payroll-postgres.mjs';
import {createPool} from '../database/payroll/pool.mjs';
import {grantRdRuntimePrivileges} from '../database/rd/provision.mjs';
import {migrate} from '../database/rd/migrate.mjs';
import {createFinanceAccount} from '../运维脚本/finance-password-account.mjs';
import {createPasswordAuthService} from '../server/access/password-auth.mjs';
import {hashPassword} from '../server/access/password-crypto.mjs';
import {authResponse,requireAccess,closeAccessRuntime} from '../server/access/session.mjs';
import {passwordAccess,passwordCookieName} from '../server/access/password-session.mjs';
import {payrollActorUsername} from '../server/access/netbird-device.mjs';

test('independent finance passwords, permissions, revocation and HTTP boundaries',async t=>{
 const db=await openTestDatabase();t.after(async()=>{await closeAccessRuntime();await db.close();});await migrate(db.pool);
 const password='Test-only-password-2026';
 const manager=await createFinanceAccount(db.pool,db.pool,{username:'website-manager',password});
 const finance=await createFinanceAccount(db.pool,db.pool,{username:'website-finance',password,role:'finance'});
 await assert.rejects(createFinanceAccount(db.pool,db.pool,{username:'website-manager',password}),/已存在/);
 const auth=createPasswordAuthService(db.pool);
 assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM payroll.users WHERE username=$1',[manager.username])).rows[0].n,0);
 assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM payroll.users WHERE username=$1',['account:'+manager.id])).rows[0].n,1);
 await db.pool.query('INSERT INTO payroll.users(username,display_name,password_hash) VALUES($1,$1,$2)',['old-admin',hashPassword(password)]);
 await assert.rejects(auth.login({username:'old-admin',password}),{code:'PASSWORD_AUTH_FAILED'});
 await assert.rejects(auth.login({username:manager.username,password:'wrong'}),{code:'PASSWORD_AUTH_FAILED'});
 const first=await auth.login({username:manager.username,password});
 assert.equal((await auth.authenticate(first.token)).user.role,'manager');
 assert.equal((await db.pool.query('SELECT token_hash FROM rd.password_sessions')).rows.some(row=>row.token_hash===first.token),false);
 await db.pool.query('UPDATE rd.password_accounts SET password_hash=$2 WHERE id=$1',[manager.id,hashPassword(password)]);
 assert.equal(await auth.authenticate(first.token),null,'password reset revokes previous sessions');
 const disabled=await auth.login({username:manager.username,password});
 await db.pool.query('UPDATE rd.password_accounts SET enabled=false WHERE id=$1',[manager.id]);
 assert.equal(await auth.authenticate(disabled.token),null);
 await assert.rejects(auth.login({username:manager.username,password}),{code:'PASSWORD_AUTH_FAILED'});
 await db.pool.query('UPDATE rd.password_accounts SET enabled=true WHERE id=$1',[manager.id]);
 const envKeys=['NODE_ENV','RD_DATABASE_URL','SUYU_PUBLIC_ORIGIN','SUYU_PASSWORD_LOGIN_ENABLED','RD_LOCAL_PREVIEW','SUYU_NETBIRD_DEVICE_ID','WECOM_CORP_ID'];
 const original=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
 t.after(async()=>{await closeAccessRuntime();for(const key of envKeys)if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];});
 const url=new URL(db.connectionOptions.connectionString||'postgresql://payroll_test_owner@localhost/'+db.connectionOptions.database);
 if(!db.connectionOptions.connectionString){url.searchParams.set('host',db.connectionOptions.host);url.searchParams.set('port',String(db.connectionOptions.port));}
 Object.assign(process.env,{NODE_ENV:'production',RD_DATABASE_URL:url.toString(),SUYU_PUBLIC_ORIGIN:'https://finance.example.invalid',SUYU_PASSWORD_LOGIN_ENABLED:'1',RD_LOCAL_PREVIEW:'0'});delete process.env.SUYU_NETBIRD_DEVICE_ID;delete process.env.WECOM_CORP_ID;
 const runtimeRole='password_test_runtime';
 await db.pool.query('CREATE ROLE '+runtimeRole+' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE');

 await grantRdRuntimePrivileges(db.pool,{runtimeRole});
 const runtimeOptions={...db.connectionOptions,user:runtimeRole};
 if(runtimeOptions.connectionString){const runtimeUrl=new URL(runtimeOptions.connectionString);runtimeUrl.username=runtimeRole;runtimeUrl.password='';runtimeOptions.connectionString=runtimeUrl.toString();}
 const runtimePool=createPool(runtimeOptions);
 try{
  const runtimeAuth=createPasswordAuthService(runtimePool);
  const sample=await runtimeAuth.login({username:manager.username,password});
  assert.equal((await runtimeAuth.authenticate(sample.token)).user.id,manager.id);
  await runtimeAuth.logout(sample.token);
  await assert.rejects(runtimePool.query('UPDATE rd.password_accounts SET role=$1 WHERE id=$2',['finance',manager.id]),{code:'42501'});
 }finally{await runtimePool.end();await db.pool.query('DROP OWNED BY '+runtimeRole);await db.pool.query('DROP ROLE '+runtimeRole);}
 const origin=process.env.SUYU_PUBLIC_ORIGIN;
 const login=(body,headers={})=>new Request(origin+'/api/auth/password-login',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});
 let result=await authResponse(new Request(origin+'/api/auth/session'));assert.equal((await result.json()).passwordConfigured,true);
 await assert.rejects(authResponse(login({username:manager.username,password},{origin:'https://attacker.invalid'})),{status:403});
 await assert.rejects(authResponse(login({username:manager.username,password},{'content-type':'text/plain'})),{status:415});
 await assert.rejects(authResponse(login({username:manager.username,password,padding:'x'.repeat(5000)})),{status:413});
 await assert.rejects(authResponse(login({username:manager.username,password:'wrong'},{'x-forwarded-for':'127.0.0.1'})),{status:401});
 result=await authResponse(login({username:manager.username,password}));assert.equal(result.status,200);
 const cookies=result.headers.getSetCookie();assert.equal(cookies.length,2);assert.match(cookies[0],/HttpOnly; SameSite=Lax; Max-Age=28800; Secure/);
 const cookie=cookies[0].split(';')[0];const request=new Request(origin+'/api/rd/projects',{headers:{cookie}});
 const access=await requireAccess(request,'payroll');assert.equal(access.accountId,manager.id);assert.equal(payrollActorUsername(access),'account:'+manager.id);
 assert.equal(await passwordAccess(new Request(origin+'/',{headers:{cookie:cookie+'; '+cookie}})),null);
 await assert.rejects(requireAccess(new Request(origin+'/api/rd/projects',{method:'POST',headers:{cookie,origin:'https://attacker.invalid'}})),{status:403});
 const limited=await authResponse(login({username:finance.username,password}));
 const limitedCookie=limited.headers.getSetCookie()[0].split(';')[0];
 assert.equal((await requireAccess(new Request(origin+'/api/rd/projects',{headers:{cookie:limitedCookie}}),'rd')).role,'finance');
 await assert.rejects(requireAccess(new Request(origin+'/api/payroll/session',{headers:{cookie:limitedCookie}}),'payroll'),{status:403});
 result=await authResponse(new Request(origin+'/api/auth/logout',{method:'POST',headers:{cookie,origin}}));assert.equal(result.status,200);assert.equal(await passwordAccess(request),null);
 assert.match(passwordCookieName(),/^__Host-/);
 for(let n=0;n<5;n++)await assert.rejects(authResponse(login({username:'rate-target',password:'wrong'})),{status:401});
 await assert.rejects(authResponse(login({username:'RATE-TARGET',password:'wrong'})),{status:429});
 assert.equal((await db.pool.query("SELECT failures FROM rd.password_login_limits WHERE kind='account' ORDER BY failures DESC LIMIT 1")).rows[0].failures,5);
});
