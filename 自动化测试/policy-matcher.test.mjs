import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePolicy } from "../自动化脚本/policy-matcher.mjs";
import { projectDocumentKind } from "../自动化脚本/project-assessment.mjs";
import { extractApplicationTiming, displayPolicyTime } from "../自动化脚本/policy-time.mjs";

const now = new Date("2026-09-08T09:00:00+08:00");
const base = { id: "grant", title: "关于开展2026年企业设备更新补助项目申报的通知", region: "苏州市", publishDate: "2026-08-25", content: "现组织企业设备更新补助项目申报。申报单位为在本市依法注册的企业，申报条件按指南执行。请企业于2026年9月20日17:00前通过申报系统提交申请材料。对符合条件的企业给予资金补助。", url: "https://example.gov.cn/grant", originalVerification: { retrievalStatus: "parsed", bindingStatus: "matched", checkedAt: now.toISOString() }, contentHash: "policy-v1" };
const review = { status: "verified", complete: true, policyHash: "policy-v1", profileVersion: "company-v1", checkedAt: now.toISOString(), conditions: [{ label: "全部适用条件", status: "met", evidence: "reviewed-evidence-id" }] };
const profile = { companies: { suzhou: { version: "company-v1" } } };

test("截图中的补充通知及亏损结转政策都不能独立入表", () => {
  for (const title of ["关于规范2026年度高新技术企业申报有关事项的补充通知", "财政部 税务总局关于延长高新技术企业和科技型中小企业亏损结转年限的通知"]) {
    const p = evaluatePolicy({ ...base, title }, now);
    assert.equal(p.visible, false);
    assert.equal(p.decision, "discarded");
  }
});
test("真正的申报通知不会因为标题带通知而被排除", () => assert.equal(evaluatePolicy(base, now).visible, true));
test("无核心赛道词的普惠企业补助保留", () => {
  const p = evaluatePolicy(base, now);
  assert.equal(p.visible, true);
  assert.equal(p.projectAuthenticity.status, "confirmed");
  assert.equal(p.decision, "needs_review");
});
test("命中一项关键词、甚至五项关键词，都不等于企业符合条件", () => {
  const p = evaluatePolicy(base, now);
  assert.equal(p.decision, "needs_review");
  assert.equal(p.evidence.completeness.sufficient, false);
});
test("原文及附件未读不能伪装成已核实项目", () => {
  const p = evaluatePolicy({ ...base, content: "", originalVerification: { retrievalStatus: "failed" } }, now);
  assert.equal(p.visible, false);
  assert.equal(p.decision, "needs_review");
});
test("正文已证实具体申报但附件失败：可列待核实，不可标可申报", () => {
  const p = evaluatePolicy({ ...base, qualificationReviews: { suzhou: review }, originalVerification: { retrievalStatus: "partial", bindingStatus: "matched" } }, now, profile);
  assert.equal(p.visible, true);
  assert.equal(p.decision, "needs_review");
});
test("三家独立判断，苏州证据不得用于杭州", () => {
  const p = evaluatePolicy({ ...base, region: "国家", qualificationReviews: { suzhou: review } }, now, profile);
  assert.equal(p.decision, "eligible");
  assert.equal(p.companyAssessments.find(c => c.companyId === "suzhou").status, "eligible");
  assert.equal(p.companyAssessments.find(c => c.companyId === "hangzhou").status, "needs_review");
});
test("政策版本变化后旧资格结论失效", () => assert.equal(evaluatePolicy({ ...base, contentHash: "policy-v2", qualificationReviews: { suzhou: review } }, now, profile).decision, "needs_review"));
test("强制条件已核实不满足不得进入可申报", () => {
  const p = evaluatePolicy({ ...base, qualificationReviews: { suzhou: { ...review, conditions: [{ label: "营收未达标", status: "not_met", evidence: "annual-report" }] } } }, now, profile);
  assert.equal(p.visible, false);
});
test("区县未核实不按写死的区名漏掉真实项目", () => assert.equal(evaluatePolicy({ ...base, title: "关于组织滨江区企业设备更新补助申报的通知", region: "杭州市" }, now).visible, true));
test("正文提及被排除行业不误删普惠申报", () => assert.equal(evaluatePolicy({ ...base, content: base.content + "房地产企业不在支持范围内。" }, now).visible, true));
test("只有高校申报或专业行业项目应排除", () => {
  assert.equal(evaluatePolicy({ ...base, title: "生物医药专项申报通知" }, now).visible, false);
  assert.equal(evaluatePolicy({ ...base, content: base.content + "仅限高校申报。" }, now).visible, false);
});
test("公示、需求征集、供给登记、新闻及政策办法排除", () => {
  for (const title of ["研发项目拟立项名单公示", "关于征集氢能企业产业供给能力的通知", "关于征集研发项目需求的通知", "喜报：氢能企业获奖", "关于印发科技企业孵化器管理办法的通知"]) assert.equal(evaluatePolicy({ ...base, title }, now).visible, false, title);
});
test("申报窗口比上级推荐窗口早，不能取最大日期", () => {
  const timing = extractApplicationTiming({ ...base, content: "请企业于2026年9月10日17:00前提交申报材料。各县科技局于2026年9月20日前报送汇总表。" }, now);
  assert.equal(timing.deadlineDate, "2026-09-10");
  assert.equal(timing.deadlineTime, "17:00");
});
test("只有主管部门推荐截止日期，不冒充企业期限", () => {
  const timing = extractApplicationTiming({ ...base, content: "请各县科技局于2026年9月20日前报送项目申报汇总表。" }, now);
  assert.equal(timing.deadlineDate, "");
});
test("申报日期区间取结束日，支持省略年份和中文时刻", () => {
  const timing = extractApplicationTiming({ ...base, content: "企业申报时间为2026年8月20日至9月15日17时30分，请登录系统提交申报材料。" }, now);
  assert.equal(timing.deadlineDate, "2026-09-15");
  assert.equal(timing.deadlineTime, "17:30");
});
test("发布日期与政策有效期不当成申报截止", () => {
  assert.equal(extractApplicationTiming({ ...base, content: "发布日期2026年8月25日。本政策有效期至2029年12月31日。" }, now).deadlineDate, "");
});
test("跨年度仍开放的正式项目不得因年份删除", () => assert.equal(evaluatePolicy({ ...base, title: "2025年度企业补助申报通知", publishDate: "2025-12-01" }, now).visible, true));
test("expired、open 和 unknown 不混淆，未知时不输出时间标签", () => {
  assert.deepEqual(displayPolicyTime({ timing: { applicationWindowStatus: "unknown" } }, now), { label: "", tone: "unknown", date: "", time: "" });
  assert.equal(displayPolicyTime({ deadline: "2026-09-20" }, now).tone, "open");
  assert.equal(displayPolicyTime({ deadline: "2026-09-09" }, now).tone, "soon");
  assert.equal(displayPolicyTime({ deadline: "2026-09-01" }, now).label, "已截止");
});
test("开放日尚未到时标为预告", () => {
  const p = evaluatePolicy({ ...base, content: base.content.replace("请企业于2026年9月20日17:00前", "企业申报时间为2026年9月15日至9月20日17:00，") }, now);
  assert.equal(p.decision, "upcoming");
});
test("常态化申报不能因首批日期过期被永久删除", () => {
  const p = evaluatePolicy({ ...base, content: base.content.replace("请企业于2026年9月20日17:00前", "常态化开展申报。首批企业于2026年9月1日前") }, now);
  assert.equal(p.visible, true);
  assert.equal(p.timing.applicationWindowStatus, "ongoing");
});
test("已截止主项目排除，不用年末公示日期复活", () => {
  const p = evaluatePolicy({ ...base, content: "企业申报于2026年9月1日前提交。结果公示期为2026年12月1日至12月7日。" }, now);
  assert.equal(p.decision, "discarded");
});
test("企业技术中心、非现金认定也是具体项目", () => assert.equal(projectDocumentKind({ title: "关于开展2026年度企业技术中心认定申报工作的通知" }).kind, "application"));
test("历史窗口不明的真实项目可见但待核，不凭年份隐藏或冒充可申报", () => {
 const p = evaluatePolicy({ ...base, title: "2023年度企业补助项目申报通知", publishDate: "2023-03-01", content: base.content.replace("2026年9月20日17:00前", "指定窗口内") }, now);
 assert.equal(p.visible, true); assert.equal(p.windowReviewRequired, true); assert.equal(p.decision, "needs_review");
});
test("推荐环节全部已截止时企业也不能继续申报", () => {
 const p = evaluatePolicy({ ...base, content: base.content.replace("请企业于2026年9月20日17:00前", "各县科技局于2026年9月1日前") }, now);
 assert.equal(p.decision, "discarded");
});
test("独立批次中仍开放的一批不因前批过期删除", () => {
 const timing = extractApplicationTiming({ ...base, content: "第一批企业于2026年6月1日前提交申报材料。第二批企业于2026年9月20日前提交申报材料。" }, now);
 assert.equal(timing.deadlineDate, "2026-09-20");
});
