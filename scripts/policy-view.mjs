import { supportKinds } from './policy-integrity.mjs';
import { cleanPolicyText, displayPolicyTime, extractApplicationTiming } from './policy-time.mjs';
const dispositionOrder = { eligible: 0, upcoming: 1, needs_review: 2, expired: 3, ineligible: 4, discarded: 5 };
export const collectionLabels = { policies: '真实项目', reviewQueue: '待查线索（非申报清单）', excludedRecords: '排除／关联记录' };
const targetCities = ['苏州', '杭州', '连云港'];
const otherCityPattern = /(?:绍兴|宁波|温州|嘉兴|湖州|金华|衢州|舟山|台州|丽水|南京|无锡|徐州|常州|南通|盐城|扬州|镇江|泰州|宿迁)市/;
export function isWithinApplicationScope(policy) {
  const region = String(policy.region || '');
  const title = String(policy.title || '');
  // Province/national notices support the three target company locations;
  // explicitly named other-city notices do not.
  if (otherCityPattern.test(region) || otherCityPattern.test(title)) return false;
  return !region || /国家|江苏省|浙江省|苏州|杭州|连云港/.test(region) || targetCities.some(city => title.includes(`${city}市`));
}
function currentWindow(policy, now) {
  // An earlier batch closing must not hide a later batch already evidenced in
  // this same record. Re-evaluate only when its displayed deadline has passed.
  if (policy.timing?.applicationWindowStatus !== 'expired' && policy.timing?.applicationWindows?.length > 1 && displayPolicyTime(policy,now).tone === 'closed') {
    const timing = extractApplicationTiming(policy,now);
    if (['open','ongoing','upcoming'].includes(timing.applicationWindowStatus)) return {...policy,timing,deadline:timing.deadlineDate,deadlineTime:timing.deadlineTime};
  }
  return policy;
}
export function isExpiredPolicy(policy, now = new Date()) {
  const p = currentWindow(policy,now);
  if (p.collection === 'historyPolicies' || p.timing?.applicationWindowStatus === 'expired' || p.disposition === 'expired') return true;
  // Unknown dates or an old first-batch date are not proof that rolling intake ended.
  if (['ongoing','unknown'].includes(p.timing?.applicationWindowStatus)) return false;
  return displayPolicyTime(p,now).tone === 'closed';
}
export function effectiveDisposition(policy, company = 'all') {
  if (policy.disposition === 'expired' || policy.collection === 'historyPolicies') return 'expired';
  if (policy.collection === 'excludedRecords') return policy.decision || 'discarded';
  return company === 'all' ? policy.disposition || policy.decision || 'needs_review' : policy.companyAssessments?.find(c=>c.companyId===company)?.status || 'needs_review';
}
export function safeSourceHref(policy) {
  for (const value of [policy.originalSourceUrl,policy.sourceReaderUrl,policy.linkHealth?.resolvedUrl,policy.url]) {
    if (typeof value !== 'string') continue;
    if (/^\/policy-sources\/[a-zA-Z0-9_-]+\.html$/.test(value)) return value;
    try { const u=new URL(value); if (['http:','https:'].includes(u.protocol)) return u.href; } catch { /* unknown link is visibly pending */ }
  }
  return '';
}
export function allFeedItems(feed, now = new Date()) {
  const seen = new Set();
  return Object.keys(collectionLabels).flatMap(collection => (feed[collection] || []).map(p => currentWindow({...p,collection},now))).filter(p => {
    if (seen.has(p.id) || isExpiredPolicy(p,now)) return false; seen.add(p.id); return true;
  }).map(p => ({...p,disposition:p.decision || 'needs_review',supportKinds:p.supportKinds || supportKinds(p)}));
}
// The public application page and its favorites share one scope. Audit records
// remain in the feed, but neither saved IDs nor search can bring them on screen.
function documentText(value = '') {
  // PDF line breaks and typographic quotes are insignificant. Years, batches,
  // directions and parentheses remain significant; no fuzzy title matching.
  return cleanPolicyText(value).replace(/&(?:ldquo|rdquo|quot);/g, '"').replace(/[“”"‘’']/g, '');
}
function isForwarding(policy) {
  return /转发|层转/.test(policy.title || '');
}
function isVerifiedDocument(policy) {
  let official = false;
  try { official = new URL(policy.url).hostname.endsWith('.gov.cn'); } catch { /* no verified official source */ }
  return official && policy.projectAuthenticity?.status === 'confirmed'
    && policy.originalVerification?.retrievalStatus === 'parsed'
    && policy.originalVerification?.bindingStatus === 'matched';
}
function originalReferences(policy) {
  const body = documentText(policy.content);
  return [...body.matchAll(/《([^《》]+)》/g)].flatMap(match => {
    const before = body.slice(Math.max(0, match.index - 160), match.index);
    const after = body.slice(match.index + match[0].length, match.index + match[0].length + 24);
    if (!/项目|专项|申报|指南/.test(match[1]) || !/(?:现将|转发|层转|印发了?|发布了?)$/.test(before) && !/^[，,、：:]*(?:现)?(?:转发|层转)/.test(after)) return [];
    return [{title: match[1], before}];
  });
}
function matchesReference(original, reference) {
  const title = documentText(original.title);
  if (title === reference.title) return true;
  // Some ministries put their name outside 《关于…》. Bind the issuer too,
  // instead of treating every similarly named national notice as interchangeable.
  const about = title.indexOf('关于');
  if (about <= 0 || title.slice(about) !== reference.title) return false;
  const issuer = title.slice(0, about);
  return ['印发了', '印发', '发布了', '发布'].some(verb => reference.before.endsWith(issuer + verb));
}
function relatedDocumentKey(document) {
  return `${document.id || ''}|${document.url || ''}`;
}
export function applicationFeedItems(feed, now = new Date()) {
  const items = allFeedItems({policies: feed.policies || []}, now).filter(isWithinApplicationScope);
  const originals = items.filter(policy => !isForwarding(policy) && isVerifiedDocument(policy));
  const wrappers = new Map(), hidden = new Set();
  // Expired local notices may still explain an active national application's
  // reporting path. Keep them as context, never as additional application rows.
  const sourceRecords = [...(feed.policies || []), ...(feed.historyPolicies || []), ...(feed.excludedRecords || [])];
  for (const policy of sourceRecords) {
    if (!isForwarding(policy) || !isVerifiedDocument(policy)) continue;
    const references = originalReferences(policy);
    if (new Set(references.map(reference => reference.title)).size !== 1) continue;
    const matches = originals.filter(original => references.some(reference => matchesReference(original, reference)));
    if (matches.length !== 1) continue;
    const original = matches[0];
    hidden.add(policy.id);
    const related = wrappers.get(original.id) || [];
    related.push(policy); wrappers.set(original.id, related);
  }
  return items.filter(policy => !hidden.has(policy.id)).map(policy => {
    const forwarded = wrappers.get(policy.id) || [];
    if (!forwarded.length) return policy;
    const aliases = [...new Set([...(policy.aliases || []), ...forwarded.flatMap(item => [item.id, ...(item.aliases || [])])])];
    const relatedDocuments = [...(policy.relatedDocuments || []), ...forwarded.map(item => ({
      id: item.id, title: item.title, url: item.url, relation: '属地转发及报送要求',
      region: item.region, expired: isExpiredPolicy(item, now),
      requirement: (cleanPolicyText(item.content).match(/凡需[^。]{1,500}(?:。|$)/g) || []).join(' '),
      deadline: item.deadline || item.timing?.deadlineDate || '', deadlineTime: item.deadlineTime || item.timing?.deadlineTime || '',
    }))].filter((item, index, all) => all.findIndex(candidate => relatedDocumentKey(candidate) === relatedDocumentKey(item)) === index);
    return {...policy, originalSourceUrl: policy.url, aliases, relatedDocuments};
  });
}
export function canonicalSelections(items, ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter(id => typeof id === 'string').map(id => items.find(p => p.id === id || p.aliases?.includes(id))?.id || id))];
}
export function paginatePolicies(items, page = 1, pageSize = 30) {
  const size = Math.max(1, pageSize), pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(pages, Math.max(1, page));
  return {items:items.slice((current-1)*size, current*size),page:current,pages,total:items.length};
}

export function unselectedPolicyItems(allItems, selectedIds) {
  const selected = new Set(selectedIds);
  return allItems.filter((policy) => !isExpiredPolicy(policy) && !selected.has(policy.id));
}

export function policyStatusCounts(allItems, selectedIds) {
  const counts = { eligible: 0, upcoming: 0, needs_review: 0, ineligible: 0 };
  for (const policy of unselectedPolicyItems(allItems, selectedIds)) {
    if (policy.disposition in counts) counts[policy.disposition] += 1;
  }
  return counts;
}

export function selectPolicyItems(allItems, selectedIds, { tab = 'all', disposition = 'all', region = '全部地区', query = '', company = "all", collection, funding = 'all', now = new Date() }) {
  const selected = new Set(selectedIds);
  const activeItems = allItems.map(p=>currentWindow(p,now)).filter(p=>!isExpiredPolicy(p,now));
  // "all" deliberately starts from every unselected row.  Do not pre-filter
  // `ineligible` here: that was the regression that made the old "全部" button
  // silently omit all non-matching records.
  const source = tab === "selected"
    ? activeItems.filter((policy) => selected.has(policy.id))
    : tab === "all" ? activeItems : activeItems.filter((policy) => !selected.has(policy.id));
  const normalizedQuery = String(query || "").trim();
  return source.filter((policy) => {
    const text = `${policy.title || ""} ${policy.department || ""} ${policy.category || ""} ${policy.summary || ""} ${policy.content || ''} ${policy.applicationRequirements || ''} ${policy.sourceName || ''} ${(policy.relatedDocuments || []).map(d=>d.title).join(' ')} ${(policy.attachments || []).map(d=>d.title).join(' ')} ${(policy.companyAssessments || []).map(c => [c.companyName,...(c.reasons || []),...(c.missing || [])].join(' ')).join(" ")} ${(policy.matchReasons || []).join(" ")} ${policy.filterReason || ""}`;
    const regionMatched = region === "全部地区" || policy.region === region;
    const assessment = policy.companyAssessments?.find(c => c.companyId === company);
    const companyMatched = company === "all" || policy.collection === 'excludedRecords' || tab === 'selected' || !assessment || assessment.status !== "ineligible";
    const effective = effectiveDisposition(policy, company);
    const dispositionMatched = disposition === "all" || effective === disposition;
    const kinds = policy.supportKinds || supportKinds(policy);
    const fundingMatched = funding === 'all' || funding === 'funding' && kinds.some(k=>['grant','voucher','finance'].includes(k)) || kinds.includes(funding);
    const collectionMatched = tab === 'selected' || !collection || policy.collection === collection;
    return collectionMatched && fundingMatched && regionMatched && companyMatched && dispositionMatched && (!normalizedQuery || text.toLowerCase().includes(normalizedQuery.toLowerCase()));
  }).sort((a, b) => (dispositionOrder[a.disposition] ?? 99) - (dispositionOrder[b.disposition] ?? 99) || (a.timing?.deadlineDate || a.deadline || "9999").localeCompare(b.timing?.deadlineDate || b.deadline || "9999") || a.id.localeCompare(b.id));
}
