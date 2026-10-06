import {recordProjectBatch,validateSourceFiles} from '../database/rd/batch.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {openTestDatabase} from './helpers/payroll-postgres.mjs';
import {migrate} from '../database/rd/migrate.mjs';
import {storeArtifact,readArtifact} from '../database/rd/artifact-store.mjs';
import {withTransaction} from '../database/payroll/pool.mjs';
test('文件与数据库映射持久化，旧字节回退，篡改/路径/符号链接保护',async()=>{
 const db=await openTestDatabase();await mkdir('.local',{recursive:true});const root=await mkdtemp(resolve('.local/artifact-test-'));const prior=process.env.RD_STORAGE_DIR;process.env.RD_STORAGE_DIR=root;
 try{
  await migrate(db.pool);const content=Buffer.from('原始归档字节'),sha256=createHash('sha256').update(content).digest('hex');const input={kind:'project_document',objectId:'doc-1',content,sha256};
  await withTransaction(db.pool,client=>storeArtifact(client,input));
  assert.deepEqual(await readArtifact(db.pool,input),content);
  await withTransaction(db.pool,client=>storeArtifact(client,input));
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM rd.artifact_registry')).rows[0].n,1);
  assert.deepEqual(await readArtifact(db.pool,{...input,objectId:'legacy'}),content);
  await assert.rejects(storeArtifact(db.pool,{...input,sha256:'0'.repeat(64)}),/校验失败/);
  await assert.rejects(db.pool.query("UPDATE rd.artifact_registry SET relative_path='../elsewhere'"),/immutable|check constraint/);
  await writeFile(join(root,sha256+'.bin'),'tampered');
  await assert.rejects(readArtifact(db.pool,input),/校验失败/);
  await rm(join(root,sha256+'.bin'));await writeFile(join(root,'external'),content);await symlink(join(root,'external'),join(root,sha256+'.bin'));
  await assert.rejects(readArtifact(db.pool,input),/校验失败/);
 }finally{if(prior===undefined)delete process.env.RD_STORAGE_DIR;else process.env.RD_STORAGE_DIR=prior;await db.close();await rm(root,{recursive:true,force:true});}
});

test('核算原始来源字节持久化与摘要匹配，超额来源整批拒绝',async()=>{
 const db=await openTestDatabase();await mkdir('.local',{recursive:true});const root=await mkdtemp(resolve('.local/source-test-'));const prior=process.env.RD_STORAGE_DIR;process.env.RD_STORAGE_DIR=root;
 try{
  await migrate(db.pool);await db.pool.query("INSERT INTO rd.platforms(id,name,number) VALUES('p','平台','P'); INSERT INTO rd.projects(id,name,number,status,budget,platform_id) VALUES('a','项目','RD-A','active',0,'p')");
  const content=Buffer.from('原始工资工作簿字节'),sha256=createHash('sha256').update(content).digest('hex');const descriptor={name:'来源.xlsx',sha256};
  const input={requestKey:'7d3db4eb-45bf-4a29-b63d-ac35569b3ac8',scope:'测试',year:2026,month:10,total:'0.00',projects:[{code:'RD-A',total:'0.00',costs:[{category:'材料',amount:'0.00'}]}],files:[descriptor],sourceFiles:[{...descriptor,base64:content.toString('base64')}]};
  const saved=await recordProjectBatch(db.pool,input);
  assert.deepEqual(await readArtifact(db.pool,{kind:'source_document',objectId:saved.runId+':0',sha256}),content);
  const payload=(await db.pool.query('SELECT payload FROM rd.calculation_runs WHERE id=$1',[saved.runId])).rows[0].payload;
  assert.equal(payload.sourceFiles[0].base64,undefined);assert.equal(payload.sourceFiles[0].name,descriptor.name);
  const huge=Buffer.alloc(16*1024*1024),hash=createHash('sha256').update(huge).digest('hex');const sources=[1,2].map(i=>({name:i+'.xlsx',sha256:hash,base64:huge.toString('base64')}));
  assert.throws(()=>validateSourceFiles({files:sources.map(({name,sha256})=>({name,sha256})),sourceFiles:sources}),/大小校验失败/);
  assert.throws(()=>validateSourceFiles({...input,sourceFiles:[{...input.sourceFiles[0],sha256:'0'.repeat(64)}]}),/不一致/);
 }finally{if(prior===undefined)delete process.env.RD_STORAGE_DIR;else process.env.RD_STORAGE_DIR=prior;await db.close();await rm(root,{recursive:true,force:true});}
});
