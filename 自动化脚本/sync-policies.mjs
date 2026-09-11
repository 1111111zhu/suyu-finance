import { access, copyFile, cp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { extractApplicationTiming } from "./policy-time.mjs";
import { auditPolicies } from "./policy-matcher.mjs";
import { officialBody, parseSushangIndex, collectPagedRecords } from "./policy-collection.mjs";
import { detectDocumentType, extractDocumentText } from "./document-text.mjs";
import { assertViablePolicyFeed, buildPolicyFeed } from "./policy-feed.mjs";
import { auditPolicyLinks } from "./policy-links.mjs";
import { DISCOVERY_SIGNAL, PARSER_VERSION, inferPolicyRegion, originalBinding, reviewQueue } from './policy-integrity.mjs';
import { policyWatchlist, additionalFundingSources } from '../数据配置/policy-watchlist.mjs';
import { pathToFileURL } from 'node:url';
import {candidateContentHash, expandApplicationItems} from './policy-records.mjs';
import { assertPolicyRulesLoaded, loadPolicyRules } from "./policy-rules.mjs";
export {candidateContentHash} from './policy-records.mjs';

const outputPath = path.resolve(process.cwd(), "public/policies.json");
const deployedOutputPath = path.resolve(process.cwd(), "dist/client/policies.json");
const companyProfilePath = path.resolve(process.cwd(), "public/company-profile.json");
const keywords = DISCOVERY_SIGNAL;
const sourceProgress = new Map();
const completedActivityPattern = /(?:成功举办|圆满举办|顺利举办|活动回顾|工作动态|经验交流|会议纪要)/;
const applicationDocumentPattern = /(?:项目申报|申报指南|申报主体|申报条件|申报要求|申请条件|申请主体|征集公告|申报通知|受理时间)/;

function paginatedListUrls(url, pages) {
  const match = url.match(/^(.*\/)([^/?#]+)(\.[a-z]+)$/i);
  if (!match) return [url];
  return [url, ...Array.from({ length: Math.max(0, pages - 1) }, (_, index) => `${match[1]}${match[2]}_${index + 1}${match[3]}`)];
}

const htmlSources = [
  ...additionalFundingSources,
  { id: "national", name: "国务院政策文件库", region: "国家", level: "国家级", url: "https://www.gov.cn/zhengce/zhengceku/bmwj/home.htm" },
  { id: "ndrc-notices", name: "国家发展改革委通知公告", region: "国家", level: "国家级", url: "https://www.ndrc.gov.cn/xwdt/tzgg/" },
  { id: "ndrc-circulars", name: "国家发展改革委通知", region: "国家", level: "国家级", url: "https://www.ndrc.gov.cn/xxgk/zcfb/tz/" },
  { id: "nsfc", name: "国家自然科学基金委员会业务资讯", region: "国家", level: "国家级", url: "https://www.nsfc.gov.cn/p1/" },
  { id: "miit-scitech", name: "工业和信息化部科技司", region: "国家", level: "国家级", url: "https://www.miit.gov.cn/jgsj/kjs/index.html" },
  { id: "miit-operation", name: "工业和信息化部运行监测协调局", region: "国家", level: "国家级", url: "https://www.miit.gov.cn/jgsj/yxj/index.html" },
  { id: "miit-energy", name: "工业和信息化部节能与综合利用司", region: "国家", level: "国家级", url: "https://www.miit.gov.cn/jgsj/jns/index.html" },
  { id: "zhejiang", name: "浙江省行政规范性文件数据库", region: "浙江省", level: "省级", url: "https://zjsftbascweb.zjsft.gov.cn/data/" },
  { id: "zhejiang-scitech", name: "浙江省科学技术厅通知通告", region: "浙江省", level: "省级", url: "https://kjt.zj.gov.cn/col/col1229225203/index.html" },
  { id: "zhejiang-miit", name: "浙江省经济和信息化厅通知", region: "浙江省", level: "省级", url: "https://jxt.zj.gov.cn/col/col1582899/index.html" },
  { id: "zhejiang-enterprise", name: "浙江省企业之家", region: "浙江省", level: "省级", url: "https://zj87.jxt.zj.gov.cn/" },
  { id: "hangzhou", name: "杭州市人民政府公报", region: "杭州市", level: "市级", url: "https://zfgb.hangzhou.gov.cn/" },
  { id: "hangzhou-scitech", name: "杭州市科学技术局", region: "杭州市", level: "市级", url: "https://sti.kj.hangzhou.gov.cn/" },
  { id: "jiangsu-scitech", name: "江苏省科学技术厅通知公告", region: "江苏省", level: "省级", url: "https://kxjst.jiangsu.gov.cn/col/col82540/index.html" },
  { id: "jiangsu-miit", name: "江苏省工业和信息化厅文件通知", region: "江苏省", level: "省级", url: "https://gxt.jiangsu.gov.cn/col/col6278/index.html" },
  { id: "suzhou-scitech", name: "苏州市科学技术局通知公告", region: "苏州市", level: "市级", urls: paginatedListUrls("https://kjj.suzhou.gov.cn/szkj/tzgg/common_list.shtml", 3) },
  { id: "suzhou-miit-notices", name: "苏州市工业和信息化局公告", region: "苏州市", level: "市级", urls: paginatedListUrls("https://gxj.suzhou.gov.cn/szeic/ggl/common_list.shtml", 3) },
  { id: "suzhou-miit-planning", name: "苏州市工业和信息化局综合规划", region: "苏州市", level: "市级", urls: paginatedListUrls("https://gxj.suzhou.gov.cn/szeic/zhgh/list.shtml", 3) },
  { id: "suzhou-miit-innovation", name: "苏州市工业和信息化局技术创新", region: "苏州市", level: "市级", urls: paginatedListUrls("https://gxj.suzhou.gov.cn/szeic/jscx/list.shtml", 3) },
  { id: "suzhou-miit-investment", name: "苏州市工业和信息化局技改投资", region: "苏州市", level: "市级", urls: paginatedListUrls("https://gxj.suzhou.gov.cn/szeic/tzyjsgz/list.shtml", 3) },
  { id: "suzhou-miit-energy", name: "苏州市工业和信息化局节能综合利用", region: "苏州市", level: "市级", urls: paginatedListUrls("https://gxj.suzhou.gov.cn/szeic/jnyzhly/list.shtml", 3) },
  { id: "suzhou-miit-enterprise", name: "苏州市工业和信息化局企业服务", region: "苏州市", level: "市级", urls: paginatedListUrls("https://gxj.suzhou.gov.cn/szeic/qyfw/list.shtml", 3) },
  { id: "suzhou-ndrc", name: "苏州市发展和改革委员会公告", region: "苏州市", level: "市级", urls: paginatedListUrls("https://fg.suzhou.gov.cn/szfgw/ggl/nav_list.shtml", 4) },
  { id: "suzhou-market", name: "苏州市市场监督管理局通知", region: "苏州市", level: "市级", urls: ["https://scjgj.suzhou.gov.cn/szqts/xwtz/nav_xwtz.shtml", "https://scjgj.suzhou.gov.cn/szqts/xwtz/nav_xwtz_2.shtml", "https://scjgj.suzhou.gov.cn/szqts/xwtz/nav_xwtz_3.shtml", "https://scjgj.suzhou.gov.cn/szqts/xwtz/nav_xwtz_4.shtml"] },
  { id: "suzhou-commerce", name: "苏州市商务局通知公告", region: "苏州市", level: "市级", urls: paginatedListUrls("https://commerce.suzhou.gov.cn/szsswj/tzgg/list.shtml", 3) },
  { id: "wujiang-scitech", name: "苏州市吴江区科技创新公开信息", region: "苏州市", level: "区级", urls: paginatedListUrls("https://www.wujiang.gov.cn/zgwj/kjcs/xxgk_list.shtml", 8) },
  { id: "jiangsu", name: "江苏省人民政府文件", region: "江苏省", level: "省级", url: "https://www.jiangsu.gov.cn/col/col76841/index.html" },
  { id: "lianyungang", name: "连云港市政府规范性文件", region: "连云港市", level: "市级", url: "https://www.lyg.gov.cn/zglygzfmhwz/szfgfxwj1/szfgfxwj1.shtml" },
  { id: "lianyungang-scitech", name: "连云港市科学技术局通知公告", region: "连云港市", level: "市级", url: "http://kjj.lyg.gov.cn/lygskxjsj/tzgg/tzgg.html" },
  { id: "lianyungang-projects", name: "连云港市政府科技项目", region: "连云港市", level: "市级", url: "https://www.lyg.gov.cn/zglygzfmhwz/kjxm/kjxm.shtml" },
  { id: "lianyungang-market", name: "连云港市市场监督管理局通知", region: "连云港市", level: "市级", url: "https://www.lyg.gov.cn/zglygzfmhwz/sczrjjg/sczrjjg.html" },
];

const jiangsuStructuredSources = [
  { id: "jiangsu-scitech-xml", name: "江苏省科学技术厅结构化通知", region: "江苏省", level: "省级", host: "https://kxjst.jiangsu.gov.cn", listPath: "/col/col82540/index.html", webId: "89", columnId: "82540", unitId: "345950", webName: "江苏省科学技术厅", pages: 4 },
  { id: "jiangsu-miit-xml", name: "江苏省工业和信息化厅结构化通知", region: "江苏省", level: "省级", host: "https://gxt.jiangsu.gov.cn", listPath: "/col/col6278/index.html", webId: "23", columnId: "6278", unitId: "403981", webName: "江苏省工业和信息化厅", pages: 4 },
  { id: "jiangsu-ndrc-xml", name: "江苏省发展和改革委员会结构化通知", region: "江苏省", level: "省级", host: "https://fzggw.jiangsu.gov.cn", listPath: "/col/col284/index.html", webId: "3", columnId: "284", unitId: "423656", webName: "江苏省发展和改革委员会", pages: 2 },
  { id: "jiangsu-ip-xml", name: "江苏省知识产权局结构化通知", region: "江苏省", level: "省级", host: "https://jsip.jiangsu.gov.cn", listPath: "/col/col85036/index.html", webId: "16", columnId: "85036", unitId: "360321", webName: "江苏省知识产权局", pages: 2 },
];

function decode(value = "") {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim();
}

function normalizeUrl(raw, base) {
  try {
    const url = new URL(raw, base);
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

// The table must always open a reader-facing official document or webpage.
// Structured API responses are useful to collect records, but are not an
// "original document" and render as unreadable JSON in a browser.
function isReadableOriginalUrl(raw) {
  const url = normalizeUrl(raw, "https://www.qyfw.suzhou.com.cn/");
  return /^https?:\/\//.test(url) && !/\/gateway\/.*\/api\//i.test(url) && !/\.json(?:$|[?#])/i.test(url);
}

function suzhouOriginalUrl(detail) {
  const attachments = Array.isArray(detail.attachments) ? detail.attachments : [];
  const originalAttachment = attachments.find((attachment) => /(点击正文|原文|正文|通知全文|申报指南)/.test(String(attachment.name || "")) && isReadableOriginalUrl(attachment.url));
  if (originalAttachment) return normalizeUrl(originalAttachment.url, "https://www.qyfw.suzhou.com.cn/");

  // Some notices put an official original link in the body rather than in
  // attachments. Only accept links explicitly labelled as the original text.
  const content = String(detail.content || "");
  for (const match of content.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (/(原文|正文|通知全文|申报指南)/.test(decode(match[2])) && isReadableOriginalUrl(match[1])) {
      return normalizeUrl(match[1], "https://www.qyfw.suzhou.com.cn/");
    }
  }
  return "";
}

function stableId(sourceId, url, title) {
  let hash = 2166136261;
  for (const char of `${sourceId}|${url}|${title}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${sourceId}-${(hash >>> 0).toString(16)}`;
}

function findDate(text) {
  const match = text.match(/(20\d{2})[年.\/-](\d{1,2})[月.\/-](\d{1,2})日?/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function findDeadlineInfo(text) {
  // Word often splits one date across multiple text runs (for example "202 6 年").
  // Whitespace is not meaningful for deadline recognition, so remove it here.
  const compact = decode(text).replace(/\s+/g, "");
  const deadlinePatterns = [
    /(?:截至|截止(?:时间)?(?:为|至|到)?|申报时间|受理时间|系统关闭)[^。；]{0,60}(20\d{2}[年.\/-]\d{1,2}[月.\/-]\d{1,2}日?)(?:\s*(\d{1,2})[:：](\d{2}))?/g,
    /(?:请(?:各?单位|申报单位|报送单位)?|(?:各?单位|申报单位|报送单位))?于(20\d{2}[年.\/-]\d{1,2}[月.\/-]\d{1,2}日?)前(?:扫描|通过|登录|在线|按|完成|报送|提交|填报|申报|将|。|，|,|$)/g,
  ];
  const matches = deadlinePatterns.flatMap((pattern) => [...compact.matchAll(pattern)].map((match) => ({ date: findDate(match[1]), time: match[2] ? `${match[2].padStart(2, "0")}:${match[3]}` : "" }))).filter((value) => value.date);
  const ranges = [...compact.matchAll(/(?:企业|单位|申报主体|申报单位|填报主体)?(?:于|自)?(20\d{2})年(\d{1,2})月(\d{1,2})日?(?:至|到|[-—~～])(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日?[^。；]{0,48}?(?:填报|申报|申请|提交|上传|报送|办理|登录)/g)]
    .map((match) => ({ date: `${match[4] || match[1]}-${match[5].padStart(2, "0")}-${match[6].padStart(2, "0")}`, time: "" }));
  matches.push(...ranges);
  if (matches.length) return matches.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).at(-1);

  // Formal notices often state the year once in the title and later write only
  // “6月25日24:00 截止”.  When the same original contains exactly one usable
  // document year, attach it to that explicit deadline rather than treating a
  // clearly expired window as unknown.
  const yearMatches = [...compact.matchAll(/20\d{2}/g)].map((match) => match[0]);
  // A notice may quote older standards or policy history. Its issue date is
  // conventionally at the end of the official text, so use the final explicit
  // year as the document year for a deadline that omits its own year.
  const documentYear = yearMatches.at(-1);
  if (!documentYear) return { date: "", time: "" };
  const partials = [...compact.matchAll(/(?:截至|截止(?:时间)?(?:为|至|到)?|申报时间|受理时间|系统关闭)[^。；]{0,60}?(\d{1,2})月(\d{1,2})日?(?:\s*(\d{1,2})[:：](\d{2}))?/g)].map((match) => ({
    date: `${documentYear}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`,
    time: match[3] ? `${match[3].padStart(2, "0")}:${match[4]}` : "",
  }));
  return partials.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).at(-1) || { date: "", time: "" };
}
const findDeadline = (text) => findDeadlineInfo(text).date;

export function verifyOriginalDocument(policy, content, checkedAt) {
  const bindingStatus = originalBinding(policy.title, content);
  const titleMatched = bindingStatus === 'matched';
  const completedActivity = completedActivityPattern.test(`${policy.title || ""} ${content}`);
  const hasApplicationSignal = applicationDocumentPattern.test(content);
  // 读取状态与正文关联分开；parsed 不能代替 matched，更不能证明企业可申报。
  return {
    verified: titleMatched,
    parserVersion: PARSER_VERSION,
    bindingStatus,
    retrievalStatus: "parsed",
    checkedAt,
    titleMatched,
    hasApplicationSignal,
    completedActivity,
    diagnostics: { titleMatched, hasApplicationSignal, completedActivity },
    reason: titleMatched ? "已读取与标题关联的原文，企业资格仍须独立核验" : "已取得内容，但标题与正文关联待核；不得作为真实项目证据",
  };
}

async function fetchText(url, init = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36", "accept-language": "zh-CN,zh;q=0.9", ...(init.headers || {}) } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 350 * 2 ** attempt));
  }
  throw lastError;
}

async function fetchResource(url) {
  const maxBytes = Math.max(1_000_000, Number.parseInt(process.env.POLICY_DOCUMENT_MAX_BYTES || "20000000", 10) || 20_000_000);
  const timeoutMs = Math.max(5_000, Math.min(60_000, Number.parseInt(process.env.POLICY_DOCUMENT_TIMEOUT_MS || "20000", 10) || 20_000));
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": "PolicyRadar/1.0 (+low-frequency public policy indexer)" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declaredSize = Number(response.headers.get("content-length") || 0);
      if (declaredSize > maxBytes) throw new Error(`文档超过 ${maxBytes} 字节限制`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw new Error(`文档超过 ${maxBytes} 字节限制`);
      return { bytes, contentType: response.headers.get("content-type") || "", finalUrl: response.url || url };
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 450 * 2 ** attempt));
  }
  throw lastError;
}

function decodeResourceText(bytes, contentType = "") {
  const charset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]?.toLowerCase();
  const encoding = !charset || charset === "utf8" ? "utf-8" : /^(?:gb2312|gbk|x-gbk)$/.test(charset) ? "gb18030" : charset;
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function shanghaiDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return { year: parts.year, iso: `${parts.year}-${parts.month}-${parts.day}` };
}

async function parseDocumentResource(url) {
  const resource = await fetchResource(url);
  const type = detectDocumentType(resource.finalUrl || url, resource.contentType, resource.bytes);
  if (!type) throw new Error("未识别为 PDF 或 Word 文档");
  const text = await extractDocumentText(resource.bytes, type, {
    maxPages: Math.max(1, Number.parseInt(process.env.POLICY_PDF_MAX_PAGES || "80", 10) || 80),
    maxCharacters: 120_000,
  });
  if (!text.trim()) throw new Error("文档未提取到可用文字（可能是扫描件或加密文档）");
  return text;
}

async function enrichPolicyDetail(policy) {
  const checkedAt = new Date().toISOString();
  policy.lastAttemptAt = checkedAt;
  try {
    if (/\.(xls|zip)(?:\?|$)/i.test(policy.url)) {
      policy.originalVerification = { ...policy.originalVerification, retrievalStatus: "unsupported", checkedAt, reason: "该附件不是 PDF 或 Word 正文，待查" };
      return "unsupported";
    }
    const resource = await fetchResource(policy.url);
    const documentType = detectDocumentType(resource.finalUrl || policy.url, resource.contentType, resource.bytes);
    let fullContent = "";
    let detailHtml = "";
    if (documentType) {
      fullContent = await extractDocumentText(resource.bytes, documentType, { maxPages: Math.max(1, Number.parseInt(process.env.POLICY_PDF_MAX_PAGES || "80", 10) || 80), maxCharacters: 120_000 });
    } else {
      const requestedUrl = new URL(policy.url);
      const finalUrl = new URL(resource.finalUrl || policy.url);
      const redirectedToHome = requestedUrl.pathname !== finalUrl.pathname && /(?:^\/$|\/(?:index|default)\.(?:s?html?|jsp)$)/i.test(finalUrl.pathname);
      if (redirectedToHome) throw new Error("官方详情链接重定向到门户首页");
      detailHtml = decodeResourceText(resource.bytes, resource.contentType);
      fullContent = officialBody(detailHtml);
      policy.referencedUrls = [...detailHtml.matchAll(/href=["']([^"']+)["']/gi)].map(match => normalizeUrl(match[1], policy.url)).filter(Boolean);
      const attachmentUrls = [...detailHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
        .filter(match => /\.(?:pdf|docx?|xlsx?|zip)(?:[?"'\s<]|$)|downFileEx/i.test(`${match[1]} ${decode(match[2])}`))
        .map((match) => normalizeUrl(match[1], resource.finalUrl || policy.url))
        .filter(Boolean)
        .filter((url, index, all) => all.indexOf(url) === index);
      const attachmentText = [];
      policy.attachments = [];
      for (const attachmentUrl of attachmentUrls) {
        try {
          attachmentText.push(await parseDocumentResource(attachmentUrl));
          policy.attachments.push({ url: attachmentUrl, status: "parsed" });
        } catch (error) {
          policy.attachments.push({ url: attachmentUrl, status: "failed", reason: String(error.message || error) });
        }
      }
      if (attachmentText.length) fullContent = `${fullContent}\n${attachmentText.join("\n")}`;
    }
    if (!fullContent.trim()) throw new Error("官方原文未提取到可用文字");
    policy.originalVerification = verifyOriginalDocument(policy, fullContent, checkedAt);
    if (policy.attachments?.some(a => a.status !== "parsed") || fullContent.length > 120_000) policy.originalVerification = { ...policy.originalVerification, verified: false, retrievalStatus: "partial", reason: "正文已读，关键附件或超长内容尚未完整解析" };
    const deadline = extractApplicationTiming({ ...policy, content: fullContent });
    policy.content = fullContent.slice(0, 120_000);
    policy.contentHash = candidateContentHash(policy);
    policy.deadline = deadline.deadlineDate;
    policy.deadlineTime = deadline.deadlineTime;
    policy.publishDate = policy.publishDate || findDate(fullContent);
    policy.summary = fullContent.slice(0, 220) || policy.summary;
    return "parsed";
  } catch (error) {
    policy.originalVerification = {
      ...policy.originalVerification,
      verified: false,
      retrievalStatus: "failed",
      checkedAt,
      reason: `官方原文读取失败：${error instanceof Error ? error.message : String(error)}`,
    };
    return "failed";
  }
}

async function enrichPolicyDetails(policies, { limit: requestedLimit } = {}) {
  for (const policy of policies) policy.originalVerification ||= {verified:false,retrievalStatus:'not_checked',reason:'尚未读取原文'};
  const configuredLimit = Number.parseInt(process.env.POLICY_SYNC_DETAIL_LIMIT || "480", 10);
  const configuredDetailLimit = Number.isFinite(configuredLimit) ? Math.max(0, Math.min(policies.length, configuredLimit)) : Math.min(policies.length, 240);
  const detailLimit = Number.isFinite(requestedLimit) ? Math.max(0, Math.min(policies.length, requestedLimit)) : configuredDetailLimit;
  const queue = reviewQueue(policies).slice(0, detailLimit);
  await writeJsonAtomically(path.resolve('.policy-cache/review-queue.json'), {updatedAt:new Date().toISOString(),pendingIds:reviewQueue(policies).map(p=>p.id),scheduledIds:queue.map(p=>p.id)});
  const concurrency = Math.max(1, Math.min(12, Number.parseInt(process.env.POLICY_SYNC_CONCURRENCY || "6", 10) || 6));
  const hostDelay = Math.max(0, Math.min(2_000, Number.parseInt(process.env.POLICY_SYNC_HOST_DELAY_MS || "120", 10) || 0));
  const hostQueues = new Map();
  for (const policy of queue) {
    let host = "invalid-url";
    try { host = new URL(policy.url).hostname; } catch { /* parsing will mark the record as failed */ }
    if (!hostQueues.has(host)) hostQueues.set(host, []);
    hostQueues.get(host).push(policy);
  }
  // One worker owns one host queue at a time. This keeps global parallelism but
  // avoids firing six simultaneous requests at the same government WAF.
  const groups = [...hostQueues.values()];
  let groupCursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, async () => {
    while (groupCursor < groups.length) {
      const hostPolicies = groups[groupCursor++];
      let consecutiveFailures = 0;
      for (let index = 0; index < hostPolicies.length; index += 1) {
        const policy = hostPolicies[index];
        const result = await enrichPolicyDetail(policy);
        // Checkpoint each result; interruption does not reset the queue next time.
        await writeJsonAtomically(path.resolve(`.policy-cache/details/${encodeURIComponent(policy.id)}.json`), policy);
        consecutiveFailures = result === "failed" ? consecutiveFailures + 1 : 0;
        if (consecutiveFailures >= 2) {
          for (const deferred of hostPolicies.slice(index + 1)) {
            deferred.originalVerification.reason = "同一官方域名连续读取失败，本轮已暂停并保留待查";
          }
          break;
        }
        if (hostDelay) await new Promise((resolve) => setTimeout(resolve, hostDelay));
      }
    }
  }));
  return policies;
}

async function collectSushang() {
  const first = "https://sst.suzhou.gov.cn/ndaservplat/Apps/sme/index.php?s=/Home/Notice/index";
  let url = sourceProgress.get('sushang')?.nextUrl || first;
  const seen = new Set();
  const policies = [];
  const limit = Number(process.env.POLICY_SUSHANG_PAGES || 25);
  while (url && seen.size < limit) {
    seen.add(url);
    const parsed = parseSushangIndex(await fetchText(url), url);
    policies.push(...parsed.records);
    url = parsed.next && !seen.has(parsed.next) ? parsed.next : null;
  }
  const result = dedupe(policies);
  result.incomplete = Boolean(url);
  result.progress = {nextUrl:url,paginationExhausted:!url};
  // Always overlap the first page on a resumed backfill.
  if (sourceProgress.get('sushang')?.nextUrl) result.push(...parseSushangIndex(await fetchText(first),first).records.filter(p=>!result.some(r=>r.id===p.id)));
  return result;
}

async function collectSuzhou() {
  const endpoint = "https://www.suzhou.gov.cn/szinf/interfaceZcwjkAll/page";
  const terms = ["申报","申领","兑现","征集","认定","补助","奖励","贴息","券","资助"];
  const rows = [], termProgress = {};
  for (const title of terms) {
    try {
      const batch = await collectPagedRecords({startPage:sourceProgress.get('suzhou')?.termProgress?.[title]?.nextPage || 2,pageSize:100,maxPages:Number(process.env.POLICY_SOURCE_PAGE_LIMIT || 3),fetchPage:async page=>{
        const payload=JSON.parse(await fetchText(endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({page:String(page),size:'100',titleType:'2',title}).toString()}));
        const list=payload?.data?.records || payload?.data?.list || payload?.records || payload?.rows;
        if (!Array.isArray(list)) throw new Error('苏州政策库列表结构异常');
        return {rows:list,total:payload?.data?.total ?? payload?.total};
      }});
      rows.push(...batch.rows);
      termProgress[title]={nextPage:batch.nextPage,paginationExhausted:batch.paginationExhausted,error:batch.error};
    } catch(error) { termProgress[title]={...sourceProgress.get('suzhou')?.termProgress?.[title],paginationExhausted:false,error:String(error.message || error)}; }
  }
  const policies=rows.map(row=>{
    const url=normalizeUrl(row.url || row.linkUrl || '',"https://www.suzhou.gov.cn/");
    const title=decode(row.title),content=decode(row.memo || row.content || '');
    return {id:stableId('suzhou',url || String(row.id || ''),title),title,region:'苏州市',level:'市级',department:decode(row.fbjg) || '苏州市政府相关部门',publishDate:findDate(row.publishedTimeFormat || row.fwTimeFormat || ''),category:'政策申报',summary:content.slice(0,180),content,url,sourceName:'苏州市政策文件库',firstSeenAt:new Date().toISOString()};
  }).filter(p=>p.title);
  const result=dedupe(policies);
  result.incomplete=Object.values(termProgress).some(p=>!p.paginationExhausted);
  result.progress={termProgress,paginationExhausted:!result.incomplete};
  return result;
}

async function collectHtmlSource(source) {
  const policies = [];
  const pending = [...new Set([...(source.urls || [source.url]), ...(sourceProgress.get(source.id)?.pendingPageUrls || [])])];
  const seen = new Set(), limit = Math.max(1, Number(process.env.POLICY_SOURCE_PAGE_LIMIT || 6));
  while (pending.length && seen.size < limit) {
    const sourceUrl = pending.shift();
    if (seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    const html = await fetchText(sourceUrl);
    const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = anchorPattern.exec(html))) {
      const rawTitle = decode(match[0].match(/\btitle=["']([^"']+)["']/i)?.[1] || match[2]);
      if (/活动日期|产销融通对接会|直播预告/.test(rawTitle)) continue;
      const title = rawTitle.replace(/^(?:申报中|未开始|进行中)\s*/, "").replace(/^审核认定\s+\S+\s+/, "").replace(/\s*申报日期[:：][\s\S]*$/, "").replace(/\s+NEW\s+发布时间[:：][\s\S]*$/i, "").replace(/\s+发文日期[:：][\s\S]*$/, "").replace(/\s+[a-f0-9]{32}$/i, "").trim();
      if (!title || !keywords.test(title)) continue;
      const url = normalizeUrl(match[1], sourceUrl);
      if (!url || !/^https?:/.test(url)) continue;
      const context = html.slice(Math.max(0, match.index - 120), Math.min(html.length, anchorPattern.lastIndex + 180));
      const region = inferPolicyRegion(rawTitle, source);
      policies.push({ id: stableId(source.id, url, title), title, region, level: source.level || (region.endsWith("市") ? "市级" : "省级"), department: source.name, publishDate: findDate(decode(context)), deadline: findDeadline(context), category: "政策申报", summary: "来自政府官方公开栏目的政策信息，请点击原文查看完整申报条件与材料要求。", url, sourceName: source.name, firstSeenAt: new Date().toISOString() });
    }
    for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*(?:下一页|下页|Next)[\s\S]*?<\/a>/gi)) {
      const next = normalizeUrl(m[1],sourceUrl);
      if (next && new URL(next).host === new URL(sourceUrl).host && !seen.has(next) && !pending.includes(next)) pending.push(next);
    }
  }
  const result = dedupe(policies);
  result.incomplete = true; // Absence of a next link is not proof of a historical waterline.
  result.progress = {pendingPageUrls:pending,paginationExhausted:false,pagesRead:seen.size};
  return result;
}

function timestampToDate(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : "";
}

async function collectZhejiangEnterpriseApi() {
  const areas = [["33","浙江省"],["330100","杭州市"], ...["330102","330105","330106","330108","330109","330110","330111","330112","330113","330114","330122","330127","330182"].map(c=>[c,"杭州市"])];
  const policies = [], areaProgress = {};
  // Sequential areas avoid bursts at the shared government gateway.
  for (const [areaCode, region] of areas) {
    try {
    const result = await collectPagedRecords({
      startPage:sourceProgress.get('zhejiang-enterprise-api')?.areaProgress?.[areaCode]?.nextPage || 2,
      maxPages:Number(process.env.POLICY_SOURCE_PAGE_LIMIT || 3),pageSize:100,
      fetchPage:async page => {
        const url = new URL("https://hqpt.jxt.zj.gov.cn/gateway/provider-zcgj-ent/elastic/policy/search/query");
        Object.entries({requestData:"true",pageNo:String(page),pageSize:"100",sortColumn:"publishDate",areaCode}).forEach(([k,v])=>url.searchParams.set(k,v));
        const payload = JSON.parse(await fetchText(url.href));
        if (!Array.isArray(payload?.result?.records)) throw new Error("企业之家列表结构异常，不能当作零条");
        return {rows:payload.result.records,total:payload.result.total};
      }
    });
    areaProgress[areaCode] = {nextPage:result.nextPage,paginationExhausted:result.paginationExhausted,error:result.error};
    for (const row of result.rows) {
      const title=decode(row.policyTitle || row.title || ""), content=decode(row.interContent || row.content || "");
      if (!title) continue;
      const declaration=row.declareList?.find(d=>d.showState===2) || row.declareList?.[0] || {};
      const original=row.policyOriginalFilePath || declaration.pcLink || "";
      policies.push({id:stableId("zhejiang-enterprise-api-"+areaCode,original,title),title,region,level:areaCode==="33"?"省级":"市区级",department:decode(row.department || row.publishDept || "浙江省企业之家"),publishDate:row.publishDate || "",category:decode(row.policyCategoryText || "政策线索"),summary:content.slice(0,220),content,url:original,sourceName:"浙江省企业之家（全状态）",firstSeenAt:new Date().toISOString()});
    }
    } catch(error) { areaProgress[areaCode]={...sourceProgress.get('zhejiang-enterprise-api')?.areaProgress?.[areaCode],paginationExhausted:false,error:String(error.message || error)}; }
  }
  const result=dedupe(policies);
  result.incomplete=Object.values(areaProgress).some(p=>!p.paginationExhausted);
  result.progress={areaProgress,paginationExhausted:!result.incomplete};
  return result;
}

async function collectSuzhouEnterpriseApi() {
  const batch=await collectPagedRecords({startPage:sourceProgress.get('suzhou-enterprise-api')?.nextPage || 2,pageSize:100,maxPages:Number(process.env.POLICY_SOURCE_PAGE_LIMIT || 3),fetchPage:async page=>{
    const payload=JSON.parse(await fetchText("https://www.qyfw.suzhou.com.cn/gateway/policy/api/ua/policy/today-declare?current="+page+"&size=100"));
    if (!Array.isArray(payload?.data?.records)) throw new Error('苏州企业服务列表结构异常');
    return {rows:payload.data.records,total:payload.data.total};
  }});
  const rows=batch.rows;
  const policies = await Promise.all(rows.map(async (row) => {
    let detail=row, indexDetailError;
    try { detail=JSON.parse(await fetchText(`https://www.qyfw.suzhou.com.cn/gateway/policy/api/ua/policy/detail?id=${encodeURIComponent(row.id)}`))?.data || row; }
    catch(error) { indexDetailError=String(error.message || error); }
    detail.indexDetailError=indexDetailError;
    const title = decode(detail.title || row.title || "");
    const content = decode(detail.content || row.policySystemDesc || "");
    const dateText = `${detail.declarationDate || row.declarationDate || ""} ${(detail.declarationDateList || row.declarationDateList || []).map((item) => typeof item === "string" ? item : JSON.stringify(item)).join(" ")}`;
    const deadline = findDeadlineInfo(`${content} ${dateText}`);
    const sourceUrl = suzhouOriginalUrl(detail);
    // Do not expose an API JSON endpoint as "查看原文". A record without an
    // independently verifiable original is held back until its source file is
    // supplied by the official platform.
    if (!title) return null;
    return { id: stableId("suzhou-enterprise-api", String(row.id), title), title, region: decode(detail.city || "苏州市").includes("苏州") ? "苏州市" : "江苏省", level: "市级", department: decode(detail.department || row.department || "苏州市企业服务平台"), publishDate: findDate(detail.publishTime || row.publishTime || ""), deadline: deadline.date, deadlineTime: deadline.time, category: decode(detail.categoryDesc || row.categoryDesc || "政策申报"), summary: content.slice(0, 220), content, url: sourceUrl, sourceName: "苏州市企业服务平台（申报中）", firstSeenAt: new Date().toISOString() };
  }));
  const result=dedupe(policies.filter(Boolean));
  result.incomplete=true; // today-declare is only the current-window endpoint, not all states.
  result.progress={nextPage:batch.nextPage,paginationExhausted:batch.paginationExhausted,scopeGap:'本接口只含当前申报，需其他来源补齐预告和历史',error:batch.error};
  return result;
}

function collectStructuredXml(xml, source) {
  const policies = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(xml))) {
    const attributes = match[1];
    const href = attributes.match(/\bhref=["']([^"']+)["']/i)?.[1] || "";
    const title = decode(attributes.match(/\btitle=["']([^"']+)["']/i)?.[1] || match[2]);
    if (!title) continue;
    const context = xml.slice(Math.max(0, match.index - 180), Math.min(xml.length, pattern.lastIndex + 180));
    policies.push({ id: stableId(source.id, href, title), title, region: source.region, level: source.level, department: source.name, publishDate: findDate(decode(context)), deadline: findDeadline(context), category: "政策申报", summary: "来自官方机器可读通知索引，已保留原文入口供核验申报条件。", url: normalizeUrl(href, source.baseUrl), sourceName: source.name, firstSeenAt: new Date().toISOString() });
  }
  return policies.filter((item) => item.url);
}

async function collectJiangsuStructured(source) {
  const listUrl = `${source.host}${source.listPath}`;
  // WebBuilder endpoints reject direct anonymous calls on several Jiangsu
  // domains. Bootstrap the official list and send its Referer on every page.
  await fetchText(listUrl);
  const firstParams = new URLSearchParams({ page: "1", appid: "1", webid: source.webId, path: "/", columnid: source.columnId, unitid: source.unitId, webname: encodeURIComponent(source.webName), permissiontype: "0" });
  const endpoint = `${source.host}/module/web/jpage/dataproxy.jsp`;
  const headers = { referer: listUrl };
  const firstXml = await fetchText(`${endpoint}?${firstParams}`, { headers });
  const reportedPages = Number.parseInt(firstXml.match(/<totalpage>(\d+)<\/totalpage>/i)?.[1] || "1", 10);
  const pageLimit = Math.max(1, Number.parseInt(process.env.POLICY_SOURCE_PAGE_LIMIT || "6", 10) || 6);
  const pages = [firstXml];
  let page = sourceProgress.get(source.id)?.nextPage || 2;
  let processed = 0;
  for (; page <= reportedPages && processed < pageLimit; page += 1, processed += 1) {
    const params = new URLSearchParams(firstParams);
    params.set("page", String(page));
    pages.push(await fetchText(`${endpoint}?${params}`, { headers }));
  }
  const result = dedupe(pages.flatMap((xml) => collectStructuredXml(xml, { ...source, baseUrl: `${source.host}/` })));
  result.incomplete = page <= reportedPages;
  result.progress = {nextPage:page <= reportedPages ? page : 2,reportedPages,paginationExhausted:page > reportedPages};
  return result;
}

async function collectWujiangApi() {
  const { year } = shanghaiDate();
  const terms = ["申报", "征集", "遴选", "推荐", "补贴", "补助", "奖励", "资金", "项目"];
  const policies = [], termProgress = {};
  for (const term of terms) {
    const url = new URL("https://www.wujiang.gov.cn/appsearch/wjapi/list");
    url.searchParams.set("keywords", term);
    // No title-year or expense-year cutoff; old rolling calls remain discoverable.
    url.searchParams.set("edate", `${year}-12-31`);
    let batch;
    try {
      batch=await collectPagedRecords({startPage:sourceProgress.get('wujiang-api')?.termProgress?.[term]?.nextPage || 2,pageSize:100,maxPages:Number(process.env.POLICY_SOURCE_PAGE_LIMIT || 3),fetchPage:async page=>{
        const body=new URLSearchParams({currentPage:String(page),pageSize:'100',pid:''}).toString();
        const payload=JSON.parse(await fetchText(url.href,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body}));
        if (!Array.isArray(payload?.data?.list)) throw new Error('吴江列表结构异常');
        return {rows:payload.data.list,total:payload.data.total};
      }});
      termProgress[term]={nextPage:batch.nextPage,paginationExhausted:batch.paginationExhausted,error:batch.error};
    } catch(error) {termProgress[term]={...sourceProgress.get('wujiang-api')?.termProgress?.[term],paginationExhausted:false,error:String(error.message || error)};continue;}
    for (const row of batch.rows) {
      const title = decode(row.title || "");
      const original = normalizeUrl(row.redirect_url || row.url || "", "https://www.wujiang.gov.cn/");
      if (!title) continue;
      const summary = decode(row.memo || "") || "来自苏州市吴江区人民政府公开索引，正文将由定时同步程序自动读取。";
      policies.push({
        id: stableId("wujiang-api", String(row.manuscript_id || original), title),
        title,
        region: "苏州市",
        level: "区级",
        department: decode(row.ra_wjqfbjg || "苏州市吴江区人民政府"),
        publishDate: findDate(row.published_time || row.ra_wjqfbrq || ""),
        deadline: findDeadline(`${title} ${summary}`),
        category: "吴江区政策申报",
        summary,
        url: original,
        sourceName: "苏州市吴江区人民政府政策搜索",
        firstSeenAt: new Date().toISOString(),
      });
    }
  }
  const result=dedupe(policies);
  result.incomplete=Object.values(termProgress).some(p=>!p.paginationExhausted);
  result.progress={termProgress,paginationExhausted:!result.incomplete};
  return result;
}

async function collectMostNotices() {
  const sourceUrl = "https://service.most.gov.cn/kjjh_tztg/";
  const html = await fetchText(sourceUrl);
  const policies = [];
  const pattern = /<div\b[^>]*onclick=["']window\.parent\.openW\('([^']+)'\)["'][^>]*title=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const title = decode(match[2]);
    if (!title) continue;
    const context = html.slice(Math.max(0, match.index - 220), Math.min(html.length, pattern.lastIndex + 240));
    const url = normalizeUrl(match[1], sourceUrl);
    policies.push({ id: stableId("most-notices", url, title), title, region: "国家", level: "国家级", department: "科学技术部", publishDate: findDate(decode(context)), deadline: findDeadline(context), category: "国家科技计划", summary: "来自科学技术部公开通知目录，已保留原文入口以核验申报条件、附件和截止时间。", url, sourceName: "科学技术部科技计划通知", firstSeenAt: new Date().toISOString() });
  }
  return policies;
}

async function collectHangzhouTechApi() {
  const batch = await collectPagedRecords({
    startPage:sourceProgress.get('hangzhou-tech-api')?.nextPage || 2,
    maxPages:Number(process.env.POLICY_SOURCE_PAGE_LIMIT || 3),pageSize:80,
    fetchPage:async page => {
      const payload=JSON.parse(await fetchText("https://sti.kj.hangzhou.gov.cn/technology-brain-web/tech/policyLaw/listPage",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:`dataType=2&pageNum=${page}&numPerPage=80&order=2`}));
      if (!Array.isArray(payload?.data?.recordList)) throw new Error("杭州科技列表结构异常");
      return {rows:payload.data.recordList,total:payload.data.totalRecord};
    }
  });
  const policies = batch.rows.map(row => {
    const title=decode(row.title || ""),content=decode(row.context || "");
    return {id:stableId("hangzhou-tech-api",row.detailUrl || String(row.id),title),title,region:row.levelType===1?"国家":row.levelType===2?"浙江省":"杭州市",level:decode(row.levelTypeName || "市级"),department:decode(row.publishDepart || "杭州市科技局"),publishDate:timestampToDate(row.publishDate),category:"科技项目通知",summary:content.slice(0,220),content,url:row.detailUrl || "",sourceName:"杭州市科技创新服务平台",firstSeenAt:new Date().toISOString()};
  }).filter(p=>p.title);
  const result=dedupe(policies);
  result.incomplete=!batch.paginationExhausted;
  result.progress={nextPage:batch.nextPage,paginationExhausted:batch.paginationExhausted};
  return result;
}

export function dedupe(items) {
  const seen = new Map();
  for (const item of items) {
    const key = item.id || `${item.region}|${item.url || ''}|${item.title}`;
    const existing = seen.get(key);
    if (!existing || (!existing.publishDate && item.publishDate)) seen.set(key, item);
  }
  return [...seen.values()].sort((a, b) => (b.publishDate || b.firstSeenAt).localeCompare(a.publishDate || a.firstSeenAt));
}

async function loadCompanyProfile() {
  try {
    const profile = JSON.parse(await readFile(companyProfilePath, "utf8"));
    return profile?.matcherProfile || profile?.companies ? profile : null;
  } catch {
    // A missing or malformed profile must not stop a policy refresh. The
    // matcher will use document-only evidence and mark no profile conditions.
    return null;
  }
}

async function writeJsonAtomically(targetPath, payload) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  // This file is fetched by every policy-page visit. Keep it minified; Nginx
  // can then gzip the roughly 5 MB audit feed to well under 1 MB on the wire.
  await writeFile(temporaryPath, `${JSON.stringify(payload)}\n`, "utf8");
  await rename(temporaryPath, targetPath);
}

async function writePolicyOutputs(payload) {
  await writeJsonAtomically(outputPath, payload);
  // `vinext build` copies public assets into dist/client. On a Tencent Node
  // deployment the daily cron runs after the build, so update that served copy
  // too when it exists; local development continues to read public/ directly.
  try {
    await access(path.dirname(deployedOutputPath));
    await cp(path.resolve("public/policy-sources"), path.resolve("dist/client/policy-sources"), { recursive: true });
    await writeJsonAtomically(deployedOutputPath, payload);
  } catch {
    // No production build yet, which is normal during local development.
  }
}

async function collectOfficialSources(collectors) {
  // Pulling every government index at once produces bursts against the same
  // provincial/city gateways and makes a temporary WAF response look like a
  // source outage. Bound the collection fan-out; detail fetching has its own
  // separate per-host queue below.
  const configured = Number.parseInt(process.env.POLICY_SOURCE_CONCURRENCY || "3", 10);
  const concurrency = Number.isFinite(configured) ? Math.max(1, Math.min(6, configured)) : 3;
  const completed = Array(collectors.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, collectors.length) }, async () => {
    while (cursor < collectors.length) {
      const index = cursor++;
      const collector = collectors[index];
      try {
        const policies = await collector.run();
        completed[index] = { policies: policies.map(p => ({ ...p, sourceId: collector.id })), status: { id: collector.id, name: collector.name, ok: true, checkedAt:new Date().toISOString(), count: policies.length, incomplete: policies.incomplete !== false || policies.length === 0, ...(policies.progress || {}) } };
        console.log(`来源 ${index + 1}/${collectors.length}：${collector.name} ${policies.length} 条`);
      } catch (error) {
        completed[index] = { policies: [], status: { ...sourceProgress.get(collector.id), id: collector.id, name: collector.name, ok: false, checkedAt:new Date().toISOString(), incomplete:true, count: 0, error: error instanceof Error ? error.message : String(error) } };
      }
    }
  }));
  return completed;
}

async function main() {
  const policyRules = assertPolicyRulesLoaded(await loadPolicyRules());
  await writeJsonAtomically(path.resolve(".policy-cache/rules.json"), policyRules);
  const results = [];
  const sourceStatus = [];
  const collectors = [
    { id: "sushang", name: "苏商通官方申报中心", run: collectSushang },
    { id: "suzhou", name: "苏州市政策文件库", run: collectSuzhou },
    { id: "wujiang-api", name: "苏州市吴江区人民政府政策搜索", run: collectWujiangApi },
    { id: "suzhou-enterprise-api", name: "苏州市企业服务平台申报事项", run: collectSuzhouEnterpriseApi },
    { id: "most-notices", name: "科学技术部科技计划通知", run: collectMostNotices },
    { id: "zhejiang-enterprise-api", name: "浙江省企业之家申报事项", run: collectZhejiangEnterpriseApi },
    { id: "hangzhou-tech-api", name: "杭州市科技创新服务平台", run: collectHangzhouTechApi },
    ...jiangsuStructuredSources.map((source) => ({ id: source.id, name: source.name, run: () => collectJiangsuStructured(source) })),
    ...htmlSources.map((source) => ({ id: source.id, name: source.name, run: () => collectHtmlSource(source) })),
  ];
  const cachePath = path.resolve(".policy-cache/candidates.json");
  let previous;
  try { previous = JSON.parse(await readFile(cachePath, "utf8")); } catch { try { previous = JSON.parse(await readFile(outputPath, "utf8")); } catch { previous = {}; } }
  for (const status of previous.sources || []) sourceProgress.set(status.id,status);
  const cachedOnly = process.argv.includes("--cached");
  const resume = process.argv.includes("--resume");
  const completed = cachedOnly || resume ? [] : await collectOfficialSources(collectors);
  if (cachedOnly || resume) sourceStatus.push(...(previous.sources || []));
  for (const item of completed) { results.push(...item.policies); sourceStatus.push(item.status); }
  // Collect all indexes first, then deduplicate globally and enrich one shared
  // priority queue. This prevents each source's arbitrary first page from using
  // up the detail budget before current Jiangsu/Suzhou/Wujiang records.
  const prior = previous.candidates || previous.policies || [];
  const priorById = new Map(prior.map(p => [p.id, p]));
  for (const seed of policyWatchlist) if (!priorById.has(seed.id)) results.push(seed);
  const fresh = results.map(p => {
    const old = priorById.get(p.id), merged = {...old,...p,content:p.content || old?.content || ''};
    merged.indexRevision = createHash('sha256').update(JSON.stringify([p.title,p.url,p.content || '',p.publishDate])).digest('hex');
    if (old?.content && p.content && old.content !== p.content) merged.originalVerification = {verified:false,retrievalStatus:'not_checked',reason:'索引正文变化，原证据版本须重核'};
    return merged;
  });
  const freshIds = new Set(fresh.map(p => p.id));
  const candidates = dedupe([...fresh, ...prior.filter(p => !freshIds.has(p.id))]);
  for (const p of candidates) {
    p.indexRevision ||= createHash('sha256').update(JSON.stringify([p.title,p.url,p.content || '',p.publishDate])).digest('hex');
    try {
      const saved = JSON.parse(await readFile(path.resolve(`.policy-cache/details/${encodeURIComponent(p.id)}.json`),'utf8'));
      if (saved.url === p.url && saved.indexRevision === p.indexRevision && (saved.lastAttemptAt || '') > (p.lastAttemptAt || '')) Object.assign(p,saved);
    } catch { /* no resumable detail */ }
    if (/年度/.test(p.region || '')) p.region = inferPolicyRegion(p.title, {name:p.sourceName,region:htmlSources.find(s=>s.id===p.sourceId)?.region || ''});
    p.contentHash = candidateContentHash(p);
    if (['parsed','partial'].includes(p.originalVerification?.retrievalStatus)) {
      const bindingStatus = originalBinding(p.title,p.content || '');
      p.originalVerification = {...p.originalVerification,bindingStatus,titleMatched:bindingStatus==='matched'};
    }
  }
  await writeJsonAtomically(cachePath, { savedAt: new Date().toISOString(), sources: sourceStatus, candidates });
  if (!cachedOnly) await enrichPolicyDetails(candidates);
  const companyProfile = await loadCompanyProfile();
  await writeJsonAtomically(cachePath, { savedAt: new Date().toISOString(), sources: sourceStatus, candidates });
  const expanded = expandApplicationItems(candidates);
  await writeJsonAtomically(path.resolve(".policy-cache/audit.json"), { generatedAt: new Date().toISOString(), policies: auditPolicies(expanded, new Date(), companyProfile) });
  const payload = assertViablePolicyFeed(buildPolicyFeed(expanded, sourceStatus, companyProfile, new Date()));
  // Every published link, including attachments, is checked independently of
  // content/qualification parsing. Historical parsing is not proof of availability.
  await auditPolicyLinks(payload, { candidates });
  payload.refreshMode = cachedOnly ? 'cached_reassessment' : resume ? 'detail_resume' : 'source_and_detail';
  await mkdir(path.resolve(".policy-cache/history"), { recursive: true });
  await copyFile(outputPath, path.resolve(`.policy-cache/history/policies-${Date.now()}.json`)).catch(() => {});
  await writePolicyOutputs(payload);
  await import("./write-policy-applications.mjs");
  console.log(`Policy sync complete: ${payload.policies.length} confirmed project calls (${payload.decisionCounts.eligible} eligible; ${payload.coverage.pendingDocuments} documents pending), ${sourceStatus.filter((source) => source.ok).length}/${sourceStatus.length} sources available.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((error) => { console.error(error); process.exitCode = 1; });
