/* Read-only Enterprise WeChat directory. Payroll records remain sourced from the uploaded roster. */
(() => {
  const endpoint = '/api/payroll/personnel/directory';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  async function request(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', ...options.headers }, ...options });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true) {
      throw new Error(result?.error?.message || '通讯录服务暂不可用');
    }
    return result.data;
  }

  function openDirectory() {
    document.querySelector('.wb-wecom-directory')?.remove();
    const dialog = document.createElement('dialog');
    dialog.className = 'wb-dialog wb-wecom-directory';
    dialog.innerHTML = `<div class="wb-wecom-head"><div><h2>企业微信通讯录</h2><p class="wb-muted">只读参考。企微人员不会自动进入工资花名册或改写工资数据。</p></div><button type="button" class="btn" data-wecom-close>关闭</button></div>
      <div class="wb-wecom-toolbar"><input class="input" type="search" placeholder="按姓名、企微账号或部门搜索" aria-label="搜索企微通讯录" data-wecom-search><button type="button" class="btn" data-wecom-sync>立即同步</button></div>
      <p class="wb-small" data-wecom-status>正在读取通讯录…</p><div data-wecom-result></div>`;
    document.body.append(dialog);
    dialog.showModal();
    dialog.addEventListener('close', () => dialog.remove());
    dialog.querySelector('[data-wecom-close]').addEventListener('click', () => dialog.close());
    const status = dialog.querySelector('[data-wecom-status]');
    const result = dialog.querySelector('[data-wecom-result]');
    const search = dialog.querySelector('[data-wecom-search]');
    const syncButton = dialog.querySelector('[data-wecom-sync]');
    let snapshot = null;

    function render() {
      if (!snapshot) return;
      const departments = new Map(snapshot.departments.map(row => [String(row.id), row.name]));
      const query = search.value.trim().toLocaleLowerCase();
      const matches = snapshot.members.filter(row => {
        const names = (row.departmentIds || []).map(id => departments.get(String(id)) || `部门${id}`);
        return !query || [row.name, row.userid, ...names].some(value => String(value || '').toLocaleLowerCase().includes(query));
      });
      const shown = matches.slice(0, 200);
      result.innerHTML = shown.length ? `<div class="wb-table-shell wb-wecom-table"><table class="wb-table"><thead><tr><th>姓名</th><th>企微账号</th><th>部门</th><th>职务</th></tr></thead><tbody>${shown.map(row => `<tr><td>${escape(row.name)}</td><td>${escape(row.userid)}</td><td>${escape((row.departmentIds || []).map(id => departments.get(String(id)) || `部门${id}`).join('、') || '未分配')}</td><td>${escape(row.position || '—')}</td></tr>`).join('')}</tbody></table></div><p class="wb-small">匹配 ${matches.length} 人${matches.length > shown.length ? '，当前显示前 200 人，请缩小搜索范围' : ''}</p>` : '<p class="wb-muted">没有匹配的成员。</p>';
    }

    async function load() {
      try {
        snapshot = await request(endpoint);
        if (!snapshot.configured) {
          status.textContent = '企业微信只读应用尚未配置，当前没有企微人员数据。';
          syncButton.disabled = true;
          result.innerHTML = '';
          return;
        }
        const when = snapshot.syncedAt ? new Date(snapshot.syncedAt).toLocaleString('zh-CN') : '尚未完成同步';
        status.textContent = `${snapshot.memberCount} 人 · ${snapshot.departmentCount} 个部门 · 最近同步：${when}${snapshot.syncedAt && !snapshot.fresh ? ' · 快照已过期，请同步' : ''}${snapshot.syncing ? ' · 正在同步' : ''}${snapshot.lastError ? ' · 上次失败：' + snapshot.lastError : ''}`;
        render();
      } catch (error) {
        status.textContent = error.message;
        result.innerHTML = '';
      }
    }

    search.addEventListener('input', render);
    syncButton.addEventListener('click', async () => {
      syncButton.disabled = true;
      status.textContent = '正在从企业微信读取部门和成员…';
      try {
        await request(`${endpoint}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Suyu-Local': '1' },
          body: '{}',
        });
        for (let attempt = 0; attempt < 120 && dialog.open; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const current = await request(endpoint);
          if (!current.syncing) break;
        }
        if (dialog.open) await load();
      } catch (error) {
        if (dialog.open) status.textContent = error.message;
      } finally {
        syncButton.disabled = false;
      }
    });
    void load();
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-wecom-directory]')) openDirectory();
  });
})();
