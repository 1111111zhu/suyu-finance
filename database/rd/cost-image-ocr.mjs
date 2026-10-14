import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const runFile = promisify(execFile);
const kinds = new Set(['hours', 'salary', 'balance', 'ledger']);
export const IMAGE_LIMIT = 50 * 1024 * 1024;
const fail = message => { throw Object.assign(new Error(message), { status: 422, code: 'RD_IMAGE_VALIDATION' }); };
const compact = value => String(value).normalize('NFKC').replace(/\s+/g, '').trim();
export function imageFormat(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'jpg';
  if (buffer.length >= 12 && buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WEBP') return 'webp';
  fail('仅支持真实的 PNG、JPEG 或 WebP 图片。');
}
export function parseImageNumber(value) {
  const text = compact(value).replace(/[¥￥]/g, '').replace(/−/g, '-');
  if (!text) return null;
  const wrapped = /^\(.*\)$/.test(text);
  const number = wrapped ? text.slice(1,-1) : text;
  // Commas must be thousands separators; OCR letter substitutions are never guessed.
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(number)) fail('金额或工时含有无法确认的字符，请上传清晰图片或使用 Excel。');
  const result = Number(number.replace(/,/g,'')) * (wrapped ? -1 : 1);
  if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER) fail('金额或工时超出可识别范围。');
  return result;
}
function readLines(tsv, minimumX = -Infinity) {
  const words = String(tsv).split(/\r?\n/).slice(1).map(line => {
    const c = line.split('\t');
    return {level:Number(c[0]), x:Number(c[6]), y:Number(c[7]), w:Number(c[8]), h:Number(c[9]), confidence:Number(c[10]), text:c.slice(11).join('\t').trim()};
  }).filter(w => w.level === 5 && w.text && [w.x,w.y,w.w,w.h,w.confidence].every(Number.isFinite) && w.w > 0 && w.h > 0 && w.x+w.w >= minimumX);
  words.sort((a,b) => a.y + a.h/2 - (b.y+b.h/2) || a.x-b.x);
  const lines = [];
  for (const word of words) {
    const center = word.y + word.h/2;
    let line = lines.find(candidate => Math.abs(candidate.center-center) <= Math.min(candidate.height,word.h)*.5);
    if (!line) { line = {center, height:word.h, words:[]}; lines.push(line); }
    line.words.push(word);
  }
  return lines.sort((a,b) => a.center-b.center).map(line => ({...line, words:line.words.sort((a,b)=>a.x-b.x)}));
}
function headerCells(line) {
  const cells = [];
  for (const word of line.words) {
    const last = cells.at(-1);
    if (last && word.x-last.right <= Math.max(8, line.height*.65)) {
      last.text += word.text; last.right = word.x+word.w;
    } else cells.push({text:word.text, left:word.x, right:word.x+word.w});
  }
  return cells.map(cell => ({...cell, text:compact(cell.text).replace(/^[\"'“”‘’]+|[\"'“”‘’]+$/g,''), center:(cell.left+cell.right)/2}));
}
const isName = text => /^(姓名|人员姓名|员工姓名|人员名称|研发人员)$/.test(text);
const isProject = text => /^(研发项目|项目编码|项目编号)$/.test(text);
const isTotal = text => /^(工时汇总|工时合计|总工时|工时总计|\d{1,2}月)$/.test(text);
const isSalary = text => /^(工资费用|工资|应发工资|实发工资|工资合计|\d{1,2}月工资费用)$/.test(text);
const isAmount = text => /借方|贷方|金额/.test(text);
// Ambiguous OCR letters remain visible for human correction, never normalized to digits.
const isRd = text => /^R[DC][0-9A-Z]+(?:-[0-9A-Z]+)*$/i.test(text);
function validHeader(cells, kind) {
  const labels = cells.map(c=>c.text);
  if (kind==='hours') return labels.some(isName) && labels.some(isTotal) && labels.filter(isRd).length >= 2;
  if (kind==='salary') return labels.some(isName) && labels.some(isSalary);
  if (kind==='balance') return labels.includes('费用项目') && labels.some(isProject) && labels.some(isAmount);
  return labels.includes('摘要') && labels.some(text=>/借方|贷方/.test(text)) && labels.some(text=>/日期/.test(text));
}
export function parseCostImageTsv(tsv, kind) {
  if (!kinds.has(kind)) fail('请选择工时、工资、科目余额或明细账图片。');
  const lines = readLines(tsv);
  const candidates = lines.map((line,index)=>({line,index,cells:headerCells(line)})).filter(item=>validHeader(item.cells,kind));
  if (candidates.length !== 1) fail(candidates.length ? '识别到多个表头，请每次上传一张完整表格图片。' : '未识别到完整表头，请保留姓名、工时或金额及项目字段后重新上传。');
  const {index,cells} = candidates[0];
  const rows = [cells.map(c=>isRd(c.text) ? c.text.toUpperCase() : c.text)];
  let missing = false, lowConfidence = false, projectNames = false, uncertainNumbers = false;
  // Exclude spreadsheet coordinate chrome before row clustering: its shorter text
  // boxes can otherwise split one real data row into two.
  const dataLines = readLines(tsv, cells[0].left - candidates[0].line.height*.25).filter(line=>line.center > candidates[0].line.center + candidates[0].line.height*.5);
  for (const line of dataLines) {
    const fields = cells.map(()=>[]);
    for (const word of line.words) {
      if(word.x+word.w < cells[0].left-line.height*.25) continue;
      // Spreadsheet row chrome sometimes bleeds into a quoted first header. Do not add
      // a detached narrow row index to a categorical fee value.
      if(kind==='balance' && /^\d+$/.test(word.text) && word.w<line.height && word.x+word.w<cells[0].left+line.height && line.words.some(next=>next.x>word.x+word.w+line.height)) continue;
      const center = word.x+word.w/2;
      let column = cells.findIndex((cell,i)=>center < ((cells[i+1]?.left ?? Infinity) - line.height*.25));
      if (column<0) column=cells.length-1;
      fields[column].push(word.text);
      if(word.confidence < 65) lowConfidence=true;
    }
    const raw = fields.map(words=>compact(words.join('')));
    if(raw.every(v=>!v)) continue;
    if(raw.some(v=>/^(合计|总计|小计)$/.test(v))) continue;
    if(kind==='hours' && rows.length===1 && raw.filter((v,i)=>!isRd(cells[i].text)).every(v=>!v) && raw.some((v,i)=>isRd(cells[i].text)&&v)) {
      rows.push(raw.map(v=>v||null)); projectNames=true; continue;
    }
    const row = raw.map((v,i)=> {
      const numeric = kind==='hours' ? isTotal(cells[i].text)||isRd(cells[i].text) : kind==='salary' ? isSalary(cells[i].text)||isAmount(cells[i].text) : isAmount(cells[i].text);
      if(numeric) {if(!v) missing=true; try { return parseImageNumber(v); } catch { uncertainNumbers=true; return v; }}
      return v || null;
    });
    const key = cells.findIndex(c=>kind==='hours'||kind==='salary' ? isName(c.text) : kind==='balance' ? isProject(c.text) : /日期/.test(c.text));
    if(key<0 || row[key]===null) fail('有数据行缺少姓名、项目或日期，请上传完整表格后重试。');
    rows.push(row);
  }
  if(rows.length < (projectNames ? 3 : 2)) fail('图片没有可识别的数据行，请上传完整清晰的表格。');
  if(kind==='hours' && !projectNames) rows.splice(1,0,cells.map(()=>null));
  return {rows, kind, needsReview:true, warning:`图片识别必须逐行核对姓名、项目、月份及金额后才能测算。${kind==='hours'?'项目表头字符（例如 O 与 0）须人工核对，表头下一行为项目名称。':''}${missing?'存在空白数值单元格，未自动填零，请补齐或明确填写 0。':''}${lowConfidence?'部分文字识别置信度较低，请重点核对。':''}${uncertainNumbers?'存在无法确认的金额或工时字符，已保留原文，请更正后再测算。':''}`};
}
const busyKey = Symbol.for('suyu.rd.imageOcrBusy');
export async function recognizeCostImage(buffer, kind, { executor = runFile } = {}) {
  if(!kinds.has(kind)) fail('图片类型无效。');
  if(!Buffer.isBuffer(buffer) || !buffer.length || buffer.length>IMAGE_LIMIT) fail('图片不能为空且不能超过 50 MB。');
  const extension=imageFormat(buffer);
  if(globalThis[busyKey]) throw Object.assign(new Error('图片识别正在处理另一张图片，请稍后重试。'),{status:503,code:'RD_IMAGE_OCR_BUSY'});
  globalThis[busyKey]=true;
  let directory;
  try {
    directory=await mkdtemp(join(tmpdir(),'rd-cost-image-'));
    const input=join(directory,`source.${extension}`);
    await writeFile(input,buffer,{mode:0o600});
    let result;
    const python=process.env.RD_OCR_PYTHON || '/opt/suyu-finance/ocr-venv/bin/python3';
    const bridge=process.env.RD_OCR_SCRIPT || join(process.cwd(),'database/rd/rapidocr_bridge.py');
    try {result=await executor(python,[bridge,input],{timeout:120000,maxBuffer:8*1024*1024});}
    catch {throw Object.assign(new Error('本机图片识别服务不可用或图片无法读取，请使用 Excel 文件。'),{status:503,code:'RD_IMAGE_OCR_UNAVAILABLE'});}
    return parseCostImageTsv(result.stdout,kind);
  } finally {try {if(directory) await rm(directory,{recursive:true,force:true});} finally {globalThis[busyKey]=false;}}
}
