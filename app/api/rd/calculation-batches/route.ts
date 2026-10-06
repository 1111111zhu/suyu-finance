import { rdRepository,rdError,assertRdAuthorized,assertSameOrigin,jsonBody } from "../_database";
export const runtime="nodejs";
export async function POST(request:Request){try{
  await assertRdAuthorized(request);assertSameOrigin(request);
  const limit=84*1024*1024;
  if(Number(request.headers.get('content-length')||0)>limit)throw Object.assign(new Error('归档请求超过大小限制。'),{status:413});
  const reader=request.body?.getReader();if(!reader)return Response.json({error:'缺少请求内容。'},{status:422});
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Object.assign(new Error('归档请求超过大小限制。'),{status:413});}chunks.push(value);}}finally{reader.releaseLock();}
  let input:unknown;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('请求内容格式错误。'),{code:'RD_VALIDATION'});}
  return Response.json(await rdRepository().confirmProjectBatch(input));
}catch(error){return rdError(error);}}
