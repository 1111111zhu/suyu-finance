import { auditPolicies } from "./policy-matcher.mjs";
import { cleanPolicyText } from "./policy-time.mjs";
import { RULES_VERSION, coverageMatrix, fundingDirections, needsDocumentReview } from "./policy-integrity.mjs";

const decisionStatuses = ["eligible", "upcoming", "needs_review", "ineligible", "discarded"];
export const feedCollections = ["policies", "reviewQueue", "historyPolicies", "excludedRecords"];
export function buildPolicyFeed(candidates, sources = [], companyProfile = null, now = new Date()) {
  const ids = candidates.map(p => p.id);
  if (new Set(ids).size !== ids.length || ids.some(id => !id)) throw new Error("候选 ID 重复或缺失，禁止静默覆盖");
  const audit = auditPolicies(candidates, now, companyProfile);
  const collections = Object.fromEntries(feedCollections.map(k => [k, []]));
  const ledger = [], groups = new Map();
  for (const policy of audit) {
    const confirmed = policy.projectAuthenticity?.status === "confirmed";
    const kind = policy.projectAuthenticity?.kind;
    const expired = policy.timing?.applicationWindowStatus === "expired";
    const collection = confirmed && expired ? "historyPolicies"
      : confirmed && policy.visible ? "policies"
      : ["excluded", "supplement"].includes(kind) || policy.decision === "ineligible" ? "excludedRecords" : "reviewQueue";
    // Never merge different directions sharing a PDF, or different batches.
    const key = collection + "|" + (policy.projectKey || [policy.region, cleanPolicyText(policy.title), policy.batch || "", policy.applicationItemId || ""].join("|")) + "|" + JSON.stringify([policy.contentHash, policy.timing, policy.companyAssessments]);
    const group = groups.get(key) || { collection, records: [] };
    group.records.push(policy); groups.set(key, group);
  }
  for (const {collection, records} of groups.values()) {
    records.sort((a,b) => Number(b.originalVerification?.retrievalStatus === "parsed") - Number(a.originalVerification?.retrievalStatus === "parsed") || a.id.localeCompare(b.id));
    const p = records[0];
    const related = audit.filter(c => c.id !== p.id && (c.parentProjectId === p.id || c.referencedUrls?.includes(p.url)));
    const row = {...p, collection, aliases: [...new Set([...records.slice(1).map(c => c.id), ...records.flatMap(c => c.aliases || [])])].filter(id=>id!==p.id), relatedDocuments: [...records.slice(1), ...related].map(c => ({id:c.id,title:c.title,url:c.url}))};
    collections[collection].push(row);
    for (const c of records) ledger.push({id:c.id,targetId:p.id,collection});
  }
  const matrix = coverageMatrix(sources, now);
  const pendingDocuments = audit.filter(p => needsDocumentReview(p, now)).length;
  const pendingQualifications = audit.filter(p => p.projectAuthenticity?.status === "confirmed" && p.decision === "needs_review").length;
  const pendingSubprojects = audit.filter(p => p.subprojectReviewRequired).length;
  const companyGaps = ["suzhou","hangzhou","lianyungang"].filter(id => !companyProfile?.companies?.[id]?.version);
  const decisionCounts = Object.fromEntries(decisionStatuses.map(s => [s, audit.filter(p => p.decision === s).length]));
  return {
    updatedAt: now.toISOString(), policySchemaVersion: 5, rulesVersion: RULES_VERSION, decisionStatuses,
    ...collections, filteredPolicies: [], candidateCount: collections.policies.length,
    collectionCounts: Object.fromEntries(feedCollections.map(k => [k, collections[k].length])),
    sourceCandidateCount: candidates.length, candidateIds: ids, recordLedger: ledger,
    eligibleCombinations: audit.filter(p=>p.visible).flatMap(p=>(p.companyAssessments || []).filter(c=>c.status==='eligible').map(c=>({id:p.id,companyId:c.companyId}))),
    duplicateCount: candidates.length - Object.values(collections).reduce((n,c) => n+c.length,0),
    decisionCounts, discardedCount: decisionCounts.discarded, filteredCount: 0,
    coverage: { status: "partial", sourceFailures: sources.filter(s => !s.ok).length,
      incompleteSources: sources.filter(s => s.incomplete || !s.count || !s.paginationExhausted).length,
      pendingDocuments, pendingLeads: collections.reviewQueue.length, pendingQualifications, pendingSubprojects,
      companyGaps, matrix, unconfiguredSources: matrix.filter(s => s.status === "missing").length,
      fundingDirections: fundingDirections.map(name => ({name,status:"needs_review"})),
      message: "自动采集不能证明全网无遗漏；原文、子项、主体、来源及资金方向缺口须逐项复核。"
    },
    companyProfile: companyProfile ? {profileId:companyProfile.profileId,generatedAt:companyProfile.generatedAt} : null,
    sources
  };
}
export function assertViablePolicyFeed(payload) {
  const counted = decisionStatuses.reduce((n,s) => n+Number(payload.decisionCounts?.[s] || 0),0);
  if (counted !== payload.sourceCandidateCount) throw new Error("候选判定计数不守恒");
  const ids = payload.candidateIds || [], ledger = payload.recordLedger || [];
  if (ids.length !== payload.sourceCandidateCount || new Set(ids).size !== ids.length || ledger.length !== ids.length || new Set(ledger.map(r=>r.id)).size !== ids.length) throw new Error("候选去向台账不守恒");
  const outputs = new Map();
  for (const key of feedCollections) {
    if (payload.collectionCounts?.[key] !== payload[key]?.length) throw new Error("前端分区数量不一致");
    for (const p of payload[key] || []) {
      if (outputs.has(p.id)) throw new Error("输出 ID 跨分区重复");
      outputs.set(p.id, {p,key});
    }
  }
  for (const r of ledger) {
    const target = outputs.get(r.targetId);
    if (!ids.includes(r.id) || !target || target.key !== r.collection || !(target.p.id === r.id || target.p.aliases?.includes(r.id))) throw new Error("候选没有唯一可追溯去向");
  }
  for (const {p} of outputs.values()) if (!ledger.some(r=>r.targetId===p.id)) throw new Error("输出缺少来源");
  for (const combination of payload.eligibleCombinations || []) {
    const r = ledger.find(r=>r.id===combination.id), target = r && outputs.get(r.targetId);
    if (!target || target.key !== 'policies' || !target.p.companyAssessments?.some(c=>c.companyId===combination.companyId && c.status==='eligible')) throw new Error("已确认的项目×主体组合被去重或筛选丢失");
  }
  if (payload.candidateCount !== payload.policies.length) throw new Error("公开项目计数不一致");
  for (const p of payload.policies) if (p.projectAuthenticity?.status !== "confirmed" || !p.visible || p.timing?.applicationWindowStatus === "expired" || !["eligible","needs_review","upcoming"].includes(p.decision)) throw new Error("主列表含非项目或过期项目");
  for (const p of payload.historyPolicies) if (p.projectAuthenticity?.status !== "confirmed" || p.timing?.applicationWindowStatus !== "expired") throw new Error("历史列表分类错误");
  return payload;
}
