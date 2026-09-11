import { readFile, writeFile, copyFile, mkdir, cp, access, rename } from "node:fs/promises";
import { auditPolicyLinks } from "./policy-links.mjs";
const payload = JSON.parse(await readFile("public/policies.json", "utf8"));
let candidates = []; try { candidates = JSON.parse(await readFile(".policy-cache/candidates.json", "utf8")).candidates; } catch { /* Public entries remain checkable. */ }
await mkdir(".policy-cache/history", { recursive: true });
await copyFile("public/policies.json", `.policy-cache/history/policies-links-${Date.now()}.json`);
await auditPolicyLinks(payload, { candidates });
await writeFile("public/policies.json.links.tmp", JSON.stringify(payload));
await rename("public/policies.json.links.tmp", "public/policies.json");
if (await access("dist/client").then(() => true, () => false)) {
  await cp("public/policy-sources", "dist/client/policy-sources", { recursive: true });
  await copyFile("public/policies.json", "dist/client/policies.json");
}
await import("./write-policy-applications.mjs");
console.log(JSON.stringify(payload.linkAudit));
