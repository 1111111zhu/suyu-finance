import {rdRepository,rdError,assertRdAuthorized} from '../_database';
export const runtime='nodejs';
export async function GET(request:Request) {
  try {
    await assertRdAuthorized(request);
    const params=new URL(request.url).searchParams;
    const download=params.get('download')==='1';
    const result=await rdRepository().exportResults({startMonth:params.get('startMonth'),endMonth:params.get('endMonth'),scope:params.get('scope')??''},download);
    if(!('content' in result)) return Response.json(result,{headers:{'Cache-Control':'no-store'}});
    return new Response(new Uint8Array(result.content),{headers:{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="rd-results.zip"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  } catch(error) {return rdError(error);}
}
