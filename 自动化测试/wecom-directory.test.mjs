import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWeComDirectory } from '../server/payroll/wecom-directory.mjs';

test('WeCom directory reads a restricted scope and saves one complete snapshot', async () => {
  const statements = [];
  let inactive = false;
  let tokenRequests = 0;
  const pool = {
    query: async () => ({ rows: [] }),
    connect: async () => ({
      query: async (sql, values = []) => { statements.push({ sql, values }); return { rows: [] }; },
      release() {},
    }),
  };
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    let body;
    if (url.pathname.endsWith('/gettoken')) {
      tokenRequests++;
      body = { errcode: 0, access_token: 'test-access-token', expires_in: 7200 };
    } else if (url.pathname.endsWith('/department/simplelist')) {
      body = { errcode: 0, department_id: [{ id: 2, parentid: 1 }] };
    } else if (url.pathname.endsWith('/department/get')) {
      body = { errcode: 0, department: { id: 2, name: '财务部', parentid: 1, department_leader: ['manager'] } };
    } else if (url.pathname.endsWith('/user/list_id')) {
      assert.equal(JSON.parse(options.body).limit, 10000);
      body = { errcode: 48002 };
    } else if (url.pathname.endsWith('/user/list')) {
      body = url.searchParams.get('department_id') === '1'
        ? { errcode: 60011 }
        : { errcode: 0, userlist: [{ userid: 'alice' }] };
    } else if (url.pathname.endsWith('/user/get')) {
      body = { errcode: 0, userid: 'alice', name: '甲', status: inactive ? 4 : 1, department: [2], direct_leader: ['manager'], position: '会计' };
    } else throw new Error(`Unexpected WeCom endpoint ${url.pathname}`);
    return { ok: true, json: async () => body };
  };
  const service = createWeComDirectory({ pool, corpId: 'ww-test', appSecret: 'private-test-secret', fetchImpl });
  assert.deepEqual(await service.sync(), { departmentCount: 2, memberCount: 1 });
  assert.equal(tokenRequests, 1);
  assert.equal(statements.at(-1).sql, 'COMMIT');
  assert.ok(statements.some(item => item.sql.includes('INSERT INTO payroll.wecom_members')));
  assert.ok(statements.every(item => !item.sql.includes('payroll.employees')));

  const savedStatementCount = statements.length;
  inactive = true;
  await assert.rejects(service.sync(), /没有可用的在职成员/);
  assert.equal(statements.length, savedStatementCount, 'an incomplete directory never changes the previous snapshot');
});

test('member enumeration still works when department list is outside application scope', async () => {
  const saved = [];
  const pool = {
    query: async () => ({ rows: [] }),
    connect: async () => ({ query: async (sql, values = []) => { saved.push({ sql, values }); return { rows: [] }; }, release() {} }),
  };
  const fetchImpl = async input => {
    const url = new URL(String(input));
    let body;
    if (url.pathname.endsWith('/gettoken')) body = { errcode: 0, access_token: 'test-token', expires_in: 7200 };
    else if (url.pathname.endsWith('/department/simplelist') || url.pathname.endsWith('/department/list') || url.pathname.endsWith('/department/get')) body = { errcode: 60011 };
    else if (url.pathname.endsWith('/user/list_id')) body = { errcode: 0, dept_user: [{ userid: 'alice' }], next_cursor: '' };
    else if (url.pathname.endsWith('/user/get')) body = { errcode: 0, userid: 'alice', name: '甲', status: 1, department: [9] };
    else throw new Error(`Unexpected endpoint ${url.pathname}`);
    return { ok: true, json: async () => body };
  };
  const service = createWeComDirectory({ pool, corpId: 'ww-test', appSecret: 'private-test-secret', fetchImpl });
  assert.deepEqual(await service.sync(), { departmentCount: 2, memberCount: 1 });
  const departments = saved.find(item => item.sql.includes('INSERT INTO payroll.wecom_departments'));
  assert.ok(departments);
  assert.match(departments.values[1], /部门9/);
});
