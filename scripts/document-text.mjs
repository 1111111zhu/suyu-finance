import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import WordExtractor from "word-extractor";

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
  const task = getDocument({ data: new Uint8Array(bytes), disableWorker: true, useSystemFonts: true });
  let pdf;
  const parts = [];
  let characterCount = 0;
  try {
    pdf = await task.promise;
    const pageCount = Math.min(pdf.numPages, Math.max(1, maxPages));
    for (let pageNumber = 1; pageNumber <= pageCount && characterCount < maxCharacters; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = compactWhitespace(content.items.map((item) => "str" in item ? item.str : "").join(" "));
      if (!pageText) continue;
      parts.push(pageText);
      characterCount += pageText.length;
    }
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
    const pageLimit = String(Math.max(1, Math.min(12, maxPages)));
    await execFileAsync("pdftoppm", ["-jpeg", "-r", "200", "-f", "1", "-l", pageLimit, "source.pdf", "page"], {
      cwd: directory,
      maxBuffer: 2 * 1024 * 1024,
    });
    const pages = (await readdir(directory))
      .filter((name) => /^page-\d+\.jpg$/i.test(name))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    const parts = [];
    let characterCount = 0;
    for (const page of pages) {
      if (characterCount >= maxCharacters) break;
      const { stdout } = await execFileAsync("tesseract", [page, "stdout", "-l", "chi_sim+eng", "--psm", "6"], {
        cwd: directory,
        maxBuffer: 2 * 1024 * 1024,
      });
      const text = compactWhitespace(stdout);
      if (!text) continue;
      parts.push(text);
      characterCount += text.length;
    }
    return compactWhitespace(parts.join(" \n")).slice(0, maxCharacters);
  } catch {
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
  return compactWhitespace(sections.filter(Boolean).join(" \n")).slice(0, maxCharacters);
}

export async function extractDocumentText(bytes, type, options = {}) {
  if (type === "pdf") return extractPdfText(bytes, options);
  if (type === "doc" || type === "docx") return extractWordText(bytes, options);
  throw new Error(`Unsupported document type: ${type || "unknown"}`);
}
