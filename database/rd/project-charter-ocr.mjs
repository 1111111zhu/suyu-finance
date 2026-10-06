import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import WordExtractor from 'word-extractor';

const runFile = promisify(execFile);

async function extractDocumentText(buffer, filename) {
  const extension = extname(filename).toLowerCase();
  if (extension === '.doc' || extension === '.docx') {
    const extracted = await new WordExtractor().extract(buffer);
    return extracted.getBody() || '';
  }
  const directory = await mkdtemp(join(tmpdir(), 'rd-charter-'));
  const inputPath = join(directory, `document${extension || '.bin'}`);
  try {
    await writeFile(inputPath, buffer);
    if (extension === '.pdf') {
      try {
        const { stdout } = await runFile('pdftotext', ['-layout', inputPath, '-'], { maxBuffer: 4 * 1024 * 1024 });
        if (stdout.trim().length >= 40) return stdout;
      } catch { /* Scanned PDFs need the local OCR fallback below. */ }
      const prefix = join(directory, 'page');
      await runFile('pdftoppm', ['-f', '1', '-l', '8', '-r', '150', '-png', inputPath, prefix], { maxBuffer: 1024 * 1024 });
      const pages = (await readdir(directory)).filter(name => /^page-\d+\.png$/.test(name)).sort().slice(0, 8);
      const text = [];
      for (const page of pages) {
        const { stdout } = await runFile('tesseract', [join(directory, page), 'stdout', '-l', 'chi_sim+eng', '--psm', '6'], { maxBuffer: 2 * 1024 * 1024 });
        text.push(stdout);
      }
      return text.join('\n');
    }
    const { stdout } = await runFile('tesseract', [inputPath, 'stdout', '-l', 'chi_sim+eng', '--psm', '6'], { maxBuffer: 2 * 1024 * 1024 });
    return stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function parseDate(value) {
  const match = value.match(/(20\d{2})\s*[年./-]\s*(\d{1,2})(?:\s*[月./-]\s*(\d{1,2})\s*日?)?/);
  if (!match) return '';
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3] || 1);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${match[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function recognizeFields(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const labeledLine = labels => {
    const label = new RegExp(`(?:${labels})\\s*[：:]?\\s*(.{2,100})`, 'i');
    return lines.find(line => label.test(line))?.match(label)?.[1]?.trim() || '';
  };
  const name = labeledLine('项目名称|课题名称').replace(/[，,；;。].*$/, '').slice(0, 120);
  const budgetLine = labeledLine('经费预算|预算经费|项目预算|预算金额|经费总额|总投资|项目经费');
  const budgetMatch = budgetLine.match(/([\d,]+(?:\.\d{1,2})?)\s*(亿元|万元|万|元)?/);
  const unitBeforeNumber = budgetLine.match(/(亿元|万元|万|元)[^\d]{0,12}([\d,]+(?:\.\d{1,2})?)/);
  let budget = '';
  if (budgetMatch || unitBeforeNumber) {
    const amountToken = unitBeforeNumber?.[2] || budgetMatch?.[1] || '';
    const unit = unitBeforeNumber?.[1] || budgetMatch?.[2] || '';
    const number = Number(amountToken.replace(/,/g, ''));
    const multiplier = unit === '亿元' ? 100000000 : ['万元', '万'].includes(unit) ? 10000 : 1;
    if (Number.isFinite(number) && number >= 0) budget = String(Math.round(number * multiplier * 100) / 100);
  }
  const startText = labeledLine('起始日期|起始时间|开始日期|计划开始|项目开始时间|实施开始时间|起止时间|实施期限');
  const endText = labeledLine('结束日期|截止日期|计划完成|项目结束时间|实施结束时间');
  let startDate = parseDate(startText), endDate = parseDate(endText);
  if (!startDate || !endDate) {
    const range = text.match(/(20\d{2}\s*[年./-]\s*\d{1,2}(?:\s*[月./-]\s*\d{1,2}\s*日?)?)\s*(?:至|到|—|–|~|～|-)\s*(20\d{2}\s*[年./-]\s*\d{1,2}(?:\s*[月./-]\s*\d{1,2}\s*日?)?)/);
    if (range) { startDate ||= parseDate(range[1]); endDate ||= parseDate(range[2]); }
  }
  return { name, budget, startDate, endDate };
}

export async function recognizeProjectCharter(buffer, filename) {
  const extractedText = await extractDocumentText(buffer, filename);
  return { extractedText: extractedText.slice(0, 100000), fields: recognizeFields(extractedText) };
}
