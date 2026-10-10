"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {listTrash,manageRdItem,type ManagedKind,type ManagementAction,type TrashItem} from "../rd-cost/rd-client";
import "./management.css";

export type ManagedItem = {id:string;name:string;number:string|null;projectCount?:number};
export type ManagementRequest = {mode:"menu"|"delete";kind:ManagedKind;item:ManagedItem} | {mode:"create";kind:ManagedKind;platformId?:string;platformName?:string} | {mode:"trash"};
type Props = {request:ManagementRequest;onClose:()=>void;onBusy:(busy:boolean)=>void;onMutated:(message:string)=>Promise<void>};
const label=(kind:ManagedKind)=>kind==="platform"?"平台":"项目";
const money=(n:number)=>"¥"+n.toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});

export function TrashIcon(){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" strokeLinecap="round" strokeLinejoin="round"/></svg>;}

export function ManagementDialog({request,onClose,onBusy,onMutated}:Props){
  const [mode,setMode]=useState<string>(request.mode==="delete"?"confirm-delete":request.mode);
  const [form,setForm]=useState({name:"",number:""}),[error,setError]=useState("");
  const [busy,setBusy]=useState(false),[trash,setTrash]=useState<TrashItem[]>([]),[trashLoading,setTrashLoading]=useState(false),[restore,setRestore]=useState<TrashItem|null>(null);
  const dialog=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null),lock=useRef(false),live=useRef(true),trashVersion=useRef(0);
  const kind=request.mode==="trash"?(restore?.kind||"platform"):request.kind;
  const item="item" in request?request.item:null;
  useEffect(()=>{
    const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    live.current=true;dialog.current?.showModal();cancel.current?.focus();
    return()=>{live.current=false;dialog.current?.close();if(opener?.isConnected)opener.focus();else document.getElementById("management-trigger")?.focus();};
  },[]);
  useEffect(()=>{cancel.current?.focus();},[mode]);
  async function refreshTrash(){
    const version=++trashVersion.current;setTrashLoading(true);setError("");
    try{const rows=await listTrash();if(live.current&&version===trashVersion.current)setTrash(rows);}
    catch(e){if(live.current&&version===trashVersion.current)setError(e instanceof Error?e.message:"回收站读取失败。");}
    finally{if(live.current&&version===trashVersion.current)setTrashLoading(false);}
  }
  useEffect(()=>{if(request.mode==="trash"){const timer=setTimeout(()=>void refreshTrash(),0);return()=>clearTimeout(timer);}},[]);
  function close(){if(!lock.current)onClose();}
  function changeMode(next:string){setError("");setMode(next);}
  function submitForm(event:FormEvent){
    event.preventDefault();if(lock.current)return;
    if(!form.name.trim()||!form.number.trim()){setError(`请填写${label(kind)}名称和编码。`);return;}
    setForm({name:form.name.trim(),number:form.number.trim().toUpperCase()});changeMode("confirm-create");
  }
  async function mutate(action:ManagementAction,message:string){
    if(lock.current)return;lock.current=true;setBusy(true);setError("");onBusy(true);
    try{
      await manageRdItem(action);await onMutated(message);
      if(action.action==="restore"&&live.current){setRestore(null);setMode("trash");await refreshTrash();}
      else onClose();
    }catch(e){if(live.current)setError(e instanceof Error?e.message:"操作失败，请重试。");}
    finally{lock.current=false;if(live.current)setBusy(false);onBusy(false);}
  }
  const title=mode==="trash"?"回收站":mode==="confirm-restore"?`确定要恢复${label(kind)}？`:mode==="confirm-delete"?`确定要删除${label(kind)}？`:mode==="confirm-create"?`确定要增加${label(kind)}？`:mode==="create"?`增加${label(kind)}`:`管理${label(kind)}`;
  return <dialog ref={dialog} className="ui-dialog rd-project-dialog rd-management-dialog" aria-labelledby="management-dialog-title" aria-describedby="management-dialog-description" aria-busy={busy||trashLoading} onCancel={event=>{event.preventDefault();close();}}>
    <div className="ui-dialog-head"><h2 id="management-dialog-title">{title}</h2><button className="ui-button ui-button--ghost ui-button--icon" type="button" aria-label="关闭管理对话框" disabled={busy} onClick={close}>×</button></div>
    <div className="ui-dialog-body">
      <p className="rd-dialog-description" id="management-dialog-description">{mode==="trash"?"删除的数据暂存于此，费用台账保留，恢复后重新计入平台。":mode==="confirm-delete"?"删除后移入回收站，相关费用记录保留，可恢复。":mode==="confirm-create"?"请核对名称和编码，确认后保存至数据库。":mode==="confirm-restore"?"恢复后重新显示在平台管理中，并恢复对应费用汇总。":"维护名称和编码，不设置预算。"}</p>
      {error&&<p className="ui-field-error" role="alert">{error}</p>}
      {mode==="create"&&<form id="managed-create-form" className="rd-project-form" onSubmit={submitForm}>
        {request.mode==="create"&&request.platformName&&<p>所属平台：{request.platformName}</p>}
        <label className="ui-field"><span>{label(kind)}名称</span><input className="ui-input" value={form.name} maxLength={200} required onChange={e=>setForm({...form,name:e.target.value})} autoComplete="off" /></label>
        <label className="ui-field"><span>{label(kind)}编码</span><input className="ui-input" value={form.number} maxLength={80} required onChange={e=>setForm({...form,number:e.target.value})} autoComplete="off" /></label>
      </form>}
      {mode==="confirm-create"&&<dl className="rd-management-summary"><div><dt>{label(kind)}名称</dt><dd>{form.name}</dd></div><div><dt>{label(kind)}编码</dt><dd>{form.number}</dd></div>{request.mode==="create"&&request.platformName&&<div><dt>所属平台</dt><dd>{request.platformName}</dd></div>}</dl>}
      {(mode==="menu"||mode==="confirm-delete")&&item&&<><p><strong>{item.name}</strong></p><p>{item.number||"编码待补充"}</p>{kind==="platform"&&<p>{mode==="menu"?`平台下共有 ${item.projectCount??0} 个在用项目。`:`平台下 ${item.projectCount??0} 个在用项目也将暂时隐藏，恢复平台后重新显示。已单独删除的项目仍留在回收站。`}</p>}</>}
      {mode==="confirm-restore"&&restore&&<><p><strong>{restore.name}</strong> · {restore.number||"编码待补充"}</p>{restore.kind==="platform"&&<p>恢复平台及随平台隐藏的项目；已单独删除的项目不会被一并恢复。</p>}</>}
      {mode==="trash"&&<>{trashLoading?<p role="status">正在读取回收站…</p>:error?<button className="ui-button ui-button--ghost" onClick={()=>void refreshTrash()}>重新读取</button>:!trash.length?<div className="ui-empty"><h3>回收站为空</h3><p>删除的平台和项目会暂存在这里。</p></div>:<ul className="rd-trash-list">{trash.map(t=><li key={t.kind+":"+t.id}><h3>{label(t.kind)} · {t.name}</h3><p>{t.number||"编码待补充"}{t.platformName?` · ${t.platformName}`:""}</p><p>删除时间：{new Date(t.deletedAt).toLocaleString("zh-CN")}</p><p>保留费用：{money(t.actual)}</p>{t.parentDeleted&&<p>请先恢复所属平台。</p>}<button className="ui-button ui-button--ghost ui-button--sm" type="button" disabled={busy||t.parentDeleted} aria-label={`恢复${label(t.kind)}：${t.name}`} onClick={()=>{setRestore(t);changeMode("confirm-restore");}}>恢复</button></li>)}</ul>}</>}
    </div>
    <div className="ui-dialog-footer">
      <button ref={cancel} className="ui-button ui-button--ghost" type="button" disabled={busy} onClick={()=>{if(mode==="confirm-create")changeMode("create");else if(mode==="confirm-restore"){setRestore(null);changeMode("trash");}else close();}}>{mode==="confirm-create"?"返回修改":mode==="trash"?"关闭":"取消"}</button>
      {mode==="create"&&<button className="ui-button ui-button--accent" type="submit" form="managed-create-form">下一步</button>}
      {mode==="menu"&&<button className="ui-button ui-button--danger" type="button" onClick={()=>changeMode("confirm-delete")}>删除{label(kind)}</button>}
      {mode==="confirm-create"&&request.mode==="create"&&<button className="ui-button ui-button--accent" type="button" disabled={busy} onClick={()=>void mutate({action:"create",kind:request.kind,...form,...request.platformId?{platformId:request.platformId}:{}},`已增加${label(kind)}：${form.name}`)}>{busy?"正在保存…":"确定增加"}</button>}
      {mode==="confirm-delete"&&item&&<button className="ui-button ui-button--danger" type="button" disabled={busy} onClick={()=>void mutate({action:"delete",kind,id:item.id},`已移入回收站：${item.name}`)}>{busy?"正在移入…":"确定删除"}</button>}
      {mode==="confirm-restore"&&restore&&<button className="ui-button ui-button--accent" type="button" disabled={busy||restore.parentDeleted} onClick={()=>void mutate({action:"restore",kind:restore.kind,id:restore.id},`已恢复：${restore.name}`)}>{busy?"正在恢复…":"确定恢复"}</button>}
    </div>
  </dialog>;
}
