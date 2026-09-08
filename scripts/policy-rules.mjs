import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export const POLICY_RULES_PATH = "规则.md";

export function parsePolicyRules(markdown) {
  const text = String(markdown || "");
  const version = text.match(/^版本：([^\s（(｜|]+)/m)?.[1] || "";
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
  const sections = [...text.matchAll(/^##\s+(.+)$/gm)].map(match => match[1].trim());
  const digest = createHash("sha256").update(text).digest("hex");
  return {
    title,
    version,
    digest,
    sections,
    byteLength: Buffer.byteLength(text, "utf8"),
    loadedAt: new Date().toISOString(),
  };
}

export async function loadPolicyRules(baseDirectory = process.cwd()) {
  const filePath = path.resolve(baseDirectory, POLICY_RULES_PATH);
  const markdown = await readFile(filePath, "utf8");
  return {
    path: POLICY_RULES_PATH,
    ...parsePolicyRules(markdown),
  };
}

export function assertPolicyRulesLoaded(rules) {
  if (!rules?.version) throw new Error("后端未读取到规则.md 的版本号");
  if (!rules.sections?.some(section => section.includes("证据排除与角色期限补强"))) throw new Error("规则.md 缺少第十六节补强口径");
  if (!rules.sections?.some(section => section.includes("申报页面精简展示"))) throw new Error("规则.md 缺少第十七节页面口径");
  return rules;
}
