"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- Vinext production navigation requires full-page anchors. */

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import "./rd-cost.css";
import { WorkbenchShell } from "./workbench-shell";
import { confirmProjectBatch, listProjects, type RdProject, type CalculationBatch } from "./rd-client";

type PyodideLike = {
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
  };
  runPythonAsync(code: string): Promise<unknown>;
  toJs?: (options?: { dict_converter?: (value: unknown) => unknown }) => unknown;
};
declare global {
  interface Window {
    loadPyodide?: (config: { indexURL: string }) => Promise<PyodideLike>;
  }
}
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("归档文件读取失败，未确认入账。"));
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result.slice(reader.result.indexOf(",") + 1))
      : reject(new Error("归档文件读取失败。"));
    reader.readAsDataURL(blob);
  });
}
const money = (value: number) => `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const REVISION = "20260921-project-cost-matrix-v23";
const PYODIDE_INDEXES = [
  "https://unpkg.com/pyodide@0.28.2/",
  "https://cdn.jsdelivr.net/pyodide/v0.28.2/full/",
];

const Icon = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    {children}
  </svg>
);
const MenuIcon = () => (
  <Icon>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);
const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
);
const CloudIcon = () => (
  <Icon className="upload-cloud">
    <path d="M7.5 18.5H6a4.5 4.5 0 1 1 1.1-8.86A6 6 0 0 1 18.55 11 3.75 3.75 0 1 1 18 18.5h-1.5" />
    <path d="M12 21V10m0 0-3.5 3.5M12 10l3.5 3.5" />
  </Icon>
);
const CheckIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" />
    <path d="m8.5 12 2.3 2.3 4.7-5" stroke="#fff" strokeWidth="2.2" />
  </Icon>
);
const ClockIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7v5l3.2 2" />
  </Icon>
);
const ExcelIcon = () => (
  <svg className="excel-icon" viewBox="0 0 64 70" aria-label="Excel 文件">
    <path
      d="M9 1h34l14 14v49a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V6a5 5 0 0 1 5-5Z"
      fill="#dff5e8"
    />
    <path d="M43 1v14h14Z" fill="#fff" />
    <path d="M8 18h36v45H8a4 4 0 0 1-4-4V22a4 4 0 0 1 4-4Z" fill="#0a9f5a" />
    <path
      d="m14 29 7 11-7 11h7l4-7 4 7h7l-7-11 7-11h-7l-4 7-4-7Z"
      fill="#fff"
    />
  </svg>
);

type Kind = "salary" | "hours" | "ledger" | "balance";
const patterns: Record<Kind, RegExp> = {
  salary: /(工资|薪酬|薪资|工资表)/,
  hours: /(工时|考勤)/,
  ledger: /(明细账|明细帐|费用明细|序时账)/,
  balance: /科目/,
};
function kinds(files: File[]) {
  return Object.fromEntries(
    (Object.keys(patterns) as Kind[]).map((kind) => [
      kind,
      files.some((file) => patterns[kind].test(file.name.toLowerCase())),
    ]),
  ) as Record<Kind, boolean>;
}
function filesFor(kind: Kind, files: File[]) {
  return files.filter((file) => patterns[kind].test(file.name.toLowerCase()));
}
function ensureLoader(indexUrl: string) {
  return new Promise<void>((resolve, reject) => {
    if (window.loadPyodide) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-pyodide]",
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("运行环境加载失败")),
        { once: true },
      );
      return;
    }
    const script = document.createElement("script");
    script.src = `${indexUrl}pyodide.js`;
    script.dataset.pyodide = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("运行环境加载失败"));
    document.head.appendChild(script);
  });
}
async function copy(pyodide: PyodideLike, source: string, destination: string) {
  const response = await fetch(source);
  if (!response.ok) throw new Error("规则文件加载失败");
  pyodide.FS.writeFile(
    destination,
    new Uint8Array(await response.arrayBuffer()),
  );
}
async function initEngine() {
  let last: unknown;
  for (const indexUrl of PYODIDE_INDEXES) {
    try {
      await ensureLoader(indexUrl);
      if (!window.loadPyodide) throw new Error("运行环境不可用");
      const pyodide = await window.loadPyodide({ indexURL: indexUrl });
      pyodide.FS.mkdirTree("/app/rule_packages/rd_cost_workflow_v1/templates");
      pyodide.FS.mkdirTree("/app/rule_packages/rd_hours_v1");
      pyodide.FS.mkdirTree("/work");
      await Promise.all([
        copy(
          pyodide,
          `/py/rd_cost_workflow_v1/engine.py?rev=${REVISION}`,
          "/app/rule_packages/rd_cost_workflow_v1/engine.py",
        ),
        copy(
          pyodide,
          `/py/rd_cost_workflow_v1/rules.yaml?rev=${REVISION}`,
          "/app/rule_packages/rd_cost_workflow_v1/rules.yaml",
        ),
        copy(
          pyodide,
          `/py/rd_hours_v1/engine.py?rev=${REVISION}`,
          "/app/rule_packages/rd_hours_v1/engine.py",
        ),
        copy(
          pyodide,
          `/py/rd_hours_v1/rules.yaml?rev=${REVISION}`,
          "/app/rule_packages/rd_hours_v1/rules.yaml",
        ),
        copy(
          pyodide,
          `/py/output_template.xlsx?rev=${REVISION}`,
          "/app/rule_packages/rd_cost_workflow_v1/templates/研发成本输出模板.xlsx",
        ),
        copy(pyodide, `/py/vendor.zip?rev=${REVISION}`, "/app/vendor.zip"),
      ]);
      await pyodide.runPythonAsync(
        'import sys; sys.path.insert(0, "/app/vendor.zip"); sys.path.insert(0, "/app/rule_packages"); import openpyxl; import yaml',
      );
      return pyodide;
    } catch (error) {
      last = error;
      delete window.loadPyodide;
      document.querySelector("script[data-pyodide]")?.remove();
    }
  }
  throw last instanceof Error ? last : new Error("本地运行环境加载失败");
}

export default function Home() {
  const searchParams = useSearchParams();
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "loading" | "ready" | "running" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [complete, setComplete] = useState(false);
  const [projects, setProjects] = useState<RdProject[]>([]);
  const [projectsError, setProjectsError] = useState("");
  const [accountingYear,setAccountingYear]=useState(new Date().getFullYear());
  const [accountingScope,setAccountingScope]=useState("苏州");
  const [bookedProjects,setBookedProjects]=useState(0);
  const [bookedPlatformOnly,setBookedPlatformOnly]=useState(0);
  const [bookedPlatformAmount,setBookedPlatformAmount]=useState("0.00");
  const [report, setReport] = useState<{ labor:number; material:number; freight:number; other:number; total:number; month:number } | null>(null);
  const [pendingBatch,setPendingBatch]=useState<CalculationBatch|null>(null);
  const [outputWorkbook,setOutputWorkbook]=useState<Blob|null>(null);
  const [reviewing,setReviewing]=useState(false);
  const input = useRef<HTMLInputElement>(null);
  const engine = useRef<PyodideLike | null>(null);
  const enginePromise = useRef<Promise<PyodideLike> | null>(null);
  const detected = kinds(files);
  const ready = detected.salary && detected.hours && detected.balance;

  useEffect(() => {
    let active = true;
    listProjects()
      .then((nextProjects) => {
        if (!active) return;
        setProjects(nextProjects);
      })
      .catch((error) => { if (active) setProjectsError(error instanceof Error ? error.message : "项目数据加载失败。"); });
    return () => { active = false; };
  }, [searchParams]);

  function prepare() {
    if (!enginePromise.current)
      enginePromise.current = initEngine()
        .then((runtime) => {
          engine.current = runtime;
          return runtime;
        })
        .catch((error) => {
          enginePromise.current = null;
          throw error;
        });
    return enginePromise.current;
  }
  function choose(next: File[]) {
    const over = next.find((file) => file.size > MAX_FILE_BYTES);
    if (over) {
      setPhase("error");
      setMessage(`${over.name} 超过 20 MB 限制。`);
      return;
    }
    const combined = [...files, ...next].filter(
      (file, index, all) =>
        all.findIndex(
          (item) =>
            item.name === file.name &&
            item.size === file.size &&
            item.lastModified === file.lastModified,
        ) === index,
    );
    if (combined.length > 20 || combined.reduce((sum, file) => sum + file.size, 0) > MAX_SOURCE_BYTES) {
      setPhase("error");
      setMessage("每批最多 20 个文件，来源文件合计不能超过 30 MB。请拆分资料后重试。");
      return;
    }
    setFiles(combined);
    setComplete(false);
    setPendingBatch(null);
    setOutputWorkbook(null);
    if (!combined.length) {
      setPhase("idle");
      setMessage("");
      return;
    }
    setPhase("loading");
    setMessage("正在准备本地测算环境…");
    prepare()
      .then(() => {
        setPhase("ready");
        setMessage("文件已在本地识别。必需资料为工资表、工时表和科目余额表；明细账可选。");
      })
      .catch((error) => {
        setPhase("error");
        setMessage(
          error instanceof Error ? error.message : "本地运行环境加载失败",
        );
      });
  }
  function onChange(event: ChangeEvent<HTMLInputElement>) {
    choose(Array.from(event.target.files ?? []));
  }
  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    choose(Array.from(event.dataTransfer.files));
  }
  function removeFile(file: File) {
    setFiles((current) =>
      current.filter(
        (item) =>
          !(
            item.name === file.name &&
            item.size === file.size &&
            item.lastModified === file.lastModified
          ),
      ),
    );
    setComplete(false);
    setPendingBatch(null);
    setOutputWorkbook(null);
  }
  async function run() {
    if (!ready || !projects.length || !accountingScope.trim()) return;
    setPhase("running");
    setComplete(false);
    setMessage("正在浏览器本地读取 Excel、计算研发费用…");
    try {
      const runtime = engine.current ?? (await prepare());
      const paths: string[] = [];
      for (const [index, file] of files.entries()) {
        const target = `/work/input_${index + 1}.xlsx`;
        runtime.FS.writeFile(target, new Uint8Array(await file.arrayBuffer()));
        paths.push(`Path(${JSON.stringify(target)})`);
      }
      const raw = await runtime.runPythonAsync(
        `from pathlib import Path\nimport json\nfrom rd_cost_workflow_v1.engine import build_output, classify_input_workbooks\nclassified = classify_input_workbooks([${paths.join(",")}])\nresult = build_output(classified["hours"], classified["salary"], classified["dimension_ledger"], classified["expense_ledgers"], Path("/work/研发成本测算结果.xlsx"), accounting_year=${accountingYear})\njson.dumps(result, ensure_ascii=False, default=str)`,
      );
      if (typeof raw !== "string") throw new Error("未取得逐项目计算结果，未入账。");
      const value = JSON.parse(raw);
      if (value.period_years?.length>1) throw new Error("上传明细包含多个会计年度，请按年度分批测算。");
      if (value.year && value.year!==accountingYear) throw new Error(`上传明细年度为 ${value.year}，请将核算年度改为 ${value.year} 后重新测算。`);
      const costs=(value.project_costs as CalculationBatch["projects"]).flatMap(p=>p.costs);
      const categoryTotal=(category:string)=>costs.filter(c=>c.category===category).reduce((s,c)=>s+Math.round(Number(c.amount)*100),0)/100;
      const total=Number(value.cost_total),labor=categoryTotal("人员人工（含社保+公积金）"),material=categoryTotal("直接材料"),freight=categoryTotal("运费");
      const summary = { labor, material, freight, other:Math.round((total-labor-material-freight)*100)/100, total, month:Number(value.month) };
      setReport(summary);
      const evidence=await Promise.all(files.map(async file=>({name:file.name,sha256:Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer())),b=>b.toString(16).padStart(2,"0")).join("")})));
      const batch:CalculationBatch={requestKey:crypto.randomUUID(),scope:accountingScope.trim(),year:accountingYear,month:Number(value.month),total:value.cost_total,projects:value.project_costs,files:evidence};
      const blob = new Blob(
        [new Uint8Array(runtime.FS.readFile("/work/研发成本测算结果.xlsx")).buffer],
        {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      );
      setPendingBatch(batch);
      setOutputWorkbook(blob);
      setPhase("ready");
      setComplete(false);
      setMessage("测算已完成，金额尚未入账。请逐项目复核后确认。");
    } catch (error) {
      setPhase("error");
      setMessage(
        error instanceof Error
          ? `测算已停止：${error.message}`
          : "测算已停止，请检查上传文件。",
      );
    }
  }
  async function confirmRun(){
    if(!pendingBatch||!outputWorkbook||reviewing)return;
    setReviewing(true);setPhase("running");setMessage("正在确认项目与平台费用归属…");
    try{
      const resultFile={filename:`研发成本测算结果_${pendingBatch.year}-${String(pendingBatch.month).padStart(2,"0")}.xlsx`,base64:await blobBase64(outputWorkbook)};
      const sourceFiles=await Promise.all(files.map(async (file,index)=>({name:file.name,sha256:pendingBatch.files[index].sha256,base64:await blobBase64(file)})));
      const confirmed=await confirmProjectBatch({...pendingBatch,resultFile,sourceFiles});
      setBookedProjects(confirmed.projectCount);
      setBookedPlatformOnly(confirmed.platformOnlyCount);
      setBookedPlatformAmount(confirmed.platformOnlyTotal);
      const url=URL.createObjectURL(outputWorkbook),link=document.createElement("a");link.href=url;link.download=`研发成本测算结果_${pendingBatch.year}-${String(pendingBatch.month).padStart(2,"0")}.xlsx`;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
      setPendingBatch(null);setOutputWorkbook(null);setPhase("ready");setComplete(true);setMessage("已确认入账，已归档原始资料和模板结果文件，并保留本次确认版本。");
    }catch(error){setPhase("error");setMessage(error instanceof Error?`确认未完成：${error.message}`:"确认未完成，请重试。");}
    finally{setReviewing(false);}
  }
  const displayName = (card: { key: Kind; name: string; description: string }) =>
    card.key === "balance" ? (
      <>
        <h2 className="account-combination-title">科目余额表</h2>
        <p>{card.description}</p>
      </>
    ) : (
      <>
        <h2>{card.name}</h2>
        <p>{card.description}</p>
      </>
    );
  const cards: { key: Kind; name: string; description: string; required:boolean }[] = [
    { key: "salary", name: "工资表", description: "研发人员的工资及薪酬发放明细", required:true },
    { key: "hours", name: "工时表", description: "研发人员的工时记录及投入明细", required:true },
    { key: "ledger", name: "明细账", description: "可选：补充凭证明细", required:false },
    { key: "balance", name: "科目余额表", description: "费用金额的主要来源", required:true },
  ];
  return (
    <WorkbenchShell>
      <div className="rd-cost-page">
        <div className="workspace">
          <div className="rd-page-head"><div><h1 className="page-title">研发费用测算</h1><p className="page-description">按项目编码自动归集研发费用，平台金额同步汇总</p>{projectsError && <p className="ui-field-error" role="alert">{projectsError}</p>}</div><a className="rd-btn" href={"/projects"+(searchParams.get("embed")==="1"?"?embed=1":"")}>平台管理 →</a></div>
          <div className="rd-actions" style={{marginBottom:20}}><label>核算主体 <select className="rd-btn" value={accountingScope} onChange={e=>setAccountingScope(e.target.value)} disabled={phase==="running"}><option>苏州</option><option>杭州</option><option>连云港</option></select></label><label>核算年度 <input className="rd-btn" aria-label="核算年度" type="number" min="2000" max="2100" value={accountingYear} onChange={e=>setAccountingYear(Number(e.target.value))} disabled={phase==="running"} style={{width:110}}/></label><span>不同月份累加；同一主体、同一月份重新确认时替换该月结果。</span></div>
        <div className="rd-stepper"><div className="rd-step active"><small>01 · PREPARE</small><strong>准备资料</strong></div><div className="rd-step"><small>02 · RECOGNIZE</small><strong>本地识别</strong></div><div className="rd-step"><small>03 · CALCULATE</small><strong>费用测算</strong></div><div className={`rd-step ${complete?"active":""}`}><small>04 · REVIEW</small><strong>人工复核与入账</strong></div></div>
          <label
            className={`dropzone ${dragging ? "dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              ref={input}
              type="file"
              accept=".xlsx"
              multiple
              onChange={onChange}
            />
            {files.length ? (
              <div className="upload-file-panel" aria-label="已选文件">
                <strong>已选择 {files.length} 份文件</strong>
                <div className="upload-file-scroll">
                  {files.map((file) => (
                    <div
                      className="upload-file-row"
                      key={`${file.name}-${file.lastModified}`}
                    >
                      <span title={file.name}>{file.name}</span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          removeFile(file);
                        }}
                        aria-label={`删除 ${file.name}`}
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
                <small>点击空白区域或拖入文件可继续添加</small>
              </div>
            ) : (
              <>
                <CloudIcon />
                <strong>点击选择或将文件拖入此处</strong>
                <span>工资表、工时表、科目余额表必需；明细账可不传。单个文件 ≤ 20MB</span>
              </>
            )}
          </label>
          <div className="document-grid">
            {cards.map((card) => {
              const uploaded = detected[card.key];
              return (
                <article
                  className={`document-card ${uploaded ? "uploaded" : ""}`}
                  key={card.key}
                >
                  <div className="document-card-top">
                    <ExcelIcon />
                    <div>{displayName(card)}<span className={`rd-required-tag ${card.required?"required":"optional"}`}>{card.required?"必需":"可选"}</span></div>
                  </div>
                  <div className="card-rule" />
                  <div className={`card-status ${uploaded ? "success" : ""}`}>
                    <span className="status-icon">
                      {uploaded ? <CheckIcon /> : <ClockIcon />}
                    </span>
                    {uploaded ? "已上传" : "待上传"}
                  </div>
                  <div
                    className={`card-file ${uploaded ? "has-file" : "pending-file"}`}
                  >
                    {uploaded && (
                      <div
                        className="card-file-panel"
                        aria-label={`${card.name}已上传文件`}
                      >
                        {filesFor(card.key, files).map((file) => (
                          <div
                            className="card-file-row"
                            key={`${file.name}-${file.lastModified}`}
                          >
                            <span title={file.name}>{file.name}</span>
                            <button
                              type="button"
                              className="remove-file-button"
                              onClick={() => removeFile(file)}
                              aria-label={`删除 ${file.name}`}
                            >
                              删除
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      className={uploaded ? "replace-button" : "upload-button"}
                      onClick={() => input.current?.click()}
                    >
                      {uploaded ? "添加文件" : "上传文件"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="page-footer">
            <p className="privacy">
              <Icon>
                <path d="M12 3 5 6v5c0 4.2 2.9 8 7 10 4.1-2 7-5.8 7-10V6z" fill="currentColor" stroke="none" />
                <path d="m9 12 2 2 4-4" />
              </Icon>
              原始 Excel 在当前浏览器本地计算；只有人工确认后，测算金额才写入研发数据库
            </p>
            <button
              type="button"
              className="start-button"
              disabled={!ready || !projects.length || phase === "loading" || phase === "running"}
              onClick={run}
            >
              {phase === "running" ? "正在测算…" : "开始测算"}
            </button>
          </div>
          {!projects.length && <div className="notice">请先在研发项目中建立项目并设置平台归属。</div>}
          {message && <div className={`notice ${phase}`}>{message}</div>}
          {pendingBatch&&<section className="rd-review-panel"><div className="rd-project-section-head"><div><p className="rd-projects-kicker">REVIEW BEFORE POSTING</p><h2>{pendingBatch.year} 年 {pendingBatch.month} 月测算复核</h2></div><strong className="rd-review-total">¥{Number(pendingBatch.total).toLocaleString("zh-CN",{minimumFractionDigits:2})}</strong></div><p>以下金额目前只是本地计算草稿。确认后，能匹配项目的费用计入项目；仅能确定平台的费用单列为平台直归费用，不分摊到具体项目。无法唯一确定平台时整批不入账；本月已有结果会被替换。</p><div className="rd-review-table-wrap"><table className="rd-review-table"><thead><tr><th>项目／平台编号</th><th>项目／平台名称</th><th className="numeric">金额合计</th><th>费用分类金额</th></tr></thead><tbody>{pendingBatch.projects.map(project=><tr key={project.code}><td>{project.code}</td><td>{project.name}</td><td className="numeric">¥{Number(project.total).toLocaleString("zh-CN",{minimumFractionDigits:2})}</td><td>{project.costs.filter(item=>Number(item.amount)!==0).map(item=>`${item.category} ${money(Number(item.amount))}`).join("；")||"无费用"}</td></tr>)}</tbody></table></div><div className="rd-review-actions"><button className="rd-btn" type="button" onClick={()=>{setPendingBatch(null);setOutputWorkbook(null);setMessage("已取消本次草稿，数据库未变更。");}} disabled={reviewing}>取消本次测算</button><button className="start-button" type="button" onClick={confirmRun} disabled={reviewing}>{reviewing?"正在确认…":"确认并入账"}</button></div></section>}
          {complete && (
            <div className="result">
              研发费用测算已完成，结果文件已下载。已归集到 {bookedProjects} 个具体项目{bookedPlatformOnly>0?`；另有 ${bookedPlatformOnly} 条无法匹配具体项目的费用 ${money(Number(bookedPlatformAmount))} 已直接计入对应平台总费用。`:"，平台金额已同步汇总。"}
              {report && <div className="rd-grid rd-grid-4" style={{marginTop:14}}>{[["直接人工",report.labor],["直接材料",report.material],["运费",report.freight],["其他费用（不含运费）",report.other],["研发费用合计",report.total],["测算月份",`${report.month} 月`]].map(([label,value])=><div key={label as string}><div className="rd-stat-label">{label}</div><strong>{typeof value === "number" ? `¥${value.toLocaleString("zh-CN",{minimumFractionDigits:2})}` : value}</strong></div>)}</div>}
            </div>
          )}
        </div>
      </div>
    </WorkbenchShell>
  );
}
