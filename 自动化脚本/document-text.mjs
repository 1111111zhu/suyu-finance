import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import WordExtractor from "word-extractor";
import { unzipSync, strFromU8 } from "fflate";

const execFileAsync = promisify(execFile);

const documentMimeTypes = new Map([
  ["application/pdf", "pdf"],
  ["application/msword", "doc"],
  ["application/vnd.ms-word", "doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
]);

const compactWhitespace = (value = "") => String(value).replace(/\u0000/g, " ").replace(/\s+/g, " ").trim();

function startsWithBytes(bytes, signature) {
  if (!bytes || bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

export function detectDocumentType(url = "", contentType = "", bytes = null) {
  if (bytes?.length) {
    if (startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
    if (startsWithBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "doc";
    if (startsWithBytes(bytes, [0x50, 0x4b])) {
      const probe = Buffer.from(bytes).toString("latin1");
      if (probe.includes("word/document.xml")) return "docx";
      if (probe.includes("xl/workbook.xml")) return "xlsx";
    }
    const prefix = Buffer.from(bytes.subarray(0, 256)).toString("utf8").trimStart().toLowerCase();
    if (prefix.startsWith("<!doctype html") || prefix.startsWith("<html")) return "";
  }
  const mime = String(contentType).split(";", 1)[0].trim().toLowerCase();
  if (documentMimeTypes.has(mime)) return documentMimeTypes.get(mime);
  try {
    const pathname = new URL(url, "https://example.invalid").pathname.toLowerCase();
    if (pathname.endsWith(".pdf")) return "pdf";
    if (pathname.endsWith(".docx")) return "docx";
    if (pathname.endsWith(".doc")) return "doc";
  } catch {
    const clean = String(url).split(/[?#]/, 1)[0].toLowerCase();
    if (clean.endsWith(".pdf")) return "pdf";
    if (clean.endsWith(".docx")) return "docx";
    if (clean.endsWith(".doc")) return "doc";
  }
  return "";
}

async function extractPdfNativeText(bytes, { maxPages = 80, maxCharacters = 120_000 } = {}) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfAssets = path.dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")));
  const task = getDocument({ data: new Uint8Array(bytes), disableWorker: true, useSystemFonts: true, verbosity: 0, cMapUrl: path.join(pdfAssets, "cmaps/"), cMapPacked: true, standardFontDataUrl: path.join(pdfAssets, "standard_字体/") });
  let pdf;
  const parts = [];
  let characterCount = 0;
  try {
    pdf = await task.promise;
    if (pdf.numPages > maxPages) throw Object.assign(new Error(`PDF 共 ${pdf.numPages} 页，超过本轮解析额度；保留续查`), { code: "DOCUMENT_LIMIT" });
    const pageCount = Math.min(pdf.numPages, Math.max(1, maxPages));
    for (let pageNumber = 1; pageNumber <= pageCount && characterCount < maxCharacters; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = compactWhitespace(content.items.map((item) => "str" in item ? item.str : "").join(" "));
      if (!pageText) throw Object.assign(new Error(`PDF 第 ${pageNumber} 页无文字层，须逐页 OCR 核验，不能把其余页当完整正文`), { code: 'OCR_REQUIRED' });
      parts.push(pageText);
      characterCount += pageText.length;
    }
    if (characterCount >= maxCharacters) throw Object.assign(new Error("PDF 正文超过解析额度，不能标记完整"), { code: "DOCUMENT_LIMIT" });
  } finally {
    if (pdf) await task.destroy();
  }
  return compactWhitespace(parts.join(" \n")).slice(0, maxCharacters);
}

async function extractPdfOcrText(bytes, { maxPages = 12, maxCharacters = 120_000 } = {}) {
  if (process.env.POLICY_DOCUMENT_OCR === "0") return "";
  const directory = await mkdtemp(path.join(tmpdir(), "policy-ocr-"));
  try {
    await writeFile(path.join(directory, "source.pdf"), bytes);
    const {stdout:info} = await execFileAsync('pdfinfo',['source.pdf'],{cwd:directory,maxBuffer:1024*1024});
    const count = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
    if (!count || count > maxPages) throw Object.assign(new Error(`OCR 页数 ${count || '未知'} 超过可核实范围，保留续查`),{code:'DOCUMENT_LIMIT'});
    const pageLimit = String(Math.max(1, maxPages));
    await execFileAsync("pdftoppm", ["-jpeg", "-r", "200", "-f", "1", "-l", pageLimit, "source.pdf", "page"], {
      cwd: directory,
      maxBuffer: 2 * 1024 * 1024,
    });
    const pages = (await readdir(directory))
      .filter((name) => /^page-\d+\.jpg$/i.test(name))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    const parts = [];
    let characterCount = 0;
    if (pages.length !== count) throw Object.assign(new Error('OCR 页数不完整，保留续查'),{code:'DOCUMENT_LIMIT'});
    for (const page of pages) {
      if (characterCount >= maxCharacters) throw Object.assign(new Error('OCR 正文超过解析额度'),{code:'DOCUMENT_LIMIT'});
      const { stdout } = await execFileAsync("tesseract", [page, "stdout", "-l", "chi_sim+eng", "--psm", "6"], {
        cwd: directory,
        maxBuffer: 2 * 1024 * 1024,
      });
      const text = compactWhitespace(stdout);
      if (!text) throw Object.assign(new Error(`OCR 未能读取 ${page}，不能标记完整`),{code:'DOCUMENT_LIMIT'});
      parts.push(text);
      characterCount += text.length;
    }
    if (characterCount >= maxCharacters) throw Object.assign(new Error('OCR 正文超过解析额度'),{code:'DOCUMENT_LIMIT'});
    return compactWhitespace(parts.join(" \n"));
  } catch (error) {
    if (error.code === 'DOCUMENT_LIMIT') throw error;
    // OCR is a best-effort fallback. The caller retains the usual unparsed
    // state when the host has not installed its optional native tools.
    return "";
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

async function extractPdfText(bytes, options = {}) {
  let nativeError;
  try {
    const text = await extractPdfNativeText(bytes, options);
    if (text) return text;
  } catch (error) {
    if (error.code === "DOCUMENT_LIMIT") throw error;
    nativeError = error;
  }
  const ocrText = await extractPdfOcrText(bytes, options);
  if (ocrText) return ocrText;
  if (nativeError) throw nativeError;
  return "";
}

async function extractWordText(bytes, { maxCharacters = 120_000 } = {}) {
  const extractor = new WordExtractor();
  const document = await extractor.extract(Buffer.from(bytes));
  const sections = [
    document.getBody(),
    document.getHeaders(),
    document.getFooters(),
    document.getFootnotes(),
    document.getEndnotes(),
    document.getTextboxes(),
  ];
  const text = compactWhitespace(sections.filter(Boolean).join(" \n"));
  if (text.length > maxCharacters) throw new Error("Word 正文超过解析额度，保留续查");
  return text;
}

export async function extractDocumentText(bytes, type, options = {}) {
  if (type === "pdf") return extractPdfText(bytes, options);
  if (type === "doc" || type === "docx") return extractWordText(bytes, options);
  if (type === "xlsx") {
    const entries = unzipSync(bytes);
    const plain = value => String(value || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
    const stringsXml = entries["xl/sharedStrings.xml"] ? strFromU8(entries["xl/sharedStrings.xml"]) : "";
    const strings = [...stringsXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => plain(m[1]));
    const text = Object.entries(entries).filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).map(([name, content]) => {
      const xml = strFromU8(content);
      return name + "\n" + [...xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map(m => {
        const v = m[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] || "";
        return /\bt="s"/.test(m[1]) ? strings[Number(v)] || "" : /\bt="inlineStr"/.test(m[1]) ? plain(m[2]) : plain(v);
      }).join(" ");
    }).join("\n");
    if (text.length > (options.maxCharacters || 120_000)) throw new Error("Excel 附件超过解析额度，保留续查");
    return text;
  }
  throw new Error(`Unsupported document type: ${type || "unknown"}`);
}
