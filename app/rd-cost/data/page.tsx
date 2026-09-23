"use client";

import { useEffect, useState } from "react";
import { WorkbenchShell } from "../workbench-shell";
import { exportRdData, importLegacyData, type RdBackup } from "../rd-client";
import { getLegacyRdDataset, legacyMigrationDone, markLegacyMigrationDone, type LegacyRdDataset } from "../rd-store";
import "../rd-cost.css";

export default function DataPage() {
  const [backup, setBackup] = useState<RdBackup | null>(null);
  const [legacy, setLegacy] = useState<LegacyRdDataset | null>(null);
  const [message, setMessage] = useState("");

  async function refresh() {
    try { setBackup(await exportRdData()); } catch (error) { setMessage(error instanceof Error ? error.message : "数据库读取失败。"); }
  }

  useEffect(() => {
    let active = true;
    void exportRdData()
      .then((next) => { if (active) setBackup(next); })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "数据库读取失败。"); });
    const legacyTimer = window.setTimeout(() => {
      if (active && !legacyMigrationDone()) setLegacy(getLegacyRdDataset());
    }, 0);
    return () => { active = false; window.clearTimeout(legacyTimer); };
  }, []);

  async function download() {
    try {
      const next = await exportRdData();
      setBackup(next);
      const blob = new Blob([JSON.stringify(next, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "研发费用数据库备份.json";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("数据库备份已下载。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "数据库备份失败。"); }
  }

  async function importLegacy() {
    if (!legacy) return;
    try {
      const requestKey = crypto.randomUUID();
      const result = await importLegacyData({ requestKey, ...legacy });
      markLegacyMigrationDone();
      setLegacy(null);
      await refresh();
      setMessage(`已迁入 ${result.projects} 个项目和 ${result.ledger} 条台账记录。本机原始数据未删除。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "本机数据迁移失败。"); }
  }

  return <WorkbenchShell><div className="rd-page-head"><div><h1>数据管理</h1><p>查看数据库中的研发项目与费用台账，并导出备份</p>{message && <p className="ui-field-error" role="status">{message}</p>}</div><button className="rd-btn primary" onClick={download}>导出数据库备份</button></div>
    <div className="rd-grid rd-grid-4"><div className="rd-card rd-card-body"><div className="rd-stat-label">项目数</div><div className="rd-stat-value">{backup?.projects.length ?? "—"}</div></div><div className="rd-card rd-card-body"><div className="rd-stat-label">台账记录</div><div className="rd-stat-value">{backup?.ledger.length ?? "—"}</div></div><div className="rd-card rd-card-body" style={{ gridColumn: "span 2" }}><div className="rd-stat-label">数据边界</div><p style={{ marginTop: 8, color: "#515b72" }}>研发 Excel 仍在浏览器本地处理；数据库只保存项目、费用汇总和台账摘要。</p></div></div>
    {legacy && <section className="ui-card rd-card-body" style={{ marginTop: 20 }}><h2 style={{ fontSize: 17 }}>发现此浏览器的旧版本地数据</h2><p style={{ marginTop: 8, color: "#515b72" }}>可将 {legacy.projects.length} 个项目和 {legacy.ledger.length} 条台账记录一次性迁入数据库。迁入后不会删除本机原始 JSON。</p><button className="rd-btn primary" style={{ marginTop: 14 }} onClick={importLegacy}>迁入数据库</button></section>}
  </WorkbenchShell>;
}
