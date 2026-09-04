import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectDocumentType, extractDocumentText } from "./document-text.mjs";
import { assertViablePolicyFeed, buildPolicyFeed } from "./policy-feed.mjs";

const outputPath = path.resolve(process.cwd(), "public/policies.json");
const deployedOutputPath = path.resolve(process.cwd(), "dist/client/policies.json");
const companyProfilePath = path.resolve(process.cwd(), "public/company-profile.json");
const keywords = /(申报|征集|补助|补贴|奖励|扶持|资助|资金|科技|研发|创新|中小企业|专精特新|高新技术)/;
const excludedTopics = /(基础教育|教学改革|卫生高级职称|失能老年人|竞技体育|非盈利性工程建设|行政决策事项|民生实事)/;
const completedActivityPattern = /(?:成功举办|圆满举办|顺利举办|活动回顾|工作动态|经验交流|会议纪要)/;
const applicationDocumentPattern = /(?:项目申报|申报指南|申报主体|申报条件|申报要求|申请条件|申请主体|征集公告|申报通知|受理时间)/;
const corePriorityPattern = /(?:氢能|燃料电池|制氢|储氢|电控|电力电子|能量管理|功率控制|碳化硅|低空经济|无人机|飞控|新型储能|新型电力系统|微电网|源网荷储|绿色低碳|智能制造|技术改造|专精特新|高新技术企业)/i;

function paginatedListUrls(url, pages) {
  const match = url.match(/^(.*\/)([^/?#]+)(\.[a-z]+)$/i);
  if (!match) return [url];
  return [url, ...Array.from({ length: Math.max(0, pages - 1) }, (_, index) => `${match[1]}${match[2]}_${index + 1}${match[3]}`)];
}

const htmlSources = [
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

const hangzhouIncubatorManagementOfficialText = `杭州市科学技术局关于印发《杭州市科技企业孵化器管理办法》的通知。杭科高〔2023〕118号。各区、县（市）科技局，各有关单位：现印发《杭州市科技企业孵化器管理办法》，请遵照执行。\n\n杭州市科技企业孵化器管理办法\n\n市级孵化器是促进科技成果转化、培育科技企业的科技创业服务机构。申请认定市级孵化器的运营主体应依法登记注册；在孵企业主要从事新技术、新产品的研发、生产和服务，或开展高价值科技成果转化，满足科技型中小企业相关要求。\n\n三、申报与管理\n（一）认定程序。1. 在线申报。孵化器运营主体通过孵化器数字管理平台在线提出申请，并提交相应申报材料。2. 审核推荐。各地科技管理部门对申报材料进行审核，向市科技局提交核查报告和推荐名单。3. 复审核验。市科技局对推荐名单进行复核，必要时组织专家进行现场考察。4. 公示发文。\n\n四、扶持政策\n（一）运营资助。对年度绩效评价为五星、四星等次的市级孵化器，按照五星30万元、四星20万元给予运营资助。\n（二）绩效奖励。对年度绩效评价为三星及以上等次的市级孵化器，孵化企业在孵期间或毕业后1年内通过高新技术企业和技术先进型服务企业备案的，给予所在市级孵化器每家不超过15万元的绩效奖励。\n（三）升级奖励。对市级孵化器新升级为省级孵化器的，给予不超过50万元一次性奖励，从省级孵化器升级为国家级孵化器的，再给予不超过50万元一次性奖励。\n\n五、促进与发展。鼓励孵化“飞地”建设，支持行业龙头企业、高校、科研院所、新型研发机构、投资机构等开展垂直孵化，推动大中小企业融通发展。\n\n六、附则。本办法自2024年1月26日起施行，有效期至2027年12月31日。`;

const fixedPolicies = [
  { id: "hangzhou-runmiao", title: "实施“润苗计划”陪伴式扶持科技型初创企业高质量发展", region: "杭州市", level: "市级", department: "杭州市人民政府办公厅", publishDate: "2025-10-14", deadline: "", category: "科技创新", summary: "面向科技型初创企业建立种子企业、好苗子企业梯度培育和政策支持体系。", url: "https://zfgb.hangzhou.gov.cn/10/110220253/t114220253104/529697.shtml", sourceName: "杭州市人民政府公报", firstSeenAt: new Date().toISOString() },
  { id: "hangzhou-incubator-management-2024", title: "杭州市科学技术局关于印发《杭州市科技企业孵化器管理办法》的通知", region: "杭州市", level: "市级", department: "杭州市科学技术局", publishDate: "2023-12-26", deadline: "", category: "科技创新", summary: "市级孵化器运营主体可在线申报认定；办法包含运营资助、绩效奖励和升级奖励，自2024年1月26日起施行，有效期至2027年12月31日。", pinnedOriginalContent: hangzhouIncubatorManagementOfficialText, url: "https://zfgb.hangzhou.gov.cn/11/105220253/t117220253054/518591.shtml", sourceName: "杭州市人民政府公报（固定官方原文）", firstSeenAt: new Date().toISOString() },
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

function compactText(value = "") {
  return decode(value).replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase();
}

function verifyOriginalDocument(policy, content, checkedAt) {
  const title = compactText(policy.title);
  const body = compactText(content);
  const titleMatched = title.length >= 8 && body.includes(title);
  const completedActivity = completedActivityPattern.test(`${policy.title || ""} ${content}`);
  const hasApplicationSignal = applicationDocumentPattern.test(content);
  // 只要官方页面/附件成功读取就是 parsed。标题一致性、申报关键词和
  // 已举办活动只作为诊断信息，不再是“可申报”的隐性前置条件。
  return {
    verified: true,
    retrievalStatus: "parsed",
    checkedAt,
    titleMatched,
    hasApplicationSignal,
    completedActivity,
    diagnostics: { titleMatched, hasApplicationSignal, completedActivity },
    reason: "已读取官方原文",
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

function policyPriority(policy, now = new Date()) {
  const { year: shanghaiYear, iso: today } = shanghaiDate(now);
  const text = `${policy.title || ""} ${policy.summary || ""} ${policy.department || ""} ${policy.region || ""}`;
  const currentYear = policy.publishDate?.startsWith(shanghaiYear) || text.includes(shanghaiYear);
  const stillOpen = policy.deadline && policy.deadline >= today;
  const targetRegion = text.includes("吴江") ? 600 : text.includes("苏州") ? 500 : text.includes("江苏") ? 400 : 0;
  return (stillOpen ? 1200 : 0) + (currentYear ? 1000 : 0) + targetRegion + (corePriorityPattern.test(text) ? 350 : 0) + Number(policy.publishDate?.replaceAll("-", "") || 0) / 100_000_000;
}

async function enrichPolicyDetail(policy) {
  const checkedAt = new Date().toISOString();
  try {
    if (policy.pinnedOriginalContent) {
      const fullContent = String(policy.pinnedOriginalContent);
      policy.originalVerification = verifyOriginalDocument(policy, fullContent, checkedAt);
      const deadline = findDeadlineInfo(fullContent);
      policy.content = fullContent.slice(0, 120_000);
      policy.deadline = deadline.date || policy.deadline;
      policy.deadlineTime = deadline.time || policy.deadlineTime || "";
      policy.publishDate = policy.publishDate || findDate(fullContent);
      policy.summary = fullContent.slice(0, 220) || policy.summary;
      delete policy.pinnedOriginalContent;
      return "parsed";
    }
    if (/\.(xlsx?|zip)(?:\?|$)/i.test(policy.url)) {
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
      fullContent = decode(detailHtml.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "));
      const attachmentUrls = [...detailHtml.matchAll(/href=["']([^"']+\.(?:pdf|docx?|PDF|DOCX?)(?:\?[^"']*)?)["']/g)]
        .map((match) => normalizeUrl(match[1], resource.finalUrl || policy.url))
        .filter(Boolean)
        .filter((url, index, all) => all.indexOf(url) === index)
        .slice(0, 3);
      const attachmentText = [];
      for (const attachmentUrl of attachmentUrls) {
        try {
          attachmentText.push(await parseDocumentResource(attachmentUrl));
        } catch { /* the HTML body is still a successfully parsed official source */ }
      }
      if (attachmentText.length) fullContent = `${fullContent}\n${attachmentText.join("\n")}`;
    }
    if (!fullContent.trim()) throw new Error("官方原文未提取到可用文字");
    policy.originalVerification = verifyOriginalDocument(policy, fullContent, checkedAt);
    const deadline = findDeadlineInfo(fullContent);
    policy.content = fullContent.slice(0, 120_000);
    policy.deadline = deadline.date || policy.deadline;
    policy.deadlineTime = deadline.time || policy.deadlineTime || "";
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
  for (const policy of policies) {
    policy.originalVerification = {
      verified: false,
      retrievalStatus: "not_checked",
      checkedAt: null,
      titleMatched: false,
      hasApplicationSignal: false,
      completedActivity: false,
      diagnostics: { titleMatched: false, hasApplicationSignal: false, completedActivity: false },
      reason: "尚未读取官方原文，已放入待查",
    };
  }
  const configuredLimit = Number.parseInt(process.env.POLICY_SYNC_DETAIL_LIMIT || "240", 10);
  const configuredDetailLimit = Number.isFinite(configuredLimit) ? Math.max(0, Math.min(policies.length, configuredLimit)) : Math.min(policies.length, 240);
  const detailLimit = Number.isFinite(requestedLimit) ? Math.max(0, Math.min(policies.length, requestedLimit)) : configuredDetailLimit;
  const queue = [...policies].sort((a, b) => policyPriority(b) - policyPriority(a)).slice(0, detailLimit);
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

async function enrichVisibleReviewPolicies(candidates, sourceStatus, companyProfile) {
  // The first detail pass is intentionally capped so a large public index does
  // not overload government sites. That cap must never leave an otherwise
  // page-worthy policy permanently in "待查" just because it was published
  // before the current year. Re-read the small visible review queue, then let
  // the matcher make its decision from the official original.
  const preliminary = buildPolicyFeed(candidates, sourceStatus, companyProfile, new Date());
  const reviewIds = new Set(
    preliminary.policies
      .filter((policy) => policy.decision === "needs_review" && policy.originalVerification?.retrievalStatus === "not_checked")
      .map((policy) => policy.id),
  );
  const configuredLimit = Number.parseInt(process.env.POLICY_VISIBLE_REVIEW_DETAIL_LIMIT || "60", 10);
  const limit = Number.isFinite(configuredLimit) ? Math.max(0, Math.min(120, configuredLimit)) : 60;
  const queue = candidates
    .filter((policy) => reviewIds.has(policy.id))
    .sort((left, right) => visibleReviewPriority(right) - visibleReviewPriority(left))
    .slice(0, limit);
  if (queue.length) await enrichPolicyDetails(queue, { limit: queue.length });
}

function visibleReviewPriority(policy) {
  const title = String(policy.title || "");
  const directDocument = /\.(?:pdf|docx?)(?:[?#]|$)/i.test(String(policy.url || ""));
  // These are standing support policies rather than annual calls. Their
  // publication date is often old, so the general current-year priority alone
  // would starve them behind a large number of fresh, unverified notices.
  const standingPolicy = /(?:政策|办法|措施|意见|规划)/.test(title)
    && !/(?:\d{4}年度|申报|申请|征集|认定|推荐|评选|遴选|填报|报送)/.test(title);
  return policyPriority(policy) + (standingPolicy ? 900 : 0) + (directDocument ? 300 : 0);
}

async function collectSuzhou() {
  const endpoint = "https://www.suzhou.gov.cn/szinf/interfaceZcwjkAll/page";
  const { year } = shanghaiDate();
  const searchTerms = ["申报", "征集", "认定", "补助", "奖励", "氢能", "低空"];
  const payloads = await Promise.all(searchTerms.map((title) => fetchText(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ page: "1", size: "200", titleType: "2", year, title }).toString(),
  }).then((text) => JSON.parse(text))));
  const rows = payloads.flatMap((payload) => payload?.data?.records || payload?.data?.list || payload?.records || payload?.rows || []);
  const policies = rows.filter((row) => keywords.test(row.title || "") && !excludedTopics.test(row.title || "")).map((row) => {
    const url = normalizeUrl(row.url || row.linkUrl || "", "https://www.suzhou.gov.cn/");
    const title = decode(row.title);
    const content = decode(row.memo || row.content || "");
    const deadline = findDeadlineInfo(row.content || row.memo || "");
    return { id: stableId("suzhou", url, title), title, region: "苏州市", level: "市级", department: decode(row.fbjg) || "苏州市政府相关部门", publishDate: findDate(row.publishedTimeFormat || row.fwTimeFormat || ""), deadline: deadline.date, deadlineTime: deadline.time, category: "政策申报", summary: content.slice(0, 180), url, sourceName: "苏州市政策文件库", firstSeenAt: new Date().toISOString() };
  }).filter((item) => item.title && item.url);
  return dedupe(policies);
}

async function collectHtmlSource(source) {
  const policies = [];
  for (const sourceUrl of source.urls || [source.url]) {
    const html = await fetchText(sourceUrl);
    const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = anchorPattern.exec(html)) && policies.length < 160) {
      const rawTitle = decode(match[2]);
      if (/活动日期|产销融通对接会|直播预告/.test(rawTitle)) continue;
      const title = rawTitle.replace(/^(?:申报中|未开始|进行中)\s*/, "").replace(/^审核认定\s+\S+\s+/, "").replace(/\s*申报日期[:：][\s\S]*$/, "").replace(/\s+NEW\s+发布时间[:：][\s\S]*$/i, "").replace(/\s+发文日期[:：][\s\S]*$/, "").replace(/\s+[a-f0-9]{32}$/i, "").trim();
      if (title.length < 8 || title.length > 150 || !keywords.test(title) || excludedTopics.test(title)) continue;
      const url = normalizeUrl(match[1], sourceUrl);
      if (!url || !/^https?:/.test(url)) continue;
      const context = html.slice(Math.max(0, match.index - 120), Math.min(html.length, anchorPattern.lastIndex + 180));
      const explicitCity = rawTitle.match(/([\u4e00-\u9fff]{2,6}市)/)?.[1];
      const region = /吴江区|吴江/.test(`${rawTitle} ${source.name}`) ? "苏州市" : /杭州市|【杭州/.test(rawTitle) ? "杭州市" : /苏州市|【苏州/.test(rawTitle) ? "苏州市" : /连云港市|【连云港/.test(rawTitle) ? "连云港市" : explicitCity || source.region;
      policies.push({ id: stableId(source.id, url, title), title, region, level: source.level || (region.endsWith("市") ? "市级" : "省级"), department: source.name, publishDate: findDate(decode(context)), deadline: findDeadline(context), category: "政策申报", summary: "来自政府官方公开栏目的政策信息，请点击原文查看完整申报条件与材料要求。", url, sourceName: source.name, firstSeenAt: new Date().toISOString() });
    }
  }
  return dedupe(policies);
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
  return batches.flat();
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
  return policies.filter(Boolean);
}

function collectStructuredXml(xml, source) {
  const policies = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(xml)) && policies.length < 100) {
    const attributes = match[1];
    const href = attributes.match(/\bhref=["']([^"']+)["']/i)?.[1] || "";
    const title = decode(attributes.match(/\btitle=["']([^"']+)["']/i)?.[1] || match[2]);
    if (!title || excludedTopics.test(title)) continue;
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
  const pageCount = Math.min(pageLimit, Math.max(1, reportedPages));
  const pages = [firstXml];
  for (let page = 2; page <= pageCount; page += 1) {
    const params = new URLSearchParams(firstParams);
    params.set("page", String(page));
    pages.push(await fetchText(`${endpoint}?${params}`, { headers }));
  }
  return dedupe(pages.flatMap((xml) => collectStructuredXml(xml, { ...source, baseUrl: `${source.host}/` })));
}

async function collectWujiangApi() {
  const { year } = shanghaiDate();
  const terms = ["申报", "征集", "遴选", "推荐", "补贴", "补助", "奖励", "资金", "项目"];
  const policies = [];
  for (const term of terms) {
    const url = new URL("https://www.wujiang.gov.cn/appsearch/wjapi/list");
    url.searchParams.set("keywords", term);
    url.searchParams.set("sdate", `${year}-01-01`);
    url.searchParams.set("edate", `${year}-12-31`);
    const body = new URLSearchParams({ currentPage: "1", pageSize: "100", pid: "" }).toString();
    const payload = JSON.parse(await fetchText(url.href, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }));
    for (const row of payload?.data?.list || []) {
      const title = decode(row.title || "");
      const original = normalizeUrl(row.redirect_url || row.url || "", "https://www.wujiang.gov.cn/");
      if (!title || !original || excludedTopics.test(title)) continue;
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
  return dedupe(policies);
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
  return policies;
}

async function collectHangzhouTechApi() {
  const payload = JSON.parse(await fetchText("https://sti.kj.hangzhou.gov.cn/technology-brain-web/tech/policyLaw/listPage", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "dataType=2&pageNum=1&numPerPage=80&order=2" }));
  const policies = (payload?.data?.recordList || []).map((row) => {
    const title = decode(row.title || "");
    const content = decode(row.context || "");
    const deadline = findDeadlineInfo(content);
    return { id: stableId("hangzhou-tech-api", row.detailUrl || String(row.id), title), title, region: row.levelType === 1 ? "国家" : row.levelType === 2 ? "浙江省" : "杭州市", level: decode(row.levelTypeName || "市级"), department: decode(row.publishDepart || "杭州市科学技术局"), publishDate: timestampToDate(row.publishDate), deadline: deadline.date, deadlineTime: deadline.time, category: "科技项目通知", summary: content.slice(0, 220), content, url: row.detailUrl || "https://sti.kj.hangzhou.gov.cn/technology-brain-web/searchList/newPolicy?dataType=2", sourceName: "杭州市科技创新服务平台", firstSeenAt: new Date().toISOString() };
  }).filter((item) => item.title && item.url);
  return policies;
}

function dedupe(items) {
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
    await writeJsonAtomically(deployedOutputPath, payload);
  } catch {
    // No production build yet, which is normal during local development.
  }
}

async function assertSourceHealth(payload) {
  // Do not replace a healthy published feed with a much smaller one merely
  // because several government gateways temporarily rate-limit this run.
  // First deployments and genuinely small source sets remain valid.
  try {
    const previous = JSON.parse(await readFile(outputPath, "utf8"));
    const previousAvailable = (previous.sources || []).filter((source) => source.ok).length;
    const currentAvailable = (payload.sources || []).filter((source) => source.ok).length;
    const minimumRetained = Math.max(6, Math.ceil(previousAvailable * 0.7));
    if (previousAvailable >= 10 && currentAvailable < minimumRetained && currentAvailable <= previousAvailable - 5) {
      throw new Error(`Source availability fell from ${previousAvailable} to ${currentAvailable}; keeping the last healthy policy feed instead of publishing a partial refresh.`);
    }
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.code === "ENOENT")) return;
    throw error;
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
        completed[index] = { policies, status: { id: collector.id, name: collector.name, ok: true, count: policies.length } };
      } catch (error) {
        completed[index] = { policies: [], status: { id: collector.id, name: collector.name, ok: false, count: 0, error: error instanceof Error ? error.message : String(error) } };
      }
    }
  }));
  return completed;
}

async function main() {
  const results = [];
  const sourceStatus = [];
  const collectors = [
    { id: "suzhou", name: "苏州市政策文件库", run: collectSuzhou },
    { id: "wujiang-api", name: "苏州市吴江区人民政府政策搜索", run: collectWujiangApi },
    { id: "suzhou-enterprise-api", name: "苏州市企业服务平台申报事项", run: collectSuzhouEnterpriseApi },
    { id: "most-notices", name: "科学技术部科技计划通知", run: collectMostNotices },
    { id: "zhejiang-enterprise-api", name: "浙江省企业之家申报事项", run: collectZhejiangEnterpriseApi },
    { id: "hangzhou-tech-api", name: "杭州市科技创新服务平台", run: collectHangzhouTechApi },
    ...jiangsuStructuredSources.map((source) => ({ id: source.id, name: source.name, run: () => collectJiangsuStructured(source) })),
    ...htmlSources.map((source) => ({ id: source.id, name: source.name, run: () => collectHtmlSource(source) })),
  ];
  const completed = await collectOfficialSources(collectors);
  for (const item of completed) { results.push(...item.policies); sourceStatus.push(item.status); }
  // Collect all indexes first, then deduplicate globally and enrich one shared
  // priority queue. This prevents each source's arbitrary first page from using
  // up the detail budget before current Jiangsu/Suzhou/Wujiang records.
  const candidates = await enrichPolicyDetails(dedupe([...fixedPolicies, ...results]));
  const companyProfile = await loadCompanyProfile();
  await enrichVisibleReviewPolicies(candidates, sourceStatus, companyProfile);
  const payload = assertViablePolicyFeed(buildPolicyFeed(candidates, sourceStatus, companyProfile, new Date()));
  await assertSourceHealth(payload);
  await writePolicyOutputs(payload);
  console.log(`Policy sync complete: ${payload.policies.length} reviewable policies (${payload.decisionCounts.eligible} eligible, ${payload.decisionCounts.supplier_call} supplier calls, ${payload.decisionCounts.needs_review} needs review; ${payload.discardedCount} directly discarded), ${sourceStatus.filter((source) => source.ok).length}/${sourceStatus.length} sources available.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
