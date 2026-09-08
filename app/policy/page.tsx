"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- Vinext production navigation requires full-page anchors. */

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import brandMark from "../../design_mockups/brand/seeextech-symbol-user.png";
import { displayPolicyTime } from "../../scripts/policy-time.mjs";
import { selectPolicyItems, applicationFeedItems, canonicalSelections, paginatePolicies, effectiveDisposition, safeSourceHref } from "../../scripts/policy-view.mjs";
import { cardReasons, companyFitItems, qualificationNotes } from "./presentation.mjs";
import "./policy.css";
import "./policy-overrides.css";

type MatchDisposition = "eligible" | "supplier_call" | "opportunity" | "needs_review" | "ineligible" | "upcoming" | "expired" | "discarded";
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
  collection?: string;
  supportKinds?: string[];
  verificationIssues?: string[];
  subprojectReviewRequired?: boolean;
  sourceReaderUrl?: string;
  originalSourceUrl?: string;
  linkHealth?: LinkHealth;
  projectAuthenticity?: { status: string };
  applicationRequirements?: string;
  aliases?: string[];
  applicableCompanies?: string[];
  companyAssessments?: { companyId: string; companyName: string; status: string; reasons: string[]; missing: string[] }[];
  relatedDocuments?: { id?: string; title: string; url: string; linkHealth?: LinkHealth; relation?: string; region?: string; deadline?: string; deadlineTime?: string; expired?: boolean; requirement?: string }[];
  attachments?: { url: string; status: string; linkHealth?: LinkHealth }[];
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
  originalVerification?: {
    verified?: boolean;
    retrievalStatus?: "parsed" | "not_checked" | "failed" | "unsupported" | string;
    reason?: string;
  };
};
type LinkHealth = { status: string; resolvedUrl?: string; localUrl?: string; reason?: string; checkedAt?: string };
type Feed = { refreshMode?: string; coverage?: { status: string; sourceFailures: number; pendingDocuments: number; pendingLeads?: number; pendingQualifications?: number; pendingSubprojects?: number; incompleteSources?: number; unconfiguredSources?: number; companyGaps?: string[]; matrix?: {name:string;status:string;reason:string}[]; fundingDirections?: {name:string;status:string}[] }; sourceCandidateCount?: number; updatedAt: string; policies: Policy[]; reviewQueue?: Policy[]; historyPolicies?: Policy[]; excludedRecords?: Policy[]; filteredPolicies?: Policy[]; sources: { id: string; name: string; ok: boolean; count: number; incomplete?: boolean; error?: string; pendingPageUrls?: string[] }[] };
type DisplayPolicy = Policy & { remaining: number | null; disposition: MatchDisposition };

const fallback: Feed = { updatedAt: "", sources: [], policies: [] };

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

function supportItems(policy: Policy) {
  const evidence = asObject(policy.evidence?.support);
  const citations = Array.isArray(evidence?.citations) ? evidence.citations : [];
  const terms = citations.flatMap((item: unknown) => {
    const term = asObject(item)?.term;
    return typeof term === "string" ? [term] : [];
  });
  return terms.length ? terms : ["以申报指南为准"];
}

function timeInfo(policy: DisplayPolicy) {
  return displayPolicyTime(policy);
}

function decisionReason(policy: DisplayPolicy) {
  const reasons = [...asStringList(policy.decisionReasons), ...asStringList(policy.matchReasons)].filter((item, index, all) => all.indexOf(item) === index);
  if (reasons.length) return reasons.slice(0, 2);
  if (policy.filterReason) return [policy.filterReason];
  if (policy.disposition === "needs_review") return ["尚未生成新版匹配结论，待核验申报主体与关键条件"];
  if (policy.disposition === "supplier_call") return ["可作为技术、产品或解决方案供给方报送"];
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
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("全部地区");
  const [tab, setTab] = useState<"all" | "selected">("all");
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [newIds, setNewIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      const saved = localStorage.getItem("policy-radar-selected-ids");
      if (active && saved) try { setSelected(canonicalSelections([], JSON.parse(saved))); } catch { /* ignore an invalid local selection */ }
      const savedNew = localStorage.getItem("policy-radar-new-ids");
      if (active && savedNew) try { setNewIds(JSON.parse(savedNew).filter((id: unknown): id is string => typeof id === "string")); } catch { /* ignore invalid local markers */ }
    });
    const refresh = () => fetch(`/policy-applications.json?t=${Date.now()}`, { cache: "no-store" })
      .then(response => { if (!response.ok) throw new Error("读取失败"); return response.json() as Promise<Feed>; })
      .then(value => { if (active) {
        setFeed(value);
        setLoadError(false);
        const currentIds = applicationFeedItems(value).map(item => item.id);
        const knownRaw = localStorage.getItem("policy-radar-known-ids");
        let known: string[] = [];
        try { known = knownRaw ? JSON.parse(knownRaw).filter((id: unknown): id is string => typeof id === "string") : []; } catch { /* reset malformed local state */ }
        // The first visit establishes a baseline; only later server refreshes
        // receive the NEW marker, so an existing catalogue is not mislabelled.
        if (knownRaw !== null) {
          const knownSet = new Set(known);
          const incoming = currentIds.filter(id => !knownSet.has(id));
          if (incoming.length) setNewIds(current => {
            const next = [...new Set([...current, ...incoming])];
            localStorage.setItem("policy-radar-new-ids", JSON.stringify(next));
            return next;
          });
        }
        localStorage.setItem("policy-radar-known-ids", JSON.stringify([...new Set([...known, ...currentIds])]));
        setSelected(current => {
          const next = canonicalSelections(applicationFeedItems(value), current);
          localStorage.setItem("policy-radar-selected-ids", JSON.stringify(next));
          return next;
        });
      } })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    refresh();
    const timer = setInterval(refresh, 5 * 60_000);
    const updateClock = () => setClock(Date.now());
    const tick = setInterval(updateClock, 60_000);
    window.addEventListener("focus", updateClock);
    return () => { active = false; clearInterval(timer); clearInterval(tick); window.removeEventListener("focus", updateClock); };
  }, []);

  const allItems = useMemo<DisplayPolicy[]>(() => {
    return applicationFeedItems(feed, new Date(clock)).map((policy: Policy & {disposition: MatchDisposition}) => ({ ...policy, remaining: daysUntil(policy.deadline) }));
  }, [feed, clock]);
  const regions = useMemo(() => [...new Set(allItems.map(item => item.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")), [allItems]);
  const items = useMemo<DisplayPolicy[]>(() => selectPolicyItems(allItems, selected, { tab, query, region, now: new Date(clock) }), [allItems, query, region, selected, tab, clock]);
  const pagination = paginatePolicies(items, page, 30);
  const clearSearch = () => {setQuery('');setPage(1);};

  const updateSelected = (id: string, add: boolean) => setSelected(current => {
    const next = add ? [...new Set([...current, id])] : current.filter(item => item !== id);
    localStorage.setItem("policy-radar-selected-ids", JSON.stringify(next));
    return next;
  });
  return <main className="application-page">
    <aside className="app-sidebar">
      <a className="suyu-logo" href="/" aria-label="溯驭财务首页"><Image className="suyu-logo-mark" src={brandMark} alt="SEEEx" priority /><strong>溯驭财务</strong></a>
      <nav className="side-nav">
        <a href="/"><Icon name="file" />研发费用</a>
        <a className="active" href="/policy" aria-current="page"><Icon name="folder" />项目申报</a>
        <a href="/salary/"><Icon name="salary" />工资表</a>
      </nav>
    </aside>
    <section className="app-content">
      <header className="app-header"><button className="menu-button" aria-label="展开菜单"><Icon name="menu" /></button><label className="global-search"><Icon name="search" /><input value={query} onChange={event => {setQuery(event.target.value);setPage(1);}} placeholder="搜索标题、正文、条件、部门或附件" /><kbd>/</kbd></label></header>
      <div className="application-body">
        <div className="page-intro"><div><h1>政府项目申报</h1><p>苏州溯驭、杭州溯驭、连云港溯驭的具体申报事项。企业条件未确认的项目单独标注。</p></div></div>
        <h2 className="application-section-title" id="application-scope">可申报</h2>
        <div className="tabs application-tabs" aria-labelledby="application-scope"><button className={tab === "all" ? "active" : ""} aria-pressed={tab === "all"} onClick={() => {setTab("all");setPage(1);}}>本区全部</button><button className={tab === "selected" ? "active" : ""} aria-pressed={tab === "selected"} onClick={() => {setTab("selected");setPage(1);}}>收藏 <b>{selected.filter(id => allItems.some(item => item.id === id)).length}</b></button></div>
        <label className="region-filter">地区筛选<select value={region} onChange={event => {setRegion(event.target.value);setPage(1);}}><option>全部地区</option>{regions.map(item => <option key={item}>{item}</option>)}</select></label>
        {loading && <p className="coverage-note" role="status">正在读取项目…</p>}
        {loadError && <p role="alert" className="coverage-note">项目数据读取失败，请刷新重试。</p>}
        <div className="project-table">
          <div className="table-head"><span>项目名称及判定</span><span>支持方式</span><span>时间状态</span><span>查看原文</span><span>操作</span></div>
          {pagination.items.map((policy: DisplayPolicy) => {
            const timing = timeInfo(policy);
            const effective = effectiveDisposition(policy);
            const sourceHref = safeSourceHref(policy);
            const reasons = asStringList(cardReasons(decisionReason(policy)));
            const notes = qualificationNotes(policy);
            return <article className={`project-row disposition-${policy.disposition}`} key={policy.id} title={sourceHref ? "双击查阅来源（未核实记录请先核对原文）" : "原文地址待定位"} onDoubleClick={() => { if (sourceHref) window.location.assign(sourceHref); }}>
              <div className="project-name"><div>
                <div className="project-title-line"><h2>{policy.title}</h2>{newIds.includes(policy.id) && <span className="new-project-badge" aria-label="新加入项目">新</span>}</div>
                <span className="record-kind">{effective === 'eligible' ? '已核验可申报' : effective === 'upcoming' ? '即将开放 · 企业条件请核实' : '企业资格／申报窗口待核实'}</span>
                {reasons.length > 0 && <div className="decision-reasons" aria-label="匹配依据">{reasons.map(reason => <span key={reason}>{reason}</span>)}</div>}
                <details className="qualification-details" onDoubleClick={event => event.stopPropagation()}>
                  <summary>查看企业条件与核查缺口</summary>
                  <ul className="company-fit-list" aria-label="三家企业适配情况">{companyFitItems(policy).map(c => <li key={c.id}><strong>{c.name}</strong><span className={`company-fit-status ${c.status}`} title={c.description} aria-label={c.description}>{c.label}</span></li>)}</ul>
                  {notes.length > 0 && <ul>{notes.map(note => <li key={note}>{note}</li>)}</ul>}
                  {policy.filterReason && <p>{policy.filterReason}</p>}
                </details>
              </div></div>
              <div className="support-cell">{supportItems(policy).map(item => <span key={item}>{item}</span>)}</div>
              <div className={`time-cell ${timing.label ? "" : "empty-time"}`}>{timing.label && <span className={`deadline-cell ${timing.tone}`}>{timing.label}</span>}{timing.date && <small>{timing.date}{timing.time ? ` ${timing.time}` : ""}</small>}</div>
              {sourceHref ? <a className="source-link" href={sourceHref} target="_blank" rel="noopener noreferrer">{policy.linkHealth?.status === "unavailable" ? "查阅原文（历史副本）" : "查阅原文与附件"}</a> : <span className="view-only">原文地址待定位</span>}
              {selected.includes(policy.id) ? <button className="remove-button" onClick={() => updateSelected(policy.id, false)}>取消收藏</button> : <button className="select-button" onClick={() => updateSelected(policy.id, true)} aria-label="收藏项目"><Icon name="plus" /></button>}
            </article>;
          })}
          {!items.length && !loading && !loadError && <div className="empty-projects">{query ? <>没有符合搜索条件的项目。<button onClick={clearSearch}>清空搜索</button></> : tab === 'selected' ? '暂无收藏的有效申报项目。' : '当前暂无已收录的有效申报项目，仍需继续核查。'}</div>}
        </div>
        <nav className="policy-pagination" aria-label="记录分页"><button disabled={pagination.page <= 1} onClick={()=>setPage(pagination.page-1)}>上一页</button><span>第 {pagination.page} / {pagination.pages} 页 · 共 {pagination.total} 条 · 每页 30 条</span><button disabled={pagination.page >= pagination.pages} onClick={()=>setPage(pagination.page+1)}>下一页</button></nav>
        {!loading && feed.updatedAt && <p className="policy-update-note">{feed.refreshMode === 'cached_reassessment' ? '规则重算于（非重新联网核验）' : '数据更新于'} {formatDate(feed.updatedAt)}{feed.coverage?.status === 'partial' ? ' · 来源与企业条件仍在核查中' : ''}</p>}
      </div>
    </section>
  </main>;
}
