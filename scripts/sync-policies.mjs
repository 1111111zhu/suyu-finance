import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { auditPolicies } from "./policy-matcher.mjs";

const outputPath = path.resolve(process.cwd(), "public/policies.json");
const tempPath = `${outputPath}.tmp`;
const keywords = /(申报|征集|补助|补贴|奖励|扶持|资助|资金|科技|研发|创新|中小企业|专精特新|高新技术)/;
const excludedTopics = /(基础教育|教学改革|卫生高级职称|失能老年人|竞技体育|非盈利性工程建设|行政决策事项|民生实事)/;

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
  { id: "jiangsu-scitech", name: "江苏省科学技术厅", region: "江苏省", level: "省级", url: "https://kjt.jszwfw.gov.cn/" },
  { id: "jiangsu-miit", name: "江苏省工业和信息化厅文件通知", region: "江苏省", level: "省级", url: "https://gxt.jiangsu.gov.cn/col/col6278/index.html" },
  { id: "suzhou-scitech", name: "苏州市科学技术局通知公告", region: "苏州市", level: "市级", url: "https://kjj.suzhou.gov.cn/szkj/tzgg/tzgg.shtml" },
  { id: "jiangsu", name: "江苏省人民政府文件", region: "江苏省", level: "省级", url: "https://www.jiangsu.gov.cn/col/col76841/index.html" },
  { id: "lianyungang", name: "连云港市政府规范性文件", region: "连云港市", level: "市级", url: "https://www.lyg.gov.cn/zglygzfmhwz/szfgfxwj1/szfgfxwj1.shtml" },
  { id: "lianyungang-scitech", name: "连云港市科学技术局通知公告", region: "连云港市", level: "市级", url: "http://kjj.lyg.gov.cn/lygskxjsj/tzgg/tzgg.html" },
  { id: "lianyungang-projects", name: "连云港市政府科技项目", region: "连云港市", level: "市级", url: "https://www.lyg.gov.cn/zglygzfmhwz/kjxm/kjxm.shtml" },
  { id: "lianyungang-market", name: "连云港市市场监督管理局通知", region: "连云港市", level: "市级", url: "https://www.lyg.gov.cn/zglygzfmhwz/sczrjjg/sczrjjg.html" },
];

const fixedPolicies = [{ id: "hangzhou-runmiao", title: "实施“润苗计划”陪伴式扶持科技型初创企业高质量发展", region: "杭州市", level: "市级", department: "杭州市人民政府办公厅", publishDate: "2025-10-14", deadline: "", category: "科技创新", summary: "面向科技型初创企业建立种子企业、好苗子企业梯度培育和政策支持体系。", url: "https://zfgb.hangzhou.gov.cn/10/110220253/t114220253104/529697.shtml", sourceName: "杭州市人民政府公报", firstSeenAt: new Date().toISOString() }];

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
  const matches = [...compact.matchAll(/(?:截至|截止(?:时间)?(?:为|至|到)?|申报时间|受理时间|系统关闭)[^。；]{0,60}(20\d{2}[年.\/-]\d{1,2}[月.\/-]\d{1,2}日?)(?:\s*(\d{1,2})[:：](\d{2}))?/g)].map((match) => ({ date: findDate(match[1]), time: match[2] ? `${match[2].padStart(2, "0")}:${match[3]}` : "" })).filter((value) => value.date);
  return matches.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).at(-1) || { date: "", time: "" };
}
const findDeadline = (text) => findDeadlineInfo(text).date;

async function fetchText(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36", "accept-language": "zh-CN,zh;q=0.9", ...(init.headers || {}) } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBytes(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": "PolicyRadar/1.0 (+low-frequency public policy indexer)" } });
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

async function enrichPolicyDetails(policies) {
  // 可在本地快速验收时设为 0；生产的日常同步仍默认补抓 30 篇正文/附件。
  const detailLimit = Math.max(0, Number.parseInt(process.env.POLICY_SYNC_DETAIL_LIMIT || "30", 10) || 0);
  for (const policy of policies.slice(0, detailLimit)) {
    try {
      if (/\.(pdf|docx?|xlsx?|zip)(?:\?|$)/i.test(policy.url)) continue;
      const detailHtml = await fetchText(policy.url);
      const fullContent = decode(detailHtml.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "));
      let deadline = findDeadlineInfo(fullContent);
      if (!deadline.date) {
        const attachmentPattern = /href=["']([^"']+\.docx(?:\?[^"']*)?)["']/gi;
        for (const match of [...detailHtml.matchAll(attachmentPattern)].slice(0, 3)) {
          try {
            deadline = findDeadlineInfo(await extractDocxText(normalizeUrl(match[1], policy.url)));
            if (deadline.date) break;
          } catch { /* another attachment may still contain the deadline */ }
        }
      }
      policy.content = fullContent.slice(0, 60_000);
      policy.deadline = deadline.date || policy.deadline;
      policy.deadlineTime = deadline.time || policy.deadlineTime || "";
      policy.publishDate = policy.publishDate || findDate(fullContent);
      policy.summary = fullContent.slice(0, 220) || policy.summary;
    } catch { /* keep index data when a detail page is unavailable */ }
  }
  return policies;
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
  return (payload?.data?.recordList || []).map((row) => {
    const title = decode(row.title || "");
    const content = decode(row.context || "");
    const deadline = findDeadlineInfo(content);
    return { id: stableId("hangzhou-tech-api", row.detailUrl || String(row.id), title), title, region: row.levelType === 1 ? "国家" : row.levelType === 2 ? "浙江省" : "杭州市", level: decode(row.levelTypeName || "市级"), department: decode(row.publishDepart || "杭州市科学技术局"), publishDate: timestampToDate(row.publishDate), deadline: deadline.date, deadlineTime: deadline.time, category: "科技项目通知", summary: content.slice(0, 220), content, url: row.detailUrl || "https://sti.kj.hangzhou.gov.cn/technology-brain-web/searchList/newPolicy?dataType=2", sourceName: "杭州市科技创新服务平台", firstSeenAt: new Date().toISOString() };
  }).filter((item) => item.title && item.url);
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

async function main() {
  const results = [];
  const sourceStatus = [];
  const collectors = [
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
  const candidates = dedupe([...fixedPolicies, ...results]);
  const audit = auditPolicies(candidates);
  const policies = audit.filter((policy) => policy.visible);
  // 不再丢弃未通过项；前端可展示逐条的排除原因，供人工复核和规则调优。
  const filteredPolicies = audit.filter((policy) => !policy.visible).map(({ content, ...policy }) => policy);
  const payload = { updatedAt: new Date().toISOString(), policies, filteredPolicies, candidateCount: candidates.length, filteredCount: filteredPolicies.length, sources: sourceStatus };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempPath, outputPath);
  console.log(`Policy sync complete: ${payload.policies.length} policies, ${sourceStatus.filter((source) => source.ok).length}/${sourceStatus.length} sources available.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
