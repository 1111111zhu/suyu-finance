"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import "./local-workspace.css";

type NavItem = {
  id: string;
  label: string;
  description: string;
  src: string;
  icon: ReactNode;
};

type NavGroup = {
  id: string;
  label: string;
  icon: ReactNode;
  items: NavItem[];
};

const icons = {
  rd: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h5" /></>,
  folder: <path d="M3 7.5h7l2-2h3l3 3v10.5H3z" />,
  bot: <><rect x="5" y="7" width="14" height="12" rx="3" /><path d="M12 3v4M8 12h.01M16 12h.01M9 16h6" /></>,
  payroll: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h6" /></>,
  directory: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 7h5m-5 4h5m-5 4h4" /></>,
  batches: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
  analysis: <><path d="M4 19V11m5 8V6m5 13v-9m5 9V4" /><path d="M3 20h18" /></>,
  email: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>,
};

const groups: NavGroup[] = [
  {
    id: "rd",
    label: "研发费用",
    icon: icons.rd,
    items: [
      { id: "rd-projects", label: "研发项目", description: "按项目状态跟踪研发项目并汇总费用", src: "/projects?embed=1", icon: icons.folder },
      { id: "rd-calculation", label: "研发费用测算", description: "上传资料并完成研发费用测算", src: "/rd-cost?embed=1", icon: icons.rd },
      { id: "rd-platforms", label: "平台管理", description: "管理平台项目与费用归集", src: "/projects/platforms?embed=1", icon: icons.folder },
      { id: "rd-analysis", label: "研发费用分析", description: "月度趋势与各项费用构成", src: "/rd-cost/analysis?embed=1", icon: icons.analysis },
      { id: "rd-assistant", label: "AI 助手", description: "辅助整理研发费用场景与材料", src: "/scenario/1?embed=1", icon: icons.bot },
    ],
  },
  {
    id: "salary",
    label: "工资表",
    icon: icons.payroll,
    items: [
      { id: "salary-auto", label: "自动算薪", description: "本月工资核算、资料导入与自动计算", src: "/salary/index.html?embed=1&v=20261010-tax-refund-v1#gross/upload", icon: icons.payroll },
      { id: "salary-directory", label: "人员归集", description: "在职工资人员准备与离职核对", src: "/salary-directory?embed=1", icon: icons.directory },
      { id: "salary-batches", label: "历史批次", description: "查看与管理历史工资批次", src: "/salary/index.html?embed=1&v=20261010-tax-refund-v1#batches", icon: icons.batches },
      { id: "salary-email", label: "邮件发送", description: "生成工资表邮件内容与附件", src: "/salary/index.html?embed=1&v=20261010-tax-refund-v1#net/email", icon: icons.email },
      { id: "salary-settings", label: "核算规则", description: "查看计薪、假勤与转正规则", src: "/salary/index.html?embed=1&v=20261010-tax-refund-v1#gross/rules", icon: icons.settings },
    ],
  },
];

function NavIcon({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;
}

export default function Home() {
  const [access,setAccess]=useState<{user?:{role:string;displayName:string;local?:boolean};capabilities?:{rd:boolean;payroll:boolean}}|null>(null);
  useEffect(()=>{let live=true; const refresh=()=>fetch('/api/auth/session',{cache:'no-store'}).then(r=>r.json()).then(data=>{if(live)setAccess(data as NonNullable<typeof access>)}).catch(()=>{if(live)setAccess({})});refresh();const timer=setInterval(refresh,60000);return()=>{live=false;clearInterval(timer)};},[]);
  const visibleGroups=groups.filter(group=>group.id==='salary'?access?.capabilities?.payroll:access?.capabilities?.rd);
  const searchParams = useSearchParams();
  const requestedItemId = searchParams.get("section");
  const initialItemId = groups.some((group) => group.items.some((item) => item.id === requestedItemId)) ? requestedItemId! : "rd-projects";
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ rd: true, salary: false });
  const [activeItemId, setActiveItemId] = useState(initialItemId);
  const [visitedItems, setVisitedItems] = useState<Record<string, boolean>>({ [initialItemId]: true });
  useEffect(()=>{if(access?.capabilities?.rd&&!access.capabilities.payroll&&activeItemId.startsWith('salary')){const timer=setTimeout(()=>{setActiveItemId('rd-projects');setVisitedItems({'rd-projects':true});},0);return()=>clearTimeout(timer);}},[access,activeItemId]);
  useEffect(()=>{if(access?.capabilities?.payroll&&!access.capabilities.rd&&!activeItemId.startsWith('salary')){const timer=setTimeout(()=>{setActiveItemId('salary-auto');setVisitedItems({'salary-auto':true});setExpandedGroups({salary:true});},0);return()=>clearTimeout(timer);}},[access,activeItemId]);
  const rosterMapping = useRef<unknown>(null);
  const pendingRoster = useRef<{ id: string; payload: unknown } | null>(null);

  const deliverRoster = useCallback(() => {
    const frame = document.querySelector<HTMLIFrameElement>('iframe[title="自动算薪"]');
    if (pendingRoster.current) frame?.contentWindow?.postMessage({ type: "suyu-payroll-roster-import", ...pendingRoster.current }, window.location.origin);
  }, []);

  const selectItem = useCallback((item: NavItem) => {
    setActiveItemId(item.id);
    setVisitedItems((current) => ({ ...current, [item.id]: true }));
    window.history.replaceState(null, "", `/?section=${encodeURIComponent(item.id)}`);
    if (item.id === "rd-analysis") requestAnimationFrame(() => {
      const frame = document.querySelector<HTMLIFrameElement>('iframe[title="研发费用分析"]');
      frame?.contentWindow?.postMessage({ type: "rd-analysis-refresh" }, window.location.origin);
    });
  }, []);

  useEffect(() => {
    const onNavigate = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (String(event.data?.itemId||"").startsWith("salary") && !access?.capabilities?.payroll) return;
      const directoryFrame = document.querySelector<HTMLIFrameElement>('iframe[title="人员归集"]');
      const salaryFrame = document.querySelector<HTMLIFrameElement>('iframe[title="自动算薪"]');
      const rulesFrame = document.querySelector<HTMLIFrameElement>('iframe[title="核算规则"]');
      if(event.data?.type === "suyu-roster-mapping-state" && event.source === directoryFrame?.contentWindow){
        rosterMapping.current=event.data.payload;
        rulesFrame?.contentWindow?.postMessage(event.data,window.location.origin);return;
      }
      if(event.data?.type === "suyu-roster-mapping-request" && event.source === rulesFrame?.contentWindow){
        setVisitedItems(current => current["salary-directory"] ? current : ({...current,"salary-directory":true}));
        if(rosterMapping.current)rulesFrame?.contentWindow?.postMessage({type:"suyu-roster-mapping-state",payload:rosterMapping.current},window.location.origin);
        directoryFrame?.contentWindow?.postMessage(event.data,window.location.origin);return;
      }
      if(event.data?.type === "suyu-roster-mapping-edit" && event.source === rulesFrame?.contentWindow){
        directoryFrame?.contentWindow?.postMessage(event.data,window.location.origin);return;
      }
      if (event.data?.type === "suyu-payroll-roster-transfer" && event.source === directoryFrame?.contentWindow) {
        pendingRoster.current = { id: event.data.id, payload: event.data.payload };
        const item = groups.flatMap(group => group.items).find(candidate => candidate.id === "salary-auto")!;
        // Keep the preparation page visible until the receiving payroll frame confirms.
        setVisitedItems(current => ({ ...current, [item.id]: true }));
        if (salaryFrame) deliverRoster();
        return;
      }
      if (event.data?.type === "suyu-payroll-roster-result" && event.source === salaryFrame?.contentWindow && event.data.id === pendingRoster.current?.id) {
        directoryFrame?.contentWindow?.postMessage(event.data, window.location.origin);
        pendingRoster.current = null;
        if (event.data.ok) selectItem(groups.flatMap(group => group.items).find(candidate => candidate.id === "salary-auto")!);
        return;
      }
      if (event.data?.type !== "suyu-workspace-navigate") return;
      const item = groups.flatMap((group) => group.items).find((candidate) => candidate.id === event.data.itemId);
      if (item) selectItem(item);
    };
    window.addEventListener("message", onNavigate);
    return () => window.removeEventListener("message", onNavigate);
  }, [selectItem, deliverRoster, access]);

  function toggleGroup(groupId: string) {
    setExpandedGroups((current) => ({ ...current, [groupId]: !current[groupId] }));
  }

  if(!access)return <main style={{padding:40}}>正在核验访问权限…</main>;
  if(!access.capabilities?.rd&&!access.capabilities?.payroll)return <main style={{padding:40}}><h1>财务工作台</h1><p>请使用企业微信登录后访问。</p><button type="button" onClick={()=>window.location.assign("/api/auth/login")}>企业微信登录</button></main>;
  return <div className="local-workspace">
    <aside className="local-sidebar" aria-label="业务导航">
      <div className="local-brand" aria-label="财务系统"><span className="local-brand-mark" aria-hidden="true" /></div>
      {!access.user?.local && <div style={{padding:'12px 16px',fontSize:12}}><button type="button" onClick={async()=>{await fetch("/api/auth/logout",{method:"POST"});window.location.href="/";}}>退出登录</button></div>}
      <nav className="local-nav">
        {visibleGroups.map((group) => {
          const expanded = Boolean(expandedGroups[group.id]);
          const containsActive = group.items.some((item) => item.id === activeItemId);
          return <div className={`local-nav-group ${expanded ? "expanded" : ""} ${containsActive ? "contains-active" : ""}`} key={group.id}>
            <button
              type="button"
              className="local-nav-toggle"
              aria-label={group.label}
              aria-expanded={expanded}
              aria-controls={`${group.id}-subnav`}
              onClick={() => toggleGroup(group.id)}
            >
              <NavIcon>{group.icon}</NavIcon>
              <span>{group.label}</span>
              <svg className="local-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {expanded && <div className="local-subnav" id={`${group.id}-subnav`}>
              {group.items.filter(item => item.id !== "salary-directory").map((item) => <button
                key={item.id}
                type="button"
                className={`local-subnav-item ${activeItemId === item.id ? "active" : ""}`}
                aria-current={activeItemId === item.id ? "page" : undefined}
                onClick={() => selectItem(item)}
              >
                <NavIcon>{item.icon}</NavIcon>
                <span>{item.label}</span>
              </button>)}
            </div>}
          </div>;
        })}
      </nav>
    </aside>

    <main className="local-content">
      <div className="local-panels">
        {visibleGroups.flatMap((group) => group.items).map((item) => visitedItems[item.id] && <section
          key={item.id}
          className="local-panel"
          hidden={activeItemId !== item.id}
          aria-label={item.label}
        >
          <iframe className="local-function-frame" src={item.src} title={item.label} onLoad={item.id === "salary-auto" ? deliverRoster : undefined} />
        </section>)}
      </div>
    </main>
  </div>;
}
