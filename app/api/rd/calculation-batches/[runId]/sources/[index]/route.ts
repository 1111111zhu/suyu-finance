import {assertRdAuthorized,rdError,rdRepository} from '../../../../_database';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{runId:string;index:string}>}) {
 try{
  await assertRdAuthorized(request);const {runId,index}=await context.params;
  if(!/^\d{1,2}$/.test(index))return Response.json({error:'来源文件不存在'},{status:404});
  const file=await rdRepository().batchSources(runId,Number(index));
  return new Response(file.content,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }catch(error){return rdError(error);}
}
