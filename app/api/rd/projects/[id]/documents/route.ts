import { assertRdAuthorized, rdError, rdRepository } from "../../../_database";

export const runtime = "nodejs";
type Context={params:Promise<{id:string}>};

export async function GET(request:Request,context:Context){
  try{await assertRdAuthorized(request);return Response.json({documents:await rdRepository().listProjectDocuments((await context.params).id)});}
  catch(error){return rdError(error);}
}
