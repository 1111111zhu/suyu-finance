"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

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
const RULE_PACKAGE_REVISION = "20260831-cost-rules-v21";
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

export default function Home() {
  const [inputs, setInputs] = useState<InputSet>(initialInputs);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "running" | "error">("idle");
  const [message, setMessage] = useState("请选择需要测算的 .xlsx 文件；页面会在选择后准备本地运行环境。");
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const engine = useRef<PyodideLike | null>(null);
  const enginePromise = useRef<Promise<PyodideLike> | null>(null);

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

  return (
    <main>
      <header className="topbar">
        <div className="brand-mark">研</div>
        <div><p className="eyebrow">TEMPORARY LOCAL WORKBENCH</p><h1>研发成本测算操作台</h1></div>
        <nav className="primary-nav"><a className="active" href="/">研发成本测算</a><a href="/policy">政策申报雷达</a><a href="/salary/">自动算薪</a></nav>
        <div className={`runtime-state ${phase}`}><span />{phase === "idle" ? "等待选择文件" : phase === "ready" ? "本地引擎已就绪" : phase === "running" ? "正在计算" : phase === "error" ? "需要处理" : "正在加载"}</div>
      </header>

      <section className="hero">
        <div><p className="eyebrow">ONE-CLICK COST CALCULATION</p><h2>在浏览器中完成测算，<br />原始文件不会上传。</h2><p>沿用已锁定的工时、直接人工与其他费用规则；结果严格按固定模板另存为新 Excel 文件。</p></div>
        <div className="rule-card"><strong>已锁定的口径</strong><span>所有人员按已有项目工时比例分配公摊工时，同时回填工时汇总、RD工时和公摊RD工时</span><span>核算维度与科目组合表在总测算中自动整理，并逐行写入项目分类明细汇总表</span><span>费用明细账是可选的，仅用于保留各费用页的原始明细，不替代核算维度金额</span><span>所有费用分配表只回填固定模板原预留区，不移动表块、工作表或合并单元格</span></div>
      </section>

      <section className="module-switcher" aria-label="独立验证模块">
        <div><p className="eyebrow">INDEPENDENT VALIDATION MODULE</p><h3>自动算薪系统</h3><p>独立验证 9 张源表、字段映射、工资计算与工资条输出流程；不读取或修改研发成本测算数据。</p></div>
        <a href="/salary/" className="module-link">进入自动算薪验证 <span>↗</span></a>
      </section>

      <section className="workspace">
        <div className="step-heading"><span>01</span><div><h3>选择测算文件</h3><p>请使用 `.xlsx` 文件；每个文件不超过 20 MB。</p></div><b>{selectedCount} 份文件已选择</b></div>
        <div className="upload-grid">
          <label className="upload-card upload-card-wide"><span>上传全部测算文件</span><small>选择工时、工资、核算维度与科目组合文件；费用明细账可选。组合表会在总结果中自动复制并整理表头；文件名只作关键词提示，最终仍按工作表结构校验。</small><input type="file" accept=".xlsx" multiple onChange={selectFiles} /><FileChips files={selectedFiles} /></label>
        </div>
        <div className={`notice ${phase}`} role="status">{message}</div>
        <button className="run-button" type="button" disabled={buttonDisabled} onClick={runCalculation}>{phase === "running" ? "正在本地测算…" : "开始测算并下载结果"}</button>
        <p className="privacy">文件仅进入当前浏览器的临时计算区；刷新、关闭页面或下载完成后不会保留在网站。</p>
      </section>

      {summary && <section className="results"><div className="step-heading"><span>02</span><div><h3>本次测算结果</h3><p>导出前已完成工作表顺序复核。</p></div></div><div className="classified"><strong>已自动归类</strong><span>工时：{inputNameFromPath(summary.classified_paths.hours, selectedFiles)}　工资：{inputNameFromPath(summary.classified_paths.salary, selectedFiles)}　核算维度：{classifiedNames(summary.classified_paths.dimension_ledger, selectedFiles)}　费用明细：{summary.classified_paths.expense_ledgers.length ? summary.classified_paths.expense_ledgers.map((path) => inputNameFromPath(path, selectedFiles)).join("、") : "未上传（不影响费用分配）"}</span></div><div className="metrics"><div><small>研发项目</small><strong>{summary.master_projects}</strong></div><div><small>直接人工</small><strong>¥ {money(summary.labor_total)}</strong></div><div><small>运费</small><strong>¥ {money(summary.freight_total)}</strong></div><div><small>其他费用合计</small><strong>¥ {money(summary.other_total)}</strong></div><div><small>分类记录</small><strong>{summary.ledger_records}</strong></div></div>{summary.warnings?.length > 0 && <div className="warnings"><strong>需要关注</strong><ul>{summary.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{restoreInputNames(warning, selectedFiles)}</li>)}</ul></div>}</section>}

      <footer>临时本地测算操作台 · 浏览器端运行 · 不安装程序、不执行本地 EXE</footer>
    </main>
  );
}
