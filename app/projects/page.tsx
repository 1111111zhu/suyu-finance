"use client";
import Link from "next/link";
import { WorkbenchShell } from "../rd-cost/workbench-shell";
import { getProjects, type RdProject } from "../rd-cost/rd-store";
import { useState } from "react";
import "../rd-cost/rd-cost.css";

export default function ProjectsPage() {
  const [projects] = useState<RdProject[]>(() => getProjects());
  return <WorkbenchShell><div className="rd-page-head"><div><h1>项目管理</h1><p>维护研发项目、预算和费用归集状态</p></div><button className="rd-btn primary">＋ 新建项目</button></div><div className="rd-grid rd-grid-4">{projects.map((p) => <Link className="rd-card rd-card-body" key={p.id} href={`/projects/${p.id}`} style={{textDecoration:"none",color:"inherit"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:22,color:"#277d5c"}}>▣</span><span className="rd-badge">{p.status === "active" ? "进行中" : "初始化"}</span></div><h2 style={{fontSize:17,marginTop:18}}>{p.name}</h2><p style={{color:"#69758a",fontSize:12,marginTop:5}}>{p.number}</p><div style={{display:"flex",justifyContent:"space-between",marginTop:22,fontSize:12,color:"#69758a"}}><span>预算 ¥{p.budget.toLocaleString()}</span><span>执行率 {p.budget ? (p.actual/p.budget*100).toFixed(1) : 0}% →</span></div></Link>)}</div></WorkbenchShell>;
}
