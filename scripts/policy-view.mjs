const dispositionOrder = { eligible: 0, supplier_call: 1, opportunity: 2, needs_review: 3, ineligible: 4 };

export function unselectedPolicyItems(allItems, selectedIds) {
  const selected = new Set(selectedIds);
  return allItems.filter((policy) => !selected.has(policy.id));
}

export function policyStatusCounts(allItems, selectedIds) {
  const counts = { eligible: 0, supplier_call: 0, opportunity: 0, needs_review: 0, ineligible: 0 };
  for (const policy of unselectedPolicyItems(allItems, selectedIds)) {
    if (policy.disposition in counts) counts[policy.disposition] += 1;
  }
  return counts;
}

export function selectPolicyItems(allItems, selectedIds, { tab, disposition, region, query }) {
  const selected = new Set(selectedIds);
  // "all" deliberately starts from every unselected row.  Do not pre-filter
  // `ineligible` here: that was the regression that made the old "全部" button
  // silently omit all non-matching records.
  const source = tab === "selected"
    ? allItems.filter((policy) => selected.has(policy.id))
    : allItems.filter((policy) => !selected.has(policy.id));
  const normalizedQuery = String(query || "").trim();
  return source.filter((policy) => {
    const text = `${policy.title || ""} ${policy.department || ""} ${policy.category || ""} ${(policy.matchReasons || []).join(" ")} ${policy.filterReason || ""}`;
    const regionMatched = region === "全部地区" || policy.region === region;
    const dispositionMatched = disposition === "all" || policy.disposition === disposition;
    return regionMatched && dispositionMatched && (!normalizedQuery || text.includes(normalizedQuery));
  }).sort((a, b) => (dispositionOrder[a.disposition] ?? 99) - (dispositionOrder[b.disposition] ?? 99) || (b.matchScore || 0) - (a.matchScore || 0));
}
