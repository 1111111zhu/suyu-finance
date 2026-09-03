import assert from "node:assert/strict";
import test from "node:test";
import { auditPolicies, evaluatePolicy } from "../scripts/policy-matcher.mjs";

const now = new Date("2026-09-02T00:00:00+08:00");
const base = { id: "case", region: "浙江省", level: "省级", department: "测试部门", publishDate: "2026-09-01", deadline: "", category: "政策申报", summary: "", content: "", url: "https://example.gov.cn/policy" };
const verified = (value) => ({ value, status: "verified", source: { url: "https://example.gov.cn/evidence" }, evidence: "官方原文", verifiedAt: "2026-09-01T00:00:00.000Z" });
const profile = {
  generatedAt: "2026-09-01T00:00:00.000Z",
  matcherProfile: {
    foundedYear: verified(2021),
    qualifications: {
      highTechEnterprise: verified(true),
      specializedSme: verified(false),
      potentialUnicorn: { value: null, status: "unknown" },
      lowAltitudeEconomyLeader: { value: null, status: "unknown" },
    },
  },
};

test("正文中明确的申报事项不能因标题缺少申报词而被过滤", () => {
  const result = evaluatePolicy({ ...base, title: "关于发布2026年度重点专项通知", content: "现组织开展氢能与燃料电池关键技术项目申报，支持企业研发和产业化。" }, now);
  assert.equal(result.visible, true);
});

test("无申报或公司相关信号的会议通知仍会被过滤并保留原因", () => {
  const [item] = auditPolicies([{ ...base, title: "关于召开工作会议的通知", content: "会议安排" }], now);
  assert.equal(item.visible, false);
  assert.equal(item.filterReason, "正文及附件未识别到申报或公司相关信号");
});

test("已举办活动新闻不会作为申报项目进入列表", () => {
  const result = evaluatePolicy({
    ...base,
    title: "科技成果赋智企业“深度行”活动成功举办",
    content: "活动通过政策解读和专家咨询服务企业，相关代表参加活动。",
    originalVerification: { verified: false, reason: "原文为活动新闻或已举办活动" },
  }, now);
  assert.equal(result.decision, "ineligible");
  assert.equal(result.visible, false);
  assert.match(result.filterReason, /活动/);
});

test("未命中溯驭赛道或已核验资质的泛科技项目不会被展示", () => {
  const result = evaluatePolicy({
    ...base,
    title: "移动信息网络国家科技重大专项项目申报通知",
    deadline: "2026-10-08",
    content: "申报主体为企业。申报条件：具备相关研发能力。经审核给予专项资金支持。申报截止时间为2026年10月8日。",
    originalVerification: { verified: true },
  }, now, profile);
  assert.equal(result.decision, "ineligible");
  assert.equal(result.visible, false);
  assert.match(result.filterReason, /核心赛道/);
});

test("明确属于生物医药等非相邻行业的项目不会被泛词重新纳入", () => {
  const result = evaluatePolicy({
    ...base,
    title: "生物医药产业高质量发展项目申报通知",
    content: "支持对象为生物医药企业。申报主体为企业。申报条件：具备创新药研发能力。经审核给予资金补助。申报截止时间为2026年9月30日。",
  }, now, profile);
  assert.equal(result.decision, "ineligible");
  assert.match(result.filterReason, /核心业务无关/);
});

test("县市区试点即使提及企业也不是企业可直接申报的事项", () => {
  const result = evaluatePolicy({
    ...base,
    title: "关于开展中小企业数字化转型县（市、区）试点工作的通知",
    content: "支持对象包括当地企业，由县级人民政府申报试点。",
  }, now, profile);
  assert.equal(result.decision, "ineligible");
  assert.match(result.filterReason, /地方政府或区县试点/);
});

test("赛道相关但申报信息不完整的通知进入待人工复核", () => {
  const result = evaluatePolicy({ ...base, title: "关于推进氢能产业发展的通知", content: "支持企业开展燃料电池关键技术研发和成果转化。" }, now);
  assert.equal(result.visible, true);
  assert.equal(result.matchLevel, "待人工复核");
});

test("同市其他区的定向项目会被筛掉", () => {
  const result = evaluatePolicy({ ...base, region: "苏州市", title: "苏州工业园区科技领军人才项目申报通知", content: "面向园区企业开展新能源技术项目申报" });
  assert.equal(result.visible, false);
  assert.match(result.filterReason, /苏州工业园区/);
});

test("本区及未标注区属的市级项目不会因区规则被筛掉", () => {
  const wujiang = evaluatePolicy({ ...base, region: "苏州市", title: "吴江区氢能产业项目申报通知", content: "面向吴江区企业开展氢能技术项目申报" });
  const citywide = evaluatePolicy({ ...base, region: "杭州市", title: "杭州市氢能项目申报通知", content: "面向全市科技企业开展氢能项目申报" });
  assert.equal(wujiang.visible, true);
  assert.equal(citywide.visible, true);
});

test("证据齐全的企业申报项目判为 eligible，并保留原文定位", () => {
  const result = evaluatePolicy({
    ...base,
    title: "2026年度氢能关键技术项目申报通知",
    deadline: "2026-09-30",
    content: "支持对象为科技型中小企业。申报主体为在杭州市注册的企业。申报条件：近三年无重大失信记录。经审核给予专项资金补助。申报截止时间为2026年9月30日。",
  }, now);
  assert.equal(result.decision, "eligible");
  assert.equal(result.eligibilityStatus, "eligible");
  assert.equal(result.activityRole, "enterprise_applicant");
  assert.equal(result.evidence.completeness.complete, true);
  assert.equal(result.supportAssessment.directSupport, true);
  assert.ok(result.supportAssessment.eligibleBenefits.some((benefit) => benefit.code === "funding"));
  assert.equal(result.evidence.applicant.citations[0].source, "content");
  assert.match(result.evidence.applicant.citations[0].excerpt, /申报主体/);
});

test("大讲堂主办或承办事项不会因创业者受邀演讲而成为企业可申报项目", () => {
  const result = evaluatePolicy({
    ...base,
    title: "关于举办第98期创新创业大讲堂的通知",
    content: "现征集承办单位负责会务执行，创业者可受邀演讲分享氢能创业经验。",
  }, now);
  assert.equal(result.decision, "ineligible");
  assert.equal(result.visible, false);
  assert.equal(result.activityRole, "organizer");
  assert.match(result.filterReason, /主办、承办或组织方/);
});

test("组织申报的行政表述不会被误认为活动组织方", () => {
  const result = evaluatePolicy({
    ...base,
    title: "关于组织申报氢能路演技术攻关项目的通知",
    content: "支持对象为科技型中小企业。申报主体为企业。申报条件：具备研发能力。经审核给予资金补助。申报截止时间为2026年9月30日。",
    deadline: "2026-09-30",
  }, now);
  assert.equal(result.decision, "eligible");
  assert.equal(result.activityRole, "enterprise_applicant");
});

test("组织开展一般补贴活动不会被误认为主办方项目", () => {
  const result = evaluatePolicy({
    ...base,
    title: "市场主体境外营销补助",
    content: "对企业参加市本级组织的境外促销活动，给予50%国际机票费用补助。",
  }, now);
  assert.notEqual(result.activityRole, "organizer");
});

test("受邀讲话和路演属于 opportunity，且不会作为可申报政策显示", () => {
  const result = evaluatePolicy({
    ...base,
    title: "氢能创新创业路演嘉宾征集",
    content: "本次路演采用邀请制，面向创业者征集受邀演讲嘉宾。",
    activityDate: "2026-09-20",
  }, now);
  assert.equal(result.decision, "opportunity");
  assert.equal(result.visible, false);
  assert.equal(result.needsReview, false);
  assert.equal(result.requiresInvitationEvidence, true);
  assert.equal(result.invitationEvidence.found, false);
  assert.ok(result.matchScore <= 60);
});

test("邀请制项目在没有企业邀请凭证时只能待人工复核", () => {
  const result = evaluatePolicy({
    ...base,
    title: "邀请制氢能科技项目申报通知",
    deadline: "2026-09-30",
    content: "支持对象为科技型中小企业。申报主体为受邀企业。申报条件：具有氢能研发能力。经审核给予资金补助，申报截止时间为2026年9月30日。",
  }, now);
  assert.equal(result.decision, "needs_review");
  assert.equal(result.visible, true);
  assert.equal(result.requiresInvitationEvidence, true);
  assert.equal(result.invitationEvidence.found, false);
  assert.ok(result.matchScore <= 64);
  assert.match(result.decisionReasons.join("；"), /尚无企业已获邀请的证据/);
});

test("缺少关键原文证据只降级为 needs_review，不按未知企业条件排除", () => {
  const result = evaluatePolicy({ ...base, title: "氢能企业研发支持通知", content: "面向企业开展氢能燃料电池关键技术研发和成果转化。" }, now);
  assert.equal(result.decision, "needs_review");
  assert.equal(result.visible, true);
  assert.ok(result.evidence.completeness.missing.includes("申报主体"));
  assert.ok(result.matchScore <= 64);
});

test("已核验的公司档案参与资格判断，未知或不满足门槛只降级不排除", () => {
  const eligible = evaluatePolicy({
    ...base,
    title: "高新技术企业氢能项目申报通知",
    deadline: "2026-09-30",
    content: "支持对象为国家高新技术企业。申报主体为企业。申报条件：具备研发能力。经审核给予资金补助。申报截止时间为2026年9月30日。",
  }, now, profile);
  assert.equal(eligible.decision, "eligible");
  assert.equal(eligible.companyEligibility.met[0].label, "国家高新技术企业");

  const downgraded = evaluatePolicy({
    ...base,
    title: "专精特新企业氢能项目申报通知",
    deadline: "2026-09-30",
    content: "支持对象为专精特新中小企业。申报主体为企业。申报条件：具备研发能力。经审核给予资金补助。申报截止时间为2026年9月30日。",
  }, now, profile);
  assert.equal(downgraded.decision, "needs_review");
  assert.equal(downgraded.visible, true);
  assert.equal(downgraded.companyEligibility.notMet[0].label, "专精特新中小企业");
});

test("活动日期、项目周期和事前备案会进入可审计的时间判断", () => {
  const result = evaluatePolicy({
    ...base,
    title: "氢能企业技术改造项目申报通知",
    deadline: "2026-09-30",
    projectPeriod: "2026年10月至2027年9月",
    content: "支持对象为科技型中小企业。申报主体为企业。申报条件：应具备研发能力。经审核给予贷款贴息。申报截止时间为2026年9月30日，项目需事前备案。",
  }, now);
  assert.equal(result.decision, "eligible");
  assert.equal(result.timing.applicationWindowStatus, "open");
  assert.equal(result.timing.projectPeriod, "2026年10月至2027年9月");
  assert.equal(result.timing.requiresPriorFiling, true);
  assert.ok(result.supportAssessment.eligibleBenefits.some((benefit) => benefit.code === "loan_interest"));
});

test("过期申报窗口和已结束活动会判为 ineligible", () => {
  const deadlineExpired = evaluatePolicy({ ...base, title: "氢能项目申报", deadline: "2026-09-01", content: "企业申报资金补助" }, now);
  const midnightDeadlineExpired = evaluatePolicy({ ...base, title: "氢能项目申报", deadline: "2026-06-25", deadlineTime: "24:00", content: "企业申报资金补助" }, now);
  const activityExpired = evaluatePolicy({ ...base, title: "氢能路演嘉宾征集", content: "创业者可受邀演讲", activityDate: "2026-08-31" }, now);
  assert.equal(deadlineExpired.decision, "ineligible");
  assert.equal(deadlineExpired.filterReason, "已过申报截止时间");
  assert.equal(midnightDeadlineExpired.decision, "ineligible");
  assert.equal(midnightDeadlineExpired.filterReason, "已过申报截止时间");
  assert.equal(activityExpired.decision, "ineligible");
  assert.equal(activityExpired.filterReason, "活动日期已结束");
});
