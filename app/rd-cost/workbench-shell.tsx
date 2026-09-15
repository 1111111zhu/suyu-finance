"use client";

import { usePathname, useSearchParams } from "next/navigation";
const Icon=({children}:{children:React.ReactNode})=><svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;
const icons={file:<><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h5"/></>,salary:<><rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="9" r="2"/><path d="M8.5 17c.7-2.1 2-3 3.5-3s2.8.9 3.5 3"/></>,menu:<><path d="M4 7h16M4 12h16M4 17h16"/></>,search:<><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></>};

const RD_COST_ROUTE = "/rd-cost";
const items = [
  [RD_COST_ROUTE, "研发费用", "file"], ["/salary/index.html#gross/upload", "工资表", "salary"],
] as const;

export function WorkbenchShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (searchParams.get("embed") === "1") return <div className="rd-embed">{children}</div>;
  const isActive = (href: string) => href === RD_COST_ROUTE
    ? pathname === RD_COST_ROUTE || pathname === "/rd-cost" || pathname === "/calculate"
    : pathname === href || pathname.startsWith(`${href}/`);
  return <div className="rd-shell">
    <aside className="rd-sidebar">
      <div className="rd-brand" aria-label="溯驭财务"><span className="rd-brand-mark" aria-hidden="true" /></div>
      <nav className="rd-nav" aria-label="研发费用工作台导航">
        {items.map(([href, label, icon]) => <a key={href} href={href} className={`rd-nav-item ${isActive(href) ? "active" : ""}`}><Icon>{icons[icon]}</Icon><span>{label}</span></a>)}
      </nav>
    </aside>
    <main className="rd-main">
      <header className="rd-topbar"><button className="rd-menu" aria-label="菜单"><Icon>{icons.menu}</Icon></button><div className="rd-search"><Icon>{icons.search}</Icon>搜索项目、工时、费用、单据编号等<span>/</span></div></header>
      <div className="rd-content">{children}</div>
    </main>
  </div>;
}
