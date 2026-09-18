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

export type CreateRdProjectInput = {
  number: string;
  name: string;
  budget: number;
  status?: RdProject["status"];
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

export type RdBackup = { exportedAt: string; projects: RdProject[]; ledger: RdLedgerEntry[] };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "数据库请求失败，请稍后重试。");
  return payload;
}

export async function listProjects() { return (await request<{ projects: RdProject[] }>("/api/rd/projects")).projects; }
export async function readProject(projectId: string) { return (await request<{ project: RdProject }>(`/api/rd/projects/${encodeURIComponent(projectId)}`)).project; }
export async function listLedger(projectId: string) { return (await request<{ ledger: RdLedgerEntry[] }>(`/api/rd/projects/${encodeURIComponent(projectId)}/ledger`)).ledger; }
export async function createProject(input: CreateRdProjectInput) { return (await request<{ project: RdProject }>("/api/rd/projects", { method: "POST", body: JSON.stringify(input) })).project; }
export async function deleteProject(projectId: string) { return (await request<{ project: RdProject }>(`/api/rd/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" })).project; }
export async function recordCalculation(input: { projectId: string; labor: number; freight: number; other: number; month: number; year: number }) { return (await request<{ ledger: RdLedgerEntry[] }>("/api/rd/calculations", { method: "POST", body: JSON.stringify(input) })).ledger; }
export async function exportRdData() { return request<RdBackup>("/api/rd/export"); }
export async function importLegacyData(input: { requestKey: string; projects: RdProject[]; ledger: RdLedgerEntry[] }) { return request<{ projects: number; ledger: number; repeated: boolean }>("/api/rd/import", { method: "POST", body: JSON.stringify(input) }); }
