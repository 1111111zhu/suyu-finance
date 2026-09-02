"use client";

import { ChangeEvent, useRef, useState } from "react";

type InputSet = {
  files: File[];
};

type RunSummary = {
  month: number;
  master_projects: number;
  salary_total: string;
  labor_total: string;
  freight_total: string;
  other_total: string;
  ledger_records: number;
  warnings: string[];
  output_sheets: string[];
  classified_paths: {
    hours: string;
    salary: string;
    dimension_ledger: string | string[];
    expense_ledgers: string[];
  };
  application_candidates: ApplicationCandidate[];
};

type ApplicationCandidate = {
  project_code: string;
  project_name: string;
  sources: string[];
  hours: string;
  status: "已纳入" | "待确认";
  reason: string;
};

type PyodideLike = {
  FS: {
    mkdirTree: (path: string) => void;
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
  };
  globals: { set: (name: string, value: unknown) => void; delete: (name: string) => void };
  loadPackage: (name: string | string[]) => Promise<void>;
  runPythonAsync: (code: string) => Promise<unknown>;
};

declare global {
  interface Window {
    loadPyodide?: (config: { indexURL: string }) => Promise<PyodideLike>;
  }
}

const PYODIDE_INDEXES = [
  "https://unpkg.com/pyodide@0.28.2/",
  "https://cdn.jsdelivr.net/pyodide/v0.28.2/full/",
];
const MAX_FILE_BYTES = 20 * 1024 * 1024;
// 规则文件在浏览器启动时从静态目录加载。版本参数保证规则更新后不会继续
// 使用浏览器已缓存的旧 engine.py / rules.yaml。
// 每次规则包发布必须同步更新此值。浏览器会用它区分静态 Python
// 资源，避免页面升级后仍执行旧缓存中的规则脚本。
const RULE_PACKAGE_REVISION = "20260902-application-candidates-v22";
const initialInputs: InputSet = { files: [] };

function money(value: string | number | undefined) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parsed);
}

function restoreInputNames(message: string, files: File[]) {
  return message.replace(/input_(\d+)\.xlsx/g, (_, number: string) => {
    const original = files[Number(number) - 1]?.name;
    return original || `input_${number}.xlsx`;
  });
}

function inputNameFromPath(path: string, files: File[]) {
  return files[Number(path.match(/input_(\d+)/)?.[1] ?? 0) - 1]?.name || path;
}

function classifiedNames(paths: string | string[], files: File[]) {
  const values = Array.isArray(paths) ? paths : [paths];
  return values.map((path) => inputNameFromPath(path, files)).join("、");
}

function uploadedDocumentKinds(files: File[]) {
  const names = files.map((file) => file.name.toLowerCase());
  return {
    salary: names.some((name) => /(工资|薪酬|薪资|工资表)/.test(name)),
    hours: names.some((name) => /(工时|考勤)/.test(name)),
    ledger: names.some((name) => /(明细账|明细帐|费用明细|序时账)/.test(name)),
    balance: names.some((name) => /(科目余额|余额表|科目表)/.test(name)),
  };
}

function userFacingError(error: unknown, files: File[] = []) {
  const raw = error instanceof Error ? error.message : String(error);
  const ruleMarker = raw.lastIndexOf("RuleError:");
  const concise = ruleMarker >= 0
    ? raw.slice(ruleMarker + "RuleError:".length).trim()
    : raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? "未知错误";
  return restoreInputNames(concise, files);
}

function downloadWorkbook(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Safari may start the download after the click handler returns. Keep the
  // object URL alive briefly so the download is not cancelled prematurely.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ensurePyodideScript(indexUrl: string) {
  return new Promise<void>((resolve, reject) => {
    if (window.loadPyodide) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>("script[data-pyodide-loader]");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Python runtime download failed.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = `${indexUrl}pyodide.js`;
    script.async = true;
    script.dataset.pyodideLoader = "true";
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error("Python runtime download failed."));
    };
    document.head.appendChild(script);
  });
}

async function copyAsset(pyodide: PyodideLike, url: string, destination: string) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`Unable to load required rule asset: ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  pyodide.FS.writeFile(destination, bytes);
}

async function initializeEngine(): Promise<PyodideLike> {
  let lastError: unknown;
  for (const indexUrl of PYODIDE_INDEXES) {
    try {
      await ensurePyodideScript(indexUrl);
      if (!window.loadPyodide) throw new Error("Python runtime loader is unavailable.");
      const pyodide = await window.loadPyodide({ indexURL: indexUrl });
      pyodide.FS.mkdirTree("/app/rule_packages/rd_cost_workflow_v1/templates");
      pyodide.FS.mkdirTree("/app/rule_packages/rd_hours_v1");
      pyodide.FS.mkdirTree("/work");

      await copyAsset(pyodide, `/py/rd_cost_workflow_v1/engine.py?rev=${RULE_PACKAGE_REVISION}`, "/app/rule_packages/rd_cost_workflow_v1/engine.py");
      await copyAsset(pyodide, `/py/rd_cost_workflow_v1/rules.yaml?rev=${RULE_PACKAGE_REVISION}`, "/app/rule_packages/rd_cost_workflow_v1/rules.yaml");
      await copyAsset(pyodide, `/py/rd_hours_v1/engine.py?rev=${RULE_PACKAGE_REVISION}`, "/app/rule_packages/rd_hours_v1/engine.py");
      await copyAsset(pyodide, `/py/rd_hours_v1/rules.yaml?rev=${RULE_PACKAGE_REVISION}`, "/app/rule_packages/rd_hours_v1/rules.yaml");
      await copyAsset(pyodide, `/py/output_template.xlsx?rev=${RULE_PACKAGE_REVISION}`, "/app/rule_packages/rd_cost_workflow_v1/templates/研发成本输出模板.xlsx");
      await copyAsset(pyodide, `/py/vendor.zip?rev=${RULE_PACKAGE_REVISION}`, "/app/vendor.zip");
      await pyodide.runPythonAsync(`
import sys
sys.path.insert(0, "/app/vendor.zip")
sys.path.insert(0, "/app/rule_packages")
import openpyxl
import yaml
`);
      return pyodide;
    } catch (error) {
      lastError = error;
      // If a CDN was blocked, allow the next candidate to install its loader.
      delete window.loadPyodide;
      document.querySelector("script[data-pyodide-loader]")?.remove();
    }
  }
  throw new Error(`浏览器运行环境下载失败：${lastError instanceof Error ? lastError.message : "请检查网络连接"}`);
}

async function writeInput(pyodide: PyodideLike, file: File, destination: string) {
  pyodide.FS.writeFile(destination, new Uint8Array(await file.arrayBuffer()));
}

function FileChips({ files }: { files: File[] }) {
  if (!files.length) return <span className="file-empty">未选择</span>;
  return <div className="file-list">{files.map((file) => <span className="file-chip" key={`${file.name}-${file.lastModified}`} title={file.name}>{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</span>)}</div>;
}

function ApplicationView({ summary, returnToCost }: { summary: RunSummary | null; returnToCost: () => void }) {
  if (!summary) return <section className="application-view"><div className="application-head"><div><p className="eyebrow">PROJECT APPLICATION REVIEW</p><h1>项目申报候选池</h1><p>所有识别到的研发项目都会保留在候选池中，不再静默省略。</p></div></div><div className="empty-application"><strong>尚未生成申报候选</strong><p>请先完成一次研发费用资料识别；系统会带入工时、工资和核算维度中识别到的全部项目。</p><button className="clear-button" type="button" onClick={returnToCost}>去上传资料</button></div></section>;
  const included = summary.application_candidates.filter((item) => item.status === "已纳入").length;
  const pending = summary.application_candidates.length - included;
  return <section className="application-view"><div className="application-head"><div><p className="eyebrow">PROJECT APPLICATION REVIEW</p><h1>项目申报候选池</h1><p>按上传资料逐项追溯项目来源、台账纳入情况和需确认原因。</p></div><button className="clear-button" type="button" onClick={returnToCost}>返回研发费用</button></div><div className="application-summary"><div><small>已识别候选</small><strong>{summary.application_candidates.length}</strong></div><div><small>已纳入成本台账</small><strong>{included}</strong></div><div><small>待确认</small><strong>{pending}</strong></div></div><div className="traceability-note"><strong>不遗漏机制</strong><span>“待确认”只表示台账归集或固定模板槽位需要核对，不表示该项目不符合申报条件；每个未纳入台账的项目都会列出原因。</span></div><div className="candidate-list">{summary.application_candidates.map((item) => <article className="candidate-card" key={item.project_code}><div><h2>{item.project_name}</h2><p>{item.project_code} · 识别来源：{item.sources.join("、")}</p></div><span className={`candidate-status ${item.status === "已纳入" ? "included" : "review"}`}>{item.status}</span><div className="candidate-detail"><span>项目工时：{money(item.hours)} 小时</span><p>{item.reason}</p></div></article>)}</div></section>;
}

export default function Home() {
  const [inputs, setInputs] = useState<InputSet>(initialInputs);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "running" | "error">("idle");
  const [message, setMessage] = useState("请选择需要测算的 .xlsx 文件；页面会在选择后准备本地运行环境。");
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [activeView, setActiveView] = useState<"cost" | "application">("cost");
  const engine = useRef<PyodideLike | null>(null);
  const enginePromise = useRef<Promise<PyodideLike> | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  function prepareEngine() {
    if (!enginePromise.current) {
      enginePromise.current = initializeEngine()
        .then((runtime) => {
          engine.current = runtime;
          return runtime;
        })
        .catch((error) => {
          enginePromise.current = null;
          throw error;
        });
    }
    return enginePromise.current;
  }

  const selectedFiles = inputs.files ?? [];
  const buttonDisabled = phase === "loading" || phase === "running" || !selectedFiles.length;
  const selectedCount = selectedFiles.length;
  const uploadedKinds = uploadedDocumentKinds(selectedFiles);

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const tooLarge = files.find((file) => file.size > MAX_FILE_BYTES);
    if (tooLarge) {
      setMessage(`${tooLarge.name} 超过 20 MB 限制。`);
      return;
    }
    setInputs({ files });
    setSummary(null);
    if (!files.length) {
      setPhase("idle");
      setMessage("请至少选择一份 .xlsx 文件。");
      return;
    }
    if (engine.current) {
      setPhase("ready");
      setMessage(`已选择 ${files.length} 份文件；本地测算环境已就绪。`);
      return;
    }
    setPhase("loading");
    setMessage(`已选择 ${files.length} 份文件；正在准备本地测算环境，首次使用约需下载浏览器运行环境…`);
    prepareEngine()
      .then(() => {
        setPhase("ready");
        setMessage("本地测算环境已就绪。文件只在当前浏览器中处理，不会上传到服务器。");
      })
      .catch((error: Error) => {
        setPhase("error");
        setMessage(`无法加载本地测算环境：${error.message}。请检查网络后重试。`);
      });
  }

  async function runCalculation() {
    if (!selectedFiles.length) return;
    setPhase("running");
    setSummary(null);
    setMessage("正在浏览器本地读取 Excel、计算工时、直接人工和费用分配…");
    try {
      const runtime = engine.current ?? await prepareEngine();
      const inputDestinations: string[] = [];
      for (const [index, file] of selectedFiles.entries()) {
        // Avoid Unicode property escapes so older Safari versions can parse
        // the bundle before the page renders.
        const safeName = file.name.replace(/\.xlsx$/i, "").replace(/[^a-zA-Z0-9_.\-\u4e00-\u9fff]+/g, "_").slice(0, 80) || "workbook";
        const destination = `/work/input_${index + 1}__${safeName}.xlsx`;
        inputDestinations.push(destination);
        await writeInput(runtime, file, destination);
      }
      const inputPaths = inputDestinations.map((path) => `Path(${JSON.stringify(path)})`).join(",\n    ");
      const resultText = await runtime.runPythonAsync(`
import json
from pathlib import Path
from rd_cost_workflow_v1.engine import build_output, classify_input_workbooks

classified = classify_input_workbooks([
    ${inputPaths}
])
dimension_source = classified["dimension_ledger"]
result = build_output(
    classified["hours"],
    classified["salary"],
    dimension_source,
    classified["expense_ledgers"],
    Path("/work/研发成本测算结果.xlsx"),
)
result["classified_paths"] = {
    "hours": str(classified["hours"]),
    "salary": str(classified["salary"]),
    "dimension_ledger": [str(path) for path in dimension_source] if isinstance(dimension_source, list) else str(dimension_source),
    "expense_ledgers": [str(path) for path in classified["expense_ledgers"]],
}
json.dumps(result, ensure_ascii=False, default=str)
`);
      const result = JSON.parse(String(resultText)) as RunSummary;
      const output = runtime.FS.readFile("/work/研发成本测算结果.xlsx");
      const verificationText = await runtime.runPythonAsync(`
import json
from openpyxl import load_workbook
verification_book = load_workbook("/work/研发成本测算结果.xlsx", read_only=True, data_only=False)
json.dumps(verification_book.sheetnames, ensure_ascii=False)
`);
      const sheetNames = JSON.parse(String(verificationText)) as string[];
      if (JSON.stringify(sheetNames) !== JSON.stringify(result.output_sheets)) {
        throw new Error("导出复核失败：工作表清单、顺序或名称与固定模板不一致。");
      }
      if (sheetNames.length !== 31) throw new Error("导出复核失败：固定模板应保留31个工作表。");
      downloadWorkbook(output, "研发成本测算结果_网页本地版.xlsx");
      setSummary(result);
      setPhase("ready");
      setMessage("测算完成，结果已自动下载；已复核31个固定模板工作表的名称和顺序。");
    } catch (error) {
      setPhase("error");
      const reason = userFacingError(error, selectedFiles);
      setMessage(`测算已停止：${reason}`);
    }
  }

  function clearFiles() {
    setInputs(initialInputs);
    setSummary(null);
    setPhase(engine.current ? "ready" : "idle");
    setMessage("请上传工资表、工时表、明细账和科目余额表。");
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <main className="app-shell">
      <aside className="sidebar"><div className="brand"><div className="brand-mark">研</div><div><strong>研发智能体</strong><span>R&amp;D AGENT</span></div></div><nav aria-label="主导航"><p className="nav-label">工作台</p><button className={`nav-item ${activeView === "cost" ? "active" : ""}`} type="button" onClick={() => setActiveView("cost")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V8.5A2.5 2.5 0 0 1 6.5 6H9l1.4-2h3.2L15 6h2.5A2.5 2.5 0 0 1 20 8.5V19a1 1 0 0 1-1 1H5a1 1 0 0 0-1-1Z"/><path d="M8 11h8M8 15h5"/></svg><span>研发费用</span></button><button className={`nav-item ${activeView === "application" ? "active" : ""}`} type="button" onClick={() => setActiveView("application")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M8 13h7M8 17h5"/></svg><span>项目申报</span></button></nav><div className="sidebar-foot"><div className={`status-dot ${phase}`} /><div><strong>{phase === "running" ? "正在测算" : phase === "loading" ? "正在准备" : phase === "error" ? "需要检查" : "本地安全模式"}</strong><span>文件不上传服务器</span></div></div></aside>
      <div className="content">
        <header className="topbar"><div><span>研发智能体</span><b>/</b><strong>{activeView === "cost" ? "研发费用" : "项目申报"}</strong></div><div className="top-actions"><button type="button" aria-label="帮助">?</button><span className="avatar">RD</span></div></header>
        {activeView === "cost" ? <><section className="workspace" id="upload">
          <div className="card-head"><div className="step-number">01</div><div><h2>上传测算资料</h2><p>支持批量选择 Excel 文件，单个文件不超过 20 MB</p></div><span className="file-count">{selectedCount ? `已选 ${selectedCount} 份` : "待上传"}</span></div>
          <label className="dropzone"><input ref={fileInput} type="file" accept=".xlsx" multiple onChange={selectFiles} /><span className="dropzone-placeholder">请上传工资表、工时表、明细账、科目余额表</span><span className="upload-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg></span><strong>点击选择或将文件拖入此处</strong><span>可一次选择多份 .xlsx 文件</span>{!selectedCount && <em>选择文件</em>}{!!selectedCount && <div className="selected-files"><FileChips files={selectedFiles} /></div>}</label>
          <div className="upload-hint"><div className="hint-title"><span>i</span><div><strong>请上传以下测算资料</strong><p>上传后对应资料项会自动点亮。</p></div></div><div className="document-list">{[
            { name: "工资表", detail: "人员工资及所属部门", uploaded: uploadedKinds.salary },
            { name: "工时表", detail: "研发人员项目工时", uploaded: uploadedKinds.hours },
            { name: "明细账", detail: "费用发生明细", uploaded: uploadedKinds.ledger },
            { name: "科目余额表", detail: "期间科目余额", uploaded: uploadedKinds.balance },
          ].map((item, index) => <div className={item.uploaded ? "uploaded" : ""} key={item.name}><span>{item.uploaded ? "✓" : String(index + 1).padStart(2, "0")}</span><strong>{item.name}</strong><small>{item.uploaded ? "已识别" : item.detail}</small></div>)}</div></div>
          <div className={`notice ${phase}`} role="status"><span />{message}</div>
          <div className="card-actions"><div><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-5"/></svg>文件仅用于当前测算，关闭页面后自动清除</div><div className="button-row">{!!selectedCount && <button className="clear-button" type="button" onClick={clearFiles}>清空文件</button>}<button className="run-button" type="button" disabled={buttonDisabled} onClick={runCalculation}>{phase === "running" ? "正在测算…" : "开始测算"}<span>→</span></button></div></div>
        </section>
        {summary && <section className="results"><div className="card-head"><div className="step-number done">✓</div><div><h2>测算完成</h2><p>结果已下载，并完成固定模板结构复核。</p></div></div><div className="metrics"><div><small>研发项目</small><strong>{summary.master_projects}</strong></div><div><small>直接人工</small><strong>¥ {money(summary.labor_total)}</strong></div><div><small>其他费用</small><strong>¥ {money(summary.other_total)}</strong></div><div><small>分类记录</small><strong>{summary.ledger_records}</strong></div></div>{summary.warnings?.length > 0 && <div className="warnings"><strong>需要关注</strong><ul>{summary.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{restoreInputNames(warning, selectedFiles)}</li>)}</ul></div>}</section>}</> : <ApplicationView summary={summary} returnToCost={() => setActiveView("cost")} />}
      </div>
    </main>
  );
}
