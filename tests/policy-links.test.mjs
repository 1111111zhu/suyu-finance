import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspectLinkResponse, replacementUrls, auditPolicyLinks, safePublicUrl, renderPolicySourcePage } from "../scripts/policy-links.mjs";

const title = "关于组织开展2026年度项目申报的通知";
const url = "https://test.gov.cn/notice/1.html";
const html = `<title>${title}</title><div class="article-content">${"企业应按照申报条件提交完整材料。".repeat(12)}</div>`;
test("checks HTTP errors, soft 404, homepage redirects and wrong documents", () => {
  for (const status of [403,404,500]) assert.equal(inspectLinkResponse({ status, url }).ok, false);
  assert.equal(inspectLinkResponse({ status:200, url, text:"<title>404 Not Found</title>" }).ok, false);
  assert.equal(inspectLinkResponse({ status:200, url, finalUrl:"https://test.gov.cn/", text:html, title }).ok, false);
  assert.equal(inspectLinkResponse({ status:200, url, text:html, title:"其他年度通知" }).ok, false);
});
test("accepts title outside article container, rejects HTML disguised as attachment", () => {
  assert.equal(inspectLinkResponse({ status:200, url, text:html, title }).ok, true);
  assert.equal(inspectLinkResponse({ status:200, url: `${url}.pdf`, text:html, bytes:Buffer.from(html), attachment:true }).ok, false);
  assert.equal(inspectLinkResponse({ status:200, url, bytes:Buffer.from("%PDF-1.7\ncontent"), attachment:true }).extension, "pdf");
});
test("repair candidates must be observed, same-title official records", () => {
  assert.deepEqual(replacementUrls({ title, url }, [
    { title, originalUrl:url, url:"https://other.gov.cn/new.html" },
    { title, url:"https://untrusted.example/new.html" },
    { title:title.replace("2026", "2025"), url:"https://other.gov.cn/old.html" },
  ]), ["https://other.gov.cn/new.html"]);
  assert.equal(safePublicUrl("javascript:alert(1)"), "");
  assert.equal(safePublicUrl("http://127.0.0.1/a"), "");
});
test("repairs official link, archives files, keeps historical files after outage and escapes HTML", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "policy-links-test-"));
  try {
    const p = { id:"sample", title, url, content:"历史内容<script>alert(1)</script>", attachments:[{url:"https://test.gov.cn/file.pdf"}] };
    const payload = { policies:[p] };
    const candidates = [{ title, originalUrl:url, url:"https://other.gov.cn/new.html" }];
    await auditPolicyLinks(payload, { root, candidates, fetchImpl: async target => new Response(target.endsWith(".pdf") ? "%PDF-1.7\ncontent" : target.includes("other.gov.cn") ? html : "not found", { status:target===url ? 404 : 200 }) });
    assert.equal(p.linkHealth.status, "repaired");
    assert.equal(p.attachments[0].linkHealth.status, "available");
    const fileUrl = p.attachments[0].linkHealth.localUrl;
    assert.match(await readFile(path.join(root,"public",fileUrl),"utf8"), /^%PDF-/);
    await auditPolicyLinks(payload, { root, candidates, fetchImpl:async () => new Response("404", { status:404 }) });
    assert.equal(p.linkHealth.status, "unavailable");
    assert.equal(p.attachments[0].linkHealth.localUrl, fileUrl);
    const reader = await readFile(path.join(root,"public",p.sourceReaderUrl),"utf8");
    assert.match(reader, /历史副本/);
    assert.doesNotMatch(reader, /正文文字副本|<pre>|历史内容/);
    assert.equal(reader.match(/<aside>(.*?)<\/aside>/)?.[1].replace(/<[^>]*>/g, ""), "打开官方来源");
    assert.doesNotMatch(reader, /<script>/);
  } finally { await rm(root, { recursive:true, force:true }); }
});

test("all source pages use compact links-only template and escape document titles", () => {
  const page = renderPolicySourcePage({ title:'示例<script>alert(1)</script>', url, content:'不再显示的正文', linkHealth:{ resolvedUrl:'https://other.gov.cn/new.html', localUrl:'/policy-sources/abcdef.pdf', status:'available' }, attachments:[] });
  assert.match(page, /&lt;script&gt;/);
  assert.doesNotMatch(page, /<script>|<pre>|正文文字副本|不再显示的正文|正文获取时间|链接检查时间/);
  assert.match(page, /href="https:\/\/other.gov.cn\/new.html"/);
  assert.match(page, /href="\/policy-sources\/abcdef.pdf"/);
  assert.match(page, /附件与相关文件/);
});

test('same title alone cannot replace a municipal notice with a provincial notice', () => {
  assert.deepEqual(replacementUrls({title,url}, [{title,url:'https://province.gov.cn/another.html'}]), []);
});

test('validated repairs take priority over legacy URLs after original-record merging', async () => {
  const {safeSourceHref, applicationFeedItems} = await import('../scripts/policy-view.mjs');
  const repaired = 'https://service2.most.gov.cn/kjjh_tztg_all/20260730/5851.html';
  const policy = {id:'kept',title,url, originalSourceUrl:url, sourceReaderUrl:'/policy-sources/a.html', linkHealth:{status:'repaired',resolvedUrl:repaired}};
  assert.equal(safeSourceHref(policy),repaired);
  const unavailable = {...policy,linkHealth:{status:'unavailable'}};
  assert.equal(safeSourceHref(unavailable),policy.sourceReaderUrl);
  assert.equal(applicationFeedItems({policies:[unavailable]}).length,1);
});

test('preferred official mirror survives another successful response from intermittent old URL', async () => {
  const {policyLinkRepairs} = await import('../data/policy-link-repairs.mjs');
  const root = await mkdtemp(path.join(tmpdir(),'policy-preferred-'));
  try {
    const repair = policyLinkRepairs[0];
    const p = {id:'mirror',title:repair.title,url:repair.originalUrl};
    const calls=[];
    await auditPolicyLinks({policies:[p]}, {root,fetchImpl:async target=>{calls.push(target);return new Response(`<title>${p.title}</title><p>${'项目申报条件。'.repeat(40)}</p>`);}});
    assert.equal(p.linkHealth.resolvedUrl,repair.url);
    assert.equal(p.linkHealth.status,'repaired');
    assert.ok(calls.includes(repair.originalUrl));
    assert.ok(calls.includes(repair.url));
  } finally {await rm(root,{recursive:true,force:true});}
});
