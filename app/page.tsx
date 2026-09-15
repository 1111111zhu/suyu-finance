"use client";

import { useState, type ReactNode } from "react";
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
  database: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>,
  payroll: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h6" /></>,
  batches: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
  email: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>,
  template: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h5" /></>,
};

const groups: NavGroup[] = [
  {
    id: "rd",
    label: "研发费用",
    icon: icons.rd,
    items: [
      { id: "rd-calculation", label: "研发费用测算", description: "上传资料并完成研发费用测算", src: "/rd-cost?embed=1", icon: icons.rd },
      { id: "rd-projects", label: "项目管理", description: "管理研发项目与费用台账", src: "/projects?embed=1", icon: icons.folder },
      { id: "rd-assistant", label: "AI 助手", description: "辅助整理研发费用场景与材料", src: "/scenario/1?embed=1", icon: icons.bot },
      { id: "rd-data", label: "数据管理", description: "查看研发费用测算数据", src: "/rd-cost/data?embed=1", icon: icons.database },
    ],
  },
  {
    id: "salary",
    label: "工资表",
    icon: icons.payroll,
    items: [
      { id: "salary-month", label: "本月工资", description: "本月工资核算与资料上传", src: "/salary/index.html?embed=1#gross/upload", icon: icons.payroll },
      { id: "salary-batches", label: "历史批次", description: "查看与管理历史工资批次", src: "/salary/index.html?embed=1#batches", icon: icons.batches },
      { id: "salary-email", label: "邮件发送", description: "生成工资表邮件内容与附件", src: "/salary/index.html?embed=1#net/email", icon: icons.email },
      { id: "salary-settings", label: "核算规则", description: "查看计薪、假勤与转正规则", src: "/salary/index.html?embed=1#gross/rules", icon: icons.settings },
      { id: "salary-templates", label: "模板管理", description: "查看与管理工资表输出模板", src: "/salary/index.html?embed=1#gross/templates", icon: icons.template },
    ],
  },
];

function NavIcon({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;
}

export default function Home() {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ rd: true, salary: false });
  const [activeItemId, setActiveItemId] = useState("rd-calculation");
  const [visitedItems, setVisitedItems] = useState<Record<string, boolean>>({ "rd-calculation": true });

  function toggleGroup(groupId: string) {
    setExpandedGroups((current) => ({ ...current, [groupId]: !current[groupId] }));
  }

  function selectItem(item: NavItem) {
    setActiveItemId(item.id);
    setVisitedItems((current) => ({ ...current, [item.id]: true }));
  }

  return <div className="local-workspace">
    <aside className="local-sidebar" aria-label="业务导航">
      <div className="local-brand" aria-label="研发智能体"><span className="local-brand-mark" aria-hidden="true" /></div>
      <nav className="local-nav">
        {groups.map((group) => {
          const expanded = Boolean(expandedGroups[group.id]);
          const containsActive = group.items.some((item) => item.id === activeItemId);
          return <div className={`local-nav-group ${expanded ? "expanded" : ""} ${containsActive ? "contains-active" : ""}`} key={group.id}>
            <button
              type="button"
              className="local-nav-toggle"
              aria-expanded={expanded}
              aria-controls={`${group.id}-subnav`}
              onClick={() => toggleGroup(group.id)}
            >
              <NavIcon>{group.icon}</NavIcon>
              <span>{group.label}</span>
              <svg className="local-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {expanded && <div className="local-subnav" id={`${group.id}-subnav`}>
              {group.items.map((item) => <button
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
        {groups.flatMap((group) => group.items).map((item) => visitedItems[item.id] && <section
          key={item.id}
          className="local-panel"
          hidden={activeItemId !== item.id}
          aria-label={item.label}
        >
          <iframe className="local-function-frame" src={item.src} title={item.label} />
        </section>)}
      </div>
    </main>
  </div>;
}
