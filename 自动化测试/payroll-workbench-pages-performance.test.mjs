import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/salary/workbench-pages.js', import.meta.url), 'utf8');
function fragment(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'workbench function boundaries remain available');
  return source.slice(from, to);
}

test('roster validation reuses current rows and invalidates on source replacement, length or month', () => {
  let identityCalls = 0, monthCalls = 0;
  const context = vm.createContext({
    sourceRows: { roster: [{ invalid: true, month: '2026-09' }, { invalid: false, month: '2026-09' }] },
    currentMonth: '2026-09',
    PayrollEngine: {
      rosterRowInMonth: (row, month) => { monthCalls++; return row.month === month; },
      rosterIdentityIssues: row => { identityCalls++; return row.invalid ? ['缺姓名'] : []; }
    }
  });
  vm.runInContext(fragment('  let rosterIdentityCache=', '  function upload(){') + '\nglobalThis.check = rosterIdentityRejections;', context);
  const initial = context.check();
  assert.equal(initial.length, 1);
  for (let i = 0; i < 20; i++) assert.equal(context.check(), initial);
  assert.equal(identityCalls, 2);
  assert.equal(monthCalls, 2);
  context.currentMonth = '2026-10';
  assert.equal(context.check().length, 0);
  assert.equal(monthCalls, 4);
  // Imports replace arrays even when the number of rows is unchanged.
  context.sourceRows.roster = [{ invalid: false, month: '2026-10' }, { invalid: true, month: '2026-10' }];
  assert.equal(context.check().length, 1);
  assert.equal(identityCalls, 4);
  context.sourceRows.roster.push({ invalid: true, month: '2026-10' });
  assert.equal(context.check().length, 2);
  assert.equal(identityCalls, 7);
  delete context.sourceRows.roster;
  assert.equal(context.check().length, 0);
});

function element(dataset = {}) {
  return { dataset, value: '', textContent: '', innerHTML: '', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
}
function emailHarness() {
  let ensured = 0, validated = 0;
  const saves = [];
  const draft = { summary: { total: 100 }, sections: {}, validation: { errors: [], warnings: [] }, bodyOverride: 'manual body' };
  const nodes = new Map(['emailPreview', 'wbMailCost', 'wbMailValidationSummary', 'wbMailValidationIssues', 'wbMailSaveState', 'wbBodyMode'].map(id => [id, element()]));
  nodes.get('emailPreview').value = 'manual body';
  const field = element({ emailField: 'subject' });
  const section = element({ emailSection: 'staff' });
  const summary = element({ emailSummary: 'total' });
  const body = nodes.get('emailPreview'), manual = element(), apply = element();
  const singles = new Map([['[data-email-body]', body], ['[data-email-manual-summary]', manual], ['[data-email-apply]', apply]]);
  const context = vm.createContext({
    ensureEmailDraft: () => { ensured++; return draft; }, state: { emailDraft: draft, view: 'email' },
    document: { activeElement: body, getElementById: id => nodes.get(id), querySelector: () => apply },
    content: {
      querySelectorAll: q => ({ '[data-email-field]': [field], '[data-email-section]': [section], '[data-email-summary]': [summary] })[q] || [],
      querySelector: q => singles.get(q) || null
    },
    emailBody: d => d.bodyOverride || `total ${d.summary.total}`, fmt: String, esc: String,
    PayrollEmailEngine: { validate: () => { validated++; return { errors: [], warnings: [] }; }, number: Number },
    saveBatchData: options => saves.push(options), copyEmailBody() {}, openEmailComposer() {}
  });
  vm.runInContext(fragment('  function bindEmail(){', '  function bind(){') + '\nbindEmail();', context);
  return { context, draft, field, section, summary, body, manual, saves, counts: () => ({ ensured, validated }) };
}

test('email edits retain latest inputs and manual body without rebuilding payroll fingerprints', () => {
  const h = emailHarness();
  for (const value of ['a', 'ab', 'abc']) { h.field.value = value; h.field.listeners.input(); }
  h.section.value = 'latest staffing'; h.section.listeners.input();
  h.summary.value = '200'; h.summary.listeners.input();
  assert.equal(h.draft.subject, 'abc');
  assert.equal(h.draft.sections.staff, 'latest staffing');
  assert.equal(h.draft.summary.total, 200);
  assert.equal(h.draft.bodyOverride, 'manual body');
  h.body.value = 'latest body'; h.body.listeners.input({ target: h.body });
  h.manual.value = 'latest note'; h.manual.listeners.input({ target: h.manual });
  assert.equal(h.draft.bodyOverride, 'latest body');
  assert.equal(h.body.value, 'latest body');
  assert.equal(h.draft.manualSummary, 'latest note');
  assert.deepEqual(h.counts(), { ensured: 1, validated: 7 });
  assert.equal(h.saves.length, 7);
  assert.ok(h.saves.every(options => options?.editorOnly === true));
});

test('email metadata updates generated preview only when body is not focused', () => {
  const h = emailHarness();
  h.draft.bodyOverride = '';
  h.context.document.activeElement = h.summary;
  h.summary.value = '350'; h.summary.listeners.input();
  assert.equal(h.body.value, 'total 350');
  assert.deepEqual(h.counts(), { ensured: 1, validated: 1 });
});
