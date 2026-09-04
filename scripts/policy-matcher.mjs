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
// 五项关键证据现在是“任意一项即充分”，因此“支持对象”不能再由
// 普通的“企业”二字触发，必须是可定位的对象性表述。
const beneficiaryTerms = ["支持对象", "申报对象", "申请对象", "适用对象", "资助对象", "扶持对象", "补助对象", "面向企业", "面向科技型中小企业", "申报单位范围"];
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
// These are publication/news formats, rather than an action a company can take.
// Keep this narrow and title-based: an actual application notice that merely
// refers to a forum or a result in its body must not be discarded by accident.
const newsOnlyTitleTerms = ["喜报", "再创新高", "全省第一", "全市第一", "全区第一", "全省唯一", "全市唯一", "调研", "走访", "座谈", "考察", "签约仪式", "新闻稿", "大显身手", "招聘会举行", "专场招聘会", "活动举行"];
const activityOnlyTitleTerms = ["合作", "对接", "洽谈", "签约", "招聘会", "论坛", "峰会", "大讲堂", "讲座", "沙龙", "推介会", "交流会", "发布会", "培训会", "展会", "大赛"];
const applicationTitleTerms = ["申报", "申请", "征集", "认定", "推荐", "评选", "遴选", "填报", "报送"];
// 政府官网也会发布新闻、案例和会议报道。来源是政府网站并不能把它们
// 变成政策文件；只有具备正式文件形态且不属于新闻/活动的记录，才进入
// 后续的项目匹配流程。
const governmentPolicyDocumentSuffix = /(?:通知|公告|通告|决定|命令|意见|办法|细则|规定|方案|规划|指南|条例|规则)$/;
const governmentPolicyDocumentInBrackets = /《[^》]{2,120}(?:通知|公告|通告|决定|命令|意见|办法|细则|规定|方案|规划|指南|条例|规则)》/;
const governmentActionTitle = /(?:申报|申请|征集|遴选|认定|评选|推荐|报送|填报)(?:工作)?(?:通知|公告)?$/;
const governmentFormalText = /(?:现将|印发|转发|特此通知|本(?:通知|办法|细则|规定|方案|规划|指南)|依据|按照|经[^。；]{0,30}同意)[^。；]{0,120}/;
const governmentNewsOrCaseTitle = /(?:新闻|报道|动态|简报|纪实|案例|故事|专访|调研|走访|座谈|考察|会议|活动|论坛|峰会|发布会|启动会|仪式|抢救|患者|争取.{0,20}时间)/;
const standingPolicyTitleTerms = ["实施意见", "若干措施", "管理办法", "实施办法", "行动方案", "发展规划"];
// “关于……的若干意见”是长期指导性文件，不是可直接跟进的具体事项。
// 即使正文包含资金或扶持表述，也不应占用项目申报页面的位置。
const guidanceOpinionTitlePattern = /关于[\s\S]{0,100}?的\s*若干意见/;
// 有些政策库将章节名（如“做强做大链主企业”）误作列表标题。仅匹配
// 标题会漏掉这类记录，因此也识别原文开头明确“印发/发布《…若干意见》”的主文件。
const guidanceOpinionDocumentPattern = /(?:印发|发布)\s*[《“"]?\s*关于[\s\S]{0,100}?的\s*若干意见[》”"]?(?:的)?(?:通知|文件)?/;
const supplierWorkflowTerms = ["公开征集", "征集", "在线填写", "填报", "报送", "提交"];
const supplierRoleTerms = ["产业供给能力", "供给能力", "供给方", "供给主体", "技术、产品、服务", "技术、产品和服务", "新技术、新产品", "创新解决方案", "参与应用场景建设"];
const coreIndustryTerms = ["氢能", "氢能源", "燃料电池", "氢燃料", "氢电耦合", "氢动力", "制氢", "储氢", "电控", "电力电子", "能量管理", "功率控制", "控制器", "碳化硅", "低空经济", "无人机", "无人飞行器", "飞控", "新型储能", "新型电力系统", "微电网", "源网荷储", "多能互补", "绿色氢"];

// 主体所在地只适用本区及市级以上项目。区名必须出现在标题、部门、摘要或正文中才会触发，
// 因此不会把未标注区属的全市通用通知误判为不适用。
const companyLocations = [
  { city: "苏州市", district: "吴江区", excluded: ["姑苏区", "虎丘区", "高新区", "苏州高新区", "吴中区", "相城区", "苏州工业园区", "工业园区", "常熟市", "张家港市", "昆山市", "太仓市"] },
  { city: "杭州市", district: "上城区", excluded: ["拱墅区", "西湖区", "滨江区", "萧山区", "余杭区", "富阳区", "临安区", "临平区", "钱塘区", "钱塘新区", "桐庐县", "淳安县", "建德市"] },
  { city: "连云港市", district: "赣榆区", excluded: ["海州区", "连云区", "东海县", "灌云县", "灌南县", "连云港经济技术开发区", "连云港开发区", "徐圩新区", "云台山景区"] },
];

const includesAny = (text, terms) => terms.filter((term) => text.includes(term.toLowerCase()));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function normalizePolicyText(value) {
  // 部分扫描 PDF 的 CJK 兼容字不会被 NFKC 完整合并，例如“⻅”。
  // 先规范化，随后补齐该类高频字，保证规则不因 PDF 字形而失效。
  return String(value || "").normalize("NFKC").replaceAll("⻅", "见");
}

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

// "政府政策文件"在本站指：政府机关（或依法受权机构）发布的正式
// 规范、指导或执行性文件。它至少要有正式文件名/申报征集文件形态或
// 可核验的正式行文；政府部门新闻、会议报道和服务案例均不属于此类。
function governmentPolicyDocumentAssessment(policy) {
  const rawTitle = String(policy.title || "").trim();
  const title = rawTitle.replace(/[。；，、\s]+$/, "");
  const fullText = `${rawTitle} ${policy.summary || ""} ${policy.content || ""}`;
  const isActivityTitle = includesAny(rawTitle.toLowerCase(), activityOnlyTitleTerms).length > 0;
  const isNewsOrCase = governmentNewsOrCaseTitle.test(rawTitle)
    || includesAny(rawTitle.toLowerCase(), [...newsOnlyTitleTerms, ...activityOnlyTitleTerms, ...completedActivityTerms]).length > 0;
  const hasFormalTitle = governmentPolicyDocumentSuffix.test(title) || governmentPolicyDocumentInBrackets.test(rawTitle);
  const hasActionableTitle = governmentActionTitle.test(title);
  const hasFormalText = governmentFormalText.test(fullText);
  const isPolicyDocument = !isNewsOrCase && (hasFormalTitle || hasActionableTitle || hasFormalText);

  return {
    isPolicyDocument,
    hasFormalTitle,
    hasActionableTitle,
    hasFormalText,
    isNewsOrCase,
    reason: isPolicyDocument
      ? "已识别正式政策文件形态"
      : isNewsOrCase
        ? isActivityTitle
          ? "属于合作或活动通知，不是政府政策文件"
          : "属于政府部门新闻、会议或活动动态、服务案例，不是政府政策文件"
        : "未识别正式政策文件形态，不作为政府政策文件入库",
  };
}

function policyEffectiveUntil(policy) {
  const matches = [];
  const pattern = /(?:本(?:办法|意见|政策|通知)|该(?:办法|意见|政策|通知))?[^。；]{0,80}?有效期至\s*(20\d{2}[年.\/-]\d{1,2}[月.\/-]\d{1,2}日?)/g;
  for (const [source, value] of textFields(policy)) {
    for (const match of value.matchAll(pattern)) {
      const date = firstDate(match[1]);
      if (!date) continue;
      matches.push({ date, source, term: match[1], index: match.index || 0, value });
    }
  }
  const latest = matches.sort((left, right) => left.date.localeCompare(right.date)).at(-1);
  return latest ? { date: latest.date, source: latest.source, term: latest.term, excerpt: excerpt(latest.value, latest.index, latest.term) } : null;
}

function deadlineInfo(policy) {
  if (parseDate(policy.deadline, policy.deadlineTime)) {
    return {
      date: policy.deadline,
      time: policy.deadlineTime || "",
      evidence: { found: true, citations: [{ source: "deadline", term: policy.deadline, excerpt: `${policy.deadline}${policy.deadlineTime ? ` ${policy.deadlineTime}` : ""}` }] },
    };
  }

  // Government notices frequently put the date only in a sentence such as
  // “请报送单位于2026年5月20日前在线填写”. Extract that action deadline
  // from the parsed original, rather than relying on a list-page field.
  const patterns = [
    /(?:截至|截止(?:时间)?(?:为|至|到)?|申报时间|受理时间|系统关闭)[^。；]{0,60}?(20\d{2}[年.\/-]\d{1,2}[月.\/-]\d{1,2}日?)/g,
    /(?:请(?:各?单位|申报单位|报送单位)?|(?:各?单位|申报单位|报送单位))?于\s*(20\d{2}[年.\/-]\d{1,2}[月.\/-]\d{1,2}日?)\s*前(?:扫描|通过|登录|在线|按|完成|报送|提交|填报|申报|将|。|，|,|$)/g,
  ];
  const matches = [];
  for (const [source, value] of textFields(policy)) {
    for (const pattern of patterns) {
      for (const match of value.matchAll(pattern)) {
        const date = firstDate(match[1]);
        if (!date) continue;
        const dateOffset = match[0].indexOf(match[1]);
        matches.push({
          date,
          time: "",
          evidence: { found: true, citations: [{ source, term: match[1], excerpt: excerpt(value, match.index + dateOffset, match[1]) }] },
        });
      }
    }
  }

  // A common official form is “企业于2026年4月25日至5月25日填报”。
  // The end of this range is the deadline even when the word “截止” is absent.
  const rangePattern = /(?:企业|单位|申报主体|申报单位|填报主体)?(?:于|自)?\s*(20\d{2})[年.\/-](\d{1,2})[月.\/-](\d{1,2})日?\s*(?:至|到|[-—~～])\s*(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日?[^。；]{0,48}?(?:填报|申报|申请|提交|上传|报送|办理|登录)/g;
  for (const [source, value] of textFields(policy)) {
    for (const match of value.matchAll(rangePattern)) {
      const date = `${match[4] || match[1]}-${match[5].padStart(2, "0")}-${match[6].padStart(2, "0")}`;
      const deadlineTerm = `${match[4] || match[1]}年${match[5]}月${match[6]}日`;
      const dateOffset = match[0].lastIndexOf(`${match[5]}月${match[6]}日`);
      matches.push({
        date,
        time: "",
        evidence: { found: true, citations: [{ source, term: deadlineTerm, excerpt: excerpt(value, match.index + dateOffset, `${match[5]}月${match[6]}日`) }] },
      });
    }
  }
  // If a document states multiple deadline-like dates, the final one normally
  // extends/corrects the earlier window. This matches the synchronizer logic.
  return matches.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).at(-1) || { date: "", time: "", evidence: { found: false, citations: [] } };
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
  const deadlineInfoValue = deadlineInfo(policy);
  const deadline = parseDate(deadlineInfoValue.date, deadlineInfoValue.time);
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
      deadline: deadlineInfoValue.evidence,
      deadlineDate: deadlineInfoValue.date,
      deadlineTime: deadlineInfoValue.time,
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

function inapplicableDistrict(policy) {
  const location = companyLocations.find((item) => item.city === policy.region);
  if (!location) return "";
  const text = `${policy.title || ""} ${policy.department || ""} ${policy.summary || ""} ${policy.content || ""}`;
  const excluded = location.excluded.find((district) => text.includes(district));
  return excluded ? `${location.city}${excluded}定向项目，不适用于${location.district}主体` : "";
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
  if (region === "苏州市" || region === "杭州市" || region === "连云港市") return { score: 15, reason: `${region}项目与公司布局地区匹配` };
  if (region === "江苏省" || region === "浙江省") return { score: 13, reason: `${region}政策覆盖公司相关主体` };
  if (region === "国家") return { score: 12, reason: "国家级项目可覆盖公司相关主体" };
  return { score: 0, reason: "适用地区待核实" };
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
  const needsReview = status === "needs_review";
  const matchLevel = status === "eligible" ? (matchScore >= 80 ? "高度匹配" : matchScore >= 65 ? "较高匹配" : "可能匹配") : status === "supplier_call" ? "可作为供给方" : status === "opportunity" ? "可争取机会" : status === "needs_review" ? "待查" : status === "discarded" ? "直接丢弃" : "不匹配";
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
      participationType: status === "supplier_call" ? "supplier" : null,
      supplierWorkflowEvidence: evidence.supplierWorkflow,
      supplierRoleEvidence: evidence.supplierRole,
    },
    companyEligibility: evidence.companyEligibility,
    governmentPolicyDocument: evidence.governmentPolicyDocument,
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

// A discarded record is retained only during this run's internal audit. It is
// intentionally excluded from both `policies` and `filteredPolicies`, so an
// expired notice, news item, event, or results announcement can never leak to
// the frontend's “全部” filter.
function discard(assessment, evidence, filterReason, reasons = [filterReason]) {
  return decisionFields("discarded", { visible: false, filterReason, assessment, evidence, reasons });
}

function retrievalState(policy) {
  const verification = policy.originalVerification;
  if (!verification) return { status: "not_checked", reason: "尚未读取官方原文" };
  if (verification.retrievalStatus) return { status: verification.retrievalStatus, reason: verification.reason || "" };
  // 兼容旧版同步数据：verified=true 表示正文曾成功读取；其余记录
  // 只能放入待查，不能据此判为不匹配。
  if (verification.verified === true) return { status: "parsed", reason: verification.reason || "已读取官方原文" };
  return { status: verification.checkedAt ? "failed" : "not_checked", reason: verification.reason || "尚未读取官方原文" };
}

function annualOrStaleApplicationReason(policy, title, now, retrieval) {
  const actionTitle = includesAny(title, applicationTitleTerms).length > 0;
  const annualYear = Number(String(policy.title || "").match(/(20\d{2})年度/)?.[1] || 0);
  const publishYear = Number(String(policy.publishDate || "").slice(0, 4));
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const standingPolicy = includesAny(title, standingPolicyTitleTerms).length > 0;

  // An annual allowance/recognition whose named year has passed is historical
  // unless it is a standing policy document such as a management measure.
  if (annualYear && annualYear < currentYear && !standingPolicy) return `申报年度${annualYear}已结束`;
  // A current-year call released in the previous year normally closes in the
  // first part of the target year. After March it must present an explicit
  // still-open deadline before it can remain in the action queue.
  if (actionTitle && annualYear === currentYear && publishYear && publishYear < currentYear && currentMonth >= 3) return "跨年度申报事项未提供仍有效的截止日期";
  // For a time-limited application notice, an unread original that is already
  // four months old is not enough evidence to claim the window remains open.
  if (actionTitle && retrieval.status !== "parsed" && publishYear && publishYear < currentYear) return "未读取原文且公告年度已过，无法证明仍可申报";
  return "";
}

function isGuidanceOpinionDocument(policy) {
  if (guidanceOpinionTitlePattern.test(normalizePolicyText(policy.title))) return true;
  const leadingOriginal = `${policy.summary || ""}\n${policy.content || ""}`.slice(0, 800);
  return guidanceOpinionDocumentPattern.test(normalizePolicyText(leadingOriginal));
}

export function evaluatePolicy(policy, now = new Date(), companyProfile = null) {
  const title = (policy.title || "").toLowerCase();
  const fullText = `${policy.title || ""} ${policy.summary || ""} ${policy.content || ""}`.toLowerCase();
  const assessment = activityAssessment(policy, now);
  const companyEligibility = companyEligibilityAssessment(fullText, now, companyProfile);
  const deadline = parseDate(assessment.timing.deadlineDate, assessment.timing.deadlineTime);
  const daysLeft = assessment.timing.daysLeft;
  const evidence = {
    governmentPolicyDocument: governmentPolicyDocumentAssessment(policy),
    beneficiary: findEvidence(policy, beneficiaryTerms),
    applicant: assessment.applicant,
    conditions: findEvidence(policy, eligibilityConditionTerms),
    support: findEvidence(policy, directSupportTerms),
    benefits: benefitEvidence(policy),
    deadline: assessment.timing.deadline,
    invitation: assessment.invitationEvidence,
    supplierWorkflow: findEvidence(policy, supplierWorkflowTerms),
    supplierRole: findEvidence(policy, supplierRoleTerms),
    companyEligibility,
  };
  const requiredEvidence = [
    ["支持对象", evidence.beneficiary],
    ["申报主体", evidence.applicant],
    ["申报条件", evidence.conditions],
    ["支持方式", evidence.support],
    ["截止日期", evidence.deadline],
  ];
  const missingEvidence = requiredEvidence.filter(([, item]) => !item.found).map(([name]) => name);
  const matchedEvidence = requiredEvidence.filter(([, item]) => item.found).map(([name]) => name);
  evidence.completeness = {
    complete: missingEvidence.length === 0,
    sufficient: matchedEvidence.length >= 1,
    matched: matchedEvidence,
    matchedCount: matchedEvidence.length,
    requiredCount: 1,
    required: requiredEvidence.map(([name]) => name),
    missing: missingEvidence,
  };

  if (!evidence.governmentPolicyDocument.isPolicyDocument) {
    return discard(assessment, evidence, evidence.governmentPolicyDocument.reason);
  }

  const effectiveUntil = policyEffectiveUntil(policy);
  if (effectiveUntil && parseDate(effectiveUntil.date) < now) {
    return discard(assessment, evidence, `政策有效期已于${effectiveUntil.date}届满`);
  }
  if (deadline && deadline.getTime() < now.getTime()) return discard(assessment, evidence, "已过申报截止时间");
  if (assessment.isEnterpriseOpportunity && assessment.timing.activityStatus === "expired") return discard(assessment, evidence, "活动日期已结束");
  if (includesAny(title, resultTerms).length) return discard(assessment, evidence, "属于申报结果或名单公示");
  if (isGuidanceOpinionDocument(policy)) return discard(assessment, evidence, "属于长期指导性“若干意见”，不是具体申报事项");
  if (includesAny(title, completedActivityTerms).length || includesAny(title, newsOnlyTitleTerms).length) return discard(assessment, evidence, "属于新闻、调研或已举办活动，不是企业可行动事项");
  if (includesAny(title, activityOnlyTitleTerms).length && !includesAny(title, applicationTitleTerms).length) return discard(assessment, evidence, "属于合作或活动通知，不是企业可申报事项");
  if (assessment.isOrganizerProject || assessment.isEnterpriseOpportunity) return discard(assessment, evidence, "属于活动或会务事项，不是企业可行动事项");
  const retrieval = retrievalState(policy);
  const annualOrStaleReason = annualOrStaleApplicationReason(policy, title, now, retrieval);
  if (annualOrStaleReason) return discard(assessment, evidence, annualOrStaleReason);
  if (policy.region?.endsWith("市") && !["苏州市", "杭州市", "连云港市"].includes(policy.region)) return ineligible(assessment, evidence, "地区不适用");
  const districtReason = inapplicableDistrict(policy);
  if (districtReason) return ineligible(assessment, evidence, districtReason);
  const actionableStandingPolicy = includesAny(title, standingPolicyTitleTerms).length
    && /(?:在线申报|提出申请|提交.*申报材料|申报材料|认定程序)/.test(fullText)
    && evidence.support.found;
  if (includesAny(title, portalTerms).length && !title.includes("申报") && !actionableStandingPolicy) return ineligible(assessment, evidence, "属于政策依据或服务入口");
  if (includesAny(fullText, excludedIndustryTerms).length) return ineligible(assessment, evidence, "所属行业与溯驭核心业务无关");
  if (includesAny(title, publicSectorApplicantTerms).length) return ineligible(assessment, evidence, "申报主体为地方政府或区县试点，不是企业申报事项");

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
  // 不再因缺少“申报”字样直接淘汰。对赛道、企业主体或支持方向已有信号的
  // 通知保留为待人工复核，避免详情页/附件尚未完整解析时漏报。
  if (!applicationHits.length && !trackReasons.length && !enterpriseHits.length && !supportHits.length) {
    return ineligible(assessment, evidence, "正文及附件未识别到申报或公司相关信号");
  }

  // “科技、人才、企业”属于泛词，不能把通信、医疗等其他赛道的项目
  // 误推给溯驭。只有命中核心产业方向，或命中公司已核验资质，才保留。
  const coreIndustryHits = includesAny(fullText, coreIndustryTerms);
  if (!coreIndustryHits.length && !companyEligibility.met.length && !actionableStandingPolicy) {
    return ineligible(assessment, evidence, "未命中溯驭核心赛道或已核验企业资质");
  }

  const area = regionScore(policy.region);
  const metadataCompleteness = [policy.title, policy.department, policy.url, policy.publishDate, policy.deadline].filter(Boolean).length;
  const negativePenalty = Math.min(30, negatives.length * 20);
  const rawScore = Math.round(clamp(trackScore + enterpriseScore + supportScore + area.score + metadataCompleteness - negativePenalty, 0, 100));
  const invitationMissing = assessment.invitationRequirement.found && !assessment.invitationEvidence.found;
  // 原文是否已经成功读取与“是否可申报”是两个维度。未读取、
  // 读取失败或暂不支持的文档统一留在待查队列，不再被判为不匹配。
  if (retrieval.status !== "parsed") {
    const statusLabel = retrieval.status === "unsupported" ? "文档格式待解析" : retrieval.status === "failed" ? "官方原文读取失败" : "官方原文尚未读取";
    const matchScore = Math.min(rawScore, 64);
    return decisionFields("needs_review", {
      visible: true,
      filterReason: retrieval.reason || statusLabel,
      matchScore,
      rankScore: Number((matchScore * 0.85 + urgency(daysLeft) * 0.15).toFixed(2)),
      daysLeft,
      assessment,
      evidence,
      reasons: [statusLabel, ...(retrieval.reason && retrieval.reason !== statusLabel ? [retrieval.reason] : []), ...trackReasons, area.reason],
    });
  }

  // “征集应用场景需求及产业供给能力”不等同于资金项目，但若企业可
  // 以技术、产品或解决方案供给方身份提交材料，仍是值得跟进的正式事项。
  // 需求侧征集没有供给方角色证据时不会走这里，仍按一般规则进入待查。
  // “新技术、新产品”常见于普通认定办法和扶持政策，不能单独说明
  // 企业是供给方。只有明确写出供给能力/供给方，或把新产品与创新
  // 解决方案、应用场景建设关联起来，才标为供给方征集。
  const explicitSupplierRole = /(?:产业供给能力|供给能力|供给方|供给主体|参与应用场景建设|新技术、新产品(?:和|及)?创新解决方案)/.test(fullText);
  const supplierCall = evidence.supplierWorkflow.found && explicitSupplierRole && enterpriseHits.length > 0;
  if (supplierCall) {
    const score = Math.max(65, rawScore);
    return decisionFields("supplier_call", {
      visible: true,
      matchScore: score,
      rankScore: Number((score * 0.85 + urgency(daysLeft) * 0.15).toFixed(2)),
      daysLeft,
      assessment,
      evidence,
      reasons: ["企业可作为技术、产品或解决方案供给方报送", ...trackReasons, area.reason, "非资金申报，按供给方征集跟进"],
    });
  }

  // A verified mismatch or an unknown company fact never removes a policy.
  // It only prevents automatic eligibility, because the user may later supply
  // additional evidence or the profile may refresh with a new official source.
  const companyFactNeedsReview = companyEligibility.notMet.length > 0 || companyEligibility.unknown.length > 0;
  const eligible = evidence.completeness.sufficient && !invitationMissing && !companyFactNeedsReview;
  const status = eligible ? "eligible" : "needs_review";
  // 信息不完整时，分数不得进入“高匹配”区间，避免把关键词命中误当成可申报结论。
  const matchScore = eligible ? rawScore : Math.min(rawScore, 64);
  const reviewReasons = [
    ...trackReasons,
    area.reason,
    evidence.support.found ? `支持方式包含${evidence.support.citations.map((citation) => citation.term).join("、")}` : "未识别到直接支持企业的方式",
    ...(missingEvidence.length ? [`证据待补：${missingEvidence.join("、")}`] : []),
    ...(invitationMissing ? ["邀请制尚无企业已获邀请的证据"] : []),
    ...companyEligibility.notMet.map((requirement) => `公司档案显示尚未满足：${requirement.label}，需人工确认`),
    ...companyEligibility.unknown.map((requirement) => `公司档案未能核验：${requirement.label}`),
  ];
  return decisionFields(status, {
    visible: true,
    matchScore,
    rankScore: Number((matchScore * 0.85 + urgency(daysLeft) * 0.15).toFixed(2)),
    daysLeft,
    assessment,
    evidence,
    reasons: reviewReasons,
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
