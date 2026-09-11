// Public official index parsing. Keep each record's deadline beside its title;
// never borrow dates from adjacent list entries.
const decode = value => String(value || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

export function officialBody(html) {
  const heading = String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    || String(html).match(/<meta\b[^>]*name=["']ArticleTitle["'][^>]*content=["']([^"']+)/i)?.[1]
    || String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  let body = String(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const marker = body.match(/<(?:div|article)[^>]*(?:id|class)=["'][^"']*(?:mainPageContent|UCAP-CONTENT|zoom|TRS_Editor|article-content|article_content|content-main)[^"']*["'][^>]*>/i);
  if (marker) body = body.slice(marker.index + marker[0].length);
  body = body.split(/(?:<!--\s*(?:正文结束|文章结束|footer)|友情链接|主办单位[:：]|扫一扫在手机打开当前页)/)[0];
  return decode(`${heading} ${body}`);
}

export function parseSushangIndex(html, url) {
  const records = [];
  for (const match of html.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)) {
    const block = match[0];
    const link = block.match(/<a[^>]*href=["']([^"']*noticeDetail[^"']*)["'][^>]*>/i);
    if (!link) continue;
    const raw = block.match(/(?:titleShowWidth[^>]*title|<a[^>]*title)=["']([^"']+)["']/i)?.[1]
      || block.match(/\btitle=["']([^"']+)["']/i)?.[1];
    if (!raw) continue;
    const title = decode(raw);
    const text = decode(block);
    const level = block.match(/class="tag"[^>]*>\[([^\]]+)\]/)?.[1] || "苏州市级";
    const region = level === "国家级" ? "国家" : level === "江苏省级" ? "江苏省" : "苏州市";
    const deadline = text.match(/最近要求[:：]\s*(20\d{2}-\d{2}-\d{2})/)?.[1] || "";
    const id = link[1].match(/\/id\/(\d+)/)?.[1];
    records.push({ id: `sushang-${id}`, title, region, level, department: "苏商通官方申报中心", publishDate: text.match(/20\d{2}-\d{2}-\d{2}/)?.[0] || "", deadline, deadlineEvidence: text.match(/最近要求[^。]{0,50}/)?.[0], url: new URL(link[1], url).href, sourceName: "苏商通官方申报中心", category: "项目申报", summary: "", firstSeenAt: new Date().toISOString() });
  }
  const next = [...html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>\s*下一页\s*<\/a>/g)][0]?.[1];
  return { records, next: next ? new URL(next, url).href : null };
}
// Page budgets are resumable, never an implicit end of the source.
export async function collectPagedRecords({fetchPage, startPage = 2, maxPages = 3, pageSize = 100}) {
  const first = await fetchPage(1), rows = [...first.rows];
  const totalPages = first.total !== undefined && first.total !== null && first.total !== '' && Number.isFinite(Number(first.total)) ? Math.ceil(Number(first.total) / pageSize) : null;
  if ((totalPages !== null && totalPages <= 1) || first.rows.length === 0) return {rows,nextPage:2,paginationExhausted:true};
  let page = Math.max(2,startPage), exhausted = false, count = 0;
  for (; count < maxPages; count++, page++) {
    if (totalPages !== null && page > totalPages) {exhausted=true;break;}
    let result;
    try { result = await fetchPage(page); }
    catch (error) { return {rows,nextPage:page,paginationExhausted:false,error:String(error.message || error)}; }
    rows.push(...result.rows);
    if (result.rows.length === 0 || totalPages !== null && page >= totalPages) {exhausted=true;break;}
  }
  return {rows,nextPage:exhausted ? 2 : page,paginationExhausted:exhausted};
}
