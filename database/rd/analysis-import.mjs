import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { withTransaction } from '../payroll/pool.mjs';

const invalid = message => { throw Object.assign(new Error(message), { code: 'RD_ANALYSIS_VALIDATION' }); };
const conflict = message => { throw Object.assign(new Error(message), { code: 'RD_ANALYSIS_CONFLICT' }); };
const heading = value => String(value ?? '').replace(/\s+/g, '').trim();
const money = value => (Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100));
const decimal = cents => (cents / 100).toFixed(2);

function cell(sheet, row, col) {
  return sheet[XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })];
}

function numeric(sheet, row, col, required = false) {
  const address = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
  const entry = cell(sheet, row, col);
  if (!entry || entry.v === null || entry.v === '') {
    if (required) invalid(`研发项目主表 ${address} 缺少项目合计。`);
    return 0;
  }
  if (entry.t === 'e') invalid(`研发项目主表 ${address} 含 Excel 错误值。`);
  const value = typeof entry.v === 'number' ? entry.v
    : typeof entry.v === 'string' && /^-?\d+(?:\.\d+)?$/.test(entry.v.trim()) ? Number(entry.v.trim()) : NaN;
  if (!Number.isFinite(value) || Math.abs(value) > 1e13) invalid(`研发项目主表 ${address} 不是有效金额。`);
  return value;
}

export function parseAnalysisWorkbook(buffer, filename) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 20 * 1024 * 1024) invalid('请选择不超过 20 MB 的 Excel 结果文件。');
  if (typeof filename !== 'string' || !/\.xlsx$/i.test(filename) || filename.length > 255) invalid('仅支持 .xlsx 研发费用测算结果。');
  let book;
  try { book = XLSX.read(buffer, { type: 'buffer', sheetRows: 21, cellFormula: false, cellHTML: false }); }
  catch { invalid('Excel 文件无法读取，请检查是否为有效的 .xlsx 结果文件。'); }
  const sheet = book.Sheets['研发项目主表'];
  if (!sheet) invalid('结果文件缺少“研发项目主表”。');
  const headers = Array.from({ length: 25 }, (_, index) => String(cell(sheet, 1, index + 1)?.v ?? '').trim());
  if (heading(headers[0]) !== '项目编码' || !['科目名称', '项目名称'].includes(heading(headers[1]))) invalid('研发项目主表表头不符合测算结果格式。');
  const totalIndex = headers.findIndex(value => heading(value) === '项目成本合计');
  if (totalIndex < 5 || totalIndex > 24) invalid('研发项目主表缺少“项目成本合计”列。');
  const categories = headers.slice(2, totalIndex);
  if (categories.some(value => !heading(value) || value.length > 160) || new Set(categories.map(heading)).size !== categories.length) invalid('研发项目主表费用科目表头为空或重复。');
  if (!categories.some(value => heading(value) === '直接材料') || !categories.some(value => heading(value).startsWith('人员人工'))) invalid('研发项目主表缺少直接材料或人员人工列。');

  const rawTotals = Array.from({ length: categories.length }, () => 0);
  let rawGrandTotal = 0;
  let projectCount = 0;
  const codes = new Set();
  for (let row = 3; row <= 20; row++) {
    const code = String(cell(sheet, row, 1)?.v ?? '').trim();
    const hasAmounts = Array.from({ length: totalIndex - 1 }, (_, index) => cell(sheet, row, index + 3)?.v).some(value => value !== undefined && value !== null && value !== '');
    if (!code) {
      if (hasAmounts) invalid(`研发项目主表第 ${row} 行有金额但没有项目编码。`);
      continue;
    }
    if (codes.has(code)) invalid(`研发项目主表项目编码重复：${code}。`);
    codes.add(code);
    const values = categories.map((_, index) => numeric(sheet, row, index + 3));
    const total = numeric(sheet, row, totalIndex + 1, true);
    const sum = values.reduce((current, value) => current + value, 0);
    if (Math.abs(sum - total) > 0.015) invalid(`研发项目主表第 ${row} 行费用分项与项目合计不一致。`);
    values.forEach((value, index) => { rawTotals[index] += value; });
    rawGrandTotal += total;
    projectCount++;
  }
  if (!projectCount) invalid('研发项目主表没有可导入的项目金额。');

  const monthSheets = book.SheetNames.map(name => /^项目分类明细汇总表(1[0-2]|[1-9])月$/.exec(name)).filter(Boolean);
  if (monthSheets.length > 1) invalid('文件包含多个测算月份，请按单月结果分别导入。');
  const monthHint = monthSheets.length ? Number(monthSheets[0][1]) : null;
  const yearLabels = new Set(book.SheetNames.map(name => String(book.Sheets[name]?.A1?.v ?? '')).map(value => /\b(20\d{2})年研发费用审核明细表/.exec(value)?.[1]).filter(Boolean));
  if (yearLabels.size > 1) invalid('文件中出现多个核算年度。');
  const yearHint = yearLabels.size ? Number([...yearLabels][0]) : null;
  const sourceFormat = monthHint ? 'fixed-template' : 'legacy-main-sheet';
  const lines = categories.map((category, index) => ({ category, amount: decimal(money(rawTotals[index])) }));
  const totalCents = money(rawGrandTotal);
  const difference = totalCents - lines.reduce((sum, line) => sum + money(Number(line.amount)), 0);
  if (Math.abs(difference) > 25) invalid('费用科目金额与项目合计差异过大，无法可靠导入。');
  if (difference) lines.push({ category: '历史测算尾差', amount: decimal(difference) });
  return {
    filename, sha256: createHash('sha256').update(buffer).digest('hex'),
    sourceFormat, yearHint, monthHint, projectCount,
    total: decimal(totalCents), categories: lines,
  };
}

export async function importAnalysisWorkbook(pool, { parsed, scope, year, month, acknowledged }) {
  if (typeof scope !== 'string' || !scope.trim() || scope.trim().length > 80) invalid('请填写核算主体。');
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) invalid('请选择有效的核算年度和月份。');
  if (parsed.yearHint && parsed.yearHint !== year) invalid(`文件标注的年度是 ${parsed.yearHint} 年，请核对所选年度。`);
  if (parsed.monthHint && parsed.monthHint !== month) invalid(`文件标注的月份是 ${parsed.monthHint} 月，请核对所选月份。`);
  if ((!parsed.yearHint || !parsed.monthHint) && !acknowledged) invalid('旧版文件没有完整期间标识，请确认它只包含所选月份的最终测算结果。');
  const normalizedScope = scope.trim();
  const period = `${year}-${String(month).padStart(2, '0')}-01`;
  return withTransaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`rd-batch:${normalizedScope}:${period}`]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext('rd-catalog-write'))");
    if(parsed.categories.some(line=>/人工|薪|工资|社保|公积金/.test(line.category)&&Number(line.amount)!==0)) {
      const payroll=await client.query("SELECT 1 FROM rd.ledger_entries WHERE id LIKE 'payroll:%' AND date_trunc('month',entry_date)=$1::date LIMIT 1",[period]);
      if(payroll.rowCount)conflict('该月份已有工资归集人工费用，历史结果包含人工费用，请先核对来源，不能重复导入');
    }
    const confirmed = await client.query("SELECT 1 FROM rd.calculation_runs WHERE scope=$1 AND period=$2::date AND status='confirmed' LIMIT 1", [normalizedScope, period]);
    if (confirmed.rowCount) conflict('该主体、月份已有已确认入账的测算批次，请勿重复导入历史结果。');
    const previous = (await client.query("SELECT id,sha256 FROM rd.analysis_imports WHERE scope=$1 AND period=$2::date AND status='active' FOR UPDATE", [normalizedScope, period])).rows[0];
    if (previous?.sha256 === parsed.sha256) return { id: previous.id, scope: normalizedScope, year, month, total: parsed.total, repeated: true };
    if (previous) await client.query("UPDATE rd.analysis_imports SET status='superseded',superseded_at=CURRENT_TIMESTAMP WHERE id=$1", [previous.id]);
    const id = randomUUID();
    await client.query(`INSERT INTO rd.analysis_imports(id,scope,period,filename,sha256,source_format,project_count,total,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active')`, [id, normalizedScope, period, parsed.filename, parsed.sha256, parsed.sourceFormat, parsed.projectCount, parsed.total]);
    for (const line of parsed.categories) await client.query('INSERT INTO rd.analysis_import_lines(import_id,category,amount) VALUES($1,$2,$3)', [id, line.category, line.amount]);
    return { id, scope: normalizedScope, year, month, total: parsed.total, repeated: false, replaced: Boolean(previous) };
  });
}
