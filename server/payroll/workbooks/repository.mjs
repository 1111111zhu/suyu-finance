import {createHash,randomUUID} from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function createWorkbookRepository(pool) {
  const select=`SELECT m.id,m.workbook_key AS key,v.revision,v.filename,v.snapshot,v.rows,v.warnings,
    v.request_sha256 AS "requestSha256",v.original_id AS "originalId",v.created_at AS "updatedAt"
    FROM payroll.workbook_masters m JOIN payroll.workbook_versions v ON v.master_id=m.id`;
  async function read(owner,key,revision,client=pool) {
    const {rows}=await client.query(select+` WHERE m.owner_id=$1 AND m.workbook_key=$2 AND v.revision=COALESCE($3,m.revision)`,[owner,key,revision||null]);
    return rows[0]||null;
  }
  return {
    read,
    async original(owner,id) {
      const {rows}=await pool.query('SELECT bytes,filename FROM payroll.workbook_originals WHERE owner_id=$1 AND id=$2',[owner,id]);
      if(!rows[0])throw fail(404,'原始文件不存在');return rows[0];
    },
    async save(owner,key,input) {
      if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0 ||
        !/^[a-f0-9-]{36}$/i.test(input.requestKey||''))throw fail(400,'保存版本或请求编号无效');
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[owner+':'+key]);
        const current=await read(owner,key,null,client);
        if(current) {
          const retried=(await client.query(select+' WHERE m.owner_id=$1 AND m.workbook_key=$2 AND v.request_key=$3',[owner,key,input.requestKey])).rows[0];
          if(retried){if(retried.requestSha256!==input.requestSha256)throw fail(409,'重复请求的工作簿内容已改变，请重新保存');await client.query('COMMIT');return retried;}
        }
        if((current?.revision||0)!==input.expectedRevision)throw fail(409,'该表已被另一处修改，请关闭并重新打开后保存');
        let originalId=input.originalId||null;
        if(input.originalBase64) {
          const bytes=Buffer.from(input.originalBase64,'base64');
          if(!bytes.length||bytes.length>20*1024*1024)throw fail(413,'原始 Excel 超过 20MB');
          const hash=createHash('sha256').update(bytes).digest('hex');
          const existing=(await client.query('SELECT id FROM payroll.workbook_originals WHERE owner_id=$1 AND sha256=$2',[owner,hash])).rows[0];
          originalId=existing?.id;
          if(!originalId)originalId=(await client.query('INSERT INTO payroll.workbook_originals(owner_id,sha256,filename,bytes) VALUES($1,$2,$3,$4) RETURNING id',[owner,hash,input.filename,bytes])).rows[0].id;
        } else if(originalId && !(await client.query('SELECT 1 FROM payroll.workbook_originals WHERE id=$1 AND owner_id=$2',[originalId,owner])).rowCount)throw fail(404,'原始文件不存在');
        const id=current?.id||randomUUID(),revision=(current?.revision||0)+1;
        if(!current)await client.query('INSERT INTO payroll.workbook_masters(id,owner_id,workbook_key,revision) VALUES($1,$2,$3,$4)',[id,owner,key,revision]);
        await client.query(`INSERT INTO payroll.workbook_versions(master_id,revision,request_key,request_sha256,filename,snapshot,rows,warnings,original_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,revision,input.requestKey,input.requestSha256,input.filename,JSON.stringify(input.snapshot),JSON.stringify(input.rows),JSON.stringify(input.warnings||[]),originalId]);
        if(current)await client.query('UPDATE payroll.workbook_masters SET revision=$2,updated_at=clock_timestamp() WHERE id=$1',[id,revision]);
        const record=await read(owner,key,revision,client);await client.query('COMMIT');return record;
      } catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    },
  };
}
