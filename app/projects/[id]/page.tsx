"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { WorkbenchShell } from "../../rd-cost/workbench-shell";
import {
  deleteProject,
  getLedger,
  getProjects,
  type RdProject,
} from "../../rd-cost/rd-store";
import "../../rd-cost/rd-cost.css";
import "../projects.css";

const statusLabels: Record<RdProject["status"], string> = {
  init: "初始化",
  active: "进行中",
  completed: "已完成",
};

function statusClass(status: RdProject["status"]) {
  return status === "init" ? "ui-badge--warning" : "ui-badge--success";
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const embedded = searchParams.get("embed") === "1";
  const suffix = embedded ? "?embed=1" : "";
  const [projects] = useState<RdProject[]>(() => getProjects());
  const [ledger] = useState(() => getLedger());
  const [message, setMessage] = useState("");
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const project = useMemo(() => projects.find((item) => item.id === id), [id, projects]);
  const projectLedger = useMemo(() => ledger.filter((entry) => entry.projectId === id), [id, ledger]);

  function removeProject() {
    if (!project) return;
    try {
      deleteProject(project.id);
      deleteDialog.current?.close();
      router.replace(`/projects${suffix}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败，请刷新后重试。");
    }
  }

  if (!project) return <WorkbenchShell><section className="ui-empty rd-project-empty"><h3>项目不存在</h3><p>它可能已在当前浏览器中删除。</p><Link className="ui-button ui-button--accent" href={`/projects${suffix}`}>返回项目管理</Link></section></WorkbenchShell>;

  const rate = project.budget ? project.actual / project.budget * 100 : 0;
  const updated = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(project.updatedAt));
  const calculateHref = `/rd-cost?${new URLSearchParams({ project: project.id, ...(embedded ? { embed: "1" } : {}) }).toString()}`;
  const scenarioHref = `/scenario/1${embedded ? "?embed=1" : ""}`;

  return <WorkbenchShell>
    <section className="rd-project-detail" aria-labelledby="project-detail-title">
      <Link className="ui-text-action rd-project-back" href={`/projects${suffix}`}>← 返回项目管理</Link>
      <div className="rd-projects-head rd-project-detail-head">
        <div>
          <div className="rd-project-title-line"><p className="rd-projects-kicker">{project.number}</p><span className={`ui-badge ${statusClass(project.status)}`}>{statusLabels[project.status]}</span></div>
          <h1 id="project-detail-title">{project.name}</h1>
          <p>查看本地归集的费用台账，继续测算或管理该研发项目。</p>
        </div>
        <div className="rd-project-detail-actions"><Link className="ui-button ui-button--ghost" href={scenarioHref}>AI 助手</Link><Link className="ui-button ui-button--accent" href={calculateHref}>开始测算</Link><button className="ui-button ui-button--danger" type="button" onClick={() => deleteDialog.current?.showModal()}>删除项目</button></div>
      </div>

      <div className="rd-project-summary-grid">
        <section className="ui-card rd-project-stat"><p>预算总额</p><strong>¥{project.budget.toLocaleString()}</strong></section>
        <section className="ui-card rd-project-stat"><p>已归集费用</p><strong>¥{project.actual.toLocaleString()}</strong></section>
        <section className="ui-card rd-project-stat"><p>预算执行率</p><strong>{rate.toFixed(1)}%</strong><div className="ui-progress" role="progressbar" aria-label="预算执行率" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(rate, 100)}><div className="ui-progress-fill" style={{ width: `${Math.min(100, Math.max(0, rate))}%` }} /></div></section>
        <section className="ui-card rd-project-stat"><p>台账记录</p><strong>{projectLedger.length}</strong><span>{rate > 80 ? "接近预算预警线" : "处于正常范围"}</span></section>
      </div>

      <section className="rd-project-information" aria-labelledby="project-information-title"><h2 id="project-information-title">项目基本信息</h2><dl className="ui-keyvalue"><div><dt>项目编号</dt><dd>{project.number}</dd></div><div><dt>项目状态</dt><dd>{statusLabels[project.status]}</dd></div><div><dt>最近更新</dt><dd>{updated}</dd></div></dl></section>

      <section className="ui-card rd-project-ledger" aria-labelledby="project-ledger-title"><div className="rd-project-section-head"><div><p className="rd-projects-kicker">LEDGER</p><h2 id="project-ledger-title">费用台账明细</h2></div><span className="ui-pill ui-pill--success">本地归集</span></div>{projectLedger.length ? <div className="ui-table-wrap"><table className="ui-table"><thead><tr><th>日期</th><th>费用类别</th><th>说明</th><th className="ui-numeric">金额</th><th>来源</th></tr></thead><tbody>{projectLedger.map((entry) => <tr key={entry.id}><td>{entry.date}</td><td>{entry.category}</td><td>{entry.description}</td><td className="ui-numeric">¥{entry.amount.toLocaleString()}</td><td><span className="ui-badge">{entry.source === "calculation" ? "测算入账" : entry.source === "import" ? "导入" : "手动"}</span></td></tr>)}</tbody></table></div> : <div className="ui-empty"><h3>暂无费用台账记录</h3><p>完成一次研发费用测算后，结果会自动归集到这里。</p><Link className="ui-button ui-button--accent" href={calculateHref}>开始测算</Link></div>}</section>

      <dialog className="ui-dialog rd-project-dialog" ref={deleteDialog} aria-labelledby="delete-project-title">
        <div className="ui-dialog-head"><div><p className="rd-dialog-kicker rd-dialog-kicker-danger">IRREVERSIBLE</p><h2 id="delete-project-title">删除项目？</h2></div><button className="ui-button ui-button--ghost ui-button--icon" type="button" aria-label="关闭删除项目对话框" onClick={() => deleteDialog.current?.close()}>×</button></div>
        <div className="ui-dialog-body"><p className="rd-dialog-description">将删除 <strong>{project.number} · {project.name}</strong>，以及该项目下的所有本地费用台账记录。此操作无法撤销。</p>{message && <p className="ui-field-error" role="alert">{message}</p>}</div>
        <div className="ui-dialog-footer"><button className="ui-button ui-button--ghost" type="button" onClick={() => deleteDialog.current?.close()}>取消</button><button className="ui-button ui-button--danger" type="button" onClick={removeProject}>确认删除</button></div>
      </dialog>
    </section>
  </WorkbenchShell>;
}
