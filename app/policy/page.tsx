"use client";
/* eslint-disable @next/next/no-html-link-for-pages, react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import "./policy.css";
import "./policy-overrides.css";

type Policy={id:string;title:string;region:string;level:string;department:string;publishDate?:string;deadline?:string;deadlineTime?:string;category:string;summary:string;content?:string;url:string;sourceName:string;firstSeenAt:string;matchScore?:number;filterReason?:string};
type Feed={updatedAt:string;policies:Policy[];filteredPolicies?:Policy[];filteredCount?:number;sources:{id:string;name:string;ok:boolean;count:number}[]};
const fallback:Feed={updatedAt:"",sources:[],policies:[]};
const daysUntil=(date?:string)=>date?Math.ceil((new Date(`${date}T23:59:59+08:00`).getTime()-Date.now())/86400000):null;
function financialRequirements(policy:Policy){
 const text=`${policy.title} ${policy.summary} ${policy.content||""}`.replace(/\s+/g," ");
 const amount="(\\d+(?:\\.\\d+)?\\s*(?:亿元|亿|万元|万|元|%|个百分点|年))";
 const rules=[
  ["研发投入",new RegExp(`研发(?:投入|经费|费用)[^。；]{0,36}?${amount}`)],
  ["营业收入",new RegExp(`(?:营业收入|营收)[^。；]{0,36}?${amount}`)],
  ["配套资金",new RegExp(`(?:配套资金|自筹资金)[^。；]{0,36}?${amount}`)],
  ["投资金额",new RegExp(`(?:固定资产投资|投资额|实际投资)[^。；]{0,36}?${amount}`)],
  ["审计年限",new RegExp(`(?:审计报告|财务报告)[^。；]{0,28}?${amount}`)],
  ["纳税条件",new RegExp(`(?:纳税|税收)[^。；]{0,36}?${amount}`)],
  ["资产负债",new RegExp(`资产负债率[^。；]{0,28}?${amount}`)],
 ] as const;
 const result=rules.flatMap(([label,pattern])=>{const match=text.match(pattern);if(!match)return [];const prefix=match[0].match(/(?:不低于|不少于|不超过|以上|以下|新增|最高)/)?.[0]||"";const value=match[1].replace(/\s/g,"").replace("个百分点","%");return [`${label}${prefix}${value}`.slice(0,14)]});
 return [...new Set(result)].slice(0,3).length?[...new Set(result)].slice(0,3):["财务条件见原文"];
}
const formatDate=(v:string)=>{try{return new Intl.DateTimeFormat("zh-CN",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Shanghai"}).format(new Date(v))}catch{return v}};

function supportItems(policy:Policy){
 const text=`${policy.title} ${policy.summary} ${policy.content||""}`;
 const terms=["补助","补贴","奖励","资助","贴息","贷款","减免"];
 const tags=terms.flatMap((term,index)=>text.split(/[。；]/).filter(sentence=>sentence.includes(term)).map(sentence=>{
  const amount=sentence.match(/(\d+(?:\.\d+)?)\s*(亿元|亿|万元|万|元|个百分点|%)/);
  const name=term==="补贴"?"补助":term;
  const value=amount?`${amount[1]}${amount[2]==="个百分点"?"%":amount[2]}`:"";
  return {label:`${name}${value}`.slice(0,8),priority:Number(amount?.[1]||0)+70-index*7};
 })).filter((item,index,list)=>item.label&&list.findIndex(other=>other.label===item.label)===index).sort((a,b)=>b.priority-a.priority).slice(0,3).map(item=>item.label);
 return tags.length?tags:["政策支持"];
}

function Icon({name}:{name:"menu"|"search"|"file"|"salary"|"folder"|"plus"|"chevron"}){
 const paths={menu:<><path d="M4 7h16M4 12h16M4 17h16"/></>,search:<><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></>,file:<><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h5"/></>,salary:<><rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="9" r="2"/><path d="M8.5 17c.7-2.1 2-3 3.5-3s2.8.9 3.5 3"/></>,folder:<><path d="M3 7.5h7l2-2h3l3 3v10.5H3z"/></>,plus:<><path d="M12 5v14M5 12h14"/></>,chevron:<><path d="m7 9 5 5 5-5"/></>};
 return <svg className={`icon icon-${name}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function PolicyPage(){
 const [feed,setFeed]=useState<Feed>(fallback),[loading,setLoading]=useState(true),[region,setRegion]=useState("全部地区"),[query,setQuery]=useState(""),[tab,setTab]=useState<"pending"|"selected">("pending"),[selected,setSelected]=useState<string[]>([]);
 useEffect(()=>{const saved=localStorage.getItem("policy-radar-selected-ids");if(saved)try{setSelected(JSON.parse(saved))}catch{};fetch(`/policies.json?t=${Date.now()}`,{cache:"no-store"}).then(r=>r.json() as Promise<Feed>).then(setFeed).catch(()=>setFeed(fallback)).finally(()=>setLoading(false))},[]);
 const items=useMemo(()=>feed.policies.map(p=>({...p,remaining:daysUntil(p.deadline)})).filter(p=>(tab==="selected"?selected.includes(p.id):!selected.includes(p.id))&&(region==="全部地区"||p.region===region)&&(!query||`${p.title}${p.department}${p.category}`.includes(query.trim()))).sort((a,b)=>(b.matchScore||0)-(a.matchScore||0)),[feed.policies,query,region,selected,tab]);
 const remove=(id:string)=>setSelected(current=>{const next=current.filter(x=>x!==id);localStorage.setItem("policy-radar-selected-ids",JSON.stringify(next));return next});
 const add=(id:string)=>setSelected(current=>{const next=current.includes(id)?current:[...current,id];localStorage.setItem("policy-radar-selected-ids",JSON.stringify(next));return next});
 const healthy=feed.sources.filter(s=>s.ok).length;
 return <main className="application-page"><aside className="app-sidebar"><a className="suyu-logo" href="/"><span className="logo-mark">S</span><strong>溯驭财务</strong></a><nav className="side-nav"><a href="/"><Icon name="file"/>研发费用</a><a href="/salary/"><Icon name="salary"/>工资表</a><a className="active" href="/policy"><Icon name="folder"/>项目申报</a></nav><div className="side-foot">{loading?"正在更新政策…":`${healthy}/${feed.sources.length||"-"} 官方来源在线`}</div></aside><section className="app-content"><header className="app-header"><button className="menu-button" aria-label="展开菜单"><Icon name="menu"/></button><label className="global-search"><Icon name="search"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索项目、工时、费用、单据编号等"/><kbd>/</kbd></label></header><div className="application-body"><div className="page-intro"><h1>政府项目申报</h1><p>浏览可申报的政府项目，选择后进入申报准备</p></div><div className="tabs" role="tablist"><button className={tab==="pending"?"active":""} onClick={()=>setTab("pending")}>待选项目 <b>{Math.max(0,feed.policies.length-selected.length)}</b></button><button className={tab==="selected"?"active":""} onClick={()=>setTab("selected")}>已选项目 <b>{selected.length}</b></button></div><div className="application-filters"><label><select value={region} onChange={e=>setRegion(e.target.value)}><option>全部地区</option><option>国家</option><option>浙江省</option><option>江苏省</option><option>杭州市</option><option>苏州市</option><option>连云港市</option></select><Icon name="chevron"/></label><span className="update-note">更新于 {formatDate(feed.updatedAt)}</span></div><div className="project-table" role="table"><div className="table-head" role="row"><span>项目名称</span><span>支持方式</span><span>申报截止</span><span>财务要求</span><span>查看原文</span><span>操作</span></div>{items.map(policy=>{const score=policy.matchScore??0;const deadline=policy.remaining===null?"长期受理":policy.remaining<0?"已截止":`剩余 ${policy.remaining} 天`;return <article className="project-row" role="row" key={policy.id}><div className="project-name"><span className="match-badge" style={{"--score":score} as CSSProperties}><strong>{score}</strong><small>匹配度</small></span><div><h2>{policy.title}</h2><p>{policy.summary||"支持企业开展科技创新与产业化应用。"}</p></div></div><div className="support-cell">{supportItems(policy).map(item=><span key={item}>{item}</span>)}</div><span className={`deadline-cell ${policy.remaining!==null&&policy.remaining>=0&&policy.remaining<=30?"soon":""}`}>{deadline}</span><ul className="requirements">{financialRequirements(policy).map(item=><li key={item}>{item}</li>)}</ul><a className="source-link" href={policy.url} target="_blank" rel="noopener noreferrer">查看原文</a>{tab==="selected"?<button className="remove-button" onClick={()=>remove(policy.id)}>移除</button>:<button className="select-button" onClick={()=>add(policy.id)} aria-label="加入已选项目"><Icon name="plus"/></button>}</article>})}{!items.length&&<div className="empty-projects">暂时没有符合当前条件的项目。</div>}</div></div></section></main>;
}
