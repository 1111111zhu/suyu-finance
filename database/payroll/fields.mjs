/**
 * Stable payroll detail-column contract. No browser, database or I/O dependency.
 * money -> numeric(18,2); decimal -> numeric(10,4).
 * Changing an existing key/column requires an explicit database migration.
 */
export const payrollFields = Object.freeze([
  { key: 'name', label: '姓名', column: 'name', type: 'text' },
  { key: 'company', label: '公司', column: 'company', type: 'text' },
  { key: 'dept', label: '一级部门', column: 'dept', type: 'text' },
  { key: 'subdept', label: '二级部门', column: 'subdept', type: 'text' },
  { key: 'bankCard', label: '银行卡号', column: 'bank_card', type: 'text' },
  { key: 'bankName', label: '开户行', column: 'bank_name', type: 'text' },
  { key: 'status', label: '是否入离职', column: 'status', type: 'text' },
  { key: 'join', label: '入职日期', column: 'join_date', type: 'date' },
  { key: 'leave', label: '离职日期', column: 'leave_date', type: 'date' },
  { key: 'workdays', label: '应发薪', column: 'workdays', type: 'decimal' },
  { key: 'payableDays', label: '实际出勤天数', column: 'payable_days', type: 'decimal' },
  { key: 'base', label: '基本工资', column: 'base', type: 'money' },
  { key: 'post', label: '岗位工资', column: 'post', type: 'money' },
  { key: 'perfBase', label: '绩效基数', column: 'perf_base', type: 'money' },
  { key: 'effectiveScore', label: '绩效分数', column: 'effective_score', type: 'decimal' },
  { key: 'performancePay', label: '绩效工资', column: 'performance_pay', type: 'money' },
  { key: 'subtotal', label: '工资小计', column: 'subtotal', type: 'money' },
  { key: 'meal', label: '餐饮津贴', column: 'meal', type: 'money' },
  { key: 'transit', label: '交通津贴', column: 'transit', type: 'money' },
  { key: 'otherAllow', label: '其他津贴', column: 'other_allow', type: 'money' },
  { key: 'sickSubsidy', label: '病假补贴', column: 'sick_subsidy', type: 'money' },
  { key: 'otherAdd', label: '其他加', column: 'other_add', type: 'money' },
  { key: 'annual', label: '年假天数', column: 'annual', type: 'decimal' },
  { key: 'flexible', label: '弹性假天数', column: 'flexible', type: 'decimal' },
  { key: 'compensatory', label: '调休假天数', column: 'compensatory', type: 'decimal' },
  { key: 'sick', label: '病假天数', column: 'sick', type: 'decimal' },
  { key: 'personal', label: '事假天数', column: 'personal', type: 'decimal' },
  { key: 'absent', label: '旷工天数', column: 'absent', type: 'decimal' },
  { key: 'deductDays', label: '假勤扣薪天数', column: 'deduct_days', type: 'decimal' },
  { key: 'attendanceDeduct', label: '假勤扣款', column: 'attendance_deduct', type: 'money' },
  { key: 'otherReduction', label: '其他减', column: 'other_reduction', type: 'money' },
  { key: 'gross', label: '应发工资', column: 'gross', type: 'money' },
  { key: 'social', label: '个人社保', column: 'social', type: 'money' },
  { key: 'fund', label: '个人公积金', column: 'fund', type: 'money' },
  { key: 'isIntern', label: '是否实习生', column: 'is_intern', type: 'boolean' },
  { key: 'dailyRate', label: '日薪', column: 'daily_rate', type: 'money' },
  { key: 'regularizationDate', label: '转正日期', column: 'regularization_date', type: 'date' },
  { key: 'probationWorkdays', label: '转正前应出勤天数', column: 'probation_workdays', type: 'decimal' },
  { key: 'regularWorkdays', label: '转正后应出勤天数', column: 'regular_workdays', type: 'decimal' },
  { key: 'probationSalary', label: '转正前工资', column: 'probation_salary', type: 'money' },
  { key: 'regularSalary', label: '转正后工资', column: 'regular_salary', type: 'money' },
  { key: 'probationSubtotal', label: '转正前工资小计', column: 'probation_subtotal', type: 'money' },
  { key: 'regularSubtotal', label: '转正后工资小计', column: 'regular_subtotal', type: 'money' },
  { key: 'otherDeduct', label: '其它代扣', column: 'other_deduct', type: 'money' },
  { key: 'utility', label: '水电代扣', column: 'utility', type: 'money' },
  { key: 'mealDeduct', label: '餐费代扣', column: 'meal_deduct', type: 'money' },
  { key: 'tax', label: '个税', column: 'tax', type: 'money' },
  { key: 'afterTaxTotal', label: '税后代扣合计', column: 'after_tax_total', type: 'money' },
  { key: 'net', label: '实发工资', column: 'net', type: 'money' },
  { key: 'companySocial', label: '公司缴纳社保', column: 'company_social', type: 'money' },
  { key: 'companyFund', label: '公司缴纳公积金', column: 'company_fund', type: 'money' },
  { key: 'companyCost', label: '公司总成本', column: 'company_cost', type: 'money' },
  { key: 'remark', label: '备注', column: 'remark', type: 'text' },
  // Workbench inputs have distinct columns from their computed/exported values.
  { key: 'employeeNumber', label: '工号', column: 'employee_number', type: 'text' },
  { key: 'score', label: '绩效系数（调整输入）', column: 'score', type: 'decimal' },
  { key: 'actualPaidDays', label: '实际出勤天数（调整输入）', column: 'actual_paid_days', type: 'decimal' },
  { key: 'probationTotal', label: '转正前月薪', column: 'probation_total', type: 'money' },
  { key: 'regularTotal', label: '转正后月薪', column: 'regular_total', type: 'money' },
  { key: 'probationBase', label: '转正前基本工资', column: 'probation_base', type: 'money' },
  { key: 'regularBase', label: '转正后基本工资', column: 'regular_base', type: 'money' },
  { key: 'probationPost', label: '转正前岗位工资', column: 'probation_post', type: 'money' },
  { key: 'regularPost', label: '转正后岗位工资', column: 'regular_post', type: 'money' },
  { key: 'probationPerfBase', label: '转正前绩效基数', column: 'probation_perf_base', type: 'money' },
  { key: 'regularPerfBase', label: '转正后绩效基数', column: 'regular_perf_base', type: 'money' },
  { key: 'grossTarget', label: '应发工资调整目标', column: 'gross_target', type: 'money' },
  { key: 'netTarget', label: '实发工资调整目标', column: 'net_target', type: 'money' },
  { key: 'internPay', label: '实习工资', column: 'intern_pay', type: 'money' },
  { key: 'computedGross', label: '调整前应发工资', column: 'computed_gross', type: 'money' },
  { key: 'grossAdjustment', label: '应发工资调整额', column: 'gross_adjustment', type: 'money' },
  { key: 'computedNet', label: '调整前实发工资', column: 'computed_net', type: 'money' },
  { key: 'netAdjustment', label: '实发工资调整额', column: 'net_adjustment', type: 'money' },
].map(field => Object.freeze(field)));

const fieldsByKey = new Map(payrollFields.map(field => [field.key, field]));

// Explicit aliases only: an unfamiliar header containing “实习” is not inferred.
const legacyAliases = {
  payableDays: ['实发薪天数','实际出勤','出勤天数'],
  actualPaidDays: ['实发薪天数（调整输入）'],
  name: ['员工姓名'],
  company: ['签约公司'],
  dept: ['部门', '一级部门名称'],
  subdept: ['二级部门名称'],
  bankCard: ['银行卡'],
  bankName: ['银行', '开户银行'],
  status: ['员工状态', '在职状态', '入离职状态'],
  join: ['入职时间', '入职日'],
  leave: ['离职时间', '离职日'],
  workdays: ['应发薪天数'],
  base: ['工资基数'],
  effectiveScore: ['绩效系数'],
  meal: ['餐补合计','餐补','餐饮补贴','餐费补贴'],
  transit: ['交通补贴','交通补贴合计'],
  otherAdd: ['其他加项'],
  annual: ['年假(天)','年假'],
  flexible: ['弹性假(天)','弹性假'],
  compensatory: ['调休假(天)','调休假','调休','调休天数','调休(天)'],
  sick: ['病假(天)','病假'],
  personal: ['事假(天)','事假'],
  absent: ['旷工(天)','旷工'],
  otherReduction: ['其他减项'],
  gross: ['应发','应发金额','应发合计','本月应发'],
  social: ['个人总计'],
  fund: ['个人缴纳'],
  isIntern: ['是否实习', '实习标识', '本月是否为实习生', '实习'],
  dailyRate: ['实习生日薪'],
  regularizationDate: ['转正日', '转正时间'],
  probationWorkdays: ['试用期应出勤天数', '转正前出勤天数', '试用期计薪天数'],
  regularWorkdays: ['转正后出勤天数', '转正后计薪天数'],
  otherDeduct: ['其他代扣'],
  utility: ['员工宿舍水电费代扣', '水电费代扣', '水电费合计'],
  mealDeduct: ['餐费合计'],
  tax: ['应补（退）税额', '税', '个人所得税', '税额'],
  companySocial: ['公司总计', '公司总计（社保）'],
  companyFund: ['公司缴纳', '公司缴纳（公积金）'],
  employeeNumber: ['员工编号', '员工工号'],
};

const headerKey = header => header.replace(/\s+/gu, '').replace(/（/gu, '(').replace(/）/gu, ')');
const standardHeaders = new Map(payrollFields.map(field => [headerKey(field.label), field]));
const aliasHeaders = new Map(Object.entries(legacyAliases).flatMap(([key, aliases]) =>
  aliases.map((alias, index) => [headerKey(alias), { field: fieldsByKey.get(key), index }])));

function recordEntries(record, name) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(record))) {
    throw new TypeError(`${name} 必须是普通对象`);
  }
  // Avoid silently dropping symbol/non-enumerable fields or invoking getters.
  return Reflect.ownKeys(record).map(key => {
    if (typeof key !== 'string') throw new TypeError(`${name} 不支持 Symbol 字段`);
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${name} 仅支持自有、可枚举的数据字段`);
    }
    return [key, descriptor.value];
  });
}

function fixedDecimal(value, field) {
  const scale = field.type === 'money' ? 2 : 4;
  const precision = field.type === 'money' ? 18 : 10;
  if (!['string', 'number'].includes(typeof value)) {
    throw new TypeError(`${field.key} 必须是十进制字符串或有限 number`);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError(`${field.key} 不接受 NaN 或 Infinity`);
  }
  const match = /^([+-]?)(?:(\d+)(?:\.(\d+))?|\.(\d+))$/.exec(String(value).trim());
  if (!match) throw new TypeError(`${field.key} 必须是普通十进制数，不接受空白、指数、货币符号或分隔符`);
  const integer = (match[2] || '0').replace(/^0+(?=\d)/u, '');
  const fraction = match[3] || match[4] || '';
  if (fraction.length > scale) throw new RangeError(`${field.key} 最多允许 ${scale} 位小数，不进行舍入`);
  if (integer.length > precision - scale) {
    throw new RangeError(`${field.key} 超出 numeric(${precision},${scale}) 范围`);
  }
  const padded = fraction.padEnd(scale, '0');
  const units = BigInt(integer + padded);
  // High-magnitude JS numbers cannot reliably distinguish adjacent minor units.
  const numberLimit = 2 ** (53 - Math.ceil(Math.log2(10 ** scale)));
  if (typeof value === 'number'
    && (units > BigInt(Number.MAX_SAFE_INTEGER) || Math.abs(value) >= numberLimit)) {
    throw new RangeError(`${field.key} 的 number 精度不安全，请传入原始十进制字符串`);
  }
  const sign = match[1] === '-' && units !== 0n ? '-' : '';
  return `${sign}${integer}.${padded}`;
}

function dateString(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new TypeError(`${field.key} 必须严格使用 YYYY-MM-DD 字符串`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
    throw new RangeError(`${field.key} 不是有效公历日期`);
  }
  return value;
}

function normalizeValue(value, field) {
  if (value === null) return null;
  switch (field.type) {
    case 'money':
    case 'decimal':
      return fixedDecimal(value, field);
    case 'text':
      if (typeof value !== 'string') {
        throw new TypeError(`${field.key} 必须是字符串，工号及银行卡号应保留原始文本`);
      }
      return value;
    case 'date':
      return dateString(value, field);
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === 1 || value === 0) return value === 1;
      if (typeof value === 'string') {
        const token = value.trim().toUpperCase();
        if (['是', '实习生', '1', 'TRUE', 'Y'].includes(token)) return true;
        if (['否', '非实习生', '0', 'FALSE', 'N'].includes(token)) return false;
      }
      throw new TypeError(`${field.key} 必须是明确的实习布尔标识`);
    }
    default:
      throw new TypeError(`不支持的工资字段类型: ${field.type}`);
  }
}

/**
 * Convert a partial { JS key: value } record to { SQL column: normalized value }.
 * No defaulting, recalculation, rounding or employee lookup. Explicit null survives.
 * @param {Record<string, unknown>} values
 * @returns {Record<string, string | boolean | null>}
 */
export function normalizePayrollValues(values) {
  const entries = recordEntries(values, 'values');
  for (const [key] of entries) {
    if (!fieldsByKey.has(key)) throw new TypeError(`未知工资字段: ${key}`);
  }
  return Object.fromEntries(entries.map(([key, value]) => {
    const field = fieldsByKey.get(key);
    return [field.column, normalizeValue(value, field)];
  }));
}

/**
 * Map legacy headers to JS keys WITHOUT coercing source values or finding people.
 * Priority: exact standard label > equivalent standard label > JS key > alias.
 * Alias ties use the declared alias order; otherwise the first source column wins.
 * Recognized but superseded columns remain in unmapped for caller review.
 * @param {Record<string, unknown>} row
 * @returns {{ values: Record<string, unknown>, unmapped: Record<string, unknown> }}
 */
export function fromLegacyPayrollRow(row) {
  const entries = recordEntries(row, 'row');
  const selected = new Map();
  for (const [header, value] of entries) {
    const standard = standardHeaders.get(headerKey(header));
    const direct = fieldsByKey.get(header);
    const alias = aliasHeaders.get(headerKey(header));
    const candidate = standard
      ? { field: standard, priority: header === standard.label ? 4 : 3, aliasIndex: -1 }
      : direct ? { field: direct, priority: 2, aliasIndex: -1 }
        : alias ? { field: alias.field, priority: 1, aliasIndex: alias.index } : null;
    if (!candidate) continue;
    const previous = selected.get(candidate.field.key);
    if (!previous || candidate.priority > previous.priority
      || (candidate.priority === previous.priority && candidate.aliasIndex < previous.aliasIndex)) {
      selected.set(candidate.field.key, { ...candidate, header, value });
    }
  }
  const consumed = new Set([...selected.values()].map(item => item.header));
  return {
    values: Object.fromEntries([...selected].map(([key, item]) => [key, item.value])),
    unmapped: Object.fromEntries(entries.filter(([header]) => !consumed.has(header))),
  };
}
