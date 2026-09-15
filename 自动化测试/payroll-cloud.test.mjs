import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import XLSX from 'xlsx';

const base = new URL('../public/salary/', import.meta.url);
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
const response = (data, status = 200) => ({ok:status >= 200 && status < 300, status, json:async () => ({ok:true, data:plain(data)})});
const failure = (status, message = '服务错误', code = 'FAIL') => ({ok:false, status, json:async () => ({ok:false, error:{code, message}})});

// Small asynchronous IndexedDB substitute: tests exercise the production persistence queue.
function storage(initial) {
  const store = {saved:initial && structuredClone(initial), fail:false, reads:0, writes:0, gate:null};
  store.indexedDB = {open() {
    const req = {};
    queueMicrotask(() => {
      if(store.fail) { req.error = new Error('本机磁盘不可用'); req.onerror?.(); return; }
      req.result = {close(){}, transaction() {
        const tx = {objectStore:() => ({
          get() {
            const read = {}; store.reads++;
            Promise.resolve(store.gate?.promise).then(() => { read.result = structuredClone(store.saved); read.onsuccess?.(); });
            return read;
          },
          put(value) { store.saved = structuredClone(value); store.writes++; queueMicrotask(() => tx.oncomplete?.()); }
        })}; return tx;
      }};
      req.onsuccess?.();
    }); return req;
  }};
  return store;
}
function app({disk = storage(), fetch, auto = false} = {}) {
  const elements = new Map();
  const element = key => {
    if(!elements.has(key)) elements.set(key, {innerHTML:'', textContent:'', value:'', hidden:false, disabled:false, dataset:{}, events:{},
      classList:{add(){},remove(){},toggle(){}},
      addEventListener(type, handler) { (this.events[type] ||= []).push(handler); },
      querySelector:selector => element(selector.startsWith('#') ? selector.slice(1) : selector), querySelectorAll:() => [],
      focus(){this.focused = true;}, select(){}, scrollIntoView(){}, contains:() => false});
    return elements.get(key);
  };
  const document = {getElementById:element, querySelector:element, querySelectorAll:() => [], addEventListener(){}, body:element('body')};
  const window = {XLSX, location:{hash:''}, history:{replaceState(_a,_b,url){window.location.hash = url;}},
    addEventListener(){}, scrollTo(){}, confirm:() => true};
  const context = vm.createContext({document, window, structuredClone, setTimeout, clearTimeout, AbortController,
    indexedDB:disk.indexedDB, crypto:webcrypto, fetch:fetch || (async () => { throw new Error('offline'); }),
    localStorage:{getItem(){throw new Error('must not use localStorage');},setItem(){throw new Error('must not use localStorage');}},
    __PAYROLL_TEST__:!auto});
  const run = code => vm.runInContext(code, context);
  const load = name => run(fs.readFileSync(new URL(name, base), 'utf8'));
  load('payroll-engine.js'); load('payroll-email-engine.js');
  run(fs.readFileSync(new URL('index.html', base), 'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
  run('render=()=>{};showToast=()=>{};bindView=()=>{};');
  load('workbench-core.js'); load('workbench-pages.js');
  run('PayrollWorkbenchPages.bind=()=>{};');
  load('workbench-ui.js'); load('workbench-cloud.js');
  const W = run('PayrollWorkbench'), UI = run('PayrollWorkbenchUI'), Cloud = run('PayrollWorkbenchCloud');
  const client = (fetcher = fetch, extra = {}) => Cloud.createClient({fetch:fetcher, W, UI, ...extra});
  function empty(name = '虚拟空白批次') {
    element('batchMonth').value = '2026-08'; element('batchDays').value = '22';
    element('batchName').value = name; element('batchCompany').value = '测试公司';
    element('batchForm').events.submit[0]({preventDefault(){}});
    return W.currentBatch();
  }
  function imported() {
    run(`currentMonth='2026-08';currentBatch().month=currentMonth;currentWorkdays=22;
      const roster=[{姓名:'虚拟甲',公司:'测试公司',一级部门:'研发部',是否入离职:'在职',工号:'0001',银行卡号:'00123456',空白:null,零:0}];
      roster.sheetName='花名册 & <原始>';roster.sourceStartRow=5;
      commitSource('roster',{rows:roster,filename:'虚拟花名册.xlsx'});
      commitSource('salary',{rows:[{姓名:'虚拟甲',基本工资:8000,岗位工资:2000,绩效基数:1200}],filename:'虚拟工资.xlsx'});
      commitSource('performance',{rows:[{姓名:'虚拟甲',绩效系数:1}],filename:'虚拟绩效.xlsx'});
      commitSource('attendance',{rows:[{姓名:'虚拟甲',实发薪天数:22,餐补合计:300}],filename:'虚拟考勤.xlsx'});
      state.selectedId=employees[0].id;saveBatchData();`);
    return W.currentBatch();
  }
  return {run, W, UI, Cloud, client, element, window, disk, context, empty, imported};
}
function server() {
  const s = {logged:false, csrf:'csrf-session', calls:[], drafts:new Map(), requests:new Map(), drop:false, delay:null, next:1};
  const user = {id:'admin-1', username:'admin', displayName:'测试管理员'};
  s.fetch = async (url, init) => {
    const method = init.method, body = init.body && JSON.parse(init.body), path = url.slice('/api/payroll'.length);
    s.calls.push({url, method, headers:{...init.headers}, body:init.body, credentials:init.credentials, cache:init.cache});
    if(path === '/session') return response({user:s.logged ? user : null, csrfToken:s.csrf});
    if(path === '/login') {
      if(body.username !== 'admin' || body.password !== 'secret-password') return failure(401);
      s.logged = true; s.csrf = 'csrf-login'; return response({user, csrfToken:s.csrf});
    }
    if(!s.logged) return failure(401);
    if(method !== 'GET' && init.headers['X-CSRF-Token'] !== s.csrf) return failure(403, '安全校验失败');
    if(path === '/logout') { s.logged = false; return response({}); }
    if(path === '/workspaces' && method === 'GET') return response([...s.drafts.values()].map(({id, revision, name, month, updatedAt}) => ({id, revision, name, month, updatedAt})));
    if(method === 'GET') return s.drafts.has(path.split('/').at(-1)) ? response(s.drafts.get(path.split('/').at(-1))) : failure(404);
    if(s.delay) await s.delay.promise;
    let saved;
    if(s.requests.has(body.requestKey)) {
      const previous = s.requests.get(body.requestKey);
      assert.equal(previous.body, init.body, 'retry must preserve serialized bytes'); saved = previous.saved;
    } else {
      const id = method === 'POST' ? 'workspace-' + s.next++ : path.split('/').at(-1);
      const old = s.drafts.get(id);
      if(method === 'PUT' && body.expectedRevision !== old?.revision) return failure(409);
      saved = {id, revision:(old?.revision || 0) + 1, name:body.snapshot.batch.name, month:body.snapshot.batch.month,
        updatedAt:'2026-09-15T01:00:00.000Z', snapshot:plain(body.snapshot)};
      s.drafts.set(id, saved); s.requests.set(body.requestKey, {body:init.body, saved:plain(saved)});
    }
    if(s.drop) { s.drop = false; throw new TypeError('response lost AFTER server committed'); }
    return response(saved);
  };
  return s;
}
async function logged(a, s, extra) { const c = a.client(s.fetch, extra); await c.login('admin', 'secret-password'); return c; }

test('test mode has no auto init, no fetch and no automatic local-to-cloud upload', async () => {
  const s = server(), a = app({fetch:s.fetch});
  assert.equal(a.disk.reads, 0); assert.equal(s.calls.length, 0);
  a.imported(); await a.W.flush(); assert.equal(s.calls.length, 0);
  const c = await logged(a, s); await c.session(); await c.refresh();
  assert.deepEqual(s.calls.map(x => x.method + ' ' + x.url), ['POST /api/payroll/login','GET /api/payroll/session','GET /api/payroll/workspaces']);
  assert.equal(s.drafts.size, 0);
});

test('all default demo batches and marked local demos are blocked before any save request', async () => {
  const s = server(), a = app(), c = await logged(a, s);
  for(let i = 0; i < 3; i++) {
    a.run(`setCurrentBatch(state.batches[${i}]);`);
    await assert.rejects(c.save(), /演示/);
  }
  assert.equal(s.calls.filter(x => x.url.includes('/workspaces')).length, 0);
  a.imported(); a.run("state.sourceStatus.tax={uploaded:true,demo:true};");
  await assert.rejects(c.save(), /演示/);
  a.run('delete state.sourceStatus.tax;PayrollWorkbench.data().demoProfiles=[];');
  await assert.rejects(c.save(), /演示/);
  assert.equal(s.drafts.size, 0);
});

test('changing a tag cannot launder unimported sources or demo profiles into an empty draft', async () => {
  const a = app(); a.imported();
  a.run("state.liveImport=false;currentBatch().draftOrigin='empty';");
  assert.throws(() => a.W.packCurrent(), /真实导入/);
  const b = app(); b.run("saveBatchData();state.sourceStatus={};currentBatch().draftOrigin='empty';");
  assert.throws(() => b.W.packCurrent(), /演示/);
  assert.ok(Object.hasOwn(b.W.currentBatch().workbench, 'demoProfiles'), 'guard must not silently delete demo evidence');
});

test('new batch form creates a genuine empty draft without altering other local batches', async () => {
  const s = server(), a = app(), c = await logged(a, s);
  a.imported(); a.run("PayrollWorkbench.saveChange(employees[0],'otherAdd',35,'虚拟调整');");
  const old = a.W.currentBatch(), before = plain(old); a.empty();
  assert.equal(a.W.currentBatch().draftOrigin, 'empty'); assert.equal(a.run('employees.length'), 0);
  assert.equal(a.W.currentBatch().workbench?.demoProfiles, undefined);
  const saved = await c.save();
  assert.equal(saved.snapshot.provenance, 'empty'); assert.deepEqual(plain(saved.snapshot.sources), {});
  assert.deepEqual(plain(saved.snapshot.results), {gross:[], net:[]});
  assert.deepEqual(plain({...old, active:before.active}), before);
  a.run('setCurrentBatch(state.batches[1]);'); assert.equal(a.run('employees[0].gross'), 11535);
});

test('first real import clears demo adjustments/mail/rates and never retains unrelated demo sources', async () => {
  const a = app(); a.run(`saveBatchData();state.emailDraft={recipient:'demo@example.invalid'};currentBatch().data.internDailyRates={演示:999};
    sourceRows.tax=[{姓名:'演示',税:500}];PayrollWorkbench.data().history.push({name:'演示'});`);
  a.imported(); const snap = a.W.packCurrent();
  assert.equal(snap.provenance, 'user-import'); assert.equal(snap.batch.data.liveImport, true);
  assert.equal(snap.batch.data.emailDraft, null); assert.deepEqual(plain(snap.batch.data.internDailyRates), {});
  assert.equal(snap.sources.tax, undefined); assert.equal(snap.batch.workbench.demoProfiles, undefined);
  assert.equal(snap.batch.workbench.history.length, 0); assert.equal(Object.values(snap.batch.data.sourceStatus).some(x => x.demo === true), false);
});

test('snapshot JSON round trip preserves source envelopes, exact results, adjustment scopes, mail, null and zero', () => {
  const a = app(); a.imported();
  a.run(`PayrollWorkbench.saveChange(employees[0],'otherAdd',12.34,'虚拟补发');
    state.payrollStage='net';recalculateEmployees();PayrollWorkbench.saveChange(employees[0],'tax',100,'虚拟个税核对');
    commitSource('grossUpload',{filename:'虚拟上传应发.xlsx',rows:[{姓名:'虚拟甲',公司:'测试公司',一级部门:'研发部',应发工资:9000}]});
    PayrollWorkbench.saveChange(employees[0],'tax',200,'上传来源核对');
    state.emailDraft={recipient:'fake@example.invalid',subject:'虚拟草稿',bodyOverride:'手动正文',attachmentReady:false};
    makeupWorkdays=['2026-08-08'];saveBatchData();`);
  const snapshot = plain(a.W.packCurrent()), original = structuredClone(snapshot);
  assert.equal(snapshot.batch.cloud, undefined); assert.equal(snapshot.batch.data.sourceRows, undefined);
  assert.deepEqual(Object.keys(snapshot.sources.roster.rows), ['0']);
  const b = app(); b.empty('另一个本机批次'); const other = b.W.currentBatch(), otherBefore = plain(other);
  b.W.restoreCloud(snapshot, {id:'w-1', revision:3, updatedAt:'now', ownerUserId:'admin-1'});
  assert.equal(b.run('sourceRows.roster.sheetName'), '花名册 & <原始>'); assert.equal(b.run('sourceRows.roster.sourceStartRow'), 5);
  assert.equal(b.run('sourceRows.roster[0].空白'), null); assert.equal(b.run('sourceRows.roster[0].零'), 0);
  assert.equal(b.run('sourceRows.roster[0].银行卡号'), '00123456');
  assert.deepEqual(plain(b.run('generatedEmployees')), snapshot.results.gross);
  assert.deepEqual(plain(b.run('employees')), snapshot.results.net);
  assert.deepEqual(plain(b.W.currentBatch().workbench), snapshot.batch.workbench);
  assert.deepEqual(plain(b.run('state.emailDraft')), snapshot.batch.data.emailDraft);
  assert.deepEqual(plain({...other,active:otherBefore.active}), otherBefore); assert.deepEqual(snapshot, original);
  const next = plain(b.W.packCurrent()); assert.deepEqual(next.sources, snapshot.sources); assert.deepEqual(next.results, snapshot.results);
  b.run('delete sourceRows.grossUpload;state.payrollStage="net";recalculateEmployees();');
  assert.equal(b.run('employees[0].tax'), 100, 'generated/uploaded adjustments stay separate after restore');
});

test('gross snapshot carries generated results only and forbids uncommitted preview/busy import', () => {
  const a = app(); a.imported(); assert.equal(a.W.packCurrent().results.net.length, 0);
  a.run("PayrollWorkbench.previewChange(employees[0],'otherAdd',900)");
  assert.throws(() => a.W.packCurrent(), /保存或取消/); a.W.clearPreview();
  a.run('importSession().busy=true;'); assert.throws(() => a.W.packCurrent(), /处理/);
});

test('login uses same-origin cookies; CSRF protects writes and no credentials reach IndexedDB or snapshots', async () => {
  const s = server(), a = app(), c = await logged(a, s); a.imported();
  const first = await c.save(); a.run("PayrollWorkbench.saveChange(employees[0],'otherAdd',5,'虚拟调整');");
  await c.save(); await c.logout(); await a.W.flush();
  assert.deepEqual(s.calls.map(x => x.method), ['POST','POST','PUT','POST']);
  for(const call of s.calls) { assert.equal(call.credentials, 'same-origin'); assert.equal(call.cache, 'no-store'); }
  assert.equal(s.calls[0].headers['X-CSRF-Token'], undefined);
  for(const call of s.calls.slice(1)) assert.equal(call.headers['X-CSRF-Token'], 'csrf-login');
  assert.equal(JSON.parse(s.calls[2].body).expectedRevision, first.revision);
  assert.equal(c.status().user, null); assert.equal(c.status().list, null);
  assert.doesNotMatch(JSON.stringify(a.disk.saved), /secret-password|csrf-login|csrf-session|HttpOnly/);
  assert.equal(s.drafts.get(first.id).revision, 2);
});

test('login and missing CSRF failures cannot submit a workspace', async () => {
  const s = server(), a = app(), c = a.client(s.fetch); a.empty();
  await assert.rejects(c.login('admin','wrong'), /登录失败/); await assert.rejects(c.save(), /先登录/);
  const d = a.client(async url => url.endsWith('/session') ? response({user:{id:'a',username:'admin',displayName:'管理员'}}) : assert.fail('must not write without CSRF'));
  await d.session(); await assert.rejects(d.save(), /安全校验/); assert.equal(s.drafts.size, 0);
});

test('lost create response retries identical bytes/key after local edits and never creates a duplicate', async () => {
  const s = server(), a = app(), c = await logged(a, s); a.imported(); s.drop = true;
  await assert.rejects(c.save(), /连接失败/); assert.equal(s.drafts.size, 1);
  const pending = plain(a.W.currentBatch().cloud.pending); assert.ok(pending);
  assert.doesNotMatch(c.status().message, /已保存/);
  a.run("PayrollWorkbench.saveChange(employees[0],'otherAdd',88,'响应丢失后的修改');");
  await c.save();
  const saves = s.calls.filter(x => x.url.includes('/workspaces'));
  assert.equal(saves[0].body, saves[1].body); assert.equal(saves[1].body, pending.body);
  assert.equal(s.drafts.size, 1); assert.equal(a.W.currentBatch().cloud.pending, undefined);
  assert.match(c.status().message, /新增修改需再次/); assert.match(c.currentStatus().text, /尚未确认同步/);
  await c.save(); assert.equal(s.drafts.size, 1); assert.equal([...s.drafts.values()][0].revision, 2);
  assert.equal([...s.drafts.values()][0].snapshot.results.gross[0].gross, 11588);
});

test('pending operation survives page reload via IndexedDB, uses original payload after renewed login', async () => {
  const s = server(), a = app(), c = await logged(a, s); a.empty(); s.drop = true;
  await assert.rejects(c.save()); await a.W.flush();
  const pending = a.W.currentBatch().cloud.pending;
  const b = app({disk:storage(a.disk.saved)}); await b.W.restore(); const d = await logged(b, s);
  await d.save(); const calls = s.calls.filter(x => x.url.includes('/workspaces'));
  assert.equal(calls[0].body, calls[1].body); assert.equal(calls[1].body, pending.body);
  assert.equal(s.drafts.size, 1);
});

test('local persistence failure prevents dispatch and keeps the pending request for a later retry', async () => {
  const s = server(), a = app(), c = await logged(a, s); a.empty(); await a.W.flush(); a.disk.fail = true;
  await assert.rejects(c.save(), /本机未能保存/); assert.equal(s.drafts.size, 0);
  const key = a.W.currentBatch().cloud.pending.requestKey;
  a.disk.fail = false; await c.save(); assert.equal([...s.requests.keys()][0], key);
});

test('concurrent save clicks cannot dispatch duplicate POSTs or alter a captured payload', async () => {
  const s = server(), a = app(), c = await logged(a, s); a.empty(); s.delay = deferred();
  const save = c.save(); await assert.rejects(c.save(), error => error.code === 'BUSY');
  s.delay.resolve(); await save; assert.equal(s.drafts.size, 1);
  assert.equal(s.calls.filter(x => x.url.endsWith('/workspaces')).length, 1);
});

test('409 blocks stale retry, offers reload, and preserves both conflicting and unrelated local batches', async () => {
  const s = server(), a = app(), c = await logged(a, s); a.imported(); const saved = await c.save();
  const old = a.W.currentBatch(); s.drafts.get(saved.id).revision = 2;
  a.run("PayrollWorkbench.saveChange(employees[0],'otherAdd',40,'另一台电脑之后的修改');");
  await assert.rejects(c.save(), error => error.status === 409 && /重新加载/.test(error.message));
  assert.equal(old.cloud.revision, 1); assert.ok(old.cloud.pending.conflict);
  const beforeCalls = s.calls.length; await assert.rejects(c.save(), /重新加载/); assert.equal(s.calls.length, beforeCalls);
  const oldBefore = plain(old), count = a.run('state.batches.length');
  await c.restore(saved.id);
  assert.equal(a.run('state.batches.length'), count + 1); assert.equal(a.W.currentBatch().cloud.revision, 2);
  assert.deepEqual(plain({...old,active:oldBefore.active}), oldBefore); assert.notEqual(a.W.currentBatch(), old);
});

test('expired session, HTTP failures and malformed success never report saved or lose retry payload', async () => {
  const variants = [() => failure(401), () => failure(500), () => ({ok:true,status:200,json:async()=>{throw new Error('HTML');}}),
    () => response({id:'wrong'})];
  for(const answer of variants) {
    const a = app(); a.empty();
    const c = a.client(async url => url.endsWith('/login') ? response({user:{id:'a',username:'admin',displayName:'管理员'},csrfToken:'csrf'}) : answer());
    await c.login('admin','password'); await assert.rejects(c.save());
    assert.ok(a.W.currentBatch().cloud.pending); assert.equal(a.W.currentBatch().cloud.id, undefined);
    assert.equal(c.status().tone, 'error'); assert.doesNotMatch(c.status().message, /已保存为服务器草稿/);
  }
});

test('timeout aborts the request, leaves local editing available and never claims save success', async () => {
  const a = app(); a.empty();
  const c = a.client((url, init) => url.endsWith('/login') ? Promise.resolve(response({user:{id:'a',username:'admin',displayName:'管理员'},csrfToken:'csrf'}))
    : new Promise((_resolve,reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))), {timeoutMs:10});
  await c.login('admin','password'); await assert.rejects(c.save(), /超时/);
  assert.equal(c.status().busy, false); assert.equal(c.status().service, 'unavailable');
  const batch = a.empty('离线仍可新建'); assert.equal(batch.name, '离线仍可新建');
});

test('cross-computer restore uses saved results and source metadata, then PUTs the known revision', async () => {
  const s = server(), a = app(), c = await logged(a, s); a.imported(); const saved = await c.save();
  const b = app(), d = await logged(b, s); b.empty('另一电脑自己的草稿'); const other = b.W.currentBatch();
  await d.refresh(); const count = b.run('state.batches.length'); await d.restore(saved.id);
  assert.equal(b.run('state.batches.length'), count + 1); assert.equal(b.run('sourceRows.roster.sourceStartRow'), 5);
  assert.equal(b.W.currentBatch().cloud.id, saved.id); assert.notEqual(b.W.currentBatch(), other);
  assert.deepEqual(plain(b.run('generatedEmployees')), plain(saved.snapshot.results.gross));
  b.run("PayrollWorkbench.saveChange(employees[0],'otherAdd',1,'另一电脑继续核算');"); await d.save();
  const last = s.calls.at(-1); assert.equal(last.method, 'PUT'); assert.equal(JSON.parse(last.body).expectedRevision, 1);
  assert.equal(s.drafts.size, 1);
});

test('restore validates snapshot before changing any local batch (demo, malformed metadata, unsafe keys)', async () => {
  const a = app(); a.empty(); const good = plain(a.W.packCurrent());
  for(const mutate of [s=>{s.formatVersion=2;},s=>{s.batch.data.sourceStatus.tax={demo:true};},s=>{s.provenance='user-import';},
    s=>{s.sources.roster={rows:[],sheetName:'Sheet1',sourceStartRow:0};},s=>{s.batch.cloud={id:'intruder'};},
    s=>{s.batch.data.sourceRows={roster:[]};},s=>{s.batch.workbench={demoProfiles:[]};},
    s=>{s.batch.data=JSON.parse('{"__proto__":{"polluted":true}}');}]) {
    const invalid = structuredClone(good); mutate(invalid); const before = a.run('JSON.stringify(state.batches)');
    assert.throws(() => a.W.restoreCloud(invalid, {id:'w',revision:1}));
    assert.equal(a.run('JSON.stringify(state.batches)'), before);
  }
  assert.equal({}.polluted, undefined);
});

test('server restore respects unfinished edits and an intervening batch switch', async () => {
  const s = server(), a = app(), c = await logged(a, s); a.imported(); const saved = await c.save();
  a.run("PayrollWorkbenchUI.ui.draft={employee:structuredClone(employees[0]),field:'otherAdd',value:500,reason:'待提交'};");
  a.window.confirm = () => false; const before = a.W.currentBatch();
  assert.equal(await c.restore(saved.id), null); assert.equal(a.W.currentBatch(), before);
  await assert.rejects(c.save(), /保存或取消/); a.UI.ui.draft = null;
  const gate = deferred(); const d = a.client(async (url, init) => { if(init.method==='GET'&&url.includes('/workspaces/')) await gate.promise; return s.fetch(url,init); });
  await d.session(); const restoring = d.restore(saved.id); a.empty('等待期间切换'); gate.resolve();
  await assert.rejects(restoring, /切换/); assert.equal(a.W.currentBatch().name, '等待期间切换');
});

test('save completion binds to its original batch if user switches locally while request is in flight', async () => {
  const s = server(), a = app(), c = await logged(a, s); const old = a.empty('正在发送的批次');
  s.delay = deferred(); const saving = c.save(); const next = a.empty('当前另一批次'); s.delay.resolve();
  await saving; assert.ok(old.cloud.id); assert.equal(next.cloud, undefined); assert.equal(a.W.currentBatch(), next);
  assert.doesNotMatch(c.status().message, /当前批次已保存/);
});

test('pending save cannot be replayed under another administrator or contain a demo snapshot', async () => {
  const s = server(), a = app(), c = await logged(a, s); a.empty(); s.drop = true; await assert.rejects(c.save());
  const d = a.client(async url => url.endsWith('/session') ? response({user:{id:'admin-2',username:'other',displayName:'另一管理员'},csrfToken:'other'}) : assert.fail('must not dispatch'));
  await d.session(); await assert.rejects(d.save(), /原账号/);
  const p = a.W.currentBatch().cloud.pending, payload = JSON.parse(p.body); payload.snapshot.batch.data.sourceStatus.roster={demo:true}; p.body=JSON.stringify(payload);
  const calls = s.calls.length; await assert.rejects(c.save(), /演示/); assert.equal(s.calls.length, calls);
});

test('cloud/UI initialization waits for IndexedDB hydration, runs once, and only checks session', async () => {
  const s = server(), disk = storage(); disk.gate = deferred(); const a = app({disk,fetch:s.fetch,auto:true});
  const first = a.Cloud.init(), second = a.Cloud.init(); assert.equal(first, second);
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(s.calls.length, 0); assert.equal(disk.reads, 1);
  disk.gate.resolve(); await first;
  assert.deepEqual(s.calls.map(x => x.method + ' ' + x.url), ['GET /api/payroll/session']);
  assert.equal(a.element('.topbar').events.click.length, 1); assert.equal(a.element('payrollCloud').events.click.length, 1);
  assert.equal(a.element('cloudLoginForm').events.submit.length, 1);
});

test('unavailable session leaves the initialized local UI usable with a visible connection error', async () => {
  const a = app({fetch:async () => { throw new Error('offline'); }}); await a.Cloud.init();
  assert.match(a.element('cloudMessage').textContent, /连接失败/);
  assert.match(a.element('content').innerHTML, /wb-workflow/); a.empty();
  assert.equal(a.W.packCurrent().provenance, 'empty'); assert.equal(a.element('cloudSave').disabled, true);
});

test('cloud controls survive header redraw; login clears password and escapes untrusted list/error text', async () => {
  const s = server(), a = app({fetch:s.fetch}); const c = await a.Cloud.init(); a.empty();
  a.element('cloudUsername').value = 'admin'; a.element('cloudPassword').value = 'secret-password';
  a.element('cloudLoginForm').events.submit[0]({preventDefault(){}});
  assert.equal(a.element('cloudPassword').value, '');
  await new Promise(resolve => setTimeout(resolve, 0)); assert.ok(c.status().user);
  const saved = await c.save(); s.drafts.get(saved.id).name = '<img src=x onerror=alert(1)> & "草稿"';
  await c.refresh(); const html = a.element('cloudList').innerHTML;
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/);
  const banner = a.element('payrollCloud').innerHTML; a.UI.mount('batches', false);
  assert.equal(a.element('payrollCloud').innerHTML, banner);
  assert.ok(a.element('cloudLoginForm').hidden);
  await c.logout(); assert.equal(a.element('cloudList').innerHTML, '');
});

test('new cloud assets are outside the redrawn header and loaded after core/UI', () => {
  const html = fs.readFileSync(new URL('index.html',base),'utf8');
  assert.match(html, /<\/header>\s*<section id="payrollCloud"/);
  assert.ok(html.indexOf('src="./workbench-cloud.js"') > html.indexOf('src="./workbench-ui.js"'));
  assert.match(html, /href="\.\/workbench-cloud\.css"/);
  assert.doesNotMatch(fs.readFileSync(new URL('workbench-cloud.js',base),'utf8'), /localStorage\s*[.[]|document\.cookie|setInterval/);
});

test('old GET revision stays distinct from currentRevision and cannot be silently rebased on save', async () => {
  const s = server(), a = app(), c = await logged(a, s); a.empty(); const saved = await c.save();
  s.drafts.get(saved.id).currentRevision = 4;
  await c.restore(saved.id);
  assert.equal(a.W.currentBatch().cloud.revision, 1); assert.equal(a.W.currentBatch().cloud.currentRevision, 4);
  assert.ok(c.currentStatus().blocked); assert.ok(c.currentStatus().conflict);
  assert.match(c.currentStatus().text, /旧版本 1.*最新版本为 4/);
  const calls = s.calls.length; await assert.rejects(c.save(), /重新加载/); assert.equal(s.calls.length, calls);
  assert.equal(a.W.currentBatch().cloud.pending, undefined);
});

test('contract-only empty snapshot restores without a local origin tag, while new local blanks still require one', () => {
  const a = app(); a.empty(); const snapshot = plain(a.W.packCurrent()); delete snapshot.batch.draftOrigin;
  const b = app(); b.W.restoreCloud(snapshot, {id:'server-empty',revision:1});
  assert.equal(b.W.currentBatch().draftOrigin, 'empty'); assert.equal(b.W.packCurrent().provenance, 'empty');
  delete b.W.currentBatch().draftOrigin;
  assert.throws(() => b.W.packCurrent(), /真实导入/);
});

test('all declared sourceSheets keys pack and restore even with demo:false and empty source row arrays', () => {
  const a = app(); a.imported();
  a.run(`for(const s of sourceSheets){sourceRows[s.key] ||= [];sourceRows[s.key].sheetName=s.name;sourceRows[s.key].sourceStartRow=3;
    state.sourceStatus[s.key]={uploaded:true,demo:false,filename:'虚拟.xlsx'};}recalculateEmployees();saveBatchData();`);
  const snapshot = plain(a.W.packCurrent());
  assert.deepEqual(Object.keys(snapshot.sources).sort(), plain(a.run('sourceSheets.map(s=>s.key).sort()')));
  const b = app(); b.W.restoreCloud(snapshot, {id:'all-sources',revision:2});
  assert.deepEqual(plain(b.W.packCurrent().sources), snapshot.sources);
});

test('editing after successful save updates banner to unsynced; hostile server messages use textContent', async () => {
  const s = server(), a = app({fetch:s.fetch}), c = await a.Cloud.init();
  await c.login('admin','secret-password'); a.imported(); await c.save();
  assert.match(a.element('cloudMessage').textContent, /已保存/);
  a.run("PayrollWorkbench.saveChange(employees[0],'otherAdd',40,'保存后的修改');");
  assert.match(a.element('cloudMessage').textContent, /尚未确认同步/); assert.doesNotMatch(a.element('cloudMessage').textContent, /已保存/);
  const attack = '<img src=x onerror=alert(1)>', b = app({fetch:async url => url.endsWith('/session')
    ? response({user:{id:'admin-x',username:'admin',displayName:attack},csrfToken:'token'}) : failure(503,attack)});
  const d = await b.Cloud.init(); await assert.rejects(d.refresh());
  assert.equal(b.element('cloudAccount').textContent, attack + ' · 管理员'); assert.equal(b.element('cloudMessage').textContent, attack);
  assert.doesNotMatch(b.element('payrollCloud').innerHTML, /<img/);
});

test('logout failure is unconfirmed, hides private cloud list, and does not erase local drafts', async () => {
  const s = server(), a = app(), c = a.client((url,init) => url.endsWith('/logout') ? Promise.reject(new Error('offline')) : s.fetch(url,init));
  await c.login('admin','secret-password'); a.empty(); await c.save(); await c.refresh();
  const before = a.run('JSON.stringify(state.batches)'); await assert.rejects(c.logout(), /退出请求未确认/);
  assert.equal(c.status().user,null); assert.equal(c.status().list,null); assert.doesNotMatch(c.status().message,/已退出/);
  assert.equal(a.run('JSON.stringify(state.batches)'),before);
});

test('real XLSX import final render releases cloud save after busy commits, without any automatic server write', async () => {
  const s = server(), a = app({fetch:s.fetch}), c = await a.Cloud.init(); await c.login('admin','secret-password');
  a.empty(); await c.save(); const writesBefore = s.calls.filter(x=>x.url.includes('/workspaces')&&x.method!=='GET').length;
  const gate = deferred(), book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{姓名:'虚拟导入甲',公司:'测试公司',一级部门:'研发部',是否入离职:'在职'}]), '花名册');
  const bytes = XLSX.write(book, {type:'array', bookType:'xlsx'});
  a.context.uploadFile = {name:'虚拟花名册.xlsx', size:bytes.byteLength, arrayBuffer:()=>gate.promise.then(()=>bytes)};
  const importing = a.run("importFiles([uploadFile], 'roster')");
  assert.equal(a.element('cloudSave').disabled,true); assert.match(a.element('cloudCurrent').textContent,/资料正在处理/);
  gate.resolve(); await importing;
  assert.equal(a.run('importSession().busy'),false); assert.equal(a.run('sourceRows.roster.length'),1);
  assert.equal(a.element('cloudSave').disabled,false); assert.doesNotMatch(a.element('cloudCurrent').textContent,/资料正在处理/);
  assert.equal(s.calls.filter(x=>x.url.includes('/workspaces')&&x.method!=='GET').length,writesBefore);
  await c.save(); assert.equal(a.W.currentBatch().cloud.revision,2);
});

test('cancelled/failed imports and completed calculation refresh cloud status without packing/save recursion', async () => {
  const s = server(), a = app({fetch:s.fetch}), c = await a.Cloud.init(); await c.login('admin','secret-password'); a.empty();
  // A failed parser still passes through the production finally-render path.
  await a.run("importFiles([{name:'错误.txt',size:1}], 'roster')");
  assert.equal(a.element('cloudSave').disabled,false);
  const gate = deferred(); a.context.cancelledFile={name:'虚拟取消.xlsx',size:1,arrayBuffer:()=>gate.promise};
  const cancelled=a.run("importFiles([cancelledFile], 'roster')");
  a.run("state.payrollStage='net'"); gate.resolve(new ArrayBuffer(0)); await cancelled;
  assert.equal(a.run('importSession().busy'),false); assert.equal(a.element('cloudSave').disabled,false);
  a.imported(); a.run("state.calculating=true;render('results');");
  assert.equal(a.element('cloudSave').disabled,true);
  a.run('state.calculating=false;calculateStage();');
  assert.equal(a.element('cloudSave').disabled,false); assert.doesNotMatch(a.element('cloudCurrent').textContent,/资料正在处理/);
  // A view-only refresh must not start a save or append work to the IndexedDB write queue.
  await a.W.flush(); const diskWrites=a.disk.writes, calls=s.calls.length; let notifications=0;
  const unsubscribe=a.W.subscribe(()=>notifications++);
  a.UI.mount('batches',false); await a.W.flush(); unsubscribe();
  assert.equal(notifications,1); assert.equal(a.disk.writes,diskWrites); assert.equal(s.calls.length,calls);
});
