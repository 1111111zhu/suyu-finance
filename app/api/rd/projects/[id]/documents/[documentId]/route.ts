import { assertRdAuthorized, rdError, rdRepository } from "../../../../_database";

export const runtime = "nodejs";
type Context={params:Promise<{id:string;documentId:string}>};

export async function GET(request:Request,context:Context){
  try{
    await assertRdAuthorized(request);
    const {id,documentId}=await context.params,document=await rdRepository().getProjectDocument(id,documentId);
    const filename=String(document.filename).replace(/[\r\n"\\]/g,"_");
    return new Response(document.content,{headers:{"Content-Type":document.mime_type,"Content-Disposition":`inline; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(document.filename)}`,"Cache-Control":"no-store"}});
  }catch(error){return rdError(error);}
}
