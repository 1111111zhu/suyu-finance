import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { detectDocumentType, extractDocumentText } from "../自动化脚本/document-text.mjs";

function minimalDocx(text) {
  const files = {
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)])));
}

function minimalPdf(text) {
  const objects = [
    null,
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length + 35} >>\nstream\nBT /F1 18 Tf 30 80 Td (${text}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = Buffer.byteLength(pdf);
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test("PDF 和 Word 直链可按内容魔数识别并提取正文", async () => {
  const docx = minimalDocx("氢能项目申报条件测试");
  const pdf = minimalPdf("Hydrogen policy test");
  assert.equal(detectDocumentType("download", "application/octet-stream", docx), "docx");
  assert.equal(detectDocumentType("download", "application/octet-stream", pdf), "pdf");
  assert.match(await extractDocumentText(docx, "docx"), /氢能项目申报条件/);
  assert.match(await extractDocumentText(pdf, "pdf"), /Hydrogen policy test/);
});

test("HTML 响应不会因 URL 伪装成 PDF 而误解析", () => {
  const html = Buffer.from("<!doctype html><html><body>error page</body></html>");
  assert.equal(detectDocumentType("https://example.gov.cn/file.pdf", "text/html", html), "");
});
test('PDF 字数限额不得截断后冒充完整正文',async()=>{
  await assert.rejects(extractDocumentText(minimalPdf('Long application guide for all items'),'pdf',{maxCharacters:10}),/额度/);
});
test('PDF 无文字页且未启用 OCR 必须保持未完整读取',async()=>{
  const previous=process.env.POLICY_DOCUMENT_OCR;
  process.env.POLICY_DOCUMENT_OCR='0';
  try {await assert.rejects(extractDocumentText(minimalPdf(''),'pdf'),/无文字层/);}
  finally {if(previous===undefined)delete process.env.POLICY_DOCUMENT_OCR;else process.env.POLICY_DOCUMENT_OCR=previous;}
});
