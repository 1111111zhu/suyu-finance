"use client";
import Link from "next/link";
import {Fragment,useState} from "react";
import type {RdProject} from "../rd-cost/rd-client";
import {buildProjectHierarchy,hierarchyTotals} from "./hierarchy";

const money=(n:number)=>"¥"+n.toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});
const statusOf=(p:RdProject)=>p.sourceStatus || (p.sourceRecords?.length ? "待补充" : ({init:"立项",active:"运行",paused:"暂停",stopped:"停止",completed:"完成"}[p.status] || "待补充"));
const entityOf=(p:RdProject)=>p.financialEntity || "待核实";
type Props={projects:RdProject[];embedded:boolean;managing:boolean;busy:boolean;platformTotal:number;platformDirect:number;onManage:(project:RdProject)=>void};

export function ProjectTree({projects,embedded,managing,busy,platformTotal,platformDirect,onManage}:Props){
  const [query,setQuery]=useState(""),[status,setStatus]=useState(""),[entity,setEntity]=useState(""),[year,setYear]=useState("");
  const [expanded,setExpanded]=useState<Set<string>>(new Set());
  const tree=buildProjectHierarchy(projects),totals=hierarchyTotals(tree);
  const byCode=new Map(tree.map(row=>[row.project.number,row]));
  const filtering=Boolean(query.trim()||status||entity||year);
  const matches=new Set(projects.filter(p=>{
    const needle=query.trim().toLowerCase();
    return (!needle||`${p.name} ${p.number} ${(p.materials??[]).map(m=>`${m.number} ${m.name}`).join(" ")}`.toLowerCase().includes(needle))
      &&(!status||statusOf(p)===status)&&(!entity||entityOf(p)===entity)&&(!year||String(p.sourceYear??"待补充")===year);
  }).map(p=>p.number));
  const visibleCodes=new Set(matches);
  if(filtering) for(const code of matches){
    let parent=byCode.get(code)?.parentCode;
    const seen=new Set<string>();
    while(parent&&!seen.has(parent)){seen.add(parent);visibleCodes.add(parent);parent=byCode.get(parent)?.parentCode;}
  }
  const visible=tree.filter(row=>{
    if(filtering) return visibleCodes.has(row.project.number);
    let parent:string|null|undefined=row.parentCode;
    const seen=new Set<string>();
    while(parent&&!seen.has(parent)){seen.add(parent);if(!expanded.has(parent)) return false;parent=byCode.get(parent)?.parentCode;}
    return true;
  });
  const toggle=(code:string)=>setExpanded(previous=>{const next=new Set(previous);if(next.has(code))next.delete(code);else next.add(code);return next;});
  const clear=()=>{setQuery("");setStatus("");setEntity("");setYear("");};
  const matchedTotal=projects.filter(p=>matches.has(p.number)).reduce((sum,p)=>sum+Math.round(p.actual*100),0)/100;
  const statuses=[...new Set(projects.map(statusOf))],entities=[...new Set(projects.map(entityOf))];
  const years=[...new Set(projects.map(p=>String(p.sourceYear??"待补充")))].sort().reverse();
  return <>
    <div className="rd-project-filters" role="search" aria-label="筛选平台内项目">
      <label className="rd-project-search">搜索项目<input className="ui-input" type="search" placeholder="项目名称、编码或物料" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <label>运行状态<select className="ui-input" value={status} onChange={e=>setStatus(e.target.value)}><option value="">全部状态</option>{statuses.map(s=><option key={s}>{s}</option>)}</select></label>
      <label>财务主体<select className="ui-input" value={entity} onChange={e=>setEntity(e.target.value)}><option value="">全部主体</option>{entities.map(s=><option key={s}>{s}</option>)}</select></label>
      <label>来源年度<select className="ui-input" value={year} onChange={e=>setYear(e.target.value)}><option value="">全部年度</option>{years.map(s=><option key={s}>{s}</option>)}</select></label>
      {filtering&&<button className="ui-button ui-button--ghost" onClick={clear}>清除筛选</button>}
    </div>
    <div className="rd-tree-toolbar"><p role="status">{filtering?`匹配 ${matches.size} / ${projects.length} 个项目；父项目仅作层级定位。`:`共 ${projects.length} 个项目（含子项目）；物料明细不计入项目数量。`}</p>
      {!filtering&&<div><button className="ui-text-action" onClick={()=>setExpanded(new Set(projects.map(p=>p.number)))}>全部展开</button><button className="ui-text-action" onClick={()=>setExpanded(new Set())}>全部收起</button></div>}
    </div>
    {visible.length?<div className="ui-table-wrap"><table className="ui-table rd-tree-table"><thead><tr><th>项目名称</th><th>项目编码</th><th className="ui-numeric">已归集费用</th><th>管理</th></tr></thead><tbody>
      {visible.map(row=>{
        const p=row.project,hasChildren=row.childCount>0,materials=p.materials??[],hasMaterials=materials.length>0;
        const open=filtering||expanded.has(p.number),context=filtering&&!matches.has(p.number);
        const amount=hasChildren&&!open?(totals.get(p.number)??p.actual):p.actual;
        return <Fragment key={p.id}><tr className={`${hasChildren?"rd-project-tree-group":""} ${context?"rd-tree-context":""}`}>
          <td><div className="rd-tree-item" style={{paddingLeft:row.level*24}}>
            {hasChildren||hasMaterials?<button type="button" className="rd-tree-toggle" aria-label={`${open?"收起":"展开"}${hasChildren?"子项目":"物料明细"}：${p.name}`} aria-expanded={open} disabled={filtering} onClick={()=>toggle(p.number)}>{open?"▾":"▸"}</button>:<span className="rd-tree-spacer" aria-hidden="true">{row.level?"↳":"·"}</span>}
            <div className="rd-tree-text"><Link href={`/projects/${p.id}${embedded?"?embed=1":""}`}>{p.name}</Link>
              <p>{statusOf(p)} · {entityOf(p)} · {p.sourceYear?`${p.sourceYear} 年来源`:"来源年度待补充"}{hasChildren?` · ${row.childCount} 个子项目`:""}{hasMaterials?` · ${materials.length} 条物料明细`:""}{context?" · 层级定位（未匹配）":""}</p>
            </div></div></td><td className="rd-tree-code">{p.number}</td>
          <td className="ui-numeric">{context?"—":money(amount)}{hasChildren&&!context&&<small className="rd-tree-amount-note">{open?"本项目费用":"含子项目合计"}</small>}</td>
          <td><button className={"ui-button ui-button--ghost ui-button--sm"+(managing?" rd-project-delete":"")} disabled={busy} aria-label={`${managing?"删除":"管理"}项目：${p.name}`} onClick={()=>onManage(p)}>{managing?"删除":"管理"}</button></td>
        </tr>
        {open&&hasMaterials&&!context&&<tr className="rd-material-row"><td colSpan={4}><div style={{marginLeft:row.level*24+30}}><strong>物料明细</strong><span> 同一项目的物料记录，不另计项目费用</span><ul>{materials.map((m,i)=><li key={`${m.number}-${i}`}><span className="rd-tree-code">{m.number}</span><span>{m.name}</span></li>)}</ul></div></td></tr>}
        </Fragment>;
      })}
    </tbody><tfoot>{filtering&&<tr><th colSpan={2}>匹配项目费用合计（不含仅用于定位的父项目）</th><th className="ui-numeric">{money(matchedTotal)}</th><td/></tr>}<tr><th colSpan={2}>具体项目费用合计</th><th className="ui-numeric">{money(platformTotal-platformDirect)}</th><td/></tr>{platformDirect!==0&&<tr><th colSpan={2}>平台直归费用（未分配到具体项目）</th><th className="ui-numeric">{money(platformDirect)}</th><td/></tr>}<tr><th colSpan={2}>平台费用总计（不受筛选、展开影响）</th><th className="ui-numeric">{money(platformTotal)}</th><td/></tr></tfoot></table></div>:<div className="ui-empty"><h3>没有匹配的项目</h3><button className="ui-button ui-button--ghost" onClick={clear}>清除筛选</button></div>}
  </>;
}
