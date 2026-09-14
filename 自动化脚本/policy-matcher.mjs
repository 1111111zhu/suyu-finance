import { applicationEntities as configuredApplicationEntities, applicationScopeDefinitions } from "../数据配置/application-entities.mjs";

const trackGroups = [
  { name: "氢能与燃料电池", weight: 35, terms: ["氢能", "氢能源", "燃料电池", "氢燃料", "氢电耦合", "氢动力", "氢储能", "氢发电", "制氢", "储氢"] },
  { name: "新能源电控与电力电子", weight: 28, terms: ["电控", "电力电子", "能量管理", "功率控制", "控制器", "碳化硅", "sic", "电机控制", "系统集成"] },
  { name: "低空经济与无人系统", weight: 28, terms: ["低空经济", "无人机", "无人飞行器", "航空器", "飞控", "低空物流", "智能巡检", "长航时"] },
  { name: "新能源与零碳应用", weight: 18, terms: ["新能源", "新型储能", "新型电力系统", "微电网", "源网荷储", "多能互补", "分布式能源", "绿色低碳", "零碳", "节能降碳"] },
  { name: "智能制造与关键技术", weight: 16, terms: ["智能制造", "工业软件", "数字经济", "技术改造", "关键核心技术", "首台套", "首版次", "中试", "成果转化", "产业化", "揭榜挂帅"] },
  { name: "科技企业培育", weight: 15, terms: ["科技型中小企业", "高新技术企业", "专精特新", "独角兽", "孵化器", "研发中心", "技术中心", "重点实验室", "研发投入", "科技创新", "未来产业"] },
  { name: "创新人才与产学研", weight: 12, terms: ["创新团队", "创新项目", "创新场景", "技术创新", "人才", "领军人才", "创业人才", "留学人员", "产学研", "知识产权", "专利", "创新创业"] },
];

const applicationTerms = ["申报", "征集", "遴选", "评选", "推荐", "认定", "培育库", "补助", "补贴", "资助", "奖励", "揭榜挂帅", "项目计划", "申报指南", "专项指南", "重点专项", "专项资金", "项目通知"];
const formalApplicationTerms = ["申报", "申请", "认定", "项目计划", "申报指南", "专项指南", "重点专项", "专项资金", "项目通知"];
const enterpriseTerms = ["企业", "科技型中小企业", "高新技术企业", "中小微", "初创企业", "创新型企业", "研发机构", "创新团队"];
const supportTerms = ["研发", "科技计划", "成果转化", "技术改造", "资金", "补助", "补贴", "贴息", "资助", "人才", "融资", "知识产权", "培育"];
const directSupportTerms = ["资金", "专项资金", "补助", "补贴", "奖励", "资助", "贷款贴息", "贴息", "服务券", "场地", "用房", "用地", "场租", "租金补贴", "资源配额", "配额", "资质", "资格认定", "认定", "贷款", "融资支持"];
const benefitCategories = [
  { code: "funding", label: "资金", terms: ["资金", "补助", "补贴", "奖励", "资助"] },
  { code: "qualification", label: "资质", terms: ["资质", "资格认定", "认定"] },
  { code: "space", label: "场地", terms: ["场地", "用房", "用地", "场租", "租金补贴"] },
  { code: "loan_interest", label: "贷款贴息", terms: ["贷款贴息", "贴息"] },
  { code: "resource_quota", label: "资源配额", terms: ["资源配额", "配额"] },
  { code: "service_voucher", label: "服务券", terms: ["服务券"] },
];
const applicantTerms = ["申报主体", "申请主体", "企业申报", "企业可申报", "企业可申请", "由企业申报", "由企业申请", "面向企业申报", "面向企业征集", "参评企业"];
const eligibilityConditionTerms = ["申报条件", "申请条件", "申报要求", "申请要求", "申报资格", "申请资格", "基本条件", "符合条件", "满足条件", "需具备", "应当具备", "须具备"];
const organizerRoleTerms = ["主办方", "主办单位", "承办方", "承办单位", "协办方", "协办单位", "举办单位", "组织单位", "组织实施单位", "活动组织", "会务", "会务执行", "会务服务"];
const organizerActionTerms = ["主办", "承办", "协办", "举办", "组织"];
const eventTerms = ["大讲堂", "讲座", "论坛", "峰会", "路演", "沙龙", "推介会", "对接会", "交流会", "发布会", "培训会", "大赛", "展会"];
const opportunityTerms = ["受邀", "演讲", "讲话", "分享", "嘉宾", "参会", "报名参加", "报名参会", "路演", "展示", "推介"];
const invitationTerms = ["邀请制", "定向邀请", "受邀", "邀请参加", "邀请函", "获邀"];
const priorFilingTerms = ["事前备案", "提前备案", "预先备案"];
const negativeTerms = ["农业种植", "畜牧", "渔业", "房地产", "商品房", "物业管理", "餐饮", "旅游景区", "文艺演出", "体育赛事", "生物医药", "医药产业", "创新药", "医疗器械", "医疗机构", "药品注册", "临床试验", "教师", "学校招生", "养老", "人防工程", "政府采购中标", "结果公示", "会议通知", "工作总结"];
// These industries are not adjacent to 溯驭的氢能电控、低空与新型电力系统
// 业务。它们不能因为正文顺带出现“创新”“新能源”等泛词被重新放回队列。
const excludedIndustryTerms = ["生物医药", "医药产业", "创新药", "医疗器械", "药品注册", "临床试验", "农业种植", "畜牧", "渔业", "房地产", "商品房", "物业管理", "餐饮", "旅游景区", "文艺演出", "体育赛事", "教师", "学校招生", "养老"];
const publicSectorApplicantTerms = ["县（市、区）试点", "县市区试点", "区县试点", "市、区试点", "政府申报", "人民政府申报"];
const portalTerms = ["服务网", "服务专区", "申报平台", "管理办法", "实施意见", "行动方案", "工作方案"];
const resultTerms = ["公示", "名单", "评审结果", "拟推荐", "拟认定", "拟入选", "结果公告"];
const completedActivityTerms = ["成功举办", "圆满举办", "顺利举办", "活动回顾", "工作动态", "经验交流", "会议纪要"];
const coreIndustryTerms = ["氢能", "氢能源", "燃料电池", "氢燃料", "氢电耦合", "氢动力", "制氢", "储氢", "电控", "电力电子", "能量管理", "功率控制", "控制器", "碳化硅", "低空经济", "无人机", "无人飞行器", "飞控", "新型储能", "新型电力系统", "微电网", "源网荷储", "多能互补", "绿色氢"];
const qualificationRecognitionTerms = ["高新技术企业", "国家高新技术企业", "高企认定", "专精特新中小企业", "专精特新“小巨人”", "专精特新\"小巨人\"", "专精特新小巨人", "小巨人企业"];

const includesAny = (text, terms) => terms.filter((term) => text.includes(term.toLowerCase()));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function textFields(policy) {
  return [
    ["title", String(policy.title || "")],
    ["summary", String(policy.summary || "")],
    ["content", String(policy.content || "")],
  ];
}

function excerpt(value, start, term) {
  const from = Math.max(0, start - 40);
  const to = Math.min(value.length, start + term.length + 80);
  return `${from ? "…" : ""}${value.slice(from, to).replace(/\s+/g, " ").trim()}${to < value.length ? "…" : ""}`;
}

// Each hit records where it came from and a short original-text excerpt. This lets
// a reviewer verify the decision without treating keyword matching as evidence.
function findEvidence(policy, terms, max = 2) {
  const citations = [];
  for (const [source, value] of textFields(policy)) {
    const lower = value.toLowerCase();
    for (const term of terms) {
      const index = lower.indexOf(term.toLowerCase());
      if (index < 0) continue;
      citations.push({ source, term, excerpt: excerpt(value, index, term) });
      if (citations.length >= max) return { found: true, citations };
    }
  }
  return { found: citations.length > 0, citations };
}

function benefitEvidence(policy) {
  return benefitCategories.map((category) => ({ ...category, evidence: findEvidence(policy, category.terms, 1) })).filter((category) => category.evidence.found);
}

function firstDate(value = "") {
  const match = String(value).match(/(20\d{2})[年.\/-](\d{1,2})[月.\/-](\d{1,2})日?/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function dateEvidence(policy) {
  if (parseDate(policy.deadline, policy.deadlineTime)) {
    return { found: true, citations: [{ source: "deadline", term: policy.deadline, excerpt: `${policy.deadline}${policy.deadlineTime ? ` ${policy.deadlineTime}` : ""}` }] };
  }
  return findEvidence(policy, ["截至", "截止时间", "截止", "申报时间", "受理时间", "网上填报时间", "填报时间", "申报期限", "系统关闭"]);
}

function findActivityDate(policy) {
  const provided = firstDate(policy.activityDate || policy.eventDate || policy.activityStartDate || "");
  if (provided) return { date: provided, evidence: { found: true, citations: [{ source: policy.activityDate ? "activityDate" : policy.eventDate ? "eventDate" : "activityStartDate", term: provided, excerpt: provided }] } };
  for (const [source, value] of textFields(policy)) {
    const match = value.match(/(?:活动|会议|讲堂|讲座|路演|论坛|培训|举办|召开)(?:日期|时间)?[^。；]{0,40}?(20\d{2}[年.\/-]\d{1,2}[月.\/-]\d{1,2}日?)/);
    if (!match) continue;
    const date = firstDate(match[1]);
    if (date) return { date, evidence: { found: true, citations: [{ source, term: match[1], excerpt: excerpt(value, match.index + match[0].indexOf(match[1]), match[1]) }] } };
  }
  return { date: "", evidence: { found: false, citations: [] } };
}

function findProjectPeriod(policy) {
  if (policy.projectPeriod || policy.implementationPeriod) {
    const value = String(policy.projectPeriod || policy.implementationPeriod);
    return { value, evidence: { found: true, citations: [{ source: policy.projectPeriod ? "projectPeriod" : "implementationPeriod", term: value, excerpt: value }] } };
  }
  return { value: "", evidence: findEvidence(policy, ["项目周期", "实施期限", "执行期限", "项目实施期"], 1) };
}

function invitationEvidence(policy) {
  const value = policy.invitationEvidence || policy.invitationProofUrl || policy.invitationProof;
  if (!value) return { found: false, citations: [] };
  const stringValue = typeof value === "string" ? value.trim() : String(value);
  return stringValue && stringValue !== "false"
    ? { found: true, citations: [{ source: "invitationEvidence", term: "已提供", excerpt: stringValue.slice(0, 160) }] }
    : { found: false, citations: [] };
}

function activityAssessment(policy, now) {
  const organizerRole = findEvidence(policy, organizerRoleTerms);
  const event = findEvidence(policy, eventTerms);
  const titleEvent = findEvidence({ title: policy.title }, eventTerms, 1);
  const organizerAction = findEvidence(policy, organizerActionTerms);
  const applicant = findEvidence(policy, applicantTerms);
  const applicationWorkflow = findEvidence(policy, formalApplicationTerms, 1);
  const opportunity = findEvidence(policy, opportunityTerms);
  const invitationRequirement = findEvidence(policy, invitationTerms);
  // “组织开展补贴活动”不等于企业要申报活动主办方。仅在正文明确主办/承办角色，
  // 或通知标题本身是讲座、论坛、路演等活动且出现组织动作时，才进入活动角色判断。
  const hasOrganizerEvent = (event.found && organizerRole.found) || (titleEvent.found && organizerAction.found);
  // “组织申报”是常见的政府表述，不能因其中的“组织”把企业项目错判为活动主办方项目；
  // 但正文明确征集承办/会务等组织角色时，仍应排除企业申报资格。
  const isOrganizerProject = hasOrganizerEvent && !applicant.found && (organizerRole.found || (organizerAction.found && !applicationWorkflow.found));
  const isEnterpriseOpportunity = !isOrganizerProject && !applicant.found && !applicationWorkflow.found && event.found && (opportunity.found || invitationRequirement.found);
  const role = isOrganizerProject ? "organizer" : isEnterpriseOpportunity ? "enterprise_opportunity" : applicant.found ? "enterprise_applicant" : "unknown";
  const activity = findActivityDate(policy);
  const period = findProjectPeriod(policy);
  const deadline = parseDate(policy.deadline, policy.deadlineTime);
  const activityDeadline = parseDate(activity.date);
  const priorFiling = findEvidence(policy, priorFilingTerms, 1);
  const priorFilingExempt = includesAny(`${policy.title || ""} ${policy.summary || ""} ${policy.content || ""}`.toLowerCase(), ["无需事前备案", "免于事前备案"]).length > 0;
  const daysLeft = deadline ? Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000) : null;
  return {
    role,
    organizerRole,
    organizerAction,
    applicant,
    applicationWorkflow,
    opportunity,
    invitationRequirement,
    invitationEvidence: invitationEvidence(policy),
    isOrganizerProject,
    isEnterpriseOpportunity,
    timing: {
      applicationWindow: findEvidence(policy, ["申报时间", "受理时间", "申请时间", "申报窗口"], 1),
      deadline: dateEvidence(policy),
      deadlineDate: policy.deadline || "",
      deadlineTime: policy.deadlineTime || "",
      daysLeft,
      applicationWindowStatus: deadline ? (deadline.getTime() < now.getTime() ? "expired" : "open") : "unknown",
      activityDate: activity.date,
      activityDateEvidence: activity.evidence,
      activityStatus: activityDeadline ? (activityDeadline.getTime() < now.getTime() ? "expired" : "upcoming") : "unknown",
      projectPeriod: period.value,
      projectPeriodEvidence: period.evidence,
      requiresPriorFiling: priorFiling.found && !priorFilingExempt,
      priorFilingEvidence: priorFiling,
    },
  };
}

function parseDate(value, time = "") {
  if (!value || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return null;
  // Official notices commonly write “24:00” for the end of that calendar day.
  // `T24:00:59` is invalid ISO, so normalize it to the final minute instead of
  // silently converting an expired deadline into an unknown one.
  const normalizedTime = time === "24:00" ? "23:59" : time || "23:59";
  const date = new Date(`${value}T${normalizedTime}:59+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function regionScore(region) {
  if (region === "国家") return { score: 12, reason: "国家级项目" };
  if (/省$|自治区$/.test(region || "")) return { score: 9, reason: `${region}省级项目` };
  if (/市$/.test(region || "")) return { score: 5, reason: `${region}市级项目` };
  return { score: 2, reason: "地区信息待补充" };
}

function urgency(daysLeft) {
  if (daysLeft === null) return 0;
  if (daysLeft <= 3) return 100;
  if (daysLeft <= 7) return 90;
  if (daysLeft <= 15) return 75;
  if (daysLeft <= 30) return 55;
  if (daysLeft <= 60) return 30;
  return 10;
}

function nestedValue(value, path) {
  return path.split(".").reduce((current, key) => current && typeof current === "object" ? current[key] : undefined, value);
}

function verifiedProfileField(profile, path) {
  const field = nestedValue(profile, path);
  return field?.status === "verified" ? field : null;
}

function locationParts(value = "") {
  return String(value).match(/[\u4e00-\u9fff]{2,12}?(?:自治区|特别行政区|省|市|新区|开发区|区|县)/g) || [];
}

function locationLevel(value = "") {
  if (/(?:省|自治区|特别行政区)$/.test(value)) return "province";
  if (/市$/.test(value)) return "city";
  if (/(?:新区|开发区|区|县)$/.test(value)) return "district";
  return null;
}

function sameLocation(left, right) {
  const normalize = (value) => String(value || "").replace(/(?:特别行政区|自治区|省|市|新区|开发区|区|县)$/, "");
  return normalize(left) === normalize(right);
}

function applicationEntitiesFor(companyProfile) {
  const configured = Array.isArray(companyProfile?.applicationEntities) ? companyProfile.applicationEntities : null;
  return configured?.length ? configured : configuredApplicationEntities;
}

function isAllowedEntityRegion(policyRegion, allowedRegions = []) {
  // National notices can be assigned to a configured entity. Province/city
  // notices must be in that entity's assigned jurisdiction; this stops a
  // Jiangsu high-tech notice from being labelled as a Hangzhou application.
  return policyRegion === "国家" || allowedRegions.includes(policyRegion);
}

function applicationEntityAssessment(policy, fullText, companyProfile) {
  const title = String(policy.title || "").toLowerCase();
  const titleQualificationHits = includesAny(title, qualificationRecognitionTerms);
  const isRecognitionNotice = titleQualificationHits.length > 0 && /(认定|复核|申报|申请|受理|延长)/.test(title);
  const scopeHits = applicationScopeDefinitions.filter((scope) => includesAny(title, scope.terms).length > 0);
  const entities = applicationEntitiesFor(companyProfile);
  const matches = [];

  for (const scope of scopeHits) {
    for (const entity of entities) {
      const assignedScope = (entity.scopes || []).find((item) => item.id === scope.id);
      if (!assignedScope || !isAllowedEntityRegion(policy.region, entity.allowedRegions || [])) continue;
      matches.push({
        entityId: entity.id,
        entityLabel: entity.label,
        scopeId: scope.id,
        scopeLabel: scope.label,
        status: entity.status || "user_confirmed",
        confirmedAt: entity.confirmedAt || null,
      });
    }
  }

  // A general “专精特新中小企业” recognition is not synonymous with the
  // national Little Giant route. The latter must occur in the title itself.
  const hasProvincialSpecializedRecognition = /(专精特新中小企业).{0,12}(认定|复核|申报|申请)/.test(title);
  const recognizedScopeLabels = scopeHits.map((scope) => scope.label);
  return {
    isRecognitionNotice,
    titleQualificationHits,
    scopeHits: recognizedScopeLabels,
    matches,
    hasProvincialSpecializedRecognition,
  };
}

// 仅把公司档案中明确标为 verified 的“注册地”用于硬门槛。公开地址、
// 办公地或报道提到的所在地均不替代注册地，避免把推断当成事实。
function registeredLocationAssessment(fullText, companyProfile) {
  const profile = companyProfile?.matcherProfile || companyProfile;
  const requirements = [];
  const locationClauses = [
    ...String(fullText || "").matchAll(/(?:在|限(?:在)?|须在|应在|注册地为|注册登记在)([\u4e00-\u9fff]{2,24}(?:自治区|特别行政区|省|市|新区|开发区|区|县))[^。；，,]{0,16}(?:注册|登记)/g),
    ...String(fullText || "").matchAll(/(?:注册|登记)(?:地)?(?:须|应|需|限)?(?:为|在)([\u4e00-\u9fff]{2,24}(?:自治区|特别行政区|省|市|新区|开发区|区|县))/g),
  ];

  for (const clause of locationClauses) {
    const parts = locationParts(clause[1]);
    for (const requiredLocation of parts) {
      const level = locationLevel(requiredLocation);
      if (!level || requirements.some((item) => item.requiredLocation === requiredLocation)) continue;
      const field = verifiedProfileField(profile, `registeredLocation.${level}`);
      const status = !field ? "unknown" : sameLocation(field.value, requiredLocation) ? "met" : "not_met";
      requirements.push({
        type: "registered_location",
        label: `注册地须在${requiredLocation}`,
        profileField: `registeredLocation.${level}`,
        requiredLocation,
        actualLocation: field?.value ?? null,
        status,
        source: field?.source || null,
        evidence: field?.evidence || null,
      });
    }
  }

  return {
    profileLoaded: Boolean(profile),
    requirements,
    met: requirements.filter((requirement) => requirement.status === "met"),
    notMet: requirements.filter((requirement) => requirement.status === "not_met"),
    unknown: requirements.filter((requirement) => requirement.status === "unknown"),
  };
}

// Company facts are deliberately opt-in: callers that have not loaded a
// profile retain the previous document-only behaviour. When a profile is
// present, only leaves marked `verified` may influence a result.
function companyEligibilityAssessment(fullText, now, companyProfile) {
  if (!companyProfile) {
    return {
      profileLoaded: false,
      profileGeneratedAt: null,
      requirements: [],
      met: [],
      notMet: [],
      unknown: [],
    };
  }

  const profile = companyProfile.matcherProfile || companyProfile;
  const requirements = [];
  const qualifications = [
    { path: "qualifications.highTechEnterprise", label: "国家高新技术企业", terms: ["高新技术企业", "国家高新技术企业"] },
    { path: "qualifications.specializedSme", label: "专精特新中小企业", terms: ["专精特新中小企业", "专精特新"] },
    { path: "qualifications.potentialUnicorn", label: "潜在独角兽企业", terms: ["潜在独角兽", "准独角兽"] },
    { path: "qualifications.lowAltitudeEconomyLeader", label: "低空经济领航企业", terms: ["低空经济领航企业"] },
  ];

  for (const requirement of qualifications) {
    if (!includesAny(fullText, requirement.terms).length) continue;
    const field = verifiedProfileField(profile, requirement.path);
    const status = !field ? "unknown" : field.value === true ? "met" : "not_met";
    requirements.push({
      type: "qualification",
      label: requirement.label,
      profileField: requirement.path,
      status,
      source: field?.source || null,
      evidence: field?.evidence || null,
    });
  }

  const ageMatch = fullText.match(/(?:注册成立|成立)[^。；，,]{0,12}?(\d{1,2})\s*年(?:以上|及以上|及以上)/);
  if (ageMatch) {
    const requiredYears = Number(ageMatch[1]);
    const field = verifiedProfileField(profile, "foundedYear");
    const actualYears = typeof field?.value === "number" ? Math.max(0, now.getFullYear() - field.value) : null;
    requirements.push({
      type: "company_age",
      label: `成立满${requiredYears}年`,
      profileField: "foundedYear",
      requiredYears,
      actualYears,
      status: actualYears === null ? "unknown" : actualYears >= requiredYears ? "met" : "not_met",
      source: field?.source || null,
      evidence: field?.evidence || null,
    });
  }

  return {
    profileLoaded: true,
    profileGeneratedAt: companyProfile.generatedAt || null,
    requirements,
    met: requirements.filter((requirement) => requirement.status === "met"),
    notMet: requirements.filter((requirement) => requirement.status === "not_met"),
    unknown: requirements.filter((requirement) => requirement.status === "unknown"),
  };
}

function decisionFields(status, { visible, filterReason = "", matchScore = 0, rankScore = 0, daysLeft = null, reasons = [], assessment, evidence }) {
  const needsReview = false;
  const matchLevel = status === "matched" ? (matchScore >= 80 ? "高度匹配" : matchScore >= 65 ? "较高匹配" : "宽泛匹配") : status === "opportunity" ? "活动机会" : "不匹配";
  return {
    visible,
    ...(filterReason ? { filterReason } : {}),
    decision: status,
    // Keep both names so existing consumers can migrate without a breaking change.
    eligibilityStatus: status,
    matchStatus: status,
    matchScore,
    rankScore,
    daysLeft,
    needsReview,
    matchLevel,
    activityRole: assessment.role,
    activityRoleEvidence: {
      organizer: assessment.organizerRole,
      organizerAction: assessment.organizerAction,
      applicant: assessment.applicant,
      opportunity: assessment.opportunity,
    },
    supportAssessment: {
      directSupport: evidence.support.found,
      eligibleBenefits: evidence.benefits.map((benefit) => ({ code: benefit.code, label: benefit.label, evidence: benefit.evidence })),
      beneficiaryEvidence: evidence.beneficiary,
    },
    companyEligibility: evidence.companyEligibility,
    applicationEntities: evidence.applicationEntities,
    timing: assessment.timing,
    evidence,
    requiresInvitationEvidence: assessment.invitationRequirement.found,
    invitationEvidence: assessment.invitationEvidence,
    decisionReasons: reasons,
    matchReasons: reasons.slice(0, 4),
  };
}

function ineligible(assessment, evidence, filterReason, reasons = [filterReason]) {
  return decisionFields("ineligible", { visible: false, filterReason, assessment, evidence, reasons });
}

export function evaluatePolicy(policy, now = new Date(), companyProfile = null) {
  const title = (policy.title || "").toLowerCase();
  const fullText = `${policy.title || ""} ${policy.summary || ""} ${policy.content || ""}`.toLowerCase();
  const assessment = activityAssessment(policy, now);
  const companyEligibility = companyEligibilityAssessment(fullText, now, companyProfile);
  const registeredLocation = registeredLocationAssessment(fullText, companyProfile);
  const applicationEntities = applicationEntityAssessment(policy, fullText, companyProfile);
  const deadline = parseDate(policy.deadline, policy.deadlineTime);
  const daysLeft = assessment.timing.daysLeft;
  const evidence = {
    beneficiary: findEvidence(policy, enterpriseTerms),
    applicant: assessment.applicant,
    conditions: findEvidence(policy, eligibilityConditionTerms),
    support: findEvidence(policy, directSupportTerms),
    benefits: benefitEvidence(policy),
    deadline: assessment.timing.deadline,
    invitation: assessment.invitationEvidence,
    companyEligibility,
    registeredLocation,
    applicationEntities,
  };
  const requiredEvidence = [
    ["支持对象", evidence.beneficiary],
    ["申报主体", evidence.applicant],
    ["申报条件", evidence.conditions],
    ["支持方式", evidence.support],
    ["截止日期", evidence.deadline],
  ];
  const missingEvidence = requiredEvidence.filter(([, item]) => !item.found).map(([name]) => name);
  evidence.completeness = { complete: missingEvidence.length === 0, required: requiredEvidence.map(([name]) => name), missing: missingEvidence };

  if (deadline && deadline.getTime() < now.getTime()) return ineligible(assessment, evidence, "已过申报截止时间");
  if (assessment.isEnterpriseOpportunity && assessment.timing.activityStatus === "expired") return ineligible(assessment, evidence, "活动日期已结束");
  if (includesAny(title, resultTerms).length) return ineligible(assessment, evidence, "属于申报结果或名单公示");
  if (includesAny(title, completedActivityTerms).length) return ineligible(assessment, evidence, "属于已举办活动或工作动态，不是申报通知");
  if (includesAny(title, portalTerms).length && !title.includes("申报")) return ineligible(assessment, evidence, "属于政策依据或服务入口");
  if (includesAny(fullText, excludedIndustryTerms).length) return ineligible(assessment, evidence, "所属行业与溯驭核心业务无关");
  if (policy.originalVerification && policy.originalVerification.verified !== true) {
    return ineligible(assessment, evidence, policy.originalVerification.reason || "官方原文尚未验证，不进入项目库");
  }
  if (assessment.isOrganizerProject) return ineligible(assessment, evidence, "面向活动主办、承办或组织方，不是企业可申报政策", ["活动角色为主办/承办/组织方", "企业以受邀演讲或参会身份不能申报该项目"]);
  if (includesAny(title, publicSectorApplicantTerms).length) return ineligible(assessment, evidence, "申报主体为地方政府或区县试点，不是企业申报事项");
  if (registeredLocation.notMet.length) return ineligible(assessment, evidence, registeredLocation.notMet.map((item) => `${item.label}，公司已核验注册地为${item.actualLocation}`).join("；"));
  if (applicationEntities.hasProvincialSpecializedRecognition) {
    return ineligible(assessment, evidence, "省级专精特新认定不在当前主体申报范围；苏州溯驭仅跟踪国家级专精特新“小巨人”认定");
  }
  if (applicationEntities.isRecognitionNotice && !applicationEntities.matches.length) {
    const scope = applicationEntities.scopeHits.join("、") || applicationEntities.titleQualificationHits.join("、");
    return ineligible(assessment, evidence, `${scope}未命中已配置主体或属地，不进入项目申报页`);
  }

  const negatives = includesAny(title, negativeTerms);
  let trackScore = 0;
  const trackReasons = [];
  for (const group of trackGroups) {
    const titleHits = includesAny(title, group.terms);
    const bodyHits = includesAny(fullText, group.terms);
    if (!bodyHits.length) continue;
    const contribution = Math.min(group.weight, titleHits.length ? group.weight : Math.ceil(group.weight * 0.45));
    trackScore += contribution;
    trackReasons.push(`匹配${group.name}${titleHits.length ? `（${titleHits.slice(0, 2).join("、")}）` : ""}`);
  }
  trackScore = Math.min(45, trackScore + (trackReasons.length >= 2 ? 4 : 0));
  if (!trackReasons.length && negatives.length) return ineligible(assessment, evidence, "与公司赛道明显无关");

  const enterpriseHits = includesAny(fullText, enterpriseTerms);
  const enterpriseScore = enterpriseHits.some((term) => ["科技型中小企业", "高新技术企业"].includes(term)) ? 20 : enterpriseHits.length ? 15 : 4;
  const supportHits = includesAny(fullText, supportTerms);
  const supportScore = supportHits.some((term) => ["研发", "科技计划", "成果转化", "技术改造"].includes(term)) ? 15 : supportHits.length ? 10 : 4;
  const applicationHits = includesAny(fullText, applicationTerms);
  // 不再因缺少“申报”字样直接淘汰；只要原文仍有赛道、企业主体或支持
  // 方向信号，便由匹配度自然下沉，而不是另建“待确认”队列。
  if (!applicationHits.length && !trackReasons.length && !enterpriseHits.length && !supportHits.length) {
    return ineligible(assessment, evidence, "正文及附件未识别到申报或公司相关信号");
  }

  // 宽赛道项目可以展示，但不应与氢能电控、低空等核心赛道并排竞争；
  // 因此只作排序降分，而不再以公司资质或“可申报/待确认”分组。
  const coreIndustryHits = includesAny(fullText, coreIndustryTerms);
  if (!trackReasons.length) return ineligible(assessment, evidence, "未命中溯驭相关赛道");

  const area = regionScore(policy.region);
  const metadataCompleteness = [policy.title, policy.department, policy.url, policy.publishDate, policy.deadline].filter(Boolean).length;
  const negativePenalty = Math.min(30, negatives.length * 20);
  const broadProjectPenalty = coreIndustryHits.length ? 0 : 12;
  const missingEvidencePenalty = missingEvidence.length * 3;
  const applicantPenalty = assessment.role === "enterprise_applicant" ? 0 : 6;
  const directSupportPenalty = evidence.support.found ? 0 : 6;
  const entityScopeScore = applicationEntities.matches.length ? 12 : 0;
  const rawScore = Math.round(clamp(trackScore + enterpriseScore + supportScore + area.score + metadataCompleteness + entityScopeScore - negativePenalty - broadProjectPenalty - missingEvidencePenalty - applicantPenalty - directSupportPenalty, 0, 100));
  const invitationMissing = assessment.invitationRequirement.found && !assessment.invitationEvidence.found;

  if (assessment.isEnterpriseOpportunity) {
    const score = Math.min(rawScore, 60);
    return decisionFields("opportunity", {
      visible: false,
      filterReason: "属于企业可争取活动机会，不是可申报政策",
      matchScore: score,
      rankScore: Number((score * 0.85 + urgency(daysLeft) * 0.15).toFixed(2)),
      daysLeft,
      assessment,
      evidence,
      reasons: ["企业可作为受邀演讲、路演或参会对象争取机会", ...(invitationMissing ? ["邀请制尚无企业已获邀请的证据"] : []), "不作为企业可申报政策展示"],
    });
  }

  const matchScore = Math.max(0, rawScore - (invitationMissing ? 10 : 0));
  const matchReasons = [
    ...trackReasons,
    area.reason,
    evidence.support.found ? `支持方式包含${evidence.support.citations.map((citation) => citation.term).join("、")}` : "未识别到直接支持企业的方式",
    ...(missingEvidence.length ? [`原文尚未定位：${missingEvidence.join("、")}`] : []),
    ...(invitationMissing ? ["邀请制尚无企业已获邀请的证据"] : []),
    ...(registeredLocation.unknown.length ? [`公司注册地尚未核验：${registeredLocation.unknown.map((requirement) => requirement.requiredLocation).join("、")}`] : []),
    ...applicationEntities.matches.map((item) => `适用主体：${item.entityLabel}（${item.scopeLabel}）`),
    ...(!coreIndustryHits.length ? ["宽赛道项目，已降低匹配度排序"] : []),
  ];
  return decisionFields("matched", {
    visible: true,
    matchScore,
    rankScore: Number((matchScore * 0.85 + urgency(daysLeft) * 0.15).toFixed(2)),
    daysLeft,
    assessment,
    evidence,
    reasons: matchReasons,
  });
}

export function auditPolicies(policies, now = new Date(), companyProfile = null) {
  return policies.map((policy) => ({ ...policy, ...evaluatePolicy(policy, now, companyProfile) })).sort((a, b) => {
    if (a.visible !== b.visible) return a.visible ? -1 : 1;
    return (b.rankScore || 0) - (a.rankScore || 0) || (b.matchScore || 0) - (a.matchScore || 0) || (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999) || (b.publishDate || "").localeCompare(a.publishDate || "");
  });
}

export function filterAndRankPolicies(policies, now = new Date(), companyProfile = null) {
  return auditPolicies(policies, now, companyProfile).filter((policy) => policy.visible);
}
