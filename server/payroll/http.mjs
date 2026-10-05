import { createServer } from 'node:http';
import { createPayrollRepository } from '../../database/payroll/repository.mjs';
import { createAuthService,normalizedAddress } from './auth.mjs';
import { createWorkspaceService } from './workspaces.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function error(code,message,status) { return Object.assign(new Error(message),{code,status}); }
function respond(res,status,data,headers={}) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",...headers});
  res.end(JSON.stringify(data));
}
async function readJSON(req,maxBytes) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')) throw error('PAYROLL_MEDIA_TYPE','请求必须使用 JSON',415);
  const declared=Number(req.headers['content-length']);
  if (declared>maxBytes) throw error('PAYROLL_TOO_LARGE','单次保存不能超过 20 MB',413);
  const chunks=[]; let length=0;
  for await (const chunk of req) {
    length+=chunk.length;
    if (length>maxBytes) throw error('PAYROLL_TOO_LARGE','单次保存不能超过 20 MB',413);
    chunks.push(chunk);
  }
  let body;
  try { body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'); }
  catch { throw error('PAYROLL_BAD_JSON','请求内容不是有效 JSON',400); }
  if (!body || typeof body!=='object' || Array.isArray(body)) throw error('PAYROLL_BAD_JSON','请求内容必须是 JSON 对象',400);
  return body;
}
function cookieValue(req,name) {
  const values=(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));
  if (values.length!==1) return null;
  const token=values[0].slice(name.length+1);
  return /^[a-zA-Z0-9_-]{40,128}$/.test(token)?token:null;
}
function publicError(e) {
  const statuses={PAYROLL_AUTH_FAILED:401,PAYROLL_RATE_LIMIT:429,PAYROLL_FORBIDDEN:403,PAYROLL_NOT_FOUND:404,PAYROLL_CONFLICT:409,PAYROLL_IDEMPOTENCY_CONFLICT:409,PAYROLL_FROZEN:409,PAYROLL_STALE:409,PAYROLL_VALIDATION:422,PAYROLL_DEMO_REJECTED:422,PAYROLL_TOO_LARGE:413};
  const status=e.status||statuses[e.code];
  if (status) return {status,code:e.code,message:e.message};
  if (/^(22|23)/.test(e.code||'')) return {status:422,code:'PAYROLL_DATA_INVALID',message:'数据字段、人员关联或结果状态不符合要求，请核对后重试'};
  if (/^(08|28|42|53|57)/.test(e.code||'') || ['ECONNREFUSED','ETIMEDOUT','ENOTFOUND'].includes(e.code)) return {status:503,code:'PAYROLL_UNAVAILABLE',message:'工资数据库暂不可用，请稍后重试或联系管理员'};
  return {status:500,code:'PAYROLL_INTERNAL',message:'保存或读取失败，请保留本机草稿并重试'};
}

/** Same-origin API for the single payroll administrator. Never serves a seed route. */
export function loginClientAddress(req,trustedProxies=[]) {
  const direct=normalizedAddress(req.socket.remoteAddress);
  const trusted=trustedProxies.some(address=>normalizedAddress(address)===direct);
  const forwarded=normalizedAddress(req.headers['x-real-ip']);
  return trusted && forwarded!=='unknown'?forwarded:direct;
}
export function createPayrollHandler({pool,publicOrigin,production=false,bodyLimit=20*1024*1024,trustedProxies=[],wecomDirectory=null}) {
  let origin;
  try { origin=new URL(publicOrigin); } catch { throw new Error('Invalid PAYROLL_PUBLIC_ORIGIN'); }
  if (!['http:','https:'].includes(origin.protocol) || origin.origin!==publicOrigin || origin.username || origin.password) throw new Error('PAYROLL_PUBLIC_ORIGIN must contain only a valid website origin');
  if (production && origin.protocol!=='https:') throw new Error('Production payroll requires an HTTPS public origin');
  if (!Array.isArray(trustedProxies)||trustedProxies.some(address=>normalizedAddress(address)==='unknown')) throw new Error('Trusted proxies must be explicit IP addresses');
  const secure=origin.protocol==='https:';
  const cookieName=secure?'__Host-payroll_session':'payroll_session';
  const cookie=(token,maxAge)=>`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`;
  const auth=createAuthService(pool),db=createPayrollRepository(pool),workspaces=createWorkspaceService(pool);
  return async function handler(req,res) {
    try {
      const url=new URL(req.url,'http://internal.invalid');
      const path=url.pathname.replace(/\/$/,'');
      const method=req.method;
      if (path==='/api/payroll/health' && method==='GET') {
        await pool.query('SELECT 1 FROM payroll.workspaces LIMIT 0');
        await pool.query('SELECT 1 FROM payroll.users LIMIT 0');
        return respond(res,200,{ok:true,data:{status:'ready'}});
      }
      if (!path.startsWith('/api/payroll/')) throw error('PAYROLL_NOT_FOUND','接口不存在',404);
      const writing=!['GET','HEAD'].includes(method);
      if (writing && (req.headers.origin!==origin.origin || req.headers['sec-fetch-site']==='cross-site')) throw error('PAYROLL_ORIGIN','请从本网站提交操作',403);
      const token=cookieValue(req,cookieName);
      if (path==='/api/payroll/login' && method==='POST') {
        const body=await readJSON(req,4096);
        const session=await auth.login({username:body.username,password:body.password,clientAddress:loginClientAddress(req,trustedProxies)});
        return respond(res,200,{ok:true,data:{user:session.user,csrfToken:session.csrfToken}}, {'Set-Cookie':cookie(session.token,8*60*60)});
      }
      const session=token?await auth.authenticate(token):null;
      if (path==='/api/payroll/session' && method==='GET') return respond(res,200,{ok:true,data:session?{user:session.user,csrfToken:session.csrfToken}:{user:null}});
      if (!session) throw error('PAYROLL_AUTH_REQUIRED','请先登录工资管理员账号',401);
      if (writing && (!session.csrfToken || req.headers['x-csrf-token']!==session.csrfToken)) throw error('PAYROLL_CSRF','登录状态已变更，请刷新后重试',403);
      const body=writing?await readJSON(req,bodyLimit):{};
      if (path==='/api/payroll/logout' && method==='POST') {
        await auth.logout(token);
        return respond(res,200,{ok:true,data:{user:null}}, {'Set-Cookie':cookie('',0)});
      }
      if (path==='/api/payroll/wecom-directory' && method==='GET') {
        if (!wecomDirectory) throw error('WECOM_NOT_CONFIGURED','企业微信通讯录尚未配置',503);
        return respond(res,200,{ok:true,data:await wecomDirectory.snapshot()});
      }
      if (path==='/api/payroll/wecom-directory/sync' && method==='POST') {
        if (!wecomDirectory) throw error('WECOM_NOT_CONFIGURED','企业微信通讯录尚未配置',503);
        const alreadyRunning=wecomDirectory.syncing();
        if (!alreadyRunning) void wecomDirectory.sync().catch(() => {
          process.stderr.write('Enterprise WeChat directory sync failed; see the authenticated directory status.\n');
        });
        return respond(res,202,{ok:true,data:{syncing:true,alreadyRunning}});
      }
      const actorId=session.user.id;
      const segments=path.slice('/api/payroll/'.length).split('/');
      const [resource,id,action,version]=segments;
      if (id && !UUID.test(id)) throw error('PAYROLL_BAD_ID','记录编号格式无效',400);
      if (resource==='workspaces') {
        let result;
        if (segments.length===1 && method==='GET') result=await workspaces.list(actorId,{month:url.searchParams.get('month')||undefined,limit:Number(url.searchParams.get('limit')||100),offset:Number(url.searchParams.get('offset')||0)});
        else if (segments.length===1 && method==='POST') result=await workspaces.save({actorId,requestKey:body.requestKey,snapshot:body.snapshot});
        else if (segments.length===2 && method==='GET') result=await workspaces.get(actorId,id);
        else if (segments.length===2 && method==='PUT') result=await workspaces.save({actorId,id,expectedRevision:body.expectedRevision,requestKey:body.requestKey,snapshot:body.snapshot});
        else if (action==='versions' && segments.length===3 && method==='GET') result=await workspaces.versions(actorId,id);
        else if (action==='versions' && segments.length===4 && method==='GET' && /^[1-9]\d{0,8}$/.test(version)) result=await workspaces.get(actorId,id,Number(version));
        else throw error('PAYROLL_NOT_FOUND','接口不存在',404);
        return respond(res,200,{ok:true,data:result});
      }
      const params=Object.fromEntries(url.searchParams);
      const input={...body,actorId}; // Browser-supplied actorId can never impersonate another user.
      let result;
      const collectionWrites={companies:'createCompany',employees:'createEmployee',employments:'hireEmployee','rule-versions':'createRuleVersion',batches:'createBatch',imports:'createImport',runs:'createRun',adjustments:'addAdjustment','email-drafts':'saveEmailDraft'};
      if (segments.length===1 && method==='POST' && Object.hasOwn(collectionWrites,resource)) result=await db[collectionWrites[resource]](input);
      else if (resource==='companies' && segments.length===1 && method==='GET') result=(await pool.query('SELECT id,code,name,short_name,enabled FROM payroll.companies ORDER BY name,id')).rows;
      else if (resource==='rule-versions' && segments.length===1 && method==='GET') result=(await pool.query('SELECT * FROM payroll.rule_versions ORDER BY effective_from DESC,created_at DESC')).rows;
      else if (resource==='employee-candidates' && segments.length===1 && method==='GET') result=await db.findEmployeeCandidates(params);
      else if (resource==='batches' && segments.length===1 && method==='GET') result=await db.listBatches({...params,limit:params.limit?Number(params.limit):50,offset:params.offset?Number(params.offset):0});
      else if (resource==='employees' && id && segments.length===2 && method==='GET') result=await db.getEmployee(id);
      else if (resource==='imports' && id && segments.length===2 && method==='GET') result=await db.getImport(id);
      else if (resource==='batches' && id && segments.length===2 && method==='GET') result=await db.getBatch(id);
      else if (resource==='runs' && id && segments.length===2 && method==='GET') result=await db.getRun(id);
      else if (resource==='employments' && id && segments.length===3 && method==='POST' && ['changes','end','transfer'].includes(action)) result=await db[{changes:'changeEmployment',end:'endEmployment',transfer:'transferEmployment'}[action]]({...input,employmentId:id});
      else if (resource==='batches' && id && segments.length===3 && method==='GET' && ['files','imports','runs','adjustments','email-drafts','history'].includes(action)) result=await db[{files:'listFiles',imports:'listImports',runs:'listRuns',adjustments:'listAdjustments','email-drafts':'listEmailDrafts',history:'getBatchHistory'}[action]](id,params);
      else if (resource==='batches' && id && segments.length===3 && method==='POST' && action==='revisions') result=await db.reviseBatch({...input,batchId:id});
      else if (resource==='batches' && id && segments.length===3 && method==='PUT' && action==='settings') result=await db.updateBatchSettings({...input,batchId:id});
      else if (resource==='batches' && id && segments.length===3 && method==='POST' && action==='archive') result=await db.archiveBatch({...input,batchId:id});
      else if (resource==='runs' && id && segments.length===3 && method==='GET' && action==='summary') result=await db.getRunSummary(id);
      else if (resource==='runs' && id && segments.length===3 && method==='GET' && action==='reviews') result=await db.listReviews(id);
      else if (resource==='items' && id && segments.length===3 && method==='POST' && action==='reviews') result=await db.reviewItem({...input,itemId:id});
      else if (resource==='runs' && id && segments.length===3 && method==='POST' && action==='confirm') result=await db.confirmRun({...input,runId:id});
      else throw error('PAYROLL_NOT_FOUND','接口不存在',404);
      return respond(res,200,{ok:true,data:result});
    } catch (e) {
      if (res.destroyed || res.writableEnded) return;
      const failure=publicError(e);
      respond(res,failure.status,{ok:false,error:{code:failure.code,message:failure.message}},failure.status===429?{'Retry-After':'900'}:{});
    }
  };
}
export function createPayrollServer(options) {
  const server=createServer(createPayrollHandler(options));
  server.requestTimeout=30_000;
  server.headersTimeout=10_000;
  server.keepAliveTimeout=5_000;
  return server;
}
