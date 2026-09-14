"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
const Icon=({children}:{children:React.ReactNode})=><svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;
const icons={file:<><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h5"/></>,folder:<><path d="M3 7h7l2 2h9v10H3z"/></>,bot:<><rect x="5" y="7" width="14" height="12" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M9 16h6"/></>,db:<><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></>,home:<><path d="m3 10 9-7 9 7M5 10v10h14V10"/></>,menu:<><path d="M4 7h16M4 12h16M4 17h16"/></>,search:<><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></>};

const RD_COST_ROUTE = "/rd-cost";
const items = [
  [RD_COST_ROUTE, "研发费用测算", "file"], ["/projects", "项目管理", "folder"], ["/scenario/1", "AI 助手", "bot"], ["/rd-cost/data", "数据管理", "db"],
] as const;

export function WorkbenchShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => href === RD_COST_ROUTE
    ? pathname === RD_COST_ROUTE || pathname === "/rd-cost" || pathname === "/calculate"
    : pathname === href || pathname.startsWith(`${href}/`);
  return <div className="rd-shell">
    <aside className="rd-sidebar">
      <Link href="/" className="rd-brand" aria-label="溯驭财务首页"><span className="rd-brand-mark" aria-hidden="true" /></Link>
      <nav className="rd-nav" aria-label="研发费用工作台导航">
        {items.map(([href, label, icon]) => <a key={href} href={href} className={`rd-nav-item ${isActive(href) ? "active" : ""}`}><Icon>{icons[icon]}</Icon><span>{label}</span></a>)}
      </nav>
      <div className="rd-sidebar-foot"><Link href="/"><Icon>{icons.home}</Icon>← 首页</Link></div>
    </aside>
    <main className="rd-main">
      <header className="rd-topbar"><button className="rd-menu" aria-label="菜单"><Icon>{icons.menu}</Icon></button><div className="rd-search"><Icon>{icons.search}</Icon>搜索项目、工时、费用、单据编号等<span>/</span></div><Link href="/" className="rd-home-link">返回首页</Link></header>
      <div className="rd-content">{children}</div>
    </main>
  </div>;
}
