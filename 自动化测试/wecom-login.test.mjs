import test from 'node:test';
import assert from 'node:assert/strict';
import { wecomLoginURL, wecomMemberId } from '../server/access/wecom-login.mjs';
import { configured } from '../server/access/session.mjs';

const settings = { corpId: 'wwTestCompany', agentId: '1000001', origin: 'https://finance.example.invalid', state: 'unique-csrf-state' };
test('official lowercase userid resolves members and rejects nonmembers or conflicting identities', () => {
  assert.equal(wecomMemberId({ userid: 'member.1' }), 'member.1');
  assert.equal(wecomMemberId({ UserId: 'member.1' }), 'member.1');
  for (const identity of [{ openid: 'external' }, {}, { userid: 'a', UserId: 'b' }, { userid: 'othercorp/user' }, { userid: '' }]) {
    assert.equal(wecomMemberId(identity), null);
  }
});
test('desktop and ordinary WeChat browsers use corporate Web login, not embedded OAuth', () => {
  for (const userAgent of ['Mozilla/5.0 Safari/605.1.15', 'Mozilla/5.0 Chrome/130.0', 'MicroMessenger/8.0']) {
    const url = wecomLoginURL({ ...settings, userAgent });
    assert.equal(url.origin + url.pathname, 'https://login.work.weixin.qq.com/wwlogin/sso/login');
    assert.equal(url.searchParams.get('login_type'), 'CorpApp');
    assert.equal(url.searchParams.get('agentid'), settings.agentId);
    assert.equal(url.searchParams.get('appid'), settings.corpId);
    assert.equal(url.searchParams.get('redirect_uri'), settings.origin + '/api/auth/callback');
    assert.equal(url.searchParams.get('state'), settings.state);
    assert.equal(url.searchParams.has('scope'), false);
  }
});
test('enterprise WeChat Webview continues to use embedded OAuth with the same callback and state', () => {
  const url = wecomLoginURL({ ...settings, userAgent: 'MicroMessenger/8.0 wxwork/4.1.36' });
  assert.equal(url.origin + url.pathname, 'https://open.weixin.qq.com/connect/oauth2/authorize');
  assert.equal(url.searchParams.get('scope'), 'snsapi_base');
  assert.equal(url.searchParams.get('agentid'), settings.agentId);
  assert.equal(url.searchParams.get('redirect_uri'), settings.origin + '/api/auth/callback');
  assert.equal(url.searchParams.get('state'), settings.state);
  assert.equal(url.hash, '#wechat_redirect');
});
test('missing or invalid application ID cannot enable production login', () => {
  const values = { NODE_ENV: 'production', RD_DATABASE_URL: 'postgresql://example.invalid/test', WECOM_CORP_ID: settings.corpId, WECOM_APP_SECRET_FILE: '/test/secret', WECOM_MANAGER_TAG_ID: '1', WECOM_FINANCE_DEPARTMENT_ID: '2', SUYU_PUBLIC_ORIGIN: settings.origin, WECOM_AGENT_ID: settings.agentId };
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    assert.equal(configured(), true);
    for (const value of ['', '0', '-1', 'not-an-id', '1.5']) {
      process.env.WECOM_AGENT_ID = value;
      assert.equal(configured(), false);
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
