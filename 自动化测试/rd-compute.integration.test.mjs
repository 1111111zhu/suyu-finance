import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,rm,mkdtemp,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createJob,getJob,uploadFile,startJob,jobStatus,download,FILE_LIMIT} from '../server/rd/compute.mjs';
import {openTestDatabase} from './helpers/payroll-postgres.mjs';
import {migrate} from '../database/rd/migrate.mjs';
import {createRdRepository} from '../database/rd/repository.mjs';
function request(name,body,compute=false,derived=false){return new Request('http://localhost/upload',{method:'PUT',headers:{'x-file-name':encodeURIComponent(name),'x-compute':compute?'1':'0','x-derived':derived?'1':'0'},body,duplex:'half'});}
function streamBytes(size){return new ReadableStream({pull(controller){const bytes=Math.min(size,1024*1024);if(!bytes){controller.close();return;}controller.enqueue(new Uint8Array(bytes));size-=bytes;}});}
test('streamed upload accepts 100 files and exactly 50 MB, rejects overflow and isolates owners',async()=>{
 const created=await createJob('limit-test'),job=getJob(created.id,'limit-test');
 try{
  assert.throws(()=>getJob(created.id,'other-user'),/无权/);
  await uploadFile(job,request('large.png',streamBytes(FILE_LIMIT)));
  assert.equal(job.files[0].byteSize,FILE_LIMIT);
  await assert.rejects(uploadFile(job,request('overflow.png',streamBytes(FILE_LIMIT+1))),/50 MB/);
  assert.equal(job.files.length,1,'failed stream is not committed');
  for(let i=1;i<100;i++)await uploadFile(job,request(`${i}.png`,new Uint8Array([1])));
  assert.equal(job.logical,100);
  await assert.rejects(uploadFile(job,request('101.png',new Uint8Array([1]))),/100/);
 }finally{job.status='failed';await rm(job.directory,{recursive:true,force:true});}
});
test('server process computes fixed template, atomically books and archives sources, download stays readable',async()=>{
 const db=await openTestDatabase(),directory=await mkdtemp(join(tmpdir(),'rd-compute-test-'));
 const job=getJob((await createJob('integration-test')).id,'integration-test');
 const priorStorage=process.env.RD_STORAGE_DIR;process.env.RD_STORAGE_DIR=join(await realpath(directory),'artifacts');
 try{
  await migrate(db.pool);const repo=createRdRepository(db.pool);
  await db.pool.query("INSERT INTO rd.platforms(id,number,name) VALUES('p','RD12601','Test')");
  const a=await repo.createProject({id:'a',number:'RD141232',name:'虚拟项目A',platformId:'p',budget:0});
  const b=await repo.createProject({id:'b',number:'RD1260301',name:'虚拟项目B',platformId:'p',budget:0});
  execFileSync('python3',['-c',`import sys;from pathlib import Path;sys.path.insert(0,'自动化测试');from test_rd_accounting_output import fixtures;fixtures(Path(sys.argv[1]))`,directory]);
  for(const name of ['工时.xlsx','工资.xlsx','核算维度与科目组合表9月.xlsx','费用明细账.xlsx'])await uploadFile(job,request(name,await readFile(join(directory,name)),true));
  await uploadFile(job,request('原图.png',streamBytes(FILE_LIMIT)));
  await startJob(job,repo);
  const deadline=Date.now()+120000;
  while(['queued','running'].includes(job.status)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
  assert.equal(job.status,'complete',job.error);
  assert.equal(job.results[0].total,'1300.00');assert.equal((await repo.getProject(a.id)).actual,860);assert.equal((await repo.getProject(b.id)).actual,440);
  const sources=await repo.batchSources(job.results[0].runId);assert.equal(sources.files.length,5);assert.equal(sources.files[4].byteSize,FILE_LIMIT);
  assert.equal((await repo.batchSources(job.results[0].runId,4)).content.length,FILE_LIMIT);
  const response=await download(job,0);assert.equal(response.status,200);const bytes=await response.arrayBuffer();assert.ok(bytes.byteLength>1000);
  assert.equal(jobStatus(job).status,'complete');
 }finally{if(priorStorage===undefined)delete process.env.RD_STORAGE_DIR;else process.env.RD_STORAGE_DIR=priorStorage;await db.close();await rm(directory,{recursive:true,force:true});await rm(job.directory,{recursive:true,force:true});}
});
