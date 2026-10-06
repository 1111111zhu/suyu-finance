import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseAnalysisWorkbook } from '../database/rd/analysis-import.mjs';

function workbook(projectTotal = 60) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['项目编码', '科目名称', '直接材料', '人员人工（含社保+公积金）', '运费', '项目成本合计'],
    [],
    ['RD-001', '测试项目', 10, 20, 30, projectTotal],
  ]), '研发项目主表');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['2026年研发费用审核明细表']]), '研发明细表');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['汇总']]), '项目分类明细汇总表7月');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

test('历史结果解析提取期间、项目数与费用分项', () => {
  const result = parseAnalysisWorkbook(workbook(), '历史测算.xlsx');
  assert.equal(result.yearHint, 2026);
  assert.equal(result.monthHint, 7);
  assert.equal(result.projectCount, 1);
  assert.equal(result.total, '60.00');
  assert.deepEqual(result.categories.map(line => line.amount), ['10.00', '20.00', '30.00']);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
});

test('历史结果金额不勾稽时拒绝导入', () => {
  assert.throws(() => parseAnalysisWorkbook(workbook(61), '历史测算.xlsx'), /费用分项与项目合计不一致/);
});
