import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { applicationFeedItems } from "./policy-view.mjs";

const sourcePath = path.resolve("public/policies.json");
const publicPath = path.resolve("public/policy-applications.json");
const deployedPath = path.resolve("dist/client/policy-applications.json");

async function writeJsonAtomically(targetPath, payload) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload)}\n`, "utf8");
  await rename(temporaryPath, targetPath);
}

const feed = JSON.parse(await readFile(sourcePath, "utf8"));
const payload = {
  rulesVersion: feed.rulesVersion,
  ruleDocumentVersion: feed.ruleDocumentVersion,
  updatedAt: feed.updatedAt,
  refreshMode: feed.refreshMode,
  linkAudit: feed.linkAudit,
  coverage: feed.coverage,
  policies: applicationFeedItems(feed),
  sources: [],
};

await writeJsonAtomically(publicPath, payload);
try {
  await access(path.dirname(deployedPath));
  await writeJsonAtomically(deployedPath, payload);
} catch {
  // The production directory is created by the build; local development only
  // needs the public copy.
}

console.log(`Public application feed: ${payload.policies.length} rows`);
