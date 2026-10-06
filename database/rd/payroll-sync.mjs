import {createHash} from 'node:crypto';
import {withTransaction} from '../payroll/pool.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS=new Set(['gross','company_social','company_fund']);
const fail=(message,code='RD_BATCH_VALIDATION')=>{throw Object.assign(new Error(message),{code});};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function cents(value) {
 const s=String(value??'');if(!/^\d{1,15}(\.\d{1,2})?$/.test(s)) fail('费用缺失或不是非负两位小数金额');
 const [a,b='']=s.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));
}
const money=n=>`${n/100n}.${String(n%100n).padStart(2,'0')}`;
export function calculateLabor(items,input) {
 if(!input.rule || typeof input.rule.version!=='string'||!input.rule.version.trim()||input.rule.version.length>100||!Array.isArray(input.rule.fields)||!input.rule.fields.length||new Set(input.rule.fields).size!==input.rule.fields.length||input.rule.fields.some(f=>!FIELDS.has(f))) fail('请明确费用口径版本及应发工资、单位社保、公积金字段');
 if(!Array.isArray(input.allocations)||!input.allocations.length||input.allocations.length>20000)fail('请提供人工费用分摊');
 const people=new Map(items.map(i=>[i.employee_id,i]));if(people.size!==items.length)fail('来源员工身份重复');
 const groups=new Map();for(const a of input.allocations){
  if(!UUID.test(a.employeeId||'')||!people.has(a.employeeId)||typeof a.projectId!=='string'||!a.projectId||a.projectId.length>120||!Number.isInteger(a.basisPoints)||a.basisPoints<=0||a.basisPoints>10000||typeof a.hoursEvidence!=='string'||!a.hoursEvidence.trim()||a.hoursEvidence.length>1000)fail('人员 ID、项目、分摊比例或工时依据无效');
  const rows=groups.get(a.employeeId)||[];if(rows.some(r=>r.projectId===a.projectId))fail('同一人员项目分摊重复');rows.push(a);groups.set(a.employeeId,rows);
 }
 const allocations=[],personnel=[],totals=new Map();let totalSource=0n,totalAllocated=0n;
 for(const [id,rows]of groups){
  const item=people.get(id);const source=input.rule.fields.reduce((sum,f)=>sum+cents(item[f]),0n);
  const bp=rows.reduce((sum,a)=>sum+a.basisPoints,0);if(bp>10000)fail('人员项目工时分摊不能超过 100%');
  // Floor each project; keep the exact residual explicit instead of inventing allocation.
  let allocated=0n;for(const row of rows){const amount=source*BigInt(row.basisPoints)/10000n;allocated+=amount;totals.set(row.projectId,(totals.get(row.projectId)||0n)+amount);allocations.push({...row,amount:money(amount)});}
  personnel.push({employeeId:id,sourceItemId:item.id,fields:Object.fromEntries(input.rule.fields.map(f=>[f,String(item[f])])),source:money(source),allocated:money(allocated),unallocated:money(source-allocated),basisPoints:bp});totalSource+=source;totalAllocated+=allocated;
 }
 return {personnel,allocations,totals:{source:money(totalSource),allocated:money(totalAllocated),unallocated:money(totalSource-totalAllocated),projects:[...totals].map(([projectId,amount])=>({projectId,amount:money(amount)}))}};
}
async function source(client,runId){
 const run=(await client.query(`SELECT r.id,r.batch_id,r.version,r.status,b.month,b.current_run_id,b.status batch_status FROM payroll.runs r JOIN payroll.batches b ON b.id=r.batch_id WHERE r.id=$1`,[runId])).rows[0];
 if(!run||run.status!=='confirmed'||!['confirmed','archived'].includes(run.batch_status)||run.current_run_id!==run.id)fail('仅可归集当前已确认工资版本','RD_CONFLICT');
 const items=(await client.query("SELECT id,employee_id,employee_snapshot->>'name' AS name,gross,company_social,company_fund FROM payroll.items WHERE run_id=$1 ORDER BY employee_id",[runId])).rows;
 if(!items.length)fail('已确认工资没有人员明细');return {run,items};
}
export function createPayrollSyncService({rdPool,payrollPool}){return {
 async sync(input,actorId){
  if(!UUID.test(input.requestKey||'')||!UUID.test(input.runId||'')||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1000||(input.supersedes!=null&&!UUID.test(input.supersedes)))fail('请求标识、来源批次或确认原因无效');
  const payloadHash=hash(input);
  const task=await withTransaction(rdPool,async c=>{
   await c.query('INSERT INTO rd.payroll_sync_tasks(request_key,payload_hash,payload,actor_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[input.requestKey,payloadHash,JSON.stringify(input),actorId]);
   const row=(await c.query('SELECT * FROM rd.payroll_sync_tasks WHERE request_key=$1 FOR UPDATE',[input.requestKey])).rows[0];
   if(row.payload_hash!==payloadHash||row.actor_id!==actorId)fail('请求标识已用于其他内容','RD_CONFLICT');return row;
  });
  if(task.status==='completed')return task.result;
  try{return await withTransaction(payrollPool,async payroll=>{
   // Hold the authoritative batch lock through target commit: a concurrent salary revision cannot race this sync.
   const initial=await source(payroll,input.runId);await payroll.query('SELECT id FROM payroll.batches WHERE id=$1 FOR SHARE',[initial.run.batch_id]);
   const data=await source(payroll,input.runId),calculated=calculateLabor(data.items,input),sourceHash=hash(data);
   return withTransaction(rdPool,async c=>{
    await c.query("SELECT pg_advisory_xact_lock(hashtext('rd-catalog-write'))");
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['rd-payroll-confirmation']);
    const state=(await c.query('SELECT * FROM rd.payroll_sync_tasks WHERE id=$1 FOR UPDATE',[task.id])).rows[0];if(state.status==='completed')return state.result;
    const prior=(await c.query(`SELECT s.* FROM rd.payroll_labor_current x JOIN rd.payroll_labor_snapshots s ON s.id=x.snapshot_id WHERE x.source_batch_id=$1`,[data.run.batch_id])).rows[0];
    if((prior?.id||null)!==(input.supersedes||null))fail('已有已确认人工费用，请明确选择修订版本','RD_CONFLICT');
    const ruleRows=(await c.query("SELECT rule FROM rd.payroll_labor_snapshots WHERE rule->>'version'=$1 LIMIT 1",[input.rule.version])).rows;
    if(ruleRows.length && hash([...ruleRows[0].rule.fields].sort())!==hash([...input.rule.fields].sort()))fail('同一费用口径版本不可更改字段，请创建新版本');
    const overlapping=await c.query(`SELECT 1 FROM rd.payroll_labor_current x JOIN rd.payroll_labor_snapshots s ON s.id=x.snapshot_id CROSS JOIN LATERAL jsonb_array_elements(s.personnel) p WHERE s.month=$1 AND s.source_batch_id<>$2 AND p->>'employeeId'=ANY($3::text[]) LIMIT 1`,[data.run.month,data.run.batch_id,calculated.personnel.map(p=>p.employeeId)]);
    if(overlapping.rowCount)fail('该月份人员已在另一工资批次归集，不能重复入账','RD_CONFLICT');
    if(calculated.totals.projects.some(p=>cents(p.amount)>9999999999999999n))fail('项目人工费用超过台账金额范围');
    const ids=calculated.totals.projects.map(p=>p.projectId);const valid=await c.query(`SELECT p.id FROM rd.projects p LEFT JOIN rd.platforms f ON f.id=p.platform_id WHERE p.id=ANY($1::text[]) AND p.deleted_at IS NULL AND (p.platform_id IS NULL OR f.deleted_at IS NULL) FOR KEY SHARE OF p`,[ids]);if(valid.rowCount!==ids.length)fail('存在无效或已删除研发项目/平台');
    const conflict=await c.query(`SELECT 1 FROM rd.ledger_entries l LEFT JOIN rd.calculation_runs cr ON cr.id=l.run_id WHERE l.project_id=ANY($1::text[]) AND date_trunc('month',l.entry_date)=date_trunc('month',$2::date) AND l.id NOT LIKE 'payroll:%' AND l.amount<>0 AND l.category ~ '人工|薪|工资|社保|公积金' AND (l.run_id IS NULL OR cr.status='confirmed') LIMIT 1`,[ids,data.run.month]);
    if(conflict.rowCount)fail('该项目月份已有人工费用，请先核对历史归集，避免与工资重复入账','RD_CONFLICT');
    const history=await c.query(`SELECT 1 FROM rd.analysis_imports i JOIN rd.analysis_import_lines d ON d.import_id=i.id WHERE i.period=$1 AND i.status='active' AND d.amount<>0 AND d.category ~ '人工|薪|工资|社保|公积金' AND NOT EXISTS (SELECT 1 FROM rd.calculation_runs cr WHERE cr.scope=i.scope AND cr.period=i.period AND cr.status='confirmed') LIMIT 1`,[data.run.month]);
    if(history.rowCount)fail('该月已有历史人工汇总，无法判定与工资是否重叠，请经理先核对并处理历史来源','RD_CONFLICT');
    const row=(await c.query(`INSERT INTO rd.payroll_labor_snapshots(task_id,source_batch_id,source_run_id,source_version,month,revision,supersedes,rule,source_hash,personnel,allocations,totals,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id,revision`,[task.id,data.run.batch_id,data.run.id,data.run.version,data.run.month,(prior?.revision||0)+1,prior?.id||null,JSON.stringify(input.rule),sourceHash,JSON.stringify(calculated.personnel),JSON.stringify(calculated.allocations),JSON.stringify(calculated.totals),input.reason,actorId])).rows[0];
    await c.query("SELECT set_config('rd.payroll_sync_snapshot',$1,true)",[row.id]);
    // Ledger is the current projection; all replaced records remain in immutable snapshots.
    if(prior)await c.query("DELETE FROM rd.ledger_entries WHERE id LIKE $1 AND source='import'",[`payroll:${prior.id}:%`]);
    for(let i=0;i<calculated.totals.projects.length;i++){const p=calculated.totals.projects[i];await c.query(`INSERT INTO rd.ledger_entries(id,project_id,entry_date,category,amount,description,source) VALUES($1,$2,$3,'人工费用',$4,$5,'import')`,[`payroll:${row.id}:${i}`,p.projectId,data.run.month,p.amount,`工资归集版本 ${row.revision}`]);}
    await c.query('INSERT INTO rd.payroll_labor_current(source_batch_id,snapshot_id) VALUES($1,$2) ON CONFLICT(source_batch_id) DO UPDATE SET snapshot_id=EXCLUDED.snapshot_id',[data.run.batch_id,row.id]);
    const result={snapshotId:row.id,revision:row.revision,month:data.run.month,totals:calculated.totals};await c.query("UPDATE rd.payroll_sync_tasks SET status='completed',attempts=attempts+1,error_code=NULL,result=$2,updated_at=now() WHERE id=$1",[task.id,JSON.stringify(result)]);return result;
   });
  });}catch(error){await rdPool.query("UPDATE rd.payroll_sync_tasks SET status='failed',attempts=attempts+1,error_code=$2,updated_at=now() WHERE id=$1 AND status<>'completed'",[task.id,String(error.code||'DATABASE_FAILURE').slice(0,80)]);throw error;}
 },
 async list(manager=false){const rows=(await rdPool.query(`SELECT s.* FROM rd.payroll_labor_current x JOIN rd.payroll_labor_snapshots s ON s.id=x.snapshot_id ORDER BY s.month DESC`)).rows;if(!manager)return rows.map(s=>({snapshotId:s.id,month:s.month,revision:s.revision,projects:s.totals.projects}));
 const states=(await payrollPool.query('SELECT id,current_run_id,status FROM payroll.batches WHERE id=ANY($1::uuid[])',[rows.map(s=>s.source_batch_id)])).rows;
 return rows.map(s=>{const batch=states.find(b=>b.id===s.source_batch_id);return{...s,sourceChanged:!batch||batch.current_run_id!==s.source_run_id||!['confirmed','archived'].includes(batch.status)};});},
 async sources(){return (await payrollPool.query(`SELECT r.id run_id,r.batch_id,r.version,b.month,b.name FROM payroll.batches b JOIN payroll.runs r ON r.id=b.current_run_id WHERE b.status IN ('confirmed','archived') AND r.status='confirmed' ORDER BY b.month DESC`)).rows;},
 async personnel(runId){if(!UUID.test(runId||''))fail('来源版本无效');return withTransaction(payrollPool,async c=>(await source(c,runId)).items);}
};}
