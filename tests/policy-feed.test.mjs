import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildPolicyFeed, assertViablePolicyFeed } from "../scripts/policy-feed.mjs";
import { assertPolicyRulesLoaded, parsePolicyRules } from "../scripts/policy-rules.mjs";
import { selectPolicyItems, applicationFeedItems, canonicalSelections, safeSourceHref } from "../scripts/policy-view.mjs";
import { parseSushangIndex } from "../scripts/policy-collection.mjs";
const now = new Date("2026-09-08T09:00:00+08:00");
const base = { id: "p", title: "关于开展企业研发补助项目申报的通知", region: "国家", publishDate: "2026-09-01", url: "https://example.gov.cn/p", content: "现开展企业研发补助项目申报，申报单位须符合申报条件。申请企业请于2026年9月20日前登录申报系统提交申报材料，审核后按实际研发投入给予资金补助。", originalVerification: { retrievalStatus: "parsed", bindingStatus: "matched" } };
test("主列表只含真实事项，线索与补充通知分别进入审计分区", () => {
 const feed = assertViablePolicyFeed(buildPolicyFeed([base, { ...base, id: "supp", title: "企业研发补助补充通知", parentProjectId: "p" }, { ...base, id: "unread", content: "", originalVerification: { retrievalStatus: "failed" } }], [], null, now));
 assert.deepEqual(feed.policies.map(p => p.id), ["p"]);
 assert.equal(feed.policies[0].relatedDocuments.length, 1);
 assert.equal(feed.coverage.pendingDocuments, 3); // includes outdated parser verification, not just unread applications
 assert.deepEqual(feed.reviewQueue.map(p=>p.id), ['unread']);
 assert.deepEqual(feed.excludedRecords.map(p=>p.id), ['supp']);
 assert.equal(Object.values(feed.decisionCounts).reduce((a,b)=>a+b,0), 3);
});
test("真正没有适用项目时允许零条，不保留已知错误旧数据", () => assert.doesNotThrow(() => assertViablePolicyFeed(buildPolicyFeed([{ ...base, title: "税收亏损结转年限通知" }], [], null, now))));
test("企业筛选包含国家、省级项目，收藏不改变完整项目数", () => {
 const all = buildPolicyFeed([base, { ...base, id: "js", region: "江苏省" }, { ...base, id: "zj", region: "浙江省" }], [], null, now).policies.map(p=>({...p,disposition:p.decision}));
 const selected = ["p"];
 const opts = { tab: "all", disposition: "all", region: "全部地区", query: "", company: "suzhou" };
 assert.deepEqual(new Set(selectPolicyItems(all,selected,opts).map(p=>p.id)), new Set(["p","js"]));
 assert.equal(selectPolicyItems(all,selected,{...opts,tab:"pending"}).length,1);
 assert.equal(selectPolicyItems(all,selected,{...opts,tab:"selected"}).length,1);
});
test("地区和状态数量均遵守当前筛选，而非匹配分阈值", () => {
 const all = buildPolicyFeed([base], [], null, now).policies.map(p=>({...p,disposition:p.decision,matchScore:0}));
 assert.equal(selectPolicyItems(all,[],{tab:"all",disposition:"needs_review",region:"全部地区",query:"研发",company:"all"}).length,1);
 assert.equal(selectPolicyItems(all,[],{tab:"all",disposition:"eligible",region:"全部地区",query:"",company:"all"}).length,0);
});
test("官方索引每条标题和日期配对，不串用相邻项目日期", () => {
 const html = '<li><span class="tag">[江苏省级]</span><a href="?s=/Notice/noticeDetail/id/1"><span title="企业研发补助申报通知">截断标题</span></a>2026-09-01 最近要求：2026-09-20，截止</li><li><a title="企业进口贴息项目申报" href="?s=/Notice/noticeDetail/id/2">项目2</a>2026-09-03 最近要求：2026-10-10，截止</li><a href="?p=2">下一页</a>';
 const p = parseSushangIndex(html,"https://sst.suzhou.gov.cn/index");
 assert.equal(p.records.length,2); assert.equal(p.records[0].title,"企业研发补助申报通知");
 assert.equal(p.records[0].deadline,"2026-09-20"); assert.equal(p.records[1].deadline,"2026-10-10");
 assert.ok(p.next.endsWith("?p=2"));
});
test("简化申报页：全部、收藏、搜索均不带回线索和排除记录，后台保持完整", () => {
 const feed = buildPolicyFeed([base, { ...base, id: "lead", content: "", originalVerification: {} }, { ...base, id: "news", title: "企业研发补助名单公示" }, { ...base, id: "old", content: base.content.replace("9月20日", "9月1日") }], [], null, now);
 const before = JSON.stringify(feed);
 const rows = applicationFeedItems(feed, now);
 const ids = ["p", "lead", "news", "old"];
 for (const tab of ["all", "selected"]) {
   assert.deepEqual(selectPolicyItems(rows, ids, { tab, now }).map(p => p.id), ["p"]);
   assert.deepEqual(selectPolicyItems(rows, ids, { tab, query: "研发", now }).map(p => p.id), ["p"]);
 }
 assert.equal(JSON.stringify(feed), before);
 assert.deepEqual(canonicalSelections(rows, ids), ids);
 assert.equal(rows[0].decision, "needs_review");
});
test("本区全部不会因收藏减少，收藏别名可迁移，跨日截止仍自动下架", () => {
 const feed = buildPolicyFeed([base, { ...base, id: "second", region: "江苏省" }], [], null, now);
 const rows = applicationFeedItems(feed, now);
 rows[0].aliases = ["legacy"];
 const ids = canonicalSelections(rows, ["legacy"]);
 assert.deepEqual(ids, [rows[0].id]);
 assert.equal(selectPolicyItems(rows, ids, { tab: "all", now }).length, 2);
 assert.equal(selectPolicyItems(rows, ids, { tab: "selected", now }).length, 1);
 for (const tab of ["all", "selected"]) assert.equal(selectPolicyItems(rows, ids, { tab, now: new Date("2026-09-21T00:00:00+08:00") }).length, 0);
});
test("已核实上级原文时以原始通知为主，转发通知仅作关联材料", () => {
 const subject = "智能电网国家科技重大专项基础支撑自主化关键技术公开项目申报指南";
 const verified = { retrievalStatus: "parsed", bindingStatus: "matched" };
 const authenticity = { status: "confirmed" };
 const forwarding = { ...base, id: "forward", title: `关于转发${subject}的通知`, region: "江苏省", url: "https://kxjst.jiangsu.gov.cn/forward", content: `国家能源局印发了《关于发布${subject}的通知》，现转发给你们。`, projectAuthenticity: authenticity, originalVerification: verified, deadline: "2026-09-11", deadlineTime: "17:00" };
 const original = { ...base, id: "original", title: `国家能源局关于发布${subject}的通知`, url: "https://service.most.gov.cn/original", content: `现将${subject}予以公布，请申报单位网上填报。`, projectAuthenticity: authenticity, originalVerification: verified, deadline: "2026-09-13", deadlineTime: "16:00" };
 const rows = applicationFeedItems({ policies: [forwarding, original] }, now);
 assert.equal(rows.length, 1);
 assert.equal(rows[0].id, "original");
 assert.equal(rows[0].title, original.title);
 assert.equal(rows[0].url, original.url);
 assert.ok(rows[0].aliases.includes("forward"));
 assert.deepEqual(rows[0].relatedDocuments.map(item => [item.id, item.relation, item.deadline]), [["forward", "属地转发及报送要求", "2026-09-11"]]);
 assert.deepEqual(canonicalSelections(rows, ["forward"]), ["original"]);
 assert.deepEqual(selectPolicyItems(rows, [], { query: "关于转发", now }).map(item => item.id), ["original"]);
});
test("没有匹配且已核实的原始通知时不得隐藏转发记录", () => {
 const subject = "某专项公开项目申报指南";
 const forwarding = { ...base, id: "forward-only", title: `关于转发${subject}的通知`, content: `现转发${subject}，请组织申报。`, projectAuthenticity: { status: "confirmed" } };
 const unverified = { ...base, id: "unverified", title: `某部门关于发布${subject}的通知`, content: `发布${subject}。`, projectAuthenticity: { status: "confirmed" }, originalVerification: { retrievalStatus: "parsed", bindingStatus: "unknown" } };
 assert.deepEqual(applicationFeedItems({ policies: [forwarding] }, now).map(item => item.id), ["forward-only"]);
 assert.deepEqual(new Set(applicationFeedItems({ policies: [forwarding, unverified] }, now).map(item => item.id)), new Set(["forward-only", "unverified"]));
});
test("转发正文完整文件名优先于漏字标题，兼容组织申报、引号与 PDF 换行", () => {
 for (const [issuer, action, subject] of [
   ["住房城乡建设部办公厅", "组织", "国家重点研发计划“城镇可持续发展关键技术与装备”重点专项2026年度项目申报工作"],
   ["工业和信息化部", "发布", "国家重点研发计划“高端科研仪器研制”重点专项2026年度（第一批）项目申报指南"],
 ]) {
   const original = { ...base, id: "original", title: `${issuer}关于${action}${subject}的通知`, projectAuthenticity: { status: "confirmed" }, sourceReaderUrl: "/policy-sources/old-forward.html", url: "https://service.most.gov.cn/original", deadline: "2026-09-28" };
   const reference = action === "组织" ? `现将《${original.title}》转发给你们。` : `${issuer}印发了《关于${action}${subject}的通知》，现转发给你们。`;
   const forwarding = { ...base, id: "forward", title: `关于转发${subject.replace("计划", "计")}的通知`, region: "江苏省", content: `${reference.replace("2026", "2026 \n").replaceAll("“", "&ldquo;").replaceAll("”", "&rdquo;")}凡需我厅推荐申报的项目，请由所在地科技主管部门审核后报送。`, projectAuthenticity: { status: "confirmed" }, deadline: "2026-09-11", deadlineTime: "17:00" };
   const feed = { policies: [forwarding, original] }, before = JSON.stringify(feed);
   for (const date of [now, new Date("2026-09-12T00:00:00+08:00")]) {
     const rows = applicationFeedItems(feed, date);
     assert.deepEqual(rows.map(p => p.id), ["original"]);
     assert.equal(safeSourceHref(rows[0]), original.url);
     assert.equal(rows[0].deadline, "2026-09-28");
     assert.equal(rows[0].relatedDocuments[0].deadline, "2026-09-11");
     assert.match(rows[0].relatedDocuments[0].requirement, /所在地科技主管部门/);
     assert.equal(rows[0].relatedDocuments[0].expired, date !== now);
     assert.deepEqual(canonicalSelections(rows, ["forward", "original"]), ["original"]);
   }
   assert.equal(JSON.stringify(feed), before);
 }
});
test("不同年度批次、未核实原文、多份引用或不唯一匹配均不得吞掉转发事项", () => {
 const title = "工业和信息化部关于发布高端科研仪器研制重点专项2026年度（第一批）项目申报指南的通知";
 const original = { ...base, id: "original", title, projectAuthenticity: { status: "confirmed" }, deadline: "2026-09-28" };
 const forwarding = { ...base, id: "forward", title: "关于转发高端科研仪器研制重点专项申报通知", content: `现将《${title}》转发给你们。`, projectAuthenticity: { status: "confirmed" }, deadline: "2026-09-20" };
 for (const originals of [
   [{ ...original, title: title.replace("2026", "2025") }],
   [{ ...original, title: title.replace("第一批", "第二批") }],
   [{ ...original, originalVerification: { retrievalStatus: "failed", bindingStatus: "matched" } }],
   [original, { ...original, id: "ambiguous", url: "https://another.gov.cn/original" }],
 ]) assert.ok(applicationFeedItems({ policies: [forwarding, ...originals] }, now).some(p => p.id === "forward"));
 const multi = { ...forwarding, content: `${forwarding.content}现将《其他重点专项2026年度项目申报指南的通知》转发给你们。` };
 assert.ok(applicationFeedItems({ policies: [multi, original] }, now).some(p => p.id === "forward"));
});
test("申报页面只保留苏州、杭州、连云港范围，明确其他地市的项目不进入本区全部", () => {
 const inScope = { ...base, id: "zj-prov", region: "浙江省", title: "浙江省企业技术改造申报通知" };
 const shaoxing = { ...base, id: "shaoxing", region: "年绍兴市", title: "关于组织开展2026年绍兴市制造业企业技术中心认定工作的通知" };
 const rows = applicationFeedItems({ policies: [inScope, shaoxing] }, now);
 assert.deepEqual(rows.map(item => item.id), ["zj-prov"]);
});
test("简化界面仍保留真实事项的待核和即将开放，不偷偷加企业或资金限制", () => {
 const feed = buildPolicyFeed([base, { ...base, id: "upcoming", region: "浙江省", title: "企业创新平台认定申报通知", content: "企业创新平台认定申报通知。申报单位为企业，须符合申报条件。申报时间为2026年9月15日至9月20日，企业登录申报系统提交申报材料，审核后给予创新平台认定。" }], [], null, now);
 const rows = applicationFeedItems(feed, now);
 assert.deepEqual(new Set(rows.map(p => p.id)), new Set(["p", "upcoming"]));
 assert.equal(rows.find(p => p.id === "upcoming").decision, "upcoming");
});
test("申报页面仅保留两种视图，隐藏筛选不保留限制状态", () => {
 const source = readFileSync(new URL("../app/policy/page.tsx", import.meta.url), "utf8");
 assert.ok(source.includes('applicationFeedItems(feed, new Date(clock))'));
 assert.ok(source.includes('useState<"all" | "selected">("all")'));
 assert.ok(source.includes('>可申报</h2>'));
 assert.ok(source.includes('>本区全部</button>'));
 assert.ok(source.includes('>收藏 <b>'));
 assert.doesNotMatch(source, /className="scope-tabs"|className="coverage-panel"|本区未收藏|跨区收藏|清空筛选/);
 assert.doesNotMatch(source, /setCollection|setCompany|setDisposition|setFunding/);
 assert.ok(source.includes('地区筛选'));
 assert.ok(source.includes('policy-radar-known-ids'));
 assert.ok(source.includes('new-project-badge'));
 assert.doesNotMatch(source, /policy\/rules|规则口径|rules-link/);
});
test("规则文档进入后端读取口径，不生成前端规则页面", () => {
 const markdown = readFileSync(new URL("../规则.md", import.meta.url), "utf8");
 const rules = assertPolicyRulesLoaded(parsePolicyRules(markdown));
 assert.equal(rules.version, "1.5");
 assert.ok(rules.digest.length >= 64);
 assert.throws(() => readFileSync(new URL("../app/policy/rules/page.tsx", import.meta.url), "utf8"));
});
