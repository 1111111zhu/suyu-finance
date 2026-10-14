import {Readable} from 'node:stream';
import {readFileSync} from 'node:fs';
import {requireAccess,authResponse} from './session.mjs';
import {payrollActor} from './payroll-tag-actor.mjs';
import {createPool} from '../../database/payroll/pool.mjs';
import {createPayrollHandler} from '../payroll/http.mjs';
import {createPersonnelService} from '../payroll/personnel-service.mjs';
import {createWorkspaceConfirmationService} from '../payroll/workspace-confirmation.mjs';
let pool,handler;
export async function payrollResponse(request){
 const access=await requireAccess(request,'payroll');
 if(new URL(request.url).pathname==='/api/payroll/logout'&&request.method==='POST'&&!access.local){const result=await authResponse(new Request(new URL('/api/auth/logout',request.url),{method:'POST',headers:request.headers}));return Response.json({ok:true,data:{user:null}},{status:result.status,headers:result.headers});}
 if(!process.env.PAYROLL_DATABASE_URL)throw Object.assign(new Error('工资数据库尚未配置'),{status:503});
 if(!pool){pool=createPool({connectionString:process.env.PAYROLL_DATABASE_URL,max:5});pool.on('error',()=>process.stderr.write('Payroll connection interrupted.\n'));}
 if(!handler){
  const corpId=process.env.WECOM_CORP_ID||null;
  const secretFile=process.env.WECOM_SECRET_FILE||process.env.WECOM_APP_SECRET_FILE;
  const personnelService=corpId&&secretFile?createPersonnelService({pool,corpId,appSecret:readFileSync(secretFile,'utf8').trim()}):null;
  handler=createPayrollHandler({pool,publicOrigin:process.env.SUYU_PUBLIC_ORIGIN||'http://127.0.0.1:3220',production:process.env.NODE_ENV==='production',corpId,personnelService,confirmationService:createWorkspaceConfirmationService({pool,corpId}),workspaceAuth:async req=>req.workspaceSession});
 }
 const user=await payrollActor(pool,access);
 const bytes=Buffer.from(await request.arrayBuffer());if(bytes.length>20*1024*1024)throw Object.assign(new Error('文件过大'),{status:413});
 const req=Readable.from(bytes.length?[bytes]:[]);req.url=new URL(request.url).pathname+new URL(request.url).search;req.method=request.method;req.headers=Object.fromEntries(request.headers);req.socket={remoteAddress:'127.0.0.1'};
 req.workspaceSession={user:{id:user.id,username:user.username,displayName:user.display_name},csrfToken:'workspace-origin-protected'};
 return new Promise((resolve,reject)=>{let status=200,headers={},chunks=[];const res={writeHead(s,h){status=s;headers=h},end(data){if(data)chunks.push(Buffer.from(data));resolve(new Response(Buffer.concat(chunks),{status,headers}))},write(data){chunks.push(Buffer.from(data))}};handler(req,res).catch(reject);});
}
