import {Readable} from 'node:stream';
import {calculationResponse,isCalculationPath} from './calculation-response.mjs';
import {payrollActor} from '../access/payroll-tag-actor.mjs';
import {requireAccess} from '../access/session.mjs';
import { readFileSync, statSync } from 'node:fs';
import { createPool } from '../../database/payroll/pool.mjs';
import { createPayrollHandler } from './http.mjs';
import { createPersonnelService } from './personnel-service.mjs';
import { createWorkspaceConfirmationService } from './workspace-confirmation.mjs';

const unavailable = (res, message) => {
  res.writeHead(503, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify({ ok: false, error: { code: 'PAYROLL_UNAVAILABLE', message } }));
};

const respond = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  });
  res.end(JSON.stringify(data));
};

const emptyDirectory = () => ({
  configured: false, syncedAt: null, fresh: false, departmentCount: 0,
  memberCount: 0, syncing: false, lastError: null, departments: [], members: [],
});

/** The local 3220 workbench exposes only directory reads and a guarded sync. */
export function createLocalPersonnelRoute(personnelService) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:3220');
    const path = url.pathname.replace(/\/$/, '');
    const directory = path === '/api/payroll/personnel/directory';
    const events = path === '/api/payroll/personnel/events';
    const sync = path === '/api/payroll/personnel/directory/sync';
    const login = path === '/api/payroll/login';
    if (!directory && !events && !sync && !login) return false;
    if (req.headers.host !== '127.0.0.1:3220' ||
        (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:3220') ||
        req.headers['sec-fetch-site'] === 'cross-site') {
      respond(res, 403, { ok: false, error: { code: 'PAYROLL_ORIGIN', message: '请从 3220 本机工作台访问' } });
      return true;
    }
    if (login) {
      respond(res, 410, { ok: false, error: { code: 'PAYROLL_LOGIN_DISABLED', message: '3220 工作台不提供管理员登录' } });
      return true;
    }
    if ((directory || events) && req.method !== 'GET' || sync && req.method !== 'POST') {
      respond(res, 405, { ok: false, error: { code: 'PAYROLL_METHOD', message: '请求方法不支持' } });
      return true;
    }
    if (sync && (req.headers.origin !== 'http://127.0.0.1:3220' || req.headers['x-suyu-local'] !== '1')) {
      respond(res, 403, { ok: false, error: { code: 'PAYROLL_ORIGIN', message: '只能从本机人员页面同步' } });
      return true;
    }
    if (sync && !personnelService) {
      respond(res, 503, { ok: false, error: { code: 'WECOM_NOT_CONFIGURED', message: '企业微信只读通讯录尚未配置 CorpID 和 Secret 文件' } });
      return true;
    }
    try {
      const data = directory ? personnelService ? await personnelService.snapshot() : emptyDirectory()
        : events ? personnelService ? await personnelService.listEvents(Object.fromEntries(url.searchParams)) : []
          : await personnelService.sync();
      respond(res, 200, { ok: true, data });
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 503;
      respond(res, status, { ok: false, error: {
        code: status === 503 ? 'WECOM_SYNC_FAILED' : error.code || 'PAYROLL_VALIDATION',
        message: status === 503 ? '企业微信同步或数据库读取失败，请检查服务端配置和日志' : error.message,
      } });
    }
    return true;
  };
}

/** Serve the existing payroll handler on the website's sole local port. */
export function payrollViteMiddleware() {
  return {
    name: 'suyu-payroll-same-origin',
    apply: 'serve',
    configureServer(server) {
      const connectionString = process.env.PAYROLL_DATABASE_URL;
      let pool;
      let handler;
      let personnelService = null;
      let syncTimer;
      if (connectionString) {
        pool = createPool({ connectionString, max: 5, application_name: 'suyu-payroll-3220' });
        pool.on('error', () => process.stderr.write('Payroll database connection interrupted.\n'));
        const corpId = process.env.WECOM_CORP_ID?.trim() || null;
        const secretPath = process.env.WECOM_SECRET_FILE?.trim() || process.env.WECOM_APP_SECRET_FILE?.trim() || null;
        if (corpId && secretPath) {
          const info = statSync(secretPath);
          if (!info.isFile() || (info.mode & 0o077)) throw new Error('WECOM_SECRET_FILE must be a private file (mode 0600)');
          const appSecret = readFileSync(secretPath, 'utf8').trim();
          if (!appSecret) throw new Error('WECOM_SECRET_FILE is empty');
          personnelService = createPersonnelService({ pool, corpId, appSecret });
        }
        handler = createPayrollHandler({
          pool,
          publicOrigin: 'http://127.0.0.1:3220',
          workspaceAuth: async req => {
            const request=new Request('http://127.0.0.1:3220'+req.url,{headers:req.headers,method:req.method});
            const access=await requireAccess(request,'payroll');
            const user=await payrollActor(pool,access);
            return {user:{id:user.id,username:user.username,displayName:user.display_name},csrfToken:'workspace-origin-protected'};
          },
          personnelService,
          corpId,
          confirmationService: createWorkspaceConfirmationService({ pool, corpId }),
        });
        if (personnelService) {
          const sync = () => { void personnelService.sync().catch(() => process.stderr.write('WeCom directory sync failed.\n')); };
          sync();
          syncTimer = setInterval(sync, 6 * 60 * 60 * 1000);
          syncTimer.unref();
        }
      }
      const localPersonnelRoute = createLocalPersonnelRoute(personnelService);
      server.middlewares.use((req, res, next) => {
        if (!/^\/api\/payroll(?:\/|\?|$)/.test(req.url || '')) return next();
        if(isCalculationPath(new URL(req.url,'http://127.0.0.1:3220').pathname)) {
          const request=new Request('http://127.0.0.1:3220'+req.url,{headers:req.headers,method:req.method,
            ...['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'}});
          void calculationResponse(request).then(async response=>{
            res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
          }).catch(()=>respond(res,503,{error:'工资计算服务暂不可用'}));
          return;
        }
        void requireAccess(new Request('http://127.0.0.1:3220'+req.url,{headers:req.headers,method:req.method}),'payroll').then(()=>localPersonnelRoute(req, res)).then(handled => {
          if (handled) return;
          if (!handler) return unavailable(res, '工资数据库尚未配置，请设置 PAYROLL_DATABASE_URL');
          // Existing browser client obtains this value through /session; no database token is exposed.
          void handler(req, res);
        }).catch(error=>respond(res,error.status||503,{ok:false,error:{code:error.code||'ACCESS_DENIED',message:error.message||'访问失败'}}));
      });
      server.httpServer?.once('close', () => {
        if (syncTimer) clearInterval(syncTimer);
        if (pool) void pool.end();
      });
    },
  };
}
