"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- Vinext production navigation requires full-page anchors. */

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import "./rd-cost.css";
import { ImageImport, type ImageRows, type ImageKind, type ImageImportHandle } from "./image-import";
import { WorkbenchShell } from "./workbench-shell";
import { listProjects, type RdProject } from "./rd-client";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_SOURCE_BYTES = 100 * MAX_FILE_BYTES;
const money = (value: number) => `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
export default function Home() {
  const searchParams = useSearchParams();
  const [files, setFiles] = useState<File[]>([]);
  const [originalImageFiles, setOriginalImageFiles] = useState<Record<string, File>>({});
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "loading" | "ready" | "running" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [complete, setComplete] = useState(false);
  const [projects, setProjects] = useState<RdProject[]>([]);
  const [projectsError, setProjectsError] = useState("");
  const [bookedProjects,setBookedProjects]=useState(0);
  const [bookedPlatformOnly,setBookedPlatformOnly]=useState(0);
  const [bookedPlatformAmount,setBookedPlatformAmount]=useState("0.00");
  const [report, setReport] = useState<{ labor:number; material:number; freight:number; other:number; total:number; month:number } | null>(null);
  const [downloads,setDownloads]=useState<{url:string;filename:string}[]>([]);
  const [pendingImages,setPendingImages]=useState(0);
  const input = useRef<HTMLInputElement>(null);
  const imageImport = useRef<ImageImportHandle>(null);

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

  async function confirmImage(rows: ImageRows, kind: ImageKind, image: File) {
    if (phase === "running") throw new Error("请等待当前测算完成。");
    setPhase("loading");
    setDownloads([]); setComplete(false);
    try {
    const text = (value: string | number | null) => String(value ?? "").replace(/\s/g, "");
    const projectCode = /^R[DC][0-9A-Z]+(?:-[0-9A-Z]+)*$/i;
    const headerIndex = rows.findIndex(row => row.some(cell => /^(姓名|人员姓名|员工姓名|人员名称|研发人员|费用项目|研发项目|科目代码|科目编码|借方|贷方|金额)$/.test(text(cell))));
    if (headerIndex >= 0) {
      const headers = rows[headerIndex].map(text);
      if (kind === "hours") {
        const projectHeaders = headers.filter(value => /^R[DC]/i.test(value) && !["RD工时", "公摊RD工时"].includes(value));
        if (projectHeaders.length < 2 || projectHeaders.some(value => !projectCode.test(value))) throw new Error("工时表需至少两个准确的 RD / RC 项目编码，例如 RD01、RD2026-01；请对照原图核对编码。");
        if (!rows.slice(0, 5).some(row => row.some(cell => /^([1-9]|1[0-2]|[一二三四五六七八九十]{1,3})月$/.test(text(cell))))) throw new Error("工时图片缺少明确月份，请补齐原图月份表头。");
      }
      if (kind === "salary" && !headers.some(value => /([1-9]|1[0-2]|[一二三四五六七八九十]{1,3})月工资费用/.test(value))) throw new Error("工资图片需保留明确的月份工资费用表头，例如 1月工资费用。");
      const nameColumn = headers.findIndex(value => /^(姓名|人员姓名|员工姓名|人员名称|研发人员)$/.test(value));
      const numericColumns = headers.flatMap((value, index) => {
        const numeric = kind === "hours" ? projectCode.test(value) || /^(工时汇总|工时合计|总工时|工时总计|RD工时|公摊RD工时|[一二三四五六七八九十0-9]+月)$/.test(value)
          : kind === "salary" ? /^(工资费用|工资|应发工资|实发工资|工资合计)$/.test(value) || value.includes("月工资费用")
          : /(金额|发生|借方|贷方)/.test(value);
        return numeric ? [index] : [];
      });
      for (let index = headerIndex + 1; index < rows.length; index++) {
        const row = rows[index];
        if (!row.some(cell => text(cell)) || (nameColumn >= 0 && /^(合计|总计|小计)$/.test(text(row[nameColumn])))) continue;
        if ((kind === "hours" || kind === "salary") && nameColumn >= 0 && !text(row[nameColumn])) {
          const projectColumns = headers.flatMap((value, column) => projectCode.test(value) ? [column] : []);
          const totalColumns = numericColumns.filter(column => !projectColumns.includes(column));
          const projectNameMetadata = kind === "hours" && index === headerIndex + 1 && projectColumns.length > 0
            && totalColumns.every(column => !text(row[column]))
            && projectColumns.every(column => text(row[column]) !== "" && !Number.isFinite(Number(text(row[column]))));
          if (projectNameMetadata) continue;
          throw new Error(`第 ${index + 1} 行有数据但姓名缺失，请对照原图补齐姓名。`);
        }
        if (kind === "ledger") {
          if (numericColumns.length && !numericColumns.some(column => text(row[column]) !== "" && Number.isFinite(Number(text(row[column]))))) throw new Error(`第 ${index + 1} 行缺少有效借贷金额，请对照原图填写。`);
        } else {
          for (const column of numericColumns) if (text(row[column]) === "" || !Number.isFinite(Number(text(row[column])))) throw new Error(`第 ${index + 1} 行“${headers[column]}”不是完整数值，请对照原图填写；不能用 0 代替未知值。`);
        }
      }
    }
    const labels = { hours: "工时", salary: "工资", balance: "科目", ledger: "明细账" };
    const response = await fetch("/api/rd/image-workbook", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rows,kind})});
    if (!response.ok) { const result=await response.json() as {error?:string}; throw new Error(result.error||"图片复核表格转换失败。"); }
    const workbookBlob=await response.blob();
    const id = crypto.randomUUID();
    const name = `${labels[kind]}_图片复核_${id.slice(0,8)}.xlsx`;
    const workbook = new File([workbookBlob], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const sources = [...files, image, workbook];
    if (files.length + 1 > 100 || sources.reduce((sum, file) => sum + file.size, 0) > MAX_SOURCE_BYTES) throw new Error("每批最多 100 份文件或图片，每份不能超过 50 MB。");
    setOriginalImageFiles(current => ({ ...current, [name]: new File([image], `原图_${id.slice(0,8)}_${image.name}`, { type: image.type }) }));
    choose([workbook]);
    } catch (error) {
      setPhase(files.length ? "ready" : "idle");
      throw error;
    }
  }
  function choose(next: File[]) {
    if (phase === "running") return;
    if (next.some(file => !/\.xlsx$/i.test(file.name))) {
      setMessage("请选择 .xlsx 文件或 PNG、JPEG、WebP 图片。");
      return;
    }
    const over = next.find((file) => file.size > MAX_FILE_BYTES);
    if (over) {
      setPhase("error");
      setMessage(`${over.name} 超过 50 MB 限制。`);
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
    if (combined.length > 100 || combined.reduce((sum, file) => sum + file.size, 0)  > MAX_SOURCE_BYTES) {
      setPhase("error");
      setMessage("每批最多 100 份文件或图片，每份最多 50 MB。");
      return;
    }
    setFiles(combined);
    setComplete(false);
    setDownloads([]);
    if (!combined.length) {
      setPhase("idle");
      setMessage("");
      return;
    }
    setPhase("ready");
    setMessage("资料已添加。点击开始测算后，服务器将计算、导出并归集费用。");
  }
  function onChange(event: ChangeEvent<HTMLInputElement>) {
    acceptUploads(Array.from(event.target.files ?? []));
    event.target.value = "";
  }
  function acceptUploads(next: File[]) {
    if (phase === "running" || phase === "loading") return;
    if (files.length + pendingImages + next.length > 100) { setMessage("每批最多 100 份文件或图片。"); return; }
    const oversized=next.find(file=>file.size>MAX_FILE_BYTES);
    if(oversized){setMessage(`${oversized.name} 超过 50 MB 限制。`);return;}
    const images = next.filter(file => file.type.startsWith("image/"));
    const workbooks = next.filter(file => !file.type.startsWith("image/"));
    if (images.length) imageImport.current?.accept(images);
    if (workbooks.length) choose(workbooks);
  }
  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    acceptUploads(Array.from(event.dataTransfer.files));
  }
  function removeFile(file: File) {
    if (phase === "running" || phase === "loading") return;
    setOriginalImageFiles(current => { const next = { ...current }; delete next[file.name]; return next; });
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
    setDownloads([]);
  }
  async function run() {
    if (!ready || !projects.length || pendingImages) return;
    setPhase("running");setComplete(false);setDownloads([]);
    try {
      async function jsonRequest(url:string,init?:RequestInit) {
        const response=await fetch(url,init);const payload=await response.json() as {id:string;status:string;error?:string;results:unknown};
        if(!response.ok)throw new Error(payload.error||"服务器处理失败。");return payload;
      }
      const job=await jsonRequest("/api/rd/compute",{method:"POST"});
      const url=`/api/rd/compute/${job.id}`;
      const sources=[...files.map(file=>({file,compute:true,derived:!!originalImageFiles[file.name]})),...Object.values(originalImageFiles).map(file=>({file,compute:false,derived:false}))];
      for(const [index,source] of sources.entries()) {
        setMessage(`正在上传资料 ${index+1} / ${sources.length}…`);
        await jsonRequest(url,{method:"PUT",headers:{"Content-Type":"application/octet-stream","X-File-Name":encodeURIComponent(source.file.name),"X-Compute":source.compute?"1":"0","X-Derived":source.derived?"1":"0"},body:source.file});
      }
      await jsonRequest(url,{method:"POST"});
      for(;;) {
        const result=await jsonRequest(url);
        if(result.status==="failed")throw new Error(result.error||"测算失败。");
        if(result.status==="complete") {
          const results=result.results as {month:number;total:string;projectCount:number;platformOnlyCount:number;platformOnlyTotal:string;filename:string;projects:{costs:{category:string;amount:string}[]}[]}[];
          setBookedProjects(results.reduce((sum,r)=>sum+r.projectCount,0));
          setBookedPlatformOnly(results.reduce((sum,r)=>sum+r.platformOnlyCount,0));
          setBookedPlatformAmount(String(results.reduce((sum,r)=>sum+Number(r.platformOnlyTotal),0)));
          const costs=results.flatMap(r=>r.projects.flatMap(p=>p.costs));
          const normalizeCategory=(name:string)=>name.normalize("NFKC").replace(/\s/g, "");
          const category=(name:string)=>costs.filter(c=>normalizeCategory(c.category)===normalizeCategory(name)).reduce((sum,c)=>sum+Math.round(Number(c.amount)*100),0)/100;
          const total=results.reduce((sum,r)=>sum+Math.round(Number(r.total)*100),0)/100;
          const labor=category("人员人工（含社保+公积金）"),material=category("直接材料"),freight=category("运费");
          setReport({labor,material,freight,other:Math.round((total-labor-material-freight)*100)/100,total,month:results.length===1?results[0].month:0});
          const links=results.map((r,index)=>({url:`${url}?download=${index}`,filename:r.filename}));setDownloads(links);
          if(links.length===1){const link=document.createElement("a");link.href=links[0].url;link.download=links[0].filename;link.click();}
          setComplete(true);setPhase("ready");setMessage(`测算完成，${results.length} 个月份的费用已归集，原始资料和结果已归档。`);break;
        }
        setMessage(result.status==="queued"?"资料已上传，等待服务器计算…":"服务器正在计算、导出并归集费用…");
        await new Promise(resolve=>window.setTimeout(resolve,1000));
      }
    }catch(error){setPhase("error");setMessage(error instanceof Error?`测算未完成：${error.message}`:"测算未完成，请重试。");}
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
          <label
            className={`dropzone ${dragging ? "dragging" : ""}`}
            tabIndex={0}
            aria-label="上传 Excel 或图片，也可粘贴图片"
            onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); input.current?.click(); } }}
            onPaste={event => {
              const image = Array.from(event.clipboardData.items).find(item => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile();
              if (image) { event.preventDefault(); acceptUploads([image]); }
            }}
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
              accept=".xlsx,image/png,image/jpeg,image/webp"
              disabled={phase === "running" || phase === "loading"}
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
                      <span title={file.name}>{file.name}{originalImageFiles[file.name] ? " · 图片已复核" : ""}</span>
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
                <small>点击或拖入 Excel / 图片可继续添加，也可按 Ctrl / ⌘ + V 粘贴图片</small>
              </div>
            ) : (
              <>
                <CloudIcon />
                <strong>点击选择或拖入 Excel / 图片</strong>
                <span>支持 Ctrl / ⌘ + V 粘贴图片。每批最多 100 份；Excel / PNG / JPEG / WebP 单份 ≤ 50 MB</span>
                <small>工资表、工时表、科目余额表必需；明细账可不传。图片经服务器识别、复核后加入测算。</small>
              </>
            )}
          </label>
          {projectsError && <p className="ui-field-error" role="alert">{projectsError}</p>}
          <ImageImport onCountChange={setPendingImages} ref={imageImport} onConfirm={confirmImage} disabled={phase === "running" || phase === "loading"} />
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
                            <span title={file.name}>{file.name}{originalImageFiles[file.name] ? " · 图片已复核" : ""}</span>
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
                      disabled={phase === "running" || phase === "loading"}
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
              资料上传后由服务器后台计算；完成后自动归集费用、归档并生成 Excel
            </p>
            <button
              type="button"
              className="start-button"
              disabled={!ready || !projects.length || pendingImages > 0 || phase === "loading" || phase === "running"}
              onClick={run}
            >
              {phase === "running" ? "正在测算…" : "开始测算"}
            </button>
          </div>
          {!projects.length && <div className="notice">请先在研发项目中建立项目并设置平台归属。</div>}
          {message && <div className={`notice ${phase}`}>{message}</div>}
          {complete && (
            <section className="rd-result-card" aria-label="测算结果">
              <div className="rd-result-top"><div className="rd-result-heading"><span className="rd-result-check"><CheckIcon /></span><div><h2>测算完成</h2><p>费用已归集，原始资料与结果已归档</p></div></div><span className="rd-result-period">{report?.month ? `${new Date().getFullYear()} 年 ${report.month} 月` : "多月汇总"}</span></div>
              <div className="rd-result-total"><span>研发费用合计</span><strong>{report ? money(report.total) : "—"}</strong><div className="rd-result-tags"><span>{bookedProjects} 个项目已归集</span>{bookedPlatformOnly>0 && <span>{bookedPlatformOnly} 笔平台直归 · {money(Number(bookedPlatformAmount))}</span>}</div></div>
              {report && <div className="rd-result-breakdown">{[["直接人工",report.labor],["直接材料",report.material],["运费",report.freight],["其他费用",report.other]].map(([label,value])=><div key={label as string}><span>{label}</span><strong>{money(value as number)}</strong></div>)}</div>}
              {bookedPlatformOnly>0 && <p className="rd-result-note">平台直归费用已包含在合计中，未分摊到具体项目。</p>}
              <div className="rd-result-files"><div><strong>测算结果文件</strong><span>Excel · 含跨表公式</span></div><div className="rd-result-downloads">{downloads.map(item=><a className="rd-result-download" key={item.url} href={item.url} download={item.filename}><Icon><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" /></Icon><span>{downloads.length===1 ? "下载 Excel" : item.filename}</span></a>)}</div></div>
            </section>
          )}
        </div>
      </div>
    </WorkbenchShell>
  );
}
