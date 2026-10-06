import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openTestDatabase } from './helpers/payroll-postgres.mjs';
import { bootstrapAdmin } from '../database/payroll/repository.mjs';
import { createPersonnelService } from '../server/payroll/personnel-service.mjs';
import { provisionRuntimeRole, grantExistingApiRole } from '../database/payroll/admin.mjs';
import { createPool } from '../database/payroll/pool.mjs';

let database, pool, admin, stage = 'baseline';
const corpId = 'ww-test-only';
function fakeWeCom(input) {
  const url = new URL(String(input));
  let body;
  if (url.pathname.endsWith('/gettoken')) body = { errcode: 0, access_token: 'test-token', expires_in: 7200 };
  else if (url.pathname.endsWith('/department/list')) body = { errcode: 0, department: [
    { id: 1, name: '公司', parentid: 0, order: 0 },
    { id: 2, name: '财务部', parentid: 1, order: 1 },
    { id: 3, name: '运营部', parentid: 1, order: 2 },
  ] };
  else if (url.pathname.endsWith('/user/list_id')) body = { errcode: 0,
    dept_user: (stage === 'baseline' ? ['alice', 'bob'] : ['alice', 'charlie']).map(userid => ({ userid })), next_cursor: '' };
  else if (url.pathname.endsWith('/user/get')) {
    const userid = url.searchParams.get('userid');
    if (stage === 'failure') throw new Error('Temporary upstream outage');
    body = { errcode: 0, userid, status: 1,
      name: { alice: '甲', bob: '乙', charlie: '丙' }[userid],
      department: [userid === 'alice' && stage !== 'baseline' ? 3 : 2], position: '职员' };
  } else throw new Error(`Unexpected WeCom endpoint: ${url.pathname}`);
  return Promise.resolve({ ok: true, json: async () => body });
}
let service;
before(async () => {
  database = await openTestDatabase(); pool = database.pool;
  admin = await bootstrapAdmin(pool, { username: 'personnel_admin', displayName: '测试管理员', password: 'Fictitious-personnel-test-password' });
  service = createPersonnelService({ pool, corpId, appSecret: 'private-test-secret', fetchImpl: fakeWeCom });
}, { timeout: 60000 });
after(async () => { if (database) await database.close(); });

test('first successful sync is a baseline; changes are append-only observations', async () => {
  const first = await service.sync();
  assert.equal(first.departmentCount, 3);
  assert.equal(first.memberCount, 2);
  assert.equal(first.eventCount, 0);
  assert.equal((await service.listEvents()).length, 0);
  let snap = await service.snapshot();
  assert.equal(snap.configured, true);
  assert.deepEqual(snap.departments.map(item => item.id), ['1', '3', '2'], 'larger WeCom order comes first');
  assert.deepEqual(snap.members.map(item => item.userid).sort(), ['alice', 'bob']);

  stage = 'changed';
  const second = await service.sync();
  assert.equal(second.eventCount, 3);
  const events = await service.listEvents();
  assert.deepEqual(events.map(event => event.type).sort(), ['department_changed', 'joined_visible', 'no_longer_visible']);
  assert.match(events.find(event => event.type === 'no_longer_visible').reason, /不能直接认定离职/);
  assert.ok(events.every(event => event.previousSyncedAt && event.currentSyncedAt && event.detectedAt));
  snap = await service.snapshot();
  assert.deepEqual(snap.members.map(item => item.userid).sort(), ['alice', 'charlie']);
  assert.equal(snap.members.find(item => item.userid === 'alice').departmentIds[0], '3');

  const repeat = await service.sync();
  assert.equal(repeat.eventCount, 0);
  assert.equal((await service.listEvents()).length, 3);

  stage = 'failure';
  await assert.rejects(service.sync(), /连接失败/);
  assert.equal((await service.snapshot()).members.length, 2, 'failed sync retains the last complete snapshot');
  assert.equal((await service.listEvents()).length, 3);
  stage = 'changed';
});

test('roster only retains whitelisted fields, warns on unverified identity, and compares after explicit link', async () => {
  const input = { actorId: admin.id, requestKey: randomUUID(), source: { fileName: '测试花名册.xlsx', sheetName: '在职', month: '2026-08' },
    rows: [{ rowNumber: 2, name: '甲', employeeNumber: 'A01', department: '总部', subdepartment: '人事部', thirdDepartment: '财务部',
      position: '职员', employeeStatus: '离职', regularizationOn: '2026-08-15', bankAccount: 'MUST_NOT_PERSIST',
      fieldSources: { name: '姓名', thirdDepartment: '三级部门', bankAccount: '银行卡号' } }] };
  const imported = await service.importRoster(input);
  assert.equal(imported.rowCount, 1);
  assert.equal(imported.conflictCount, 1);
  assert.equal(imported.rows[0].rowNumber, 2);
  assert.deepEqual(await service.importRoster(input), imported, 'same request key is idempotent');
  let conflicts = await service.listConflicts({ rosterId: imported.rosterId });
  assert.equal(conflicts[0].field, 'identity');
  assert.match(conflicts[0].reason, /不能证明为同一人/);
  assert.equal(conflicts[0].rosterRowId, imported.rows[0].id);
  const raw = (await pool.query('SELECT to_jsonb(r)::text AS payload FROM payroll.personnel_roster_rows r WHERE id=$1', [imported.rows[0].id])).rows[0].payload;
  assert.ok(!raw.includes('MUST_NOT_PERSIST'));
  assert.ok(!raw.includes('银行卡号'));

  const linked = await service.link({ actorId: admin.id, requestKey: randomUUID(), userid: 'alice',
    createNew: true, rosterRowId: imported.rows[0].id, reason: '管理员核对工资和企微身份一致' });
  assert.equal(linked.createdEmployee, true);
  assert.equal(linked.rosterRowId, imported.rows[0].id);
  const snap = await service.snapshot();
  assert.equal(snap.members.find(member => member.userid === 'alice').employeeId, linked.employeeId);
  conflicts = await service.listConflicts({ rosterId: imported.rosterId });
  assert.deepEqual(conflicts.map(item => item.field).sort(), ['department', 'status']);
  assert.ok(conflicts.every(item => item.userid === 'alice' && item.wecomSyncedAt && item.rosterSource.month === '2026-08'));
  const regularization = await service.listEvents({ from: '2026-08', to: '2026-08', userid: 'alice' });
  assert.equal(regularization.length, 1);
  assert.equal(regularization[0].type, 'regularization_recorded');
  assert.equal(regularization[0].effectiveOn, '2026-08-15');
  assert.match(regularization[0].reason, /花名册/);
  await assert.rejects(service.link({ actorId: admin.id, requestKey: randomUUID(), userid: 'charlie', employeeId: linked.employeeId,
    reason: '误关联防护验证' }), /已关联其他企微成员/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM payroll.employees')).rows[0].n, 1);
});

test('restricted runtime role can sync/link but cannot erase events or roster history', async () => {
  const role = 'personnel_api_' + randomUUID().replaceAll('-', '').slice(0, 12);
  await provisionRuntimeRole(pool, { role, password: 'only-for-personnel-runtime-role-tests' });
  await grantExistingApiRole(pool, { role });
  const runtime = createPool({ ...database.connectionOptions, user: role, password: 'only-for-personnel-runtime-role-tests' });
  try {
    const restricted = createPersonnelService({ pool: runtime, corpId, appSecret: 'private-test-secret', fetchImpl: fakeWeCom });
    assert.equal((await restricted.snapshot()).memberCount, 2);
    assert.equal((await restricted.sync()).eventCount, 0);
    await assert.rejects(runtime.query('DELETE FROM payroll.wecom_events'), /permission denied/);
    await assert.rejects(runtime.query('DELETE FROM payroll.personnel_rosters'), /permission denied/);
  } finally { await runtime.end(); }
});
