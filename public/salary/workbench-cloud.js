/* Same-origin, explicitly saved server drafts. Authentication secrets stay in memory. */
globalThis.PayrollWorkbenchCloud = (() => {
  const base = '/api/payroll';
  const copy = value => JSON.parse(JSON.stringify(value));
  const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  class CloudError extends Error {
    constructor(message, code = 'INVALID_RESPONSE', status = 0) { super(message); this.code = code; this.status = status; }
  }
  function workspace(value, full = false, W = PayrollWorkbench) {
    if(!value || !validId(value.id) || !Number.isSafeInteger(value.revision) || value.revision < 1
      || typeof value.name !== 'string' || typeof value.month !== 'string' || typeof value.updatedAt !== 'string'
      || (value.currentRevision !== undefined && (!Number.isSafeInteger(value.currentRevision) || value.currentRevision < value.revision))) {
      throw new CloudError('服务器返回的草稿信息不完整，请重新检查连接');
    }
    if(full) W.validateSnapshot(value.snapshot);
    return value;
  }
  function createClient({fetch: fetcher = (...args) => globalThis.fetch(...args), W = PayrollWorkbench,
    UI = globalThis.PayrollWorkbenchUI, crypto = globalThis.crypto, timeoutMs = 15000, onChange = () => {}} = {}) {
    let user = null, csrfToken = '', busy = false, service = 'unknown', message = '正在检查服务器连接', tone = 'info', list = null;
    const signatures = new WeakMap();
    const emit = () => onChange();
    const status = () => ({user: user ? {...user} : null, busy, service, message, tone, list: list ? copy(list) : null});
    const authenticated = () => { if(!user) throw new CloudError('请先登录管理员账号', 'UNAUTHENTICATED', 401); };
    function sessionData(data) {
      if(!data || !(data.user === null || (validId(data.user?.id) && typeof data.user.username === 'string'
        && typeof data.user.displayName === 'string')) || (data.csrfToken !== undefined && typeof data.csrfToken !== 'string')) {
        throw new CloudError('登录状态响应不完整，请重新检查连接');
      }
      if(user?.id !== data.user?.id) list = null;
      user = data.user ? {...data.user} : null; csrfToken = data.csrfToken || '';
    }
    async function request(path, {method = 'GET', body, login = false} = {}) {
      const headers = {Accept: 'application/json'};
      if(method !== 'GET') {
        headers['Content-Type'] = 'application/json';
        if(!login) {
          if(!csrfToken) throw new CloudError('缺少安全校验，请点击“检查连接”重新获取登录状态', 'CSRF_REQUIRED');
          headers['X-CSRF-Token'] = csrfToken;
        }
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(base + path, {method, headers, credentials: 'same-origin', cache: 'no-store',
          redirect: 'error', signal: controller.signal, ...(body === undefined ? {} : {body})});
        service = 'available';
        if(response.status === 401) { user = null; csrfToken = ''; list = null; }
        let envelope;
        try { envelope = await response.json(); }
        catch { throw new CloudError('服务器响应不是有效的草稿数据，请检查服务连接', 'INVALID_RESPONSE', response.status); }
        if(!response.ok || envelope?.ok !== true) {
          const error = envelope?.error;
          const detail = typeof error?.message === 'string' ? error.message.slice(0, 400) : '服务器未能完成请求';
          if(response.status === 409) throw new CloudError('服务器草稿已有新版本，请重新加载服务器版本后继续；本机草稿已保留', 'CONFLICT', 409);
          if(response.status === 401) throw new CloudError(login ? '登录失败，请检查账号和密码' : '登录已失效，请重新登录；本机草稿已保留', 'UNAUTHENTICATED', 401);
          throw new CloudError(detail, typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED', response.status);
        }
        if(!Object.hasOwn(envelope, 'data')) throw new CloudError('服务器响应缺少数据，尚不能确认操作结果');
        return envelope.data;
      } catch(error) {
        if(error instanceof CloudError) throw error;
        service = 'unavailable';
        throw new CloudError('服务器连接失败或超时，尚未确认服务器保存。本机工作台仍可使用', 'NETWORK');
      } finally { clearTimeout(timer); }
    }
    async function perform(label, action) {
      if(busy) throw new CloudError('服务器请求正在处理中，请稍候', 'BUSY');
      busy = true; message = label; tone = 'info'; emit();
      try { return await action(); }
      catch(error) { message = error.message || '服务器操作失败，本机草稿已保留'; tone = 'error'; throw error; }
      finally { busy = false; emit(); }
    }
    function checkOwner(batch) {
      if(batch.cloud?.ownerUserId && batch.cloud.ownerUserId !== user.id) throw new CloudError('此本机副本关联其他账号的服务器草稿，请使用原账号登录', 'OWNER_MISMATCH');
    }
    function requestKey() {
      if(crypto?.randomUUID) return crypto.randomUUID();
      if(crypto?.getRandomValues) return Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, '0')).join('');
      throw new CloudError('当前浏览器无法生成安全的请求编号，请通过 HTTPS 打开网站', 'CRYPTO_UNAVAILABLE');
    }
    async function remember(batch) { W.persistCloudMetadata(batch); return await W.flush(); }
    function validatePending(pending, batch) {
      let payload;
      try { payload = JSON.parse(pending.body); } catch { throw new CloudError('上次保存请求损坏，请保留本机草稿并重新加载服务器版本'); }
      if(!validId(pending.requestKey) || payload.requestKey !== pending.requestKey || pending.ownerUserId !== user.id
        || !['POST','PUT'].includes(pending.method) || (pending.method === 'PUT' && (!validId(pending.id)
          || pending.id !== batch.cloud.id || payload.expectedRevision !== batch.cloud.revision))
        || (pending.method === 'POST' && (pending.id || batch.cloud.id || Object.hasOwn(payload,'expectedRevision')))) {
        throw new CloudError('上次保存请求与本机草稿关联不一致，请保留本机资料并重新加载服务器版本');
      }
      W.validateSnapshot(payload.snapshot);
      return payload;
    }
    const api = {
      status,
      session: () => perform('正在检查服务器连接', async () => {
        sessionData(await request('/session'));
        message = user ? '管理员已登录；服务器草稿只在点击保存时提交' : '尚未登录；本机草稿可继续使用';
        return status();
      }),
      login: (username, password) => perform('正在登录管理员账号', async () => {
        if(typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) throw new CloudError('请填写账号和密码');
        // No password, cookie or CSRF token is written into a batch or browser storage.
        sessionData(await request('/login', {method:'POST', login:true, body:JSON.stringify({username:username.trim(), password})}));
        if(!user) throw new CloudError('登录尚未成功，请重新检查账号');
        message = '管理员已登录；可手动保存或打开服务器草稿列表'; return status();
      }),
      logout: () => perform('正在退出登录', async () => {
        try { await request('/logout', {method:'POST'}); message = '已退出登录，本机草稿仍保留在此电脑'; }
        catch(error) { throw new CloudError('退出请求未确认，请检查连接以确认登录状态。本机草稿仍保留', error.code, error.status); }
        finally { user = null; csrfToken = ''; list = null; }
      }),
      refresh: () => perform('正在读取服务器草稿列表', async () => {
        authenticated(); list = null;
        const rows = await request('/workspaces');
        if(!Array.isArray(rows)) throw new CloudError('服务器草稿列表格式不正确');
        list = rows.map(row => {
          workspace(row, false, W);
          const {id, revision, name, month, updatedAt} = row; return {id, revision, name, month, updatedAt};
        });
        message = list.length ? '选择草稿恢复为新的本机副本' : '暂无服务器草稿；可手动保存当前批次';
        return copy(list);
      }),
      save: () => perform('正在保存服务器草稿', async () => {
        authenticated(); UI?.prepareCloud('save');
        const batch = W.currentBatch(); checkOwner(batch);
        // Always check the CURRENT batch as well as a retained retry payload for demo data.
        const snapshot = W.packCurrent();
        let pending = batch.cloud?.pending;
        if(pending?.conflict || batch.cloud?.currentRevision > batch.cloud?.revision) throw new CloudError('服务器草稿已有新版本，请重新加载服务器版本后继续；本机草稿已保留', 'CONFLICT', 409);
        if(!pending) {
          const key = requestKey(), id = batch.cloud?.id;
          if(id && (!validId(id) || !Number.isSafeInteger(batch.cloud.revision) || batch.cloud.revision < 1)) throw new CloudError('本机服务器版本信息无效，请重新加载服务器版本');
          const payload = {requestKey:key, ...(id ? {expectedRevision:batch.cloud.revision} : {}), snapshot};
          pending = {requestKey:key, ownerUserId:user.id, method:id?'PUT':'POST', id:id||null, body:JSON.stringify(payload)};
          batch.cloud = {...batch.cloud, ownerUserId:user.id, pending};
          // Persist BEFORE dispatch so a reload after a lost response can retry the identical request.
          const error = await remember(batch);
          if(error) throw new CloudError('本机未能保存重试记录，尚未向服务器提交。请恢复本机存储后重试', 'LOCAL_STORAGE');
        } else {
          const error = await remember(batch);
          if(error) throw new CloudError('本机未能保存重试记录，尚未向服务器提交。请恢复本机存储后重试', 'LOCAL_STORAGE');
        }
        const payload = validatePending(pending, batch);
        let saved;
        try {
          saved = workspace(await request('/workspaces' + (pending.id ? '/' + encodeURIComponent(pending.id) : ''),
            {method:pending.method, body:pending.body}), true, W);
          if((pending.id && (saved.id !== pending.id || saved.revision <= payload.expectedRevision))
            || canonical(saved.snapshot) !== canonical(payload.snapshot)) throw new CloudError('服务器返回的版本或内容与本次提交不一致，保存结果尚未确认');
        } catch(error) {
          if(error.status === 409) { pending.conflict = true; await remember(batch); }
          throw error;
        }
        signatures.set(batch, canonical(payload.snapshot));
        batch.cloud = {id:saved.id, revision:saved.revision, currentRevision:saved.revision, updatedAt:saved.updatedAt, ownerUserId:user.id};
        const localError = await remember(batch); list = null;
        let currentMatches = false;
        try { currentMatches = batch === W.currentBatch() && canonical(W.packCurrent()) === signatures.get(batch); } catch { /* Current edits may still be in progress. */ }
        message = currentMatches ? `当前批次已保存为服务器草稿 · 版本 ${saved.revision}`
          : `提交时的“${payload.snapshot.batch.name}”已保存为服务器草稿；当前新增修改需再次点击保存`;
        if(localError) message += '。本机保存失败，请保留页面并记录服务器版本';
        tone = localError ? 'error' : 'success'; return saved;
      }),
      restore: id => perform('正在读取服务器草稿', async () => {
        authenticated(); if(!validId(id)) throw new CloudError('服务器草稿编号无效');
        const previous = W.currentBatch();
        const saved = workspace(await request('/workspaces/' + encodeURIComponent(id)), true, W);
        if(saved.id !== id) throw new CloudError('服务器返回的草稿编号不匹配');
        if(previous !== W.currentBatch()) throw new CloudError('读取期间已切换本机批次，请重新点击恢复');
        if(UI?.prepareCloud('restore') === false) { message = '已取消恢复，当前本机修改已保留'; return null; }
        // Default to a new local copy. No unrelated local batch is ever replaced.
        const batch = W.restoreCloud(saved.snapshot, {...saved, ownerUserId:user.id}, {mode:'copy'});
        signatures.set(batch, canonical(W.packCurrent()));
        UI?.cloudRestored();
        const localError = await W.flush();
        message = `服务器草稿“${saved.name}”已恢复为本机副本 · 版本 ${saved.revision}`;
        if(localError) message += '。本机存储不可用，请保留页面；服务器草稿仍可再次读取';
        tone = localError ? 'error' : 'success'; return batch;
      }),
      currentStatus: () => {
        const batch = W.currentBatch(), cloud = batch.cloud;
        try {
          const snapshot = W.packCurrent();
          if(cloud?.ownerUserId && user && cloud.ownerUserId !== user.id) return {blocked:true, text:'此本机副本关联其他管理员账号，请使用原账号登录'};
          if(cloud?.currentRevision > cloud?.revision) return {blocked:true, conflict:true,
            text:`当前查看服务器草稿旧版本 ${cloud.revision}，最新版本为 ${cloud.currentRevision}；请重新加载服务器版本后继续保存`};
          if(cloud?.pending) return {blocked:!!cloud.pending.conflict, pending:true, conflict:!!cloud.pending.conflict,
            text:cloud.pending.conflict ? '版本冲突：请重新加载服务器版本，本机副本保留'
              : '上次保存尚未确认。重试将发送上次内容，新增修改需随后再保存'};
          const synced = !!cloud?.id && signatures.get(batch) === canonical(snapshot);
          return {blocked:false, synced, text:cloud?.id ? `服务器草稿版本 ${cloud.revision} · ${synced ? '当前内容已同步' : '本机内容尚未确认同步'}`
            : '当前批次仅在本机；点击保存后才能在其他电脑恢复'};
        } catch(error) { return {blocked:true, text:error.message}; }
      }
    };
    return api;
  }
  let client, root, initializing;
  const el = id => root?.querySelector('#' + id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function paint() {
    if(!root || !client) return;
    const s = client.status(), current = client.currentStatus();
    el('cloudAccount').textContent = s.user ? `${s.user.displayName || s.user.username} · 管理员` : '未登录';
    el('cloudMessage').textContent = s.tone === 'success' && current.synced === false
      ? '当前本机内容尚未确认同步，请手动保存当前批次。' : s.message;
    el('cloudMessage').dataset.tone = s.tone === 'success' && current.synced === false ? 'info' : s.tone;
    el('cloudCurrent').textContent = current.text;
    el('cloudLocal').textContent = PayrollWorkbench.storageError ? '本机存储不可用，请保留页面并检查浏览器存储。' : '本机草稿继续保留；服务器草稿仅用于恢复核算工作。';
    el('cloudSave').disabled = s.busy || !s.user || current.blocked;
    el('cloudSave').textContent = current.pending ? '重试上次服务器保存' : '保存到服务器';
    el('cloudLogout').hidden = !s.user; el('cloudLoginToggle').hidden = !!s.user;
    el('cloudReload').hidden = !current.conflict;
    for(const id of ['cloudListButton','cloudLogout','cloudReload']) el(id).disabled = s.busy || !s.user;
    for(const id of ['cloudLoginToggle','cloudReconnect','cloudLoginSubmit']) el(id).disabled = s.busy;
    if(s.user) { el('cloudLoginForm').hidden = true; el('cloudPassword').value = ''; }
    el('cloudList').hidden = !s.user || s.list === null;
    el('cloudList').innerHTML = s.list === null ? '' : `<h2>服务器草稿列表</h2>${s.list.length ? s.list.map(row => `<div class="wb-cloud-item"><div><strong>${esc(row.name)}</strong><span>${esc(row.month)} · 版本 ${row.revision} · ${esc(row.updatedAt)}</span></div><button type="button" class="btn" data-cloud="restore" data-id="${esc(row.id)}" ${s.busy?'disabled':''}>恢复为本机副本</button></div>`).join('') : '<p>暂无服务器草稿</p>'}`;
  }
  function mount() {
    root.innerHTML = `<div class="wb-cloud-row"><div><strong>服务器草稿</strong><span id="cloudAccount" class="wb-cloud-account"></span><p id="cloudLocal"></p></div><div class="wb-cloud-actions"><button type="button" class="btn btn-primary" id="cloudSave" data-cloud="save">保存到服务器</button><button type="button" class="btn" id="cloudListButton" data-cloud="list">服务器草稿列表</button><button type="button" class="btn" id="cloudLoginToggle" data-cloud="login-form">管理员登录</button><button type="button" class="btn" id="cloudLogout" data-cloud="logout" hidden>退出</button><button type="button" class="wb-link" id="cloudReconnect" data-cloud="session">检查连接</button></div></div>
      <p id="cloudCurrent" class="wb-cloud-current"></p><p id="cloudMessage" role="status" aria-live="polite"></p><button type="button" class="btn" id="cloudReload" data-cloud="reload" hidden>重新加载服务器版本</button>
      <form id="cloudLoginForm" class="wb-cloud-login" hidden><label>管理员账号<input class="input" id="cloudUsername" name="username" autocomplete="username" required></label><label>密码<input class="input" id="cloudPassword" name="password" type="password" autocomplete="current-password" required></label><button class="btn btn-primary" id="cloudLoginSubmit" type="submit">登录</button><button class="btn" type="button" data-cloud="cancel-login">取消</button></form><div id="cloudList" class="wb-cloud-list" hidden></div>`;
    root.addEventListener('click', event => {
      const button = event.target.closest('[data-cloud]'); if(!button || button.disabled) return;
      const action = button.dataset.cloud;
      if(action === 'login-form') { el('cloudLoginForm').hidden = !el('cloudLoginForm').hidden; if(!el('cloudLoginForm').hidden) el('cloudUsername').focus(); return; }
      if(action === 'cancel-login') { el('cloudPassword').value = ''; el('cloudLoginForm').hidden = true; return; }
      const operations = {save:()=>client.save(), list:()=>client.refresh(), session:()=>client.session(), logout:()=>client.logout(),
        restore:()=>client.restore(button.dataset.id), reload:()=>client.restore(PayrollWorkbench.currentBatch().cloud?.id)};
      operations[action]?.().catch(() => {}); // perform() already displays a safe, actionable error.
    });
    el('cloudLoginForm').addEventListener('submit', event => {
      event.preventDefault(); if(client.status().busy) return;
      const username = el('cloudUsername').value, password = el('cloudPassword').value;
      el('cloudPassword').value = ''; client.login(username, password).catch(() => {});
    });
  }
  async function initialize() {
    // Local IndexedDB hydration and route setup must finish before any restore can act.
    await PayrollWorkbenchUI.init();
    root = document.getElementById('payrollCloud'); if(!root) return;
    client = createClient({onChange:paint}); mount(); PayrollWorkbench.subscribe(paint); paint();
    await client.session().catch(() => {});
    return client;
  }
  function init() { return initializing ||= initialize(); }
  if(!globalThis.__PAYROLL_TEST__) init().catch(error => {
    const banner = document.getElementById('payrollCloud');
    if(banner) banner.textContent = '服务器草稿入口未能加载：' + error.message + '。本机工作台可继续使用。';
  });
  return {createClient, init};
})();
