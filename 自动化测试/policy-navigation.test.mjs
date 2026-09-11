import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/policy/page.tsx", import.meta.url), "utf8");
const homeSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("project application navigation uses production-safe full-page links", () => {
  assert.doesNotMatch(pageSource, /from ["']next\/link["']/);
  assert.match(pageSource, /<a href="\/">\s*<Icon name="file" \/>研发费用<\/a>/);
  assert.match(pageSource, /<a[^>]+href="\/salary\/index\.html"[^>]*>\s*<Icon name="salary" \/>工资表<\/a>/);
  assert.match(pageSource, /<a[^>]+href="\/policy"[^>]*>\s*<Icon name="folder" \/>项目申报<\/a>/);
  assert.match(homeSource, /<a[^>]+href="\/salary\/index\.html"[^>]*>/);
});
