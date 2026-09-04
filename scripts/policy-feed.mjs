import { auditPolicies } from "./policy-matcher.mjs";

const decisionStatuses = ["eligible", "supplier_call", "opportunity", "needs_review", "ineligible", "discarded"];

export function buildPolicyFeed(candidates, sources = [], companyProfile = null, now = new Date()) {
  const audit = auditPolicies(candidates, now, companyProfile);
  // Discarded records are audit-only. Never serialize their titles, URLs or
  // reasons into the public feed: the frontend's “全部” must not surface them.
  const publicAudit = audit.filter((policy) => {
    if (!policy.visible || policy.decision === "discarded") return false;
    // The public page is an action queue, not an audit dump. Keep only
    // directly applicable projects, supplier calls, and reviewable notices.
    // Activities and expired items are already discarded by the matcher; this
    // guard also protects against older/hand-authored records.
    if (!["eligible", "supplier_call", "needs_review"].includes(policy.decision)) return false;
    if (policy.timing?.applicationWindowStatus === "expired" || policy.timing?.activityStatus === "expired") return false;
    if (["organizer", "enterprise_opportunity"].includes(policy.activityRole)) return false;
    return true;
  });
  const policies = publicAudit;
  const filteredPolicies = [];
  const decisionCounts = Object.fromEntries(decisionStatuses.map((status) => [status, 0]));
  for (const policy of audit) {
    const decision = decisionStatuses.includes(policy.decision) ? policy.decision : "needs_review";
    decisionCounts[decision] += 1;
  }

  return {
    updatedAt: now.toISOString(),
    policySchemaVersion: 3,
    decisionStatuses,
    policies,
    filteredPolicies,
    candidateCount: publicAudit.length,
    sourceCandidateCount: candidates.length,
    discardedCount: audit.length - publicAudit.length,
    filteredCount: filteredPolicies.length,
    decisionCounts,
    companyProfile: companyProfile ? {
      profileId: companyProfile.profileId || null,
      generatedAt: companyProfile.generatedAt || null,
      verifiedFieldCount: companyProfile.validation?.verifiedFieldCount ?? null,
      unknownFieldCount: companyProfile.validation?.unknownFieldCount ?? null,
    } : null,
    sources,
  };
}

export function assertViablePolicyFeed(payload) {
  const counts = payload?.decisionCounts || {};
  const counted = decisionStatuses.reduce((sum, status) => sum + Number(counts[status] || 0), 0);
  const sourceCandidateCount = payload.sourceCandidateCount ?? payload.candidateCount;
  if (counted !== sourceCandidateCount) {
    throw new Error(`政策同步完整性校验失败：候选 ${sourceCandidateCount} 条，判定计数 ${counted} 条`);
  }
  if (payload.candidateCount !== (payload.policies?.length || 0) + (payload.filteredPolicies?.length || 0)) {
    throw new Error("政策同步完整性校验失败：公开候选数量与页面数据不一致");
  }
  const reviewable = Number(counts.eligible || 0) + Number(counts.supplier_call || 0) + Number(counts.opportunity || 0) + Number(counts.needs_review || 0);
  const nonDiscardedSourceCount = sourceCandidateCount - Number(counts.discarded || 0);
  if (nonDiscardedSourceCount > 0 && reviewable === 0) {
    throw new Error("政策同步已阻止：候选记录全部被判为不匹配，保留上一版有效数据");
  }
  return payload;
}
