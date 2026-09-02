"use client";
import { useEffect, useState } from "react";
import "./review.css";

type Policy={id:string;title:string;department:string;region:string;publishDate?:string;deadline?:string;content?:string;summary:string;url:string;sourceName:string};
type Feed={policies:Policy[]};
const isStructuredApi=(url:string)=>/\/gateway\/.*\/api\//.test(url);

export default function PolicyReviewPage(){
 const [policy,setPolicy]=useState<Policy|undefined>(),[error,setError]=useState("");
 useEffect(()=>{const id=new URLSearchParams(window.location.search).get("id");fetch(`/policies.json?t=${Date.now()}`,{cache:"no-store"}).then(r=>r.json() as Promise<Feed>).then(data=>{const matched=data.policies.find(item=>item.id===id);if(!matched)throw new Error("未找到该政策");setPolicy(matched)}).catch(()=>setError("未找到该政策，可能已在最新同步中下线。"))},[]);
 if(error)return <main className="review-page"><a href="/policy">← 返回项目申报</a><p>{error}</p></main>;
 if(!policy)return <main className="review-page">正在加载复核正文…</main>;
 const readable=(policy.content||policy.summary||"").replace(/\s+/g," ").trim();
 const canOpenExternal=policy.url.startsWith("https://")&&!isStructuredApi(policy.url);
 return <main className="review-page"><header><a href="/policy">← 返回项目申报</a><span>官方原文复核</span></header><article><p className="review-status">{canOpenExternal?"已保留官方原链；请以下方复核文本与原链交叉核对。":"本条来自官方结构化申报接口，已展示接口返回的完整通知正文，避免直接打开 JSON 乱码。"}</p><h1>{policy.title}</h1><dl><div><dt>来源</dt><dd>{policy.sourceName}</dd></div><div><dt>地区</dt><dd>{policy.region}</dd></div><div><dt>发布日期</dt><dd>{policy.publishDate||"见原文"}</dd></div><div><dt>申报截止</dt><dd>{policy.deadline||"待原文确认"}</dd></div></dl>{canOpenExternal&&<a className="external" href={policy.url} target="_blank" rel="noopener noreferrer">打开官方原链 ↗</a>}<section><h2>复核正文</h2>{readable.split(/(?<=[。；])/).filter(Boolean).map((paragraph,index)=><p key={index}>{paragraph}</p>)}</section></article></main>;
}
