import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalPersonnelRoute } from '../server/payroll/vite-middleware.mjs';

async function request(route, path, { method = 'GET', headers = {} } = {}) {
  const req = { url: path, method, headers: { host: '127.0.0.1:3220', ...headers } };
  const res = {
    writeHead(status, responseHeaders) { this.status = status; this.headers = responseHeaders; },
    end(body) { this.body = JSON.parse(body); },
  };
  const handled = await route(req, res);
  return { handled, ...res };
}

test('3220 directory is readable without administrator login and does not fabricate members', async () => {
  const result = await request(createLocalPersonnelRoute(null), '/api/payroll/personnel/directory');
  assert.equal(result.status, 200);
  assert.equal(result.body.data.configured, false);
  assert.deepEqual(result.body.data.members, []);
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

test('3220 administrator login is disabled while other payroll routes remain protected', async () => {
  const route = createLocalPersonnelRoute(null);
  const login = await request(route, '/api/payroll/login', { method: 'POST' });
  assert.equal(login.status, 410);
  assert.equal((await request(route, '/api/payroll/workspaces')).handled, false);
});

test('directory sync requires same-origin local request and configured service', async () => {
  let synced = 0;
  const route = createLocalPersonnelRoute({
    snapshot: async () => ({ configured: true, members: [{ userid: 'a', name: '甲' }] }),
    listEvents: async () => [],
    sync: async () => { synced++; return { memberCount: 1 }; },
  });
  const missingOrigin = await request(route, '/api/payroll/personnel/directory/sync', { method: 'POST' });
  assert.equal(missingOrigin.status, 403);
  const allowed = await request(route, '/api/payroll/personnel/directory/sync', {
    method: 'POST', headers: { origin: 'http://127.0.0.1:3220', 'x-suyu-local': '1' },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.data.memberCount, 1);
  assert.equal(synced, 1);
  const crossSite = await request(route, '/api/payroll/personnel/directory', {
    headers: { host: 'evil.example', origin: 'https://evil.example' },
  });
  assert.equal(crossSite.status, 403);
});
