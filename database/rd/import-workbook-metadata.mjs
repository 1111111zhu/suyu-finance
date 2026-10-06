import {readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPool,withTransaction} from '../payroll/pool.mjs';
import {migrate} from './migrate.mjs';
const execute=promisify(execFile);

export async function readWorkbookMetadata(path){
  const {stdout}=await execute('python3',[fileURLToPath(new URL('./read-workbook-metadata.py',import.meta.url)),path]);
  return JSON.parse(stdout);
}

export async function importWorkbookMetadata(pool,path){
  const metadata=await readWorkbookMetadata(path);
  const content=await readFile(path);
  const sha256=createHash('sha256').update(content).digest('hex');
  const filename=basename(path);
  return withTransaction(pool,async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext('rd-catalog-write'))");
    await client.query('INSERT INTO rd.source_documents(sha256,filename,content) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[sha256,filename,content]);
    await client.query(`INSERT INTO rd.source_registry(filename,sha256,status,note) VALUES($1,$2,'available','Excel原始清单，metadata只读提取')
      ON CONFLICT(filename) DO UPDATE SET sha256=EXCLUDED.sha256,status=EXCLUDED.status,note=EXCLUDED.note`,[filename,sha256]);
    for(const platform of metadata.platforms){
      const result=await client.query('UPDATE rd.platforms SET codes=$2::jsonb,number=COALESCE(number,$3) WHERE id=$1',[platform.id,JSON.stringify(platform.codes),platform.codes.at(-1).number]);
      if(result.rowCount!==1)throw new Error(`Missing platform ${platform.id}`);
    }
    for(const project of metadata.projects){
      const existing=(await client.query('SELECT id,platform_id,source_records FROM rd.projects WHERE number=$1 FOR UPDATE',[project.number])).rows;
      if(existing.length!==1||existing[0].platform_id!==project.platformId)throw new Error(`项目 ${project.number} 归属或唯一性不匹配`);
      const source={filename,sha256,year:project.sourceYear,sheet:project.sheet,rows:project.rows,note:project.note,sourceName:project.sourceName};
      const records=[...(existing[0].source_records??[]).filter(record=>record.filename!==filename),source];
      await client.query(`UPDATE rd.projects SET source_year=$2,source_status=$3,financial_entity=$4,materials=$5::jsonb,parent_number=$6,source_records=$7::jsonb WHERE id=$1`,
        [existing[0].id,project.sourceYear,project.sourceStatus,project.financialEntity,JSON.stringify(project.materials),project.parentNumber,JSON.stringify(records)]);
    }
    return {platforms:metadata.platforms.length,projects:metadata.projects.length,materials:metadata.projects.reduce((n,p)=>n+p.materials.length,0),sha256};
  });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const pool=createPool({connectionString:process.env.RD_DATABASE_URL,max:1});
  try{
    const info=(await pool.query('SELECT current_database() AS name,inet_server_addr() AS host')).rows[0];
    if(info.name!=='rd_finance_main_test'||info.host!==null)throw new Error('只允许本机 Unix socket 测试数据库 rd_finance_main_test');
    const directory=resolve('.local/backups');await mkdir(directory,{recursive:true});
    const backup=resolve(directory,`before-workbook-metadata-${Date.now()}.dump`);
    const connection=new URL(process.env.RD_DATABASE_URL);
    await execute('/opt/homebrew/opt/postgresql@17/bin/pg_dump',['--format=custom','--file',backup],{env:{...process.env,
      PGHOST:connection.searchParams.get('host')||connection.hostname,PGPORT:connection.searchParams.get('port')||connection.port||'5432',
      PGUSER:decodeURIComponent(connection.username),PGPASSWORD:decodeURIComponent(connection.password),PGDATABASE:connection.pathname.slice(1)}});
    console.log('Backup saved:',backup);
    console.log(await migrate(pool));
    console.log(await importWorkbookMetadata(pool,process.argv[2]));
  }finally{await pool.end();}
}
