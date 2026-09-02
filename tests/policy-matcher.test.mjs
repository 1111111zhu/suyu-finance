import assert from "node:assert/strict";
import test from "node:test";
import { auditPolicies, evaluatePolicy } from "../scripts/policy-matcher.mjs";

const now = new Date("2026-09-02T00:00:00+08:00");
const base = { id: "case", region: "浙江省", level: "省级", department: "测试部门", publishDate: "2026-09-01", deadline: "", category: "政策申报", summary: "", content: "", url: "https://example.gov.cn/policy" };

test("正文中明确的申报事项不能因标题缺少申报词而被过滤", () => {
  const result = evaluatePolicy({ ...base, title: "关于发布2026年度重点专项通知", content: "现组织开展氢能与燃料电池关键技术项目申报，支持企业研发和产业化。" }, now);
  assert.equal(result.visible, true);
});

test("审计结果保留每条被过滤政策及原因", () => {
  const [item] = auditPolicies([{ ...base, title: "关于召开工作会议的通知", content: "会议安排" }], now);
  assert.equal(item.visible, false);
  assert.equal(item.filterReason, "正文及附件未识别到明确申报事项");
});
