import { createHash } from 'node:crypto';
import { withTransaction } from '../../database/payroll/pool.mjs';

const API = 'https://qyapi.weixin.qq.com/cgi-bin';
const INVALID_TOKEN = new Set([40014, 42001, 42007]);
const EVENT_LABELS = {
  joined_visible: '新进入可见通讯录（入职待核实）',
  no_longer_visible: '不再出现在可见通讯录（离职待核实）',
  department_changed: '部门调动',
  position_changed: '岗位变动',
  name_changed: '姓名变更',
};
const ROSTER_FIELDS = ['name', 'employeeNumber', 'company', 'department', 'subdepartment', 'thirdDepartment', 'position',
  'employeeType', 'employeeStatus', 'joinedOn', 'regularizationOn', 'leftOn'];

export class PersonnelError extends Error {
  constructor(message, code = 'PAYROLL_VALIDATION', status = 422, errcode = null) {
    super(message);
    this.name = 'PersonnelError';
    this.code = code;
    this.status = status;
    this.errcode = errcode;
  }
}

const str = value => String(value ?? '').trim();
const first = value => Array.isArray(value) ? str(value[0]) : str(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const iso = value => value == null ? null : new Date(value).toISOString();
const fail = (message, code, status) => { throw new PersonnelError(message, code, status); };
function uuid(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) fail(`${label}格式无效`);
  return value;
}
function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canon(value[key])]));
  return value;
}
const digest = value => createHash('sha256').update(JSON.stringify(canon(value))).digest('hex');
function validDate(value, label) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString().slice(0, 10) !== value) fail(`${label}日期无效`);
  return value;
}
function shortText(value, label, max = 200, required = false) {
  if (value == null || value === '') {
    if (required) fail(`缺少${label}`);
    return null;
  }
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label}格式无效`);
  return value.trim();
}
function monthDate(value) {
  if (value == null || value === '') return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) fail('花名册月份格式应为 YYYY-MM');
  return `${value}-01`;
}
function dateBoundary(value, end = false) {
  if (!value) return null;
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/.test(value)) fail('时间范围格式应为 YYYY-MM 或 YYYY-MM-DD');
  const date = value.length === 7 ? `${value}-01` : validDate(value, '筛选');
  const result = new Date(`${date}T00:00:00.000Z`);
  if (end) result.setUTCDate(result.getUTCDate() + (value.length === 7 ? 0 : 1));
  if (end && value.length === 7) result.setUTCMonth(result.getUTCMonth() + 1);
  return result.toISOString();
}
function normalizedRosterRow(row, index) {
  if (!object(row)) fail(`花名册第 ${index + 1} 行格式无效`);
  const rowNumber = Number(row.rowNumber ?? index + 2);
  if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > 1000000) fail('花名册行号无效');
  const clean = { rowNumber, name: shortText(row.name, '姓名', 200, true) };
  for (const field of ROSTER_FIELDS.slice(1)) {
    clean[field] = field.endsWith('On') ? validDate(row[field], field) : shortText(row[field], field, 300);
  }
  const sources = object(row.fieldSources) ? row.fieldSources : {};
  clean.fieldSources = Object.fromEntries(ROSTER_FIELDS.filter(key => typeof sources[key] === 'string' && sources[key].length <= 100
      && !/银行卡|银行账号|开户行|证件|身份证|账户|账号|手机号|电话号码|\d{9,}/i.test(sources[key]))
    .map(key => [key, sources[key].trim()]));
  return clean;
}
function safeMember(row) {
  return { userid: row.userid, name: row.name, departmentIds: row.department_ids, position: row.position };
}

/**
 * A server-only, read-only WeCom connector plus explicit payroll identity/roster
 * reconciliation. No credential or banking field is ever returned or logged.
 */
export function createPersonnelService({ pool, corpId, appSecret, fetchImpl = fetch, now = () => Date.now(),
  maxMembers = 10000, syncIntervalSeconds = 21600 } = {}) {
  if (!pool?.connect || !pool?.query) throw new TypeError('A PostgreSQL pool is required');
  if (!str(corpId) || !str(appSecret)) throw new TypeError('WeCom CorpID and application Secret are required');
  if (!Number.isInteger(maxMembers) || maxMembers < 1 || maxMembers > 10000) throw new TypeError('Invalid member limit');
  if (!Number.isInteger(syncIntervalSeconds) || syncIntervalSeconds < 300) throw new TypeError('Invalid sync interval');
  let token = '', tokenExpiresAt = 0, tokenPromise = null, syncPromise = null, lastError = null;

  async function request(method, path, query = {}, body) {
    const url = new URL(API + path);
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetchImpl(url, { method, signal: controller.signal,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      if (!response?.ok) throw new PersonnelError('企业微信通讯录接口暂不可用', 'WECOM_DIRECTORY_FAILED', 502);
      const result = await response.json();
      if (!object(result)) throw new PersonnelError('企业微信通讯录返回格式无效', 'WECOM_DIRECTORY_FAILED', 502);
      return result;
    } catch (error) {
      if (error instanceof PersonnelError) throw error;
      throw new PersonnelError('企业微信通讯录连接失败', 'WECOM_DIRECTORY_FAILED', 502);
    } finally { clearTimeout(timer); }
  }
  async function accessToken() {
    if (token && now() < tokenExpiresAt) return token;
    if (!tokenPromise) tokenPromise = (async () => {
      const result = await request('GET', '/gettoken', { corpid: corpId, corpsecret: appSecret });
      if (Number(result.errcode || 0) !== 0 || !str(result.access_token))
        throw new PersonnelError('企业微信应用凭据无效', 'WECOM_DIRECTORY_FAILED', 502, Number(result.errcode || 0));
      token = result.access_token;
      tokenExpiresAt = now() + Math.max(1, Number(result.expires_in || 7200) - 120) * 1000;
      return token;
    })().finally(() => { tokenPromise = null; });
    return tokenPromise;
  }
  async function api(method, path, query = {}, body, retry = true) {
    const access_token = await accessToken();
    const result = await request(method, path, { ...query, access_token }, body);
    const errcode = Number(result.errcode || 0);
    if (INVALID_TOKEN.has(errcode) && retry) {
      if (token === access_token) { token = ''; tokenExpiresAt = 0; }
      return api(method, path, query, body, false);
    }
    if (errcode !== 0) throw new PersonnelError(`企业微信拒绝通讯录读取（错误码 ${errcode}）`, 'WECOM_DIRECTORY_FAILED', 502, errcode);
    return result;
  }
  async function departmentDetail(id) {
    try {
      const result = await api('GET', '/department/get', { id });
      return object(result.department) ? result.department : null;
    } catch (error) {
      if (error instanceof PersonnelError && error.errcode === 60011) return null;
      throw error;
    }
  }
  async function departments() {
    let rows, last;
    for (const [path, query] of [['/department/list', {}], ['/department/simplelist', { id: 1 }], ['/department/simplelist', {}]]) {
      try {
        const result = await api('GET', path, query);
        rows = result.department || result.department_id;
        if (!Array.isArray(rows)) throw new PersonnelError('企业微信部门清单格式无效', 'WECOM_DIRECTORY_FAILED', 502);
        break;
      } catch (error) { last = error; }
    }
    if (!rows) throw last;
    const map = new Map();
    for (const row of rows) {
      const id = str(row?.id || row?.department_id);
      if (!/^\d+$/.test(id)) throw new PersonnelError('企业微信部门编号无效', 'WECOM_DIRECTORY_FAILED', 502);
      const detail = str(row?.name) ? row : await departmentDetail(id);
      map.set(id, { id, name: str(detail?.name) || `部门${id}`, parentId: str(detail?.parentid ?? row?.parentid ?? 0),
        order: Number.isSafeInteger(Number(detail?.order ?? row?.order)) ? Number(detail?.order ?? row?.order) : 0,
        leaderUserid: first(detail?.department_leader || row?.department_leader) });
    }
    if (!map.has('1')) map.set('1', { id: '1', name: '根部门', parentId: '0', order: 0, leaderUserid: '' });
    return map;
  }
  async function visibleUserids() {
    const ids = new Set(), cursors = new Set();
    let cursor = '';
    do {
      if (cursors.has(cursor)) throw new PersonnelError('企业微信成员游标重复', 'WECOM_DIRECTORY_FAILED', 502);
      cursors.add(cursor);
      const result = await api('POST', '/user/list_id', {}, { limit: 10000, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result.dept_user)) throw new PersonnelError('企业微信成员清单格式无效', 'WECOM_DIRECTORY_FAILED', 502);
      for (const row of result.dept_user) {
        if (str(row?.userid)) ids.add(str(row.userid));
        if (ids.size > maxMembers) throw new PersonnelError('企业微信可见成员超过配置上限', 'WECOM_DIRECTORY_FAILED', 502);
      }
      cursor = str(result.next_cursor);
    } while (cursor);
    return [...ids];
  }
  async function useridsByDepartment(deptMap) {
    const ids = new Set(); let succeeded = 0;
    for (const id of deptMap.keys()) {
      try {
        const result = await api('GET', '/user/list', { department_id: id, fetch_child: 0 });
        if (!Array.isArray(result.userlist)) throw new PersonnelError('企业微信部门成员格式无效', 'WECOM_DIRECTORY_FAILED', 502);
        succeeded++;
        for (const row of result.userlist) {
          if (str(row?.userid)) ids.add(str(row.userid));
          if (ids.size > maxMembers) throw new PersonnelError('企业微信可见成员超过配置上限', 'WECOM_DIRECTORY_FAILED', 502);
        }
      } catch (error) {
        if (error instanceof PersonnelError && error.errcode === 60011) continue;
        throw error;
      }
    }
    if (!succeeded) throw new PersonnelError('没有可读取的企业微信部门成员', 'WECOM_DIRECTORY_FAILED', 502);
    return [...ids];
  }
  async function collect() {
    let deptMap, departmentError = null;
    try { deptMap = await departments(); }
    catch (error) { departmentError = error; deptMap = new Map([['1', { id: '1', name: '根部门', parentId: '0', order: 0, leaderUserid: '' }]]); }
    let userids;
    try { userids = await visibleUserids(); }
    catch (error) {
      if (!(error instanceof PersonnelError) || ![48002, 60011].includes(error.errcode)) throw error;
      if (departmentError) throw new PersonnelError(
        `企业微信部门读取失败（${departmentError.errcode ?? '未知错误'}），成员枚举失败（${error.errcode ?? '未知错误'}）；请检查企业可信 IP、通讯录权限和应用可见范围`,
        'WECOM_DIRECTORY_FAILED', 502);
      userids = await useridsByDepartment(deptMap);
    }
    const members = new Array(userids.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, userids.length) }, async () => {
      while (next < userids.length) {
        const index = next++, userid = userids[index];
        const row = await api('GET', '/user/get', { userid });
        if (str(row.userid || row.UserId) !== userid) throw new PersonnelError('企业微信成员编号不一致', 'WECOM_DIRECTORY_FAILED', 502);
        if (Number(row.status || 0) !== 1) continue;
        if (!str(row.name)) throw new PersonnelError('企业微信成员姓名缺失', 'WECOM_DIRECTORY_FAILED', 502);
        const departmentIds = Array.isArray(row.department) ? [...new Set(row.department.map(str).filter(Boolean))] : [];
        if (departmentIds.some(id => !/^\d+$/.test(id))) throw new PersonnelError('企业微信成员部门编号无效', 'WECOM_DIRECTORY_FAILED', 502);
        members[index] = { userid, name: str(row.name), departmentIds, position: str(row.position) };
      }
    }));
    const active = members.filter(Boolean);
    if (!active.length) throw new PersonnelError('企业微信通讯录没有可用的在职成员，保留上次成功快照', 'WECOM_DIRECTORY_FAILED', 502);
    for (const member of active) for (const id of member.departmentIds) if (!deptMap.has(id)) {
      const detail = await departmentDetail(id);
      deptMap.set(id, { id, name: str(detail?.name) || `部门${id}`, parentId: str(detail?.parentid ?? 0),
        order: Number(detail?.order || 0), leaderUserid: first(detail?.department_leader) });
    }
    return { departments: [...deptMap.values()], members: active };
  }

  function detectedEvents(previous, current, previousSyncedAt) {
    if (!previousSyncedAt) return [];
    const before = new Map(previous.map(row => [row.userid, safeMember(row)]));
    const after = new Map(current.map(row => [row.userid, row]));
    const events = [];
    for (const [userid, member] of after) {
      const old = before.get(userid);
      if (!old) events.push({ userid, type: 'joined_visible', before: {}, after: member,
        reason: '该成员首次进入此应用可见的企业微信通讯录；可能为入职、重新加入或应用可见范围变化，需核实实际生效日期。' });
      else {
        if (JSON.stringify([...old.departmentIds].sort()) !== JSON.stringify([...member.departmentIds].sort()))
          events.push({ userid, type: 'department_changed', before: { departmentIds: old.departmentIds },
            after: { departmentIds: member.departmentIds }, reason: '相邻两次成功同步的企业微信部门编号不同；具体调动生效时间未由接口提供。' });
        if (old.position !== member.position)
          events.push({ userid, type: 'position_changed', before: { position: old.position }, after: { position: member.position },
            reason: '相邻两次成功同步的企业微信岗位不同；具体变动生效时间未由接口提供。' });
        if (old.name !== member.name)
          events.push({ userid, type: 'name_changed', before: { name: old.name }, after: { name: member.name },
            reason: '相邻两次成功同步的企业微信姓名不同，请核对是否为姓名更改。' });
      }
    }
    for (const [userid, member] of before) if (!after.has(userid))
      events.push({ userid, type: 'no_longer_visible', before: member, after: {},
        reason: '该成员不再出现在应用可见的企业微信通讯录；可能为离职、禁用或可见范围变化，不能直接认定离职。' });
    return events;
  }

  async function sync() {
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      const collected = await collect();
      const result = await withTransaction(pool, async client => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`wecom-directory:${corpId}`]);
        const previousSync = (await client.query('SELECT synced_at FROM payroll.wecom_directory_syncs WHERE corp_id=$1 FOR UPDATE', [corpId])).rows[0];
        const previous = (await client.query('SELECT userid,name,department_ids,position FROM payroll.wecom_members WHERE corp_id=$1 AND active=true', [corpId])).rows;
        const syncedAt = (await client.query('SELECT clock_timestamp() AS synced_at')).rows[0].synced_at;
        const events = detectedEvents(previous, collected.members, previousSync?.synced_at);
        await client.query('UPDATE payroll.wecom_departments SET active=false WHERE corp_id=$1', [corpId]);
        await client.query(`INSERT INTO payroll.wecom_departments(corp_id,department_id,name,parent_id,display_order,leader_userid,active,observed_at)
          SELECT $1,d->>'id',d->>'name',d->>'parentId',COALESCE((d->>'order')::integer,0),NULLIF(d->>'leaderUserid',''),true,$3
          FROM jsonb_array_elements($2::jsonb) d
          ON CONFLICT(corp_id,department_id) DO UPDATE SET name=EXCLUDED.name,parent_id=EXCLUDED.parent_id,
            display_order=EXCLUDED.display_order,leader_userid=EXCLUDED.leader_userid,active=true,observed_at=EXCLUDED.observed_at`,
          [corpId, JSON.stringify(collected.departments), syncedAt]);
        await client.query('UPDATE payroll.wecom_members SET active=false WHERE corp_id=$1', [corpId]);
        await client.query(`INSERT INTO payroll.wecom_members(corp_id,userid,name,department_ids,position,active,observed_at)
          SELECT $1,m->>'userid',m->>'name',m->'departmentIds',m->>'position',true,$3
          FROM jsonb_array_elements($2::jsonb) m
          ON CONFLICT(corp_id,userid) DO UPDATE SET name=EXCLUDED.name,department_ids=EXCLUDED.department_ids,
            position=EXCLUDED.position,active=true,observed_at=EXCLUDED.observed_at`,
          [corpId, JSON.stringify(collected.members), syncedAt]);
        if (events.length) await client.query(`INSERT INTO payroll.wecom_events
            (corp_id,userid,event_type,previous_synced_at,current_synced_at,detected_at,before_value,after_value,reason)
          SELECT $1,e->>'userid',e->>'type',$3,$4,$4,e->'before',e->'after',e->>'reason'
          FROM jsonb_array_elements($2::jsonb) e`, [corpId, JSON.stringify(events), previousSync.synced_at, syncedAt]);
        await client.query(`INSERT INTO payroll.wecom_directory_syncs(corp_id,synced_at,department_count,member_count)
          VALUES($1,$2,$3,$4) ON CONFLICT(corp_id) DO UPDATE SET synced_at=EXCLUDED.synced_at,
            department_count=EXCLUDED.department_count,member_count=EXCLUDED.member_count`,
          [corpId, syncedAt, collected.departments.length, collected.members.length]);
        return { syncedAt: iso(syncedAt), departmentCount: collected.departments.length,
          memberCount: collected.members.length, eventCount: events.length };
      });
      lastError = null;
      return result;
    })().catch(error => {
      lastError = error instanceof PersonnelError ? error.message : '企微通讯录快照保存失败';
      throw error;
    }).finally(() => { syncPromise = null; });
    return syncPromise;
  }

  async function snapshot() {
    const [status, departmentsResult, membersResult] = await Promise.all([
      pool.query('SELECT synced_at,department_count,member_count FROM payroll.wecom_directory_syncs WHERE corp_id=$1', [corpId]),
      pool.query(`SELECT department_id AS id,name,parent_id AS "parentId",display_order AS "order",leader_userid AS "leaderUserid"
        FROM payroll.wecom_departments WHERE corp_id=$1 AND active=true ORDER BY parent_id,display_order DESC,department_id`, [corpId]),
      pool.query(`SELECT m.userid,m.name,m.department_ids AS "departmentIds",m.position,l.employee_id AS "employeeId"
        FROM payroll.wecom_members m LEFT JOIN payroll.wecom_employee_links l ON l.corp_id=m.corp_id AND l.userid=m.userid
        WHERE m.corp_id=$1 AND m.active=true ORDER BY m.name,m.userid`, [corpId]),
    ]);
    const saved = status.rows[0], syncedAt = iso(saved?.synced_at);
    return { configured: true, syncedAt, fresh: Boolean(syncedAt && now() - Date.parse(syncedAt) <= (syncIntervalSeconds + 900) * 1000),
      departmentCount: saved?.department_count || 0, memberCount: saved?.member_count || 0,
      syncing: Boolean(syncPromise), lastError, departments: departmentsResult.rows, members: membersResult.rows };
  }

  async function listEvents({ from, to, userid, limit = 500 } = {}) {
    if (typeof limit === 'string' && /^\d+$/.test(limit)) limit = Number(limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) fail('异动分页参数无效');
    const lower = dateBoundary(from), upper = dateBoundary(to, true);
    if (lower && upper && lower >= upper) fail('结束时间必须晚于开始时间');
    const rows = (await pool.query(`SELECT id,userid,event_type AS type,detected_at AS "detectedAt",
      previous_synced_at AS "previousSyncedAt",current_synced_at AS "currentSyncedAt",
      before_value AS before,after_value AS after,reason
      FROM payroll.wecom_events WHERE corp_id=$1 AND ($2::timestamptz IS NULL OR detected_at >= $2)
        AND ($3::timestamptz IS NULL OR detected_at < $3) AND ($4::text IS NULL OR userid=$4)
      ORDER BY detected_at DESC,id DESC LIMIT $5`, [corpId, lower, upper, userid || null, limit])).rows;
    const directoryEvents = rows.map(row => ({ ...row, label: EVENT_LABELS[row.type] || row.type,
      source: '企业微信通讯录相邻成功快照', eventAt: iso(row.detectedAt),
      detectedAt: iso(row.detectedAt), previousSyncedAt: iso(row.previousSyncedAt), currentSyncedAt: iso(row.currentSyncedAt) }));
    // A regularization date is supplied by a roster, not by WeCom. Expose it as
    // dated evidence only after a human-confirmed identity link, and deduplicate
    // repeated monthly copies of the same employee/date.
    const recorded = (await pool.query(`SELECT DISTINCT ON (r.employee_id,r.regularization_on)
        r.id,r.wecom_userid AS userid,r.employee_id,r.regularization_on,p.imported_at,
        p.source_name,p.sheet_name,r.row_number
      FROM payroll.personnel_roster_rows r JOIN payroll.personnel_rosters p ON p.id=r.roster_id
      JOIN payroll.wecom_employee_links l ON l.corp_id=p.corp_id AND l.userid=r.wecom_userid AND l.employee_id=r.employee_id
      WHERE p.corp_id=$1 AND r.employee_id IS NOT NULL AND r.regularization_on IS NOT NULL
        AND ($2::date IS NULL OR r.regularization_on >= $2)
        AND ($3::date IS NULL OR r.regularization_on < $3)
        AND ($4::text IS NULL OR r.wecom_userid=$4)
      ORDER BY r.employee_id,r.regularization_on,p.imported_at,r.id`,
    [corpId, lower?.slice(0, 10) || null, upper?.slice(0, 10) || null, userid || null])).rows;
    const rosterEvents = recorded.map(row => ({ id: `roster:${row.id}`, userid: row.userid,
      type: 'regularization_recorded', label: '转正日期（花名册记载）',
      eventAt: `${row.regularization_on}T00:00:00.000Z`, effectiveOn: row.regularization_on,
      detectedAt: iso(row.imported_at), previousSyncedAt: null, currentSyncedAt: null,
      before: {}, after: { regularizationDate: row.regularization_on },
      reason: '花名册记载了转正日期（可能为计划日期）；企业微信不提供转正事件，须结合计薪月工资条核对。',
      source: '花名册', sourceDetail: { fileName: row.source_name, sheetName: row.sheet_name, rowNumber: row.row_number } }));
    return [...directoryEvents, ...rosterEvents].sort((a, b) => b.eventAt.localeCompare(a.eventAt) || String(b.id).localeCompare(String(a.id))).slice(0, limit);
  }

  async function mutate(operation, input, body) {
    const { actorId, requestKey } = input;
    uuid(actorId, '操作人');
    shortText(requestKey, '请求标识', 200, true);
    const payloadHash = digest(input);
    return withTransaction(pool, async client => {
      const actor = (await client.query('SELECT enabled FROM payroll.users WHERE id=$1', [actorId])).rows[0];
      if (!actor?.enabled) fail('请重新登录', 'PAYROLL_FORBIDDEN', 403);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`payroll-request:${requestKey}`]);
      const prior = (await client.query('SELECT operation,actor_id,payload_hash,result FROM payroll.requests WHERE request_key=$1', [requestKey])).rows[0];
      if (prior) {
        if (prior.operation !== operation || prior.actor_id !== actorId || prior.payload_hash !== payloadHash)
          fail('请求标识已用于其他内容', 'PAYROLL_IDEMPOTENCY_CONFLICT', 409);
        return prior.result;
      }
      const result = await body(client);
      await client.query('INSERT INTO payroll.requests(request_key,operation,actor_id,payload_hash,result) VALUES($1,$2,$3,$4,$5)',
        [requestKey, operation, actorId, payloadHash, JSON.stringify(result)]);
      return result;
    });
  }

  async function conflictsFor(client, rosterId) {
    const roster = (await client.query('SELECT * FROM payroll.personnel_rosters WHERE id=$1 AND corp_id=$2', [rosterId, corpId])).rows[0];
    if (!roster) fail('未找到该花名册', 'PAYROLL_NOT_FOUND', 404);
    // A checked-out pg Client may not execute concurrent queries (pg@9 rejects it).
    const rowsResult = await client.query('SELECT * FROM payroll.personnel_roster_rows WHERE roster_id=$1 ORDER BY row_number', [rosterId]);
    const membersResult = await client.query(`SELECT m.userid,m.name,m.department_ids,m.position,l.employee_id FROM payroll.wecom_members m
        LEFT JOIN payroll.wecom_employee_links l ON l.corp_id=m.corp_id AND l.userid=m.userid
        WHERE m.corp_id=$1 AND m.active=true`, [corpId]);
    const deptResult = await client.query('SELECT department_id,name FROM payroll.wecom_departments WHERE corp_id=$1 AND active=true', [corpId]);
    const syncResult = await client.query('SELECT synced_at FROM payroll.wecom_directory_syncs WHERE corp_id=$1', [corpId]);
    const members = membersResult.rows, byId = new Map(members.map(row => [row.userid, row]));
    const byName = new Map();
    for (const member of members) byName.set(member.name, [...(byName.get(member.name) || []), member.userid]);
    const departments = new Map(deptResult.rows.map(row => [row.department_id, row.name]));
    const conflicts = [];
    const observedAt = iso(syncResult.rows[0]?.synced_at);
    const source = row => ({ fileName: roster.source_name, sheetName: roster.sheet_name, rowNumber: row.row_number,
      month: roster.payroll_month ? String(roster.payroll_month).slice(0, 7) : null, fieldSources: row.field_sources,
      importedAt: iso(roster.imported_at) });
    const add = (row, field, rosterValue, wecomValue, reason, userid = null, candidates = []) => conflicts.push({
      id: `${row.id}:${field}`, rosterId, rosterRowId: row.id, rowNumber: row.row_number, userid,
      employeeId: row.employee_id, field, rosterValue, wecomValue, reason, candidates,
      rosterSource: source(row), wecomSource: '企业微信当前可见通讯录',
      rosterObservedAt: iso(roster.imported_at), wecomSyncedAt: observedAt,
    });
    for (const row of rowsResult.rows) {
      const candidate = row.wecom_userid && byId.get(row.wecom_userid);
      if (!row.employee_id || !row.wecom_userid) {
        const candidates = byName.get(row.name) || [];
        add(row, 'identity', row.name, candidates.length ? `${candidates.length} 位同名企微成员` : '未找到同名企微成员',
          '花名册行尚未由管理员关联到企微 UserID 和工资员工 ID；同名或工号不能证明为同一人。', null, candidates);
        continue;
      }
      if (!candidate) {
        add(row, 'visibility', row.name, null, '已关联企微成员不在当前应用可见通讯录内；可能离职、停用或可见范围变化，需核实。', row.wecom_userid);
        continue;
      }
      const userid = candidate.userid;
      if (candidate.employee_id !== row.employee_id) add(row, 'identity', row.employee_id, candidate.employee_id,
        '花名册行原确认的工资员工 ID 与当前企微身份关联不同；请管理员重新核对关联变更。', userid);
      if (row.name !== candidate.name) add(row, 'name', row.name, candidate.name, '已确认关联人员的姓名与当前企微姓名不同，请核对改名或花名册旧值。', userid);
      const deptNames = candidate.department_ids.map(id => departments.get(String(id)) || `部门${id}`);
      const rosterDept = row.third_department || row.subdepartment || row.department;
      if (rosterDept && !deptNames.includes(rosterDept)) add(row, 'department', rosterDept, deptNames.join('、'),
        '花名册部门与当前企微部门不同；花名册可能属于历史计薪月，请结合异动时间核对。', userid);
      if (row.position && candidate.position && row.position !== candidate.position)
        add(row, 'position', row.position, candidate.position, '花名册岗位与当前企微岗位不同，请核对变动时间。', userid);
      if (/离职|已离|left|terminated/i.test(row.employee_status || '') || (row.left_on && observedAt && row.left_on <= observedAt.slice(0, 10)))
        add(row, 'status', row.employee_status || `离职日期 ${row.left_on}`,
        '当前企微可见', '花名册标识离职，但人员仍在当前企微可见通讯录；可能复职、历史月份或资料未更新。', userid);
    }
    return conflicts;
  }

  async function importRoster({ actorId, requestKey, source, rows } = {}) {
    if (!object(source) || !Array.isArray(rows) || rows.length < 1 || rows.length > 20000) fail('花名册来源或行数无效');
    const cleanSource = { fileName: shortText(source.fileName ?? source.filename, '文件名', 300, true),
      sheetName: shortText(source.sheetName, '工作表', 200, true), month: monthDate(source.month),
      sha256: source.sha256 == null ? null : shortText(source.sha256, '文件摘要', 64) };
    if (cleanSource.sha256 && !/^[0-9a-f]{64}$/.test(cleanSource.sha256)) fail('文件摘要格式无效');
    const cleanRows = rows.map(normalizedRosterRow);
    if (new Set(cleanRows.map(row => row.rowNumber)).size !== cleanRows.length) fail('花名册行号重复');
    return mutate('personnel.roster.import', { actorId, requestKey, source: cleanSource, rows: cleanRows }, async client => {
      const roster = (await client.query(`INSERT INTO payroll.personnel_rosters
        (corp_id,source_name,sheet_name,payroll_month,source_hash,imported_by,row_count)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,imported_at`,
      [corpId, cleanSource.fileName, cleanSource.sheetName, cleanSource.month, cleanSource.sha256, actorId, cleanRows.length])).rows[0];
      const created = [];
      for (const row of cleanRows) {
        const result = await client.query(`INSERT INTO payroll.personnel_roster_rows
          (roster_id,row_number,name,employee_number,company,department,subdepartment,third_department,position,
            employee_type,employee_status,joined_on,regularization_on,left_on,field_sources)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id,row_number`,
        [roster.id, row.rowNumber, row.name, row.employeeNumber, row.company, row.department, row.subdepartment,
          row.thirdDepartment, row.position, row.employeeType, row.employeeStatus, row.joinedOn, row.regularizationOn, row.leftOn,
          JSON.stringify(row.fieldSources)]);
        created.push({ id: result.rows[0].id, rowNumber: result.rows[0].row_number });
      }
      const conflictCount = (await conflictsFor(client, roster.id)).length;
      await client.query(`INSERT INTO payroll.audit_events(actor_id,action,entity_type,entity_id,details)
        VALUES($1,'personnel.roster.import','personnel_roster',$2,$3)`, [actorId, roster.id,
        JSON.stringify({ rowCount: cleanRows.length, sourceName: cleanSource.fileName })]);
      return { rosterId: roster.id, rowCount: cleanRows.length, conflictCount,
        importedAt: iso(roster.imported_at), rows: created };
    });
  }

  async function listConflicts({ rosterId } = {}) {
    if (!rosterId) {
      rosterId = (await pool.query('SELECT id FROM payroll.personnel_rosters WHERE corp_id=$1 ORDER BY imported_at DESC,id DESC LIMIT 1', [corpId])).rows[0]?.id;
      if (!rosterId) return [];
    }
    uuid(rosterId, '花名册 ID');
    return conflictsFor(pool, rosterId);
  }

  async function link({ actorId, requestKey, userid, employeeId, createNew = false, reason, rosterRowId } = {}) {
    userid = shortText(userid, '企微 UserID', 200, true);
    reason = shortText(reason, '关联原因', 1000, true);
    if (createNew && employeeId) fail('新建员工时不能同时指定员工 ID');
    if (!createNew && !employeeId) fail('请选择工资员工或明确新建员工');
    if (employeeId) uuid(employeeId, '工资员工 ID');
    if (rosterRowId) uuid(rosterRowId, '花名册行 ID');
    return mutate('personnel.identity.link', { actorId, requestKey, userid, employeeId: employeeId || null,
      createNew: Boolean(createNew), reason, rosterRowId: rosterRowId || null }, async client => {
      const member = (await client.query('SELECT userid,name FROM payroll.wecom_members WHERE corp_id=$1 AND userid=$2', [corpId, userid])).rows[0];
      if (!member) fail('企微通讯录中未找到该成员', 'PAYROLL_NOT_FOUND', 404);
      let createdEmployee = false;
      if (createNew) {
        const employee = (await client.query('INSERT INTO payroll.employees(name,created_by) VALUES($1,$2) RETURNING id', [member.name, actorId])).rows[0];
        employeeId = employee.id;
        createdEmployee = true;
        await client.query(`INSERT INTO payroll.audit_events(actor_id,action,entity_type,entity_id,details)
          VALUES($1,'employee.create.from_wecom','employee',$2,$3)`, [actorId, employeeId,
          JSON.stringify({ corpId, userid, reason })]);
      } else {
        const employee = (await client.query('SELECT id FROM payroll.employees WHERE id=$1', [employeeId])).rows[0];
        if (!employee) fail('工资员工不存在，请选择已有员工或明确新建', 'PAYROLL_NOT_FOUND', 404);
      }
      const prior = (await client.query('SELECT employee_id FROM payroll.wecom_employee_links WHERE corp_id=$1 AND userid=$2 FOR UPDATE', [corpId, userid])).rows[0];
      if (createNew && prior) fail('该企微成员已关联工资员工；不能再次新建员工', 'PAYROLL_CONFLICT', 409);
      const other = (await client.query('SELECT userid FROM payroll.wecom_employee_links WHERE employee_id=$1 AND (corp_id<>$2 OR userid<>$3)', [employeeId, corpId, userid])).rows[0];
      if (other) fail('该工资员工已关联其他企微成员，请先核对身份', 'PAYROLL_CONFLICT', 409);
      await client.query(`INSERT INTO payroll.wecom_employee_links(corp_id,userid,employee_id,reason,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT(corp_id,userid) DO UPDATE SET
        employee_id=EXCLUDED.employee_id,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp()`,
      [corpId, userid, employeeId, reason, actorId]);
      let linkedRow = null;
      if (rosterRowId) {
        const row = (await client.query(`SELECT r.id,r.employee_id,r.wecom_userid FROM payroll.personnel_roster_rows r
          JOIN payroll.personnel_rosters p ON p.id=r.roster_id WHERE r.id=$1 AND p.corp_id=$2 FOR UPDATE`, [rosterRowId, corpId])).rows[0];
        if (!row) fail('花名册行不存在', 'PAYROLL_NOT_FOUND', 404);
        await client.query(`UPDATE payroll.personnel_roster_rows SET employee_id=$2,wecom_userid=$3,linked_by=$4,linked_at=clock_timestamp()
          WHERE id=$1`, [rosterRowId, employeeId, userid, actorId]);
        linkedRow = rosterRowId;
      }
      await client.query(`INSERT INTO payroll.audit_events(actor_id,action,entity_type,entity_id,details)
        VALUES($1,'personnel.identity.link','employee',$2,$3)`, [actorId, employeeId,
        JSON.stringify({ corpId, userid, previousEmployeeId: prior?.employee_id || null, rosterRowId: linkedRow, reason })]);
      return { userid, employeeId, created: !prior, createdEmployee, rosterRowId: linkedRow };
    });
  }

  return { snapshot, sync, listEvents, importRoster, listConflicts, link, syncing: () => Boolean(syncPromise) };
}
