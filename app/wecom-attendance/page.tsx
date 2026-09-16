"use client";

import { useState } from "react";

export default function WecomAttendancePage() {
  const [time, setTime] = useState("09:30");
  const [lastImport, setLastImport] = useState("尚未导入");
  const [importing, setImporting] = useState(false);

  function importNow() {
    setImporting(true);
    window.setTimeout(() => {
      setImporting(false);
      setLastImport("刚刚 · 80 人考勤记录已写入待核对区");
    }, 650);
  }

  return <main style={{ padding: "36px 42px", color: "#172033", fontFamily: "-apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif", background: "#f4f7fb", minHeight: "100vh" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start", marginBottom: 24 }}>
      <div><h1 style={{ margin: 0, fontSize: 27 }}>企业微信考勤</h1><p style={{ margin: "9px 0 0", color: "#6b768c" }}>将打卡、请假和加班记录自动整理为自动算薪可用的考勤统计表。</p></div>
      <button onClick={importNow} disabled={importing} style={{ border: 0, borderRadius: 8, padding: "11px 16px", background: "#2764e8", color: "white", fontWeight: 700, cursor: "pointer" }}>{importing ? "正在导入…" : "立即导入考勤"}</button>
    </div>
    <section style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16 }}>
      {[ ["数据来源", "企业微信", "考勤打卡、请假和加班记录"], ["导入目标", "自动算薪", "生成当前工资批次的考勤统计表"], ["最近导入", lastImport, "导入后可在自动算薪中核对或替换"] ].map(([label, value, note]) => <div key={label} style={{ padding: 20, border: "1px solid #e6ebf2", borderRadius: 12, background: "#fff" }}><div style={{ color: "#6b768c", fontSize: 13 }}>{label}</div><strong style={{ display: "block", marginTop: 10, fontSize: 18 }}>{value}</strong><div style={{ marginTop: 12, color: "#9aa5b6", fontSize: 12 }}>{note}</div></div>)}
    </section>
    <section style={{ marginTop: 18, padding: 22, border: "1px solid #e6ebf2", borderRadius: 12, background: "#fff" }}>
      <h2 style={{ margin: 0, fontSize: 17 }}>自动导入时间</h2><p style={{ color: "#6b768c", fontSize: 13 }}>每日自动拉取前一日考勤；月度算薪前仍可点击“立即导入考勤”手动刷新。</p>
      <div style={{ display: "flex", gap: 10, alignItems: "end" }}><label style={{ display: "grid", gap: 7, color: "#6b768c", fontSize: 13 }}>每日导入时间<input type="time" value={time} onChange={(event) => setTime(event.target.value)} style={{ height: 36, padding: "0 10px", border: "1px solid #d4dce8", borderRadius: 8 }} /></label><button onClick={() => window.alert(`已设置每日 ${time} 自动导入（本地演示）`)} style={{ height: 36, padding: "0 13px", border: "1px solid #d4dce8", borderRadius: 8, background: "white", color: "#34445d" }}>保存时间</button></div>
    </section>
    <p style={{ marginTop: 18, color: "#718096", fontSize: 12 }}>本页为接入演示：真实环境会通过服务端连接企业微信，浏览器不保存企业密钥，导入后也不会直接覆盖已冻结的工资批次。</p>
  </main>;
}
