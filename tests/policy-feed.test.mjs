import assert from "node:assert/strict";
import test from "node:test";
import { assertViablePolicyFeed, buildPolicyFeed } from "../scripts/policy-feed.mjs";
import { policyStatusCounts, selectPolicyItems } from "../scripts/policy-view.mjs";

const now = new Date("2026-09-04T08:00:00+08:00");
const base = {
  region: "苏州市",
  level: "市级",
  department: "测试部门",
  publishDate: "2026-09-04",
  deadline: "",
  category: "政策申报",
  summary: "",
  url: "https://example.gov.cn/policy",
};

test("候选到页面筛选的端到端链路不会全部归零", () => {
  const candidates = [
    { ...base, id: "eligible", title: "氢能项目支持通知", content: "支持对象为氢能企业。", originalVerification: { verified: true, retrievalStatus: "parsed" } },
    { ...base, id: "review", title: "氢能项目申报通知", content: "支持对象为氢能企业。", originalVerification: { verified: false, retrievalStatus: "failed", reason: "HTTP 503" } },
    { ...base, id: "excluded", title: "生物医药项目申报通知", content: "支持对象为生物医药企业。", originalVerification: { verified: true, retrievalStatus: "parsed" } },
  ];
  const payload = assertViablePolicyFeed(buildPolicyFeed(candidates, [], null, now));
  const roundTrip = JSON.parse(JSON.stringify(payload));
  const allItems = [...roundTrip.policies, ...roundTrip.filteredPolicies].map((policy) => ({ ...policy, disposition: policy.decision }));
  const all = selectPolicyItems(allItems, [], { tab: "pending", disposition: "all", region: "全部地区", query: "" });
  const counts = policyStatusCounts(allItems, []);

  assert.equal(payload.candidateCount, payload.policies.length + payload.filteredPolicies.length);
  assert.equal(Object.values(payload.decisionCounts).reduce((sum, count) => sum + count, 0), payload.sourceCandidateCount);
  assert.ok(payload.decisionCounts.eligible > 0);
  assert.ok(payload.decisionCounts.needs_review > 0);
  assert.equal(payload.decisionCounts.ineligible, 1);
  assert.equal(counts.ineligible, 0);
  assert.deepEqual(new Set(all.map((item) => item.id)), new Set(["eligible", "review"]));
});

test("直接丢弃事项不会写入公开数据，也不会出现在“全部”", () => {
  const payload = assertViablePolicyFeed(buildPolicyFeed([
    { ...base, id: "eligible", title: "氢能项目支持通知", content: "支持对象为氢能企业。", originalVerification: { verified: true, retrievalStatus: "parsed" } },
    { ...base, id: "expired", title: "已截止氢能项目申报", deadline: "2026-09-01", content: "支持对象为氢能企业。", originalVerification: { verified: true, retrievalStatus: "parsed" } },
    { ...base, id: "news", title: "喜报！氢能创新再获新突破", content: "氢能企业取得创新成果。", originalVerification: { verified: false, retrievalStatus: "failed" } },
  ], [], null, now));
  const allItems = [...payload.policies, ...payload.filteredPolicies].map((policy) => ({ ...policy, disposition: policy.decision }));
  const all = selectPolicyItems(allItems, [], { tab: "pending", disposition: "all", region: "全部地区", query: "" });

  assert.equal(payload.sourceCandidateCount, 3);
  assert.equal(payload.candidateCount, 1);
  assert.equal(payload.discardedCount, 2);
  assert.equal(payload.decisionCounts.discarded, 2);
  assert.deepEqual(all.map((item) => item.id), ["eligible"]);
});

test("运行时防归零保护会拒绝覆盖成全部不匹配的结果", () => {
  const payload = buildPolicyFeed([
    { ...base, id: "excluded", title: "生物医药项目申报通知", content: "支持对象为生物医药企业。", originalVerification: { verified: true, retrievalStatus: "parsed" } },
  ], [], null, now);
  assert.throws(() => assertViablePolicyFeed(payload), /全部被判为不匹配/);
});
