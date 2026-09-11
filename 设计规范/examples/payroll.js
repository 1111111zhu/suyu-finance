import { initUI, toast, icon, createStepper, setProgress, openDialog } from '../components/ui.js';
import { setupDateFields } from '../components/date-fields.js';
initUI();
const content = document.getElementById('payroll-content');
const next = document.getElementById('context-next');
const now = new Date();
const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
let period = { year: previous.getFullYear(), month: previous.getMonth() + 1, days: '', applied: false };
const materialNames = [['花名册', '员工基本工资表', '绩效考核表', '考勤统计表', '其他表'], ['个税表', '社保公积金表', '税后代扣表']];
let materials = materialNames.map(names => names.map(name => ({ name, file: '', validated: false })));
const employees = [{ name: '林晓', dept: '研发部', id: 'SY001', gross: 11500, net: 10000 }, { name: '陈晨', dept: '财务部', id: 'SY002', gross: 9900, net: 8400 }, { name: '许宁', dept: '研发部', id: 'SY003', gross: 14000, net: 12500 }];
let reviewed = [new Set(), new Set()];
let selectedEmployee = 0;
let selectedReviewPhase = 0;
let currentState;
let retainContent = false;
const money = value => value.toLocaleString('en-US', { minimumFractionDigits: 2 });
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const valid = index => index === 0 ? period.applied && materials[0].every(m => m.validated) : index === 1 ? reviewed[0].size === employees.length : index === 2 ? materials[1].every(m => m.validated) : reviewed[1].size === employees.length;
const phase = () => currentState.current < 2 ? 0 : 1;
function renderContext() {
  const p = phase();
  document.getElementById('phase-label').textContent = p ? '第二阶段' : '第一阶段';
  document.getElementById('context-title').textContent = p ? '实发核算' : '应发核算';
  document.getElementById('context-period').textContent = `${period.year}年${period.month}月`;
  document.getElementById('context-people').textContent = materials[0].every(m => m.validated) ? '3 人' : '—';
  document.getElementById('context-material-label').textContent = p ? '扣款资料' : '工资资料';
  document.getElementById('context-materials').textContent = `${materials[p].filter(m => m.validated).length} / ${materials[p].length}`;
  document.getElementById('context-days').textContent = period.applied ? `${period.days} 天` : '待填写';
  document.getElementById('context-percent').textContent = `${currentState.percent}%`;
  setProgress(document.getElementById('context-progress'), currentState.percent);
  const texts = ['计算并核对应发', '继续补充扣款', '计算并核对实发', '完成本次核对'];
  next.innerHTML = `${texts[currentState.current]} ${icon('arrow')}`;
  next.disabled = !valid(currentState.current) || currentState.completed[currentState.current];
  document.getElementById('context-note').textContent = currentState.completed.every(Boolean) ? '四个步骤均已完成，可返回任一步查看' : currentState.current % 2 ? `已核对 ${reviewed[p].size} / 3 人` : currentState.current === 0 && !period.applied ? '填写天数，并准备好工资资料' : '在本地示例中验证资料后继续';
  document.getElementById('load-demo').hidden = currentState.current % 2 === 1;
}
function fileRows(p) {
  return `<section class="payroll-materials"><div class="payroll-materials-heading"><span>${p ? '扣款资料' : '工资资料'}</span><span>${materials[p].filter(m => m.validated).length} / ${materials[p].length}</span></div><ul class="ui-list">${materials[p].map((m, i) => `<li>${icon('file')}<span class="ui-list-main"><span>${m.name}</span>${m.file ? `<span class="payroll-filename">${escape(m.file)}</span>` : ''}</span><span class="ui-pill${m.validated ? ' ui-pill--success' : ''}">${m.validated ? '示例就绪' : m.file ? '待解析' : '未上传'}</span><button class="ui-text-action" data-upload="${i}" aria-label="${m.file ? '替换' : '上传'}${m.name}">${m.file ? '替换' : '上传'} ${icon('arrowUp')}</button></li>`).join('')}</ul></section>`;
}
function renderUpload() {
  const p = phase();
  content.innerHTML = `${p ? '' : `<div class="payroll-params"><form class="ui-inline-form" id="payroll-params"><span class="payroll-params-title">${icon('calendar')}计薪参数</span><label class="ui-inline-field"><span class="ui-sr-only">计薪年份</span><select name="year" aria-label="计薪年份"></select></label><label class="ui-inline-field"><span class="ui-sr-only">计薪月份</span><select name="month" aria-label="计薪月份"></select></label><label class="ui-inline-field"><span class="ui-sr-only">计薪天数</span><input name="days" type="number" min="1" max="31" step="0.5" placeholder="请输入" required value="${period.days}"><span class="ui-muted">天</span></label><button class="ui-text-action">应用</button></form></div>`}<section class="payroll-upload" id="upload-area">${icon('cloud')}<div><h1>${p ? '补充扣款，核算实发' : '拖入 Excel，自动识别资料'}</h1><p>也可以点击选择文件</p><button class="ui-button ui-button--pill" id="choose-files">${icon('upload')}选择文件</button></div></section>${fileRows(p)}<input type="file" id="files" accept=".xlsx" multiple hidden>`;
  if (!p) {
    const params = document.getElementById('payroll-params');
    setupDateFields(params); params.elements.year.value = period.year; params.elements.month.value = period.month;
    params.addEventListener('input', () => {
      period = { year: Number(params.elements.year.value), month: Number(params.elements.month.value), days: params.elements.days.value, applied: false };
      reviewed = [new Set(), new Set()];
      retainContent = true; flow.invalidate(0); retainContent = false;
      document.getElementById('context-days').textContent = '待应用';
    });
    params.addEventListener('submit', e => {
      e.preventDefault(); if (!params.reportValidity()) return;
      const changed = period.year !== Number(params.elements.year.value) || period.month !== Number(params.elements.month.value) || period.days !== params.elements.days.value;
      period = { year: Number(params.elements.year.value), month: Number(params.elements.month.value), days: params.elements.days.value, applied: true };
      if (changed && flow.state.completed.some(Boolean)) { reviewed = [new Set(), new Set()]; flow.invalidate(0); } else renderContext();
      toast('计薪参数已应用');
    });
  }
  let targetIndex = null;
  const fileInput = document.getElementById('files');
  document.getElementById('choose-files').addEventListener('click', () => { targetIndex = null; fileInput.click(); });
  content.querySelectorAll('[data-upload]').forEach(b => b.addEventListener('click', () => { targetIndex = Number(b.dataset.upload); fileInput.click(); }));
  const receiveFiles = files => {
    const accepted = [...files].filter(f => /\.xlsx$/i.test(f.name) && f.size > 0 && f.size <= 20 * 1024 * 1024);
    if (!accepted.length) { toast('请选择非空的 .xlsx 文件，单个不超过 20 MB。'); return; }
    accepted.slice(0, targetIndex === null ? materials[p].length : 1).forEach((file, i) => {
      const index = targetIndex === null ? i : targetIndex;
      materials[p][index].file = file.name; materials[p][index].validated = false;
    });
    reviewed[p].clear(); if (!p) reviewed[1].clear();
    flow.invalidate(p * 2);
    toast('文件已选择。此示例不解析 Excel；可载入示例资料体验后续流程。', { duration: 6500 });
  };
  fileInput.addEventListener('change', () => receiveFiles(fileInput.files));
  const drop = document.getElementById('upload-area');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.dataset.drag = 'true'; });
  drop.addEventListener('dragleave', () => drop.dataset.drag = 'false');
  drop.addEventListener('drop', e => { e.preventDefault(); targetIndex = null; drop.dataset.drag = 'false'; receiveFiles(e.dataTransfer.files); });
}
function renderReview() {
  const p = phase();
  content.innerHTML = `<div class="payroll-review-head"><div><h1>核对${p ? '实发' : '应发'}工资</h1><p>逐位查看明细，确认后继续。</p></div><span class="ui-caption">示例数据</span></div><div class="payroll-review-total ui-number">¥ ${money(employees.reduce((sum, e) => sum + (p ? e.net : e.gross), 0))}</div><div class="ui-table-wrap"><table class="ui-table"><thead><tr><th>员工</th><th class="ui-numeric">${p ? '实发' : '应发'}金额</th><th>状态</th><th></th></tr></thead><tbody>${employees.map((e, i) => `<tr><td>${e.name}<br><small class="ui-muted">${e.dept} · ${e.id}</small></td><td class="ui-numeric">${money(p ? e.net : e.gross)}</td><td><span class="ui-pill${reviewed[p].has(i) ? ' ui-pill--success' : ''}">${reviewed[p].has(i) ? '已核对' : '待核对'}</span></td><td><button class="ui-text-action" data-review="${i}" aria-label="查看${e.name}工资明细">查看明细 ${icon('arrowUp')}</button></td></tr>`).join('')}</tbody></table></div>${currentState.completed.every(Boolean) ? `<div class="payroll-complete">${icon('circleCheck')}<h1>本次核对已完成。</h1><p class="ui-muted">所有示例记录均已确认。</p></div>` : ''}`;
  content.querySelectorAll('[data-review]').forEach(b => b.addEventListener('click', () => {
    selectedEmployee = Number(b.dataset.review); selectedReviewPhase = p;
    const employee = employees[selectedEmployee];
    document.getElementById('review-title').textContent = employee.name;
    document.getElementById('review-meta').textContent = `${employee.dept} · ${employee.id} · 示例数据`;
    document.getElementById('review-values').innerHTML = `<div><dt>应发工资</dt><dd>${money(employee.gross)}</dd></div>${p ? `<div><dt>扣款合计</dt><dd>${money(employee.gross - employee.net)}</dd></div><div><dt>实发工资</dt><dd>${money(employee.net)}</dd></div>` : ''}`;
    document.getElementById('review-confirm').disabled = reviewed[p].has(selectedEmployee);
    openDialog('review-drawer', b);
  }));
}
function render(state) {
  currentState = state;
  if (!retainContent) { if (state.current % 2) renderReview(); else renderUpload(); }
  renderContext();
}
const flow = createStepper(document.getElementById('payroll-flow'), { labels: ['准备资料', '核对应发', '补充扣款', '核对实发'], validate: valid, onChange: render });
next.addEventListener('click', () => { if (flow.complete()) toast('步骤已完成'); });
document.getElementById('review-confirm').addEventListener('click', () => {
  reviewed[selectedReviewPhase].add(selectedEmployee);
  document.getElementById('review-drawer').close(); renderReview(); renderContext();
  content.querySelector(`[data-review="${selectedEmployee}"]`)?.focus();
});
document.getElementById('load-demo').addEventListener('click', () => {
  const p = phase();
  materials[p].forEach(m => { m.file = `${m.name}.xlsx · 示例`; m.validated = true; });
  renderUpload(); renderContext(); toast('示例资料已就绪');
});
document.getElementById('reset-demo').addEventListener('click', () => {
  materials = materialNames.map(names => names.map(name => ({ name, file: '', validated: false })));
  reviewed = [new Set(), new Set()]; period = { year: previous.getFullYear(), month: previous.getMonth() + 1, days: '', applied: false };
  flow.reset(); toast('示例已重置');
});
document.querySelectorAll('.payroll-nav button').forEach(button => button.addEventListener('click', () => {
  const section = button.dataset.section;
  document.querySelector('.payroll-shell').dataset.section = section;
  document.querySelectorAll('.payroll-nav button').forEach(b => { if (b === button) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  document.querySelector('.payroll-steps').hidden = section !== 'salary';
  document.querySelector('.payroll-footer').hidden = section !== 'salary';
  if (section === 'salary') { render(flow.state); return; }
  const pages = {
    history: `<h1>历史批次</h1><p>已完成的工资核对，会安静地留在这里。</p><div class="payroll-subpage-content ui-empty">${icon('clock')}<h3>还没有历史批次</h3><p>此处仅展示空状态样式。</p></div>`,
    email: `<h1>邮件发送</h1><p>选择已确认的工资记录，再预览发送内容。</p><div class="payroll-subpage-content ui-empty">${icon('mail')}<h3>暂无待发送工资条</h3><p>本地示例不连接邮箱，不发送邮件。</p></div>`,
    settings: `<h1>核算设置</h1><p>常用选项靠近内容，细节按需展开。</p><div class="payroll-subpage-content"><details class="ui-disclosure"><summary>字段映射 ${icon('chevron')}</summary><div><dl class="ui-keyvalue"><div><dt>姓名</dt><dd>员工姓名</dd></div><div><dt>编号</dt><dd>工号</dd></div></dl></div></details><details class="ui-disclosure"><summary>工资表输出格式 ${icon('chevron')}</summary><div>Excel 工作簿（.xlsx）</div></details></div>`
  };
  content.innerHTML = `<section class="payroll-subpage">${pages[section]}</section>`;
}));
