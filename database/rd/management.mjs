import {randomUUID} from 'node:crypto';
import {withTransaction} from '../payroll/pool.mjs';

export const lockCatalog = client => client.query("SELECT pg_advisory_xact_lock(hashtext('rd-catalog-write'))");
const fail = message => { throw Object.assign(new Error(message),{code:'RD_MANAGEMENT'}); };
function field(value,label,max=300) {
  if(typeof value!=='string'||!value.trim()||value.trim().length>max) fail(`请填写有效的${label}`);
  return value.trim();
}
export async function manage(pool,input) {
  if(!input||!['platform','project'].includes(input.kind)||!['create','delete','restore'].includes(input.action)) fail('管理操作无效');
  return withTransaction(pool,async client=>{
    await lockCatalog(client);
    const table=input.kind==='platform'?'rd.platforms':'rd.projects';
    if(input.action==='create') {
      const name=field(input.name,'名称'),number=field(input.number,'编码',80).toUpperCase();
      if((await client.query(`SELECT id FROM ${table} WHERE upper(number)=$1`,[number])).rowCount) fail('该编码已存在（含回收站），请勿重复新增；如已删除，请从回收站恢复');
      const newId=randomUUID();
      if(input.kind==='platform') {
        if((await client.query("SELECT id FROM rd.platforms WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(codes) code WHERE upper(code->>'number')=$1)",[number])).rowCount) fail('该编码已属于现有平台的历年编码（含回收站），请勿重复新增');
        if((await client.query('SELECT id FROM rd.platforms WHERE name=$1',[name])).rowCount) fail('该平台名称已存在（含回收站），请检查或恢复');
        await client.query('INSERT INTO rd.platforms(id,name,number) VALUES($1,$2,$3)',[newId,name,number]);
      } else {
        const platformId=field(input.platformId,'所属平台',120);
        if(!(await client.query('SELECT id FROM rd.platforms WHERE id=$1 AND deleted_at IS NULL',[platformId])).rowCount) fail('所属平台不存在或已删除，请先恢复平台');
        await client.query("INSERT INTO rd.projects(id,name,number,status,budget,platform_id) VALUES($1,$2,$3,'active',0,$4)",[newId,name,number,platformId]);
      }
      return {id:newId};
    }
    const targetId=field(input.id,'记录编号',120);
    const item=(await client.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`,[targetId])).rows[0];
    if(!item) fail('未找到对应记录');
    if(input.action==='delete') {
      if(item.deleted_at) return {id:targetId};
      const group=randomUUID();
      await client.query(`UPDATE ${table} SET deleted_at=CURRENT_TIMESTAMP,deletion_group=$2 WHERE id=$1`,[targetId,group]);
      if(input.kind==='platform') await client.query('UPDATE rd.projects SET deleted_at=CURRENT_TIMESTAMP,deletion_group=$2,updated_at=CURRENT_TIMESTAMP WHERE platform_id=$1 AND deleted_at IS NULL',[targetId,group]);
      else await client.query('UPDATE rd.projects SET updated_at=CURRENT_TIMESTAMP WHERE id=$1',[targetId]);
    } else {
      if(!item.deleted_at) return {id:targetId};
      if(input.kind==='project'&&item.platform_id) {
        const parent=(await client.query('SELECT deleted_at FROM rd.platforms WHERE id=$1',[item.platform_id])).rows[0];
        if(!parent||parent.deleted_at) fail('请先恢复所属平台，再恢复该项目');
      }
      await client.query(`UPDATE ${table} SET deleted_at=NULL,deletion_group=NULL WHERE id=$1`,[targetId]);
      if(input.kind==='platform') await client.query('UPDATE rd.projects SET deleted_at=NULL,deletion_group=NULL,updated_at=CURRENT_TIMESTAMP WHERE platform_id=$1 AND deletion_group=$2',[targetId,item.deletion_group]);
      else await client.query('UPDATE rd.projects SET updated_at=CURRENT_TIMESTAMP WHERE id=$1',[targetId]);
    }
    return {id:targetId};
  });
}
export async function listTrash(pool) {
  const platforms=(await pool.query(`SELECT p.id,'platform' AS kind,p.name,p.number,p.deleted_at AS "deletedAt",false AS "parentDeleted",
    (SELECT count(*)::int FROM rd.projects q WHERE q.platform_id=p.id) AS "projectCount",
    COALESCE((SELECT SUM(l.amount) FROM rd.ledger_entries l JOIN rd.projects q ON q.id=l.project_id WHERE q.platform_id=p.id AND (l.run_id IS NULL OR EXISTS(SELECT 1 FROM rd.calculation_runs cr WHERE cr.id=l.run_id AND cr.status='confirmed'))),0)
      + COALESCE((SELECT SUM(e.amount) FROM rd.platform_ledger_entries e JOIN rd.calculation_runs cr ON cr.id=e.run_id WHERE e.platform_id=p.id AND cr.status='confirmed'),0) AS actual
    FROM rd.platforms p WHERE p.deleted_at IS NOT NULL ORDER BY p.deleted_at DESC`)).rows;
  const projects=(await pool.query(`SELECT p.id,'project' AS kind,p.name,p.number,p.deleted_at AS "deletedAt",f.name AS "platformName",COALESCE(f.deleted_at IS NOT NULL,false) AS "parentDeleted",
    COALESCE((SELECT SUM(l.amount) FROM rd.ledger_entries l WHERE l.project_id=p.id AND (l.run_id IS NULL OR EXISTS(SELECT 1 FROM rd.calculation_runs cr WHERE cr.id=l.run_id AND cr.status='confirmed'))),0) AS actual
    FROM rd.projects p LEFT JOIN rd.platforms f ON f.id=p.platform_id WHERE p.deleted_at IS NOT NULL ORDER BY p.deleted_at DESC`)).rows;
  return [...platforms,...projects].map(p=>({...p,actual:Number(p.actual),deletedAt:new Date(p.deletedAt).toISOString()}));
}
