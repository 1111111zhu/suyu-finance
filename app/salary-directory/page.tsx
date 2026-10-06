"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseSheet, pickSheet, preparePeople, salaryRows, previousPayrollMonth, type Engine, type Issue, type Role, type SourceSheet } from "./roster-model";
import "./personnel.css";
import { personnelTags, parseCosts, matchCost, type Cost } from "./analysis-model";
import { expenseHistory, personHistory, readPayrollBatches, rangeExpenses, rangeTrend, monthsInRange, type ExpensePerson, type ExpenseBatch } from "./payroll-history";

type Workbook = { name: string; sheets: SourceSheet[]; ignored: string[]; hash: string };
type Directory = { configured: boolean; syncedAt: string | null; lastError?: string; departments: { id: string; name: string }[]; members: { name: string; userid: string; position: string; departmentIds: string[] }[] };
type Event = { id: string; label: string; reason: string; userid: string; after?: { name?: string }; before?: { name?: string }; effectiveOn?: string; eventAt: string };

function Icon({ kind }: { kind: "file" | "upload" | "search" | "check" | "arrow" }) {
  const paths: Record<string, ReactNode> = {
    file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></>,
    upload: <><path d="M12 16V4m-5 5 5-5 5 5M4 15v5h16v-5"/></>,
    search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,
    check: <path d="m5 12 4 4L19 6"/>, arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

async function loadEngine(): Promise<Engine> {
  const target = window as unknown as Window & { PayrollEngine?: Engine };
  if (target.PayrollEngine) return target.PayrollEngine;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/salary/payroll-engine.js";
    script.onload = () => resolve(); script.onerror = () => reject(new Error("人员识别组件加载失败，请刷新重试。"));
    (document.head as unknown as HTMLElement).appendChild(script);
  });
  if (!target.PayrollEngine) throw new Error("人员识别组件尚未就绪。");
  return target.PayrollEngine;
}

const initialMonth = () => {
  const month=typeof window!=="undefined"?new URLSearchParams(window.location.search).get("month"):null;
  return month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)?month:previousPayrollMonth();
};
const value = (input: unknown) => String(input ?? "");

export default function SalaryDirectory() {
  const [history,setHistory]=useState<ExpenseBatch[]>([]);
  const [historyBusy,setHistoryBusy]=useState(true);
  const [historyError,setHistoryError]=useState("");
  const [batchId,setBatchId]=useState("");
  const [focusPerson,setFocusPerson]=useState<ExpensePerson|null>(null);
  const [metric,setMetric]=useState<"gross"|"net"|"cost">("gross");
  const [cachedRoster,setCachedRoster]=useState<unknown[]>([]);
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [selected, setSelected] = useState<Record<Role, string>>({ active: "", left: "" });
  const [overrides, setOverrides] = useState<Record<string, Record<string, string>>>({});
  const [role, setRole] = useState<Role>("active");
  const [batchDetail,setBatchDetail]=useState(false);
  const [month, setMonth] = useState(initialMonth);
  const [endMonth,setEndMonth]=useState(initialMonth);
  useEffect(()=>{const params=new URLSearchParams(window.location.search);const m=params.get("month");if(params.get("detail")==="1"&&m&&/^\d{4}-(0[1-9]|1[0-2])$/.test(m)){setMonth(m);setEndMonth(m);setBatchDetail(true);}},[]);
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [costs, setCosts] = useState<Cost[]>([]);
  const [priorCosts, setPriorCosts] = useState<Cost[]>([]);
  const [costMonth, setCostMonth] = useState("");
  const [priorMonth, setPriorMonth] = useState("");
  const [costFile, setCostFile] = useState("");
  const [priorFile, setPriorFile] = useState("");
  const costInput = useRef<HTMLInputElement>(null);
  const priorInput = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [serviceError, setServiceError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadId = useRef(0);
  const transferId = useRef("");

  useEffect(()=>{
    let alive=true;
    const refresh=async()=>{try{const batches=await readPayrollBatches();if(alive){setHistory(expenseHistory(batches));setCachedRoster(batches);setHistoryError("");}}catch(e){if(alive)setHistoryError(e instanceof Error?e.message:"工资结果读取失败");}finally{if(alive)setHistoryBusy(false);}};
    void refresh();const timer=setInterval(()=>void refresh(),3000);window.addEventListener("focus",refresh);
    return()=>{alive=false;clearInterval(timer);window.removeEventListener("focus",refresh);};
  },[]);
  useEffect(()=>{
    if(workbook || !cachedRoster.length)return;
    const candidates=cachedRoster as {draftOrigin?:string;data?:{sourceRows?:{roster?:import("./roster-model").RawRow[]};sourceStatus?:Record<string,{demo?:boolean}>}}[];
    const batch=candidates.find(b=>b.draftOrigin!=="demo" && b.data?.sourceRows?.roster?.length && !Object.values(b.data.sourceStatus||{}).some(s=>s.demo));
    const rows=batch?.data?.sourceRows?.roster;if(!rows)return;
    void loadEngine().then(recognizer=>{setEngine(recognizer);setWorkbook({name:"已保存花名册",hash:"",ignored:[],sheets:[{name:"在职员工",headers:[...new Set(rows.flatMap(r=>Object.keys(r)))],headerRow:1,rows:rows.map((raw,index)=>({raw,number:index+2}))}]});setSelected({active:"在职员工",left:""});});
  },[cachedRoster,workbook]);
  async function refreshDirectory() {
    try {
      const response = await fetch("/api/payroll/personnel/directory", { cache: "no-store" });
      const result = await response.json() as { ok: boolean; data: Directory; error?: { message: string } };
      if (!response.ok || !result.ok) throw new Error(result.error?.message || "企微通讯录暂不可用");
      setDirectory(result.data); setServiceError("");
    } catch (reason) { setServiceError(reason instanceof Error ? reason.message : "企微通讯录暂不可用"); }
  }
  useEffect(() => {
    if (window.parent === window) { window.location.replace("/?section=salary-directory"); return; }
    void refreshDirectory();
  }, []);
  useEffect(() => {
    setPage(1);
  }, [role, query, department, statusFilter, month, selected, overrides]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent || event.data?.type !== "suyu-payroll-roster-result" || event.data.id !== transferId.current) return;
      setSending(false);
      if (!event.data.ok) setError(event.data.message || "工资草稿创建失败，请重试。");
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  const prepared = useMemo(() => ({
    active: preparePeople(workbook?.sheets.find(sheet => sheet.name === selected.active), "active", engine, overrides[selected.active]),
    left: preparePeople(workbook?.sheets.find(sheet => sheet.name === selected.left), "left", engine, overrides[selected.left]),
  }), [workbook, selected, engine, overrides]);
  const current = prepared[role];
  const currentSheet = workbook?.sheets.find(sheet => sheet.name === selected[role]);
  useEffect(() => {
    const publish = () => window.parent.postMessage({type:"suyu-roster-mapping-state", payload:{
      role, filename:workbook?.name || "", sheetName:selected[role], headers:currentSheet?.headers || [],
      fields:engine?.rosterFields.map(([field,label])=>[field,label]) || [], map:current.map,
      sheets:workbook?.sheets.filter(sheet=>!sheet.name.includes(role==="active"?"离职":"在职")).map(sheet=>sheet.name) || [],
    }},window.location.origin);
    const receive = (event: MessageEvent) => {
      if(event.origin!==window.location.origin || event.source!==window.parent)return;
      if(event.data?.type==="suyu-roster-mapping-request")publish();
      if(event.data?.type==="suyu-roster-mapping-edit") {
        const edit=event.data;
        if(edit.upload){fileInput.current?.click();return;}
        if(edit.role && ["active","left"].includes(edit.role)){setRole(edit.role);return;}
        if(edit.sheetName && workbook?.sheets.some(sheet=>sheet.name===edit.sheetName)){setSelected(prev=>({...prev,[role]:edit.sheetName}));return;}
        if(edit.sheet===selected[role] && engine?.rosterFields.some(([field])=>field===edit.field) && (edit.header==="" || currentSheet?.headers.includes(edit.header)))
          setOverrides(prev=>({...prev,[selected[role]]:{...prev[selected[role]],[edit.field]:edit.header}}));
      }
    };
    publish();window.addEventListener("message",receive);return()=>window.removeEventListener("message",receive);
  },[workbook,selected,role,engine,currentSheet,current.map]);
  const interns = prepared.active.people.filter(person => person.values.isIntern === true).length;
  const allIssues = [...current.issues, ...current.people.flatMap(person => person.issues.map(issue => ({ ...issue, message: `第 ${person.number} 行：${issue.message}` }))), ...current.excluded.flatMap(person => person.issues.filter(issue => issue.field === "status").map(issue => ({ ...issue, message: `第 ${person.number} 行：${issue.message}` })))];
  const issues = [...new Map(allIssues.map(issue => [`${issue.field}:${issue.message}`, issue])).values()];
  const blockers = [...prepared.active.issues, ...prepared.active.people.flatMap(person => person.issues), ...prepared.active.excluded.flatMap(person => person.issues.filter(issue => issue.field === "status"))].filter(issue =>
    !["bankCard", "bankName"].includes(issue.field) || issue.reason === "text-required");
  const departments = [...new Set(current.people.map(person => value(person.values.dept)).filter(Boolean))];
  const filtered = current.people.filter(person => (!statusFilter || personnelTags(person, month).includes(statusFilter)) && (!department || person.values.dept === department) &&
    (!query || ["name", "employeeNumber", "dept", "subdept", "thirdDept", "position"].some(field => value(person.values[field]).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 15));
  const shown = filtered.slice((Math.min(page, pageCount) - 1) * 15, Math.min(page, pageCount) * 15);

  async function readFile(file?: File) {
    if (!file) return;
    const id = ++uploadId.current;
    setBusy(true); setError("");
    try {
      if (!/\.xlsx$/i.test(file.name)) throw new Error("请选择 .xlsx 员工信息表。");
      if (file.size > 20 * 1024 * 1024) throw new Error("文件超过 20 MB，请拆分后再选择。");
      const [recognizer, XLSX, bytes] = await Promise.all([loadEngine(), import("xlsx"), file.arrayBuffer()]);
      const book = XLSX.read(bytes, { type: "array", cellDates: false });
      const sheets: SourceSheet[] = [], ignored: string[] = [];
      for (const name of book.SheetNames) {
        const sheet = parseSheet(name, XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: null, raw: true }) as unknown[][], recognizer);
        if (sheet) sheets.push(sheet); else ignored.push(name);
      }
      if (!sheets.length) throw new Error("没有找到带姓名表头的人员工作表，请检查文件。");
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), item => item.toString(16).padStart(2, "0")).join("");
      if (id !== uploadId.current) return;
      setEngine(recognizer); setWorkbook({ name: file.name, sheets, ignored, hash });
      setSelected({ active: pickSheet(sheets, "active"), left: pickSheet(sheets, "left") });
      setOverrides({}); setRole("active"); setQuery(""); setDepartment(""); setStatusFilter(""); setPage(1);
    } catch (reason) { if (id === uploadId.current) setError(reason instanceof Error ? reason.message : "文件读取失败。"); }
    finally { if (id === uploadId.current) setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  }

  function changeRole(next: Role) { setRole(next); setDepartment(""); setQuery(""); setStatusFilter(""); }
  function sendToSalary() {
    if (!engine || !workbook || !prepared.active.people.length || blockers.length || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
    if (window.parent === window) { setError("请从 3220 首页的工资表菜单进入人员归集，再创建工资草稿。"); return; }
    transferId.current = crypto.randomUUID(); setSending(true); setError("");
    window.parent.postMessage({ type: "suyu-payroll-roster-transfer", id: transferId.current, payload: {
      month, filename: workbook.name, sheetName: selected.active, sha256: workbook.hash,
      sourceStartRow: prepared.active.people[0]?.number ?? 2,
      rows: salaryRows(prepared.active.people, engine),
    } }, window.location.origin);
  }

  async function sync() {
    setSyncing(true); setServiceError("");
    try {
      const response = await fetch("/api/payroll/personnel/directory/sync", { method: "POST", headers: { "Content-Type": "application/json", "X-Suyu-Local": "1" }, body: "{}" });
      const result = await response.json() as { ok: boolean; error?: { message: string } };
      if (!response.ok || !result.ok) throw new Error(result.error?.message || "企微同步失败");
      await refreshDirectory();
    } catch (reason) { setServiceError(reason instanceof Error ? reason.message : "企微同步失败"); }
    finally { setSyncing(false); }
  }

  async function loadEvents() {
    try {
      const response = await fetch(`/api/payroll/personnel/events?from=${month}&to=${month}`, { cache: "no-store" });
      const result = await response.json() as { ok: boolean; data: Event[]; error?: { message: string } };
      if (!response.ok || !result.ok) throw new Error(result.error?.message || "异动记录查询失败");
      setEvents(result.data);
    } catch (reason) { setServiceError(reason instanceof Error ? reason.message : "异动记录查询失败"); }
  }

  const money = (n: number | null | undefined) => n === null || n === undefined ? "待提供" : new Intl.NumberFormat("zh-CN", {style:"currency",currency:"CNY"}).format(n);
  const rowCost = (person: import("./roster-model").Person) => costMonth===month ? matchCost(person,costs) : undefined;
  const knownCosts = prepared.active.people.flatMap(p=>{const n=rowCost(p)?.cost;return n===null||n===undefined?[]:[n];});
  function change(person: import("./roster-model").Person) { const now=rowCost(person)?.gross, before=priorMonth<month?matchCost(person,priorCosts)?.gross:null; if(now==null || before==null)return "待对比";const delta=now-before;return `${delta>0?"+":""}${money(delta)}${before===0?"":` (${(delta/before*100).toFixed(1)}%)`}`; }
  async function readCosts(file: File | undefined, prior: boolean) {
    if(!file)return;setError("");
    try {const XLSX=await import("xlsx");const book=XLSX.read(await file.arrayBuffer(),{type:"array"});let parsed:Cost[]|null=null;
      for(const name of book.SheetNames){try{parsed=parseCosts(XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,defval:null}) as unknown[][]);break;}catch{}}
      if(!parsed?.length)throw new Error("未找到有效工资结果。请提供姓名及应发工资、实发工资或公司成本列。");
      if(prior){setPriorCosts(parsed);setPriorFile(file.name);}else{setCosts(parsed);setCostFile(file.name);}
    }catch(e){setError(e instanceof Error?e.message:"工资结果读取失败");}
    finally{const input=prior?priorInput.current:costInput.current;if(input)input.value="";}
  }

  const validRange=monthsInRange(month,endMonth).length>0;
  const expenses=rangeExpenses(history,month,endMonth);
  const visibleExpenses=expenses.filter(p=>(!statusFilter||p.status===statusFilter)&&(!department||p.dept===department)&&(!query||[p.name,p.employeeNumber,p.dept].some(v=>v.includes(query.trim()))));
  const availableStatuses=[...new Set(expenses.map(p=>p.status).filter(Boolean))];
  const availableDepartments=[...new Set(expenses.map(p=>p.dept).filter(Boolean))];
  const trend=focusPerson?rangeTrend(focusPerson,history,month,endMonth):[];
  const chartValues=trend.flatMap(p=>p[metric]===null?[]:[p[metric]!]);
  const max=Math.max(1,...chartValues), min=Math.min(0,...chartValues);
  const chartX=(index:number)=>trend.length===1?350:60+index*580/Math.max(1,trend.length-1);
  const chartY=(amount:number)=>210-(amount-min)/(max-min)*170;
  const points=trend.map((p,i)=>p[metric]===null?null:{x:chartX(i),y:chartY(p[metric]!),point:p});
  const segments:string[]=[];let segment:string[]=[];
  for(const point of points){if(point)segment.push(`${point.x},${point.y}`);else if(segment.length){segments.push(segment.join(' '));segment=[];}}if(segment.length)segments.push(segment.join(' '));
  const cumulative=(p:import("./payroll-history").RangeExpense,key:"gross"|"net"|"cost")=><>{money(p[key])}{p[key]!==null&&p.missing[key]>0&&<small className="sp-warning-text">缺 {p.missing[key]} 月</small>}</>;
  return <main className="sp-page" data-theme="light">
    <header className="sp-heading" hidden={batchDetail}><h1>人员归集</h1><div className="sp-range" hidden={batchDetail}><label className="sp-month">开始月份<input type="month" aria-label="开始月份" value={month} onChange={e=>{setMonth(e.target.value);setDepartment("");setFocusPerson(null);}}/></label><span>至</span><label className="sp-month">结束月份<input type="month" aria-label="结束月份" value={endMonth} onChange={e=>{setEndMonth(e.target.value);setDepartment("");setFocusPerson(null);}}/></label></div></header>
    <input ref={fileInput} type="file" accept=".xlsx" hidden onChange={e=>void readFile(e.target.files?.[0])}/>
    {(error||historyError) && <div className="sp-alert danger" role="alert">{error||historyError}</div>}
    {!validRange&&<div className="sp-alert" role="alert">请选择有效月份区间，开始月份不能晚于结束月份，最长支持120个月。</div>}
    <section className="sp-card" aria-label="人员费用">
      <div className="sp-toolbar"><label className="sp-search"><Icon kind="search"/><input aria-label="搜索人员" placeholder="姓名、工号" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="部门筛选" value={department} onChange={e=>setDepartment(e.target.value)}><option value="">全部部门</option>{availableDepartments.map(d=><option key={d}>{d}</option>)}</select><select aria-label="状态筛选" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">全部状态</option>{availableStatuses.map(status=><option key={status}>{status}</option>)}</select></div>
      {historyBusy?<div className="sp-empty">正在读取工资结果…</div>:<div className="sp-table-scroll"><table><thead><tr><th>员工</th><th>部门</th><th>状态</th><th>累计应发</th><th>累计实发</th>{!batchDetail&&<th>累计企业费用</th>}</tr></thead><tbody>{visibleExpenses.map((person,index)=><tr className="sp-expense-row" tabIndex={0} aria-label={`${person.name}，查看薪资折线图`} onClick={()=>setFocusPerson(person)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setFocusPerson(person);}}} key={`${person.employeeNumber}-${person.name}-${index}`}><td><strong className="sp-person-link">{person.name}</strong><small>{person.employeeNumber}</small></td><td>{person.dept||"—"}</td><td><span className="sp-badge" data-status={person.status}>{person.status}</span></td><td>{cumulative(person,"gross")}</td><td>{cumulative(person,"net")}</td>{!batchDetail&&<td>{cumulative(person,"cost")}</td>}</tr>)}{!visibleExpenses.length&&<tr><td colSpan={batchDetail?5:6} className="sp-no-results">{expenses.length?"没有符合条件的人员":`${month} 至 ${endMonth} 暂无真实工资结果`}</td></tr>}</tbody></table></div>}
    </section>
    {focusPerson&&<section className="sp-card sp-history" aria-label={`${focusPerson.name}薪资变化`}>
      <header><h2>{focusPerson.name} · 薪资变化</h2><button className="sp-button" onClick={()=>setFocusPerson(null)}>收起</button></header>
      <div className="sp-segments" role="tablist" aria-label="图表金额类型">{([["gross","应发工资"],["net","实发工资"],["cost","企业费用"]] as const).map(([key,label])=><button key={key} role="tab" aria-selected={metric===key} onClick={()=>setMetric(key)}>{label}</button>)}</div>
      <div className="sp-line-chart"><svg viewBox="0 0 700 265" role="img" aria-label={`${focusPerson.name}月度薪资折线图`}>
        <line x1="60" y1="210" x2="640" y2="210" stroke="#cdd9e9"/>
        {[0,.5,1].map(level=><g key={level}><line x1="60" x2="640" y1={210-level*170} y2={210-level*170} stroke="#edf0f5"/><text x="52" y={214-level*170} textAnchor="end">{(min+(max-min)*level).toLocaleString("zh-CN",{maximumFractionDigits:2})}</text></g>)}
        {segments.map((line,i)=><polyline key={i} points={line} fill="none" stroke="#009640" strokeWidth="3"/>)}
        {points.map((point,i)=>point&&<g key={i}><circle cx={point.x} cy={point.y} r="5" fill="#009640"><title>{point.point.month}：{money(point.point[metric])}</title></circle><text x={point.x} y={point.y-12} textAnchor="middle">{money(point.point[metric])}</text></g>)}
        {trend.map((point,i)=><g key={point.month}><text x={chartX(i)} y="238" textAnchor="middle">{point.month}</text>{point[metric]===null&&<text x={chartX(i)} y="190" textAnchor="middle">待提供</text>}</g>)}
      </svg></div>
      <div className="sp-table-scroll"><table><thead><tr><th>月份</th><th>应发工资</th><th>实发工资</th><th>企业费用</th><th>应发变化</th></tr></thead><tbody>{trend.map((point,index)=><tr key={point.month}><td>{point.month}</td><td>{money(point.gross)}</td><td>{money(point.net)}</td><td>{money(point.cost)}</td><td>{index>0&&point.gross!==null&&trend[index-1].gross!==null?money(point.gross-trend[index-1].gross!):"—"}</td></tr>)}</tbody></table></div>
    </section>}
  </main>;
}
