"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { WorkbenchShell } from "../rd-cost/workbench-shell";
import {
  createProject,
  deleteProject,
  getProjects,
  type RdProject,
} from "../rd-cost/rd-store";
import "../rd-cost/rd-cost.css";
import "./projects.css";

type ProjectForm = {
  number: string;
  name: string;
  budget: string;
  status: RdProject["status"];
};

type FormErrors = Partial<Record<keyof ProjectForm, string>>;

const emptyForm: ProjectForm = {
  number: "",
  name: "",
  budget: "",
  status: "init",
};

const statusLabels: Record<RdProject["status"], string> = {
  init: "初始化",
  active: "进行中",
  completed: "已完成",
};

function statusClass(status: RdProject["status"]) {
  return status === "init" ? "ui-badge--warning" : "ui-badge--success";
}

function progress(project: RdProject) {
  return project.budget ? Math.min(100, Math.max(0, project.actual / project.budget * 100)) : 0;
}

export default function ProjectsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const embedded = searchParams.get("embed") === "1";
  const suffix = embedded ? "?embed=1" : "";
  const [projects, setProjects] = useState<RdProject[]>(() => getProjects());
  const [form, setForm] = useState<ProjectForm>(emptyForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [pendingDelete, setPendingDelete] = useState<RdProject | null>(null);
  const [toast, setToast] = useState("");
  const createDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const projectNameInput = useRef<HTMLInputElement>(null);

  function announce(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3600);
  }

  function openCreateDialog() {
    setForm(emptyForm);
    setErrors({});
    createDialog.current?.showModal();
    window.setTimeout(() => projectNameInput.current?.focus(), 0);
  }

  function closeCreateDialog() {
    createDialog.current?.close();
  }

  function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: FormErrors = {};
    const budget = Number(form.budget);
    if (!form.name.trim()) nextErrors.name = "请填写项目名称。";
    if (!form.number.trim()) nextErrors.number = "请填写项目编号。";
    if (!form.budget.trim() || !Number.isFinite(budget) || budget < 0) {
      nextErrors.budget = "请填写大于或等于 0 的预算金额。";
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    try {
      const project = createProject({ ...form, budget });
      setProjects(getProjects());
      closeCreateDialog();
      announce(`已创建项目：${project.number}`);
      router.push(`/projects/${project.id}${suffix}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "项目创建失败，请稍后重试。";
      setErrors(message.includes("编号") ? { number: message } : { name: message });
    }
  }

  function requestDelete(project: RdProject) {
    setPendingDelete(project);
    deleteDialog.current?.showModal();
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    try {
      const project = deleteProject(pendingDelete.id);
      setProjects(getProjects());
      deleteDialog.current?.close();
      setPendingDelete(null);
      announce(`已删除项目及其费用台账：${project.number}`);
    } catch (error) {
      announce(error instanceof Error ? error.message : "删除失败，请刷新后重试。");
    }
  }

  return <WorkbenchShell>
    <section className="rd-projects" aria-labelledby="projects-title">
      <div className="rd-projects-head">
        <div>
          <p className="rd-projects-kicker">RESEARCH PROJECTS</p>
          <h1 id="projects-title">项目管理</h1>
          <p>维护浏览器本地的研发项目、预算和费用归集状态。</p>
        </div>
        <button className="ui-button ui-button--accent" type="button" onClick={openCreateDialog}>＋ 新建项目</button>
      </div>

      {projects.length ? <div className="rd-project-grid">
        {projects.map((project) => {
          const rate = progress(project);
          return <article className="rd-project-card" key={project.id}>
            <div className="rd-project-card-top">
              <span className="rd-project-symbol" aria-hidden="true">▣</span>
              <span className={`ui-badge ${statusClass(project.status)}`}>{statusLabels[project.status]}</span>
            </div>
            <Link className="rd-project-card-link" href={`/projects/${project.id}${suffix}`}>
              <p className="rd-project-number">{project.number}</p>
              <h2>{project.name}</h2>
              <div className="rd-project-metrics">
                <span>预算 <strong>¥{project.budget.toLocaleString()}</strong></span>
                <span>已归集 <strong>¥{project.actual.toLocaleString()}</strong></span>
              </div>
              <div className="rd-project-progress-meta"><span>预算执行率</span><strong>{rate.toFixed(1)}%</strong></div>
              <div className="ui-progress" aria-label={`${project.name}预算执行率 ${rate.toFixed(1)}%`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={rate}>
                <div className="ui-progress-fill" style={{ width: `${rate}%` }} />
              </div>
            </Link>
            <div className="rd-project-card-actions">
              <Link className="ui-text-action" href={`/projects/${project.id}${suffix}`}>打开项目明细 <span aria-hidden="true">→</span></Link>
              <button className="ui-button ui-button--ghost ui-button--sm rd-project-delete" type="button" onClick={() => requestDelete(project)}>删除</button>
            </div>
          </article>;
        })}
      </div> : <div className="ui-empty rd-project-empty">
        <h3>还没有研发项目</h3>
        <p>新建一个项目后，就能在研发费用测算中选择它并归集费用。</p>
        <button className="ui-button ui-button--accent" type="button" onClick={openCreateDialog}>新建首个项目</button>
      </div>}

      <dialog className="ui-dialog rd-project-dialog" ref={createDialog} aria-labelledby="create-project-title">
        <form onSubmit={submitProject}>
          <div className="ui-dialog-head"><div><p className="rd-dialog-kicker">BROWSER-LOCAL</p><h2 id="create-project-title">新建研发项目</h2></div><button className="ui-button ui-button--ghost ui-button--icon" type="button" aria-label="关闭新建项目对话框" onClick={closeCreateDialog}>×</button></div>
          <div className="ui-dialog-body rd-project-form">
            <p className="rd-dialog-description">项目信息仅保存在当前浏览器，可随时导出本地数据备份。</p>
            <label className="ui-field"><span>项目名称</span><input ref={projectNameInput} className="ui-input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "project-name-error" : undefined} placeholder="例如：高寒环境燃料电池研发" />{errors.name && <small className="ui-field-error" id="project-name-error">{errors.name}</small>}</label>
            <label className="ui-field"><span>项目编号</span><input className="ui-input" value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} aria-invalid={Boolean(errors.number)} aria-describedby={errors.number ? "project-number-error" : undefined} placeholder="例如：RD2026-003" />{errors.number && <small className="ui-field-error" id="project-number-error">{errors.number}</small>}</label>
            <div className="rd-project-form-row"><label className="ui-field"><span>预算金额（元）</span><input className="ui-input" inputMode="decimal" type="number" min="0" step="0.01" value={form.budget} onChange={(event) => setForm({ ...form, budget: event.target.value })} aria-invalid={Boolean(errors.budget)} aria-describedby={errors.budget ? "project-budget-error" : undefined} placeholder="0" />{errors.budget && <small className="ui-field-error" id="project-budget-error">{errors.budget}</small>}</label><label className="ui-field"><span>项目状态</span><select className="ui-select" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as RdProject["status"] })}><option value="init">初始化</option><option value="active">进行中</option><option value="completed">已完成</option></select></label></div>
          </div>
          <div className="ui-dialog-footer"><button className="ui-button ui-button--ghost" type="button" onClick={closeCreateDialog}>取消</button><button className="ui-button ui-button--accent" type="submit">创建项目</button></div>
        </form>
      </dialog>

      <dialog className="ui-dialog rd-project-dialog" ref={deleteDialog} aria-labelledby="delete-project-title" onClose={() => setPendingDelete(null)}>
        <div className="ui-dialog-head"><div><p className="rd-dialog-kicker rd-dialog-kicker-danger">IRREVERSIBLE</p><h2 id="delete-project-title">删除项目？</h2></div><button className="ui-button ui-button--ghost ui-button--icon" type="button" aria-label="关闭删除项目对话框" onClick={() => deleteDialog.current?.close()}>×</button></div>
        <div className="ui-dialog-body"><p className="rd-dialog-description">将删除 <strong>{pendingDelete?.number} · {pendingDelete?.name}</strong>，以及该项目下的所有本地费用台账记录。此操作无法撤销。</p></div>
        <div className="ui-dialog-footer"><button className="ui-button ui-button--ghost" type="button" onClick={() => deleteDialog.current?.close()}>取消</button><button className="ui-button ui-button--danger" type="button" onClick={confirmDelete}>确认删除</button></div>
      </dialog>

      {toast && <div className="ui-toast rd-project-toast" role="status">{toast}</div>}
    </section>
  </WorkbenchShell>;
}
