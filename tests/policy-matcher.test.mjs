import assert from "node:assert/strict";
import test from "node:test";
import { auditPolicies, evaluatePolicy } from "../scripts/policy-matcher.mjs";

const now = new Date("2026-09-02T00:00:00+08:00");
const base = { id: "case", region: "浙江省", level: "省级", department: "测试部门", publishDate: "2026-09-01", deadline: "", category: "政策申报", summary: "", content: "", url: "https://example.gov.cn/policy", originalVerification: { verified: true, retrievalStatus: "parsed", reason: "已读取官方原文" } };
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

test("会议通知不是政府政策文件，直接排除", () => {
  const [item] = auditPolicies([{ ...base, title: "关于召开工作会议的通知", content: "会议安排" }], now);
  assert.equal(item.visible, false);
  assert.equal(item.decision, "discarded");
  assert.equal(item.filterReason, "属于政府部门新闻、会议或活动动态、服务案例，不是政府政策文件");
});

test("政府官网的服务案例和座谈新闻不能被标为政府政策文件", () => {
  const caseStory = evaluatePolicy({
    ...base,
    title: "个人医保云为抢救患者争取了宝贵时间",
    department: "国家医疗保障局",
    content: "患者突发疾病后，医院通过个人医保云核验身份并完成救治。",
  }, now);
  const meetingStory = evaluatePolicy({
    ...base,
    title: "国务院新闻办公室召开医保服务高质量发展座谈会",
    department: "国家医疗保障局",
    content: "会议围绕医保服务高质量发展开展交流。",
  }, now);
  for (const item of [caseStory, meetingStory]) {
    assert.equal(item.decision, "discarded");
    assert.equal(item.visible, false);
    assert.equal(item.evidence.governmentPolicyDocument.isPolicyDocument, false);
    assert.equal(item.filterReason, "属于政府部门新闻、会议或活动动态、服务案例，不是政府政策文件");
  }
});

test("正式通知或申报征集文件保留政府政策文件身份", () => {
  const result = evaluatePolicy({
    ...base,
    title: "国家医疗保障局关于印发医保服务管理办法的通知",
    department: "国家医疗保障局",
    content: "现将《医保服务管理办法》印发给你们，请遵照执行。",
  }, now);
  assert.equal(result.evidence.governmentPolicyDocument.isPolicyDocument, true);
  assert.notEqual(result.decision, "discarded");
});

test("新闻、喜报和已举办活动直接丢弃，不进入待查", () => {
  const result = evaluatePolicy({
    ...base,
    title: "科技成果赋智企业“深度行”活动成功举办",
    content: "活动通过政策解读和专家咨询服务企业，相关代表参加活动。",
    originalVerification: { verified: false, reason: "原文为活动新闻或已举办活动" },
  }, now);
  assert.equal(result.decision, "discarded");
  assert.equal(result.visible, false);
  assert.match(result.filterReason, /活动/);
});

test("再创新高类新闻和无申报动作的合作通知直接丢弃", () => {
  const news = evaluatePolicy({
    ...base,
    title: "+29！省级专精特新数量再创新高",
    content: "29家企业上榜，取得阶段性成果。",
    originalVerification: { verified: false, retrievalStatus: "not_checked" },
  }, now);
  const cooperation = evaluatePolicy({
    ...base,
    region: "杭州市",
    title: "【上城区】2025年产业扶持政策（第一批）合作",
    content: "支持企业科技创新和转型升级。",
    originalVerification: { verified: false, retrievalStatus: "not_checked" },
  }, now);
  assert.equal(news.decision, "discarded");
  assert.match(news.filterReason, /新闻/);
  assert.equal(cooperation.decision, "discarded");
  assert.match(cooperation.filterReason, /合作或活动/);
});

test("关于……的若干意见即使包含扶持表述也直接丢弃", () => {
  const result = evaluatePolicy({
    ...base,
    title: "关于实施‘润苗计划’陪伴式扶持科技型初创企业高质量发展的若干意见",
    content: "支持科技型初创企业发展，对符合条件的企业给予资金补助和研发支持。",
  }, now);
  assert.equal(result.decision, "discarded");
  assert.equal(result.visible, false);
  assert.match(result.filterReason, /若干意见/);
});

test("栏目名掩盖原文“若干意见”主文件时仍直接丢弃", () => {
  const result = evaluatePolicy({
    ...base,
    title: "做强做大链主企业",
    content: "2022年10月9日，中共杭州市委办公厅、杭州市⼈⺠政府办公厅印发《关于促进智能物联产业⾼质量发展的若⼲意⻅》的通知。支持链主企业建设数字经济产业园。",
  }, now);
  assert.equal(result.decision, "discarded");
  assert.equal(result.visible, false);
  assert.match(result.filterReason, /若干意见/);
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
  assert.equal(result.matchLevel, "待查");
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

test("大讲堂主办或承办事项直接丢弃", () => {
  const result = evaluatePolicy({
    ...base,
    title: "关于举办第98期创新创业大讲堂的通知",
    content: "现征集承办单位负责会务执行，创业者可受邀演讲分享氢能创业经验。",
  }, now);
  assert.equal(result.decision, "discarded");
  assert.equal(result.visible, false);
  assert.equal(result.activityRole, "organizer");
  assert.match(result.filterReason, /活动/);
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

test("受邀讲话和路演属于活动事项，直接丢弃", () => {
  const result = evaluatePolicy({
    ...base,
    title: "氢能创新创业路演嘉宾征集",
    content: "本次路演采用邀请制，面向创业者征集受邀演讲嘉宾。",
    activityDate: "2026-09-20",
  }, now);
  assert.equal(result.decision, "discarded");
  assert.equal(result.visible, false);
  assert.match(result.filterReason, /活动或会务/);
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
  const result = evaluatePolicy({ ...base, title: "氢能企业研发支持通知", content: "聚焦氢能燃料电池关键技术研发和成果转化。" }, now);
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

test("过期申报窗口和已结束活动直接丢弃", () => {
  const deadlineExpired = evaluatePolicy({ ...base, title: "氢能项目申报", deadline: "2026-09-01", content: "企业申报资金补助" }, now);
  const midnightDeadlineExpired = evaluatePolicy({ ...base, title: "氢能项目申报", deadline: "2026-06-25", deadlineTime: "24:00", content: "企业申报资金补助" }, now);
  const activityExpired = evaluatePolicy({ ...base, title: "氢能路演嘉宾征集", content: "创业者可受邀演讲", activityDate: "2026-08-31" }, now);
  assert.equal(deadlineExpired.decision, "discarded");
  assert.equal(deadlineExpired.filterReason, "已过申报截止时间");
  assert.equal(midnightDeadlineExpired.decision, "discarded");
  assert.equal(midnightDeadlineExpired.filterReason, "已过申报截止时间");
  assert.equal(activityExpired.decision, "discarded");
  assert.equal(activityExpired.filterReason, "活动日期已结束");
});

test("正文中的申报日期区间会使用结束日判断过期", () => {
  const result = evaluatePolicy({
    ...base,
    title: "关于开展2026年度氢能技术项目申报的通知",
    content: "支持对象为氢能企业。企业于2026年4月25日至5月25日通过平台填报并提交材料。",
  }, now);
  assert.equal(result.timing.deadlineDate, "2026-05-25");
  assert.equal(result.decision, "discarded");
  assert.equal(result.filterReason, "已过申报截止时间");
});

test("往年和跨年度未核验的申报通知不能作为仍可申报事项展示", () => {
  const pastAnnual = evaluatePolicy({
    ...base,
    publishDate: "2025-06-30",
    title: "关于转发国家重点研发计划氢能技术重点专项2025年度项目申报指南的通知",
    content: "氢能技术重点专项项目申报。",
    originalVerification: { verified: false, retrievalStatus: "not_checked" },
  }, now);
  const crossYear = evaluatePolicy({
    ...base,
    publishDate: "2025-06-17",
    title: "关于组织申报低空经济重大科技专项2026年度项目的通知",
    content: "低空经济重大科技专项项目申报。",
    originalVerification: { verified: false, retrievalStatus: "not_checked" },
  }, now);
  assert.equal(pastAnnual.decision, "discarded");
  assert.match(pastAnnual.filterReason, /2025/);
  assert.equal(crossYear.decision, "discarded");
  assert.match(crossYear.filterReason, /跨年度/);
});

test("非申报型的长期政策措施不会被跨年度规则误删", () => {
  const result = evaluatePolicy({
    ...base,
    region: "杭州市",
    publishDate: "2025-10-10",
    title: "杭州市人民政府办公厅关于印发财政金融协同支持科技创新若干措施的通知",
    content: "支持国家高新技术企业贷款贴息和技术改造，给予补助。",
    originalVerification: { verified: false, retrievalStatus: "not_checked" },
  }, now, profile);
  assert.equal(result.decision, "needs_review");
  assert.equal(result.visible, true);
});

test("仍在有效期且写明认定程序的管理办法可进入可申报", () => {
  const result = evaluatePolicy({
    ...base,
    region: "杭州市",
    publishDate: "2023-12-26",
    title: "杭州市科学技术局关于印发《杭州市科技企业孵化器管理办法》的通知",
    content: "市级孵化器运营主体通过数字管理平台在线申报，提交相应申报材料。在孵企业从事新技术、新产品研发，可通过高新技术企业备案。对市级孵化器给予运营资助、绩效奖励和升级奖励。本办法自2024年1月26日起施行，有效期至2027年12月31日。",
  }, now, profile);
  assert.equal(result.decision, "eligible");
});

test("已届满的长期政策即使附件可读取也直接丢弃", () => {
  const result = evaluatePolicy({
    ...base,
    title: "杭州市科技企业孵化器认定和管理办法",
    publishDate: "2020-07-03",
    content: "对市级孵化器给予建设经费资助。本办法自2020年8月3日起施行，有效期至2022年12月31日。",
  }, now, profile);
  assert.equal(result.decision, "discarded");
  assert.match(result.filterReason, /有效期/);
});

test("五项关键证据任意命中一项即可判为 eligible", async (t) => {
  const cases = [
    ["支持对象", { content: "支持对象为科技企业，聚焦氢能关键技术。" }],
    ["申报主体", { content: "申报主体为企业，项目方向为氢能。" }],
    ["申报条件", { content: "申报条件：具备氢能研发能力。" }],
    ["支持方式", { content: "对氢能关键技术项目给予补助。" }],
    ["截止日期", { content: "氢能关键技术项目通知。", deadline: "2026-09-30" }],
  ];
  for (const [name, fields] of cases) {
    await t.test(name, () => {
      const result = evaluatePolicy({ ...base, title: "2026年氢能关键技术项目通知", ...fields }, now);
      assert.equal(result.decision, "eligible");
      assert.equal(result.evidence.completeness.sufficient, true);
      assert.equal(result.evidence.completeness.requiredCount, 1);
      assert.ok(result.evidence.completeness.matched.includes(name));
    });
  }
});

test("五项关键证据全部缺失时保留为待查", () => {
  const result = evaluatePolicy({ ...base, title: "氢能关键技术交流通知", content: "氢能关键技术发展信息。" }, now);
  assert.equal(result.decision, "needs_review");
  assert.equal(result.visible, true);
  assert.equal(result.evidence.completeness.matchedCount, 0);
});

test("原文未查、失败或暂不支持时都进入待查", async (t) => {
  for (const retrievalStatus of ["not_checked", "failed", "unsupported"]) {
    await t.test(retrievalStatus, () => {
      const result = evaluatePolicy({
        ...base,
        title: "2026年氢能项目申报通知",
        content: "支持对象为氢能企业，给予资金补助。",
        originalVerification: { verified: false, retrievalStatus, reason: "测试读取状态" },
      }, now);
      assert.equal(result.decision, "needs_review");
      assert.equal(result.visible, true);
      assert.match(result.decisionReasons.join("；"), /原文|文档/);
    });
  }
});

test("原文已读取时标题不一致或无申报信号不再是否决条件", () => {
  const result = evaluatePolicy({
    ...base,
    title: "氢能技术支持通知",
    content: "支持对象为氢能技术企业。",
    originalVerification: {
      verified: true,
      retrievalStatus: "parsed",
      diagnostics: { titleMatched: false, hasApplicationSignal: false, completedActivity: false },
    },
  }, now);
  assert.equal(result.decision, "eligible");
});

test("有效的产业供给能力征集会标为可作为供给方", () => {
  const result = evaluatePolicy({
    ...base,
    region: "苏州市",
    title: "关于公开征集苏州市2026年低空经济应用场景需求及产业供给能力清单的公告",
    deadline: "2026-09-30",
    content: "现面向苏州市范围内低空领域的企业公开征集。重点征集创新性强、技术含量高的低空经济应用项目，包括低空经济领域新技术、新产品和创新解决方案。填报主体具有新技术、新产品供给能力且有意愿参与应用场景建设。请于2026年9月30日前在线填写并提交。",
  }, now);
  assert.equal(result.decision, "supplier_call");
  assert.equal(result.visible, true);
  assert.equal(result.matchLevel, "可作为供给方");
  assert.equal(result.supportAssessment.participationType, "supplier");
});

test("已截止的供给方征集也直接丢弃", () => {
  const result = evaluatePolicy({
    ...base,
    region: "苏州市",
    title: "关于公开征集苏州市2026年低空经济应用场景需求及产业供给能力清单的公告",
    deadline: "2026-05-20",
    content: "面向低空领域企业公开征集产业供给能力清单，填报主体具有新技术、新产品供给能力并参与应用场景建设。",
  }, now);
  assert.equal(result.decision, "discarded");
  assert.equal(result.filterReason, "已过申报截止时间");
});

test("正文中“于某日前报送”的截止日也会直接丢弃", () => {
  const result = evaluatePolicy({
    ...base,
    region: "苏州市",
    title: "关于公开征集低空经济产业供给能力清单的公告",
    content: "面向低空领域企业公开征集产业供给能力清单，填报主体具有新技术、新产品供给能力并参与应用场景建设。请报送单位于2026年5月20日前在线填写并提交。",
  }, now);
  assert.equal(result.timing.deadlineDate, "2026-05-20");
  assert.equal(result.decision, "discarded");
  assert.equal(result.filterReason, "已过申报截止时间");
});

test("已截止的硬性规则优先于原文读取状态，并且直接丢弃", () => {
  const result = evaluatePolicy({
    ...base,
    title: "2026年氢能项目申报通知",
    deadline: "2026-09-01",
    content: "支持对象为氢能企业。",
    originalVerification: { verified: false, retrievalStatus: "failed", reason: "HTTP 500" },
  }, now);
  assert.equal(result.decision, "discarded");
  assert.equal(result.filterReason, "已过申报截止时间");
});
