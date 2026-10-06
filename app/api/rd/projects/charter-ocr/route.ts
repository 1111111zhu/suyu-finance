import { recognizeProjectCharter } from "../../../../../database/rd/project-charter-ocr.mjs";
import { assertRdAuthorized, assertSameOrigin, rdError } from "../../_database";

export const runtime = "nodejs";
const supported = new Set([".pdf", ".docx", ".doc", ".png", ".jpg", ".jpeg", ".tif", ".tiff"]);

export async function POST(request: Request) {
  try {
    await assertRdAuthorized(request);
    assertSameOrigin(request);
    const form = await request.formData();
    const file = form.get("document");
    if (!(file instanceof File) || !file.size) throw Object.assign(new Error("请上传立项书文件。"), { code: "RD_VALIDATION" });
    if (file.size > 20 * 1024 * 1024) throw Object.assign(new Error("立项书不能超过 20 MB。"), { code: "RD_VALIDATION" });
    const extension = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    if (!supported.has(extension)) throw Object.assign(new Error("支持 PDF、Word 或常见图片格式。"), { code: "RD_VALIDATION" });
    try {
      const result = await recognizeProjectCharter(Buffer.from(await file.arrayBuffer()), file.name);
      return Response.json({ ...result, ocrStatus: result.extractedText.trim() ? "completed" : "manual", warning: result.extractedText.trim() ? "" : "未识别到文字，请手动填写项目名称、预算和起止日期。" });
    } catch {
      return Response.json({ extractedText: "", fields: { name: "", budget: "", startDate: "", endDate: "" }, ocrStatus: "manual", warning: "本机中文识别未完成，请手动填写项目名称、预算和起止时间。" });
    }
  } catch (error) {
    return rdError(error);
  }
}
