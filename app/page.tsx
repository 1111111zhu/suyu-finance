"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

type InputSet = {
  hours: File | null;
  combination: File | null;
  salary: File | null;
  ledgers: File[];
};

type RunSummary = {
  month: number;
  master_projects: number;
  salary_total: string;
  labor_total: string;
  freight_total: string;
  ledger_records: number;
  warnings: string[];
  output_sheets: string[];
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
const initialInputs: InputSet = { hours: null, combination: null, salary: null, ledgers: [] };

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

  await copyAsset(pyodide, "/py/rd_cost_workflow_v1/engine.py", "/app/rule_packages/rd_cost_workflow_v1/engine.py");
  await copyAsset(pyodide, "/py/rd_hours_v1/engine.py", "/app/rule_packages/rd_hours_v1/engine.py");
  await copyAsset(pyodide, "/py/rd_hours_v1/rules.yaml", "/app/rule_packages/rd_hours_v1/rules.yaml");
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

function FileChip({ file }: { file: File | null }) {
  if (!file) return <span className="file-empty">未选择</span>;
  return <span className="file-chip" title={file.name}>{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</span>;
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

  const allInputsReady = Boolean(inputs.hours && inputs.combination && inputs.salary);
  const buttonDisabled = phase !== "ready" || !allInputsReady;
  const selectedCount = useMemo(() => [inputs.hours, inputs.combination, inputs.salary].filter(Boolean).length + inputs.ledgers.length, [inputs]);

  function selectOne(slot: "hours" | "combination" | "salary") {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      if (file && file.size > MAX_FILE_BYTES) {
        setMessage(`${file.name} 超过 20 MB 限制。`);
        return;
      }
      setInputs((current) => ({ ...current, [slot]: file }));
      setSummary(null);
    };
  }

  function selectLedgers(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const oversized = files.find((file) => file.size > MAX_FILE_BYTES);
    if (oversized) {
      setMessage(`${oversized.name} 超过 20 MB 限制。`);
      return;
    }
    setInputs((current) => ({ ...current, ledgers: files }));
    setSummary(null);
  }

  async function runCalculation() {
    if (!engine.current || !inputs.hours || !inputs.combination || !inputs.salary) return;
    setPhase("running");
    setSummary(null);
    setMessage("正在浏览器本地读取 Excel、计算工时、直接人工和费用分配…");
    try {
      await writeInput(engine.current, inputs.hours, "/work/hours.xlsx");
      await writeInput(engine.current, inputs.combination, "/work/combination.xlsx");
      await writeInput(engine.current, inputs.salary, "/work/salary.xlsx");
      const ledgerPaths: string[] = [];
      for (const [index, file] of inputs.ledgers.entries()) {
        const path = `/work/ledger_${index + 1}.xlsx`;
        await writeInput(engine.current, file, path);
        ledgerPaths.push(path);
      }
      engine.current.globals.set("ledger_paths_json", JSON.stringify(ledgerPaths));
      const resultText = await engine.current.runPythonAsync(`
import json
from pathlib import Path
from rd_cost_workflow_v1.engine import build_output

result = build_output(
    Path("/work/hours.xlsx"),
    Path("/work/combination.xlsx"),
    Path("/work/salary.xlsx"),
    [Path(path) for path in json.loads(ledger_paths_json)],
    Path("/work/研发成本测算结果.xlsx"),
)
json.dumps(result, ensure_ascii=False, default=str)
`);
      engine.current.globals.delete("ledger_paths_json");
      const result = JSON.parse(String(resultText)) as RunSummary;
      const output = engine.current.FS.readFile("/work/研发成本测算结果.xlsx");
      const verification = XLSX.read(output, { type: "array" });
      if (!verification.SheetNames.includes("2.直接人工")) throw new Error("导出复核失败：缺少“2.直接人工”工作表。");
      if (verification.SheetNames.at(-1) !== "2.直接人工") throw new Error("导出复核失败：“2.直接人工”不是最后一张工作表。");
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
      setMessage("测算完成，结果已自动下载；导出文件已重新读取并确认“2.直接人工”为最后一个工作表。");
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
        <div><p className="eyebrow">ONE-CLICK COST CALCULATION</p><h2>在浏览器中完成测算，<br />原始文件不会上传。</h2><p>沿用已锁定的工时、公摊、直接人工与明细账追加分配表规则。结果另存为新的 Excel 文件。</p></div>
        <div className="rule-card"><strong>已锁定的口径</strong><span>所有人员按已有项目工时比例分配公摊工时</span><span>原始明细账保留，并在账下追加项目分配表</span><span>“2.直接人工”固定为结果末页</span></div>
      </section>

      <section className="workspace">
        <div className="step-heading"><span>01</span><div><h3>选择测算文件</h3><p>请使用 `.xlsx` 文件；每个文件不超过 20 MB。</p></div><b>{selectedCount} 份文件已选择</b></div>
        <div className="upload-grid">
          <label className="upload-card"><span>工时表</span><small>姓名、月份总工时与连续 RD 项目列</small><input type="file" accept=".xlsx" onChange={selectOne("hours")} /><FileChip file={inputs.hours} /></label>
          <label className="upload-card"><span>项目组合表</span><small>核算维度与科目组合、项目主数据</small><input type="file" accept=".xlsx" onChange={selectOne("combination")} /><FileChip file={inputs.combination} /></label>
          <label className="upload-card"><span>工资表</span><small>人员姓名与当月工资费用</small><input type="file" accept=".xlsx" onChange={selectOne("salary")} /><FileChip file={inputs.salary} /></label>
          <label className="upload-card ledgers"><span>核算维度明细账（可选）</span><small>如有原始费用账可多选；需含摘要、借方、贷方</small><input type="file" accept=".xlsx" multiple onChange={selectLedgers} />{inputs.ledgers.length ? <span className="file-chip">已选择 {inputs.ledgers.length} 份明细账</span> : <span className="file-empty">未选择：仅测算工时和直接人工</span>}</label>
        </div>
        <div className={`notice ${phase}`} role="status">{message}</div>
        <button className="run-button" type="button" disabled={buttonDisabled} onClick={runCalculation}>{phase === "running" ? "正在本地测算…" : "开始测算并下载结果"}</button>
        <p className="privacy">文件仅进入当前浏览器的临时计算区；刷新、关闭页面或下载完成后不会保留在网站。</p>
      </section>

      {summary && <section className="results"><div className="step-heading"><span>02</span><div><h3>本次测算结果</h3><p>导出前已完成工作表顺序复核。</p></div></div><div className="metrics"><div><small>研发项目</small><strong>{summary.master_projects}</strong></div><div><small>直接人工</small><strong>¥ {money(summary.labor_total)}</strong></div><div><small>运费结果</small><strong>¥ {money(summary.freight_total)}</strong></div><div><small>明细记录</small><strong>{summary.ledger_records}</strong></div></div>{summary.warnings?.length > 0 && <div className="warnings"><strong>需要关注</strong><ul>{summary.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>}</section>}

      <footer>临时本地测算操作台 · 浏览器端运行 · 不安装程序、不执行本地 EXE</footer>
    </main>
  );
}
