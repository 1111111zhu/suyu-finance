"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import brandMark from "../../design_mockups/brand/seeextech-symbol-user.png";
import "./policy.css";
import "./policy-overrides.css";

type MatchDisposition = "eligible" | "opportunity" | "needs_review" | "ineligible";
type EvidenceValue = number | string | {
  score?: number | string;
  missing?: string[] | string;
  missingFields?: string[] | string;
  evidence?: string[] | string;
  confirmed?: string[] | string;
  label?: string;
};
type TimeValue = string | {
  status?: string;
  label?: string;
  reason?: string;
  deadline?: string;
  daysLeft?: number;
};
type Policy = {
  id: string;
  title: string;
  region: string;
  department: string;
  deadline?: string;
  deadlineTime?: string;
  category: string;
  summary: string;
  content?: string;
  url: string;
  sourceName: string;
  matchScore?: number;
  rankScore?: number;
  daysLeft?: number | null;
  needsReview?: boolean;
  matchLevel?: string;
  matchReasons?: string[];
  decisionReasons?: string[];
  matchDisposition?: string;
  decision?: string;
  eligibilityStatus?: string;
  matchStatus?: string;
  evidenceCompleteness?: EvidenceValue;
  evidence?: Record<string, unknown>;
  timeStatus?: TimeValue;
  timing?: Record<string, unknown>;
  filterReason?: string;
  visible?: boolean;
  beneficiaryRole?: string;
  participationRole?: string;
  entryChannel?: string;
  opportunityType?: string;
  policyEligibility?: string | boolean;
};
type Feed = { updatedAt: string; policies: Policy[]; filteredPolicies?: Policy[]; sources: { id: string; name: string; ok: boolean; count: number }[] };
type DisplayPolicy = Policy & { remaining: number | null; disposition: MatchDisposition };

const fallback: Feed = { updatedAt: "", sources: [], policies: [] };
const dispositionLabels: Record<MatchDisposition, string> = {
  eligible: "可申报",
  opportunity: "可争取机会",
  needs_review: "待人工确认",
  ineligible: "不匹配",
};

const daysUntil = (date?: string) => {
  if (!date) return null;
  const parsed = new Date(`${date}T23:59:59+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : Math.ceil((parsed.getTime() - Date.now()) / 86400000);
};
const formatDate = (value?: string) => {
  if (!value) return "尚未获取";
  try {
    return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value));
  } catch {
    return value;
  }
};
const asStringList = (value: unknown) => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  return typeof value === "string" && value.trim() ? [value] : [];
};
const asObject = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const normalizeKey = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]/g, "_") : "";

function matchDisposition(policy: Policy): MatchDisposition {
  const value = normalizeKey(policy.matchDisposition ?? policy.decision ?? policy.eligibilityStatus ?? policy.matchStatus ?? policy.policyEligibility);
  if (["eligible", "apply", "applicable", "可申报", "申报"].includes(value)) return "eligible";
  if (["opportunity", "event_opportunity", "可争取机会", "机会"].includes(value)) return "opportunity";
  if (["needs_review", "manual_review", "pending_review", "待人工确认", "待核验"].includes(value)) return "needs_review";
  if (["ineligible", "not_matched", "excluded", "false", "不匹配"].includes(value)) return "ineligible";
  if (policy.needsReview) return "needs_review";
  // Older feeds do not have a verdict. Do not infer that a policy can be applied for.
  return "needs_review";
}

function supportItems(policy: Policy) {
  if (matchDisposition(policy) === "opportunity") return ["活动机会"];
  const text = `${policy.title} ${policy.summary} ${policy.content || ""}`;
  const terms = ["补助", "补贴", "奖励", "资助", "贴息", "贷款", "减免"];
  const tags = terms.flatMap((term, index) => text.split(/[。；]/).filter(sentence => sentence.includes(term)).map(sentence => {
    const amount = sentence.match(/(\d+(?:\.\d+)?)\s*(亿元|亿|万元|万|元|个百分点|%)/);
    return { label: `${term === "补贴" ? "补助" : term}${amount ? `${amount[1]}${amount[2] === "个百分点" ? "%" : amount[2]}` : ""}`.slice(0, 8), priority: Number(amount?.[1] || 0) + 70 - index * 7 };
  })).filter((item, index, all) => item.label && all.findIndex(candidate => candidate.label === item.label) === index).sort((a, b) => b.priority - a.priority).slice(0, 3).map(item => item.label);
  return tags.length ? tags : ["支持方式待核验"];
}

function evidenceInfo(policy: Policy) {
  const raw = policy.evidenceCompleteness;
  const detail = asObject(raw);
  const evidenceDetail = asObject(policy.evidence);
  const completeness = asObject(evidenceDetail?.completeness);
  const rawScore = detail?.score ?? (typeof raw === "number" ? raw : undefined);
  const numberScore = typeof rawScore === "number" ? rawScore : typeof rawScore === "string" && rawScore.trim() !== "" ? Number(rawScore) : undefined;
  const normalizedScore = typeof numberScore === "number" && numberScore >= 0 && numberScore <= 1 ? numberScore * 100 : numberScore;
  const score = Number.isFinite(normalizedScore) ? Math.max(0, Math.min(100, Math.round(normalizedScore as number))) : undefined;
  const missing = [...asStringList(detail?.missing), ...asStringList(detail?.missingFields), ...asStringList(completeness?.missing)].filter((item, index, all) => all.indexOf(item) === index);
  const evidence = [...asStringList(detail?.evidence), ...asStringList(detail?.confirmed)].filter((item, index, all) => all.indexOf(item) === index);
  const suppliedLabel = typeof raw === "string" ? raw : typeof detail?.label === "string" ? detail.label : "";
  const confirmed = [
    ["支持对象", evidenceDetail?.beneficiary],
    ["申报主体", evidenceDetail?.applicant],
    ["申报条件", evidenceDetail?.conditions],
    ["支持方式", evidenceDetail?.support],
    ["截止日期", evidenceDetail?.deadline],
  ].flatMap(([label, item]) => asObject(item)?.found === true ? [label] : []);
  const complete = completeness?.complete === true;
  const label = suppliedLabel || (complete ? "证据完整" : score === undefined ? missing.length ? "证据待补" : "证据待核验" : score >= 80 ? `证据较完整 ${score}%` : `证据不完整 ${score}%`);
  return { label, score, missing, evidence: evidence.length ? evidence : confirmed, complete };
}

function timeInfo(policy: DisplayPolicy) {
  const raw = policy.timeStatus;
  const detail = asObject(raw);
  const timing = asObject(policy.timing);
  const source = typeof raw === "string" ? raw : typeof detail?.status === "string" ? detail.status : typeof timing?.applicationWindowStatus === "string" ? timing.applicationWindowStatus : "";
  const suppliedLabel = typeof detail?.label === "string" ? detail.label : "";
  const normalized = normalizeKey(source || suppliedLabel);
  const date = typeof detail?.deadline === "string" ? detail.deadline : typeof timing?.deadlineDate === "string" ? timing.deadlineDate : policy.deadline;
  const rawDays = typeof detail?.daysLeft === "number" ? detail.daysLeft : typeof timing?.daysLeft === "number" ? timing.daysLeft : policy.daysLeft ?? policy.remaining;
  const remaining = typeof rawDays === "number" && Number.isFinite(rawDays) ? Math.ceil(rawDays) : policy.remaining;
  let tone: "open" | "soon" | "closed" | "unknown" = "unknown";
  let label = suppliedLabel || source;

  if (/[已截止|截止|expired|closed]/i.test(normalized)) { tone = "closed"; label ||= "已截止"; }
  else if (/[即将截止|临近|closing|soon]/i.test(normalized)) { tone = "soon"; label ||= "即将截止"; }
  else if (/[长期|long_term|ongoing]/i.test(normalized)) { tone = "open"; label ||= "长期受理"; }
  else if (/[申报中|开放|open|active|accepting]/i.test(normalized)) { tone = "open"; label ||= "申报中"; }
  else if (/[即将开始|upcoming]/i.test(normalized)) { tone = "unknown"; label ||= "即将开始"; }
  else if (/[待核验|未知|unknown|not_specified]/i.test(normalized)) { label ||= "时间待核验"; }
  else if (remaining !== null) {
    if (remaining < 0) { tone = "closed"; label = "已截止"; }
    else if (remaining <= 30) { tone = "soon"; label = `剩余 ${remaining} 天`; }
    else { tone = "open"; label = `剩余 ${remaining} 天`; }
  }
  if (!label) label = "时间待核验";
  const projectPeriod = typeof timing?.projectPeriod === "string" ? timing.projectPeriod : "";
  return { label, tone, date, remaining, reason: typeof detail?.reason === "string" ? detail.reason : projectPeriod ? `项目周期：${projectPeriod}` : "" };
}

function decisionReason(policy: DisplayPolicy) {
  const reasons = [...asStringList(policy.decisionReasons), ...asStringList(policy.matchReasons)].filter((item, index, all) => all.indexOf(item) === index);
  if (reasons.length) return reasons.slice(0, 2);
  if (policy.filterReason) return [policy.filterReason];
  if (policy.disposition === "needs_review") return ["尚未生成新版匹配结论，待核验申报主体与关键条件"];
  if (policy.disposition === "opportunity") return ["适合作为活动、路演或受邀交流机会跟进"];
  if (policy.disposition === "ineligible") return ["该项目的申报对象与企业当前角色不一致"];
  return ["匹配依据待补充"];
}

function Icon({ name }: { name: "menu" | "search" | "file" | "salary" | "folder" | "plus" | "chevron" }) {
  const paths = {
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
    file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h5" /></>,
    salary: <><rect x="5" y="3" width="14" height="18" rx="2" /><circle cx="12" cy="9" r="2" /><path d="M8.5 17c.7-2.1 2-3 3.5-3s2.8.9 3.5 3" /></>,
    folder: <><path d="M3 7.5h7l2-2h3l3 3v10.5H3z" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    chevron: <><path d="m7 9 5 5 5-5" /></>,
  };
  return <svg className={`icon icon-${name}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function PolicyPage() {
  const [feed, setFeed] = useState<Feed>(fallback);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState("全部地区");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"pending" | "selected">("pending");
  // “待确认”是规则观察队列，不是用户的待办。默认仅显示当前可以
  // 直接行动的事项，避免未解析完整的通知占满项目列表。
  const [dispositionFilter, setDispositionFilter] = useState<"all" | Exclude<MatchDisposition, "ineligible">>("eligible");
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    const restoreSelection = requestAnimationFrame(() => {
      const saved = localStorage.getItem("policy-radar-selected-ids");
      if (saved) try { setSelected(JSON.parse(saved)); } catch { /* ignore an invalid local selection */ }
    });
    fetch(`/policies.json?t=${Date.now()}`, { cache: "no-store" })
      .then(response => response.json() as Promise<Feed>)
      .then(setFeed)
      .catch(() => setFeed(fallback))
      .finally(() => setLoading(false));
    return () => cancelAnimationFrame(restoreSelection);
  }, []);

  const allItems = useMemo<DisplayPolicy[]>(() => {
    const seen = new Set<string>();
    return [...feed.policies, ...(feed.filteredPolicies || [])].filter(policy => {
      if (seen.has(policy.id)) return false;
      seen.add(policy.id);
      return true;
    }).map(policy => ({ ...policy, remaining: daysUntil(policy.deadline), disposition: matchDisposition(policy) }));
  }, [feed.filteredPolicies, feed.policies]);
  const pendingItems = useMemo(() => allItems.filter(policy => !selected.includes(policy.id) && policy.disposition !== "ineligible" && (policy.visible !== false || policy.disposition === "opportunity")), [allItems, selected]);
  const items = useMemo(() => {
    const source = tab === "selected" ? allItems.filter(policy => selected.includes(policy.id)) : pendingItems;
    const searched = source.filter(policy => {
      const text = `${policy.title} ${policy.department} ${policy.category} ${(policy.matchReasons || []).join(" ")} ${policy.filterReason || ""}`;
      return (region === "全部地区" || policy.region === region) && (!query || text.includes(query.trim()));
    });
    const filtered = dispositionFilter === "all" ? searched : searched.filter(policy => policy.disposition === dispositionFilter);
    const order: Record<MatchDisposition, number> = { eligible: 0, opportunity: 1, needs_review: 2, ineligible: 3 };
    return filtered.sort((a, b) => order[a.disposition] - order[b.disposition] || (b.matchScore || 0) - (a.matchScore || 0));
  }, [allItems, dispositionFilter, pendingItems, query, region, selected, tab]);

  const updateSelected = (id: string, add: boolean) => setSelected(current => {
    const next = add ? [...new Set([...current, id])] : current.filter(item => item !== id);
    localStorage.setItem("policy-radar-selected-ids", JSON.stringify(next));
    return next;
  });
  const statusCounts = useMemo(() => ({
    eligible: pendingItems.filter(item => item.disposition === "eligible").length,
    opportunity: pendingItems.filter(item => item.disposition === "opportunity").length,
    needs_review: pendingItems.filter(item => item.disposition === "needs_review").length,
  }), [pendingItems]);

  return <main className="application-page">
    <aside className="app-sidebar">
      <Link className="suyu-logo" href="/" aria-label="溯驭财务首页"><Image className="suyu-logo-mark" src={brandMark} alt="SEEEx" priority /><strong>溯驭财务</strong></Link>
      <nav className="side-nav">
        <Link href="/"><Icon name="file" />研发费用</Link>
        <Link className="active" href="/policy" aria-current="page"><Icon name="folder" />项目申报</Link>
        <Link href="/salary/"><Icon name="salary" />工资表</Link>
      </nav>
    </aside>
    <section className="app-content">
      <header className="app-header"><button className="menu-button" aria-label="展开菜单"><Icon name="menu" /></button><label className="global-search"><Icon name="search" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索项目、部门、匹配依据等" /><kbd>/</kbd></label></header>
      <div className="application-body">
        <div className="page-intro"><div><h1>政府项目申报</h1><p>默认只展示可直接行动的项目；待核验通知不会进入待办。</p></div><p className="hidden-note">已隐藏不匹配项目及待核验通知</p></div>
        <div className="tabs"><button className={tab === "pending" ? "active" : ""} onClick={() => setTab("pending")}>待选项目 <b>{statusCounts.eligible + statusCounts.opportunity}</b></button><button className={tab === "selected" ? "active" : ""} onClick={() => setTab("selected")}>已选项目 <b>{selected.length}</b></button></div>
        <div className="application-filters">
          <label><select value={region} onChange={event => setRegion(event.target.value)}><option>全部地区</option><option>国家</option><option>浙江省</option><option>江苏省</option><option>杭州市</option><option>苏州市</option><option>连云港市</option></select><Icon name="chevron" /></label>
          <div className="disposition-filter" aria-label="按匹配结论筛选"><button className={dispositionFilter === "all" ? "active" : ""} onClick={() => setDispositionFilter("all")}>全部（含待确认）</button><button className={dispositionFilter === "eligible" ? "active eligible" : ""} onClick={() => setDispositionFilter("eligible")}>可申报 <b>{statusCounts.eligible}</b></button><button className={dispositionFilter === "opportunity" ? "active opportunity" : ""} onClick={() => setDispositionFilter("opportunity")}>可争取 <b>{statusCounts.opportunity}</b></button><button className={dispositionFilter === "needs_review" ? "active review" : ""} onClick={() => setDispositionFilter("needs_review")}>规则观察 <b>{statusCounts.needs_review}</b></button></div>
          <span className="update-note">{loading ? "正在更新…" : `更新于 ${formatDate(feed.updatedAt)}`}</span>
        </div>
        <div className="project-table">
          <div className="table-head"><span>项目名称及判定</span><span>支持方式</span><span>时间状态</span><span>资料核验</span><span>查看原文</span><span>操作</span></div>
          {items.map(policy => {
            const score = policy.matchScore ?? 0;
            const evidence = evidenceInfo(policy);
            const timing = timeInfo(policy);
            const reasons = decisionReason(policy);
            const evidenceTitle = evidence.evidence.length ? `已定位：${evidence.evidence.slice(0, 2).join("、")}` : undefined;
            return <article className={`project-row disposition-${policy.disposition}`} key={policy.id} title="双击打开官方原文" onDoubleClick={() => window.location.assign(policy.url)}>
              <div className="project-name"><span className="match-badge" style={{ "--score": score } as CSSProperties}><strong>{score}</strong><small>匹配度</small></span><div><div className="project-title-line"><span className={`disposition-badge ${policy.disposition}`}>{dispositionLabels[policy.disposition]}</span><h2>{policy.title}</h2></div><p>{policy.summary || "政策摘要待补充。"}</p><div className="decision-reasons" aria-label="匹配依据">{reasons.map(reason => <span key={reason}>{reason}</span>)}</div></div></div>
              <div className="support-cell">{supportItems(policy).map(item => <span key={item}>{item}</span>)}</div>
              <div className="time-cell"><span className={`deadline-cell ${timing.tone}`}>{timing.label}</span>{timing.date && <small>{timing.date}</small>}{timing.reason && <small>{timing.reason}</small>}</div>
              <div className="evidence-cell" title={evidenceTitle}><span className={`evidence-label ${evidence.complete || evidence.score !== undefined && evidence.score >= 80 ? "complete" : evidence.score !== undefined || evidence.missing.length ? "partial" : "unknown"}`}>{evidence.label}</span>{evidence.missing.length ? <small>缺：{evidence.missing.slice(0, 2).join("、")}{evidence.missing.length > 2 ? "等" : ""}</small> : evidence.evidence.length ? <small>已定位 {evidence.evidence.slice(0, 2).join("、")}</small> : <small>未提供可核验资料</small>}</div>
              <a className="source-link" href={policy.url}>查看原文（已验）</a>
              {tab === "selected" ? <button className="remove-button" onClick={() => updateSelected(policy.id, false)}>移除</button> : <button className="select-button" onClick={() => updateSelected(policy.id, true)} aria-label={policy.disposition === "opportunity" ? "加入已选机会" : "加入已选项目"}><Icon name="plus" /></button>}
            </article>;
          })}
          {!items.length && <div className="empty-projects">{tab === "selected" ? "尚未选择项目。" : dispositionFilter === "eligible" ? "当前没有可直接申报的项目。待核验通知已移入“规则观察”，不会占用待办。" : dispositionFilter === "opportunity" ? "当前没有可争取的活动机会。" : "当前筛选条件下没有项目。"}</div>}
        </div>
      </div>
    </section>
  </main>;
}
