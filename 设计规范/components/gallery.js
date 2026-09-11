import { initUI, toast, copyText, createStepper } from './ui.js';
import { icon, iconNames } from './icons.js';
import { initWidget } from './widget.js';
import { setupDateFields } from './date-fields.js';

initUI();
initWidget(document.getElementById('widget-playground'));
document.getElementById('accent-toggle').addEventListener('ui:change', e => document.documentElement.dataset.accent = e.detail.value);

const library = document.getElementById('icon-library');
iconNames.forEach(name => {
  const button = document.createElement('button');
  button.innerHTML = icon(name); button.setAttribute('aria-label', `复制 ${name} 图标`); button.title = name;
  button.addEventListener('click', () => copyText(icon(name), button)); library.append(button);
});

const sidebar = document.getElementById('kit-sidebar');
const navToggle = document.getElementById('mobile-nav');
const compactNav = matchMedia('(max-width: 640px)');
const closeNav = () => { sidebar.dataset.open = 'false'; navToggle.setAttribute('aria-expanded', 'false'); sidebar.inert = compactNav.matches; };
closeNav();
compactNav.addEventListener('change', closeNav);
navToggle.addEventListener('click', () => {
  const open = sidebar.dataset.open !== 'true'; sidebar.dataset.open = String(open); navToggle.setAttribute('aria-expanded', String(open));
  sidebar.inert = !open && compactNav.matches;
  if (open) sidebar.querySelector('a').focus();
});
document.addEventListener('pointerdown', e => { if (!sidebar.contains(e.target) && !navToggle.contains(e.target)) closeNav(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sidebar.dataset.open === 'true') { closeNav(); navToggle.focus(); } });
const links = [...document.querySelectorAll('.kit-nav a')];
links.forEach(link => link.addEventListener('click', closeNav));
const sections = [...document.querySelectorAll('.kit-section, .kit-hero')];
let navFrame;
const updateNav = () => {
  let current = sections[0];
  for (const section of sections) if (section.getBoundingClientRect().top <= 220) current = section;
  links.forEach(link => {
    if (link.hash === `#${current.id}`) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  navFrame = null;
};
window.addEventListener('scroll', () => { if (!navFrame) navFrame = requestAnimationFrame(updateNav); }, { passive: true });
window.addEventListener('resize', updateNav, { passive: true });
updateNav();

const form = document.getElementById('sample-form');
const validateField = field => {
  const error = document.getElementById(`${field.name}-error`);
  const valid = field.checkValidity() && field.value.trim().length > 0;
  field.setAttribute('aria-invalid', String(!valid));
  error.hidden = valid;
  error.textContent = valid ? '' : field.name === 'name' ? '请输入姓名。' : '请输入完整的工作邮箱。';
  return valid;
};
form.addEventListener('submit', e => {
  e.preventDefault();
  const fields = [form.elements.name, form.elements.email];
  const results = fields.map(validateField);
  if (results.every(Boolean)) toast('校验通过。表单内容没有发送。'); else fields[results.indexOf(false)].focus();
});
form.querySelectorAll('input').forEach(field => field.addEventListener('input', () => {
  if (field.hasAttribute('aria-invalid')) validateField(field);
}));
document.getElementById('component-search').addEventListener('input', e => {
  const rows = [...document.querySelectorAll('#member-search-list li')];
  rows.forEach(row => row.hidden = !row.textContent.includes(e.target.value.trim()));
  document.getElementById('member-search-empty').hidden = rows.some(row => !row.hidden);
});

const params = document.getElementById('params-form');
setupDateFields(params);
params.addEventListener('submit', e => {
  e.preventDefault();
  if (!params.reportValidity()) return;
  document.getElementById('params-summary').textContent = `${params.elements.year.value}年${params.elements.month.value}月 · ${params.elements.days.value}天`;
  params.closest('details').open = false;
  toast('计薪参数已应用到此示例');
});

document.querySelectorAll('[data-remove-tag]').forEach(b => b.addEventListener('click', () => b.closest('.ui-tag').hidden = true));
document.getElementById('restore-tags').addEventListener('click', () => document.querySelectorAll('.ui-tag').forEach(tag => tag.hidden = false));

const labels = ['准备资料', '核对应发', '补充扣款', '核对实发'];
const descriptions = ['核验计薪参数与工资资料。', '实际计算完成，并核对全部应发明细。', '补充扣款资料并完成校验。', '实际计算完成，并核对全部实发明细。'];
const ready = labels.map(() => false);
const condition = document.getElementById('flow-condition');
const complete = document.getElementById('flow-complete');
const flow = createStepper(document.getElementById('flow-demo'), {
  labels,
  validate: index => ready[index],
  onChange(state) {
    document.getElementById('flow-task-name').textContent = labels[state.current];
    document.getElementById('flow-task-desc').textContent = descriptions[state.current];
    document.getElementById('flow-count').textContent = `${state.completed.filter(Boolean).length} / 4 已完成`;
    condition.checked = ready[state.current]; condition.disabled = state.completed[state.current];
    complete.disabled = !ready[state.current] || state.completed[state.current];
    document.getElementById('flow-status').textContent = state.completed.every(Boolean) ? '四个步骤已全部完成。可以点击任意步骤回看。' : state.completed[state.current] ? '正在回看已完成步骤，进度保持不变。' : '只有当前步骤条件满足，才会推进进度。';
  }
});
condition.addEventListener('change', () => { ready[flow.state.current] = condition.checked; complete.disabled = !condition.checked; });
complete.addEventListener('click', () => flow.complete());
document.getElementById('flow-reset').addEventListener('click', () => { ready.fill(false); flow.reset(); });
document.getElementById('play-motion').addEventListener('click', () => {
  const track = document.getElementById('motion-track'); track.dataset.play = String(track.dataset.play !== 'true');
});
document.getElementById('motion-toggle').addEventListener('ui:change', e => document.documentElement.dataset.motion = e.detail.checked ? 'on' : 'off');
