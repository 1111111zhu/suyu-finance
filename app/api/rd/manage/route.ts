import {assertRdAuthorized,assertSameOrigin,jsonBody,rdError,rdRepository} from '../_database';
export const runtime='nodejs';
export async function POST(request:Request) {
  try {await assertRdAuthorized(request);assertSameOrigin(request);await rdRepository().manage(await jsonBody(request));return Response.json({ok:true});}
  catch(error){return rdError(error);}
}
