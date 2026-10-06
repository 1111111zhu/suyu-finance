import {createHash,randomBytes} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import {createPool} from '../../database/payroll/pool.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const random=()=>randomBytes(32).toString('base64url');
let pool, tokenCache;
const db=()=>pool??=createPool({connectionString:process.env.RD_DATABASE_URL,max:3,application_name:'suyu-access'});
export function accessError(status,message){return Object.assign(new Error(message),{status,code:status===401?'ACCESS_LOGIN_REQUIRED':'ACCESS_DENIED'});}
export function localAccess(request){
 const url=new URL(request.url);
 return process.env.NODE_ENV!=='production'&&process.env.RD_LOCAL_PREVIEW==='1'&&url.origin==='http://127.0.0.1:3220'&&request.headers.get('host')==='127.0.0.1:3220'&&request.headers.get('sec-fetch-site')!=='cross-site'&&(!request.headers.get('origin')||request.headers.get('origin')==='http://127.0.0.1:3220');
}
export function accessCookie(request,name){return (request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';}
const cookieName=()=>process.env.NODE_ENV==='production'?'__Host-suyu_access':'suyu_access';
export function sessionCookie(value,maxAge=28800){return `${cookieName()}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`;}
export function configured(){
 if(!process.env.RD_DATABASE_URL||!process.env.WECOM_APP_SECRET_FILE||!/^[A-Za-z0-9_-]{4,128}$/.test(process.env.WECOM_CORP_ID||''))return false;
 for(const key of ['WECOM_MANAGER_TAG_ID','WECOM_FINANCE_DEPARTMENT_ID']){const value=process.env[key];if(!/^[1-9]\d*$/.test(value||'')||!Number.isSafeInteger(Number(value)))return false;}
 try{const url=new URL(process.env.SUYU_PUBLIC_ORIGIN);return !url.username&&!url.password&&url.origin===process.env.SUYU_PUBLIC_ORIGIN&&(process.env.NODE_ENV==='production'?url.protocol==='https:':['https:','http:'].includes(url.protocol));}catch{return false;}
}
async function api(path,params={},withToken=true){
 if(!configured())throw accessError(503,'企业微信访问控制尚未配置');
 if(withToken&&(!tokenCache||tokenCache.expires<Date.now())){
  const file=process.env.WECOM_APP_SECRET_FILE;const info=statSync(file);if(!info.isFile()||(info.mode&0o077))throw accessError(503,'企业微信应用密钥文件必须限制为仅服务用户可读');
  const secret=readFileSync(file,'utf8').trim();if(!secret)throw accessError(503,'企业微信应用密钥尚未配置');
  const data=await api('gettoken',{corpid:process.env.WECOM_CORP_ID,corpsecret:secret},false);
  tokenCache={value:data.access_token,expires:Date.now()+Math.max(0,(data.expires_in-120))*1000};
 }
 const url=new URL('https://qyapi.weixin.qq.com/cgi-bin/'+path);
 for(const [key,value]of Object.entries({...params,...withToken?{access_token:tokenCache.value}:{}}))url.searchParams.set(key,String(value));
 const response=await fetch(url,{signal:AbortSignal.timeout(10000)}); const data=await response.json();
 if(!response.ok||data.errcode)throw accessError(503,'企业微信身份核验失败');
 return data;
}
export function classifyMember(member,tag,departments,financeId){
 if(member.status!==1)return 'none';
 const descendants=new Set([Number(financeId)]);
 for(let n=0;n<departments.length;n++)for(const d of departments)if(descendants.has(Number(d.parentid)))descendants.add(Number(d.id));
 // Only explicit manager tag members qualify; department-wide tags are deliberately not manager grants.
 if((tag.userlist||[]).some(u=>u.userid===member.userid))return 'manager';
 return (member.department||[]).some(id=>descendants.has(Number(id)))?'finance':'none';
}
async function qualify(userid){
 const [member,tag,departments]=await Promise.all([api('user/get',{userid}),api('tag/get',{tagid:process.env.WECOM_MANAGER_TAG_ID}),api('department/list')]);
 return {userid,displayName:member.name||userid,role:classifyMember(member,tag,departments.department||[],process.env.WECOM_FINANCE_DEPARTMENT_ID)};
}
export async function getAccess(request){
 if(localAccess(request))return {userid:'local-preview',displayName:'本机开发验收',role:process.env.SUYU_LOCAL_PREVIEW_ROLE==='finance'?'finance':'manager',local:true};
 if(!configured())return null;
 const value=accessCookie(request,cookieName());if(!/^[A-Za-z0-9_-]{43}$/.test(value))return null;
 const {rows:[row]}=await db().query('SELECT * FROM rd.access_sessions WHERE token_hash=$1 AND expires_at>now() AND corp_id=$2',[hash(value),process.env.WECOM_CORP_ID]);
 if(!row)return null;
 if(Date.now()-new Date(row.checked_at).getTime()>=300000){
  const member=await qualify(row.userid);
  await db().query('UPDATE rd.access_sessions SET role=$2,display_name=$3,checked_at=now() WHERE token_hash=$1',[hash(value),member.role,member.displayName]);
  return member;
 }
 return {userid:row.userid,displayName:row.display_name,role:row.role};
}
export async function requireAccess(request,capability='rd'){
 const user=await getAccess(request);if(!user)throw accessError(401,'请使用企业微信登录');
 if(user.role==='none'||capability==='payroll'&&user.role!=='manager')throw accessError(403,'没有访问权限');
 if(!['GET','HEAD','OPTIONS'].includes(request.method)&&!localAccess(request)&&request.headers.get('origin')!==process.env.SUYU_PUBLIC_ORIGIN)throw accessError(403,'请从本网站提交操作');
 return user;
}
export async function authResponse(request){
 const path=new URL(request.url).pathname;
 const methods={'/api/auth/session':'GET','/api/auth/login':'GET','/api/auth/callback':'GET','/api/auth/logout':'POST'};
 if(methods[path]&&request.method!==methods[path])return Response.json({error:'请求方法不支持'},{status:405,headers:{Allow:methods[path],'Cache-Control':'no-store'}});
 if(path==='/api/auth/session'){
  const user=await getAccess(request);
  return Response.json({user,capabilities:{rd:!!user&&user.role!=='none',payroll:user?.role==='manager'},configured:configured()},{headers:{'Cache-Control':'no-store'}});
 }
 if(path==='/api/auth/logout'&&request.method==='POST'){
  if(request.headers.get('origin')!==(localAccess(request)?'http://127.0.0.1:3220':process.env.SUYU_PUBLIC_ORIGIN))throw accessError(403,'请从本网站退出');
  if(!localAccess(request)){const user=await getAccess(request);if(!user)throw accessError(401,'登录已失效');await db().query('DELETE FROM rd.access_sessions WHERE token_hash=$1',[hash(accessCookie(request,cookieName()))]);}
  return Response.json({ok:true},{headers:{'Set-Cookie':sessionCookie('',0)}});
 }
 if(path==='/api/auth/login'&&request.method==='GET'){
  if(!configured())throw accessError(503,'企业微信登录尚未配置');
  const origin=new URL(process.env.SUYU_PUBLIC_ORIGIN);if(process.env.NODE_ENV==='production'&&origin.protocol!=='https:')throw accessError(503,'生产登录需要 HTTPS');
  const state=random();await db().query('DELETE FROM rd.access_oauth_states WHERE expires_at<=now()');
  await db().query('INSERT INTO rd.access_oauth_states(state_hash) VALUES($1)',[hash(state)]);
  const url=new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
  for(const [k,v]of Object.entries({appid:process.env.WECOM_CORP_ID,redirect_uri:origin.origin+'/api/auth/callback',response_type:'code',scope:'snsapi_base',state}))url.searchParams.set(k,v);
  url.hash='wechat_redirect';return new Response(null,{status:302,headers:{Location:url.toString(),'Set-Cookie':`suyu_oauth_state=${state}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600${origin.protocol==='https:'?'; Secure':''}`}});
 }
 if(path==='/api/auth/callback'&&request.method==='GET'){
  const url=new URL(request.url),state=url.searchParams.get('state'),code=url.searchParams.get('code');
  if(!state||!code||state!==accessCookie(request,'suyu_oauth_state'))throw accessError(403,'登录校验已失效');
  const used=await db().query('DELETE FROM rd.access_oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING state_hash',[hash(state)]);if(!used.rowCount)throw accessError(403,'登录校验已失效');
  const identity=await api('auth/getuserinfo',{code});if(!identity.UserId)throw accessError(403,'仅允许本企业成员登录');
  const member=await qualify(identity.UserId);if(member.role==='none')throw accessError(403,'没有业务访问权限');
  const value=random();await db().query('DELETE FROM rd.access_sessions WHERE expires_at<=now()');
  await db().query('INSERT INTO rd.access_sessions(token_hash,corp_id,userid,display_name,role) VALUES($1,$2,$3,$4,$5)',[hash(value),process.env.WECOM_CORP_ID,member.userid,member.displayName,member.role]);
  return new Response(null,{status:302,headers:{Location:process.env.SUYU_PUBLIC_ORIGIN+'/', 'Set-Cookie':sessionCookie(value)}});
 }
 return Response.json({error:'接口不存在'},{status:404});
}
/** Graceful shutdown/test cleanup; does not change persisted sessions. */
export async function closeAccessRuntime(){const current=pool;pool=undefined;tokenCache=undefined;if(current)await current.end();}
