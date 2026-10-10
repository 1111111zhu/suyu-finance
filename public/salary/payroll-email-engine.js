/* Pure rules for turning a final payroll table into a reviewable email draft. */
globalThis.PayrollEmailEngine = (() => {
  const DEFAULT_RECIPIENT = '2745738591@qq.com';
  const DEFAULT_RECIPIENT_NAME = '董博';
  // 写信地址需要登录后由企业微信邮箱动态补充 sid，不能从本地页面静态拼接。
  const MAILBOX_URL = 'https://exmail.qq.com/login';
  const SECTION_ORDER = [
    ['salaryAdjustments', '本月调薪人员'],
    ['regularizations', '本月转正人员'],
    ['departures', '本月离职人员'],
    ['newHires', '本月新入职人员'],
    ['attendanceDeduct', '本月假勤情况：扣薪假勤'],
    ['attendanceNoDeduct', '本月假勤情况：无扣薪假勤'],
    ['overtime', '本月加班费核算情况'],
    ['internSubsidies', '本月实习生劳务核算情况']
  ];
  const aliases = {
    company: ['公司', '公司主体'],
    location: ['工作地点', '地点', '城市', '办公地', '所属城市'],
    beforeSalary: ['调整前工资', '调薪前工资', '调整前月薪', '调薪前月薪', '原工资', '原月薪'],
    afterSalary: ['调整后工资', '调薪后工资', '调整后月薪', '调薪后月薪', '现工资', '现月薪'],
    adjustmentDate: ['调薪生效时间', '调薪生效日期', '生效时间', '生效日期'],
    regularizationDate: ['转正日期', '转正日', '转正时间'],
    probationSalary: ['转正前工资', '试用期工资', '转正前月薪'],
    regularSalary: ['转正后工资', '正式工资', '转正后月薪'],
    overtimeBalance: ['调休假系统余额', '调休余额', '加班调休余额'],
    overtimeFee: ['加班费', '加班工资', '加班费合计'],
    internSubsidy: ['实习生劳务', '实习生补助', '实习补贴', '劳务补助', '补助合计', '餐费补助'],
    totalCost: ['公司总成本', '发薪成本', '工资成本', '总发薪成本'],
    averageCost: ['平均人员成本', '人均成本']
  };
  const key = value => String(value ?? '').trim().replace(/\s+/g, '').replace(/[（）]/g, match => match === '（' ? '(' : ')');
  const text = value => String(value ?? '').trim();
  const blank = value => value === null || value === undefined || text(value) === '';
  const number = value => {
    if (blank(value)) return null;
    const raw = text(value).replace(/[￥¥,，\s]/g, '');
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return null;
    const result = Number(raw);
    return Number.isFinite(result) ? result : null;
  };
  const money = value => Number(value || 0).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const amount = value => { const result = number(value); return result === null ? 0 : result; };
  const date = value => {
    if (blank(value)) return '';
    if (typeof value === 'number') return PayrollEngine?.dateValue ? PayrollEngine.dateValue(value) : text(value);
    const result = text(value).match(/(20\d{2})[\-/年](\d{1,2})[\-/月](\d{1,2})/);
    return result ? `${result[1]}-${String(result[2]).padStart(2, '0')}-${String(result[3]).padStart(2, '0')}` : text(value);
  };
  const monthLabel = month => {
    const match = text(month).match(/^(\d{4})-(\d{1,2})$/);
    return match ? `${match[1]}年${Number(match[2])}月` : text(month);
  };
  const rowKey = row => text(row?.['姓名'] ?? row?.name);
  // Keep original headers as well as payroll aliases: final tables may carry
  // business-specific columns such as “实习生劳务” that the payroll engine
  // intentionally normalizes to the internship marker.
  const canonical = row => PayrollEngine?.canonicalRow ? {...(row || {}), ...PayrollEngine.canonicalRow(row || {})} : {...(row || {})};
  const rowsOf = rows => (Array.isArray(rows) ? rows : []).map(canonical).filter(row => rowKey(row));
  function findKey(row, names) {
    const wanted = (names || []).map(key);
    return Object.keys(row || {}).find(header => wanted.includes(key(header)));
  }
  function read(row, names) {
    const found = findKey(row, names);
    return found === undefined ? null : row[found];
  }
  function formatDays(value) {
    const result = number(value);
    return result === null ? text(value) : result.toLocaleString('zh-CN', {maximumFractionDigits: 2});
  }
  function uniqueNames(rows) { return [...new Set(rows.map(rowKey).filter(Boolean))]; }

  function buildSections(rows) {
    const sections = Object.fromEntries(SECTION_ORDER.map(([key]) => [key, []]));
    rows.forEach(row => {
      const name = rowKey(row);
      const before = read(row, aliases.beforeSalary), after = read(row, aliases.afterSalary);
      if (number(before) !== null && number(after) !== null && amount(before) !== amount(after)) {
        const effective = date(read(row, aliases.adjustmentDate));
        sections.salaryAdjustments.push(`${name}${effective ? `，生效时间${effective.slice(5).replace('-', '月')}日` : ''}，调整前${money(before)}元/月，调整后${money(after)}元/月`);
      }
      const regularDate = date(read(row, aliases.regularizationDate));
      const regularSalary = read(row, aliases.regularSalary), probationSalary = read(row, aliases.probationSalary);
      if (regularDate && (number(regularSalary) !== null || number(probationSalary) !== null || text(row['是否入离职']).includes('转正'))) {
        const detail = number(probationSalary) !== null && number(regularSalary) !== null
          ? `，转正前${money(probationSalary)}元/月，转正后${money(regularSalary)}元/月`
          : number(regularSalary) !== null ? `，转正后${money(regularSalary)}元/月` : '';
        sections.regularizations.push(`${name}${detail}`);
      }
      const status = text(row['是否入离职'] ?? row['状态']);
      if (status.includes('离职') || date(read(row, ['离职日期']))) sections.departures.push(`${name}${text(row['备注']) ? `（${text(row['备注'])}）` : ''}`);
      if (status.includes('入职') || date(read(row, ['入职日期']))) {
        const location = text(read(row, aliases.location));
        const noPerformance = ['无绩效', '不计绩效', '绩效为0'].some(flag => Object.values(row).some(value => text(value).includes(flag)));
        sections.newHires.push(`${location ? `${location}：` : ''}${name}${noPerformance ? '（无绩效）' : ''}`);
      }
      const leaveTypes = [['事假', ['事假天数', '事假(天)', '事假（天）']], ['病假', ['病假天数', '病假(天)', '病假（天）']], ['旷工', ['旷工天数', '旷工(天)', '旷工（天）']]];
      const leaveDays = leaveTypes.filter(([, fields]) => amount(read(row, fields)) > 0).map(([label, fields]) => `${label}${formatDays(read(row, fields))}天`).join('、');
      const deductDays = read(row, ['假勤扣薪天数']), deductAmount = read(row, ['假勤扣款']);
      if (leaveDays || amount(deductDays) > 0 || amount(deductAmount) > 0) sections.attendanceDeduct.push(`${name}\t${formatDays(deductDays)}\t${money(deductAmount)}\t${leaveDays || '假勤'}`);
      [['年假', ['年假天数', '年假(天)', '年假（天）']], ['调休假', ['调休假天数', '调休假(天)', '调休假（天）']], ['弹性假', ['弹性假天数', '弹性假(天)', '弹性假（天）']]].forEach(([label, fields]) => {
        const days = read(row, fields);
        if (amount(days) > 0) sections.attendanceNoDeduct.push(`${name}\t${label}\t${formatDays(days)}`);
      });
      const overtimeBalance = read(row, aliases.overtimeBalance), overtimeFee = read(row, aliases.overtimeFee);
      if (number(overtimeBalance) !== null || number(overtimeFee) !== null) sections.overtime.push(`${name}\t${formatDays(overtimeBalance)}\t${money(overtimeFee)}`);
      const subsidy = read(row, aliases.internSubsidy);
      if (number(subsidy) !== null) sections.internSubsidies.push(`${name}\t${money(subsidy)}元`);
    });
    return sections;
  }

  function buildSummary(rows, context={}) {
    const companyCostValues = rows.map(row => read(row, aliases.totalCost)).map(number).filter(value => value !== null);
    const grossValues = rows.map(row => number(read(row, ['实发工资', '应发工资', '工资小计']))).filter(value => value !== null);
    const total = number(context.totalCost) ?? (companyCostValues.length ? companyCostValues.reduce((sum, value) => sum + value, 0) : grossValues.reduce((sum, value) => sum + value, 0));
    const avg = number(context.averageCost) ?? (total !== null && rows.length ? total / rows.length : null);
    const byDept = new Map();
    rows.forEach(row => {
      const dept = text(read(row, ['一级部门', '部门', '部门名称'])) || '未分配';
      const value = number(read(row, aliases.totalCost)) ?? number(read(row, ['实发工资', '应发工资'])) ?? 0;
      const item = byDept.get(dept) || {count: 0, total: 0}; item.count += 1; item.total += value; byDept.set(dept, item);
    });
    const departments = [...byDept].map(([dept, item]) => ({dept, count: item.count, total: item.total, average: item.count ? item.total / item.count : 0}));
    return {total, average: avg, count: rows.length, departments};
  }

  function defaultDraft(context={}) {
    const month = context.month || '';
    const company = context.company || '溯驭技术';
    return {
      recipient: context.recipient || DEFAULT_RECIPIENT,
      recipientName: context.recipientName || DEFAULT_RECIPIENT_NAME,
      subject: context.subject || `【工资表】${monthLabel(month)}${company}工资表`,
      mailboxUrl: context.mailboxUrl || MAILBOX_URL,
      sections: Object.fromEntries(SECTION_ORDER.map(([key]) => [key, ''])),
      summary: {total: null, average: null, count: 0, departments: []},
      manualSummary: '',
      acknowledgedWarnings: false,
      validation: {status: 'pending', errors: [], warnings: []}
    };
  }

  function extract(rows, context={}) {
    const normalized = rowsOf(rows), draft = defaultDraft(context), sections = buildSections(normalized);
    draft.sections = Object.fromEntries(SECTION_ORDER.map(([key]) => [key, sections[key].join('\n')]));
    draft.summary = buildSummary(normalized, context);
    draft.source = {rows: normalized.length, names: uniqueNames(normalized)};
    draft.validation = validate(draft);
    return draft;
  }

  function render(draft, context={}) {
    const lines = [];
    const recipientName = text(draft.recipientName || context.recipientName || DEFAULT_RECIPIENT_NAME) || DEFAULT_RECIPIENT_NAME;
    lines.push(`${recipientName}：`, '', `附件为${monthLabel(context.month)}${context.company || '溯驭技术'}工资表，其中工资检查事宜即本月特殊事宜说明如下：`, '');
    SECTION_ORDER.forEach(([key, label]) => {
      const value = text(draft.sections?.[key]);
      if (!value) return;
      if (key === 'attendanceDeduct') lines.push('本月假勤情况：', '扣薪假勤', '姓名\t假勤扣薪天数\t假勤扣款\t假期类型', value, '');
      else if (key === 'attendanceNoDeduct') {
        if (!text(draft.sections?.attendanceDeduct)) lines.push('本月假勤情况：');
        lines.push('无扣薪假勤');
        const rows = value.split('\n').map(line => line.split('\t'));
        ['年假', '调休假', '弹性假'].forEach(type => {
          const group = rows.filter(row => row.length === 3 && row[1] === type);
          if (group.length) lines.push(`姓名\t${type}`, ...group.map(row => `${row[0]}\t${row[2]}`));
        });
        lines.push(...rows.filter(row => row.length !== 3 || !['年假', '调休假', '弹性假'].includes(row[1])).map(row => row.join('\t')), '');
      } else if (key === 'overtime') lines.push(`${label}：`, '姓名\t调休假系统余额\t加班费', value, '');
      else lines.push(label, value, '');
    });
    const summary = draft.summary || {};
    if (draft.manualSummary) lines.push(text(draft.manualSummary), '');
    if (summary.total !== null && summary.total !== undefined) lines.push(`本月合计发薪成本${money(summary.total)}元，平均人员成本${money(summary.average || 0)}元。`);
    else lines.push('本月合计发薪成本待核对，平均人员成本待核对。');
    (summary.departments || []).forEach(item => lines.push(`${item.dept}人员总成本${money(item.total)}元，平均${money(item.average)}元`));
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Convert tabular lines into shared columns; headers and values use identical alignment.
  function renderHtml(body) {
    const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
    const lines = String(body).split('\n'), parts = [];
    for (let i = 0; i < lines.length;) {
      if (!lines[i].includes('\t')) { parts.push(`<div>${escape(lines[i]) || '<br>'}</div>`); i++; continue; }
      const rows = [];
      while (i < lines.length && lines[i].includes('\t')) rows.push(lines[i++].split('\t'));
      const columns = Math.max(...rows.map(row => row.length));
      parts.push('<table style="border-collapse:collapse;table-layout:fixed;width:100%;max-width:640px;margin:6px 0 14px"><tbody>' + rows.map(row => {
        const header = row[0].trim() === '姓名';
        return '<tr>' + Array.from({length:columns}, (_, j) => `<${header?'th':'td'} style="text-align:left;vertical-align:top;padding:5px 12px 5px 0;width:${100/columns}%;font-weight:${header?'600':'400'}">${escape(row[j] || '')}</${header?'th':'td'}>`).join('') + '</tr>';
      }).join('') + '</tbody></table>');
    }
    return `<div style="font-family:Arial,\'Microsoft YaHei\',sans-serif;font-size:14px;line-height:1.7">${parts.join('')}</div>`;
  }

  function validate(draft) {
    const errors = [], warnings = [];
    if (!/^\S+@\S+\.\S+$/.test(text(draft.recipient))) errors.push('收件人邮箱格式无效');
    if (!text(draft.subject)) errors.push('邮件主题不能为空');
    const summary = draft.summary || {};
    if (summary.total === null || summary.total === undefined || !Number.isFinite(Number(summary.total))) errors.push('无法从二阶段工资表确认合计发薪成本');
    if (summary.average === null || summary.average === undefined || !Number.isFinite(Number(summary.average))) errors.push('无法确认平均人员成本');
    if (!summary.departments?.length) warnings.push('未识别到部门成本明细');
    if (!SECTION_ORDER.some(([key]) => text(draft.sections?.[key]))) warnings.push('未识别到本月特殊事项，请确认是否需要手动补录');
    return {status: errors.length ? 'blocked' : warnings.length && !draft.acknowledgedWarnings ? 'warning' : 'passed', errors, warnings};
  }

  return {DEFAULT_RECIPIENT, DEFAULT_RECIPIENT_NAME, MAILBOX_URL, SECTION_ORDER, defaultDraft, extract, render, renderHtml, validate, money, number, monthLabel};
})();
