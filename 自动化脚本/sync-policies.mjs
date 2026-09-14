import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { tmpdir } from "node:os";
import { strFromU8, unzipSync } from "fflate";
import { auditPolicies } from "./policy-matcher.mjs";

const outputPath = path.resolve(process.cwd(), "public/policies.json");
const tempPath = `${outputPath}.tmp`;
const companyProfilePath = path.resolve(process.cwd(), "public/company-profile.json");
const keywords = /(申报|征集|补助|补贴|奖励|扶持|资助|资金|科技|研发|创新|中小企业|专精特新|高新技术)/;
const excludedTopics = /(基础教育|教学改革|卫生高级职称|失能老年人|竞技体育|非盈利性工程建设|行政决策事项|民生实事)/;
const completedActivityPattern = /(?:成功举办|圆满举办|顺利举办|活动回顾|工作动态|经验交流|会议纪要)/;
const applicationDocumentPattern = /(?:项目申报|企业申报|申报材料|申报受理|申报截止|申报指南|申报主体|申报条件|申报要求|申请条件|申请主体|申请书|征集公告|需求征集|项目征集|申报通知|受理时间|网上填报时间|填报时间)/;
const verificationPriorityTerms = ["氢能", "氢能源", "燃料电池", "氢燃料", "氢电耦合", "氢动力", "制氢", "储氢", "电控", "电力电子", "能量管理", "功率控制", "控制器", "碳化硅", "低空经济", "无人机", "无人飞行器", "飞控", "新型储能", "新型电力系统", "微电网", "源网荷储", "多能互补", "高新技术企业", "专精特新", "潜在独角兽"];
const directApplicationTitlePattern = /(项目申报|组织申报|申报通知|申报指南|申报工作|申报开始|申报启动|征集公告|需求征集|联合征集|揭榜挂帅|补助申报|补贴申报|奖励申报|资金申报|认定申报|企业认定|高新技术企业|专精特新|科技型中小企业|企业技术中心|评价工作|入库申报|推荐申报)/;
const deadlineLeadPattern = "(?:截至|截止(?:时间)?(?:为|至|到)?|申报时间|受理时间|网上填报时间|填报时间|申报期限|系统关闭)";
const execFileAsync = promisify(execFile);

const htmlSources = [
  { id: "national", name: "国务院政策文件库", region: "国家", level: "国家级", url: "https://www.gov.cn/zhengce/zhengceku/bmwj/home.htm" },
  { id: "ndrc-notices", name: "国家发展改革委通知公告", region: "国家", level: "国家级", url: "https://www.ndrc.gov.cn/xwdt/tzgg/" },
  { id: "ndrc-circulars", name: "国家发展改革委通知", region: "国家", level: "国家级", url: "https://www.ndrc.gov.cn/xxgk/zcfb/tz/" },
  { id: "nsfc", name: "国家自然科学基金委员会业务资讯", region: "国家", level: "国家级", url: "https://www.nsfc.gov.cn/p1/" },
  { id: "miit-scitech", name: "工业和信息化部科技司", region: "国家", level: "国家级", url: "https://www.miit.gov.cn/jgsj/kjs/index.html" },
  { id: "miit-operation", name: "工业和信息化部运行监测协调局", region: "国家", level: "国家级", url: "https://www.miit.gov.cn/jgsj/yxj/index.html" },
  { id: "miit-energy", name: "工业和信息化部节能与综合利用司", region: "国家", level: "国家级", url: "https://www.miit.gov.cn/jgsj/jns/index.html" },
  { id: "miit-scitech-documents", name: "工业和信息化部科技司文件发布", region: "国家", level: "国家级", url: "https://www.miit.gov.cn/jgsj/kjs/wjfb/index.html", directApplicationOnly: true },
  { id: "zhejiang", name: "浙江省行政规范性文件数据库", region: "浙江省", level: "省级", url: "https://zjsftbascweb.zjsft.gov.cn/data/" },
  { id: "zhejiang-scitech", name: "浙江省科学技术厅通知通告", region: "浙江省", level: "省级", url: "https://kjt.zj.gov.cn/col/col1229225203/index.html" },
  { id: "zhejiang-miit", name: "浙江省经济和信息化厅通知", region: "浙江省", level: "省级", url: "https://jxt.zj.gov.cn/col/col1582899/index.html" },
  { id: "zhejiang-enterprise", name: "浙江省企业之家", region: "浙江省", level: "省级", url: "https://zj87.jxt.zj.gov.cn/" },
  { id: "hangzhou", name: "杭州市人民政府公报", region: "杭州市", level: "市级", url: "https://zfgb.hangzhou.gov.cn/" },
  { id: "hangzhou-scitech", name: "杭州市科学技术局", region: "杭州市", level: "市级", url: "https://sti.kj.hangzhou.gov.cn/" },
  { id: "jiangsu-scitech", name: "江苏省科学技术厅", region: "江苏省", level: "省级", url: "https://kjt.jszwfw.gov.cn/" },
  { id: "jiangsu-scitech-notices", name: "江苏省科学技术厅通知公告", region: "江苏省", level: "省级", url: "https://kxjst.jiangsu.gov.cn/col/col82540/index.html", directApplicationOnly: true },
  { id: "jiangsu-transport-scitech", name: "江苏省交通运输厅科技与信息化", region: "江苏省", level: "省级", url: "https://jtyst.jiangsu.gov.cn/col/col41649/index.html", directApplicationOnly: true },
  { id: "jiangsu-miit", name: "江苏省工业和信息化厅文件通知", region: "江苏省", level: "省级", url: "https://gxt.jiangsu.gov.cn/col/col6278/index.html" },
  { id: "suzhou-scitech", name: "苏州市科学技术局通知公告", region: "苏州市", level: "市级", url: "https://kjj.suzhou.gov.cn/szkj/tzgg/tzgg.shtml" },
  { id: "suzhou-scitech-projects", name: "苏州市科学技术局科技计划", region: "苏州市", level: "市级", url: "https://kjj.suzhou.gov.cn/szkj/kjjh/kjjh.shtml", directApplicationOnly: true },
  { id: "suzhou-miit-bulletins", name: "苏州市工业和信息化局公告栏", region: "苏州市", level: "市级", url: "https://gxj.suzhou.gov.cn/szeic/ggl/common_list.shtml", directApplicationOnly: true },
  { id: "wujiang-scitech-policy", name: "吴江区科技人才政策与项目申报", region: "苏州市", level: "市级", url: "https://www.wujiang.gov.cn/zgwj/kjcs/xxgk_list.shtml", directApplicationOnly: true },
  { id: "jiangsu", name: "江苏省人民政府文件", region: "江苏省", level: "省级", url: "https://www.jiangsu.gov.cn/col/col76841/index.html" },
  { id: "lianyungang", name: "连云港市政府规范性文件", region: "连云港市", level: "市级", url: "https://www.lyg.gov.cn/zglygzfmhwz/szfgfxwj1/szfgfxwj1.shtml" },
  { id: "lianyungang-scitech", name: "连云港市科学技术局通知公告", region: "连云港市", level: "市级", url: "http://kjj.lyg.gov.cn/lygskxjsj/tzgg/tzgg.html" },
  { id: "lianyungang-projects", name: "连云港市政府科技项目", region: "连云港市", level: "市级", url: "https://www.lyg.gov.cn/zglygzfmhwz/kjxm/kjxm.shtml" },
  { id: "lianyungang-market", name: "连云港市市场监督管理局通知", region: "连云港市", level: "市级", url: "https://www.lyg.gov.cn/zglygzfmhwz/sczrjjg/sczrjjg.html" },
];

const fixedPolicies = [];
const priorityOfficialNotices = [
  {
    id: "miit-2026-specialized-little-giant",
    title: "工业和信息化部办公厅关于开展2026年度专精特新“小巨人”企业认定和复核工作的通知",
    region: "国家",
    level: "国家级",
    department: "工业和信息化部中小企业局",
    publishDate: "2026-03-23",
    deadline: "2026-05-25",
    preserveDeadline: true,
    category: "政策申报",
    summary: "国家级专精特新“小巨人”第八批认定和复核通知；线上填报窗口以已核验官方正文为准。",
    url: "https://www.miit.gov.cn/jgsj/qyj/wjfb/art/2026/art_83857a4773ac4583bd1540eeb78bcbcb.html",
    sourceName: "工业和信息化部中小企业局（重点核验）",
  },
  {
    id: "jiangsu-scitech-2026-high-tech-extension",
    title: "关于延长2026年度高新技术企业申报受理截止时间的通知",
    region: "江苏省",
    level: "省级",
    department: "江苏省科学技术厅",
    publishDate: "2026-08-31",
    deadline: "",
    category: "政策申报",
    summary: "江苏省科技厅发布的高新技术企业申报受理延期通知，需以已核验官方正文及属地提交要求为准。",
    url: "https://kxjst.jiangsu.gov.cn/art/2026/8/31/art_82540_11822897.html",
    sourceName: "江苏省科技厅通知公告（重点核验）",
  },
  {
    id: "jiangsu-miit-2026-specialized-sme",
    title: "关于组织开展2026年度省级专精特新中小企业认定和复核工作的通知",
    region: "江苏省",
    level: "省级",
    department: "江苏省工业和信息化厅",
    publishDate: "2026-08-21",
    deadline: "",
    category: "政策申报",
    summary: "江苏省工信厅发布的省级专精特新中小企业认定和复核通知，企业填报截止以官方正文为准。",
    url: "https://gxt.jiangsu.gov.cn/art/2026/8/21/art_6278_11819187.html",
    sourceName: "江苏省工信厅文件通知（重点核验）",
  },
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

function findDeadlineInfo(text, fallbackDate = "") {
  // Word often splits one date across multiple text runs (for example "202 6 年").
  // Whitespace is not meaningful for deadline recognition, so remove it here.
  const compact = decode(text).replace(/\s+/g, "");
  const reportingDeadlineMatches = [...compact.matchAll(/(?:请|须|应|需)?于(20\d{2})[年.\/-](\d{1,2})[月.\/-](\d{1,2})日?(?:\s*(\d{1,2})[:：](\d{2}))?前(?:报送|提交|完成|反馈|将)?/g)].map((match) => ({
    date: `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`,
    time: match[4] ? `${match[4].padStart(2, "0")}:${match[5]}` : "",
  }));
  // 企业提交与主管部门推荐常在同一通知中出现。项目页应优先提示
  // 企业最早需要行动的节点，而不是后续主管部门的汇总截止时间。
  if (reportingDeadlineMatches.length) return reportingDeadlineMatches.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))[0];
  // National qualification notices often say “线上在…平台填报，时间为
  // 2026年4月25日至5月25日”, then give a later deadline for provincial
  // departments to submit their recommendation. The enterprise-facing online
  // window must win over that later administrative deadline.
  const onlineApplicationRanges = [...compact.matchAll(/(?:线上|网上)[^。；]{0,100}?(?:填报|申报|申请)[^。；]{0,30}?(20\d{2})[年.\/-](\d{1,2})[月.\/-](\d{1,2})日?(?:至|到|—|\-|~)(?:(20\d{2})[年.\/-])?(\d{1,2})[月.\/-](\d{1,2})日?(?:\s*(\d{1,2})[:：](\d{2}))?/g)].map((match) => ({
    date: `${match[4] || match[1]}-${match[5].padStart(2, "0")}-${match[6].padStart(2, "0")}`,
    time: match[7] ? `${match[7].padStart(2, "0")}:${match[8]}` : "",
  }));
  if (onlineApplicationRanges.length) return onlineApplicationRanges.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).at(-1);
  const rangeMatches = [...compact.matchAll(new RegExp(`${deadlineLeadPattern}[^。；]{0,60}?(20\\d{2})[年.\\/-](\\d{1,2})[月.\\/-](\\d{1,2})日?(?:至|到|—|\\-|~)(?:(20\\d{2})[年.\\/-])?(\\d{1,2})[月.\\/-](\\d{1,2})日?(?:\\s*(\\d{1,2})[:：](\\d{2}))?`, "g"))].map((match) => ({
    date: `${match[4] || match[1]}-${match[5].padStart(2, "0")}-${match[6].padStart(2, "0")}`,
    time: match[7] ? `${match[7].padStart(2, "0")}:${match[8]}` : "",
  }));
  if (rangeMatches.length) return rangeMatches.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).at(-1);
  const matches = [...compact.matchAll(new RegExp(`${deadlineLeadPattern}[^。；]{0,60}(20\\d{2}[年.\\/-]\\d{1,2}[月.\\/-]\\d{1,2}日?)(?:\\s*(\\d{1,2})[:：](\\d{2}))?`, "g"))].map((match) => ({ date: findDate(match[1]), time: match[2] ? `${match[2].padStart(2, "0")}:${match[3]}` : "" })).filter((value) => value.date);
  if (matches.length) return matches.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).at(-1);

  // Formal notices often state the year once in the title and later write only
  // “6月25日24:00 截止”.  When the same original contains exactly one usable
  // document year, attach it to that explicit deadline rather than treating a
  // clearly expired window as unknown.
  const yearMatches = [...compact.matchAll(/20\d{2}/g)].map((match) => match[0]);
  // A notice may quote older standards or policy history. Its issue date is
  // conventionally at the end of the official text, so use the final explicit
  // year as the document year for a deadline that omits its own year.
  const fallbackYear = String(fallbackDate).match(/^(20\d{2})-/)?.[1];
  const documentYear = fallbackYear || yearMatches.at(-1);
  if (!documentYear) return { date: "", time: "" };
  const partials = [...compact.matchAll(new RegExp(`${deadlineLeadPattern}[^。；]{0,60}?(\\d{1,2})月(\\d{1,2})日?(?:\\s*(\\d{1,2})[:：](\\d{2}))?`, "g"))].map((match) => ({
    date: `${documentYear}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`,
    time: match[3] ? `${match[3].padStart(2, "0")}:${match[4]}` : "",
  }));
  const partialReportingMatches = [...compact.matchAll(/(?:请|须|应|需)?于(\d{1,2})月(\d{1,2})日?前(?:报送|提交|完成|反馈|填报|将)?/g)].map((match) => ({
    date: `${documentYear}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`,
    time: "",
  }));
  if (partialReportingMatches.length) return partialReportingMatches.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))[0];
  return partials.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).at(-1) || { date: "", time: "" };
}
const findDeadline = (text) => findDeadlineInfo(text).date;

function compactText(value = "") {
  return decode(value).replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase();
}

// A URL is not enough to call something an original application document.
// The fetched page must identify the same notice, contain an application
// signal, and not be a completed-event/news report.
export function verifyOriginalDocument(policy, content, checkedAt) {
  const title = compactText(policy.title);
  const body = compactText(content);
  const titleMatched = title.length >= 8 && body.includes(title);
  const completedActivity = completedActivityPattern.test(`${policy.title || ""} ${content}`);
  const hasApplicationSignal = applicationDocumentPattern.test(content);
  const verified = titleMatched && hasApplicationSignal && !completedActivity;
  const reason = completedActivity
    ? "原文为活动新闻或已举办活动"
    : !titleMatched
      ? "原文标题与索引记录不一致"
      : !hasApplicationSignal
        ? "原文未识别到申报、申请或征集条件"
        : "已核验官方申报原文";
  return { verified, checkedAt, titleMatched, hasApplicationSignal, completedActivity, reason };
}

async function fetchText(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36", "accept-language": "zh-CN,zh;q=0.9", ...(init.headers || {}) } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    // A few government sites intermittently reset Node's TLS handshake while
    // returning the same public page to curl. Retry once through curl rather
    // than turning a transient transport problem into an unverified notice.
    // Keep POST/API requests on fetch: the fallback is only safe for GETs.
    if (init.method && init.method.toUpperCase() !== "GET") throw error;
    try {
      const { stdout } = await execFileAsync("curl", ["--fail", "--location", "--max-time", "20", "--connect-timeout", "12", "--user-agent", "Mozilla/5.0", "--header", "Accept-Language: zh-CN,zh;q=0.9", url], { maxBuffer: 12 * 1024 * 1024 });
      if (stdout) return stdout;
    } catch { /* rethrow the original fetch error below */ }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBytes(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36", "accept-language": "zh-CN,zh;q=0.9" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function extractDocxText(url) {
  const archive = unzipSync(await fetchBytes(url));
  const documentXml = archive["word/document.xml"];
  if (!documentXml) return "";
  return decode(strFromU8(documentXml).replace(/<\/w:p>/g, "。 ").replace(/<w:tab\/>/g, " "));
}

function documentExtension(url) {
  try {
    const parsed = new URL(url);
    const filename = `${parsed.pathname}${parsed.search}`.toLowerCase();
    const match = filename.match(/\.(pdf|docx?|xlsx?|zip)(?:$|[&#])/);
    return match?.[1] || "";
  } catch {
    return "";
  }
}

async function extractPdfText(url) {
  const directory = await mkdtemp(path.join(tmpdir(), "policy-pdf-"));
  const input = path.join(directory, "original.pdf");
  const output = path.join(directory, "original.txt");
  try {
    await writeFile(input, await fetchBytes(url));
    await execFileAsync("pdftotext", ["-layout", input, output], { maxBuffer: 8 * 1024 * 1024 });
    return decode(await readFile(output, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function extractWordText(url) {
  const extension = documentExtension(url);
  if (extension === "docx") {
    try {
      return await extractDocxText(url);
    } catch {
      // Some agency-generated DOCX files have malformed XML; textutil is a
      // useful local fallback and also covers legacy .doc attachments.
    }
  }
  const directory = await mkdtemp(path.join(tmpdir(), "policy-word-"));
  const input = path.join(directory, `original.${extension || "doc"}`);
  try {
    await writeFile(input, await fetchBytes(url));
    const { stdout } = await execFileAsync("textutil", ["-convert", "txt", "-stdout", input], { maxBuffer: 8 * 1024 * 1024 });
    return decode(stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function extractOfficialDocumentText(url) {
  const extension = documentExtension(url);
  if (extension === "pdf") return extractPdfText(url);
  if (extension === "doc" || extension === "docx") return extractWordText(url);
  return "";
}

function officialDocumentAttachments(html, baseUrl) {
  const attachments = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = normalizeUrl(match[1], baseUrl);
    if (!url || !["pdf", "doc", "docx"].includes(documentExtension(url))) continue;
    attachments.push({ url, label: decode(match[2]) });
  }
  return attachments
    .filter((attachment, index, values) => values.findIndex((item) => item.url === attachment.url) === index)
    .sort((left, right) => Number(/原文|正文|通知全文|申报指南|附件/.test(right.label)) - Number(/原文|正文|通知全文|申报指南|附件/.test(left.label)))
    .slice(0, 5);
}

function verificationPriority(policy) {
  const title = decode(policy.title || "");
  const text = `${title} ${decode(policy.summary || "")} ${decode(policy.content || "")}`;
  const trackHits = verificationPriorityTerms.filter((term) => text.includes(term));
  const titleTrackHits = verificationPriorityTerms.filter((term) => title.includes(term));
  const explicitApplication = /(?:项目申报|申报指南|申报通知|申请条件|申报条件|征集公告)/.test(text);
  const support = /(?:资金|补助|补贴|奖励|资助|贴息|服务券|资格认定)/.test(text);
  const publishedAt = /^20\d{2}-\d{2}-\d{2}$/.test(policy.publishDate || "") ? Number((policy.publishDate || "").replaceAll("-", "")) : 0;
  return titleTrackHits.length * 100 + trackHits.length * 25 + (explicitApplication ? 45 : 0) + (support ? 12 : 0) + publishedAt / 100_000_000;
}

async function enrichPolicyDetails(policies) {
  // 可在本地快速验收时设为 0；生产同步优先验证最可能适用于溯驭、
  // 且明确存在申报动作的条目，避免索引页的随机顺序耗尽核验额度。
  const detailLimit = Math.max(0, Number.parseInt(process.env.POLICY_SYNC_DETAIL_LIMIT || "60", 10) || 0);
  for (const policy of policies) {
    policy.originalVerification = {
      verified: false,
      checkedAt: null,
      titleMatched: false,
      hasApplicationSignal: false,
      completedActivity: false,
      reason: "尚未完成官方原文核验",
    };
  }
  const verificationQueue = [...policies]
    .sort((left, right) => verificationPriority(right) - verificationPriority(left))
    .slice(0, detailLimit);
  for (const policy of verificationQueue) {
    try {
      const extension = documentExtension(policy.url);
      const checkedAt = new Date().toISOString();
      let detailHtml = "";
      let fullContent = "";
      let verification;
      const attachmentTexts = [];

      if (extension === "pdf" || extension === "doc" || extension === "docx") {
        fullContent = await extractOfficialDocumentText(policy.url);
        verification = verifyOriginalDocument(policy, fullContent, checkedAt);
      } else if (extension) {
        policy.originalVerification.reason = "官方原文格式不支持核验";
        continue;
      } else {
        detailHtml = await fetchText(policy.url);
        fullContent = decode(detailHtml.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "));
        verification = verifyOriginalDocument(policy, fullContent, checkedAt);

        // 附件只有在文本可重复提取、且通过同一套标题/申报信号验证时，
        // 才可以成为“查看已核验原文”的依据。不能读取或验证的附件不会上架。
        for (const attachment of officialDocumentAttachments(detailHtml, policy.url)) {
          try {
            const attachmentText = await extractOfficialDocumentText(attachment.url);
            if (!attachmentText) continue;
            const attachmentVerification = verifyOriginalDocument(policy, attachmentText, checkedAt);
            attachmentTexts.push(attachmentText);
            // Even when the wrapper page itself contains enough text to pass,
            // prefer a verified正文附件: it carries the actual deadline and is
            // the document the user should open from the project row.
            if (attachmentVerification.verified) {
              fullContent = attachmentText;
              verification = { ...attachmentVerification, attachmentUrl: attachment.url, attachmentLabel: attachment.label };
              break;
            }
          } catch { /* try the remaining official attachments */ }
        }
      }

      policy.originalVerification = verification || policy.originalVerification;
      policy.verifiedOriginalUrl = verification?.attachmentUrl || policy.url;
      // Some national notices contain a later deadline for provincial
      // departments to send recommendations. For a hand-curated notice whose
      // enterprise deadline has already been verified from the official text,
      // retain that enterprise-facing date instead of replacing it with the
      // administrative date.
      let deadline = policy.preserveDeadline && policy.deadline
        ? { date: policy.deadline, time: policy.deadlineTime || "" }
        : findDeadlineInfo(fullContent, policy.publishDate);
      if (!deadline.date) {
        for (const attachmentText of attachmentTexts) {
          deadline = findDeadlineInfo(attachmentText, policy.publishDate);
          if (deadline.date) break;
        }
      }
      policy.content = fullContent.slice(0, 60_000);
      policy.deadline = deadline.date || policy.deadline;
      policy.deadlineTime = deadline.time || policy.deadlineTime || "";
      policy.publishDate = policy.publishDate || findDate(fullContent);
      policy.summary = fullContent.slice(0, 220) || policy.summary;
    } catch {
      policy.originalVerification.reason = "官方原文无法读取或验证失败";
    }
  }
  return policies;
}

function collectPriorityOfficialNotices() {
  return enrichPolicyDetails(priorityOfficialNotices.map((policy) => ({ ...policy, firstSeenAt: new Date().toISOString() })));
}

async function collectSuzhou() {
  const endpoint = "https://www.suzhou.gov.cn/szinf/interfaceZcwjkAll/page";
  const text = await fetchText(endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "page=1&size=80" });
  const payload = JSON.parse(text);
  const rows = payload?.data?.records || payload?.data?.list || payload?.records || payload?.rows || [];
  const policies = rows.filter((row) => keywords.test(row.title || "") && !excludedTopics.test(row.title || "")).map((row) => {
    const url = normalizeUrl(row.url || row.linkUrl || "", "https://www.suzhou.gov.cn/");
    const title = decode(row.title);
    const content = decode(row.memo || row.content || "");
    const deadline = findDeadlineInfo(row.content || row.memo || "");
    return { id: stableId("suzhou", url, title), title, region: "苏州市", level: "市级", department: decode(row.fbjg) || "苏州市政府相关部门", publishDate: findDate(row.publishedTimeFormat || row.fwTimeFormat || ""), deadline: deadline.date, deadlineTime: deadline.time, category: "政策申报", summary: content.slice(0, 180), url, sourceName: "苏州市政策文件库", firstSeenAt: new Date().toISOString() };
  }).filter((item) => item.title && item.url);
  return enrichPolicyDetails(policies);
}

async function collectHtmlSource(source) {
  const html = await fetchText(source.url);
  const policies = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html)) && policies.length < 50) {
    const rawTitle = decode(match[2]);
    if (/活动日期|产销融通对接会|直播预告/.test(rawTitle)) continue;
    const title = rawTitle.replace(/^(?:申报中|未开始|进行中)\s*/, "").replace(/^审核认定\s+\S+\s+/, "").replace(/\s*申报日期[:：][\s\S]*$/, "").replace(/\s+NEW\s+发布时间[:：][\s\S]*$/i, "").replace(/\s+发文日期[:：][\s\S]*$/, "").replace(/\s+[a-f0-9]{32}$/i, "").trim();
    if (title.length < 8 || title.length > 150 || !keywords.test(title) || excludedTopics.test(title)) continue;
    if (source.directApplicationOnly && !directApplicationTitlePattern.test(title)) continue;
    const url = normalizeUrl(match[1], source.url);
    if (!url || !/^https?:/.test(url)) continue;
    const context = html.slice(Math.max(0, match.index - 120), Math.min(html.length, anchorPattern.lastIndex + 180));
    const explicitCity = rawTitle.match(/([\u4e00-\u9fff]{2,6}市)/)?.[1];
    const region = /杭州市|【杭州/.test(rawTitle) ? "杭州市" : /苏州市|【苏州/.test(rawTitle) ? "苏州市" : /连云港市|【连云港/.test(rawTitle) ? "连云港市" : explicitCity || source.region;
    policies.push({ id: stableId(source.id, url, title), title, region, level: region.endsWith("市") ? "市级" : source.level, department: source.name, publishDate: findDate(decode(context)), deadline: findDeadline(context), category: "政策申报", summary: "来自政府官方公开栏目的政策信息，请点击原文查看完整申报条件与材料要求。", url, sourceName: source.name, firstSeenAt: new Date().toISOString() });
  }
  return enrichPolicyDetails(policies);
}

function timestampToDate(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : "";
}

async function collectZhejiangEnterpriseApi() {
  const areas = [["33", "浙江省"], ["330100", "杭州市"], ["330102", "杭州市"], ["330105", "杭州市"], ["330106", "杭州市"], ["330108", "杭州市"], ["330109", "杭州市"], ["330110", "杭州市"], ["330111", "杭州市"], ["330112", "杭州市"], ["330113", "杭州市"], ["330114", "杭州市"], ["330122", "杭州市"], ["330127", "杭州市"], ["330182", "杭州市"]];
  const batches = await Promise.all(areas.map(async ([areaCode, region]) => {
    const policies = [];
    const url = new URL("https://hqpt.jxt.zj.gov.cn/gateway/provider-zcgj-ent/elastic/policy/search/query");
    Object.entries({ requestData: "true", pageNo: "1", pageSize: "100", sortColumn: "publishDate", declare: "true", showState: "2", areaCode }).forEach(([key, value]) => url.searchParams.set(key, value));
    const payload = JSON.parse(await fetchText(url.href));
    for (const row of payload?.result?.records || []) {
      const title = decode(row.policyTitle || row.title || "");
      const content = decode(row.interContent || row.content || "");
      const declaration = row.declareList?.find((item) => item.showState === 2) || {};
      const deadline = findDeadlineInfo(`${content} ${declaration.declareEndTime || ""}`);
      const original = row.policyOriginalFilePath || declaration.pcLink || "";
      if (!title || !original) continue;
      policies.push({ id: stableId(`zhejiang-enterprise-api-${areaCode}`, original, title), title, region, level: region === "杭州市" ? "市级" : "省级", department: decode(row.department || row.publishDept || "浙江省企业之家"), publishDate: row.publishDate || "", deadline: deadline.date, deadlineTime: deadline.time, category: decode(row.policyCategoryText || "政策申报"), summary: content.slice(0, 220), content, url: original, sourceName: "浙江省企业之家（申报中）", firstSeenAt: new Date().toISOString() });
    }
    return policies;
  }));
  return enrichPolicyDetails(batches.flat());
}

async function collectSuzhouEnterpriseApi() {
  const listUrl = "https://www.qyfw.suzhou.com.cn/gateway/policy/api/ua/policy/today-declare?current=1&size=100";
  const payload = JSON.parse(await fetchText(listUrl));
  const rows = payload?.data?.records || [];
  const policies = await Promise.all(rows.map(async (row) => {
    const detailPayload = JSON.parse(await fetchText(`https://www.qyfw.suzhou.com.cn/gateway/policy/api/ua/policy/detail?id=${encodeURIComponent(row.id)}`));
    const detail = detailPayload?.data || row;
    const title = decode(detail.title || row.title || "");
    const content = decode(detail.content || row.policySystemDesc || "");
    const dateText = `${detail.declarationDate || row.declarationDate || ""} ${(detail.declarationDateList || row.declarationDateList || []).map((item) => typeof item === "string" ? item : JSON.stringify(item)).join(" ")}`;
    const deadline = findDeadlineInfo(`${content} ${dateText}`);
    const sourceUrl = suzhouOriginalUrl(detail);
    // Do not expose an API JSON endpoint as "查看原文". A record without an
    // independently verifiable original is held back until its source file is
    // supplied by the official platform.
    if (!title || !sourceUrl) return null;
    return { id: stableId("suzhou-enterprise-api", String(row.id), title), title, region: decode(detail.city || "苏州市").includes("苏州") ? "苏州市" : "江苏省", level: "市级", department: decode(detail.department || row.department || "苏州市企业服务平台"), publishDate: findDate(detail.publishTime || row.publishTime || ""), deadline: deadline.date, deadlineTime: deadline.time, category: decode(detail.categoryDesc || row.categoryDesc || "政策申报"), summary: content.slice(0, 220), content, url: sourceUrl, sourceName: "苏州市企业服务平台（申报中）", firstSeenAt: new Date().toISOString() };
  }));
  return enrichPolicyDetails(policies.filter(Boolean));
}

function collectStructuredXml(xml, source) {
  const policies = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*title=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = pattern.exec(xml)) && policies.length < 100) {
    const title = decode(match[2]);
    if (!title || excludedTopics.test(title)) continue;
    const context = xml.slice(Math.max(0, match.index - 180), Math.min(xml.length, pattern.lastIndex + 180));
    policies.push({ id: stableId(source.id, match[1], title), title, region: source.region, level: source.level, department: source.name, publishDate: findDate(decode(context)), deadline: findDeadline(context), category: "政策申报", summary: "来自官方机器可读通知索引，已保留原文入口供核验申报条件。", url: normalizeUrl(match[1], source.baseUrl), sourceName: source.name, firstSeenAt: new Date().toISOString() });
  }
  return enrichPolicyDetails(policies.filter((item) => item.url));
}

async function collectJiangsuMiitXml() {
  const url = "https://gxt.jiangsu.gov.cn/module/web/jpage/dataproxy.jsp?page=1&appid=1&webid=23&path=/&columnid=6278&unitid=403981&webname=%25E6%25B1%259F%25E8%258B%258F%25E7%259C%2581%25E5%25B7%25A5%25E4%25B8%259A%25E5%2592%258C%25E4%25BF%25A1%25E6%2581%25AF%25E5%258C%2596%25E5%258E%2585&permissiontype=0";
  return collectStructuredXml(await fetchText(url), { id: "jiangsu-miit-xml", name: "江苏省工业和信息化厅（结构化通知）", region: "江苏省", level: "省级", baseUrl: "https://gxt.jiangsu.gov.cn/" });
}

async function collectMostNotices() {
  const sourceUrl = "https://service.most.gov.cn/kjjh_tztg/";
  const html = await fetchText(sourceUrl);
  const policies = [];
  const pattern = /<div\b[^>]*onclick=["']window\.parent\.openW\('([^']+)'\)["'][^>]*title=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = pattern.exec(html)) && policies.length < 80) {
    const title = decode(match[2]);
    if (!title || excludedTopics.test(title)) continue;
    const context = html.slice(Math.max(0, match.index - 220), Math.min(html.length, pattern.lastIndex + 240));
    const url = normalizeUrl(match[1], sourceUrl);
    policies.push({ id: stableId("most-notices", url, title), title, region: "国家", level: "国家级", department: "科学技术部", publishDate: findDate(decode(context)), deadline: findDeadline(context), category: "国家科技计划", summary: "来自科学技术部公开通知目录，已保留原文入口以核验申报条件、附件和截止时间。", url, sourceName: "科学技术部科技计划通知", firstSeenAt: new Date().toISOString() });
  }
  return enrichPolicyDetails(policies);
}

async function collectHangzhouTechApi() {
  const payload = JSON.parse(await fetchText("https://sti.kj.hangzhou.gov.cn/technology-brain-web/tech/policyLaw/listPage", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "dataType=2&pageNum=1&numPerPage=80&order=2" }));
  const policies = (payload?.data?.recordList || []).map((row) => {
    const title = decode(row.title || "");
    const content = decode(row.context || "");
    const deadline = findDeadlineInfo(content);
    return { id: stableId("hangzhou-tech-api", row.detailUrl || String(row.id), title), title, region: row.levelType === 1 ? "国家" : row.levelType === 2 ? "浙江省" : "杭州市", level: decode(row.levelTypeName || "市级"), department: decode(row.publishDepart || "杭州市科学技术局"), publishDate: timestampToDate(row.publishDate), deadline: deadline.date, deadlineTime: deadline.time, category: "科技项目通知", summary: content.slice(0, 220), content, url: row.detailUrl || "https://sti.kj.hangzhou.gov.cn/technology-brain-web/searchList/newPolicy?dataType=2", sourceName: "杭州市科技创新服务平台", firstSeenAt: new Date().toISOString() };
  }).filter((item) => item.title && item.url);
  return enrichPolicyDetails(policies);
}

export function dedupe(items) {
  const seen = new Map();
  for (const item of items) {
    const key = item.url.replace(/\/$/, "") || `${item.region}|${item.title}`;
    const existing = seen.get(key);
    if (!existing || (!existing.publishDate && item.publishDate)) seen.set(key, item);
  }
  return [...seen.values()].sort((a, b) => (b.publishDate || b.firstSeenAt).localeCompare(a.publishDate || a.firstSeenAt));
}

async function loadCompanyProfile() {
  try {
    const profile = JSON.parse(await readFile(companyProfilePath, "utf8"));
    return profile?.matcherProfile ? profile : null;
  } catch {
    // A missing or malformed profile must not stop a policy refresh. The
    // matcher will use document-only evidence and mark no profile conditions.
    return null;
  }
}

async function loadLastUsableFeed() {
  // A temporary outage at multiple government sites must never be interpreted
  // as “there are no projects”. Prefer the richest previously-built feed,
  // including the local build artifact when the public copy was already
  // replaced by a failed refresh.
  const candidates = [outputPath, path.resolve(process.cwd(), "dist/client/policies.json")];
  let best = null;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await readFile(candidate, "utf8"));
      if (!Array.isArray(parsed?.policies) || !parsed.policies.length) continue;
      const size = Number(parsed.candidateCount || 0) || parsed.policies.length + (parsed.filteredPolicies?.length || 0);
      if (!best || size > best.size) best = { payload: parsed, size };
    } catch { /* no previous feed at this path */ }
  }
  return best?.payload || null;
}

function uniqueByPolicyId(policies) {
  const seen = new Set();
  return policies.filter((policy) => {
    const key = policy.id || `${policy.url || ""}|${policy.title || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  const results = [];
  const sourceStatus = [];
  const collectors = [
    { id: "priority-official-notices", name: "重点官方申报通知", run: collectPriorityOfficialNotices },
    { id: "suzhou", name: "苏州市政策文件库", run: collectSuzhou },
    { id: "suzhou-enterprise-api", name: "苏州市企业服务平台申报事项", run: collectSuzhouEnterpriseApi },
    { id: "jiangsu-miit-xml", name: "江苏省工业和信息化厅结构化通知", run: collectJiangsuMiitXml },
    { id: "most-notices", name: "科学技术部科技计划通知", run: collectMostNotices },
    { id: "zhejiang-enterprise-api", name: "浙江省企业之家申报事项", run: collectZhejiangEnterpriseApi },
    { id: "hangzhou-tech-api", name: "杭州市科技创新服务平台", run: collectHangzhouTechApi },
    ...htmlSources.map((source) => ({ id: source.id, name: source.name, run: () => collectHtmlSource(source) })),
  ];
  const completed = await Promise.all(collectors.map(async (collector) => {
    try {
      const policies = await collector.run();
      return { policies, status: { id: collector.id, name: collector.name, ok: true, count: policies.length } };
    } catch (error) {
      return { policies: [], status: { id: collector.id, name: collector.name, ok: false, count: 0, error: error instanceof Error ? error.message : String(error) } };
    }
  }));
  for (const item of completed) { results.push(...item.policies); sourceStatus.push(item.status); }
  // Every row, including hand-curated seed rows, must carry an explicit
  // original-document verification result. The matcher treats a missing or
  // failed verification as a holdback, never as a reason to guess that the
  // link is a usable application notice.
  const candidates = dedupe([...fixedPolicies, ...results]).map((policy) => ({
    ...policy,
    originalVerification: policy.originalVerification || {
      verified: false,
      checkedAt: null,
      titleMatched: false,
      hasApplicationSignal: false,
      completedActivity: false,
      reason: "尚未完成官方原文核验",
    },
  }));
  const companyProfile = await loadCompanyProfile();
  const audit = auditPolicies(candidates, new Date(), companyProfile);
  const sourceSuccesses = sourceStatus.filter((source) => source.ok).length;
  const freshVisible = audit.filter((policy) => policy.visible);
  const lastUsableFeed = freshVisible.length || sourceSuccesses >= 5 ? null : await loadLastUsableFeed();
  let policies;
  let filteredPolicies;
  let outputAudit;
  let recoveredFromLastFeed = false;

  if (lastUsableFeed) {
    // Re-apply current rules to the prior displayed items. This lets a new
    // subject-mapping rule remove a bad row even while upstream pages are
    // temporarily unavailable, without attempting to re-promote old filtered
    // records whose full original body is no longer retained locally.
    const carriedAudit = auditPolicies(lastUsableFeed.policies, new Date(), companyProfile);
    policies = carriedAudit.filter((policy) => policy.visible);
    filteredPolicies = uniqueByPolicyId([
      ...(lastUsableFeed.filteredPolicies || []),
      ...carriedAudit.filter((policy) => !policy.visible),
      ...audit.filter((policy) => !policy.visible),
    ]).map((policy) => {
      const filteredPolicy = { ...policy };
      delete filteredPolicy.content;
      return filteredPolicy;
    });
    outputAudit = [...policies, ...filteredPolicies];
    recoveredFromLastFeed = true;
    console.warn(`Policy sources degraded (${sourceSuccesses}/${sourceStatus.length}); retained ${policies.length} previously verified active policies.`);
  } else {
    policies = freshVisible;
    // 不再丢弃未通过项；保留结构化判定和原文证据摘要，供规则调优。
    filteredPolicies = audit.filter((policy) => !policy.visible).map((policy) => {
      const filteredPolicy = { ...policy };
      delete filteredPolicy.content;
      return filteredPolicy;
    });
    outputAudit = audit;
  }
  const decisionCounts = outputAudit.reduce((counts, policy) => {
    const decision = policy.decision || "ineligible";
    counts[decision] = (counts[decision] || 0) + 1;
    return counts;
  }, {});
  const payload = {
    updatedAt: new Date().toISOString(),
    policySchemaVersion: 3,
    decisionStatuses: ["matched", "opportunity", "ineligible"],
    policies,
    filteredPolicies,
    candidateCount: outputAudit.length,
    filteredCount: filteredPolicies.length,
    decisionCounts,
    recoveredFromLastFeed,
    companyProfile: companyProfile ? {
      profileId: companyProfile.profileId || null,
      generatedAt: companyProfile.generatedAt || null,
      verifiedFieldCount: companyProfile.validation?.verifiedFieldCount ?? null,
      unknownFieldCount: companyProfile.validation?.unknownFieldCount ?? null,
    } : null,
    sources: sourceStatus,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempPath, outputPath);
  console.log(`Policy sync complete: ${payload.policies.length} policies, ${sourceStatus.filter((source) => source.ok).length}/${sourceStatus.length} sources available.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
