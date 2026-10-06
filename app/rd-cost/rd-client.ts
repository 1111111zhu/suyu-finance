"use client";

export type RdProject = {
  id: string;
  number: string;
  name: string;
  status: "init" | "active" | "paused" | "stopped" | "completed";
  budget: number;
  actual: number;
  updatedAt: string;
  platformId: string | null;
  sourceYear: number | null;
  sourceRecords: { filename: string; rows: number[]; year: number }[];
  startDate: string | null;
  endDate: string | null;
  completedAt: string | null;
  sourceStatus: string | null;
  financialEntity: string | null;
  parentNumber: string | null;
  materials: { number: string; name: string; [key: string]: unknown }[];
};

export type CreateRdProjectInput = {
  number: string;
  name: string;
  platformId: string;
  budget: number;
  status?: RdProject["status"];
  startDate?: string;
  endDate?: string;
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
export type RdProjectDocument = {id:string;filename:string;mimeType:string;createdAt:string};

export type RdBackup = { exportedAt: string; projects: RdProject[]; ledger: RdLedgerEntry[]; platformLedger?:{id:string;platformId:string;sourceCode:string;date:string;category:string;amount:number;description:string;runId:string}[] };
export type RdPlatform = {id:string;number:string|null;name:string;projectCount:number;actual:number;platformOnlyActual:number};
export type CalculationBatch = {requestKey:string;scope:string;year:number;month:number;total:string;projects:{code:string;name:string;total:string;costs:{category:string;amount:string}[]}[];files:{name:string;sha256:string}[];resultFile?:{filename:string;base64:string};sourceFiles?:{name:string;sha256:string;base64:string}[]};
export type MonthlyTotal = { projectId:string|null; platformId:string|null; month:string; total:number };
export type AnalysisRow = { month:string; scope:string; category:string; amount:number };
export type AnalysisImportPreview = {
  filename:string; sha256:string; sourceFormat:"fixed-template"|"legacy-main-sheet";
  yearHint:number|null; monthHint:number|null; projectCount:number; total:string;
  categories:{category:string;amount:string}[];
};
export type AnalysisImportResult = {id:string;scope:string;year:number;month:number;total:string;repeated:boolean;replaced?:boolean};
export type ManagedKind = "platform" | "project";
export type ManagementAction =
  | {action:"create";kind:ManagedKind;name:string;number:string;platformId?:string}
  | {action:"delete"|"restore";kind:ManagedKind;id:string};
export type TrashItem = {id:string;kind:ManagedKind;name:string;number:string|null;deletedAt:string;parentDeleted:boolean;actual:number;projectCount?:number;platformName?:string|null};
export async function listPlatforms(){return (await request<{platforms:RdPlatform[]}>("/api/rd/platforms")).platforms;}
export async function confirmProjectBatch(input:CalculationBatch){return request<{runId:string;repeated:boolean;status:string;projectCount:number;platformOnlyCount:number;platformOnlyTotal:string}>("/api/rd/calculation-batches",{method:"POST",body:JSON.stringify(input)});}
export async function listTrash(){return (await request<{items:TrashItem[]}>("/api/rd/trash")).items;}
export async function manageRdItem(input:ManagementAction){return request<{ok:boolean}>("/api/rd/manage",{method:"POST",body:JSON.stringify(input)});}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "数据库请求失败，请稍后重试。");
  return payload;
}

export async function listProjects() { return (await request<{ projects: RdProject[] }>("/api/rd/projects")).projects; }
export async function readProject(projectId: string) { return (await request<{ project: RdProject }>(`/api/rd/projects/${encodeURIComponent(projectId)}`)).project; }
export async function listLedger(projectId: string) { return (await request<{ ledger: RdLedgerEntry[] }>(`/api/rd/projects/${encodeURIComponent(projectId)}/ledger`)).ledger; }
export async function listProjectDocuments(projectId:string){return (await request<{documents:RdProjectDocument[]}>(`/api/rd/projects/${encodeURIComponent(projectId)}/documents`)).documents;}
export async function createProject(input: CreateRdProjectInput) { return (await request<{ project: RdProject }>("/api/rd/projects", { method: "POST", body: JSON.stringify(input) })).project; }
export async function createProjectWithCharter(input: CreateRdProjectInput & { file:File; extractedText:string; ocrStatus:string }) {
  const form=new FormData();
  const {file,...fields}=input;
  for(const [key,value] of Object.entries(fields)) form.set(key,String(value??""));
  form.set("document",file);
  return (await requestMultipart<{project:RdProject}>("/api/rd/projects",form)).project;
}
export async function recognizeProjectCharter(file:File) {
  const form=new FormData();form.set("document",file);
  return requestMultipart<{extractedText:string;fields:{name:string;budget:string;startDate:string;endDate:string};ocrStatus:string;warning:string}>("/api/rd/projects/charter-ocr",form);
}
export async function updateProjectStatus(projectId:string,status:RdProject["status"]) {
  return (await request<{project:RdProject}>(`/api/rd/projects/${encodeURIComponent(projectId)}`,{method:"PATCH",body:JSON.stringify({status})})).project;
}
export async function listMonthlyTotals(){return (await request<{totals:MonthlyTotal[]}>("/api/rd/monthly-totals")).totals;}
export async function listAnalysis(){return (await request<{rows:AnalysisRow[]}>("/api/rd/analysis")).rows;}
export async function previewAnalysisImport(file:File){const form=new FormData();form.set("action","preview");form.set("file",file);return (await requestMultipart<{preview:AnalysisImportPreview}>("/api/rd/analysis/imports",form)).preview;}
export async function importAnalysisResult(file:File,input:{sha256:string;scope:string;year:number;month:number;acknowledged:boolean}){const form=new FormData();form.set("action","import");form.set("file",file);for(const [key,value] of Object.entries(input))form.set(key,String(value));return (await requestMultipart<{result:AnalysisImportResult}>("/api/rd/analysis/imports",form)).result;}
export async function deleteProject(projectId: string) { return (await request<{ project: RdProject }>(`/api/rd/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" })).project; }
export async function recordCalculation(input: { projectId: string; labor: number; freight: number; other: number; month: number; year: number }) { return (await request<{ ledger: RdLedgerEntry[] }>("/api/rd/calculations", { method: "POST", body: JSON.stringify(input) })).ledger; }
export async function exportRdData() { return request<RdBackup>("/api/rd/export"); }
export async function importLegacyData(input: { requestKey: string; projects: RdProject[]; ledger: RdLedgerEntry[] }) { return request<{ projects: number; ledger: number; repeated: boolean }>("/api/rd/import", { method: "POST", body: JSON.stringify(input) }); }

async function requestMultipart<T>(url:string,form:FormData):Promise<T>{
  const response=await fetch(url,{method:"POST",body:form,cache:"no-store"});
  const payload=await response.json().catch(()=>({})) as T&{error?:string};
  if(!response.ok)throw new Error(payload.error||"文件识别失败，请稍后重试。");
  return payload;
}
