import {getJob,uploadFile,startJob,jobStatus,download} from '../../../../../server/rd/compute.mjs';
import {assertRdAuthorized,assertSameOrigin,rdError,rdRepository} from '../../_database';
export const runtime='nodejs';
type Context={params:Promise<{jobId:string}>};
export async function PUT(request:Request,context:Context){try{const user=await assertRdAuthorized(request);assertSameOrigin(request);const job=getJob((await context.params).jobId,user.userid);return Response.json(await uploadFile(job,request));}catch(error){return rdError(error);}}
export async function POST(request:Request,context:Context){try{const user=await assertRdAuthorized(request);assertSameOrigin(request);return Response.json(await startJob(getJob((await context.params).jobId,user.userid),rdRepository()));}catch(error){return rdError(error);}}
export async function GET(request:Request,context:Context){try{const user=await assertRdAuthorized(request);const job=getJob((await context.params).jobId,user.userid);const index=new URL(request.url).searchParams.get('download');return index===null?Response.json(jobStatus(job),{headers:{'Cache-Control':'no-store'}}):await download(job,Number(index));}catch(error){return rdError(error);}}
