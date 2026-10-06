"use client";
import {useRef,useState} from "react";
import {useSearchParams} from "next/navigation";
import Link from "next/link";
import {WorkbenchShell} from "../workbench-shell";
import "../rd-cost.css";
import "./results.css";

type Preview={startMonth:string;endMonth:string;scope:string;ready:boolean;records:{scope:string;month:string;total:string;fileAvailable:boolean}[];missing:{scope:string;month:string;reason:string}[]};
const currentMonth=()=>`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}`;
export default function ResultsPage(){
  const params=useSearchParams();
  const [start,setStart]=useState(currentMonth),[end,setEnd]=useState(currentMonth),[scope,setScope]=useState("苏州");
  const [preview,setPreview]=useState<Preview|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const version=useRef(0);
  const invalid=!/^\d{4}-(0[1-9]|1[0-2])$/.test(start)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(end)||start>end;
  function change(update:()=>void){++version.current;update();setPreview(null);setMessage("");}
  function url(download=false){return "/api/rd/result-exports?"+new URLSearchParams({startMonth:start,endMonth:end,scope,...download?{download:"1"}:{}});}
  async function inspect(){
    const request=++version.current;setBusy(true);setMessage("");setPreview(null);
    try{const response=await fetch(url(),{cache:"no-store"});const data=await response.json() as Preview & {error?:string};if(!response.ok)throw new Error(data.error||"查询失败，请重试");if(request===version.current)setPreview(data);}
    catch(e){if(request===version.current)setMessage(e instanceof Error?e.message:"查询失败");}
    finally{if(request===version.current)setBusy(false);}
  }
  async function download(){
    setBusy(true);setMessage("");
    try{
      const response=await fetch(url(true),{cache:"no-store"});
      if(!response.ok){const data=await response.json() as {error?:string};throw new Error(data.error||"导出失败，请重新查询");}
      const blob=await response.blob(),href=URL.createObjectURL(blob),anchor=document.createElement("a");
      anchor.href=href;anchor.download=`研发费用测算结果_${scope||"全部主体"}_${start}至${end}.zip`;anchor.click();
      window.setTimeout(()=>URL.revokeObjectURL(href),1000);setMessage("下载已开始，压缩包中按核算主体和月份保存原模板 Excel。");
    }catch(e){setMessage(e instanceof Error?e.message:"导出失败");setPreview(null);}
    finally{setBusy(false);}
  }
  return <WorkbenchShell><div className="rd-results"><div className="rd-page-head"><div><h1>按月导出测算结果</h1><p>选择开始和结束月份，包含首尾月份；每个月保留独立的原模板 Excel。</p></div><Link className="rd-btn" href={"/rd-cost"+(params.get("embed")==="1"?"?embed=1":"")}>返回研发费用测算</Link></div>
    <section className="rd-card rd-card-body">
      <div className="rd-actions" style={{flexWrap:"wrap",gap:16,alignItems:"end"}}>
        <label>核算主体<select className="rd-btn" aria-label="导出核算主体" value={scope} disabled={busy} onChange={e=>change(()=>setScope(e.target.value))}><option>苏州</option><option>杭州</option><option>连云港</option><option value="">全部主体</option></select></label>
        <label>开始月份<input className="rd-btn" type="month" aria-label="开始月份" min="2000-01" max="2100-12" value={start} disabled={busy} onInput={e=>{const value=e.currentTarget.value;change(()=>setStart(value));}}/></label>
        <label>结束月份<input className="rd-btn" type="month" aria-label="结束月份" min="2000-01" max="2100-12" value={end} disabled={busy} onInput={e=>{const value=e.currentTarget.value;change(()=>setEnd(value));}}/></label>
        <button className="rd-btn primary" disabled={busy||invalid} onClick={inspect}>{busy?"处理中…":"查询可导出结果"}</button>
      </div>
      {invalid&&<p className="ui-field-error" role="alert">请填写有效月份，结束月份不能早于开始月份。</p>}
      <p style={{marginTop:16,color:"var(--ui-muted)",fontSize:13}}>例如 2026-03 至 2026-08，会导出 3、4、5、6、7、8 月。相同主体、相同月份只导出最新测算版本。全部主体按所选区间内有测算记录的主体检查完整性。</p>
      <p style={{color:"var(--ui-muted)",fontSize:13}}>完整结果从本功能启用后开始留存；此前仅保存摘要的月份需重新测算。缺少月份或完整文件时暂不导出，避免遗漏。</p>
    </section>
    {message&&<p role="status" style={{marginTop:16}}>{message}</p>}
    {preview&&<section className="rd-card rd-card-body" style={{marginTop:20}}>
      <h2 style={{fontSize:18}}>导出范围：{preview.startMonth} 至 {preview.endMonth}</h2>
      {preview.missing.length>0&&<div role="alert"><p>以下月份暂不能导出，请补充测算结果：</p><ul>{preview.missing.map(m=><li key={`${m.scope}-${m.month}`}>{m.scope||"全部主体"} · {m.month}：{m.reason}</li>)}</ul></div>}
      {preview.records.length>0?<div className="ui-table-wrap"><table className="ui-table"><thead><tr><th>核算主体</th><th>月份</th><th>测算金额（元）</th><th>完整结果文件</th></tr></thead><tbody>{preview.records.map(r=><tr key={`${r.scope}-${r.month}`}><td>{r.scope}</td><td>{r.month}</td><td>{Number(r.total).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td>{r.fileAvailable?"已保存":"未留存，请重新测算"}</td></tr>)}</tbody></table></div>:<p>所选区间没有测算结果。</p>}
      <button className="rd-btn primary" style={{marginTop:16}} disabled={busy||!preview.ready} onClick={download}>导出所选月份 Excel（ZIP）</button>
    </section>}
  </div></WorkbenchShell>;
}
