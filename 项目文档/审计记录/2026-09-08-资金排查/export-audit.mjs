// Read-only audit of application inputs. Outputs are isolated from the website feed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const out = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(out, '../../..');
const inputs = ['public/policies.json', '.policy-cache/audit.json', '.policy-cache/candidates.json', 'public/company-profile.json', '自动化脚本/project-assessment.mjs', '自动化脚本/sync-policies.mjs', '自动化脚本/policy-feed.mjs', '规则.md'];
const bytes = Object.fromEntries(inputs.map(name => [name, fs.readFileSync(path.join(root, name))]));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const feed = JSON.parse(bytes['public/policies.json']);
const audit = JSON.parse(bytes['.policy-cache/audit.json']);
const money = /资金|补助|补贴|奖励|奖补|贴息|创新券|服务券|数改券|研发费用/;
const count = (records, key) => records.reduce((result, item) => {
  const value = key(item); result[value] = (result[value] || 0) + 1; return result;
}, {});
const records = audit.policies.map(p => {
  const flags = [];
  const kind = p.projectAuthenticity?.kind || 'unknown';
  const retrieval = p.originalVerification?.retrievalStatus || 'unknown';
  if (money.test(p.title) && kind === 'lead') flags.push('资金标题线索未确认项目性质，必须核查，非可申报结论');
  if (/年度/.test(p.region || '')) flags.push('疑似行政区域解析错误');
  if (p.publishDate && p.deadline && p.deadline < p.publishDate) flags.push('截止早于发布日期：核对引用日期、兑现年度、补充通知');
  if (p.windowReviewRequired) flags.push('历史标题或日期触发窗口复核');
  if (retrieval !== 'parsed') flags.push('原文解析状态未完成');
  return {
    id: p.id, title: p.title, url: p.url, region: p.region, sourceId: p.sourceId,
    sourceName: p.sourceName, publishDate: p.publishDate, parsedDeadline: p.deadline,
    deadlineTime: p.deadlineTime, windowStatus: p.timing?.applicationWindowStatus,
    documentKind: kind, retrievalStatus: retrieval, visible: !!p.visible,
    decision: p.decision, filterReason: p.filterReason || '',
    companyAssessments: (p.companyAssessments || []).map(c => ({companyId:c.companyId,status:c.status,reasons:c.reasons,missing:c.missing})),
    fundingTitleSignal: money.test(p.title), diagnosticFlags: flags,
  };
});
const funding = records.filter(p => p.fundingTitleSignal);
const snapshot = {
  generatedAt: new Date().toISOString(), auditDate: '2026-09-08', timezone: 'Asia/Shanghai',
  feedUpdatedAt: feed.updatedAt, auditGeneratedAt: audit.generatedAt,
  scope: '现有候选全量索引，不是已核实可申报项目清单；没有重新抓取或修改生产数据',
  inputHashes: Object.fromEntries(inputs.map(name => [name, sha(bytes[name])])),
  candidateCount: records.length, publicCount: feed.policies.length,
  decisionCounts: count(records, p => p.decision), coverage: feed.coverage,
  fundingTitlePattern: money.source, fundingTitleCount: funding.length,
  fundingBreakdown: count(funding, p => `${p.documentKind}/${p.retrievalStatus}/${p.visible}`),
  sourceStatuses: feed.sources,
};
const safe = value => String(value ?? '').replace(/\|/g, '／').replace(/[\r\n]+/g, ' ');
const lines = [
  '# 资金标题候选全量索引（本地快照）', '',
  `数据时点：${feed.updatedAt}；候选 ${records.length} 条；本索引 ${funding.length} 条。`, '',
  '本表是机器辅助排查，不是可申报清单。包含历史、异地、公示、非企业项目及待查线索；不得批量导入公开可申报列表。标题无资金词的资助计划未纳入此子集，但保存在 candidate-index.json。', '',
  '截止日列为程序现有值，可能错误，不能作为新的申报依据。特别核对 deadline 早于发布日期、旧业绩年度、推荐部门截止和实际企业截止。', '',
  '| 序号 | 本地 ID | 标题 | 地区 | 发布／程序截止 | 类型／原文状态 | 当前结论／可见 | 原因及待查标记 | 原文入口（未保证正确关联） |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];
funding.forEach((p, i) => lines.push(`| ${i + 1} | ${safe(p.id)} | ${safe(p.title)} | ${safe(p.region)} | ${safe(p.publishDate)}／${safe(p.parsedDeadline)} | ${p.documentKind}／${p.retrievalStatus} | ${p.decision}／${p.visible ? '可见' : '不公开'} | ${safe([p.filterReason, ...p.diagnosticFlags].filter(Boolean).join('；'))} | ${safe(p.url)} |`));
for (const name of inputs) {
  if (sha(fs.readFileSync(path.join(root, name))) !== sha(bytes[name])) throw new Error(`输入在审计中发生变化，请重新导出：${name}`);
}
for (const [name, value] of [['snapshot.json', JSON.stringify(snapshot, null, 2) + '\n'], ['candidate-index.json', JSON.stringify({scope:snapshot.scope,generatedAt:snapshot.generatedAt,records}, null, 2) + '\n'], ['资金标题候选全量索引.md', lines.join('\n') + '\n']]) {
  fs.writeFileSync(path.join(out, name), value, {flag:'wx'});
}
console.log(JSON.stringify({candidateCount:records.length,fundingTitleCount:funding.length,publicCount:feed.policies.length,inputsUnchanged:true,outputDirectory:out}, null, 2));
