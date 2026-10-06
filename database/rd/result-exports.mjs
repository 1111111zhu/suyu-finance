import {readArtifact} from './artifact-store.mjs';
import {createHash} from 'node:crypto';
import {zipSync} from 'fflate';
import {withTransaction} from '../payroll/pool.mjs';

const fail=message=>{throw Object.assign(new Error(message),{code:'RD_EXPORT_VALIDATION'});};
export function validateExportRange({startMonth,endMonth,scope=''}) {
  const index=value=>{
    if(typeof value!=='string'||!/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(value)) fail('请选择 2000 至 2100 年之间的有效月份');
    const [year,month]=value.split('-').map(Number);return year*12+month-1;
  };
  const start=index(startMonth),end=index(endMonth);
  if(end<start||end-start>=120) fail('结束月份不能早于开始月份，单次最多导出 120 个月');
  if(typeof scope!=='string'||scope.length>80) fail('核算主体无效');
  return {startMonth,endMonth,scope:scope.trim(),months:Array.from({length:end-start+1},(_,i)=>`${Math.floor((start+i)/12)}-${String((start+i)%12+1).padStart(2,'0')}`)};
}

/** A latest run without a file is intentionally not replaced by an older file. */
export async function exportResults(pool,input,download=false) {
  const range=validateExportRange(input);
  return withTransaction(pool,async client=>{
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const scopes=range.scope?[range.scope]:(await client.query('SELECT DISTINCT scope FROM rd.calculation_runs WHERE period >= $1::date AND period <= $2::date ORDER BY scope',[`${range.startMonth}-01`,`${range.endMonth}-01`])).rows.map(r=>r.scope);
    const latest=(await client.query(`WITH latest AS (
      SELECT DISTINCT ON (scope,period) id,scope,period,payload
      FROM rd.calculation_runs WHERE period >= $1::date AND period <= $2::date AND ($3='' OR scope=$3)
      ORDER BY scope,period,created_at DESC,revision DESC
    ) SELECT r.id,r.scope,to_char(r.period,'YYYY-MM') AS month,r.payload->>'total' AS total,
      f.run_id IS NOT NULL AS "fileAvailable",octet_length(f.content) AS size
      FROM latest r LEFT JOIN rd.result_files f ON f.run_id=r.id ORDER BY r.scope,r.period`,[`${range.startMonth}-01`,`${range.endMonth}-01`,range.scope])).rows;
    const records=latest.map(({scope,month,total,fileAvailable})=>({scope,month,total:total??'0.00',fileAvailable}));
    const missing=[];
    if(!scopes.length) for(const month of range.months) missing.push({scope:'全部主体',month,reason:'该月尚无已入账的测算结果'});
    for(const scope of scopes) for(const month of range.months){
      const row=latest.find(r=>r.scope===scope&&r.month===month);
      if(!row) missing.push({scope,month,reason:'该月尚无已入账的测算结果'});
      else if(!row.fileAvailable) missing.push({scope,month,reason:'最新测算未归档模板结果文件，请重新测算并入账'});
    }
    const preview={startMonth:range.startMonth,endMonth:range.endMonth,scope:range.scope,ready:missing.length===0,records,missing};
    if(!download) return preview;
    if(!preview.ready) fail(`无法完整导出：${missing.slice(0,8).map(r=>`${r.scope} ${r.month}：${r.reason}`).join('；')}${missing.length>8?'；其余缺失请查看预览':''}`);
    if(latest.reduce((n,r)=>n+Number(r.size),0)>100*1024*1024) fail('结果文件合计超过 100 MB，请缩短月份范围或选择单一主体');
    const files=(await client.query('SELECT run_id,filename,sha256,content FROM rd.result_files WHERE run_id=ANY($1::uuid[])',[latest.map(r=>r.id)])).rows;
    const archive={};
    for(const row of latest){
      const file=files.find(f=>f.run_id===row.id);
      if(!file||createHash('sha256').update(file.content).digest('hex')!==file.sha256) fail('归档结果校验失败，请联系管理员核对');
      file.content=await readArtifact(client,{kind:'result_file',objectId:row.id,...file});
      const safeScope=row.scope.replace(/[^\p{L}\p{N}._-]/gu,'_').slice(0,60);
      const suffix=createHash('sha256').update(row.scope).digest('hex').slice(0,12);
      archive[`${safeScope}-${suffix}/${row.month}/研发费用测算结果.xlsx`]=[new Uint8Array(file.content),{level:0}];
    }
    return {filename:`研发费用测算结果_${range.startMonth}_${range.endMonth}.zip`,content:zipSync(archive)};
  });
}
