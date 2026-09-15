import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { bootstrapAdmin } from '../database/payroll/repository.mjs';
import { migrate } from '../database/payroll/migrate.mjs';
import { createAuthService } from '../server/payroll/auth.mjs';
import { openTestDatabase } from './helpers/payroll-postgres.mjs';

const PASSWORD = 'Only-for-isolated-auth-tests-2026';
const USERNAME = 'payroll_admin';
const ADDRESS = '192.0.2.10';
const START = Date.parse('2026-09-15T00:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const WINDOW = 15 * 60 * 1000;
const sha256 = value => createHash('sha256').update(value).digest('hex');
let database, pool, admin, auth, time;
const now = () => time;
const credentials = (extra = {}) => ({ username: USERNAME, password: PASSWORD, clientAddress: ADDRESS, ...extra });
const failed = (service = auth, extra = {}) => service.login(credentials({ password: 'incorrect-password', ...extra }));

before(async () => {
  database = await openTestDatabase();
  pool = database.pool;
  admin = await bootstrapAdmin(pool, { username: USERNAME, displayName: '虚拟认证测试管理员', password: PASSWORD });
}, { timeout: 60_000 });

after(async () => { if (database) await database.close(); });

beforeEach(async () => {
  await pool.query('DELETE FROM payroll.auth_sessions');
  await pool.query('DELETE FROM payroll.auth_login_limits');
  await pool.query('UPDATE payroll.users SET enabled=true WHERE id=$1', [admin.id]);
  time = START;
  auth = createAuthService(pool, { now });
});

async function authError(promise, code = 'PAYROLL_AUTH_FAILED') {
  try { await promise; }
  catch (error) {
    assert.equal(error.code, code);
    assert.ok(!error.message.includes(PASSWORD));
    return { code: error.code, message: error.message };
  }
  assert.fail('Expected authentication to fail');
}

test('auth migration is repeatable and initializes no demo users or payroll data', async () => {
  assert.deepEqual((await migrate(pool)).applied, []);
  const users = await pool.query('SELECT username FROM payroll.users');
  assert.deepEqual(users.rows, [{ username: USERNAME }]);
  for (const table of ['employees', 'batches', 'auth_sessions', 'auth_login_limits']) {
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM payroll.${table}`)).rows[0].n, 0);
  }
});

test('login returns independent 256-bit secrets, a public user and fixed eight-hour expiry', async () => {
  const session = await auth.login(credentials());
  assert.deepEqual(Object.keys(session).sort(), ['csrfToken', 'expiresAt', 'token', 'user']);
  assert.equal(Buffer.from(session.token, 'base64url').length, 32);
  assert.equal(Buffer.from(session.csrfToken, 'base64url').length, 32);
  assert.notEqual(session.token, session.csrfToken);
  assert.deepEqual(session.user, { id: admin.id, username: USERNAME, displayName: '虚拟认证测试管理员' });
  assert.equal(session.expiresAt, new Date(START + 8 * HOUR).toISOString());
  const stored = (await pool.query('SELECT * FROM payroll.auth_sessions')).rows;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].token_hash, sha256(session.token));
  assert.equal(stored[0].csrf_token, session.csrfToken);
  assert.ok(!JSON.stringify(stored).includes(session.token), 'Never store the bearer token');
  assert.ok(!JSON.stringify(stored).includes(PASSWORD), 'Never store a login password');
  assert.deepEqual(await auth.authenticate(session.token), {
    user: session.user, csrfToken: session.csrfToken, expiresAt: session.expiresAt,
  });
});

test('sessions and CSRF tokens survive another service instance and remain independent', async () => {
  const first = await auth.login(credentials());
  const another = createAuthService(pool, { now: () => new Date(time) });
  const second = await another.login(credentials());
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.csrfToken, second.csrfToken);
  assert.equal((await another.authenticate(first.token)).csrfToken, first.csrfToken);
  assert.equal((await auth.authenticate(second.token)).csrfToken, second.csrfToken);
});

test('unknown user, wrong password and disabled account expose the same error', async () => {
  const wrong = await authError(failed());
  const unknown = await authError(failed(auth, { username: 'no_such_account' }));
  await pool.query('UPDATE payroll.users SET enabled=false WHERE id=$1', [admin.id]);
  const disabled = await authError(auth.login(credentials()));
  assert.deepEqual(wrong, unknown);
  assert.deepEqual(wrong, disabled);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM payroll.auth_sessions')).rows[0].n, 0);
});

test('account failures persist, normalize whitespace/case/NFKC and cannot be bypassed by IP rotation', async () => {
  const names = ['payroll_admin', ' payroll_admin ', 'PAYROLL_ADMIN', 'ｐａｙｒｏｌｌ＿ａｄｍｉｎ', 'Payroll_Admin'];
  for (const [index, username] of names.entries()) {
    await authError(failed(createAuthService(pool, { now }), { username, clientAddress: `192.0.2.${index + 1}` }));
  }
  await authError(auth.login(credentials({ clientAddress: '198.51.100.1' })), 'PAYROLL_RATE_LIMIT');
  const accounts = (await pool.query("SELECT * FROM payroll.auth_login_limits WHERE kind='account'")).rows;
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].failures, 5);
  assert.equal(accounts[0].key_hash, sha256(`account:${USERNAME}`));
});

test('enumerating nonexistent usernames reaches the same IP budget and stores only hashed keys', async () => {
  for (let i = 0; i < 30; i++) await authError(failed(auth, { username: `missing_account_${i}` }));
  const missing = await authError(failed(auth, { username: 'one_more_missing_account' }), 'PAYROLL_RATE_LIMIT');
  const existing = await authError(auth.login(credentials()), 'PAYROLL_RATE_LIMIT');
  assert.deepEqual(missing, existing);
  const rows = (await pool.query('SELECT * FROM payroll.auth_login_limits')).rows;
  assert.equal(rows.length, 31);
  assert.equal(rows.find(row => row.kind === 'address').failures, 30);
  assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(row.key_hash)));
  assert.ok(!JSON.stringify(rows).includes(ADDRESS));
  assert.ok(!JSON.stringify(rows).includes('missing_account_'));
});

test('equivalent IPv4/mapped IPv6 and IPv6 spellings share budgets; invalid addresses share a fallback', async () => {
  const addresses = [
    '192.0.2.10', '::ffff:192.0.2.10', '0:0:0:0:0:ffff:c000:020a',
    '2001:db8::1', '2001:0DB8:0:0:0:0:0:0001',
    'not-an-ip', 'a-forged-forwarded-for-header', undefined,
  ];
  for (const [index, clientAddress] of addresses.entries()) {
    await authError(failed(auth, { username: `missing_ip_test_${index}`, clientAddress }));
  }
  const rows = (await pool.query("SELECT failures FROM payroll.auth_login_limits WHERE kind='address' ORDER BY failures")).rows;
  assert.deepEqual(rows.map(row => row.failures), [2, 3, 3]);
});

test('success clears account failures without resetting an IP failure budget', async () => {
  for (let i = 0; i < 4; i++) await authError(failed());
  await auth.login(credentials());
  const rows = (await pool.query('SELECT kind,failures FROM payroll.auth_login_limits')).rows;
  assert.deepEqual(rows, [{ kind: 'address', failures: 4 }]);
  for (let i = 0; i < 4; i++) await authError(failed());
  assert.equal((await pool.query("SELECT failures FROM payroll.auth_login_limits WHERE kind='account'")).rows[0].failures, 4);
});

test('failure windows reset at fifteen minutes and blocked retries cannot extend the window', async () => {
  for (let i = 0; i < 5; i++) await authError(failed());
  time = START + WINDOW - 1;
  await authError(failed(), 'PAYROLL_RATE_LIMIT');
  const expiry = (await pool.query("SELECT expires_at FROM payroll.auth_login_limits WHERE kind='account'")).rows[0].expires_at;
  assert.equal(new Date(expiry).getTime(), START + WINDOW);
  time++;
  await authError(failed());
  const rows = (await pool.query('SELECT failures,window_started_at FROM payroll.auth_login_limits')).rows;
  assert.ok(rows.every(row => row.failures === 1 && new Date(row.window_started_at).getTime() === time));
  assert.ok((await auth.login(credentials())).token);
});

test('authentication does not slide expiry and rejects/removes sessions exactly at expiry', async () => {
  const session = await auth.login(credentials());
  time = START + 8 * HOUR - 1;
  assert.equal((await auth.authenticate(session.token)).expiresAt, session.expiresAt);
  time++;
  assert.equal(await auth.authenticate(session.token), null);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM payroll.auth_sessions')).rows[0].n, 0);
});

test('disabling an account immediately prevents existing sessions from authenticating', async () => {
  const session = await auth.login(credentials());
  await pool.query('UPDATE payroll.users SET enabled=false WHERE id=$1', [admin.id]);
  assert.equal(await auth.authenticate(session.token), null);
  await authError(auth.login(credentials()));
});

test('logout revokes only the specified live session, is idempotent and works across instances', async () => {
  const first = await auth.login(credentials());
  const second = await auth.login(credentials());
  const another = createAuthService(pool, { now });
  await another.logout(first.token);
  await another.logout(first.token);
  assert.equal(await auth.authenticate(first.token), null);
  assert.equal((await auth.authenticate(second.token)).csrfToken, second.csrfToken);
});

test('malformed and oversized bearer tokens do not reach PostgreSQL', async () => {
  const service = createAuthService({ query() { assert.fail('Malformed token queried the database'); } });
  for (const token of [null, undefined, '', [], {}, 'a'.repeat(42), 'a'.repeat(1024 * 100), '='.repeat(43), 'b'.repeat(43)]) {
    assert.equal(await service.authenticate(token), null);
    assert.equal(await service.logout(token), undefined);
  }
});

test('invalid credential types and embedded NUL cannot expose SQL errors or create sessions', async () => {
  for (const extra of [
    { username: null }, { username: 'bad\u0000name' },
    { username: 'a'.repeat(257) }, { password: {} }, { password: 'a'.repeat(1025) },
  ]) await authError(auth.login(credentials(extra)));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM payroll.auth_sessions')).rows[0].n, 0);
});

test('concurrent failed attempts across instances cannot overspend an account budget', async () => {
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => failed(createAuthService(pool, { now }))));
  assert.equal(outcomes.filter(result => result.status === 'rejected' && result.reason.code === 'PAYROLL_AUTH_FAILED').length, 5);
  assert.equal(outcomes.filter(result => result.status === 'rejected' && result.reason.code === 'PAYROLL_RATE_LIMIT').length, 3);
  const rows = (await pool.query('SELECT failures FROM payroll.auth_login_limits')).rows;
  assert.deepEqual(rows.map(row => row.failures), [5, 5]);
});

test('active throttle storage is bounded without evicting limits, and expires to make room', async () => {
  await pool.query(`INSERT INTO payroll.auth_login_limits(kind,key_hash,failures,window_started_at,expires_at)
    SELECT 'account',md5(i::text)||md5(i::text),1,$1,$2 FROM generate_series(1,10000) i`,
  [new Date(time), new Date(time + WINDOW)]);
  await authError(failed(auth, { username: 'capacity_probe' }), 'PAYROLL_RATE_LIMIT');
  await authError(auth.login(credentials()), 'PAYROLL_RATE_LIMIT');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM payroll.auth_login_limits')).rows[0].n, 10_000);
  time += WINDOW;
  assert.ok((await auth.login(credentials())).token);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM payroll.auth_login_limits')).rows[0].n, 0);
});

test('successful logins keep at most twenty sessions and revoke the oldest', async () => {
  const first = await auth.login(credentials());
  let latest;
  for (let i = 0; i < 20; i++) {
    time++;
    latest = await auth.login(credentials());
  }
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM payroll.auth_sessions')).rows[0].n, 20);
  assert.equal(await auth.authenticate(first.token), null);
  assert.ok(await auth.authenticate(latest.token));
});

test('a failure after session insertion rolls back the whole login transaction', async () => {
  await authError(failed());
  const brokenPool = {
    async connect() {
      const client = await pool.connect();
      return {
        query(sql, args) {
          if (sql.startsWith("DELETE FROM payroll.auth_login_limits WHERE kind='account'")) {
            throw new Error('Injected database failure');
          }
          return client.query(sql, args);
        },
        release: error => client.release(error),
      };
    },
  };
  await assert.rejects(createAuthService(brokenPool, { now }).login(credentials()), /Injected database failure/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM payroll.auth_sessions')).rows[0].n, 0);
  assert.ok((await pool.query('SELECT failures FROM payroll.auth_login_limits')).rows.every(row => row.failures === 1));
});

test('SQL rejects malformed auth records and invalid lifetime/attempt counters', async () => {
  await assert.rejects(pool.query(`INSERT INTO payroll.auth_sessions(token_hash,user_id,csrf_token,created_at,expires_at)
    VALUES($1,$2,$3,$4,$5)`, ['a'.repeat(64), admin.id, 'a'.repeat(43), new Date(time), new Date(time + HOUR)]), { code: '23514' });
  await assert.rejects(pool.query(`INSERT INTO payroll.auth_login_limits(kind,key_hash,failures,window_started_at,expires_at)
    VALUES('account',$1,6,$2,$3)`, ['b'.repeat(64), new Date(time), new Date(time + WINDOW)]), { code: '23514' });
});

test('the documented minimum runtime grants support login/session/logout without user or payroll writes', async () => {
  const role = 'payroll_auth_test_' + randomUUID().replaceAll('-', '');
  await pool.query(`CREATE ROLE "${role}" NOLOGIN`);
  const client = await pool.connect();
  try {
    await pool.query(`GRANT USAGE ON SCHEMA payroll TO "${role}"`);
    await pool.query(`GRANT SELECT(id,username,display_name,password_hash,enabled) ON payroll.users TO "${role}"`);
    await pool.query(`GRANT SELECT,INSERT,DELETE ON payroll.auth_sessions,payroll.auth_login_limits TO "${role}"`);
    await pool.query(`GRANT UPDATE(failures) ON payroll.auth_login_limits TO "${role}"`);
    await client.query(`SET ROLE "${role}"`);
    const query = (sql, args) => client.query(sql, args);
    const runtime = createAuthService({ query, connect: async () => ({ query, release() {} }) }, { now });
    await authError(failed(runtime));
    await authError(failed(runtime));
    const session = await runtime.login(credentials());
    assert.equal((await runtime.authenticate(session.token)).user.id, admin.id);
    await runtime.logout(session.token);
    assert.equal(await runtime.authenticate(session.token), null);
    await assert.rejects(query('UPDATE payroll.users SET enabled=false WHERE false'), { code: '42501' });
    await assert.rejects(query('DELETE FROM payroll.batches WHERE false'), { code: '42501' });
    await assert.rejects(query('UPDATE payroll.auth_sessions SET expires_at=now() WHERE false'), { code: '42501' });
  } finally {
    await client.query('RESET ROLE'); client.release();
    await pool.query(`DROP OWNED BY "${role}"`);
    await pool.query(`DROP ROLE "${role}"`);
  }
});
