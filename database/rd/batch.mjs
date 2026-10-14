import {storeArtifact} from './artifact-store.mjs';
import { unzipSync } from 'fflate';
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
    if (typeof row.code!=='string'||!row.code.trim()||row.code.trim().length>80||codes.has(row.code.trim().toUpperCase())) fail('计算结果项目或平台编码为空、过长或重复');
    codes.add(row.code.trim().toUpperCase());
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
async function writeBatch(client,input) {
  const {period,scope}=validateBatch(input);
  const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const resultFile=input.resultFile?validateResultFile(input.resultFile):null;
  const sourceFiles=validateSourceFiles(input);
  const stored={...input,sourceFiles:sourceFiles.map(({name,sha256,content,byteSize})=>({name,sha256,byteSize:content?.length??byteSize})),resultFile:resultFile?{filename:resultFile.filename,sha256:resultFile.sha256}:undefined};
    // All writers of the same accounting month serialize; the complete scope snapshot is replaced.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`rd-batch:${scope}:${period}`]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext('rd-catalog-write'))");
    const prior=(await client.query('SELECT id,payload_hash,status FROM rd.calculation_runs WHERE request_key=$1',[input.requestKey])).rows[0];
    if(prior) {
      if(prior.payload_hash!==hash) fail('批次标识已用于不同计算结果');
      const projectCount=Number((await client.query('SELECT count(DISTINCT project_id)::int AS n FROM rd.ledger_entries WHERE run_id=$1',[prior.id])).rows[0].n);
      const platform=(await client.query('SELECT count(DISTINCT source_code)::int AS n,COALESCE(SUM(amount),0)::text AS total FROM rd.platform_ledger_entries WHERE run_id=$1',[prior.id])).rows[0];
      return {runId:prior.id,repeated:true,status:prior.status,total:input.total,projectCount,platformOnlyCount:Number(platform.n),platformOnlyTotal:platform.total};
    }
    const codes=input.projects.map(row=>row.code.trim().toUpperCase());
    if ((await client.query('SELECT id FROM rd.projects WHERE upper(number)=ANY($1::text[]) AND deleted_at IS NOT NULL',[codes])).rowCount) fail('计算编码在回收站，请先恢复');
    if ((await client.query(`SELECT l.id FROM rd.ledger_entries l JOIN rd.projects p ON p.id=l.project_id JOIN rd.calculation_runs cr ON cr.id=l.run_id WHERE cr.scope=$1 AND cr.period=$2 AND cr.status='confirmed' AND p.deleted_at IS NOT NULL`,[scope,period])).rowCount) fail('当前期间含回收站费用，请先恢复后重新确认');
    if ((await client.query(`SELECT l.id FROM rd.ledger_entries l JOIN rd.projects p ON p.id=l.project_id WHERE l.source='calculation' AND l.run_id IS NULL AND date_trunc('month',l.entry_date)=$1::date AND upper(p.number)=ANY($2::text[])`,[period,codes])).rowCount) fail('请先核对历史账，历史未标记主体测算不能叠加入账');

    const found=(await client.query(`SELECT p.id,p.number,p.platform_id,a.platform_id AS annual_platform_id
      FROM rd.projects p LEFT JOIN rd.annual_platforms a ON a.code=p.annual_platform_code
      WHERE upper(p.number)=ANY($1::text[]) AND p.deleted_at IS NULL ORDER BY p.id FOR UPDATE OF p`,[codes])).rows;
    const annual=(await client.query('SELECT code,platform_id FROM rd.annual_platforms WHERE upper(code)=ANY($1::text[])',[codes])).rows;
    const platforms=(await client.query('SELECT id,number,codes FROM rd.platforms WHERE deleted_at IS NULL')).rows;
    const activePlatformIds=new Set(platforms.map(p=>p.id));
    const targets=new Map();
    for(const row of input.projects){
      const code=row.code.trim().toUpperCase();
      const matches=found.filter(p=>p.number.toUpperCase()===code);
      const owners=new Set([
        ...matches.map(p=>p.platform_id),
        ...matches.map(p=>p.annual_platform_id),
        ...annual.filter(p=>p.code.toUpperCase()===code).map(p=>p.platform_id),
        ...platforms.filter(p=>p.number?.toUpperCase()===code).map(p=>p.id),
        ...platforms.filter(p=>Array.isArray(p.codes)&&p.codes.some(item=>typeof item?.number==='string'&&item.number.toUpperCase()===code)).map(p=>p.id),
      ].filter(Boolean));
      if(owners.size!==1||!activePlatformIds.has([...owners][0])) fail(`编码 ${row.code} 未找到唯一的有效平台归属，请在平台管理中核对。整批未入账。`);
      const platformId=[...owners][0];
      targets.set(code,{projectId:matches.length===1&&matches[0].platform_id===platformId?matches[0].id:null,platformId});
    }
    for(const row of input.projects) {
      const target=targets.get(row.code.trim().toUpperCase());
      if(target.projectId && row.costs.some(item=>/人工|薪|工资|社保|公积金/.test(item.category)&&cents(item.amount)!==0)) {
        const payroll=await client.query("SELECT 1 FROM rd.ledger_entries WHERE project_id=$1 AND date_trunc('month',entry_date)=$2::date AND id LIKE 'payroll:%' LIMIT 1",[target.projectId,period]);
        if(payroll.rowCount)fail('当前项目月份已有工资归集人工费用，请先核对来源，不能重复确认人工费用');
      }
    }
    const runId=randomUUID();
    const superseded=await client.query(`UPDATE rd.calculation_runs
      SET status='superseded',superseded_at=CURRENT_TIMESTAMP,superseded_by=NULL
      WHERE scope=$1 AND period=$2 AND status='confirmed' RETURNING id`,[scope,period]);
    await client.query(`INSERT INTO rd.calculation_runs(id,request_key,scope,period,payload_hash,payload,status,confirmed_at)
      VALUES($1,$2,$3,$4,$5,$6,'confirmed',CURRENT_TIMESTAMP)`,[runId,input.requestKey,scope,period,hash,JSON.stringify(stored)]);
    if(resultFile) await client.query('INSERT INTO rd.result_files(run_id,filename,sha256,content) VALUES($1,$2,$3,$4)',[runId,resultFile.filename,resultFile.sha256,resultFile.content]);
    if(resultFile) await storeArtifact(client,{kind:'result_file',objectId:runId,...resultFile});
    for(let index=0;index<sourceFiles.length;index++){const source=sourceFiles[index];const content=source.load?await source.load():source.content;if(createHash('sha256').update(content).digest('hex')!==source.sha256||content.length!==(source.byteSize??content.length))fail('来源文件摘要或大小校验失败');await storeArtifact(client,{kind:'source_document',objectId:`${runId}:${index}`,...source,content});}
    if(superseded.rowCount) await client.query(`UPDATE rd.calculation_runs SET superseded_by=$1 WHERE id=ANY($2::uuid[])`,[runId,superseded.rows.map(row=>row.id)]);
    for(const row of input.projects) for(const item of row.costs) {
      if(cents(item.amount)===0) continue;
      const target=targets.get(row.code.trim().toUpperCase());
      if(target.projectId) await client.query(`INSERT INTO rd.ledger_entries(id,project_id,entry_date,category,amount,description,source,run_id) VALUES($1,$2,$3,$4,$5,$6,'calculation',$7)`,[randomUUID(),target.projectId,period,item.category,item.amount,`${scope} · ${input.year}年${input.month}月测算`,runId]);
      else await client.query(`INSERT INTO rd.platform_ledger_entries(id,platform_id,source_code,entry_date,category,amount,description,run_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[randomUUID(),target.platformId,row.code.trim(),period,item.category,item.amount,`${scope} · ${input.year}年${input.month}月平台直归费用`,runId]);
    }
    const touched=[...new Set([...targets.values()].map(target=>target.projectId).filter(Boolean))];
    if(touched.length) await client.query('UPDATE rd.projects SET updated_at=CURRENT_TIMESTAMP WHERE id=ANY($1::text[])',[touched]);
    const projectCount=[...targets.values()].filter(target=>target.projectId).length;
    const platformOnlyRows=input.projects.filter(row=>!targets.get(row.code.trim().toUpperCase()).projectId);
    const platformOnlyTotal=(platformOnlyRows.reduce((sum,row)=>sum+cents(row.total),0)/100).toFixed(2);
    return {runId,repeated:false,status:'confirmed',total:input.total,projectCount,platformOnlyCount:platformOnlyRows.length,platformOnlyTotal};
}

export async function confirmProjectBatch(pool,input) { return withTransaction(pool,client=>writeBatch(client,input)); }
export const recordProjectBatch=confirmProjectBatch;
export function validateResultFile(file) {
 if(!file || typeof file.filename!=='string' || !file.filename.endsWith('.xlsx') || /[\\/]/.test(file.filename) || file.filename.length>255) fail('归档文件名无效');
 if(typeof file.base64!=='string'||file.base64.length>69905068||!file.base64.length||file.base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) fail('归档文件编码无效');
 const content=Buffer.from(file.base64,'base64');
 if(content.length>52428800||content.length<4||content.toString('base64')!==file.base64) fail('归档文件大小无效');
 try {let expanded=0;const files=unzipSync(content,{filter:file=>{expanded+=file.originalSize;if(expanded>536870912)fail('Excel解压后过大');return ['[Content_Types].xml','xl/workbook.xml'].includes(file.name);}});if(!files['[Content_Types].xml']||!files['xl/workbook.xml'])fail('无效Excel归档');}catch{fail('无效Excel归档');}
 return {filename:file.filename,content,sha256:createHash('sha256').update(content).digest('hex')};
}
export async function recordProjectBatches(pool,inputs) {
 if(!Array.isArray(inputs)||!inputs.length||inputs.length>120)fail('月份批次无效');
 const periods=new Set();
 for(const input of inputs){const {period,scope}=validateBatch(input);if(scope!==inputs[0].scope.trim()||input.year!==inputs[0].year||periods.has(period)||!input.resultFile)fail('多月批次期间、主体或归档无效');periods.add(period);validateResultFile(input.resultFile);}
 return withTransaction(pool,async client=>{
   const results=new Map();
   for(const input of [...inputs].sort((a,b)=>a.month-b.month))results.set(input,await writeBatch(client,input));
   return {results:inputs.map(input=>results.get(input))};
 });
}

export function validateSourceFiles(input) {
 if(input.sourceFiles===undefined)return [];
 if(!Array.isArray(input.sourceFiles)||input.sourceFiles.length>(input.sourceFiles.every(file=>typeof file?.load==='function')?200:100)||!Array.isArray(input.files)||input.files.length!==input.sourceFiles.length)fail('来源文件与核算证据不一致');
 let size=0;
 return input.sourceFiles.map((file,index)=>{
  if(typeof file?.name!=='string'||!file.name.length||file.name.length>255||/[\\/\x00-\x1f]/.test(file.name)||!/^[a-f0-9]{64}$/.test(file.sha256||''))fail('来源文件名称或摘要无效');
  const evidence=input.files[index];if(evidence?.name!==file.name||evidence?.sha256!==file.sha256)fail('来源文件与核算证据不一致');
  if(typeof file.load==='function'){if(!Number.isInteger(file.byteSize)||file.byteSize<1||file.byteSize>50*1024*1024)fail('来源文件大小无效');size+=file.byteSize;if(size>10000*1024*1024)fail('来源批次大小无效');return {...file};}
  if(typeof file.base64!=='string'||!file.base64.length||file.base64.length>69905068||file.base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64))fail('来源文件编码或大小无效');
  const content=Buffer.from(file.base64,'base64');size+=content.length;
  if(content.length>50*1024*1024||size>5000*1024*1024||content.toString('base64')!==file.base64||createHash('sha256').update(content).digest('hex')!==file.sha256)fail('来源文件摘要或大小校验失败');
  return {name:file.name,sha256:file.sha256,content};
 });
}
