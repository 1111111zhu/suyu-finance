import { randomUUID, createHash } from 'node:crypto';
import { withTransaction } from '../payroll/pool.mjs';

const fail = message => { throw Object.assign(new Error(message), {code:'RD_BATCH_VALIDATION'}); };
export function cents(value) {
  if (typeof value !== 'string' || !/^-?\d{1,12}(\.\d{1,2})?$/.test(value)) fail('费用金额必须是精确到分的十进制字符串');
  const negative=value.startsWith('-'), [whole,fraction='']=value.replace('-','').split('.');
  return (negative?-1:1)*(Number(whole)*100+Number(fraction.padEnd(2,'0')));
}
export function validateBatch(input) {
  if (!input || !/^[0-9a-f-]{36}$/i.test(input.requestKey)) fail('缺少有效计算批次标识');
  if (typeof input.scope!=='string'||!input.scope.trim()||input.scope.length>80) fail('请填写本批费用的核算主体');
  if (!Number.isInteger(input.year)||input.year<2000||input.year>2100||!Number.isInteger(input.month)||input.month<1||input.month>12) fail('费用期间无效');
  if (!Array.isArray(input.projects)||!input.projects.length||input.projects.length>1000) fail('计算结果缺少逐项目金额，不能入账');
  const codes=new Set();
  let total=0;
  for (const row of input.projects) {
    if (typeof row.code!=='string'||!row.code.trim()||codes.has(row.code)) fail('计算结果项目编码为空或重复');
    codes.add(row.code);
    if (!Array.isArray(row.costs)||!row.costs.length||row.costs.length>100) fail('项目缺少费用明细');
    const categories=new Set(); let projectTotal=0;
    for (const item of row.costs) {
      if(typeof item.category!=='string'||!item.category||item.category.length>160||categories.has(item.category)) fail('费用类别为空或重复');
      categories.add(item.category);projectTotal+=cents(item.amount);
    }
    if (!Number.isSafeInteger(projectTotal) || projectTotal!==cents(row.total)) fail(`项目 ${row.code} 合计与费用明细不一致`);
    total+=projectTotal;
  }
  if (!Number.isSafeInteger(total) || total!==cents(input.total)) fail('本批总额与各项目合计不一致');
  return {period:`${input.year}-${String(input.month).padStart(2,'0')}-01`,scope:input.scope.trim()};
}
export async function recordProjectBatch(pool,input) {
  const {period,scope}=validateBatch(input);
  const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return withTransaction(pool,async client=>{
    // All writers of the same accounting month serialize; the complete scope snapshot is replaced.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`rd-batch:${scope}:${period}`]);
    const prior=(await client.query('SELECT id,payload_hash FROM rd.calculation_runs WHERE request_key=$1',[input.requestKey])).rows[0];
    if(prior) { if(prior.payload_hash!==hash) fail('批次标识已用于不同计算结果'); return {runId:prior.id,repeated:true,total:input.total}; }
    const found=(await client.query('SELECT id,number,platform_id FROM rd.projects WHERE number=ANY($1::text[]) ORDER BY id FOR UPDATE',[input.projects.map(row=>row.code)])).rows;
    const targets=new Map();
    for(const row of input.projects){
      const matches=found.filter(p=>p.number===row.code);
      if(matches.length!==1||!matches[0].platform_id) fail(`项目 ${row.code} 未找到唯一的平台归属，请先在平台管理中补充。整批未入账。`);
      targets.set(row.code,matches[0].id);
    }
    const runId=randomUUID();
    await client.query('INSERT INTO rd.calculation_runs(id,request_key,scope,period,payload_hash,payload) VALUES($1,$2,$3,$4,$5,$6)',[runId,input.requestKey,scope,period,hash,JSON.stringify(input)]);
    const removed=await client.query(`DELETE FROM rd.ledger_entries WHERE run_id IN (SELECT id FROM rd.calculation_runs WHERE scope=$1 AND period=$2 AND id<>$3) RETURNING project_id`,[scope,period,runId]);
    for(const row of input.projects) for(const item of row.costs) {
      if(cents(item.amount)===0) continue;
      await client.query(`INSERT INTO rd.ledger_entries(id,project_id,entry_date,category,amount,description,source,run_id) VALUES($1,$2,$3,$4,$5,$6,'calculation',$7)`,[randomUUID(),targets.get(row.code),period,item.category,item.amount,`${scope} · ${input.year}年${input.month}月测算`,runId]);
    }
    const touched=[...new Set([...targets.values(),...removed.rows.map(r=>r.project_id)])];
    await client.query('UPDATE rd.projects SET updated_at=CURRENT_TIMESTAMP WHERE id=ANY($1::text[])',[touched]);
    return {runId,repeated:false,total:input.total,projectCount:input.projects.length};
  });
}
