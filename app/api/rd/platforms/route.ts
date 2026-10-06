import { assertRdAuthorized, rdRepository, rdError } from "../_database";
export const runtime="nodejs";
export async function GET(request: Request){try{await assertRdAuthorized(request);return Response.json({platforms:await rdRepository().listPlatforms()});}catch(error){return rdError(error);}}
