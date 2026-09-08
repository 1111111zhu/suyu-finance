import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, access } from "node:fs/promises";
import path from "node:path";
import { officialBody } from "./policy-collection.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const escape = value => String(value || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const titleKey = value => String(value || "").normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");
export function safePublicUrl(value) {
  try { const u = new URL(value); return /^https?:$/.test(u.protocol) && !u.username && !u.password && !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[|172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname) ? u.href : ""; } catch { return ""; }
}
const official = value => { try { return new URL(value).hostname.endsWith(".gov.cn"); } catch { return false; } };

// Require file signatures, not an extension or HTTP 200 error masquerading as a download.
export function fileExtension(bytes, url = "") {
  const b = Buffer.from(bytes);
  if (b.subarray(0, 5).toString() === "%PDF-") return "pdf";
  if (b.subarray(0, 8).equals(Buffer.from([208,207,17,224,161,177,26,225]))) return /\.xls(?:$|[?&])/i.test(decodeURIComponent(url)) ? "xls" : "doc";
  if (b[0] === 80 && b[1] === 75 && b[2] === 3 && b[3] === 4) {
    const names = b.toString("latin1");
    return names.includes("word/document.xml") ? "docx" : names.includes("xl/workbook.xml") ? "xlsx" : "zip";
  }
  return "";
}
export function inspectLinkResponse({ status, text = "", bytes = new Uint8Array(), url, finalUrl = url, title = "", attachment = false }) {
  if (status < 200 || status >= 300) return { ok: false, reason: `HTTP ${status}` };
  const extension = fileExtension(bytes, finalUrl);
  if (extension) return { ok: true, extension };
  if (attachment) return { ok: false, reason: "返回的不是有效附件（可能是错误页或登录页）" };
  const head = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const plain = officialBody(text);
  if (/404|not\s*found|页面不存在|页面未找到|访问出错|访问受限|access denied|forbidden|安全验证|用户登录/i.test(head) || (plain.length < 1500 && /404\s*(not\s*found)?|页面不存在|页面已删除|访问被拒绝|验证码|请先登录/i.test(plain))) return { ok: false, reason: "错误页、登录页或访问验证页" };
  if (new URL(finalUrl).pathname !== new URL(url).pathname && /^\/(?:index\.[a-z]+)?$/.test(new URL(finalUrl).pathname)) return { ok: false, reason: "详情被重定向到首页" };
  if (plain.length < 80 || (title && !titleKey(`${head} ${plain}`).includes(titleKey(title)))) return { ok: false, reason: "正文无法确认与原标题一致" };
  return { ok: true, text: plain };
}

async function fetchChecked(url, { title, attachment, referer, fetchImpl = fetch } = {}) {
  const checkedAt = new Date().toISOString();
  try {
    if (!safePublicUrl(url)) throw new Error("不支持的链接地址");
    let target = url;
    let response;
    const signal = AbortSignal.timeout(20_000);
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!safePublicUrl(target)) throw new Error("重定向到不支持的地址");
      response = await fetchImpl(target, { signal, redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (compatible; PolicyRadar/1.0)", ...(referer ? { referer } : {}) } });
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) { await response.body?.cancel(); target = new URL(response.headers.get("location"), target).href; continue; }
      break;
    }
    if (!response.ok) { await response.body?.cancel(); return { ok: false, reason: `HTTP ${response.status}`, httpStatus: response.status, checkedAt }; }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 20_000_000) throw new Error("文件超过 20 MB，需人工下载"); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks);
    const charset = response.headers.get("content-type")?.match(/charset=["']?([^;"' ]+)/i)?.[1] || "utf-8";
    let text; try { text = new TextDecoder(/gb2312|gbk/i.test(charset) ? "gb18030" : charset).decode(bytes); } catch { text = bytes.toString("utf8"); }
    const result = inspectLinkResponse({ status: response.status, bytes, text, url, finalUrl: target, title, attachment });
    return { ...result, bytes: result.ok ? bytes : undefined, resolvedUrl: result.ok ? target : undefined, checkedAt, httpStatus: response.status };
  } catch (e) { return { ok: false, checkedAt, reason: e.name === "TimeoutError" ? "访问超时" : e.message }; }
}

export function replacementUrls(doc, candidates = []) {
  const list = [];
  if (doc.url.startsWith("http://")) list.push(doc.url.replace(/^http:/, "https:"));
  // Only observed official records with the exact title. Never guess a URL or substitute a related year's notice.
  for (const c of candidates) if (c.url !== doc.url && official(c.url) && titleKey(c.title) === titleKey(doc.title)) list.push(c.url);
  return [...new Set(list)].slice(0, 8);
}

// Shared display template: refreshing links must not reintroduce extracted body text.
export function renderPolicySourcePage(p) {
  const link = (url, label) => safePublicUrl(url) || /^\/policy-sources\/[a-f0-9]+\.(?:pdf|docx?|xlsx?|zip)$/.test(url || "") ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>` : escape(label);
  const item = (d, index) => {
    const h = d.linkHealth;
    return `<li>${escape(d.title || `申报附件 ${index + 1}`)}：${h?.localUrl ? link(h.localUrl, "打开已保存文件") : h?.resolvedUrl ? link(h.resolvedUrl, "打开已校验链接") : "暂无法打开"}${h?.status === "unavailable" ? `<strong>原站异常：${escape(h.reason)}；${h.localUrl ? "此文件为历史副本，请核对版本" : "文件尚未取得"}</strong>` : ""}</li>`;
  };
  const documents = [...(p.linkHealth?.localUrl ? [{ title: "原文件副本", linkHealth: p.linkHealth }] : []), ...(p.attachments || []), ...(p.relatedDocuments || [])];
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(p.title)} · 原文查阅</title><style>body{max-width:960px;margin:36px auto;padding:0 24px;font:17px/1.8 system-ui;color:#173e35}a{color:#087c58}h1{font-size:28px;overflow-wrap:anywhere}aside{background:#edf6f2;padding:18px;border-radius:12px}li{margin:12px 0;overflow-wrap:anywhere}strong{display:block;color:#91592d}</style><a href="/policy">← 返回项目申报</a><h1>${escape(p.title)}</h1><aside>${link(p.linkHealth?.resolvedUrl || p.url, "打开官方来源")}</aside><h2>附件与相关文件</h2><ul>${documents.map(item).join("") || "<li>暂未取得附件</li>"}</ul></html>`;
}

export async function auditPolicyLinks(payload, { candidates = [], root = process.cwd(), fetchImpl = fetch } = {}) {
  const directory = path.join(root, "public/policy-sources");
  const manifestPath = path.join(directory, "manifest.json");
  await mkdir(directory, { recursive: true });
  let previous = {}; try { previous = JSON.parse(await readFile(manifestPath, "utf8")); } catch { /* First run. */ }
  const manifest = { ...previous }, memo = new Map();
  const localExists = async url => /^\/policy-sources\/[a-f0-9]+\.(?:pdf|docx?|xlsx?|zip)$/.test(url || "") && await access(path.join(root, "public", url)).then(() => true, () => false);
  async function check(doc, attachment = false, referer = "") {
    const key = `${attachment ? "file" : titleKey(doc.title)}|${doc.url}`;
    if (memo.has(key)) return memo.get(key);
    const task = (async () => {
      const original = await fetchChecked(doc.url, { title: doc.title, attachment, referer, fetchImpl });
      let result = original;
      if (!result.ok) for (const alternate of replacementUrls(doc, attachment ? [] : candidates)) {
        const attempt = await fetchChecked(alternate, { title: doc.title, attachment, referer, fetchImpl });
        if (attempt.ok) { result = attempt; break; }
      }
      const stored = previous[hash(key)];
      const metadata = { status: result.ok ? original.ok ? "available" : "repaired" : "unavailable", checkedAt: result.checkedAt, originalUrl: doc.url, resolvedUrl: result.resolvedUrl, originalError: original.ok ? undefined : original.reason, reason: result.ok ? undefined : result.reason, httpStatus: original.httpStatus };
      if (result.ok && result.extension) {
        const filename = `${hash(result.bytes)}.${result.extension}`;
        await writeFile(path.join(directory, filename), result.bytes);
        metadata.localUrl = `/policy-sources/${filename}`;
        metadata.savedAt = result.checkedAt;
      } else if (await localExists(stored?.localUrl)) { metadata.localUrl = stored.localUrl; metadata.savedAt = stored.savedAt; }
      manifest[hash(key)] = metadata;
      return { metadata, text: result.ok ? result.text : undefined };
    })();
    memo.set(key, task); return task;
  }
  let cursor = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < payload.policies.length) {
      const p = payload.policies[cursor++];
      const main = await check(p);
      p.linkHealth = main.metadata;
      for (const d of p.attachments || []) d.linkHealth = (await check(d, true, p.url)).metadata;
      for (const d of p.relatedDocuments || []) d.linkHealth = (await check(d)).metadata;
      const file = `${hash(p.id)}.html`;
      p.sourceReaderUrl = `/policy-sources/${file}`;
      const html = renderPolicySourcePage(p);
      await writeFile(path.join(directory, file), html);
      console.log(`链接校验：${p.id} ${main.metadata.status}`);
    }
  }));
  const documents = payload.policies.flatMap(p => [p, ...(p.attachments || []), ...(p.relatedDocuments || [])]);
  payload.linkAudit = { checkedAt: new Date().toISOString(), total: documents.length, available: documents.filter(d => d.linkHealth?.status === "available").length, repaired: documents.filter(d => d.linkHealth?.status === "repaired").length, unavailable: documents.filter(d => d.linkHealth?.status === "unavailable").length, savedFiles: documents.filter(d => d.linkHealth?.localUrl).length };
  await writeFile(`${manifestPath}.tmp`, JSON.stringify(manifest)); await rename(`${manifestPath}.tmp`, manifestPath);
  return payload;
}
