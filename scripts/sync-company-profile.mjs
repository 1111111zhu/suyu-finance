import { mkdir, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { companyProfileSources } from "../data/company-profile-sources.mjs";

const outputPath = path.resolve(process.cwd(), "public/company-profile.json");

const UNKNOWN = "unknown";
const acceptedSourceTypes = new Set(["government_official", "company_official"]);

// Keep the schema intentionally flat at the leaves. A policy matcher can use
// `matcherProfile` directly, while every value still carries its provenance.
const fieldDefinitions = [
  "legalName",
  "foundedYear",
  "publishedAddress",
  "publishedProvince",
  "publishedCity",
  "publishedDistrict",
  "industryFocus",
  "solutionPositioning",
  "highTechEnterprise",
  "specializedSme",
  "potentialUnicorn",
  "lowAltitudeEconomyLeader",
  "legalRepresentative",
  "unifiedSocialCreditCode",
  "registrationStatus",
  "registeredCapital",
  "employeeCount",
  "annualRevenue",
  "annualTaxPaid",
  "rAndDSpend",
  "rAndDIntensity",
  "patentCount",
  "companyAgeYears",
];

function decodeHtml(value = "") {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isoNow(now) {
  return new Date(now).toISOString();
}

function extractDate(text) {
  const match = String(text).match(/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function unknownField() {
  return {
    value: null,
    status: UNKNOWN,
    source: null,
    evidence: null,
    confidence: "unknown",
    verifiedAt: null,
  };
}

function sourceReference(source, fetchedAt, evidence) {
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    file: null,
    sourceType: source.sourceType,
    trustLevel: source.trustLevel,
    fetchedAt,
    publishedAt: extractDate(evidence),
  };
}

function evidenceFor(text, phrase) {
  const index = text.indexOf(phrase);
  if (index === -1) return null;
  // An evidence snippet is deliberately short, display-safe, and contains the
  // exact matched phrase. It is not a summarisation or a value inference.
  return text.slice(Math.max(0, index - 80), Math.min(text.length, index + phrase.length + 220)).trim();
}

function capture(text, pattern) {
  const match = text.match(pattern);
  return match?.[1]?.trim() || null;
}

function isBetterSource(next, current) {
  const priority = { A: 2, B: 1, unknown: 0 };
  return !current || (priority[next.source.trustLevel] || 0) > (priority[current.source?.trustLevel] || 0);
}

function setVerified(fields, key, value, source, fetchedAt, evidence) {
  if (!value || !evidence) return;
  const next = {
    value,
    status: "verified",
    source: sourceReference(source, fetchedAt, evidence),
    evidence,
    confidence: source.trustLevel === "A" ? "high" : "medium",
    verifiedAt: fetchedAt,
  };
  if (isBetterSource(next, fields[key])) fields[key] = next;
}

function createFields() {
  return Object.fromEntries(fieldDefinitions.map((key) => [key, unknownField()]));
}

function extractFromOfficialTerms(fields, text, source, fetchedAt) {
  const legalName = capture(text, /网站是\s*(苏州溯驭技术有限公司)/);
  if (legalName) setVerified(fields, "legalName", legalName, source, fetchedAt, evidenceFor(text, legalName));

  // The page publishes an address but does not state that it is the registered
  // address. Keep that distinction explicit to avoid silently inventing a
  // registration fact that a matcher might treat as a hard eligibility gate.
  const address = capture(text, /苏州溯驭技术有限公司，\s*(中国江苏省苏州市吴江区亨通光通信产业园15号楼)/);
  if (!address) return;
  const evidence = evidenceFor(text, address);
  setVerified(fields, "publishedAddress", address, source, fetchedAt, evidence);
  setVerified(fields, "publishedProvince", "江苏省", source, fetchedAt, evidence);
  setVerified(fields, "publishedCity", "苏州市", source, fetchedAt, evidence);
  setVerified(fields, "publishedDistrict", "吴江区", source, fetchedAt, evidence);
}

function extractFromWujiangArticle(fields, text, source, fetchedAt) {
  const legalName = capture(text, /(苏州溯驭技术有限公司)成立于20\d{2}年/)
    || capture(text, /(苏州溯驭技术有限公司)董震团队/);
  if (legalName) setVerified(fields, "legalName", legalName, source, fetchedAt, evidenceFor(text, legalName));

  const foundedYear = capture(text, /苏州溯驭技术有限公司成立于(20\d{2})年/);
  if (foundedYear) setVerified(fields, "foundedYear", Number(foundedYear), source, fetchedAt, evidenceFor(text, `成立于${foundedYear}年`));

  const industryFocus = capture(text, /公司专注于(氢能电控领域)的技术革新/);
  if (industryFocus) setVerified(fields, "industryFocus", [industryFocus], source, fetchedAt, evidenceFor(text, industryFocus));

  const positioning = capture(text, /致力于成为([^。]+提供商)/);
  if (positioning) setVerified(fields, "solutionPositioning", positioning, source, fetchedAt, evidenceFor(text, `致力于成为${positioning}`));

  const qualifications = [
    ["highTechEnterprise", "国家级高新技术企业"],
    ["specializedSme", "江苏省专精特新中小企业"],
    ["potentialUnicorn", "江苏省潜在独角兽企业"],
    ["lowAltitudeEconomyLeader", "苏州市低空经济领航企业"],
  ];
  for (const [key, label] of qualifications) {
    if (text.includes(label)) setVerified(fields, key, true, source, fetchedAt, evidenceFor(text, label));
  }
}

function applySource(fields, source, text, fetchedAt) {
  if (source.id === "suyu-official-terms") extractFromOfficialTerms(fields, text, source, fetchedAt);
  if (source.id === "wujiang-scitech-company-profile") extractFromWujiangArticle(fields, text, source, fetchedAt);
}

async function fetchPublicText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "CompanyProfileSync/1.0 (+monthly public-source refresh)",
        "accept-language": "zh-CN,zh;q=0.9",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function matcherProfile(fields) {
  // Do not turn a public address into a registration claim. Consumers that
  // need registered-place eligibility must wait for a separately verified
  // field rather than use `publishedLocation` as a substitute.
  return {
    schemaVersion: "1.0.0",
    legalEntity: fields.legalName,
    foundedYear: fields.foundedYear,
    publishedLocation: {
      address: fields.publishedAddress,
      province: fields.publishedProvince,
      city: fields.publishedCity,
      district: fields.publishedDistrict,
    },
    registeredLocation: {
      province: unknownField(),
      city: unknownField(),
      district: unknownField(),
    },
    industryFocus: fields.industryFocus,
    solutionPositioning: fields.solutionPositioning,
    qualifications: {
      highTechEnterprise: fields.highTechEnterprise,
      specializedSme: fields.specializedSme,
      potentialUnicorn: fields.potentialUnicorn,
      lowAltitudeEconomyLeader: fields.lowAltitudeEconomyLeader,
    },
    hardEligibility: {
      legalRepresentative: fields.legalRepresentative,
      unifiedSocialCreditCode: fields.unifiedSocialCreditCode,
      registrationStatus: fields.registrationStatus,
      registeredCapital: fields.registeredCapital,
      employeeCount: fields.employeeCount,
      annualRevenue: fields.annualRevenue,
      annualTaxPaid: fields.annualTaxPaid,
      rAndDSpend: fields.rAndDSpend,
      rAndDIntensity: fields.rAndDIntensity,
      patentCount: fields.patentCount,
      companyAgeYears: fields.companyAgeYears,
    },
  };
}

export async function buildCompanyProfile({
  now = new Date(),
  sources = companyProfileSources,
  fetchText = fetchPublicText,
} = {}) {
  const fetchedAt = isoNow(now);
  const fields = createFields();
  const sourceStatus = [];

  for (const source of sources) {
    if (!acceptedSourceTypes.has(source.sourceType)) {
      sourceStatus.push({
        id: source.id,
        name: source.name,
        url: source.url,
        sourceType: source.sourceType,
        trustLevel: source.trustLevel || "unknown",
        ok: false,
        fetchedAt,
        error: "source type is not allow-listed",
      });
      continue;
    }
    try {
      const html = await fetchText(source.url);
      const text = decodeHtml(html);
      if (!text) throw new Error("source returned no readable text");
      applySource(fields, source, text, fetchedAt);
      sourceStatus.push({
        id: source.id,
        name: source.name,
        url: source.url,
        sourceType: source.sourceType,
        trustLevel: source.trustLevel,
        ok: true,
        fetchedAt,
      });
    } catch (error) {
      // A failed source cannot support a carried-forward value. The affected
      // fields remain unknown, so a temporary page outage never becomes an
      // unlabelled fact or a guess.
      sourceStatus.push({
        id: source.id,
        name: source.name,
        url: source.url,
        sourceType: source.sourceType,
        trustLevel: source.trustLevel,
        ok: false,
        fetchedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const verifiedFieldCount = Object.values(fields).filter((field) => field.status === "verified").length;
  return {
    schemaVersion: "1.0.0",
    profileId: "suyu-company-profile",
    generatedAt: fetchedAt,
    refresh: {
      cadence: "monthly",
      schedule: "15 6 1 * *",
      timezone: "Asia/Shanghai",
      command: "npm run sync:company-profile",
      policy: "Only freshly fetched, allow-listed public sources may populate a field; unavailable or unsupported values are null/unknown.",
    },
    fields,
    matcherProfile: matcherProfile(fields),
    sources: sourceStatus,
    validation: {
      verifiedFieldCount,
      unknownFieldCount: fieldDefinitions.length - verifiedFieldCount,
      noInference: true,
      acceptedSourceTypes: ["government_official", "company_official"],
    },
  };
}

export async function syncCompanyProfile(options = {}) {
  const profile = await buildCompanyProfile(options);
  const target = options.outputPath || outputPath;
  const temporary = `${target}.tmp`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  await rename(temporary, target);
  return profile;
}

async function main() {
  const profile = await syncCompanyProfile();
  const sourceOk = profile.sources.filter((source) => source.ok).length;
  console.log(`Company profile sync complete: ${profile.validation.verifiedFieldCount} verified fields, ${sourceOk}/${profile.sources.length} sources available.`);
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
