import {requireAccess} from '../../access/session.mjs';
import {createWorkbookJobs} from './jobs.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(data,status=200)=>Response.json(data,{status,headers});
let runtime;
export const isWorkbookPath=path=>/^\/api\/payroll\/workbooks\//.test(path);
export function createWorkbookResponse({authorize=requireAccess,jobs}={}) {
  return async request=>{
    try {
      const access=await authorize(request,'payroll'),owner=access?.userid;
      if(!owner)return json({error:'请先登录'},401);
      const url=new URL(request.url),parts=url.pathname.slice('/api/payroll/workbooks/'.length).split('/');
      const service=jobs||(runtime??=createWorkbookJobs());
      if(parts[0]==='jobs') {
        if(!/^[a-f0-9-]{36}$/i.test(parts[1]||''))return json({error:'任务编号无效'},400);
        if(parts.length===2&&request.method==='GET')return json(service.get(owner,parts[1]));
        if(parts.length===2&&request.method==='DELETE')return json(service.remove(owner,parts[1]));
        if(parts.length===3&&parts[2]==='result'&&request.method==='GET') {
          const result=service.result(owner,parts[1]);
          return new Response(result.bytes,{headers:{...headers,'Content-Type':result.binary?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/json; charset=utf-8',...(result.filename?{'X-Workbook-Filename':encodeURIComponent(result.filename)}:{})}});
        }
        return json({error:'请求方法不支持'},405);
      }
      let key=parts[0],action=parts[1]||'',revision;
      if(!['roster','salary','files'].includes(key)||parts.length>2)return json({error:'接口不存在'},404);
      if(key==='files') {
        if(!['import','export'].includes(action)||request.method!=='POST')return json({error:'请求方法不支持'},405);
        action='source-'+action;key=url.searchParams.get('key')||'';
      } else if(!action&&request.method==='GET') {
        action='read';revision=url.searchParams.get('revision');
        if(revision&&(!/^\d{1,9}$/.test(revision)||Number(revision)<1))return json({error:'版本号无效'},400);
      } else if(!action&&request.method==='PUT')action='save';
      else if(!(request.method==='POST'&&['import','export','from-rows','original'].includes(action)))return json({error:'请求方法不支持'},405);
      const filename=decodeURIComponent(request.headers.get('X-Workbook-Filename')||'工作簿.xlsx').replace(/[\r\n/\\]/g,'_').slice(0,200);
      if(['import','source-import'].includes(action) && !/\.(xls|xlsx|xlsm|xlsb|xlt|xltx|xltm|xla|xlam|xml|csv)$/i.test(filename))return json({error:'请选择 Excel 或 CSV 文件'},415);
      if(action==='import'&&!/\.xlsx$/i.test(filename))return json({error:'内置编辑器请导入 XLSX 文件'},415);
      const limit=['import','source-import'].includes(action)?20*1024*1024:50*1024*1024;
      if(Number(request.headers.get('content-length'))>limit)return json({error:'文件或工作簿过大'},413);
      const reader=request.body?.getReader(),chunks=[];let size=0;
      if(reader)try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();return json({error:'文件或工作簿过大'},413);}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
      if(action!=='read'&&!size)return json({error:'请求资料不能为空'},400);
      const originalId=url.searchParams.get('id');
      if(action==='original'&&!/^[a-f0-9-]{36}$/i.test(originalId||''))return json({error:'原始文件编号无效'},400);
      return json(service.submit(owner,{access,key,action,revision:revision?Number(revision):undefined,originalId,filename,
        month:url.searchParams.get('month')||'2026-01',stage:url.searchParams.get('stage')==='net'?'net':'gross',bytes:Buffer.concat(chunks)}),202);
    }catch(error){return json({error:error.status&&error.status<500?error.message:'工作簿服务暂不可用，请稍后重试'},error.status||503);}
  };
}
export const workbookResponse=createWorkbookResponse();
