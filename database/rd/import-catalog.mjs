import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createPool, withTransaction } from '../payroll/pool.mjs';
import { migrate } from './migrate.mjs';

export async function importCatalog(pool, sourceDirectory) {
  const catalog = JSON.parse(await readFile(new URL('./catalog.json', import.meta.url), 'utf8'));
  const docs = await Promise.all(catalog.sources.map(async filename => {
    try {
      const content = await readFile(join(sourceDirectory, filename));
      return { filename, content, hash: createHash('sha256').update(content).digest('hex') };
    } catch(error) {
      if(error.code!=='ENOENT') throw error;
      return { filename, content:null, hash:null };
    }
  }));
  return withTransaction(pool, async client => {
    for (const doc of docs) {
      if(doc.content) await client.query('INSERT INTO rd.source_documents(sha256,filename,content) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [doc.hash,doc.filename,doc.content]);
      await client.query(`INSERT INTO rd.source_registry(filename,sha256,status,note) VALUES($1,$2,$3,$4)
        ON CONFLICT(filename) DO UPDATE SET sha256=COALESCE(EXCLUDED.sha256,rd.source_registry.sha256),
        status=CASE WHEN EXCLUDED.sha256 IS NOT NULL THEN 'available' ELSE rd.source_registry.status END`,
        [doc.filename,doc.hash,doc.content?'available':'file_missing',doc.content?'':'从会话图片转录；微信临时路径原文件已不可读，待补存原图']);
    }
    for (const [index,p] of catalog.platforms.entries()) {
      await client.query('INSERT INTO rd.platforms(id,name,number,sort_order) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[p.id,p.name,p.number,index]);
    }
    for (const [platform,number,name,year,sourceIndex,rows] of catalog.projects) {
      const source = [{ sha256:docs[sourceIndex].hash, filename:docs[sourceIndex].filename, rows:Array.isArray(rows)?rows:[rows], year }];
      const existing=(await client.query('SELECT id,platform_id FROM rd.projects WHERE number=$1 FOR UPDATE',[number])).rows;
      if(existing.length>1 || (existing[0]?.platform_id && existing[0].platform_id!==platform)) throw new Error(`项目 ${number} 存在平台冲突，原始清单未导入`);
      if(existing.length===1) {
        await client.query('UPDATE rd.projects SET platform_id=$1,source_year=$2,source_records=$3 WHERE id=$4',[platform,year,JSON.stringify(source),existing[0].id]);
        continue;
      }
      await client.query(`INSERT INTO rd.projects(id,number,name,status,budget,platform_id,source_year,source_records)
        VALUES($1,$2,$3,'init',0,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [`catalog-${platform}-${number.toLowerCase()}`,number,name,platform,year,JSON.stringify(source)]);
    }
    return { platforms:catalog.platforms.length,projects:catalog.projects.length,sourcesStored:docs.filter(d=>d.content).length,missingFiles:docs.filter(d=>!d.content).map(d=>d.filename) };
  });
}
if (process.argv[1]?.endsWith('/import-catalog.mjs')) {
  const pool=createPool({connectionString:process.env.RD_DATABASE_MIGRATION_URL});
  try { await migrate(pool); console.log(await importCatalog(pool,process.argv[2])); } finally { await pool.end(); }
}
