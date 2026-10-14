"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

export type ImageKind = "hours" | "salary" | "balance" | "ledger";
export type ImageRows = (string | number | null)[][];
const labels: Record<ImageKind, string> = { hours: "工时表", salary: "工资表", balance: "科目余额表", ledger: "费用明细账" };

export type ImageImportHandle = { accept: (files: File[]) => void };
export function ImageImport({ onConfirm, disabled = false, ref, onCountChange }: { onConfirm: (rows: ImageRows, kind: ImageKind, image: File) => Promise<void>; disabled?: boolean; ref?: Ref<ImageImportHandle>; onCountChange?: (count:number)=>void }) {
  const [queue,setQueue]=useState<File[]>([]);
  const [kind, setKind] = useState<ImageKind>("hours");
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [rows, setRows] = useState<ImageRows>([]);
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => { onCountChange?.(queue.length + (image ? 1 : 0)); }, [queue.length,image,onCountChange]);
  useEffect(() => {
    if(!image && queue.length){setImage(queue[0]);setPreview(URL.createObjectURL(queue[0]));setQueue(current=>current.slice(1));setRows([]);setError("");setWarning("");setReviewed(false);}
  }, [image,queue]);
  useImperativeHandle(ref, () => ({ accept(files) {
    if (busy || disabled) return;
    if(files.some(file=>!["image/png", "image/jpeg", "image/webp"].includes(file.type))){setError("请选择 PNG、JPEG 或 WebP 图片。");return;}
    if(files.some(file=>file.size>50*1024*1024)){setError("单张图片不能超过 50 MB。");return;}
    if(queue.length+(image?1:0)+files.length>100){setError("图片队列最多 100 张。");return;}
    setQueue(current=>[...current,...files]);
  } }));
  async function recognize(file: File) {
    if (busy || disabled) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setError("请选择 PNG、JPEG 或 WebP 图片。"); return; }
    if (file.size > 50 * 1024 * 1024) { setError("单张图片不能超过 50 MB。"); return; }
    const current = ++generation.current;
    setImage(file); setPreview(URL.createObjectURL(file)); setRows([]); setError(""); setWarning(""); setReviewed(false); setBusy(true);
    try {
      const form = new FormData(); form.append("image", file); form.append("kind", kind);
      const response = await fetch("/api/rd/image-import", { method: "POST", body: form });
      const result = await response.json() as { error?: unknown; rows?: unknown; warning?: unknown };
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "图片识别失败，请稍后重试。");
      if (!Array.isArray(result.rows) || !result.rows.length || result.rows.length > 1000 || result.rows.some((row: unknown) => !Array.isArray(row) || row.length > 100 || row.some(cell => cell !== null && typeof cell !== "string" && typeof cell !== "number"))) throw new Error("没有取得有效表格，请换一张清晰的图片。");
      if (current !== generation.current) return;
      const recognized = result.rows as ImageRows;
      const width = Math.max(...recognized.map(row => row.length));
      setRows(recognized.map(row => Array.from({ length: width }, (_, index) => row[index] ?? null)));
      setWarning(typeof result.warning === "string" ? result.warning : "图片识别可能遗漏字符。请对照原图核对表头、月份、姓名、项目编码、工时和金额。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "图片识别失败。"); }
    finally { if (current === generation.current) setBusy(false); }
  }
  function edit(next: ImageRows) { setRows(next); setReviewed(false); }
  async function confirm() {
    if (!image || !reviewed || busy || disabled) return;
    if (!rows.some(row => row.some(cell => cell !== null && String(cell).trim()))) { setError("表格为空，不能加入测算。"); return; }
    setBusy(true); setError("");
    try { await onConfirm(rows, kind, image); setRows([]); setImage(null); setPreview(""); setReviewed(false); setWarning("已加入测算资料，尚未入账。"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "加入失败，请核对表格。"); }
    finally { setBusy(false); }
  }
  if (!image && !error && !warning) return null;
  return <section className="rd-image-import" aria-label="图片复核">
    {image && <><h2>图片复核</h2><p>{image.name}{queue.length > 0 ? ` · 另有 ${queue.length} 张图片等待复核` : ""} · 选择资料类型后开始识别。图片会发送到服务器，复核后加入测算资料。</p>
    <div className="rd-actions"><label>资料类型 <select className="rd-btn" value={kind} disabled={busy || disabled || rows.length > 0} onChange={event => setKind(event.target.value as ImageKind)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{!rows.length && <button type="button" className="rd-btn" disabled={busy || disabled} onClick={() => void recognize(image)}>开始识别</button>}<button type="button" className="rd-btn" disabled={busy || disabled} onClick={() => { setRows([]); setImage(null); setPreview(""); setWarning(""); setError(""); }}>取消图片</button></div></>}
    {busy && <p role="status">正在处理，请稍候…</p>}{error && <p className="ui-field-error" role="alert">{error}</p>}{warning && <p role="status">{warning}</p>}
    {/* Original local image remains unoptimized for exact review. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {preview && <img className="rd-image-original" src={preview} alt="待复核的原始表格图片" />}
    {rows.length > 0 && <><p>表头也可以修改；无法辨认的数值请查原图补全，不能用 0 代替。只截到部分表格时请补齐必需表头和数据。</p><div className="rd-image-table"><table><thead><tr><th>行</th>{rows[0].map((_, column) => <th key={column}>列 {column + 1}<button type="button" disabled={busy || disabled || rows[0].length <= 1} aria-label={`删除第 ${column + 1} 列`} onClick={() => edit(rows.map(row => row.filter((_, index) => index !== column)))}>删除</button></th>)}<th>操作</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index}><th>{index + 1}</th>{row.map((cell, column) => <td key={column}><input aria-label={`第 ${index + 1} 行第 ${column + 1} 列`} value={cell ?? ""} disabled={busy || disabled} onChange={event => edit(rows.map((current, number) => number === index ? current.map((value, col) => col === column ? event.target.value : value) : current))} /></td>)}<td><button type="button" disabled={busy || disabled || rows.length <= 1} onClick={() => edit(rows.filter((_, number) => number !== index))}>删除行</button></td></tr>)}</tbody></table></div><div className="rd-actions"><button className="rd-btn" type="button" disabled={busy || disabled || rows.length >= 1000} onClick={() => edit([...rows, rows[0].map(() => null)])}>添加行</button><button className="rd-btn" type="button" disabled={busy || disabled || rows[0].length >= 100} onClick={() => edit(rows.map(row => [...row, null]))}>添加列</button></div><label className="rd-image-ack"><input type="checkbox" checked={reviewed} disabled={busy || disabled} onChange={event => setReviewed(event.target.checked)} />我已对照原图核对表头、姓名、月份、项目编码（含 O / 0）、工时和金额</label><div className="rd-actions"><button type="button" className="rd-btn" disabled={!reviewed || busy || disabled} onClick={() => void confirm()}>确认并加入测算资料</button><button type="button" className="rd-btn" disabled={busy || disabled} onClick={() => { setRows([]); setImage(null); setPreview(""); setWarning(""); setError(""); }}>取消本张图片</button></div></>}
  </section>;
}
