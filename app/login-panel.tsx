"use client";

import {useEffect,useRef,useState,type FormEvent} from "react";
import {wecomQrCallback} from "../server/access/wecom-login.mjs";
import "./login-panel.css";

type QrSession={url:string;origin:string;state:string};
export default function LoginPanel({wecomConfigured,passwordConfigured}:{wecomConfigured:boolean;passwordConfigured:boolean}){
 const [username,setUsername]=useState("");
 const [password,setPassword]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [tab,setTab]=useState(wecomConfigured?"wecom":"password");
 const [qr,setQr]=useState<QrSession|null>(null);
 const [qrError,setQrError]=useState("");
 const [qrExpired,setQrExpired]=useState(false);
 const [refresh,setRefresh]=useState(0);
 const panel=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!wecomConfigured)return;
  const controller=new AbortController();let expiry:ReturnType<typeof setTimeout>;let disposed=false;
  setQr(null);setQrError("");setQrExpired(false);
  // Deferral prevents a discarded StrictMode effect issuing a second OAuth cookie.
  const start=setTimeout(async()=>{
   const deadline=setTimeout(()=>controller.abort(),12000);
   try{
    const response=await fetch("/api/auth/wecom-qr",{method:"POST",cache:"no-store",signal:controller.signal});
    const data=await response.json() as Partial<QrSession>;
    if(!response.ok)throw new Error("二维码暂时无法加载，请重试。");
    if(typeof data.url!=="string"||typeof data.state!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(data.state)||new URL(data.url).origin!=="https://open.work.weixin.qq.com"||data.origin!==window.location.origin)throw new Error("登录地址配置异常，请联系管理员。");
    setQr(data as QrSession);expiry=setTimeout(()=>setQrExpired(true),600000);
   }catch(failure){if(!disposed)setQrError("登录组件暂时无法加载，请重试。");}
   finally{clearTimeout(deadline);}
  },100);
  return ()=>{disposed=true;clearTimeout(start);clearTimeout(expiry);controller.abort();};
 },[wecomConfigured,refresh]);
 useEffect(()=>{
  if(!qr||qrExpired||!panel.current)return;
  let disposed=false;let mounted:{unmount:()=>void}|undefined;
  type WecomSDK={createWWLoginPanel:(options:Record<string,unknown>)=>{unmount:()=>void}};
  const sdkWindow=window as unknown as {ww?:WecomSDK};
  async function mount(){
   try{
    if(!sdkWindow.ww)await new Promise<void>((resolve,reject)=>{
     const script=document.createElement("script");script.src="/login/wecom-jssdk-2.4.0.js";
     script.onload=()=>resolve();script.onerror=()=>reject(new Error("组件加载失败"));document.head.appendChild(script);
    });
    if(disposed||!panel.current)return;
    const params=new URL(qr!.url).searchParams;
    mounted=sdkWindow.ww!.createWWLoginPanel({el:panel.current,params:{login_type:"CorpApp",appid:params.get("appid"),agentid:params.get("agentid"),redirect_uri:new URL("/api/auth/callback",qr!.origin).toString(),state:qr!.state,lang:"zh",panel_size:"small",redirect_type:"callback"},onLoginSuccess:(result:{code?:string})=>{
     if(disposed||typeof result.code!=="string"||!result.code)return;
     const url=new URL("/api/auth/callback",qr!.origin);url.searchParams.set("state",qr!.state);url.searchParams.set("code",result.code);
     const callback=wecomQrCallback(url.toString(),qr!.origin,qr!.state);if(callback)window.location.assign(callback);
    },onLoginFail:()=>setQrError("企业微信登录失败，请重新加载后重试。")});
   }catch{if(!disposed)setQrError("企业微信组件暂时无法加载，请重试。");}
  }
  void mount();return ()=>{disposed=true;mounted?.unmount();};
 },[qr,qrExpired]);
 async function login(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;setBusy(true);setError("");
  try{
   const response=await fetch("/api/auth/password-login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password}),cache:"no-store"});
   const data=await response.json() as {error?:string};
   if(!response.ok)throw new Error(data.error||"登录失败，请稍后重试。");
   setPassword("");window.location.reload();
  }catch(failure){setError(failure instanceof Error?failure.message:"登录失败，请稍后重试。");setPassword("");setBusy(false);}
 }
 function selectTab(value:string){setTab(value);setError("");setPassword("");}
 return <main className="finance-login">
  <div className="finance-login-layout">
   <section className="finance-login-story" aria-label="溯驭技术">
    <img className="finance-login-logo" src="/login/suyu-logo.png" alt="SEEEx TECH 溯驭技术"/>
    <p className="finance-login-eyebrow"><span aria-hidden="true"/> 氢电耦合 · 智能电控</p>
    <h1>以技术驱动未来<br/><span>让协作更有力量</span></h1>
    <p className="finance-login-description">溯驭财务工作台 · 高效协同，清晰掌控</p>
    <img className="finance-login-illustration" src="/login/suyu-energy-green.svg" alt="氢能电控模块与数字协同平台"/>
    <div className="finance-login-story-bottom"><span>氢能电控</span><i aria-hidden="true"/><span>数字协同</span><i aria-hidden="true"/><span>高效管理</span></div>
   </section>
   <section className="finance-login-card" aria-labelledby="finance-login-title">
    <p className="finance-login-welcome">欢迎使用</p><h2 id="finance-login-title">溯驭财务工作台</h2>
    <div className="finance-login-tabs" role="tablist" aria-label="登录方式">
     {wecomConfigured&&<button id="finance-wecom-tab" type="button" role="tab" aria-selected={tab==="wecom"} aria-controls="finance-wecom-panel" tabIndex={tab==="wecom"?0:-1} disabled={busy} onClick={()=>selectTab("wecom")} onKeyDown={event=>{if(passwordConfigured&&["ArrowRight","ArrowLeft"].includes(event.key)){event.preventDefault();selectTab("password");document.getElementById("finance-password-tab")?.focus();}}}>企业微信登录</button>}
     {passwordConfigured&&<button id="finance-password-tab" type="button" role="tab" aria-selected={tab==="password"} aria-controls="finance-password-panel" tabIndex={tab==="password"?0:-1} disabled={busy} onClick={()=>selectTab("password")} onKeyDown={event=>{if(wecomConfigured&&["ArrowRight","ArrowLeft"].includes(event.key)){event.preventDefault();selectTab("wecom");document.getElementById("finance-wecom-tab")?.focus();}}}>账号密码登录</button>}
    </div>
    {wecomConfigured&&<div id="finance-wecom-panel" className="finance-login-scan" role="tabpanel" aria-labelledby="finance-wecom-tab" hidden={tab!=="wecom"}>
     <div className="finance-login-qr">
      {qr&&!qrExpired&&!qrError?<div ref={panel} className="finance-login-wecom-panel"/>:<div className="finance-login-qr-status" role="status"><span className="finance-login-qr-icon" aria-hidden="true">⌘</span><p>{qrExpired?"登录已过期":qrError||"正在加载企业微信登录…"}</p>{(qrExpired||qrError)&&<button type="button" onClick={()=>setRefresh(value=>value+1)}>重新加载</button>}</div>}

     </div>
     <p className="finance-login-scan-hint"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="6.5" y="2" width="11" height="20" rx="2"/><path d="M10 18h4"/></svg>支持桌面企业微信快捷登录或手机扫码</p>
    </div>}
    {passwordConfigured&&<div id="finance-password-panel" role="tabpanel" aria-labelledby="finance-password-tab" hidden={tab!=="password"}><form onSubmit={login}>
     <p className="finance-login-form-hint">使用您的财务工作台账号登录</p>
     <label htmlFor="finance-username">账号</label><input id="finance-username" name="username" autoComplete="username" placeholder="请输入账号" required maxLength={256} value={username} onChange={event=>setUsername(event.target.value)} disabled={busy}/>
     <label htmlFor="finance-password">密码</label><input id="finance-password" name="password" type="password" autoComplete="current-password" placeholder="请输入密码" required maxLength={1024} value={password} onChange={event=>setPassword(event.target.value)} disabled={busy}/>
     {error&&<p className="finance-login-error" role="alert">{error}</p>}<button className="finance-login-submit" type="submit" disabled={busy}>{busy?"正在登录…":"登录"}</button>
     <p className="finance-login-account-help">账号或密码问题，请联系系统管理员</p>
    </form></div>}
    {!passwordConfigured&&!wecomConfigured&&<p role="status">登录服务暂未开通，请联系管理员。</p>}
    <p className="finance-login-card-footer">安全连接 · 企业专属工作空间</p>
   </section>
  </div><footer className="finance-login-footer">SEEEx TECH · 溯驭技术</footer>
 </main>;
}
