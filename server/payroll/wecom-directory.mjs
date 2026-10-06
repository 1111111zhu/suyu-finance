const API = 'https://qyapi.weixin.qq.com/cgi-bin';
const INVALID_TOKEN_CODES = new Set([40014, 42001, 42007]);

export class WeComDirectoryError extends Error {
  constructor(message, errcode = null) {
    super(message);
    this.name = 'WeComDirectoryError';
    this.code = 'WECOM_DIRECTORY_FAILED';
    this.status = 502;
    this.errcode = errcode;
  }
}

const text = value => String(value ?? '').trim();
const first = value => Array.isArray(value) ? text(value[0]) : text(value);

export function createWeComDirectory({ pool, corpId, appSecret, maxMembers = 10000, syncIntervalSeconds = 21600, fetchImpl = fetch, now = () => Date.now() }) {
  if (!pool?.connect || !pool?.query) throw new TypeError('A PostgreSQL pool is required');
  if (!text(corpId) || !text(appSecret)) throw new TypeError('WeCom CorpID and application Secret are required');
  if (!Number.isInteger(maxMembers) || maxMembers < 1 || maxMembers > 10000) throw new TypeError('Invalid directory member limit');
  if (!Number.isInteger(syncIntervalSeconds) || syncIntervalSeconds < 300) throw new TypeError('Invalid directory sync interval');
  let cachedToken = '';
  let tokenExpiresAt = 0;
  let tokenPromise = null;
  let syncPromise = null;
  let lastError = null;

  async function request(method, path, query = {}, body) {
    const url = new URL(API + path);
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetchImpl(url, {
        method,
        signal: controller.signal,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      if (!response?.ok) throw new WeComDirectoryError('企业微信通讯录接口暂不可用');
      const result = await response.json();
      if (!result || typeof result !== 'object') throw new WeComDirectoryError('企业微信通讯录返回格式无效');
      return result;
    } catch (error) {
      if (error instanceof WeComDirectoryError) throw error;
      throw new WeComDirectoryError('企业微信通讯录连接失败');
    } finally {
      clearTimeout(timer);
    }
  }

  async function accessToken() {
    if (cachedToken && now() < tokenExpiresAt) return cachedToken;
    if (!tokenPromise) tokenPromise = (async () => {
      const result = await request('GET', '/gettoken', { corpid: corpId, corpsecret: appSecret });
      if (Number(result.errcode || 0) !== 0 || !text(result.access_token)) {
        throw new WeComDirectoryError('企业微信应用凭据无效', Number(result.errcode || 0));
      }
      cachedToken = result.access_token;
      tokenExpiresAt = now() + Math.max(1, Number(result.expires_in || 7200) - 120) * 1000;
      return cachedToken;
    })().finally(() => { tokenPromise = null; });
    return tokenPromise;
  }

  async function api(method, path, query = {}, body, retry = true) {
    const access_token = await accessToken();
    const result = await request(method, path, { ...query, access_token }, body);
    const code = Number(result.errcode || 0);
    if (INVALID_TOKEN_CODES.has(code) && retry) {
      if (cachedToken === access_token) { cachedToken = ''; tokenExpiresAt = 0; }
      return api(method, path, query, body, false);
    }
    if (code !== 0) throw new WeComDirectoryError(`企业微信拒绝通讯录读取（错误码 ${code}）`, code);
    return result;
  }

  async function departmentDetail(id) {
    try {
      const result = await api('GET', '/department/get', { id });
      return result.department && typeof result.department === 'object' ? result.department : null;
    } catch (error) {
      if (error instanceof WeComDirectoryError && error.errcode === 60011) return null;
      throw error;
    }
  }

  async function departments() {
    let rows = null;
    let lastError;
    for (const [path, query] of [
      ['/department/simplelist', { id: 1 }],
      ['/department/simplelist', {}],
      ['/department/list', {}],
    ]) {
      try {
        const result = await api('GET', path, query);
        rows = result.department_id || result.department;
        if (!Array.isArray(rows)) throw new WeComDirectoryError('企业微信部门清单格式无效');
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!rows) throw lastError;
    const result = new Map();
    for (const row of rows) {
      const id = text(row?.id || row?.department_id);
      if (!/^\d+$/.test(id)) throw new WeComDirectoryError('企业微信部门编号无效');
      const detail = text(row?.name) ? row : await departmentDetail(id);
      result.set(id, {
        id,
        name: text(detail?.name) || `部门${id}`,
        parentId: text(detail?.parentid || row?.parentid || 0),
        leaderUserid: first(detail?.department_leader || detail?.leader || row?.department_leader),
      });
    }
    if (!result.has('1')) result.set('1', { id: '1', name: '根部门', parentId: '0', leaderUserid: '' });
    return result;
  }

  async function visibleUserids() {
    const ids = new Set();
    const cursors = new Set();
    let cursor = '';
    do {
      if (cursors.has(cursor)) throw new WeComDirectoryError('企业微信成员游标重复');
      cursors.add(cursor);
      const result = await api('POST', '/user/list_id', {}, { limit: 10000, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result.dept_user)) throw new WeComDirectoryError('企业微信成员清单格式无效');
      for (const row of result.dept_user) {
        const userid = text(row?.userid);
        if (userid) ids.add(userid);
        if (ids.size > maxMembers) throw new WeComDirectoryError('企微可见成员超过配置上限');
      }
      cursor = text(result.next_cursor);
    } while (cursor);
    return [...ids];
  }

  async function useridsByDepartment(departmentRows) {
    const ids = new Set();
    let succeeded = 0;
    for (const id of departmentRows.keys()) {
      try {
        const result = await api('GET', '/user/list', { department_id: id, fetch_child: 0 });
        if (!Array.isArray(result.userlist)) throw new WeComDirectoryError('企业微信部门成员格式无效');
        succeeded++;
        for (const row of result.userlist) {
          const userid = text(row?.userid);
          if (userid) ids.add(userid);
          if (ids.size > maxMembers) throw new WeComDirectoryError('企微可见成员超过配置上限');
        }
      } catch (error) {
        if (error instanceof WeComDirectoryError && error.errcode === 60011) continue;
        throw error;
      }
    }
    if (!succeeded) throw new WeComDirectoryError('没有可读取的企业微信部门成员');
    return [...ids];
  }

  async function collect() {
    let departmentRows;
    let departmentError = null;
    try { departmentRows = await departments(); }
    catch (error) {
      departmentError = error;
      departmentRows = new Map([['1', { id: '1', name: '根部门', parentId: '0', leaderUserid: '' }]]);
    }
    let userids;
    try { userids = await visibleUserids(); }
    catch (error) {
      if (!(error instanceof WeComDirectoryError) || ![48002, 60011].includes(error.errcode)) throw error;
      if (departmentError) throw new WeComDirectoryError('企业微信部门和成员枚举接口均不可读，请检查应用可见范围与通讯录权限');
      userids = await useridsByDepartment(departmentRows);
    }
    const memberRows = [];
    for (const userid of userids) {
      const row = await api('GET', '/user/get', { userid });
      if (text(row.userid || row.UserId) !== userid) throw new WeComDirectoryError('企业微信成员编号不一致');
      if (Number(row.status || 0) !== 1) continue;
      const name = text(row.name);
      if (!name) throw new WeComDirectoryError('企业微信成员姓名缺失');
      const departmentIds = Array.isArray(row.department) ? row.department.map(text).filter(Boolean) : [];
      for (const id of departmentIds) {
        if (!/^\d+$/.test(id)) throw new WeComDirectoryError('企业微信成员部门编号无效');
        if (!departmentRows.has(id)) {
          const detail = await departmentDetail(id);
          departmentRows.set(id, {
            id,
            name: text(detail?.name) || `部门${id}`,
            parentId: text(detail?.parentid || 0),
            leaderUserid: first(detail?.department_leader || detail?.leader),
          });
        }
      }
      memberRows.push({ userid, name, departmentIds, directLeaderUserid: first(row.direct_leader), position: text(row.position) });
    }
    if (!memberRows.length) throw new WeComDirectoryError('企业微信通讯录没有可用的在职成员');
    return { departments: [...departmentRows.values()], members: memberRows };
  }

  async function sync() {
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      const snapshot = await collect();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE payroll.wecom_departments SET active=false WHERE corp_id=$1', [corpId]);
        await client.query(`INSERT INTO payroll.wecom_departments(corp_id,department_id,name,parent_id,leader_userid,active,observed_at)
          SELECT $1,d->>'id',d->>'name',d->>'parentId',NULLIF(d->>'leaderUserid',''),true,CURRENT_TIMESTAMP
          FROM jsonb_array_elements($2::jsonb) d
          ON CONFLICT(corp_id,department_id) DO UPDATE SET name=EXCLUDED.name,parent_id=EXCLUDED.parent_id,
            leader_userid=EXCLUDED.leader_userid,active=true,observed_at=EXCLUDED.observed_at`, [corpId, JSON.stringify(snapshot.departments)]);
        await client.query('UPDATE payroll.wecom_members SET active=false WHERE corp_id=$1', [corpId]);
        await client.query(`INSERT INTO payroll.wecom_members(corp_id,userid,name,department_ids,direct_leader_userid,position,active,observed_at)
          SELECT $1,m->>'userid',m->>'name',m->'departmentIds',NULLIF(m->>'directLeaderUserid',''),m->>'position',true,CURRENT_TIMESTAMP
          FROM jsonb_array_elements($2::jsonb) m
          ON CONFLICT(corp_id,userid) DO UPDATE SET name=EXCLUDED.name,department_ids=EXCLUDED.department_ids,
            direct_leader_userid=EXCLUDED.direct_leader_userid,position=EXCLUDED.position,active=true,observed_at=EXCLUDED.observed_at`, [corpId, JSON.stringify(snapshot.members)]);
        await client.query(`INSERT INTO payroll.wecom_directory_syncs(corp_id,synced_at,department_count,member_count)
          VALUES($1,CURRENT_TIMESTAMP,$2,$3)
          ON CONFLICT(corp_id) DO UPDATE SET synced_at=EXCLUDED.synced_at,department_count=EXCLUDED.department_count,member_count=EXCLUDED.member_count`,
          [corpId, snapshot.departments.length, snapshot.members.length]);
        await client.query('COMMIT');
        lastError = null;
        return { departmentCount: snapshot.departments.length, memberCount: snapshot.members.length };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    })().catch(error => {
      lastError = error instanceof WeComDirectoryError ? error.message : '通讯录快照保存失败';
      throw error;
    }).finally(() => { syncPromise = null; });
    return syncPromise;
  }

  async function snapshot() {
    const [status, departmentResult, memberResult] = await Promise.all([
      pool.query('SELECT synced_at,department_count,member_count FROM payroll.wecom_directory_syncs WHERE corp_id=$1', [corpId]),
      pool.query('SELECT department_id AS id,name,parent_id AS "parentId",leader_userid AS "leaderUserid" FROM payroll.wecom_departments WHERE corp_id=$1 AND active=true ORDER BY name,department_id', [corpId]),
      pool.query('SELECT userid,name,department_ids AS "departmentIds",direct_leader_userid AS "directLeaderUserid",position FROM payroll.wecom_members WHERE corp_id=$1 AND active=true ORDER BY name,userid', [corpId]),
    ]);
    const syncedAt = status.rows[0]?.synced_at || null;
    return {
      syncedAt,
      fresh: Boolean(syncedAt && now() - new Date(syncedAt).getTime() <= (syncIntervalSeconds + 900) * 1000),
      departmentCount: status.rows[0]?.department_count || 0,
      memberCount: status.rows[0]?.member_count || 0,
      syncing: Boolean(syncPromise),
      lastError,
      departments: departmentResult.rows,
      members: memberResult.rows,
    };
  }

  return { sync, snapshot, syncing: () => Boolean(syncPromise) };
}
