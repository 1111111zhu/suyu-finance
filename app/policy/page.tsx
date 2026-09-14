"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import Link from "next/link";
import "./policy.css";
import "./policy-overrides.css";

type MatchDisposition = "matched" | "opportunity" | "ineligible";
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
  verifiedOriginalUrl?: string;
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
  applicationEntities?: unknown;
};
type Feed = { updatedAt: string; policies: Policy[]; filteredPolicies?: Policy[]; sources: { id: string; name: string; ok: boolean; count: number }[] };
type DisplayPolicy = Policy & { remaining: number | null; disposition: MatchDisposition };

const fallback: Feed = { updatedAt: "", sources: [], policies: [] };
const DEFAULT_SIDEBAR_WIDTH = 155;
const MIN_SIDEBAR_WIDTH = 155;
const MAX_SIDEBAR_WIDTH = 155;
const MIN_CONTENT_WIDTH = 540;
const SIDEBAR_WIDTH_STORAGE_KEY = "policy-sidebar-width";
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
  if (["matched", "eligible", "apply", "applicable", "可申报", "申报", "needs_review", "manual_review", "pending_review", "待人工确认", "待核验"].includes(value)) return "matched";
  if (["opportunity", "event_opportunity", "可争取机会", "机会"].includes(value)) return "opportunity";
  if (["ineligible", "not_matched", "excluded", "false", "不匹配"].includes(value)) return "ineligible";
  if (policy.needsReview) return "matched";
  // 兼容历史数据：未知状态不会被称为“可申报”，但仍按分数置于单一列表。
  return "matched";
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
  if (policy.disposition === "ineligible") return ["该项目的申报对象与企业当前角色不一致"];
  return ["匹配依据待补充"];
}

type ApplicationEntityMatch = {
  entityId: string;
  entityLabel: string;
  scopeId: string;
  scopeLabel: string;
  status?: string;
};

function applicationEntityMatches(policy: Policy): ApplicationEntityMatch[] {
  const evidence = asObject(policy.evidence);
  const assessment = asObject(evidence?.applicationEntities) || asObject(policy.applicationEntities);
  const matches = assessment?.matches;
  if (!Array.isArray(matches)) return [];
  return matches.flatMap((item) => {
    const value = asObject(item);
    const entityId = typeof value?.entityId === "string" ? value.entityId : "";
    const entityLabel = typeof value?.entityLabel === "string" ? value.entityLabel : "";
    const scopeId = typeof value?.scopeId === "string" ? value.scopeId : "";
    const scopeLabel = typeof value?.scopeLabel === "string" ? value.scopeLabel : "";
    return entityId && entityLabel && scopeId && scopeLabel ? [{ entityId, entityLabel, scopeId, scopeLabel, status: typeof value?.status === "string" ? value.status : undefined }] : [];
  });
}

function Icon({ name }: { name: "menu" | "search" | "file" | "salary" | "folder" | "plus" | "chevron" | "home" }) {
  const paths = {
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
    file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h5" /></>,
    salary: <><rect x="5" y="3" width="14" height="18" rx="2" /><circle cx="12" cy="9" r="2" /><path d="M8.5 17c.7-2.1 2-3 3.5-3s2.8.9 3.5 3" /></>,
    folder: <><path d="M3 7.5h7l2-2h3l3 3v10.5H3z" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    chevron: <><path d="m7 9 5 5 5-5" /></>,
    home: <><path d="m3 10 9-7 9 7M5 10v10h14V10" /></>,
  };
  return <svg className={`icon icon-${name}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function PolicyPage() {
  const [feed, setFeed] = useState<Feed>(fallback);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState("全部地区");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"pending" | "selected">("pending");
  const [selected, setSelected] = useState<string[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const splitterRef = useRef<HTMLDivElement>(null);

  const sidebarBounds = useCallback(() => {
    const viewportWidth = typeof window === "undefined" ? MIN_CONTENT_WIDTH + MAX_SIDEBAR_WIDTH : window.innerWidth;
    return {
      min: MIN_SIDEBAR_WIDTH,
      max: Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, viewportWidth - MIN_CONTENT_WIDTH)),
    };
  }, []);

  const updateSidebarWidth = useCallback((nextWidth: number) => {
    const { min, max } = sidebarBounds();
    setSidebarWidth(Math.round(Math.min(max, Math.max(min, nextWidth))));
  }, [sidebarBounds]);

  useEffect(() => {
    const restoreSelectionFrame = window.requestAnimationFrame(() => {
      const saved = localStorage.getItem("policy-radar-selected-ids");
      if (saved) try { setSelected(JSON.parse(saved)); } catch { /* ignore an invalid local selection */ }
    });
    fetch(`/policies.json?t=${Date.now()}`, { cache: "no-store" })
      .then(response => response.json() as Promise<Feed>)
      .then(setFeed)
      .catch(() => setFeed(fallback))
      .finally(() => setLoading(false));
    return () => window.cancelAnimationFrame(restoreSelectionFrame);
  }, []);

  useEffect(() => {
    const savedWidth = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    const restoreWidthFrame = window.requestAnimationFrame(() => {
      if (Number.isFinite(savedWidth) && savedWidth > 0) updateSidebarWidth(savedWidth);
    });
    const keepSidebarInBounds = () => setSidebarWidth(currentWidth => {
      const { min, max } = sidebarBounds();
      return Math.round(Math.min(max, Math.max(min, currentWidth)));
    });
    window.addEventListener("resize", keepSidebarInBounds);
    return () => {
      window.cancelAnimationFrame(restoreWidthFrame);
      window.removeEventListener("resize", keepSidebarInBounds);
    };
  }, [sidebarBounds, updateSidebarWidth]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  const allItems = useMemo<DisplayPolicy[]>(() => {
    const seen = new Set<string>();
    return [...feed.policies, ...(feed.filteredPolicies || [])].filter(policy => {
      if (seen.has(policy.id)) return false;
      seen.add(policy.id);
      return true;
    }).map(policy => ({ ...policy, remaining: daysUntil(policy.deadline), disposition: matchDisposition(policy) }));
  }, [feed.filteredPolicies, feed.policies]);
  const projectItems = useMemo(() => allItems.filter(policy => policy.visible !== false && policy.disposition === "matched"), [allItems]);
  const pendingItems = useMemo(() => projectItems.filter(policy => !selected.includes(policy.id)), [projectItems, selected]);
  const items = useMemo(() => {
    const source = tab === "selected" ? projectItems.filter(policy => selected.includes(policy.id)) : pendingItems;
    const searched = source.filter(policy => {
      const text = `${policy.title} ${policy.department} ${policy.category} ${(policy.matchReasons || []).join(" ")} ${policy.filterReason || ""}`;
      return (region === "全部地区" || policy.region === region) && (!query || text.includes(query.trim()));
    });
    return searched.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0) || (b.rankScore || 0) - (a.rankScore || 0));
  }, [pendingItems, projectItems, query, region, selected, tab]);

  const updateSelected = (id: string, add: boolean) => setSelected(current => {
    const next = add ? [...new Set([...current, id])] : current.filter(item => item !== id);
    localStorage.setItem("policy-radar-selected-ids", JSON.stringify(next));
    return next;
  });
  const finishResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setIsResizing(false);
  };
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
    updateSidebarWidth(event.clientX);
  };
  const moveResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSidebarWidth(event.clientX);
  };
  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const { min, max } = sidebarBounds();
    if (event.key === "ArrowLeft") { event.preventDefault(); updateSidebarWidth(sidebarWidth - 16); }
    else if (event.key === "ArrowRight") { event.preventDefault(); updateSidebarWidth(sidebarWidth + 16); }
    else if (event.key === "Home") { event.preventDefault(); updateSidebarWidth(min); }
    else if (event.key === "End") { event.preventDefault(); updateSidebarWidth(max); }
  };

  const layoutStyle = { "--policy-sidebar-width": `${sidebarWidth}px` } as CSSProperties;

  return <main className={`application-page${isResizing ? " is-resizing" : ""}`} style={layoutStyle}>
    <aside className="app-sidebar" id="policy-sidebar">
      <Link className="suyu-logo" href="/" aria-label="溯驭财务首页"><span className="suyu-logo-mark" aria-hidden="true" /></Link>
      <nav className="side-nav">
        <Link href="/rd-cost/index.html"><Icon name="file" />研发费用</Link>
        <Link className="active" href="/" aria-current="page"><Icon name="folder" />项目申报</Link>
        <a href="/salary/index.html?v=policy-home#gross/upload"><Icon name="salary" />工资表</a>
      </nav>
    </aside>
    <div
      ref={splitterRef}
      className="sidebar-splitter"
      role="separator"
      aria-controls="policy-sidebar policy-content"
      aria-label="调整导航栏宽度"
      aria-orientation="vertical"
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={sidebarBounds().max}
      aria-valuenow={sidebarWidth}
      tabIndex={0}
      onPointerDown={startResize}
      onPointerMove={moveResize}
      onPointerUp={finishResize}
      onPointerCancel={finishResize}
      onKeyDown={resizeWithKeyboard}
    />
    <section className="app-content" id="policy-content">
      <header className="app-header"><button className="menu-button" aria-label="展开菜单"><Icon name="menu" /></button><label className="global-search"><Icon name="search" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索项目、部门、匹配依据等" /><kbd>/</kbd></label></header>
      <div className="application-body">
        <div className="page-intro"><div><h1>政府项目申报</h1><p>项目按匹配度由高到低排列；宽赛道项目会自动排在后面。</p></div><p className="hidden-note">已排除非申报、活动新闻及未通过原文核验的记录</p></div>
        <div className="tabs"><button className={tab === "pending" ? "active" : ""} onClick={() => setTab("pending")}>待选项目 <b>{pendingItems.length}</b></button><button className={tab === "selected" ? "active" : ""} onClick={() => setTab("selected")}>已选项目 <b>{selected.filter(id => projectItems.some(policy => policy.id === id)).length}</b></button></div>
        <div className="application-filters">
          <label><select value={region} onChange={event => setRegion(event.target.value)}><option>全部地区</option><option>国家</option><option>浙江省</option><option>江苏省</option><option>杭州市</option><option>苏州市</option><option>连云港市</option></select><Icon name="chevron" /></label>
          <span className="update-note">{loading ? "正在更新…" : `更新于 ${formatDate(feed.updatedAt)}`}</span>
        </div>
        <div className="project-table">
          <div className="table-head"><span>项目名称及匹配依据</span><span>支持方式</span><span>时间状态</span><span>资料核验</span><span>查看原文</span><span>操作</span></div>
          {items.map(policy => {
            const score = policy.matchScore ?? 0;
            const evidence = evidenceInfo(policy);
            const timing = timeInfo(policy);
            const reasons = decisionReason(policy);
            const entityMatches = applicationEntityMatches(policy);
            const evidenceTitle = evidence.evidence.length ? `已定位：${evidence.evidence.slice(0, 2).join("、")}` : undefined;
            return <article className={`project-row disposition-${policy.disposition}`} key={policy.id} title="双击打开官方原文" onDoubleClick={() => window.location.assign(policy.verifiedOriginalUrl || policy.url)}>
              <div className="project-name"><span className="match-badge" style={{ "--score": score } as CSSProperties}><strong>{score}</strong><small>匹配度</small></span><div><div className="project-title-line"><h2>{policy.title}</h2></div><p>{policy.summary || "政策摘要待补充。"}</p>{entityMatches.length > 0 && <div className="entity-applicability" aria-label="适用申报主体">{entityMatches.map(item => <span key={`${item.entityId}-${item.scopeId}`}>适用主体：{item.entityLabel} · {item.scopeLabel}</span>)}</div>}<div className="decision-reasons" aria-label="匹配依据">{reasons.map(reason => <span key={reason}>{reason}</span>)}</div></div></div>
              <div className="support-cell">{supportItems(policy).map(item => <span key={item}>{item}</span>)}</div>
              <div className="time-cell"><span className={`deadline-cell ${timing.tone}`}>{timing.label}</span>{timing.date && <small>{timing.date}</small>}{timing.reason && <small>{timing.reason}</small>}</div>
              <div className="evidence-cell" title={evidenceTitle}><span className={`evidence-label ${evidence.complete || evidence.score !== undefined && evidence.score >= 80 ? "complete" : evidence.score !== undefined || evidence.missing.length ? "partial" : "unknown"}`}>{evidence.label}</span>{evidence.missing.length ? <small>缺：{evidence.missing.slice(0, 2).join("、")}{evidence.missing.length > 2 ? "等" : ""}</small> : evidence.evidence.length ? <small>已定位 {evidence.evidence.slice(0, 2).join("、")}</small> : <small>未提供可核验资料</small>}</div>
              <a className="source-link" href={policy.verifiedOriginalUrl || policy.url} target="_blank" rel="noopener noreferrer" title="在新标签页打开已核验官方原文">查看已核验原文</a>
              {tab === "selected" ? <button className="remove-button" onClick={() => updateSelected(policy.id, false)}>移除</button> : <button className="select-button" onClick={() => updateSelected(policy.id, true)} aria-label="加入已选项目"><Icon name="plus" /></button>}
            </article>;
          })}
          {!items.length && <div className="empty-projects">{tab === "selected" ? "尚未选择项目。" : "当前没有通过原文核验且与溯驭相关的未过期项目。"}</div>}
        </div>
      </div>
    </section>
  </main>;
}
