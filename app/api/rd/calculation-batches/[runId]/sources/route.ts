import {assertRdAuthorized,rdError,rdRepository} from '../../../_database';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{runId:string}>}) {
 try{await assertRdAuthorized(request);const {runId}=await context.params;return Response.json(await rdRepository().batchSources(runId),{headers:{'Cache-Control':'no-store'}});}catch(error){return rdError(error);}
}
