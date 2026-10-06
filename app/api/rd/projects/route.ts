import { createHash } from "node:crypto";
import { assertRdAuthorized, assertSameOrigin, jsonBody, rdError, rdRepository } from "../_database";

export const runtime = "nodejs";
const charterExtensions = new Set([".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg", ".tif", ".tiff"]);

export async function GET(request: Request) {
  try { await assertRdAuthorized(request); return Response.json({ projects: await rdRepository().listProjects() }); } catch (error) { return rdError(error); }
}

export async function POST(request: Request) {
  try {
    await assertRdAuthorized(request);
    assertSameOrigin(request);
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("document");
      if (!(file instanceof File) || !file.size) throw Object.assign(new Error("请上传立项书文件。"), { code: "RD_VALIDATION" });
      if (file.size > 20 * 1024 * 1024) throw Object.assign(new Error("立项书不能超过 20 MB。"), { code: "RD_VALIDATION" });
      const extension = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
      if (!charterExtensions.has(extension)) throw Object.assign(new Error("支持 PDF、Word 或常见图片格式。"), { code: "RD_VALIDATION" });
      const buffer = Buffer.from(await file.arrayBuffer());
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const project = await rdRepository().createProject({
        number: String(form.get("number") || ""),
        name: String(form.get("name") || ""),
        platformId: String(form.get("platformId") || ""),
        budget: Number(form.get("budget")),
        status: "init",
        startDate: String(form.get("startDate") || "") || null,
        endDate: String(form.get("endDate") || "") || null,
        document: {
          filename: file.name || "立项书",
          sha256,
          mimeType: file.type || "application/octet-stream",
          content: buffer,
          extractedText: String(form.get("extractedText") || "").slice(0,100000),
          ocrStatus: String(form.get("ocrStatus") || "") === "completed" ? "completed" : "manual",
        },
      });
      return Response.json({ project }, { status: 201 });
    }
    return Response.json({ project: await rdRepository().createProject(await jsonBody(request)) }, { status: 201 });
  } catch (error) { return rdError(error); }
}
