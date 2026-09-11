import { icon, renderIcons } from './icons.js';
export { icon, renderIcons };

export function toast(message, { duration = 4200 } = {}) {
  let region = document.querySelector('.ui-toast-region');
  if (!region) {
    region = document.createElement('div');
    region.className = 'ui-toast-region';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-label', '操作反馈');
    document.body.append(region);
  }
  const item = document.createElement('div');
  item.className = 'ui-toast';
  item.innerHTML = `${icon('circleCheck')}<span></span><button class="ui-button ui-button--ghost ui-button--icon ui-button--sm" aria-label="关闭提示">${icon('close')}</button>`;
  item.querySelector('span').textContent = message;
  item.querySelector('button').addEventListener('click', () => item.remove());
  region.append(item);
  const timer = setTimeout(() => item.remove(), duration);
  item.addEventListener('mouseenter', () => clearTimeout(timer), { once: true });
  return item;
}

export async function copyText(text, button) {
  try { await navigator.clipboard.writeText(text); toast('已复制'); }
  catch { toast('当前环境无法访问剪贴板，请选中文本复制。'); }
  if (button) button.focus();
}

export function setTheme(theme) {
  document.documentElement.classList.add('ui-theme-changing');
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('calm-ui-theme', theme); } catch {}
  document.querySelectorAll('[data-theme-toggle]').forEach(b => {
    b.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
    b.setAttribute('aria-label', theme === 'dark' ? '切换浅色主题' : '切换深色主题');
  });
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('ui-theme-changing')));
}

export function openDialog(dialog, trigger = document.activeElement) {
  if (typeof dialog === 'string') dialog = document.getElementById(dialog);
  if (!dialog || dialog.open) return;
  dialog._trigger = trigger?.closest('[data-menu]')?.querySelector('[aria-haspopup="menu"]') || trigger;
  dialog.showModal();
}

export function initUI(root = document) {
  renderIcons(root);
  let theme = 'light';
  try { theme = localStorage.getItem('calm-ui-theme') || 'light'; } catch {}
  setTheme(theme);

  root.querySelectorAll('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')));
  root.querySelectorAll('[data-toast]').forEach(button => button.addEventListener('click', () => toast(button.dataset.toast)));
  root.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', () => {
    const target = document.getElementById(button.dataset.copy);
    copyText(target?.textContent || button.dataset.copy, button);
  }));
  root.querySelectorAll('[data-loading]').forEach(button => button.addEventListener('click', () => {
    const content = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = '<span class="ui-spinner" aria-hidden="true"></span>保存中';
    setTimeout(() => { button.innerHTML = content; button.disabled = false; button.removeAttribute('aria-busy'); toast('示例已保存'); }, 950);
  }));
  root.querySelectorAll('[role="switch"]').forEach(button => button.addEventListener('click', () => {
    const checked = button.getAttribute('aria-checked') !== 'true';
    button.setAttribute('aria-checked', String(checked));
    button.dispatchEvent(new CustomEvent('ui:change', { bubbles: true, detail: { checked } }));
  }));
  root.querySelectorAll('[data-segmented]').forEach(group => {
    const buttons = [...group.querySelectorAll('button')];
    const choose = b => {
      buttons.forEach(item => item.setAttribute('aria-pressed', String(item === b)));
      group.dispatchEvent(new CustomEvent('ui:change', { bubbles: true, detail: { value: b.dataset.value } }));
    };
    buttons.forEach(b => b.addEventListener('click', () => choose(b)));
    group.addEventListener('keydown', event => {
      const index = buttons.indexOf(document.activeElement);
      if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus(); choose(buttons[next]);
    });
  });
  root.querySelectorAll('[data-tabs]').forEach(group => {
    const tabs = [...group.querySelectorAll('[role="tab"]')];
    const choose = tab => tabs.forEach(t => {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !selected;
    });
    tabs.forEach(tab => tab.addEventListener('click', () => choose(tab)));
    group.addEventListener('keydown', event => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      choose(tabs[next]); tabs[next].focus();
    });
  });
  root.querySelectorAll('[data-menu]').forEach(menu => {
    const trigger = menu.querySelector('[aria-haspopup="menu"]');
    const items = menu.querySelector('[role="menu"]');
    const close = (focus = false) => { items.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (focus) trigger.focus(); };
    const open = () => { items.hidden = false; trigger.setAttribute('aria-expanded', 'true'); items.querySelector('[role="menuitem"]')?.focus(); };
    trigger.addEventListener('click', () => items.hidden ? open() : close(true));
    trigger.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); open(); } });
    items.addEventListener('click', e => { if (e.target.closest('[role="menuitem"]')) close(true); });
    menu.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); close(true); }
      if (e.key === 'Tab') close();
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) || items.hidden) return;
      e.preventDefault();
      const buttons = [...items.querySelectorAll('[role="menuitem"]')];
      const index = buttons.indexOf(document.activeElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    });
    document.addEventListener('pointerdown', e => { if (!menu.contains(e.target)) close(); });
    menu.addEventListener('focusout', e => { if (!menu.contains(e.relatedTarget)) close(); });
  });
  root.querySelectorAll('[data-open-dialog]').forEach(b => b.addEventListener('click', () => openDialog(b.dataset.openDialog, b)));
  root.querySelectorAll('dialog').forEach(dialog => {
    dialog.querySelectorAll('[data-close-dialog]').forEach(b => b.addEventListener('click', () => dialog.close()));
    dialog.addEventListener('close', () => { dialog._trigger?.focus(); });
    dialog.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')].filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length && !el.closest('[hidden], [inert]'));
      const first = focusable[0], last = focusable.at(-1);
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    dialog.addEventListener('click', e => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
    });
  });
  const command = root.querySelector('[data-command]');
  if (command) {
    const input = command.querySelector('input');
    const items = [...command.querySelectorAll('.ui-command-list li')];
    input.addEventListener('input', () => {
      items.forEach(li => li.hidden = !li.textContent.toLowerCase().includes(input.value.toLowerCase()));
      command.querySelector('[data-command-empty]').hidden = items.some(li => !li.hidden);
    });
    command.addEventListener('close', () => { input.value = ''; input.dispatchEvent(new Event('input')); });
    command.addEventListener('keydown', e => {
      if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      const visible = items.filter(li => !li.hidden).map(li => li.querySelector('button'));
      if (!visible.length) return;
      const i = visible.indexOf(document.activeElement);
      visible[(i + (e.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length].focus();
    });
    command.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
      command.close(); location.href = b.dataset.go;
    }));
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openDialog(command); }
    });
  }
}

/** Completion is explicit. Navigation never changes completed state. */
export function createStepper(element, { labels, validate = () => true, onChange = () => {} }) {
  const safeLabels = labels.map(label => String(label).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  let current = 0;
  let completed = labels.map(() => false);
  let mounted = false;
  const available = () => { const i = completed.indexOf(false); return i < 0 ? labels.length - 1 : i; };
  const snapshot = () => ({ current, completed: [...completed], available: available(), percent: completed.filter(Boolean).length / labels.length * 100 });
  const render = () => {
    element.classList.add('ui-stepper');
    if (!mounted) {
      element.innerHTML = safeLabels.map((label, index) => `<button type="button" class="ui-step" data-index="${index}"><div class="ui-step-track" aria-hidden="true"><div class="ui-step-fill"></div></div><span class="ui-step-label"><span class="ui-step-number" aria-hidden="true"></span><span>${label}</span></span></button>`).join('');
      element.querySelectorAll('button').forEach(button => button.addEventListener('click', () => api.go(Number(button.dataset.index))));
      mounted = true;
    }
    element.querySelectorAll('button').forEach((button, index) => {
      button.dataset.complete = String(completed[index]);
      button.dataset.available = String(index === available());
      button.disabled = index > available();
      if (index === current) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
      button.setAttribute('aria-label', `第 ${index + 1} 步 ${labels[index]}，${completed[index] ? '已完成' : index > available() ? '尚未解锁' : '未完成'}`);
      button.querySelector('.ui-step-number').innerHTML = completed[index] ? icon('check') : String(index + 1).padStart(2, '0');
    });
    onChange(snapshot());
  };
  const api = {
    get state() { return snapshot(); },
    go(index) { if (!Number.isInteger(index) || index < 0 || index > available()) return false; current = index; render(); element.querySelector(`[data-index="${index}"]`).focus(); return true; },
    complete() { if (completed[current] || validate(current) !== true) return false; completed[current] = true; current = Math.min(current + 1, labels.length - 1); render(); return true; },
    invalidate(index = 0) { if (!Number.isInteger(index) || index < 0 || index >= labels.length) return; completed = completed.map((v, i) => i < index && v); current = Math.min(current, index); render(); },
    reset() { current = 0; completed.fill(false); render(); },
  };
  render();
  return api;
}

export function setProgress(element, percent, label = '完成进度') {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  element.setAttribute('role', 'progressbar');
  element.setAttribute('aria-label', label);
  element.setAttribute('aria-valuemin', '0');
  element.setAttribute('aria-valuemax', '100');
  element.setAttribute('aria-valuenow', String(value));
  element.querySelector('.ui-progress-fill').style.width = `${value}%`;
}
