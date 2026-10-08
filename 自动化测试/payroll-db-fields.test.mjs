import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { payrollFields, normalizePayrollValues, fromLegacyPayrollRow } from '../database/payroll/fields.mjs';

const salarySource = readFileSync(new URL('../public/salary/payroll-engine.js', import.meta.url), 'utf8');
const workbenchSource = readFileSync(new URL('../public/salary/workbench-core.js', import.meta.url), 'utf8');
// Read only the field literals; never execute browser/workbench initialization.
const engineFields = ['fields', 'netFields'].flatMap(name => {
  const literal = salarySource.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n  \\]);`));
  assert.ok(literal, `Missing PayrollEngine.${name} definition`);
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(${literal[1]})`)));
});
const workbenchLiteral = workbenchSource.match(/const fields = (\{[\s\S]*?\n  \});/);
assert.ok(workbenchLiteral, 'Missing PayrollWorkbench.fields definition');
const workbenchFields = JSON.parse(JSON.stringify(vm.runInNewContext(`(${workbenchLiteral[1]})`)));
const byKey = new Map(payrollFields.map(field => [field.key, field]));
const numericFields = payrollFields.filter(field => ['money', 'decimal'].includes(field.type));

test('SQL-facing contract has stable keys, order, unique safe columns and immutable descriptors', () => {
  const stableKeys = `name company dept subdept bankCard bankName status join leave workdays payableDays
    base post perfBase effectiveScore performancePay subtotal meal transit otherAllow sickSubsidy otherAdd
    annual flexible compensatory sick personal absent deductDays attendanceDeduct otherReduction gross social fund
    isIntern dailyRate regularizationDate probationWorkdays regularWorkdays probationSalary regularSalary
    probationSubtotal regularSubtotal otherDeduct utility mealDeduct tax afterTaxTotal net companySocial companyFund
    companyCost remark employeeNumber score actualPaidDays probationTotal regularTotal probationBase regularBase
    probationPost regularPost probationPerfBase regularPerfBase grossTarget netTarget internPay computedGross
    grossAdjustment computedNet netAdjustment`.split(/\s+/u);
  assert.deepEqual(payrollFields.map(field => field.key), stableKeys);
  assert.equal(payrollFields.length, 71);
  assert.equal(new Set(payrollFields.map(field => field.column)).size, 71);
  assert.equal(new Set(payrollFields.map(field => field.label)).size, 71);
  const dateColumns = { join: 'join_date', leave: 'leave_date' };
  for (const field of payrollFields) {
    assert.deepEqual(Object.keys(field), ['key', 'label', 'column', 'type']);
    assert.match(field.column, /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u);
    assert.ok(field.column.length <= 63);
    assert.ok(['money', 'decimal', 'text', 'date', 'boolean'].includes(field.type));
    assert.equal(field.column, dateColumns[field.key] || field.key.replace(/[A-Z]/gu, char => `_${char.toLowerCase()}`));
    assert.ok(Object.isFrozen(field));
  }
  assert.ok(Object.isFrozen(payrollFields));
  assert.throws(() => { payrollFields[0].column = 'renamed'; }, TypeError);
  assert.throws(() => payrollFields.pop(), TypeError);
});

test('all current engine fields, labels, types and all workbench adjustment keys are covered', () => {
  assert.equal(engineFields.length, 53);
  for (const [label, key, type] of engineFields) {
    assert.ok(byKey.has(key), key);
    assert.equal(byKey.get(key).label, label);
    assert.equal(byKey.get(key).type, { number: 'decimal', intern: 'boolean' }[type] || type);
  }
  for (const key of Object.keys(workbenchFields)) {
    assert.ok(byKey.has(key), key);
    assert.equal(byKey.get(key).type, /Days$|Workdays$/u.test(key)
      || ['score', 'sick', 'personal', 'absent', 'annual', 'flexible', 'compensatory'].includes(key) ? 'decimal' : 'money');
  }
  const extraKeys = ['employeeNumber', 'internPay', 'computedGross', 'grossAdjustment', 'computedNet', 'netAdjustment'];
  for (const key of extraKeys) {
    assert.ok(workbenchSource.includes(key), key);
    assert.equal(byKey.get(key).type, key === 'employeeNumber' ? 'text' : 'money');
  }
  assert.deepEqual(new Set(payrollFields.map(field => field.key)),
    new Set([...engineFields.map(field => field[1]), ...Object.keys(workbenchFields), ...extraKeys]));
});

test('every field normalizes and all canonical labels round-trip through the two interfaces', () => {
  const sample = { money: '12.30', decimal: '1.2345', text: '000000', date: '2024-02-29', boolean: false };
  const values = Object.fromEntries(payrollFields.map(field => [field.key, sample[field.type]]));
  const expected = Object.fromEntries(payrollFields.map(field => [field.column, sample[field.type]]));
  assert.deepEqual(normalizePayrollValues(values), expected);
  const row = Object.fromEntries(payrollFields.map(field => [field.label, sample[field.type]]));
  assert.deepEqual(fromLegacyPayrollRow(row), { values, unmapped: {} });
  assert.deepEqual(normalizePayrollValues(fromLegacyPayrollRow(row).values), expected);
});

test('partial updates preserve explicit null/zero/false and do not invent defaults', () => {
  assert.deepEqual(normalizePayrollValues({}), {});
  assert.deepEqual(fromLegacyPayrollRow({}), { values: {}, unmapped: {} });
  const nulls = Object.fromEntries(payrollFields.map(field => [field.key, null]));
  assert.deepEqual(normalizePayrollValues(nulls), Object.fromEntries(payrollFields.map(field => [field.column, null])));
  for (const field of numericFields) {
    for (const zero of [0, -0, '0', '-0', '+000.0']) {
      assert.deepEqual(normalizePayrollValues({ [field.key]: zero }), {
        [field.column]: field.type === 'money' ? '0.00' : '0.0000',
      });
    }
  }
  const input = Object.freeze({ gross: null, net: 0, isIntern: false, remark: '' });
  assert.deepEqual(normalizePayrollValues(input), { gross: null, net: '0.00', is_intern: false, remark: '' });
  assert.deepEqual(input, { gross: null, net: 0, isIntern: false, remark: '' });
  assert.throws(() => normalizePayrollValues({ gross: undefined }), /gross/u);
});

test('money emits exact fixed-point strings, including full numeric(18,2) boundaries', () => {
  const cases = [
    [1.23, '1.23'], [1.01, '1.01'], [0.29, '0.29'], [-0.01, '-0.01'],
    ['000001.20', '1.20'], [' +12.3 ', '12.30'], ['.5', '0.50'], ['-.01', '-0.01'],
    ['9999999999999999.99', '9999999999999999.99'],
    ['-9999999999999999.99', '-9999999999999999.99'],
    ['9007199254740993', '9007199254740993.00'],
  ];
  for (const [input, output] of cases) assert.deepEqual(normalizePayrollValues({ gross: input }), { gross: output });
  for (const input of ['10000000000000000', '-10000000000000000.00', '1.001', '1.230', '-0.001', 0.1 + 0.2, 1.005]) {
    assert.throws(() => normalizePayrollValues({ gross: input }), RangeError);
  }
  for (const input of [Number.MAX_SAFE_INTEGER, 2 ** 46, 90071992547409.9]) {
    assert.throws(() => normalizePayrollValues({ gross: input }), /精度不安全/u);
  }
});

test('decimal days and scores preserve four places and enforce numeric(10,4) boundaries', () => {
  for (const field of numericFields.filter(item => item.type === 'decimal')) {
    for (const [input, output] of [['22.125', '22.1250'], [0.0001, '0.0001'],
      ['999999.9999', '999999.9999'], ['-999999.9999', '-999999.9999']]) {
      assert.deepEqual(normalizePayrollValues({ [field.key]: input }), { [field.column]: output });
    }
    for (const input of ['1000000', '-1000000', '0.00001', '1.00000']) {
      assert.throws(() => normalizePayrollValues({ [field.key]: input }), RangeError);
    }
  }
});

test('numeric fields reject invalid/coercible inputs without silent parsing or rounding', () => {
  const invalid = [NaN, Infinity, -Infinity, '', ' ', 'NaN', 'Infinity', '-Infinity',
    '1e2', '0x10', '1,000.00', '￥1.00', '1 0', '1，000', '1%', '1.',
    true, false, null, undefined, [], {}, 1n, new Number(1)];
  for (const field of numericFields) {
    for (const value of invalid.filter(value => value !== null)) {
      assert.throws(() => normalizePayrollValues({ [field.key]: value }), Error, field.key);
    }
  }
});

test('known text remains literal text with leading zeros; numeric identifiers are rejected', () => {
  const values = { employeeNumber: '00000042', bankCard: '0000000000000000', remark: ' 001.20 ' };
  assert.deepEqual(normalizePayrollValues(values), {
    employee_number: '00000042', bank_card: '0000000000000000', remark: ' 001.20 ',
  });
  for (const field of payrollFields.filter(item => item.type === 'text')) {
    for (const value of [0, 123, 1n, false, {}, undefined]) {
      assert.throws(() => normalizePayrollValues({ [field.key]: value }), /字符串/u);
    }
  }
});

test('dates validate exact format, real calendar dates, leap years and year bounds', () => {
  for (const field of payrollFields.filter(item => item.type === 'date')) {
    for (const value of ['0001-01-01', '0099-12-31', '2000-02-29', '2024-02-29', '9999-12-31']) {
      assert.deepEqual(normalizePayrollValues({ [field.key]: value }), { [field.column]: value });
    }
    for (const value of ['0000-01-01', '10000-01-01', '1900-02-29', '2100-02-29', '2025-02-29',
      '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32',
      '2026-1-01', '2026/01/01', '2026-01-01T00:00:00Z', '2026-01-01\n', ' 2026-01-01',
      '', '2026年01月01日', 46000, new Date('2026-01-01'), undefined]) {
      assert.throws(() => normalizePayrollValues({ [field.key]: value }), Error, field.key);
    }
  }
});

test('intern flags accept explicit legacy tokens and reject unknown truthy/falsy values', () => {
  for (const value of [true, 1, '是', '实习生', '1', 'true', ' Y ']) {
    assert.deepEqual(normalizePayrollValues({ isIntern: value }), { is_intern: true });
  }
  for (const value of [false, 0, '否', '非实习生', '0', 'false', ' N ']) {
    assert.deepEqual(normalizePayrollValues({ isIntern: value }), { is_intern: false });
  }
  for (const value of ['', ' ', '未确认', '实习工资', 2, NaN, {}, undefined]) {
    assert.throws(() => normalizePayrollValues({ isIntern: value }), /布尔/u);
  }
});

test('regularization, internship and after-tax amounts map independently without recalculation', () => {
  const values = {
    regularizationDate: '2026-09-15', probationWorkdays: '10.125', regularWorkdays: '11.875',
    probationSalary: '1.00', regularSalary: '2.00', probationSubtotal: '3.00', regularSubtotal: '4.00',
    probationTotal: '5.00', regularTotal: '6.00', probationBase: '7.00', regularBase: '8.00',
    probationPost: '9.00', regularPost: '10.00', probationPerfBase: '11.00', regularPerfBase: '12.00',
    isIntern: true, dailyRate: '13.00', internPay: '14.00', social: '15.00', fund: '16.00', tax: '17.00',
    otherDeduct: '18.00', utility: '19.00', mealDeduct: '20.00', afterTaxTotal: '57.00',
    computedGross: '100.00', grossAdjustment: '-0.01', gross: '99.99', grossTarget: null,
    computedNet: '90.00', netAdjustment: '0.01', net: '90.01', netTarget: '90.01',
  };
  const result = normalizePayrollValues(values);
  for (const [key, value] of Object.entries(values)) {
    assert.equal(result[byKey.get(key).column], key.endsWith('Workdays') ? `${value}0` : value);
  }
  assert.equal(result.social, '15.00', 'mapping does not overwrite intern deductions');
});

test('every existing engine alias maps to its JS key; canonical columns win in either order', () => {
  for (const [label, key, , aliases = []] of engineFields) {
    for (const alias of aliases) {
      assert.deepEqual(fromLegacyPayrollRow({ [alias]: '0001' }), { values: { [key]: '0001' }, unmapped: {} });
      for (const entries of [[[alias, 'other'], [label, null]], [[label, null], [alias, 'other']]]) {
        assert.deepEqual(fromLegacyPayrollRow(Object.fromEntries(entries)), {
          values: { [key]: null }, unmapped: { [alias]: 'other' },
        });
      }
    }
  }
});

test('workbench labels and employee-number aliases map without conflating computed outputs', () => {
  const overlapping = { score: 'effectiveScore', actualPaidDays: 'payableDays', grossTarget: 'gross', netTarget: 'net' };
  for (const [key, [label]] of Object.entries(workbenchFields)) {
    assert.deepEqual(fromLegacyPayrollRow({ [label]: 0 }).values, { [overlapping[key] || key]: 0 });
  }
  for (const label of ['工号', '员工编号', '员工工号']) {
    assert.deepEqual(fromLegacyPayrollRow({ [label]: '00000042' }), { values: { employeeNumber: '00000042' }, unmapped: {} });
  }
  const result = fromLegacyPayrollRow({ 绩效系数: '1.25', score: '1.5', 实际出勤天数: 22, actualPaidDays: 21,
    应发工资: '1.00', grossTarget: '2.00', 实发工资: '3.00', netTarget: '4.00' });
  assert.deepEqual(result, { values: { effectiveScore: '1.25', score: '1.5', payableDays: 22, actualPaidDays: 21,
    gross: '1.00', grossTarget: '2.00', net: '3.00', netTarget: '4.00' }, unmapped: {} });
});

test('legacy precedence is deterministic; header normalization never changes source values', () => {
  assert.deepEqual(fromLegacyPayrollRow({ ' 年假（天） ': '01.00', '公司总计(社保)': 0 }), {
    values: { annual: '01.00', companySocial: 0 }, unmapped: {},
  });
  for (const entries of [
    [['税額', 'unknown'], ['税额', 4], ['个人所得税', 3], ['tax', 2], [' 个 税 ', 1], ['个税', 0]],
    [['个税', 0], [' 个 税 ', 1], ['tax', 2], ['个人所得税', 3], ['税额', 4], ['税額', 'unknown']],
  ]) {
    const result = fromLegacyPayrollRow(Object.fromEntries(entries));
    assert.deepEqual(result.values, { tax: 0 });
    assert.deepEqual(new Set(Object.keys(result.unmapped)), new Set(['税額', '税额', '个人所得税', 'tax', ' 个 税 ']));
  }
  assert.equal(fromLegacyPayrollRow({ 税额: 3, 个人所得税: 2, 税: 1 }).values.tax, 1);
  assert.equal(fromLegacyPayrollRow({ 税: 1, 个人所得税: 2, 税额: 3 }).values.tax, 1);
});

test('legacy mapping preserves invalid raw values and unknown headers for explicit review', () => {
  const row = Object.freeze({ 姓名: '虚构同名', 基本工资: '1.234', 离职日期: '', 其他来源字段: 0, 实习备注: null, id: 'DEMO' });
  const result = fromLegacyPayrollRow(row);
  assert.deepEqual(result, { values: { name: '虚构同名', base: '1.234', leave: '' },
    unmapped: { 其他来源字段: 0, 实习备注: null, id: 'DEMO' } });
  assert.throws(() => normalizePayrollValues(result.values), /最多允许 2 位/u);
  assert.deepEqual(fromLegacyPayrollRow({ 姓名: '虚构同名' }), { values: { name: '虚构同名' }, unmapped: {} });
  assert.ok(!Object.hasOwn(result.values, 'employeeNumber'));
  assert.deepEqual(fromLegacyPayrollRow({ 个税: undefined }), { values: { tax: undefined }, unmapped: {} });
  assert.equal(row.基本工资, '1.234');
});

test('normalization fails clearly for every unknown key, including prototype names and SQL text', () => {
  for (const key of ['unknown', 'bank_card', 'gross; DROP TABLE payroll', '__proto__', 'constructor', 'toString', 'id', '']) {
    assert.throws(() => normalizePayrollValues(Object.fromEntries([['gross', 0], [key, null]])), /未知工资字段/u);
  }
  const poison = Object.fromEntries([['__proto__', { demo: true }], ['constructor', 0], ['其它代扣', 0]]);
  const result = fromLegacyPayrollRow(poison);
  assert.deepEqual(result.values, { otherDeduct: 0 });
  assert.equal(Object.getPrototypeOf(result.unmapped), Object.prototype);
  assert.equal(Object.hasOwn(result.unmapped, '__proto__'), true);
  assert.equal(Object.hasOwn(result.unmapped, 'demo'), false);
});

test('both interfaces reject non-records and non-data properties without side effects', () => {
  let calls = 0;
  const getter = { get gross() { calls += 1; return 0; } };
  const hidden = Object.defineProperty({}, 'gross', { value: 0 });
  for (const fn of [normalizePayrollValues, fromLegacyPayrollRow]) {
    for (const input of [null, undefined, '', 0, [], new Date(), new Map(), Object.create({ gross: 0 }),
      { [Symbol('gross')]: 0 }, getter, hidden]) {
      assert.throws(() => fn(input), TypeError);
    }
    assert.deepEqual(fn(Object.create(null)), fn({}));
  }
  assert.equal(calls, 0);
});
