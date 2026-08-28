"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";

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
    combination: string;
    salary: string;
    dimension_ledger: string;
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

const PYODIDE_INDEX = "https://cdn.jsdelivr.net/pyodide/v0.28.2/full/";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
// 规则文件在浏览器启动时从静态目录加载。版本参数保证规则更新后不会继续
// 使用浏览器已缓存的旧 engine.py / rules.yaml。
const RULE_PACKAGE_REVISION = "20260828-cost-rules-v7";
const initialInputs: InputSet = { files: [] };

function money(value: string | number | undefined) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parsed);
}

function ensurePyodideScript() {
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
    script.src = `${PYODIDE_INDEX}pyodide.js`;
    script.async = true;
    script.dataset.pyodideLoader = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Python runtime download failed."));
    document.head.appendChild(script);
  });
}

async function copyAsset(pyodide: PyodideLike, url: string, destination: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load required rule asset: ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  pyodide.FS.writeFile(destination, bytes);
}

async function initializeEngine(): Promise<PyodideLike> {
  await ensurePyodideScript();
  if (!window.loadPyodide) throw new Error("Python runtime loader is unavailable.");
  const pyodide = await window.loadPyodide({ indexURL: PYODIDE_INDEX });
  pyodide.FS.mkdirTree("/app/rule_packages/rd_cost_workflow_v1/templates");
  pyodide.FS.mkdirTree("/app/rule_packages/rd_hours_v1");
  pyodide.FS.mkdirTree("/work");

  await copyAsset(pyodide, `/py/rd_cost_workflow_v1/engine.py?rev=${RULE_PACKAGE_REVISION}`, "/app/rule_packages/rd_cost_workflow_v1/engine.py");
  await copyAsset(pyodide, `/py/rd_cost_workflow_v1/rules.yaml?rev=${RULE_PACKAGE_REVISION}`, "/app/rule_packages/rd_cost_workflow_v1/rules.yaml");
  await copyAsset(pyodide, `/py/rd_hours_v1/engine.py?rev=${RULE_PACKAGE_REVISION}`, "/app/rule_packages/rd_hours_v1/engine.py");
  await copyAsset(pyodide, `/py/rd_hours_v1/rules.yaml?rev=${RULE_PACKAGE_REVISION}`, "/app/rule_packages/rd_hours_v1/rules.yaml");
  await copyAsset(pyodide, "/py/output_template.xlsx", "/app/rule_packages/rd_cost_workflow_v1/templates/研发成本输出模板.xlsx");
  await copyAsset(pyodide, "/py/vendor.zip", "/app/vendor.zip");
  await pyodide.runPythonAsync(`
import sys
sys.path.insert(0, "/app/vendor.zip")
sys.path.insert(0, "/app/rule_packages")
import openpyxl
import yaml
`);
  return pyodide;
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
  const [phase, setPhase] = useState<"loading" | "ready" | "running" | "error">("loading");
  const [message, setMessage] = useState("正在准备本地测算环境…首次使用约需下载浏览器运行环境。");
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const engine = useRef<PyodideLike | null>(null);

  useEffect(() => {
    let cancelled = false;
    initializeEngine()
      .then((runtime) => {
        if (cancelled) return;
        engine.current = runtime;
        setPhase("ready");
        setMessage("本地测算环境已就绪。文件只在当前浏览器中处理，不会上传到服务器。");
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setPhase("error");
        setMessage(`无法加载本地测算环境：${error.message}`);
      });
    return () => { cancelled = true; };
  }, []);

  const selectedFiles = inputs.files ?? [];
  const buttonDisabled = phase !== "ready" || !selectedFiles.length;
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
    setMessage(files.length ? `已选择 ${files.length} 份文件；开始测算时将按工作簿结构自动归类。` : "请至少选择一份 .xlsx 文件。");
  }

  async function runCalculation() {
    if (!engine.current || !selectedFiles.length) return;
    setPhase("running");
    setSummary(null);
    setMessage("正在浏览器本地读取 Excel、计算工时、直接人工和费用分配…");
    try {
      for (const [index, file] of selectedFiles.entries()) {
        await writeInput(engine.current, file, `/work/input_${index + 1}.xlsx`);
      }
      const inputPaths = selectedFiles.map((_, index) => `Path("/work/input_${index + 1}.xlsx")`).join(",\n    ");
      const resultText = await engine.current.runPythonAsync(`
import json
from pathlib import Path
from rd_cost_workflow_v1.engine import build_output, classify_input_workbooks

classified = classify_input_workbooks([
    ${inputPaths}
])
result = build_output(
    classified["hours"],
    classified["combination"],
    classified["salary"],
    classified["dimension_ledger"],
    classified["expense_ledgers"],
    Path("/work/研发成本测算结果.xlsx"),
)
result["classified_paths"] = {
    "hours": str(classified["hours"]),
    "combination": str(classified["combination"]),
    "salary": str(classified["salary"]),
    "dimension_ledger": str(classified["dimension_ledger"]),
    "expense_ledgers": [str(path) for path in classified["expense_ledgers"]],
}
json.dumps(result, ensure_ascii=False, default=str)
`);
      const result = JSON.parse(String(resultText)) as RunSummary;
      const output = engine.current.FS.readFile("/work/研发成本测算结果.xlsx");
      const verificationText = await engine.current.runPythonAsync(`
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
      const blob = new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "研发成本测算结果_网页本地版.xlsx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setSummary(result);
      setPhase("ready");
      setMessage("测算完成，结果已自动下载；已复核31个固定模板工作表的名称和顺序。");
    } catch (error) {
      setPhase("error");
      const reason = error instanceof Error ? error.message : String(error);
      setMessage(`测算已停止：${reason}`);
    }
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand-mark">研</div>
        <div><p className="eyebrow">TEMPORARY LOCAL WORKBENCH</p><h1>研发成本测算操作台</h1></div>
        <div className={`runtime-state ${phase}`}><span />{phase === "ready" ? "本地引擎已就绪" : phase === "running" ? "正在计算" : phase === "error" ? "需要处理" : "正在加载"}</div>
      </header>

      <section className="hero">
        <div><p className="eyebrow">ONE-CLICK COST CALCULATION</p><h2>在浏览器中完成测算，<br />原始文件不会上传。</h2><p>沿用已锁定的工时、直接人工与其他费用规则；结果严格按固定模板另存为新 Excel 文件。</p></div>
        <div className="rule-card"><strong>已锁定的口径</strong><span>所有人员按已有项目工时比例分配公摊工时</span><span>核算维度明细账用于计算全部20类其他费用；费用明细账仅用于保留各费用页的原始明细</span><span>每张费用明细账写入对应模板页上方，项目分配表在同一页下方生成，金额显示两位小数</span></div>
      </section>

      <section className="workspace">
        <div className="step-heading"><span>01</span><div><h3>选择测算文件</h3><p>请使用 `.xlsx` 文件；每个文件不超过 20 MB。</p></div><b>{selectedCount} 份文件已选择</b></div>
        <div className="upload-grid">
          <label className="upload-card upload-card-wide"><span>上传全部测算文件</span><small>一次选择工时、项目组合、工资、核算维度及费用明细账。系统只根据工作表结构归类，不读取或限制文件名。</small><input type="file" accept=".xlsx" multiple onChange={selectFiles} /><FileChips files={selectedFiles} /></label>
        </div>
        <div className={`notice ${phase}`} role="status">{message}</div>
        <button className="run-button" type="button" disabled={buttonDisabled} onClick={runCalculation}>{phase === "running" ? "正在本地测算…" : "开始测算并下载结果"}</button>
        <p className="privacy">文件仅进入当前浏览器的临时计算区；刷新、关闭页面或下载完成后不会保留在网站。</p>
      </section>

      {summary && <section className="results"><div className="step-heading"><span>02</span><div><h3>本次测算结果</h3><p>导出前已完成工作表顺序复核。</p></div></div><div className="classified"><strong>已自动归类</strong><span>工时：{selectedFiles[Number(summary.classified_paths.hours.match(/input_(\d+)/)?.[1] ?? 0) - 1]?.name}　项目组合：{selectedFiles[Number(summary.classified_paths.combination.match(/input_(\d+)/)?.[1] ?? 0) - 1]?.name}　工资：{selectedFiles[Number(summary.classified_paths.salary.match(/input_(\d+)/)?.[1] ?? 0) - 1]?.name}　核算维度：{selectedFiles[Number(summary.classified_paths.dimension_ledger.match(/input_(\d+)/)?.[1] ?? 0) - 1]?.name}　费用明细：{summary.classified_paths.expense_ledgers.map((path) => selectedFiles[Number(path.match(/input_(\d+)/)?.[1] ?? 0) - 1]?.name).join("、")}</span></div><div className="metrics"><div><small>研发项目</small><strong>{summary.master_projects}</strong></div><div><small>直接人工</small><strong>¥ {money(summary.labor_total)}</strong></div><div><small>其他费用合计</small><strong>¥ {money(summary.other_total)}</strong></div><div><small>分类记录</small><strong>{summary.ledger_records}</strong></div></div>{summary.warnings?.length > 0 && <div className="warnings"><strong>需要关注</strong><ul>{summary.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>}</section>}

      <footer>临时本地测算操作台 · 浏览器端运行 · 不安装程序、不执行本地 EXE</footer>
    </main>
  );
}
