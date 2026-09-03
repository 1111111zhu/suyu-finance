"use client";

import { ChangeEvent, DragEvent, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import brandMark from "../design_mockups/brand/seeextech-symbol-user.png";

type PyodideLike = {
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
  };
  runPythonAsync(code: string): Promise<unknown>;
};
declare global {
  interface Window {
    loadPyodide?: (config: { indexURL: string }) => Promise<PyodideLike>;
  }
}
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const REVISION = "20260902-application-candidates-v22";
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
const ShieldIcon = () => (
  <Icon>
    <path d="M12 2.5 20 6v5.8c0 5.3-3.4 8.8-8 10.7-4.6-1.9-8-5.4-8-10.7V6l8-3.5Z" />
    <path d="m8.5 12.3 2.2 2.2 4.8-5" />
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
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "loading" | "ready" | "running" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [complete, setComplete] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const engine = useRef<PyodideLike | null>(null);
  const enginePromise = useRef<Promise<PyodideLike> | null>(null);
  const detected = kinds(files);
  const ready =
    detected.salary && detected.hours && detected.ledger && detected.balance;
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
    setFiles(combined);
    setComplete(false);
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
        setMessage("文件已在本地识别。请补充所有待上传资料后开始测算。");
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
  }
  async function run() {
    if (!ready) return;
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
      await runtime.runPythonAsync(
        `from pathlib import Path\nfrom rd_cost_workflow_v1.engine import build_output, classify_input_workbooks\nclassified = classify_input_workbooks([${paths.join(",")}])\nbuild_output(classified["hours"], classified["salary"], classified["dimension_ledger"], classified["expense_ledgers"], Path("/work/研发成本测算结果.xlsx"))`,
      );
      const blob = new Blob(
        [runtime.FS.readFile("/work/研发成本测算结果.xlsx")],
        {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "研发成本测算结果_网页本地版.xlsx";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPhase("ready");
      setComplete(true);
      setMessage("测算完成，结果已下载。");
    } catch (error) {
      setPhase("error");
      setMessage(
        error instanceof Error
          ? `测算已停止：${error.message}`
          : "测算已停止，请检查上传文件。",
      );
    }
  }
  const displayName = (card: { key: Kind; name: string }) =>
    card.key === "balance" ? (
      <h2 className="account-combination-title">科目组合表</h2>
    ) : (
      <h2>{card.name}</h2>
    );
  const cards: { key: Kind; name: string }[] = [
    { key: "salary", name: "工资表" },
    { key: "hours", name: "工时表" },
    { key: "ledger", name: "明细账" },
    { key: "balance", name: "科目组合表" },
  ];
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="溯驭财务首页">
          <Image
            className="brand-mark"
            src={brandMark}
            alt="SEEEx"
            priority
          />
          <strong>溯驭财务</strong>
        </Link>
        <nav className="main-nav" aria-label="主导航">
          <Link className="nav-item active" href="/" aria-current="page">
            <Icon>
              <path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
              <path d="M14 3v5h5M8 13h6M8 17h4" />
            </Icon>
            <span>研发费用</span>
          </Link>
          <Link className="nav-item" href="/policy">
            <Icon>
              <path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
              <path d="M14 3v5h5" />
            </Icon>
            <span>项目申报</span>
          </Link>
          <Link className="nav-item" href="/salary/">
            <Icon>
              <rect x="4" y="3" width="16" height="18" rx="2" />
              <circle cx="12" cy="9" r="2.2" />
              <path d="M7.5 17c.8-2 2.2-3 4.5-3s3.7 1 4.5 3" />
            </Icon>
            <span>工资表</span>
          </Link>
        </nav>
      </aside>
      <section className="content">
        <header className="topbar">
          <button className="menu-button" type="button" aria-label="菜单">
            <MenuIcon />
          </button>
          <div className="search">
            <SearchIcon />
            搜索项目、工时、费用、单据编号等<kbd>/</kbd>
          </div>
        </header>
        <div className="workspace">
          <h1 className="page-title">研发费用</h1>
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
                <span>支持多个 .xlsx 文件，单个文件 ≤ 20MB</span>
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
                    <div>{displayName(card)}</div>
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
            <button
              type="button"
              className="start-button"
              disabled={!ready || phase === "loading" || phase === "running"}
              onClick={run}
            >
              {phase === "running" ? "正在测算…" : "开始测算"}
            </button>
          </div>
          {message && <div className={`notice ${phase}`}>{message}</div>}
          {complete && (
            <div className="result">
              研发费用测算已完成，结果文件已保存至浏览器下载目录。
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
