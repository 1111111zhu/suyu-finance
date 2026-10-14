"use client";
import { useAccess } from "../../use-access";

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { useSearchParams } from "next/navigation";
import { WorkbenchShell } from "../workbench-shell";
import { importAnalysisResult, listAnalysis, previewAnalysisImport, type AnalysisImportPreview, type AnalysisRow } from "../rd-client";
import "../rd-cost.css";
import "./analysis.css";

type ChartMode = "line" | "bar";
type CostKind = "labor" | "material" | "freight" | "other";
const categories: { id: CostKind; label: string; color: string }[] = [
  { id: "labor", label: "直接人工", color: "#257e65" },
  { id: "material", label: "直接材料", color: "#4b8ed1" },
  { id: "freight", label: "运费", color: "#e4a348" },
  { id: "other", label: "其他费用", color: "#9386c6" },
];
const money = (value: number) => `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compact = (value: number) => Math.abs(value) >= 10000 ? `${(value / 10000).toFixed(1)}万` : Math.round(value).toLocaleString("zh-CN");
const cents = (value: number) => Math.round(value * 100);
const yuan = (value: number) => value / 100;
function kindOf(category: string): CostKind {
  if (/人员人工|直接人工|工资|薪酬|社保|公积金/.test(category)) return "labor";
  if (/直接材料|材料费/.test(category)) return "material";
  if (/运费|运输费/.test(category)) return "freight";
  return "other";
}
function monthRows(rows: AnalysisRow[], year: number, scope: string, kind?: CostKind) {
  const selected = rows.filter(row => row.month.startsWith(`${year}-`) && (scope === "all" || row.scope === scope));
  const covered = selected.map(row => Number(row.month.slice(5))).filter(month => month >= 1 && month <= 12);
  if (!covered.length) return [];
  const values = Array.from({ length: 12 }, () => 0);
  for (const row of selected) {
    if (kind && kindOf(row.category) !== kind) continue;
    const month = Number(row.month.slice(5));
    if (month >= 1 && month <= 12) values[month - 1] += cents(row.amount);
  }
  const first = Math.min(...covered), last = Math.max(...covered);
  return values.slice(first - 1, last).map((amount, index) => ({ month: first + index, amount: yuan(amount) }));
}

function ModeSwitch({ value, onChange }: { value: ChartMode; onChange: (mode: ChartMode) => void }) {
  return <div className="analysis-mode" role="group" aria-label="图表类型">
    <button type="button" className={value === "line" ? "active" : ""} aria-pressed={value === "line"} onClick={() => onChange("line")}>折线图</button>
    <button type="button" className={value === "bar" ? "active" : ""} aria-pressed={value === "bar"} onClick={() => onChange("bar")}>柱状图</button>
  </div>;
}

function MonthlyChart({ points, mode, color, label }: { points: { month: number; amount: number }[]; mode: ChartMode; color: string; label: string }) {
  if (!points.length) return <div className="analysis-chart-empty">该年度和主体尚无已入账费用。</div>;
  const width = 860, height = 295, left = 66, right = 20, top = 22, bottom = 43;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const all = points.map(point => point.amount);
  const minimum = Math.min(0, ...all), maximum = Math.max(1, ...all);
  const margin = (maximum - minimum) * .08;
  const min = minimum < 0 ? minimum - margin : 0;
  const max = maximum + margin;
  const y = (value: number) => top + (max - value) / (max - min) * plotHeight;
  const x = (index: number) => left + (index + .5) * plotWidth / points.length;
  const line = points.map((point, index) => `${x(index)},${y(point.amount)}`).join(" ");
  const ticks = [min, (min + max) / 2, max];
  return <div className="analysis-chart-wrap">
    <svg className="analysis-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}，${mode === "line" ? "折线图" : "柱状图"}`}>
      <title>{label}</title>
      {ticks.map((tick, index) => <g key={index}><line className="analysis-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} /><text className="analysis-axis" x={left - 11} y={y(tick) + 4} textAnchor="end">{compact(tick)}</text></g>)}
      <line className="analysis-baseline" x1={left} x2={width - right} y1={y(0)} y2={y(0)} />
      {mode === "line" && <polyline points={line} fill="none" stroke={color} strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />}
      {points.map((point, index) => <g key={point.month}>
        {mode === "bar" ? <rect x={x(index) - 17} y={Math.min(y(0), y(point.amount))} width="34" height={Math.max(0, Math.abs(y(0) - y(point.amount)))} rx="5" fill={color}><title>{point.month}月：{money(point.amount)}</title></rect>
          : <circle cx={x(index)} cy={y(point.amount)} r="5" fill="white" stroke={color} strokeWidth="3"><title>{point.month}月：{money(point.amount)}</title></circle>}
        <text className="analysis-axis analysis-month" x={x(index)} y={height - 13} textAnchor="middle">{point.month}月</text>
      </g>)}
    </svg>
    <div className="analysis-mobile-values">{points.map(point => <span key={point.month}><small>{point.month}月</small><strong>{money(point.amount)}</strong></span>)}</div>
  </div>;
}

function Composition({ amounts, selected, onSelect }: { amounts: Record<CostKind, number>; selected: CostKind; onSelect: (kind: CostKind) => void }) {
  const positive = categories.map(item => Math.max(0, amounts[item.id]));
  const whole = positive.reduce((sum, value) => sum + value, 0);
  let start = -Math.PI / 2;
  const slices = categories.map((item, index) => {
    const fraction = whole ? positive[index] / whole : 0;
    const end = start + fraction * Math.PI * 2;
    const first = start;
    start = end;
    if (!fraction) return null;
    if (fraction >= .999999) return <circle key={item.id} cx="110" cy="110" r="84" fill={item.color} onClick={() => onSelect(item.id)} className="analysis-pie-slice"><title>{item.label}：{money(amounts[item.id])}</title></circle>;
    const xy = (angle: number) => [110 + 84 * Math.cos(angle), 110 + 84 * Math.sin(angle)];
    const [x1, y1] = xy(first), [x2, y2] = xy(end);
    return <path key={item.id} d={`M110 110 L${x1} ${y1} A84 84 0 ${fraction > .5 ? 1 : 0} 1 ${x2} ${y2} Z`} fill={item.color} onClick={() => onSelect(item.id)} className="analysis-pie-slice"><title>{item.label}：{money(amounts[item.id])}</title></path>;
  });
  return <div className="analysis-composition">
    <div className="analysis-pie"><svg viewBox="0 0 220 220" role="img" aria-label="研发费用构成饼状图">{whole ? slices : <circle cx="110" cy="110" r="84" fill="#e8ecef" />}<circle cx="110" cy="110" r="51" fill="var(--analysis-card)" /></svg><div className="analysis-pie-center"><small>年度合计</small><strong>{money(Object.values(amounts).reduce((sum, value) => sum + value, 0))}</strong></div></div>
    <div className="analysis-legend">{categories.map(item => <button type="button" key={item.id} className={selected === item.id ? "active" : ""} onClick={() => onSelect(item.id)} aria-pressed={selected === item.id}><span className="analysis-swatch" style={{ background: item.color }} /><span>{item.label}</span><strong>{money(amounts[item.id])}</strong><span className="analysis-percent">{whole && amounts[item.id] > 0 ? `${(amounts[item.id] / whole * 100).toFixed(1)}%` : "—"}</span><span aria-hidden="true">›</span></button>)}{categories.some(item => amounts[item.id] < 0) && <p className="analysis-pie-note">负数冲销已计入合计；饼图仅按正数费用展示占比。</p>}</div>
  </div>;
}

export default function AnalysisPage() {
  const {rdWrite} = useAccess();
  const searchParams = useSearchParams();
  const embedded = searchParams.get("embed") === "1";
  const [rows, setRows] = useState<AnalysisRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [year, setYear] = useState<number | null>(null);
  const [scope, setScope] = useState("all");
  const [selected, setSelected] = useState<CostKind>("labor");
  const [overviewMode, setOverviewMode] = useState<ChartMode>("line");
  const [detailMode, setDetailMode] = useState<ChartMode>("bar");
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<AnalysisImportPreview | null>(null);
  const [importScope, setImportScope] = useState("");
  const [importYear, setImportYear] = useState(new Date().getFullYear());
  const [importMonth, setImportMonth] = useState(new Date().getMonth() + 1);
  const [importAcknowledged, setImportAcknowledged] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [importNotice, setImportNotice] = useState("");
  useEffect(() => {
    if (!embedded) window.location.replace("/?section=rd-analysis");
  }, [embedded]);
  const refresh = useCallback(async () => {
    try {
      const next = await listAnalysis();
      setError("");
      setRows(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "分析数据加载失败。"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const onMessage = (event: MessageEvent) => { if (event.origin === window.location.origin && event.data?.type === "rd-analysis-refresh") void refresh(); };
    window.addEventListener("message", onMessage);
    window.addEventListener("focus", refresh);
    return () => { window.clearTimeout(initial); window.removeEventListener("message", onMessage); window.removeEventListener("focus", refresh); };
  }, [refresh]);
  const years = useMemo(() => [...new Set(rows.map(row => Number(row.month.slice(0, 4))))].filter(Number.isInteger).sort((a, b) => b - a), [rows]);
  const scopes = useMemo(() => [...new Set(rows.map(row => row.scope))].sort((a, b) => a.localeCompare(b, "zh-CN")), [rows]);
  const chosenYear = year !== null && years.includes(year) ? year : years[0] ?? new Date().getFullYear();
  const chosenScope = scope === "all" || scopes.includes(scope) ? scope : "all";
  const overview = useMemo(() => monthRows(rows, chosenYear, chosenScope), [rows, chosenYear, chosenScope]);
  const detail = useMemo(() => monthRows(rows, chosenYear, chosenScope, selected), [rows, chosenYear, chosenScope, selected]);
  const visible = rows.filter(row => row.month.startsWith(`${chosenYear}-`) && (chosenScope === "all" || row.scope === chosenScope));
  const amounts = Object.fromEntries(categories.map(item => [item.id, yuan(visible.filter(row => kindOf(row.category) === item.id).reduce((sum, row) => sum + cents(row.amount), 0))])) as Record<CostKind, number>;
  const total = overview.reduce((sum, row) => sum + cents(row.amount), 0) / 100;
  const activeMonths = new Set(visible.map(row => row.month)).size;
  const detailCategories = [...new Map(visible.filter(row => kindOf(row.category) === selected).map(row => [row.category, row.category])).values()].map(name => ({ name, amount: yuan(visible.filter(row => row.category === name).reduce((sum, row) => sum + cents(row.amount), 0)) })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const selectedCategory = categories.find(item => item.id === selected)!;
  const uploadHref = "/?section=rd-calculation";
  const openCalculation = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!embedded || window.parent === window) return;
    event.preventDefault();
    window.parent.postMessage({ type:"suyu-workspace-navigate", itemId:"rd-calculation" }, window.location.origin);
  };
  const chooseImportFile = async (file: File | null) => {
    setImportFile(file);
    setImportPreview(null);
    setImportError("");
    setImportNotice("");
    setImportAcknowledged(false);
    if (!file) return;
    setImportBusy(true);
    try {
      const preview = await previewAnalysisImport(file);
      setImportPreview(preview);
      if (preview.yearHint) setImportYear(preview.yearHint);
      if (preview.monthHint) setImportMonth(preview.monthHint);
    } catch (cause) { setImportError(cause instanceof Error ? cause.message : "文件预览失败。"); }
    finally { setImportBusy(false); }
  };
  const submitImport = async () => {
    if (!importFile || !importPreview) return;
    setImportBusy(true);
    setImportError("");
    setImportNotice("");
    try {
      const result = await importAnalysisResult(importFile, { sha256:importPreview.sha256, scope:importScope.trim(), year:importYear, month:importMonth, acknowledged:importAcknowledged });
      await refresh();
      setYear(result.year);
      setScope(result.scope);
      setImportNotice(result.repeated ? "这份结果已导入过，分析数据保持不变。" : result.replaced ? "已替换该主体、月份的历史结果，图表已刷新。" : "历史测算结果已导入，图表已刷新。");
      setImportFile(null);
      setImportPreview(null);
    } catch (cause) { setImportError(cause instanceof Error ? cause.message : "导入失败。"); }
    finally { setImportBusy(false); }
  };
  if (!embedded) return null;
  return <WorkbenchShell><div className="rd-analysis">
    <header className="analysis-head"><div><p className="analysis-eyebrow">R&D COST INSIGHTS</p><h1>研发费用分析</h1><p>查看已确认入账及导入的历史测算结果</p></div><div className="analysis-head-actions">{rdWrite && <button type="button" onClick={() => setImportOpen(value => !value)} aria-expanded={importOpen}>导入历史结果</button>}<button type="button" onClick={() => void refresh()} disabled={loading}>刷新数据</button><a href={uploadHref} target="_top" onClick={openCalculation}>上传并测算 <span aria-hidden="true">↗</span></a></div></header>
    {rdWrite && importOpen && <section className="analysis-import analysis-card" aria-label="导入历史测算结果"><div className="analysis-card-head"><div><span className="analysis-section-index">历史数据</span><h2>导入已完成的测算结果</h2><p>支持本系统导出的 .xlsx 文件；只读取汇总金额，不改动原文件。</p></div></div>
      <div className="analysis-import-fields"><label className="analysis-import-file">结果文件<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => { const file=event.target.files?.[0] ?? null; event.target.value=""; void chooseImportFile(file); }} disabled={importBusy} /></label><label>核算主体<input value={importScope} onChange={event => setImportScope(event.target.value)} placeholder="例如：苏誉科技" maxLength={80} /></label><label>核算年度<input type="number" min={2000} max={2100} value={importYear} onChange={event => setImportYear(Number(event.target.value))} /></label><label>核算月份<select value={importMonth} onChange={event => setImportMonth(Number(event.target.value))}>{Array.from({length:12},(_,index)=><option key={index+1} value={index+1}>{index+1} 月</option>)}</select></label></div>
      {importBusy && <p className="analysis-import-state">正在处理文件…</p>}
      {importError && <p className="analysis-import-error" role="alert">{importError}</p>}
      {importNotice && <p className="analysis-import-notice" role="status">{importNotice}</p>}
      {importPreview && <><div className="analysis-import-preview"><div><small>项目数</small><strong>{importPreview.projectCount}</strong></div><div><small>费用合计</small><strong>{money(Number(importPreview.total))}</strong></div><div><small>文件期间</small><strong>{importPreview.yearHint ? `${importPreview.yearHint} 年` : "未标年度"} · {importPreview.monthHint ? `${importPreview.monthHint} 月` : "未标月份"}</strong></div></div><details className="analysis-import-details"><summary>查看 {importPreview.categories.length} 项费用明细</summary><div>{importPreview.categories.map(line=><span key={line.category}>{line.category}<b>{money(Number(line.amount))}</b></span>)}</div></details>
        {(!importPreview.yearHint || !importPreview.monthHint) && <label className="analysis-import-confirm"><input type="checkbox" checked={importAcknowledged} onChange={event=>setImportAcknowledged(event.target.checked)} />我确认这份旧版结果只包含所选月份的最终测算金额</label>}
        <div className="analysis-import-actions"><span>同一主体、月份重新导入会替换先前的历史结果；如已有确认入账批次，系统会阻止重复导入。</span><button type="button" onClick={() => void submitImport()} disabled={importBusy || !importScope.trim() || ((!importPreview.yearHint || !importPreview.monthHint) && !importAcknowledged)}>确认导入并更新分析</button></div></>}
    </section>}
    {error && <div className="analysis-error" role="alert">{error} <button type="button" onClick={() => void refresh()}>重试</button></div>}
    {loading ? <div className="analysis-empty">正在读取研发费用数据…</div> : !rows.length && !error ? <div className="analysis-empty"><strong>暂无研发费用数据</strong><p>可以直接导入已完成的测算结果，或上传工资表、工时表和科目余额表完成新测算。</p>{rdWrite && <button type="button" onClick={() => setImportOpen(true)}>导入历史结果 →</button>}<a href={uploadHref} target="_top" onClick={openCalculation}>前往研发费用测算 →</a></div> : rows.length ? <>
      <div className="analysis-toolbar"><div className="analysis-filter"><label htmlFor="analysis-year">核算年度</label><select id="analysis-year" value={chosenYear} onChange={event => setYear(Number(event.target.value))}>{years.map(value => <option key={value} value={value}>{value} 年</option>)}</select></div><div className="analysis-filter"><label htmlFor="analysis-scope">核算主体</label><select id="analysis-scope" value={chosenScope} onChange={event => setScope(event.target.value)}><option value="all">全部主体</option>{scopes.map(value => <option key={value} value={value}>{value}</option>)}</select></div><span>数据口径：已确认入账 + 历史结果；同月最新结果生效</span></div>
      <div className="analysis-kpis"><article><small>年度研发费用</small><strong>{money(total)}</strong><span>{chosenYear} 年 · {chosenScope === "all" ? "全部主体" : chosenScope}</span></article><article><small>已入账月份</small><strong>{activeMonths}<em> / 12</em></strong><span>按费用发生月份统计</span></article><article><small>月均研发费用</small><strong>{money(activeMonths ? total / activeMonths : 0)}</strong><span>按已入账月份计算</span></article></div>
      <section className="analysis-card"><div className="analysis-card-head"><div><span className="analysis-section-index">01 / 月度趋势</span><h2>研发费用总变化趋势</h2><p>各月费用合计，可切换折线图与柱状图</p></div><ModeSwitch value={overviewMode} onChange={setOverviewMode} /></div><MonthlyChart points={overview} mode={overviewMode} color="#257e65" label={`${chosenYear}年研发费用月度总趋势`} /></section>
      <div className="analysis-lower"><section className="analysis-card"><div className="analysis-card-head"><div><span className="analysis-section-index">02 / 费用构成</span><h2>各类费用占比</h2><p>点击分类查看月度明细</p></div></div><Composition amounts={amounts} selected={selected} onSelect={setSelected} /></section>
      <section className="analysis-card analysis-detail"><div className="analysis-card-head"><div><span className="analysis-section-index">03 / 分类明细</span><h2><span className="analysis-title-dot" style={{ background: selectedCategory.color }} />{selectedCategory.label}趋势</h2><p>{chosenYear} 年度金额 {money(amounts[selected])}</p></div><ModeSwitch value={detailMode} onChange={setDetailMode} /></div><MonthlyChart points={detail} mode={detailMode} color={selectedCategory.color} label={`${chosenYear}年${selectedCategory.label}月度趋势`} />{detailCategories.length > 0 && <div className="analysis-subcategories"><strong>包含的费用科目</strong>{detailCategories.map(item => <span key={item.name}>{item.name}<b>{money(item.amount)}</b></span>)}</div>}</section></div>
    </> : null}
  </div></WorkbenchShell>;
}
