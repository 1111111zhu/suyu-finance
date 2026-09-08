// Re-render display only: leave policy data, audit timestamps and saved files untouched.
import { readFile, writeFile, mkdir, access, cp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { renderPolicySourcePage } from "./policy-links.mjs";
const payload = JSON.parse(await readFile("public/policies.json", "utf8"));
await mkdir("public/policy-sources", { recursive: true });
for (const policy of payload.policies) {
  const filename = createHash("sha256").update(policy.id).digest("hex") + ".html";
  await writeFile(`public/policy-sources/${filename}`, renderPolicySourcePage(policy));
}
if (await access("dist/client").then(() => true, () => false)) await cp("public/policy-sources", "dist/client/policy-sources", { recursive: true });
console.log(`已更新 ${payload.policies.length} 个查阅页，未改动政策数据或链接校验记录。`);
