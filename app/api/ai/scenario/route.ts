import { NextResponse } from "next/server";
export async function POST(request: Request) {
  const body = await request.json() as { scenario?: number; project?: string; materials?: string };
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return NextResponse.json({ success:true, data:{ title:"AI 场景分析（演示）", summary:"未配置 DEEPSEEK_API_KEY，已完成本地材料接收。配置 API 后可生成正式分析。", checklist:["核对项目编号与期间","补齐原始凭证和支撑材料","确认费用归集口径"] }});
  const response = await fetch(`${process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com"}/v1/chat/completions`, { method:"POST", headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`}, body:JSON.stringify({model:process.env.DEEPSEEK_MODEL || "deepseek-chat",messages:[{role:"system",content:"你是研发费用台账助手，请用中文给出简洁、可执行的检查结果。"},{role:"user",content:`场景：${body.scenario || 1}\n项目：${body.project || "未指定"}\n材料：${body.materials || "无"}`}],temperature:.2}) });
  if (!response.ok) return NextResponse.json({ success:false, error:"AI 服务请求失败" }, {status:502});
  const json = await response.json() as { choices?: {message?:{content?:string}}[] };
  return NextResponse.json({ success:true, data:{ title:"AI 分析结果", summary:json.choices?.[0]?.message?.content || "未返回内容" } });
}
