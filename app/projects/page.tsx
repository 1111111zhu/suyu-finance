"use client";

import {useAccess} from "../use-access";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { WorkbenchShell } from "../rd-cost/workbench-shell";
import { createProjectWithCharter, listMonthlyTotals, listPlatforms, listProjects, recognizeProjectCharter, type MonthlyTotal, type RdPlatform, type RdProject } from "../rd-cost/rd-client";
import { AnimatedAmount, TrendChart } from "./trend-chart";
import "../rd-cost/rd-cost.css";
import "./projects.css";

const money=(n:number)=>"¥"+n.toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});
const statusLabels:Record<RdProject["status"],string>={init:"待开始",active:"进行中",paused:"暂停",stopped:"停止",completed:"已完成"};
const initialForm={number:"",name:"",platformId:"",budget:"",startDate:"",endDate:""};
const expectedProjectNumber=/^R[DC][123]\d{2}\d{2,3}$/i;

export default function ProjectsPage(){
  const access=useAccess();

  const params=useSearchParams(),embedded=params.get("embed")==="1",router=useRouter();
  const [platforms,setPlatforms]=useState<RdPlatform[]>([]),[projects,setProjects]=useState<RdProject[]>([]),[monthly,setMonthly]=useState<MonthlyTotal[]>([]);
  const [error,setError]=useState(""),[loading,setLoading]=useState(true),[search,setSearch]=useState(""),[statusFilter,setStatusFilter]=useState("all"),[platformFilter,setPlatformFilter]=useState("all");
  const [dialogOpen,setDialogOpen]=useState(false),[completedExpanded,setCompletedExpanded]=useState(false),[form,setForm]=useState(initialForm),[file,setFile]=useState<File|null>(null),[extractedText,setExtractedText]=useState(""),[ocrStatus,setOcrStatus]=useState("manual"),[ocrMessage,setOcrMessage]=useState(""),[ocrLoading,setOcrLoading]=useState(false),[saving,setSaving]=useState(false),[formError,setFormError]=useState("");
  const fileInput=useRef<HTMLInputElement>(null),dialog=useRef<HTMLDialogElement>(null);

  async function refresh(){
    try{const [nextPlatforms,nextProjects,nextMonthly]=await Promise.all([listPlatforms(),listProjects(),listMonthlyTotals()]);setPlatforms(nextPlatforms);setProjects(nextProjects);setMonthly(nextMonthly);setError("");}
    catch(e){setError(e instanceof Error?e.message:"项目数据暂不可用。");}
    finally{setLoading(false);}
  }
  useEffect(()=>{let live=true;void Promise.all([listPlatforms(),listProjects(),listMonthlyTotals()]).then(([p,q,m])=>{if(live){setPlatforms(p);setProjects(q);setMonthly(m);}}).catch(e=>{if(live)setError(e instanceof Error?e.message:"项目数据暂不可用。");}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[]);
  useEffect(()=>{if(dialogOpen)dialog.current?.showModal();else if(dialog.current?.open)dialog.current.close();},[dialogOpen]);

  const filteredProjects=useMemo(()=>projects.filter(project=>{
    const query=search.trim().toLocaleLowerCase();
    const matchesText=!query||`${project.number} ${project.name} ${platforms.find(p=>p.id===project.platformId)?.name||""}`.toLocaleLowerCase().includes(query);
    return matchesText&&(statusFilter==="all"||project.status===statusFilter)&&(platformFilter==="all"||project.platformId===platformFilter);
  }),[projects,platforms,search,statusFilter,platformFilter]);
  const activeProjects=filteredProjects.filter(project=>project.status!=="completed");
  const completedProjects=filteredProjects.filter(project=>project.status==="completed");
  const trendPoints=useMemo(()=>{
    const byMonth=new Map<string,number>();
    monthly.filter(item=>platformFilter==="all"||item.platformId===platformFilter).forEach(item=>byMonth.set(item.month,(byMonth.get(item.month)||0)+item.total));
    return [...byMonth].sort(([a],[b])=>a.localeCompare(b)).map(([month,total])=>({month,total}));
  },[monthly,platformFilter]);

  function openCreate(){setForm(initialForm);setFile(null);setExtractedText("");setOcrStatus("manual");setOcrMessage("");setFormError("");setDialogOpen(true);}
  async function onFileChange(event:ChangeEvent<HTMLInputElement>){
    const next=event.target.files?.[0]||null;setFile(next);setExtractedText("");setOcrMessage("");setOcrStatus("manual");
    if(!next)return;
    if(next.size>20*1024*1024){setFormError("立项书不能超过 20 MB。");setFile(null);return;}
    setFormError("");setOcrLoading(true);
    try{const result=await recognizeProjectCharter(next);setExtractedText(result.extractedText);setOcrStatus(result.ocrStatus);setOcrMessage(result.warning);setForm(current=>({...current,name:current.name||result.fields.name,budget:current.budget||result.fields.budget,startDate:current.startDate||result.fields.startDate,endDate:current.endDate||result.fields.endDate}));}
    catch(e){setOcrMessage(e instanceof Error?e.message:"OCR未完成，请手动填写识别字段。");}
    finally{setOcrLoading(false);}
  }
  async function submitProject(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setFormError("");
    if(!form.number.trim()||!form.name.trim()||!form.platformId||!file||!form.budget||!form.startDate||!form.endDate){setFormError("请填写项目编号、名称、平台、预算和起止时间，并上传立项书。");return;}
    const budget=Number(form.budget);if(!Number.isFinite(budget)||budget<0){setFormError("经费预算应为不小于 0 的金额。");return;}
    if(form.endDate<form.startDate){setFormError("项目结束时间不能早于开始时间。");return;}
    setSaving(true);
    try{const project=await createProjectWithCharter({...form,budget,status:"init",file,extractedText,ocrStatus});await refresh();setDialogOpen(false);router.push(`/projects/${project.id}${embedded?"?embed=1":""}`);}
    catch(e){setFormError(e instanceof Error?e.message:"项目创建失败，请重试。");}
    finally{setSaving(false);}
  }
  const setField=(key:keyof typeof initialForm,value:string)=>setForm(current=>({...current,[key]:value}));
  const projectNumberNeedsReview=Boolean(form.number.trim())&&!expectedProjectNumber.test(form.number.trim());

  return <WorkbenchShell><section className="rd-projects" aria-labelledby="projects-title">
    <div className="rd-projects-head"><div><p className="rd-projects-kicker">PROJECT PORTFOLIO</p><h1 id="projects-title">研发项目</h1><p>按项目状态跟踪进展；平台用于归属筛选与费用汇总。</p></div><div className="rd-project-head-actions"><Link className="ui-button ui-button--ghost" href={`/projects/platforms${embedded?"?embed=1":""}`}>平台管理</Link>{access.manager&&<Link className="ui-button ui-button--ghost" href={`/rd-cost${embedded?"?embed=1":""}`}>费用测算</Link>}{access.manager&&<button className="ui-button ui-button--accent" type="button" onClick={openCreate}>＋ 新建项目</button>}</div></div>
    {access.loaded&&!access.manager&&<p className="rd-project-empty-note">当前为研发汇总只读权限，新增、修改及原始资料由经理处理。</p>}
    {error&&<p role="alert" className="ui-field-error">{error}</p>}
    <div className="rd-project-stage-counts">{(["init","active","paused","stopped"] as const).map(status=><div className={`rd-stage-count rd-stage-count--${status}`} key={status}><span>{statusLabels[status]}</span><strong>{projects.filter(project=>project.status===status).length}</strong><small>个项目</small></div>)}</div>
    <section className="ui-card rd-project-trend-card"><div className="rd-project-section-head"><div><p className="rd-projects-kicker">MONTHLY COST</p><h2>{platformFilter==="all"?"全部项目费用趋势":platforms.find(p=>p.id===platformFilter)?.name}</h2></div><label className="rd-filter-label">归属平台<select value={platformFilter} onChange={event=>setPlatformFilter(event.target.value)}><option value="all">全部平台</option>{platforms.map(platform=><option key={platform.id} value={platform.id}>{platform.name}</option>)}</select></label></div><TrendChart points={trendPoints} label="平台每月费用与累计费用"/></section>
    <div className="rd-project-list-head"><div><h2>项目清单</h2><span>{filteredProjects.length} 个项目</span></div><div className="rd-project-filters"><label className="rd-project-search"><span>搜索项目</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="项目名称或编号"/></label><label className="rd-filter-label">状态<select value={statusFilter} onChange={event=>{const next=event.target.value;setStatusFilter(next);if(next==="completed")setCompletedExpanded(true);}}><option value="all">全部状态</option><option value="init">待开始</option><option value="active">进行中</option><option value="paused">暂停</option><option value="stopped">停止</option><option value="completed">已完成</option></select></label></div></div>
    {loading?<div className="ui-empty rd-project-empty"><h3>正在读取项目</h3><p>请稍候…</p></div>:activeProjects.length||completedProjects.length?<>{activeProjects.length>0&&<div className="rd-project-grid">{activeProjects.map(project=>{
      const platform=platforms.find(item=>item.id===project.platformId),rate=project.budget?project.actual/project.budget*100:0;
      return <Link className="rd-project-card rd-project-card-link" key={project.id} href={`/projects/${project.id}${embedded?"?embed=1":""}`}><div className="rd-project-card-top"><span className="rd-project-number">{project.number}</span><span className={`ui-badge ${project.status==="active"?"ui-badge--success":project.status==="stopped"?"ui-badge--danger":"ui-badge--warning"}`}>{statusLabels[project.status]}</span></div><h3>{project.name}</h3><div className="rd-project-card-platform">{platform?.number?`${platform.number} · `:""}{platform?.name||"平台待确认"}</div><div className="rd-project-card-finance"><span>累计费用<strong><AnimatedAmount value={project.actual}/></strong></span><span>预算<strong>{money(project.budget)}</strong></span></div><div className="ui-progress" role="progressbar" aria-label="预算执行率" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100,Math.max(0,rate))}><div className="ui-progress-fill" style={{width:`${Math.min(100,Math.max(0,rate))}%`}}/></div><div className="rd-project-card-dates">{project.startDate||"起始日期待补"} — {project.endDate||"结束日期待补"}</div></Link>;
    })}</div>}{completedProjects.length>0&&<details className="rd-completed-projects" open={completedExpanded} onToggle={event=>setCompletedExpanded(event.currentTarget.open)}><summary><span>已完成项目</span><strong>{completedProjects.length}</strong><small>展开查看项目资料</small></summary><div className="rd-completed-list"><div className="rd-completed-list-head"><span>项目编号 / 名称</span><span>归属平台</span><span>累计费用</span></div>{completedProjects.map(project=>{const platform=platforms.find(item=>item.id===project.platformId);return <Link className="rd-completed-row" key={project.id} href={`/projects/${project.id}${embedded?"?embed=1":""}`}><span><strong>{project.number}</strong><small>{project.name}</small></span><span>{platform?.name||"平台待确认"}</span><strong>{money(project.actual)}</strong></Link>;})}</div></details>}</>:<div className="ui-empty rd-project-empty"><h3>{projects.length?"没有符合筛选条件的项目":"还没有研发项目"}</h3><p>{projects.length?"调整搜索或筛选条件。":"新建项目并上传立项书，系统会识别预算与起止日期。"}</p>{!projects.length&&access.manager&&<button className="ui-button ui-button--accent" type="button" onClick={openCreate}>＋ 新建项目</button>}</div>}
    <dialog className="ui-dialog rd-project-dialog rd-charter-dialog" ref={dialog} onClose={()=>setDialogOpen(false)} aria-labelledby="create-project-title">
      <form onSubmit={submitProject}><div className="ui-dialog-head"><div><p className="rd-dialog-kicker">PROJECT SETUP</p><h2 id="create-project-title">新建研发项目</h2></div><button className="ui-button ui-button--ghost ui-button--icon" type="button" aria-label="关闭" onClick={()=>setDialogOpen(false)}>×</button></div>
      <div className="ui-dialog-body"><p className="rd-dialog-description">项目编号由项目部提供。上传立项书后，系统在本机识别项目名称、预算和起止时间；提交前请核对识别结果。</p>
        <label className="rd-charter-drop"><input ref={fileInput} type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.tif,.tiff" onChange={onFileChange}/><span className="rd-charter-drop-icon">↑</span><strong>{file?.name||"上传立项书"}</strong><small>{ocrLoading?"正在识别文件…":"PDF、Word 或图片，最大 20 MB"}</small></label>
        {ocrMessage&&<p className={ocrStatus==="completed"?"rd-ocr-message":"rd-ocr-message warning"} role="status">{ocrMessage}</p>}
        <div className="rd-project-form-row"><label>项目编号<input value={form.number} onChange={event=>setField("number",event.target.value)} placeholder="按项目部立项编号填写" required/>{projectNumberNeedsReview?<small className="rd-number-warning">编号与常见格式示例不一致，请核对项目部提供的编号；仍可继续。</small>:<small>编号由项目部提供；仅提示格式差异，不会自动生成编号。</small>}</label><label>归属平台<select value={form.platformId} onChange={event=>setField("platformId",event.target.value)} required><option value="">选择平台</option>{platforms.map(platform=><option key={platform.id} value={platform.id}>{platform.number?`${platform.number} · `:""}{platform.name}</option>)}</select></label></div>
        <label className="rd-charter-field">项目名称<input value={form.name} onChange={event=>setField("name",event.target.value)} placeholder="可修改 OCR 识别结果" required/></label>
        <div className="rd-project-form-row"><label>经费预算（元）<input type="number" min="0" step="0.01" value={form.budget} onChange={event=>setField("budget",event.target.value)} required/></label><label>开始时间<input type="date" value={form.startDate} onChange={event=>setField("startDate",event.target.value)} required/></label></div>
        <label className="rd-charter-field">结束时间<input type="date" value={form.endDate} onChange={event=>setField("endDate",event.target.value)} required/></label>
        <p className="rd-charter-privacy">立项书保存到研发数据库；OCR 由本机中文识别引擎处理。识别内容可在此处修改后提交。</p>
        {formError&&<p className="ui-field-error" role="alert">{formError}</p>}
      </div><div className="ui-dialog-footer"><button className="ui-button ui-button--ghost" type="button" onClick={()=>setDialogOpen(false)} disabled={saving}>取消</button><button className="ui-button ui-button--accent" type="submit" disabled={saving||ocrLoading}>{saving?"正在创建…":"创建项目"}</button></div></form>
    </dialog>
  </section></WorkbenchShell>;
}
