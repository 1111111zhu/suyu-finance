import { createHash } from 'node:crypto';
import { withTransaction } from '../../database/payroll/pool.mjs';

const sourceKeys = new Set(['roster','salary','performance','attendance','other','social','fund','grossUpload','netSocial','netFund','tax','afterTax']);
function fail(message, code='PAYROLL_VALIDATION') { const e=new Error(message); e.code=code; throw e; }
const record = value => value !== null && typeof value==='object' && !Array.isArray(value);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
function digest(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function requireText(value, max) { return typeof value==='string' && value.trim().length>0 && value.length<=max; }
export function validateWorkspaceSnapshot(snapshot) {
  if (!record(snapshot) || snapshot.formatVersion!==1 || !['user-import','empty'].includes(snapshot.provenance)) fail('不支持的草稿格式');
  const { batch, sources, results }=snapshot;
  if (!record(batch) || !requireText(batch.name,200) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(batch.month) || !Number(batch.month.slice(0,4))) fail('请填写草稿名称和计薪月份');
  if (!Number.isFinite(Number(batch.workdays)) || Number(batch.workdays)<=0 || Number(batch.workdays)>31) fail('计薪天数应大于 0 且不超过 31');
  if (!record(batch.data) || !record(sources) || !record(results) || !Array.isArray(results.gross) || !Array.isArray(results.net)) fail('草稿缺少资料或结果结构');
  if (Object.hasOwn(batch.data,'sourceRows') || Object.hasOwn(batch,'cloud')) fail('请使用独立的资料结构保存草稿');
  if (batch.workbench?.demoProfiles || Object.values(batch.data.sourceStatus || {}).some(status=>status?.demo===true)) fail('演示资料不能保存到正式数据库','PAYROLL_DEMO_REJECTED');
  if (batch.data.liveImport!==true && snapshot.provenance!=='empty') fail('只有实际导入的资料可以保存到服务器','PAYROLL_DEMO_REJECTED');
  let count=0;
  for (const [key, source] of Object.entries(sources)) {
    if (!sourceKeys.has(key) || !record(source) || !Array.isArray(source.rows) || typeof source.sheetName!=='string' || !Number.isInteger(source.sourceStartRow) || source.sourceStartRow<1) fail('资料类型或工作表行号无效');
    if (source.rows.some(row=>!record(row))) fail('来源资料必须按行保存');
    count+=source.rows.length;
  }
  if (snapshot.provenance==='empty' && (count || results.gross.length || results.net.length)) fail('空白草稿不能携带示例员工或工资','PAYROLL_DEMO_REJECTED');
  if (snapshot.provenance==='user-import' && !count) fail('草稿没有实际导入的资料');
  if (count>100000 || results.gross.length>20000 || results.net.length>20000) fail('单个草稿超出人数或资料行数上限');
  if (Buffer.byteLength(JSON.stringify(snapshot))>20*1024*1024) fail('单个草稿不能超过 20 MB','PAYROLL_TOO_LARGE');
  return snapshot;
}
const metadata = row=>({ id:row.id, revision:row.revision, name:row.name, month:row.month.slice(0,7), updatedAt:new Date(row.updated_at).toISOString() });
export function createWorkspaceService(pool) {
  async function get(actorId,id,revision) {
    const result=await pool.query(`SELECT w.*,v.snapshot,v.created_at AS version_created_at,v.revision AS saved_revision
      FROM payroll.workspaces w JOIN payroll.workspace_versions v ON v.workspace_id=w.id AND v.revision=COALESCE($3::integer,w.revision)
      WHERE w.id=$1 AND w.owner_id=$2`,[id,actorId,revision??null]);
    const row=result.rows[0]; if (!row) fail('未找到该服务器草稿','PAYROLL_NOT_FOUND');
    return { ...metadata(row), revision:row.saved_revision, currentRevision:row.revision, updatedAt:new Date(row.version_created_at).toISOString(), snapshot:row.snapshot };
  }
  async function save({actorId,id,expectedRevision,requestKey,snapshot}) {
    if (!requireText(requestKey,200)) fail('缺少有效的请求标识');
    validateWorkspaceSnapshot(snapshot);
    if (id && (!Number.isInteger(expectedRevision) || expectedRevision<1)) fail('请提供当前草稿版本');
    const operation=id?'workspace.update':'workspace.create';
    const payloadHash=digest({id:id??null,expectedRevision:expectedRevision??null,snapshot});
    const result=await withTransaction(pool,async client=>{
      const actor=(await client.query('SELECT enabled FROM payroll.users WHERE id=$1',[actorId])).rows[0];
      if (!actor?.enabled) fail('请重新登录','PAYROLL_FORBIDDEN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`payroll-request:${requestKey}`]);
      const previous=(await client.query('SELECT * FROM payroll.requests WHERE request_key=$1',[requestKey])).rows[0];
      if (previous) {
        if (previous.actor_id!==actorId || previous.operation!==operation || previous.payload_hash!==payloadHash) fail('请求标识已用于其他内容','PAYROLL_IDEMPOTENCY_CONFLICT');
        return previous.result;
      }
      let workspace;
      if (id) {
        workspace=(await client.query('SELECT * FROM payroll.workspaces WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,actorId])).rows[0];
        if (!workspace) fail('未找到该服务器草稿','PAYROLL_NOT_FOUND');
        if (workspace.revision!==expectedRevision) fail('服务器已有更新版本，请重新读取后再保存','PAYROLL_CONFLICT');
      } else workspace=(await client.query('INSERT INTO payroll.workspaces(owner_id,name,month,revision) VALUES($1,$2,$3,0) RETURNING *',[actorId,snapshot.batch.name,snapshot.batch.month+'-01'])).rows[0];
      const revision=workspace.revision+1;
      await client.query('INSERT INTO payroll.workspace_versions(workspace_id,revision,snapshot,created_by) VALUES($1,$2,$3,$4)',[workspace.id,revision,JSON.stringify(snapshot),actorId]);
      const updated=(await client.query('UPDATE payroll.workspaces SET revision=$2,name=$3,month=$4,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',[workspace.id,revision,snapshot.batch.name,snapshot.batch.month+'-01'])).rows[0];
      await client.query("INSERT INTO payroll.audit_events(actor_id,action,entity_type,entity_id,details) VALUES($1,$2,'workspace',$3,$4)",[actorId,operation,workspace.id,JSON.stringify({revision})]);
      const response=metadata(updated);
      await client.query('INSERT INTO payroll.requests(request_key,operation,actor_id,payload_hash,result) VALUES($1,$2,$3,$4,$5)',[requestKey,operation,actorId,payloadHash,JSON.stringify(response)]);
      return response;
    });
    return { ...result, snapshot };
  }
  return {
    save,get,
    async list(actorId,{month,limit=100,offset=0}={}) {
      if (!Number.isInteger(limit)||limit<1||limit>200||!Number.isInteger(offset)||offset<0) fail('分页参数无效');
      if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail('月份格式无效');
      return (await pool.query('SELECT * FROM payroll.workspaces WHERE owner_id=$1 AND ($2::date IS NULL OR month=$2) ORDER BY updated_at DESC,id LIMIT $3 OFFSET $4',[actorId,month?month+'-01':null,limit,offset])).rows.map(metadata);
    },
    async versions(actorId,id) {
      await get(actorId,id);
      return (await pool.query('SELECT revision,created_at FROM payroll.workspace_versions WHERE workspace_id=$1 ORDER BY revision DESC',[id])).rows.map(row=>({revision:row.revision,updatedAt:new Date(row.created_at).toISOString()}));
    },
  };
}
