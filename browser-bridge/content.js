(() => {
  const DRAFT_KEY = 'salaryEmailDraft';
  const isMailbox = location.hostname === 'exmail.qq.com' || location.hostname.endsWith('.exmail.qq.com');
  if (!isMailbox) return;

  const visible = element => Boolean(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const setNativeValue = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', {bubbles: true}));
    element.dispatchEvent(new Event('change', {bubbles: true}));
  };

  function readHashDraft() {
    const match = location.hash.match(/salary-email=([^&]+)/);
    if (!match) return;
    try {
      const json = decodeURIComponent(escape(atob(decodeURIComponent(match[1]))));
      const payload = JSON.parse(json);
      if (payload?.recipient && payload?.subject && payload?.body) {
        chrome.runtime.sendMessage({type: 'salary-email-handoff', payload});
        history.replaceState(null, '', `${location.pathname}${location.search}`);
      }
    } catch (error) {
      console.warn('[薪资邮件填充助手] 无法读取交接数据', error);
    }
  }

  function findWriteTrigger() {
    return [...document.querySelectorAll('a,button,[role="button"]')].find(element => {
      const text = (element.innerText || element.textContent || '').replace(/\s/g, '');
      return visible(element) && /^写信(?:件)?$/.test(text);
    });
  }

  function isComposePage() {
    return /readtemplate/.test(location.href) && (/[?&]t=compose/.test(location.href) || /[?&]s=cnew/.test(location.href))
      || Boolean(document.querySelector('#subject,#toAreaCtrl,#QMEditorIfrmEditArea'));
  }

  async function getDraft() {
    const result = await chrome.storage.local.get(DRAFT_KEY);
    const draft = result[DRAFT_KEY];
    if (!draft || !draft.receivedAt || Date.now() - draft.receivedAt > 30 * 60 * 1000) {
      if (draft) chrome.storage.local.remove(DRAFT_KEY);
      return null;
    }
    return draft;
  }

  function fillRecipient(draft) {
    const area = document.querySelector('#toAreaCtrl');
    if (area && area.textContent.includes(draft.recipient)) return true;
    const input = [...document.querySelectorAll('input[aria-label*="收件人"],input[placeholder*="收件人"],textarea#to')].find(visible);
    if (!input) return false;
    input.focus();
    setNativeValue(input, draft.recipient);
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', bubbles: true}));
    input.dispatchEvent(new KeyboardEvent('keyup', {key: 'Enter', code: 'Enter', bubbles: true}));
    return true;
  }

  function fillSubject(draft) {
    const input = document.querySelector('#subject');
    if (!input) return false;
    if (input.value !== draft.subject) setNativeValue(input, draft.subject);
    input.dataset.salaryEmailFilled = '1';
    return true;
  }

  function fillBody(draft) {
    const editor = document.querySelector('[contenteditable="true"]') || (document.body?.isContentEditable ? document.body : null);
    if (!editor || editor.dataset.salaryEmailFilled === '1') return Boolean(editor);
    editor.focus();
    editor.innerHTML = draft.body.split(/\r?\n/).map(line => line ? `<div>${escapeHtml(line)}</div>` : '<div><br></div>').join('');
    editor.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: draft.body}));
    editor.dispatchEvent(new Event('change', {bubbles: true}));
    editor.dataset.salaryEmailFilled = '1';
    return true;
  }

  function showNotice() {
    if (window.top !== window || document.getElementById('salary-email-bridge-notice')) return;
    const notice = document.createElement('div');
    notice.id = 'salary-email-bridge-notice';
    notice.textContent = '薪资邮件已填入，请核对收件人、正文和附件；发送仍需手动点击。';
    Object.assign(notice.style, {
      position: 'fixed', zIndex: '2147483647', top: '16px', right: '16px',
      padding: '10px 14px', borderRadius: '8px', background: '#1677ff', color: '#fff',
      font: '14px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif', boxShadow: '0 4px 16px #0003'
    });
    document.body.appendChild(notice);
    setTimeout(() => notice.remove(), 8000);
  }

  async function run() {
    readHashDraft();
    const draft = await getDraft();
    if (!draft) return;
    if (!isComposePage()) {
      const write = findWriteTrigger();
      if (write && !write.dataset.salaryEmailClicked) {
        write.dataset.salaryEmailClicked = '1';
        write.click();
      }
      return;
    }
    const recipientDone = fillRecipient(draft);
    const subjectDone = fillSubject(draft);
    const bodyDone = fillBody(draft);
    if ((recipientDone || subjectDone || bodyDone) && window.top === window) setTimeout(showNotice, 600);
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    run().catch(error => console.warn('[薪资邮件填充助手]', error));
    if (attempts >= 40) clearInterval(timer);
  }, 500);
  run().catch(error => console.warn('[薪资邮件填充助手]', error));
})();
