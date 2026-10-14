import { recognizeCostImage, IMAGE_LIMIT } from "../../../../database/rd/cost-image-ocr.mjs";
import { assertRdAuthorized, assertSameOrigin, rdError } from "../_database";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await assertRdAuthorized(request);
    assertSameOrigin(request);
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > IMAGE_LIMIT + 128 * 1024) return Response.json({error:"图片不能超过 50 MB。"},{status:413});
    let form: FormData;
    try {
      const reader=request.body?.getReader();if(!reader)throw new Error("empty");
      const chunks:Uint8Array[]=[];let size=0;
      try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>IMAGE_LIMIT+128*1024){await reader.cancel();return Response.json({error:"图片不能超过 50 MB。"},{status:413});}chunks.push(value);}}finally{reader.releaseLock();}
      form=await new Response(Buffer.concat(chunks),{headers:{"Content-Type":request.headers.get("content-type")||""}}).formData();
    } catch { return Response.json({error:"请使用图片上传表单。"},{status:422}); }
    const file = form.get("image"), kind = form.get("kind");
    if (!(file instanceof File) || !file.size || file.size > IMAGE_LIMIT) return Response.json({error:"请上传不超过 50 MB 的图片。"},{status:422});
    if (!['image/png','image/jpeg','image/webp'].includes(file.type)) return Response.json({error:"支持 PNG、JPEG 或 WebP 图片。"},{status:422});
    const result = await recognizeCostImage(Buffer.from(await file.arrayBuffer()), String(kind));
    return Response.json(result, {headers:{"Cache-Control":"no-store"}});
  } catch (error) { return rdError(error); }
}
