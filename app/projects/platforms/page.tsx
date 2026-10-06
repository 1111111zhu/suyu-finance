"use client";

import {useAccess} from "../../use-access";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkbenchShell } from "../../rd-cost/workbench-shell";
import { listPlatforms, listProjects, type RdPlatform, type RdProject } from "../../rd-cost/rd-client";
import { ManagementDialog, TrashIcon, type ManagementRequest } from "../management";
import "../../rd-cost/rd-cost.css";
import "../projects.css";
import "../management.css";

const money = (amount: number) => `¥${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const statusLabels: Record<RdProject["status"], string> = { init: "待开始", active: "进行中", paused: "暂停", stopped: "停止", completed: "已完成" };

export default function PlatformManagementPage() {
  const access=useAccess();

  const params = useSearchParams();
  const platformId = params.get("platform") || "all";
  const embedded = params.get("embed") === "1";
  const [platforms, setPlatforms] = useState<RdPlatform[]>([]);
  const [projects, setProjects] = useState<RdProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [modal, setModal] = useState<ManagementRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  const suffix = embedded ? "?embed=1" : "";
  const platformUrl = (id = "all") => {
    const next = new URLSearchParams(embedded ? { embed: "1" } : {});
    if (id !== "all") next.set("platform", id);
    const search = next.toString();
    return `/projects/platforms${search ? `?${search}` : ""}`;
  };

  const reload = useCallback(async () => {
    try {
      const [nextPlatforms, nextProjects] = await Promise.all([listPlatforms(), listProjects()]);
      if (live.current) { setPlatforms(nextPlatforms); setProjects(nextProjects); setError(""); }
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : "平台数据读取失败。");
    } finally {
      if (live.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    live.current = true;
    const initial = window.setTimeout(() => void reload(), 0);
    return () => { window.clearTimeout(initial); live.current = false; };
  }, [reload]);

  const selected = platforms.find((platform) => platform.id === platformId);
  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return projects.filter((project) => {
      const platform = platforms.find((item) => item.id === project.platformId);
      const matchesText = !normalized || `${project.number} ${project.name} ${platform?.name || ""}`.toLocaleLowerCase().includes(normalized);
      return (platformId === "all" || project.platformId === platformId) && (status === "all" || project.status === status) && matchesText;
    });
  }, [platformId, platforms, projects, query, status]);

  const shownTotal = visibleProjects.reduce((sum, project) => sum + project.actual, 0);
  const hasFilters = Boolean(query || status !== "all" || platformId !== "all");

  return <WorkbenchShell><section className="rd-projects rd-platform-management" aria-labelledby="platform-management-title">
    <div className="rd-projects-head"><div><p className="rd-projects-kicker">RESEARCH PROJECTS</p><h1 id="platform-management-title">项目管理</h1><p>按平台筛选研发项目；平台仅作为横向筛选条件，不再以卡片形式管理。</p></div>
      <div className="rd-management-actions"><Link className="ui-button ui-button--ghost" href={`/projects${suffix}`}>研发项目总览</Link>{access.manager&&<Link className="ui-button ui-button--accent" href={`/rd-cost${suffix}`}>上传研发费用</Link>}
        {access.manager&&<button className="ui-button ui-button--ghost ui-button--icon" type="button" title="回收站" aria-label="打开回收站" disabled={busy} onClick={() => setModal({ mode: "trash" })}><TrashIcon /></button>}
        {access.manager&&<button className="ui-button ui-button--ghost" type="button" disabled={busy} onClick={() => setModal({ mode: "create", kind: "platform" })}>＋ 增加平台</button>}
      </div>
    </div>
    {access.loaded&&!access.manager&&<p className="rd-project-empty-note">当前为研发汇总只读权限，新增及管理由经理处理。</p>}
    {loading && <p role="status">正在读取平台与项目…</p>}
    {error && <div role="alert"><p className="ui-field-error">{error}</p><button className="ui-button ui-button--ghost" type="button" onClick={() => void reload()}>重新读取</button></div>}
    {!loading && !error && <>
      <section className="rd-platform-filter" aria-label="按平台筛选项目">
        <div className="rd-platform-filter-head"><div><p className="rd-projects-kicker">PLATFORM FILTER</p><h2>选择平台</h2></div><p>左右滑动查看全部平台</p></div>
        <div className="rd-platform-rail" role="list" aria-label="平台列表">
          <Link className={`rd-platform-option ${platformId === "all" ? "is-active" : ""}`} role="listitem" aria-current={platformId === "all" ? "page" : undefined} href={platformUrl()}><span>全部项目</span><strong>{projects.length} 个</strong></Link>
          {platforms.map((platform) => <div className={`rd-platform-option ${platform.id === platformId ? "is-active" : ""}`} role="listitem" key={platform.id}>
            <Link href={platformUrl(platform.id)} aria-current={platform.id === platformId ? "page" : undefined}><small>{platform.number || "平台编码待补充"}</small><span>{platform.name}</span><strong>{platform.projectCount} 个项目</strong></Link>
            {access.manager && platform.id === platformId && <button className="ui-button ui-button--ghost ui-button--sm" type="button" disabled={busy} aria-label={`管理平台：${platform.name}`} onClick={() => setModal({ mode: "menu", kind: "platform", item: platform })}>管理</button>}
          </div>)}
          {!platforms.length && <p className="rd-platform-rail-empty">尚未建立平台，请先增加平台。</p>}
        </div>
      </section>

      <section className="rd-platform-projects" aria-labelledby="platform-project-list-title">
        <div className="rd-platform-projects-head"><div><p className="rd-projects-kicker">PROJECT CARDS</p><h2 id="platform-project-list-title">{selected ? selected.name : "全部研发项目"}</h2><p>{visibleProjects.length} 个项目 · 已归集 {money(shownTotal)}</p></div>
          <div className="rd-management-actions"><label className="rd-platform-search">搜索项目<input className="ui-input" type="search" placeholder="项目名称或编码" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label className="rd-platform-status">状态<select className="ui-input" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {access.manager && selected && <button className="ui-button ui-button--accent" type="button" disabled={busy} onClick={() => setModal({ mode: "create", kind: "project", platformId: selected.id, platformName: selected.name })}>＋ 增加项目</button>}
          </div>
        </div>
        {visibleProjects.length ? <div className="rd-project-grid rd-platform-project-grid">{visibleProjects.map((project) => {
          const platform = platforms.find((item) => item.id === project.platformId);
          const rate = project.budget ? project.actual / project.budget * 100 : 0;
          return <article className="rd-project-card rd-platform-project-card" key={project.id}><Link className="rd-platform-project-main" href={`/projects/${project.id}${suffix}`}><div className="rd-project-card-top"><span className="rd-project-number">{project.number}</span><span className={`ui-badge ${project.status === "active" ? "ui-badge--success" : project.status === "stopped" ? "ui-badge--danger" : "ui-badge--warning"}`}>{statusLabels[project.status]}</span></div><h3>{project.name}</h3><p className="rd-project-card-platform">{platform?.number ? `${platform.number} · ` : ""}{platform?.name || "平台待确认"}</p><div className="rd-project-card-finance"><span>累计费用<strong>{money(project.actual)}</strong></span><span>预算<strong>{money(project.budget)}</strong></span></div><div className="ui-progress" role="progressbar" aria-label="预算执行率" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, rate))}><div className="ui-progress-fill" style={{ width: `${Math.min(100, Math.max(0, rate))}%` }} /></div><p className="rd-project-card-dates">{project.startDate || "起始日期待补"} — {project.endDate || "结束日期待补"}</p></Link><div className="rd-project-card-actions"><Link className="ui-text-action" href={`/projects/${project.id}${suffix}`}>查看项目 →</Link>{access.manager&&<button className="ui-button ui-button--ghost ui-button--sm" type="button" disabled={busy} aria-label={`管理项目：${project.name}`} onClick={() => setModal({ mode: "menu", kind: "project", item: project })}>管理</button>}</div></article>;
        })}</div> : <div className="ui-empty rd-platform-empty"><h3>{projects.length ? "没有符合条件的项目" : "还没有研发项目"}</h3><p>{hasFilters ? "调整平台、状态或搜索条件后重试。" : "选择平台后可直接增加首个项目。"}</p>{hasFilters && <button className="ui-button ui-button--ghost" type="button" onClick={() => { setQuery(""); setStatus("all"); }}>清除项目筛选</button>}</div>}
      </section>
    </>}
    {access.manager && modal && <ManagementDialog request={modal} onClose={() => setModal(null)} onBusy={setBusy} onMutated={async () => { await reload(); }} />}
  </section></WorkbenchShell>;
}
