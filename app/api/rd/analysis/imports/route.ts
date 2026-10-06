import { parseAnalysisWorkbook } from "../../../../../database/rd/analysis-import.mjs";
import { assertRdAuthorized, assertSameOrigin, rdError, rdRepository } from "../../_database";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await assertRdAuthorized(request);
    assertSameOrigin(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw Object.assign(new Error("请选择 .xlsx 历史测算结果文件。"), { code: "RD_ANALYSIS_VALIDATION" });
    if (file.size > 20 * 1024 * 1024) throw Object.assign(new Error("请选择不超过 20 MB 的 Excel 结果文件。"), { code: "RD_ANALYSIS_VALIDATION" });
    const parsed = parseAnalysisWorkbook(Buffer.from(await file.arrayBuffer()), file.name);
    if (form.get("action") === "preview") return Response.json({ preview: parsed }, { headers: { "Cache-Control": "no-store" } });
    if (form.get("action") !== "import") throw Object.assign(new Error("无效的导入操作。"), { code: "RD_ANALYSIS_VALIDATION" });
    if (form.get("sha256") !== parsed.sha256) throw Object.assign(new Error("文件内容已变化，请重新预览。"), { code: "RD_ANALYSIS_VALIDATION" });
    const year = Number(form.get("year"));
    const month = Number(form.get("month"));
    const result = await rdRepository().importAnalysisWorkbook({
      parsed,
      scope: form.get("scope"),
      year,
      month,
      acknowledged: form.get("acknowledged") === "true",
    });
    return Response.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return rdError(error); }
}
