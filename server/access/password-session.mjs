import {createPool} from '../../database/payroll/pool.mjs';
import {createPasswordAuthService} from './password-auth.mjs';

let pool, service;
export function passwordLoginConfigured(){return !!process.env.RD_DATABASE_URL&&process.env.SUYU_PASSWORD_LOGIN_ENABLED==='1';}
export function passwordCookieName(){return process.env.NODE_ENV==='production'?'__Host-suyu_password':'suyu_password';}
export function passwordCookie(token,maxAge=28800){return `${passwordCookieName()}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`;}
function tokenFrom(request){
 const values=(request.headers.get('cookie')||'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(passwordCookieName()+'='));
 if(values.length!==1)return '';
 const token=values[0].slice(passwordCookieName().length+1);
 return /^[A-Za-z0-9_-]{43}$/.test(token)?token:'';
}
function auth(){
 if(!pool){pool=createPool({connectionString:process.env.RD_DATABASE_URL,max:3,application_name:'suyu-password-login'});pool.on('error',()=>process.stderr.write('Password login connection interrupted.\n'));}
 return service??=createPasswordAuthService(pool);
}
function accessUser(user){return {userid:'password:'+user.id,displayName:user.displayName,role:user.role,authMethod:'password',accountId:user.id};}
export async function passwordAccess(request){
 const token=tokenFrom(request);
 if(!token||!passwordLoginConfigured())return null;
 const session=await auth().authenticate(token);
 return session?accessUser(session.user):null;
}
function fail(status,message){return Object.assign(new Error(message),{status,code:'ACCESS_PASSWORD_LOGIN'});}
export function requirePasswordOrigin(request){
 let origin;
 try{origin=new URL(process.env.SUYU_PUBLIC_ORIGIN);}catch{throw fail(503,'账号登录尚未配置');}
 if(origin.origin!==process.env.SUYU_PUBLIC_ORIGIN||origin.username||origin.password||!['http:','https:'].includes(origin.protocol)||process.env.NODE_ENV==='production'&&origin.protocol!=='https:')throw fail(503,'账号登录尚未配置');
 if(request.headers.get('origin')!==origin.origin||request.headers.get('sec-fetch-site')==='cross-site')throw fail(403,'请从本网站提交登录');
}
export async function passwordLoginBody(request){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))throw fail(415,'请求必须使用 JSON');
 if(Number(request.headers.get('content-length'))>4096)throw fail(413,'登录请求过大');
 const reader=request.body?.getReader();let size=0;const chunks=[];
 if(reader)try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4096){await reader.cancel();throw fail(413,'登录请求过大');}chunks.push(Buffer.from(part.value));}}finally{reader.releaseLock();}
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail(400,'登录请求格式错误');}
 if(!body||typeof body!=='object'||Array.isArray(body))throw fail(400,'登录请求格式错误');
 return body;
}
export async function passwordLoginResponse(request){
 requirePasswordOrigin(request);
 if(!passwordLoginConfigured())throw fail(503,'账号登录尚未开通');
 const body=await passwordLoginBody(request);
 let session;
 try{
  // No client-supplied IP headers are trusted. All password attempts share the
  // conservative address budget; per-account throttling remains independent.
  session=await auth().login({username:body.username,password:body.password,clientAddress:'unknown'});
 }catch(error){
  if(error.code==='PASSWORD_RATE_LIMIT')throw fail(429,'登录尝试过多，请 15 分钟后重试');
  if(error.code==='PASSWORD_AUTH_FAILED')throw fail(401,'账号或密码错误');
  throw error;
 }
 const headers=new Headers({'Cache-Control':'no-store','Set-Cookie':passwordCookie(session.token)});
 // Switching identities must not leave a previous WeCom identity active.
 headers.append('Set-Cookie',`${process.env.NODE_ENV==='production'?'__Host-suyu_access':'suyu_access'}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`);
 return Response.json({user:accessUser(session.user)},{headers});
}
export async function logoutPassword(request){const token=tokenFrom(request);if(token&&process.env.RD_DATABASE_URL)await auth().logout(token);}
export async function closePasswordRuntime(){const current=pool;pool=undefined;service=undefined;if(current)await current.end();}
