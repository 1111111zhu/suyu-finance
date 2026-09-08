// Presentation only: never changes source data or eligibility decisions.
// User's four browser annotations apply to this notice/version, not every
// needs_review assessment. A changed document must receive a fresh review.
const annotatedNotice = {
  versions: [
    ['jiangsu-scitech-xml-613fbf6', '43014e57d50588fbcf6a1a3047ba421fa32d9e33e20aeca4a8235b430d200983'],
    ['most-notices-483b0995', 'dae8686d684320b75fd2ba030d0554b3a0cf8ec6ab73218c0e998f3ab72cebc1'],
  ],
  companies: ['suzhou', 'lianyungang'],
  hiddenNotes: [
    '该主体注册／纳税属地及本项目全部申报条件待核实',
    '本通知包含多个方向，尚须逐项核查、拆分申报事项',
  ],
};
function hasNoticeAnnotation(policy) {
  return annotatedNotice.versions.some(([id, contentHash]) => (policy.id === id || policy.aliases?.includes(id)) && policy.contentHash === contentHash)
    && (!policy.collection || policy.collection === 'policies');
}

export function qualificationNotes(policy) {
  const notes = [...new Set([
    ...(policy.verificationIssues || []),
    ...(policy.companyAssessments || []).flatMap(c => c.missing || []),
    ...(policy.subprojectReviewRequired ? ['本通知包含多个方向，尚须逐项核查、拆分申报事项'] : []),
  ])];
  return hasNoticeAnnotation(policy) ? notes.filter(note => !annotatedNotice.hiddenNotes.includes(note)) : notes;
}

export function rewardItems(policy) {
  const title = policy.title || "";
  const text = (policy.content || "").replace(/\s+/g, "");
  const items = [];
  if (/进口贴息/.test(title) && /给予贴息方式支持/.test(text)) {
    items.push("进口产品及技术贴息支持");
    const cap = text.match(/按照贴息本金乘以贴息率计算，每户企业不超过([\d.]+万元)人民币/);
    if (cap) items.push(`按贴息本金 × 贴息率计算，每户最高 ${cap[1]}（须符合指南条件）`);
  }
  if (/灯塔工厂/.test(title)) {
    const diagnosis = text.match(/给予最高([\d.]+万元)灯塔工厂诊断费用补贴/);
    const award = text.match(/入库企业成功入选全球灯塔工厂后，将获得最高([\d.]+万元)奖励支持/);
    if (diagnosis) items.push(`入库培育：诊断费用补贴最高 ${diagnosis[1]}`);
    if (award) items.push(`成功入选全球灯塔工厂后：奖励最高 ${award[1]}`);
    if (/全流程指导培育/.test(text)) items.push("优质服务机构全流程指导培育");
  }
  if (items.length) return items;
  const recognition = [
    [/企业技术中心/, "通过认定：省级企业技术中心资格"],
    [/工业产品质量控制和技术评价实验室/, "通过认定：工业产品质量控制和技术评价实验室资格"],
    [/省级工业互联网平台/, "通过遴选：省级工业互联网平台名单"],
    [/专精特新中小企业/, "通过认定或复核：省级专精特新中小企业称号"],
    [/技术先进型服务企业/, "通过认定：技术先进型服务企业资格"],
    [/高新技术企业/, "通过认定：高新技术企业资格"],
    [/人工智能.*典型应用场景/, "通过遴选：人工智能典型应用场景入选"],
    [/江苏精品/, "通过评审：“江苏精品”认定"],
    [/能效、碳效领跑者/, "通过评选：能效、碳效领跑者企业入选"],
  ].find(([pattern]) => pattern.test(title));
  if (recognition) return [recognition[1], "认定不等于现金奖励；兑现事项与金额须单独核实"];
  if (/中央财政资金预算|中央财政专项资金预算/.test(text)) return ["立项后按专项指南及核定预算获得科研资金支持", "具体额度、配套比例以专项指南为准，非申报即拨款"];
  return ["金额及比例尚未完成结构化核验，请查阅原文与专项指南"];
}

export function cardReasons(reasons) {
  return reasons.filter(reason => !/该主体注册\s*[／/]\s*纳税属地及本项目全部申报条件待核实/.test(reason));
}

export function companyFitItems(policy) {
  return [["suzhou", "苏州溯驭"], ["hangzhou", "杭州溯驭"], ["lianyungang", "连云港溯驭"]].map(([id, name]) => {
    const assessment = policy.companyAssessments?.find(item => item.companyId === id);
    if (policy.collection === 'historyPolicies' || policy.disposition === 'expired' || assessment?.status === 'expired') return {id,name,status:'pending',label:'本批已截止'};
    if (policy.collection && policy.collection !== 'policies') return {id,name,status:'pending',label:'非当前申报；查看核查依据'};
    if (assessment?.status === "eligible") return { id, name, status: "eligible", label: "可申报（已核实）" };
    if (assessment?.status === "ineligible") return { id, name, status: "ineligible", label: "不适配" };
    if (assessment?.status === 'needs_review' && hasNoticeAnnotation(policy) && annotatedNotice.companies.includes(id)) {
      return {id, name, status: 'pending', label: '适配', description: '适配为页面展示标签，申报资格尚未核实'};
    }
    return { id, name, status: "pending", label: "资格待核实" };
  });
}
