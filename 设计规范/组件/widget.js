export function initWidget(root) {
  if (!root) return;
  const win = root.querySelector('.widget-window');
  const launcher = root.querySelector('#widget-launcher');
  const show = (open, focus = false) => {
    win.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    launcher.setAttribute('aria-label', open ? '收起帮助小组件' : '打开帮助小组件');
    if (focus) (open ? win.querySelector('#widget-close') : launcher).focus();
  };
  launcher.addEventListener('click', () => show(win.hidden, true));
  root.querySelector('#widget-close').addEventListener('click', () => show(false, true));
  win.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); show(false, true); } });
  root.querySelectorAll('[data-widget-setting]').forEach(group => group.addEventListener('ui:change', e => {
    const setting = group.dataset.widgetSetting;
    if (setting === 'theme') win.dataset.theme = e.detail.value;
    else root.dataset[setting] = e.detail.value;
    show(true);
  }));
  root.querySelectorAll('[data-widget-color]').forEach(button => button.addEventListener('click', () => {
    const colors = { mint: ['#277d5c', '#58b68e'], blue: ['#087eb9', '#00a0ff'], violet: ['#6c5ab6', '#8273db'] };
    const [text, mark] = colors[button.dataset.widgetColor];
    root.style.setProperty('--widget-accent', text); root.style.setProperty('--widget-mark', mark);
    root.querySelectorAll('[data-widget-color]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  }));
  const views = ['home', 'chat', 'article'];
  const view = name => {
    const effective = name === 'articles' ? 'home' : name;
    views.forEach(v => root.querySelector(`#widget-${v}`).hidden = v !== effective);
    root.querySelectorAll('.widget-tabs button').forEach(b => {
      if (b.dataset.widgetView === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (name === 'articles') root.querySelector('#widget-search').focus();
    if (name === 'chat') root.querySelector('#widget-message').focus();
  };
  root.querySelectorAll('[data-widget-view]').forEach(b => b.addEventListener('click', () => view(b.dataset.widgetView)));
  const articles = {
    '快速开始': '从第一步准备资料开始。设置计薪年月和天数，逐项上传文件，所有条件满足后再进行核算。',
    '计薪参数设置': '年份使用电脑当前年份，月份取上个月；一月会对应上一年十二月。天数需手动填写，修改后点击应用。',
    '更新记录': '新版工作台采用连续画布与轻量控件。步骤进度现在由实际完成条件驱动。',
    '如何导入工资资料': '点击「选择文件」或将文件拖入上传区域。真实产品应在解析与校验成功后标记资料就绪；示例仅展示文件选择状态。',
    '核算步骤说明': '四个步骤依次解锁。你可以返回前面的步骤查看；查看本身不会改变完成状态。输入资料发生变化时，需要重新验证后续步骤。',
    '查看员工工资明细': '在工资列表中选择一位员工，侧栏会展示该员工的相关数据和核对操作。',
  };
  root.querySelectorAll('[data-widget-article]').forEach(b => b.addEventListener('click', () => {
    const title = b.dataset.widgetArticle;
    root.querySelector('#widget-article-title').textContent = title;
    root.querySelector('#widget-article-text').textContent = articles[title];
    view('article');
  }));
  root.querySelector('#widget-search').addEventListener('input', e => {
    const buttons = [...root.querySelectorAll('.widget-articles button')];
    buttons.forEach(b => b.hidden = !b.textContent.includes(e.target.value));
    root.querySelector('.widget-no-results').hidden = buttons.some(b => !b.hidden);
  });
  root.querySelector('#widget-chat-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = root.querySelector('#widget-message');
    if (!input.value.trim()) return;
    const p = document.createElement('p'); p.className = 'widget-message'; p.textContent = input.value.trim();
    root.querySelector('.widget-messages').append(p); input.value = ''; input.focus();
    root.querySelector('#widget-chat').scrollTop = 100000;
  });
}
