import test from 'node:test';
import assert from 'node:assert/strict';
import {authFailureResponse} from '../server/access/auth-errors.mjs';
test('callback failures show UTF-8 Chinese recovery page, escape messages, and preserve denied status',async()=>{
 const response=authFailureResponse(new Request('https://finance.example.invalid/api/auth/callback'),{status:403,code:'ACCESS_DENIED',message:'登录校验已失效<script>alert(1)</script>'});
 assert.equal(response.status,403);
 assert.equal(response.headers.get('content-type'),'text/html; charset=utf-8');
 const html=await response.text();
 assert.match(html,/meta charset="utf-8"/);
 assert.match(html,/登录校验已失效&lt;script&gt;/);
 assert.match(html,/href="\/api\/auth\/login"/);
 assert.equal(html.includes('<script>'),false);
});
test('API errors declare UTF-8; internal diagnostics are not sent to users',async()=>{
 const response=authFailureResponse(new Request('https://finance.example.invalid/api/auth/session'),new Error('private internal data'));
 assert.equal(response.status,503);
 assert.equal(response.headers.get('content-type'),'application/json; charset=utf-8');
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal((await response.text()).includes('private internal data'),false);
});
