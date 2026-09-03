import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyProfile } from "../scripts/sync-company-profile.mjs";

const termsSource = {
  id: "suyu-official-terms",
  name: "Official terms",
  url: "https://example.test/terms",
  sourceType: "company_official",
  trustLevel: "B",
};
const governmentSource = {
  id: "wujiang-scitech-company-profile",
  name: "Wujiang Science and Technology Bureau",
  url: "https://example.test/government",
  sourceType: "government_official",
  trustLevel: "A",
};
const now = new Date("2026-09-03T01:00:00.000Z");

test("company profile only writes exact claims supported by allow-listed sources", async () => {
  const profile = await buildCompanyProfile({
    now,
    sources: [termsSource, governmentSource],
    fetchText: async (url) => url.includes("terms")
      ? "网站是苏州溯驭技术有限公司（溯驭）及其许可方的财产。苏州溯驭技术有限公司，中国江苏省苏州市吴江区亨通光通信产业园15号楼"
      : "苏州溯驭技术有限公司成立于2021年，是国家级高新技术企业、江苏省专精特新中小企业、江苏省潜在独角兽企业及苏州市低空经济领航企业。公司专注于氢能电控领域的技术革新，致力于成为国内领先的氢电耦合一体化电控系统及场景综合解决方案提供商。",
  });

  assert.equal(profile.fields.legalName.value, "苏州溯驭技术有限公司");
  assert.equal(profile.fields.legalName.source.trustLevel, "A");
  assert.equal(profile.fields.foundedYear.value, 2021);
  assert.deepEqual(profile.fields.industryFocus.value, ["氢能电控领域"]);
  assert.equal(profile.fields.highTechEnterprise.value, true);
  assert.equal(profile.fields.highTechEnterprise.source.sourceType, "government_official");
  assert.equal(profile.matcherProfile.publishedLocation.district.value, "吴江区");
  assert.equal(profile.matcherProfile.registeredLocation.district.value, null);
  assert.equal(profile.fields.annualRevenue.value, null);
  assert.equal(profile.fields.annualRevenue.status, "unknown");
  assert.equal(profile.validation.noInference, true);
});

test("missing evidence and failed sources stay null instead of being guessed or carried forward", async () => {
  const profile = await buildCompanyProfile({
    now,
    sources: [termsSource, governmentSource],
    fetchText: async (url) => {
      if (url.includes("terms")) return "溯驭技术的公开页面。";
      throw new Error("HTTP 503");
    },
  });

  assert.equal(profile.fields.legalName.value, null);
  assert.equal(profile.fields.foundedYear.value, null);
  assert.equal(profile.fields.highTechEnterprise.value, null);
  assert.equal(profile.fields.publishedDistrict.value, null);
  assert.equal(profile.sources.find((source) => source.id === governmentSource.id).ok, false);
  assert.equal(profile.sources.find((source) => source.id === governmentSource.id).error, "HTTP 503");
});

test("non-authorized source types are rejected before they can populate a field", async () => {
  const profile = await buildCompanyProfile({
    now,
    sources: [{ ...governmentSource, sourceType: "commercial_database" }],
    fetchText: async () => {
      throw new Error("must not fetch");
    },
  });

  assert.equal(profile.fields.legalName.value, null);
  assert.equal(profile.sources[0].ok, false);
  assert.equal(profile.sources[0].error, "source type is not allow-listed");
});
