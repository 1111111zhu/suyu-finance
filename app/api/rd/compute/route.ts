import {createJob} from '../../../../server/rd/compute.mjs';
import {assertRdAuthorized,assertSameOrigin,rdError} from '../_database';
export const runtime='nodejs';
export async function POST(request:Request){try{const user=await assertRdAuthorized(request);assertSameOrigin(request);return Response.json(await createJob(user.userid));}catch(error){return rdError(error);}}
