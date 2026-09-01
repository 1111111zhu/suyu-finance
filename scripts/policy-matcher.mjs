const trackGroups = [
  { name: "氢能与燃料电池", weight: 35, terms: ["氢能", "氢能源", "燃料电池", "氢燃料", "氢电耦合", "氢动力", "氢储能", "氢发电", "制氢", "储氢"] },
  { name: "新能源电控与电力电子", weight: 28, terms: ["电控", "电力电子", "能量管理", "功率控制", "控制器", "碳化硅", "sic", "电机控制", "系统集成"] },
  { name: "低空经济与无人系统", weight: 28, terms: ["低空经济", "无人机", "无人飞行器", "航空器", "飞控", "低空物流", "智能巡检", "长航时"] },
  { name: "新能源与零碳应用", weight: 18, terms: ["新能源", "新型储能", "新型电力系统", "微电网", "源网荷储", "多能互补", "分布式能源", "绿色低碳", "零碳", "节能降碳"] },
  { name: "智能制造与关键技术", weight: 16, terms: ["智能制造", "工业软件", "数字经济", "技术改造", "关键核心技术", "首台套", "首版次", "中试", "成果转化", "产业化", "揭榜挂帅"] },
  { name: "科技企业培育", weight: 15, terms: ["科技型中小企业", "高新技术企业", "专精特新", "独角兽", "孵化器", "研发中心", "技术中心", "重点实验室", "研发投入", "科技创新", "未来产业"] },
  { name: "创新人才与产学研", weight: 12, terms: ["创新团队", "创新项目", "创新场景", "技术创新", "人才", "领军人才", "创业人才", "留学人员", "产学研", "知识产权", "专利", "创新创业"] },
];

const applicationTerms = ["申报", "征集", "遴选", "评选", "推荐", "认定", "培育库", "补助", "补贴", "资助", "奖励", "揭榜挂帅", "项目计划"];
const enterpriseTerms = ["企业", "科技型中小企业", "高新技术企业", "中小微", "初创企业", "创新型企业", "研发机构", "创新团队"];
const supportTerms = ["研发", "科技计划", "成果转化", "技术改造", "资金", "补助", "补贴", "贴息", "资助", "人才", "融资", "知识产权", "培育"];
const negativeTerms = ["农业种植", "畜牧", "渔业", "房地产", "商品房", "物业管理", "餐饮", "旅游景区", "文艺演出", "体育赛事", "医疗机构", "药品注册", "临床试验", "教师", "学校招生", "养老", "人防工程", "政府采购中标", "结果公示", "会议通知", "工作总结"];
const portalTerms = ["服务网", "服务专区", "申报平台", "管理办法", "实施意见", "行动方案", "工作方案"];

const includesAny = (text, terms) => terms.filter((term) => text.includes(term.toLowerCase()));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function parseDate(value, time = "") {
  if (!value || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${time || "23:59"}:59+08:00`);
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

export function evaluatePolicy(policy, now = new Date()) {
  const title = (policy.title || "").toLowerCase();
  const fullText = `${policy.title || ""} ${policy.summary || ""} ${policy.content || ""}`.toLowerCase();
  const deadline = parseDate(policy.deadline, policy.deadlineTime);
  const daysLeft = deadline ? Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000) : null;
  if (deadline && deadline.getTime() < now.getTime()) return { visible: false, filterReason: "已过申报截止时间" };
  if (policy.region?.endsWith("市") && !["苏州市", "杭州市", "连云港市"].includes(policy.region)) return { visible: false, filterReason: "地区不适用" };
  if (!includesAny(title, applicationTerms).length) return { visible: false, filterReason: "不是明确的可申报项目" };
  if (includesAny(title, portalTerms).length && !title.includes("申报")) return { visible: false, filterReason: "属于政策依据或服务入口" };
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
  if (!trackReasons.length && negatives.length) return { visible: false, filterReason: "与公司赛道明显无关" };

  const enterpriseHits = includesAny(fullText, enterpriseTerms);
  const enterpriseScore = enterpriseHits.some((term) => ["科技型中小企业", "高新技术企业"].includes(term)) ? 20 : enterpriseHits.length ? 15 : 4;
  const supportHits = includesAny(fullText, supportTerms);
  const supportScore = supportHits.some((term) => ["研发", "科技计划", "成果转化", "技术改造"].includes(term)) ? 15 : supportHits.length ? 10 : 4;
  const area = regionScore(policy.region);
  const completeness = [policy.title, policy.department, policy.url, policy.publishDate, policy.deadline].filter(Boolean).length;
  const negativePenalty = Math.min(30, negatives.length * 20);
  const matchScore = Math.round(clamp(trackScore + enterpriseScore + supportScore + area.score + completeness - negativePenalty, 0, 100));
  if (matchScore < 45) return { visible: false, filterReason: "匹配度低于展示阈值" };

  const urgencyScore = urgency(daysLeft);
  const rankScore = Number((matchScore * 0.85 + urgencyScore * 0.15).toFixed(2));
  const reasons = [...trackReasons, area.reason, supportHits.length ? `支持方向包含${supportHits.slice(0, 2).join("、")}` : "属于通用科技企业项目"].slice(0, 4);
  return { visible: true, matchScore, rankScore, daysLeft, matchLevel: matchScore >= 80 ? "高度匹配" : matchScore >= 65 ? "较高匹配" : "可能匹配", matchReasons: reasons };
}

export function filterAndRankPolicies(policies, now = new Date()) {
  return policies.map((policy) => ({ ...policy, ...evaluatePolicy(policy, now) })).filter((policy) => policy.visible).sort((a, b) => b.rankScore - a.rankScore || b.matchScore - a.matchScore || (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999) || (b.publishDate || "").localeCompare(a.publishDate || ""));
}
