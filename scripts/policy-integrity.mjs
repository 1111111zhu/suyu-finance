// Discovery is broad; certification remains evidence-based.
export const RULES_VERSION = '1.5';
export const PARSER_VERSION = 3;
export const FUNDING_SIGNAL = /资金|经费|补助|补贴|奖励|奖补|贴息|资助|扶持|创新券|服务券|数改券|算力券|研发费用|财政/;
export const DISCOVERY_SIGNAL = /申报|申请|申领|领用|领取|兑付|兑现|预评审|认定|复核|遴选|揭榜|入库|推荐|征集|科技|研发|创新|人才|中小企业|专精特新|高新技术|质量|标准|首台套|首版次|资金|经费|补助|补贴|奖励|奖补|扶持|贴息|资助|担保费|保费|券/;
export const fundingDirections = ['企业研发费用投入补助','高成长企业研发后补助','科技成果转化','关键核心技术与重点研发','国家项目地方配套','省项目区县配套','技术转移产学研','科技创新券','仪器及研发资源共享','中试概念验证','企业研发机构兑现','技改设备投资奖补','设备更新项目支持','数改券','企业服务券','智改数转网联','工业互联网智能工厂','算力补贴','首台套奖励','首版次首批次奖励','首台套及创新产品保险','新产品应用示范','氢能产业专项','低空经济专项','节能绿色制造','专精特新梯度奖励','高企认定奖励','升规稳增长','中小微贷款贴息','设备更新贷款贴息','地方科技金融费用补助','知识产权质押费用','专利转化实施','知识产权保险维权','标准质量品牌','领军人才创新团队','博士后及研发人才','技能培训学徒制','企业用工补贴','进口贴息出口信保','外贸认证市场开拓','场地落地资助','既有项目后补助兑现'];
export function supportKinds(p) {
  const text = `${p.title || ''} ${p.content || ''} ${p.summary || ''}`, kinds = [];
  if (/补助|补贴|奖励|奖补|资助|经费|财政.*资金/.test(text)) kinds.push('grant');
  if (/创新券|服务券|数改券|算力券/.test(text)) kinds.push('voucher');
  if (/贴息|担保费|保险费|保费/.test(text)) kinds.push('finance');
  if (/认定|遴选|评选|入库|培育/.test(text)) kinds.push('recognition');
  return kinds.length ? kinds : ['unknown'];
}
export function inferPolicyRegion(title = '', source = {}) {
  const explicit = String(title).match(/杭州市|苏州市|连云港市|江苏省|浙江省/)?.[0];
  if (explicit) return explicit;
  if (/吴江/.test(`${title} ${source.name || ''}`)) return '苏州市';
  return /年度/.test(source.region || '') ? '' : source.region || '';
}
export function needsDocumentReview(p, now = new Date()) {
  const v = p.originalVerification || {}, age = +now - Date.parse(v.checkedAt || '');
  return v.parserVersion !== PARSER_VERSION || v.retrievalStatus !== 'parsed' || v.bindingStatus !== 'matched' || !Number.isFinite(age) || age >= 86400000;
}
export function reviewQueue(policies, now = new Date()) {
  // Least-recently attempted first: budgets must not starve old or low-ranked leads.
  return policies.filter(p => needsDocumentReview(p, now)).sort((a,b) => (Date.parse(a.lastAttemptAt || '') || 0) - (Date.parse(b.lastAttemptAt || '') || 0) || Number(FUNDING_SIGNAL.test(b.title || '')) - Number(FUNDING_SIGNAL.test(a.title || '')) || (b.publishDate || '').localeCompare(a.publishDate || '') || a.id.localeCompare(b.id));
}
export function originalBinding(title, content) {
  const key = s => String(s || '').normalize('NFKC').replace(/^[【\[].*?[】\]]/, '').replace(/[^\p{L}\p{N}]/gu, '');
  const t = key(title);
  return t.length >= 8 && key(content).includes(t) ? 'matched' : 'unknown';
}
export function guideNeedsReview(p) {
  if (p.subprojectsReviewed?.contentHash === p.contentHash && p.subprojectsReviewed?.complete === true && p.subprojectsReviewed?.evidence) return false;
  return /科创指数惠|制造强省|先进制造业基地专项|市级科技计划/.test(p.title || '') || (String(p.content || '').match(/申报指南/g) || []).length > 2;
}
export const requiredSourceGroups = [
  ['国家财政资金',['mof-finance']], ['国家科技',['most-notices']], ['国家工信',['miit-scitech']], ['国家发改',['ndrc-notices']],
  ['江苏科技',['jiangsu-scitech-xml']], ['江苏工信',['jiangsu-miit-xml']], ['江苏发改',['jiangsu-ndrc-xml']], ['江苏知识产权',['jiangsu-ip-xml']],
  ['浙江科技',['zhejiang-scitech']], ['浙江经信',['zhejiang-miit']], ['苏州科技',['suzhou-scitech']], ['苏州工信',['suzhou-miit-notices']], ['苏州商务',['suzhou-commerce']], ['苏州市场监管',['suzhou-market']],
  ['杭州科技',['hangzhou-tech-api']], ['杭州经信',['hangzhou-miit']], ['杭州知识产权',['hangzhou-market']], ['杭州财政',['hangzhou-finance']], ['杭州人社人才',['hangzhou-hr']], ['杭州商务',['hangzhou-commerce']],
  ['连云港科技',['lianyungang-scitech']], ['连云港工信',['lianyungang-miit']], ['连云港财政',['lianyungang-finance']], ['连云港人社人才',['lianyungang-hr']], ['连云港商务',['lianyungang-commerce']],
  ['吴江科技',['wujiang-api']], ['吴江工信财政人才',['wujiang-local-funding']], ['杭州实际区县及园区',['hangzhou-district-funding']], ['连云港实际区县及园区',['lianyungang-district-funding']],
];
export function coverageMatrix(sources, now = new Date()) {
  return requiredSourceGroups.map(([name, ids]) => {
    const found = sources.filter(s => ids.includes(s.id));
    const checked = found.some(s => s.ok && s.count > 0 && !s.incomplete && s.paginationExhausted === true && s.checkedAt && +now - Date.parse(s.checkedAt) < 8 * 86400000);
    return { name, sourceIds: ids, status: checked ? 'checked' : found.length ? 'partial' : 'missing', reason: checked ? '所列栏目分页核验完成，仍非全部政策保证' : found.length ? '读取、分页、水位或时效尚未完整核验' : '尚未配置专门采集／复核来源' };
  });
}
