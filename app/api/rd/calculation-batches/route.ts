import { rdRepository,rdError,assertRdAuthorized,assertSameOrigin,jsonBody } from "../_database";
export const runtime="nodejs";
export async function POST(request:Request){try{assertRdAuthorized(request);assertSameOrigin(request);return Response.json(await rdRepository().recordProjectBatch(await jsonBody(request)));}catch(error){return rdError(error);}}
