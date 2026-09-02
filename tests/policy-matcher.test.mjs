import assert from "node:assert/strict";
import test from "node:test";
import { auditPolicies, evaluatePolicy } from "../scripts/policy-matcher.mjs";

const now = new Date("2026-09-02T00:00:00+08:00");
const base = { id: "case", region: "浙江省", level: "省级", department: "测试部门", publishDate: "2026-09-01", deadline: "", category: "政策申报", summary: "", content: "", url: "https://example.gov.cn/policy" };

test("正文中明确的申报事项不能因标题缺少申报词而被过滤", () => {
  const result = evaluatePolicy({ ...base, title: "关于发布2026年度重点专项通知", content: "现组织开展氢能与燃料电池关键技术项目申报，支持企业研发和产业化。" }, now);
  assert.equal(result.visible, true);
});

test("无申报或公司相关信号的会议通知仍会被过滤并保留原因", () => {
  const [item] = auditPolicies([{ ...base, title: "关于召开工作会议的通知", content: "会议安排" }], now);
  assert.equal(item.visible, false);
  assert.equal(item.filterReason, "正文及附件未识别到申报或公司相关信号");
});

test("赛道相关但申报信息不完整的通知进入待人工复核", () => {
  const result = evaluatePolicy({ ...base, title: "关于推进氢能产业发展的通知", content: "支持企业开展燃料电池关键技术研发和成果转化。" }, now);
  assert.equal(result.visible, true);
  assert.equal(result.matchLevel, "待人工复核");
});

test("同市其他区的定向项目会被筛掉", () => {
  const result = evaluatePolicy({ ...base, region: "苏州市", title: "苏州工业园区科技领军人才项目申报通知", content: "面向园区企业开展新能源技术项目申报" });
  assert.equal(result.visible, false);
  assert.match(result.filterReason, /苏州工业园区/);
});

test("本区及未标注区属的市级项目不会因区规则被筛掉", () => {
  const wujiang = evaluatePolicy({ ...base, region: "苏州市", title: "吴江区氢能产业项目申报通知", content: "面向吴江区企业开展氢能技术项目申报" });
  const citywide = evaluatePolicy({ ...base, region: "杭州市", title: "杭州市科技项目申报通知", content: "面向全市科技企业开展新能源项目申报" });
  assert.equal(wujiang.visible, true);
  assert.equal(citywide.visible, true);
});
