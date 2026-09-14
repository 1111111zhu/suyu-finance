"use client";

export type RdProject = {
  id: string;
  number: string;
  name: string;
  status: "init" | "active" | "completed";
  budget: number;
  actual: number;
  updatedAt: string;
};

export type RdLedgerEntry = {
  id: string;
  projectId: string;
  date: string;
  category: string;
  amount: number;
  description: string;
  source: "calculation" | "import" | "manual";
};

const PROJECTS_KEY = "suyu-rd-projects-v1";
const LEDGER_KEY = "suyu-rd-ledger-v1";

const demoProjects: RdProject[] = [
  { id: "demo-rd-001", number: "RD2026-001", name: "高寒环境氢燃料电池无人机动力系统研发", status: "active", budget: 2800000, actual: 1265000, updatedAt: new Date().toISOString() },
  { id: "demo-rd-002", number: "RD2026-002", name: "智能制造视觉检测算法平台", status: "active", budget: 1600000, actual: 428000, updatedAt: new Date().toISOString() },
];

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function write<T>(key: string, value: T) { if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(value)); }

export function getProjects() { return read<RdProject[]>(PROJECTS_KEY, demoProjects); }
export function saveProjects(projects: RdProject[]) { write(PROJECTS_KEY, projects); }
export function getLedger() { return read<RdLedgerEntry[]>(LEDGER_KEY, []); }
export function saveLedger(entries: RdLedgerEntry[]) { write(LEDGER_KEY, entries); }
export function recordCalculation(projectId: string, summary: { labor: number; freight: number; other: number; month: number }) {
  const now = new Date().toISOString();
  const categories = [["人员人工（含社保+公积金）", summary.labor], ["运费", summary.freight], ["其他费用", summary.other]] as const;
  const monthKey = `${new Date().getFullYear()}-${String(summary.month).padStart(2, "0")}`;
  const existing = getLedger();
  const replaced = existing.filter((entry) => entry.projectId === projectId && entry.source === "calculation" && entry.date.startsWith(monthKey));
  const entries = existing.filter((entry) => !replaced.includes(entry));
  const additions = categories.filter(([, amount]) => amount > 0).map(([category, amount], index) => ({ id: `calc-${Date.now()}-${index}`, projectId, date: `${new Date().getFullYear()}-${String(summary.month).padStart(2, "0")}-01`, category, amount, description: "研发费用本地测算自动入账", source: "calculation" as const }));
  saveLedger([...entries, ...additions]);
  const total = summary.labor + summary.freight + summary.other;
  const previousTotal = replaced.reduce((sum, entry) => sum + entry.amount, 0);
  const projects = getProjects().map((project) => project.id === projectId ? { ...project, actual: Math.max(0, project.actual - previousTotal + total), updatedAt: now } : project);
  saveProjects(projects);
  return additions;
}
