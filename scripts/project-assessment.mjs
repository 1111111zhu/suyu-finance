import { cleanPolicyText, extractApplicationTiming } from "./policy-time.mjs";
import { RULES_VERSION, supportKinds, guideNeedsReview, FUNDING_SIGNAL } from "./policy-integrity.mjs";

export const companies = [
  { id: "suzhou", name: "苏州溯驭", city: "苏州市", province: "江苏省" },
  { id: "hangzhou", name: "杭州溯驭", city: "杭州市", province: "浙江省" },
  { id: "lianyungang", name: "连云港溯驭", city: "连云港市", province: "江苏省" },
];

// “通知” is a format: distinguish actual calls from supplements and policy bases.
export function projectDocumentKind(policy) {
  if (policy.containerOnly) return {kind:'supplement',reason:'已拆分指南容器，独立子项另列，不重复计数'};
  const title = cleanPolicyText(policy.title);
  const body = cleanPolicyText(policy.content || "");
  const financialApplication = /申报|申领|申请|兑现|兑付|领取|领用/.test(title) && FUNDING_SIGNAL.test(title);
  // A policy basis may itself define a concrete rolling application. Keep the
  // exception narrow; general plans and policy commentary remain research leads.
  const embeddedCall = /常年受理|全年受理|随报随审/.test(body) && /申报条件|申请条件|申领条件/.test(body) && /提交.{0,12}材料|平台.{0,20}申领|网上申报/.test(body) && /补助|补贴|资助|创新券|服务券/.test(body);
  if (/补充通知|补正通知|更正|勘误|延期|延长.{0,12}(申报|受理)|申报.{0,12}(延期|延长)/.test(title)) return { kind: "supplement", reason: "补充／调整文件，作为对应申报项目的依据，不单独列项" };
  if (/征求意见|公示$|结果公示|名单公示|拟立项|拟认定|拟推荐|资金下达|拨付|验收|绩效评价结果|撤销|废止|终止|公告公示/.test(title)
    || /(?:名单|结果)(?:的)?(?:通知|公告)$/.test(title)) return { kind: "excluded", reason: "结果、公示或既有项目管理文件，不是新申报" };
  if (/亏损结转|税前扣除|税收征管|税费申报|税率|免申即享/.test(title)) return { kind: "excluded", reason: "税务政策或免申办理事项，不是独立项目申报" };
  if (/新闻|喜报|调研|走访|座谈|再创新高|案例分享|活动回顾|成功举办|顺利举办/.test(title)
    || !financialApplication && /会议|科技活动|培训|论坛|峰会|大讲堂|讲座|招聘|招标|采购|挂牌|拍卖|职称|统计|摸排|摸底|调查|征求|立项建议|委员|服务智慧地图|遴选承担|审计工作|供给能力|供给方|供需对接|需求征集|征集.{0,16}需求|征集.{0,16}供应商/.test(title)) return { kind: "excluded", reason: "新闻、活动、信息征集或日常办事，不是企业项目申报" };
  if (/若干意见|若干措施|管理办法|实施办法|发展规划|行动方案|实施意见|工作方案|工作流程|实施方案|实施细则|工作纪律|认定管理工作/.test(title)
    && !/组织.{0,12}申报|开展.{0,25}申报|申报指南|申请指南/.test(title) && !embeddedCall) return { kind: "basis", reason: "政策依据，需关联具体项目申报通知或提取独立受理事项" };
  const action = /申报|申请|申领|领用|领取|兑付|遴选|揭榜|评选|征集|入库|兑现|推荐|开展.{0,30}(认定|复核)/.test(title);
  const object = /项目|专项|计划|资金|补助|补贴|奖励|资助|贴息|认定|复核|遴选|揭榜|入库|评选|培育|技术中心|研发中心|创新中心|实验室|创新券|服务券|数改券|算力券|首台套|首版次|江苏精品|标准|企业/.test(title);
  const bodyCall = /(?:现|本次|组织|开展|启动|受理).{0,25}(?:项目申报|专项申报|企业认定|项目征集)/.test(body);
  if (action && object || bodyCall || embeddedCall) return { kind: "application", reason: "具体项目申报／认定事项，仍须核实正文证据" };
  return { kind: "lead", reason: "尚未确认独立申报事项，保留内部核查" };
}

function citation(text, pattern, source = "content") {
  const match = text.match(pattern);
  return { found: Boolean(match), citations: match ? [{ source, term: match[0], excerpt: text.slice(Math.max(0, match.index - 40), match.index + match[0].length + 150) }] : [] };
}

function companyAssessment(policy, company, timing, authenticity, now, profile) {
  const region = policy.region || "";
  const common = { companyId: company.id, companyName: company.name };
  if ((["江苏省", "浙江省"].includes(region) && region !== company.province) || (["苏州市", "杭州市", "连云港市"].includes(region) && region !== company.city)) return { ...common, status: "ineligible", reasons: ["该项目属地不适用"], missing: [] };
  // A review is scoped to the exact policy content and individual company version.
  const review = policy.qualificationReviews?.[company.id];
  const confirmed = review?.status === "verified" && review.complete === true
    && review.policyHash && review.policyHash === policy.contentHash
    && review.profileVersion && review.profileVersion === profile?.companies?.[company.id]?.version
    && review.checkedAt && +new Date(review.checkedAt) <= +now
    && (!review.validUntil || +new Date(review.validUntil) >= +now)
    && review.conditions?.length > 0 && review.conditions.every(c => c.evidence && ["met", "not_met", "not_applicable"].includes(c.status));
  if (confirmed && review.conditions.some(c => c.status === "not_met")) return { ...common, status: "ineligible", reasons: review.conditions.filter(c => c.status === "not_met").map(c => c.label), missing: [] };
  const missing = [];
  if (!confirmed && /不含赣榆|不含赣榆区/.test(cleanPolicyText(policy.content))) missing.push("本项目排除赣榆区；须核对该主体实际注册及纳税区县");
  if (!confirmed) missing.push("该主体注册／纳税属地及本项目全部申报条件待核实");
  if (authenticity.status !== "confirmed") missing.push("申报原文及关键附件未完整核实");
  if (timing.applicationWindowStatus === "unknown") missing.push("企业实际申报窗口待核实");
  if (timing.applicationWindowStatus === "expired") return { ...common, status: "expired", reasons: ["本批次企业申请已截止"], missing };
  if (policy.originalVerification?.retrievalStatus !== "parsed") missing.push("关键附件未完整读取");
  const status = confirmed && !missing.length ? timing.applicationWindowStatus === "upcoming" ? "upcoming" : "eligible" : "needs_review";
  return { ...common, status, reasons: confirmed ? ["该主体全部适用条件已逐项核验"] : ["申报事项已识别；企业资格尚未确认"], missing };
}

export function evaluateProject(policy, now = new Date(), companyProfile = null) {
  const kind = projectDocumentKind(policy);
  const title = cleanPolicyText(policy.title);
  const text = cleanPolicyText(policy.content || "");
  const timing = extractApplicationTiming(policy, now);
  const retrieval = policy.originalVerification?.retrievalStatus || "not_checked";
  const evidence = {
    beneficiary: citation(text, /申报对象|支持对象|申请对象|企业|单位|创新团队/),
    applicant: citation(text, /申报单位|申请单位|企业申报|企业可申报|申报主体|申报企业|牵头单位|注册.{0,15}企业/),
    conditions: citation(text, /申报条件|申请条件|申报要求|基本条件|申报资格|须具备|应满足|应具备|申报单位应/),
    support: citation(`${title}。${text}`, /补助|补贴|奖励|奖补|资助|贴息|认定|遴选|专项|立项|入库|重点项目|服务券|创新券|数改券|算力券/),
    workflow: citation(text, /提交|报送|填报|申报系统|申报平台|网上申报|网上申请|申报材料|申请材料|审核推荐|在线申报/),
    deadline: timing.deadline,
    governmentPolicyDocument: { isPolicyDocument: !["lead", "excluded"].includes(kind.kind) },
  };
  const hasBody = text.length >= 50 && ["parsed", "partial"].includes(retrieval);
  let officialSource = false;
  try { const host = new URL(policy.url).hostname; officialSource = host.endsWith(".gov.cn") || ["www.qyfw.suzhou.com.cn", "qyfw.suzhou.com.cn"].includes(host); } catch { /* missing original stays a lead */ }
  const sourceBound = policy.originalVerification?.bindingStatus === "matched" && policy.originalVerification?.titleMatched !== false;
  const contradictory = /不受理任何项目申请|不产生.{0,10}(资助|立项)|本次仅为.{0,10}(培训|摸底|信息登记)/.test(text);
  const confirmedProject = kind.kind === "application" && hasBody && officialSource && sourceBound && !contradictory && evidence.workflow.found && evidence.support.found && evidence.beneficiary.found;
  const authenticity = { status: confirmedProject ? "confirmed" : "unconfirmed", kind: kind.kind, reason: kind.reason };
  const matched = ["beneficiary", "applicant", "conditions", "support", "deadline"].filter(k => evidence[k].found);
  evidence.completeness = { complete: matched.length === 5, sufficient: false, matchedCount: matched.length, requiredCount: 5, missing: [], matched };
  let decision = "needs_review";
  let reason = kind.reason;
  if (kind.kind !== "application") decision = kind.kind === "lead" ? "needs_review" : "discarded";
  else if (timing.applicationWindowStatus === "expired") { decision = "discarded"; reason = "企业申报截止日期已过"; }
  else if (/养老机构|医疗机构|卫生机构|生物医药|创新药物|传染病|临床|农业生物|农业种植|畜牧|渔业|餐饮|旅游|体育赛事|文化旅游|教师|学校|孵化器|众创空间|水利工程质量检测|视听节目|领军服务机构|新型墙体材料/.test(title)
    && !/氢能|低空|电控|新能源/.test(title)) { decision = "ineligible"; reason = "申报对象为其他专业行业或平台运营机构"; }
  else if (/仅限.{0,12}(政府|事业单位|高校)|申报主体为.{0,12}(人民政府|区县)/.test(text)) { decision = "ineligible"; reason = "该项目不向企业主体开放"; }
  const companyAssessments = companies.map(c => companyAssessment(policy, c, timing, authenticity, now, companyProfile));
  if (decision === "needs_review" && kind.kind === "application") {
    if (companyAssessments.every(c => c.status === "ineligible")) { decision = "ineligible"; reason = "三家主体均不适用"; }
    else if (companyAssessments.some(c => c.status === "eligible")) decision = "eligible";
    else if (timing.applicationWindowStatus === "upcoming" && confirmedProject) decision = "upcoming";
  }
  const annualYear = Number(title.match(/(20\d{2})年度?/)?.[1] || 0);
  const oldDate = policy.publishDate && +new Date(`${policy.publishDate}T00:00:00+08:00`) < +now - 366 * 86400000;
  const staleWindow = timing.applicationWindowStatus === "unknown" && (annualYear && annualYear < now.getFullYear() || oldDate);
  const visible = confirmedProject && ["eligible", "needs_review", "upcoming"].includes(decision);
  if (staleWindow && decision === "needs_review") reason = "跨年度项目受理窗口待核实，不凭标题年份排除";
  const missing = [...new Set(companyAssessments.filter(c => c.status !== "ineligible").flatMap(c => c.missing))];
  evidence.completeness.missing = missing;
  evidence.completeness.sufficient = decision === "eligible";
  const reasons = visible ? [timing.deadlineDate ? `企业申报截止：${timing.deadlineDate}` : timing.applicationWindowStatus === "ongoing" ? "官方明确常年受理" : "申报时间待核实", ...missing] : [reason];
  const requirementsSection = text.match(/(?:申报条件|申报要求|申请条件|基本条件)[\s\S]{0,6000}/)?.[0]?.split(/申报程序|申报流程|申报方式|申报时间|申报材料|联系方式/)[0] || "";
  return {
    rulesVersion: RULES_VERSION, visible, decision, eligibilityStatus: decision, matchStatus: decision,
    supportKinds: supportKinds(policy), subprojectReviewRequired: guideNeedsReview(policy),
    verificationIssues: [...(!officialSource ? ["官方原文来源待核"] : []), ...(!sourceBound ? ["原标题与正文／附件关联待核"] : []), ...(contradictory ? ["正文与申报性质冲突"] : [])],
    projectAuthenticity: authenticity, companyAssessments, timing, evidence, windowReviewRequired: Boolean(staleWindow),
    deadline: timing.deadlineDate, deadlineTime: timing.deadlineTime, daysLeft: timing.daysLeft,
    matchScore: 0, rankScore: 0, needsReview: decision === "needs_review",
    matchLevel: decision === "eligible" ? "可申报" : "资格待核实",
    filterReason: visible ? "" : reason, decisionReasons: reasons, matchReasons: reasons,
    governmentPolicyDocument: evidence.governmentPolicyDocument,
    applicableCompanies: companyAssessments.filter(c => c.status !== "ineligible").map(c => c.companyId),
    applicationRequirements: requirementsSection,
  };
}
