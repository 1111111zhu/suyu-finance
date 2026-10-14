import {randomUUID,createHash} from 'node:crypto';
import {mkdir,mkdtemp,writeFile,readFile,rm,stat,open,statfs} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
export const FILE_LIMIT=50*1024*1024,FILE_COUNT=100,BATCH_LIMIT=FILE_LIMIT*FILE_COUNT;
const state=globalThis.__suyuComputeState??={jobs:new Map(),queue:[],running:false};
const fail=(message,status=422)=>{throw Object.assign(new Error(message),{status});};
const python=()=>process.env.RD_COMPUTE_PYTHON||'python3';
export function runPython(mode,path){return new Promise((accept,reject)=>{
 const child=spawn(python(),[resolve('server/rd/compute.py'),mode,path],{stdio:['ignore','ignore','pipe']});let error='';
 child.stderr.on('data',chunk=>{error=(error+chunk.toString()).slice(-8000);});
 const timeout=setTimeout(()=>child.kill('SIGKILL'),10*60*1000);timeout.unref();
 child.on('error',()=>{clearTimeout(timeout);reject(Object.assign(new Error('服务器 Python 计算环境不可用。'),{status:503}));});
 child.on('exit',(code,signal)=>{clearTimeout(timeout);if(code===0)accept();else reject(Object.assign(new Error(signal?'计算超时或资源不足，请拆分资料。':error.trim()||'Excel 计算失败。'),{status:422}));});
});}
export async function createJob(owner){
 if([...state.jobs.values()].filter(j=>j.owner===owner&&['uploading','queued','running'].includes(j.status)).length>=3)fail('已有三个任务，请等待完成。',429);
 const directory=await mkdtemp(join(tmpdir(),'suyu-rd-'));const id=randomUUID();
 const job={id,owner,directory,status:'uploading',files:[],size:0,logical:0,uploading:false,created:Date.now()};state.jobs.set(id,job);
 const timer=setTimeout(()=>{if(['uploading','complete','failed'].includes(job.status)){state.jobs.delete(id);void rm(directory,{recursive:true,force:true});}},24*3600*1000);timer.unref();
 return {id,status:job.status};
}
export function getJob(id,owner){const job=state.jobs.get(id);if(!job||job.owner!==owner)fail('计算任务不存在或无权访问。',404);return job;}
export async function uploadFile(job,request){
 if(job.status!=='uploading'||job.uploading)fail('任务当前不能上传。',409);
 const name=decodeURIComponent(request.headers.get('x-file-name')||'');const compute=request.headers.get('x-compute')==='1',derived=request.headers.get('x-derived')==='1';
 if(!name||name.length>220||/[\\/\x00-\x1f]/.test(name)||!(/\.xlsx$/i.test(name)||/\.(png|jpe?g|webp)$/i.test(name)))fail('文件名或格式无效。');
 if(compute&&!/\.xlsx$/i.test(name))fail('测算资料必须是 Excel。');
 if(!derived&&job.logical>=FILE_COUNT)fail('每批最多 100 份文件或图片。');
 if(derived&&(!compute||job.files.filter(f=>f.derived).length>=FILE_COUNT))fail('图片转换文件数量无效。');
 if(job.files.some(f=>f.name===name))fail('文件名重复，请先区分不同资料的名称。');
 if(Number(request.headers.get('content-length')||0)>FILE_LIMIT)fail('单份文件不能超过 50 MB。',413);
 const disk=await statfs(job.directory);if(Number(disk.bavail)*Number(disk.bsize)<FILE_LIMIT*2)fail('服务器磁盘空间不足。',507);
 const path=join(job.directory,`${job.files.length+1}_${name}`);job.uploading=true;let size=0;const hash=createHash('sha256');
 let handle;const reader=request.body?.getReader();
 try{
  handle=await open(path,'wx',0o600);
  if(!reader)fail('缺少文件内容。');
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>FILE_LIMIT||job.size+size>BATCH_LIMIT+FILE_LIMIT*FILE_COUNT) {await reader.cancel();fail('文件超过 50 MB 或批次容量上限。',413);}hash.update(value);await handle.writeFile(value);}
  if(!size)fail('不能上传空文件。');
  job.files.push({name,path,compute,derived,byteSize:size,sha256:hash.digest('hex')});job.size+=size;if(!derived)job.logical++;
 }catch(error){await rm(path,{force:true});throw error;}finally{await handle?.close();reader?.releaseLock();job.uploading=false;}
 return {count:job.logical};
}
export async function startJob(job,repository){
 if(job.status!=='uploading'||job.uploading||!job.logical)fail('请先完成资料上传。',409);
 if(state.queue.length>=8)fail('计算队列已满，请稍后重试。',429);
 job.status='queued';state.queue.push({job,repository});void drain();return {id:job.id,status:job.status};
}
async function drain(){
 if(state.running)return;state.running=true;
 try{while(state.queue.length){const {job,repository}=state.queue.shift();job.status='running';
  try{
   const manifest={files:job.files,year:new Date().getFullYear(),output:join(job.directory,'output'),report:join(job.directory,'report.json')};
   const path=join(job.directory,'manifest.json');await writeFile(path,JSON.stringify(manifest),{mode:0o600});await runPython('calculate',path);
   const report=JSON.parse(await readFile(manifest.report,'utf8'));const sources=job.files.map(f=>({name:f.name,sha256:f.sha256,byteSize:f.byteSize,load:()=>readFile(f.path)}));
   const inputs=[];for(const result of report.results){
    const bytes=await readFile(result.output_path);inputs.push({requestKey:randomUUID(),scope:'苏州',year:report.year,month:Number(result.month),total:result.cost_total,projects:result.project_costs,files:sources.map(({name,sha256})=>({name,sha256})),sourceFiles:sources,resultFile:{filename:result.output_path.split('/').at(-1),base64:bytes.toString('base64')}});
   }
   // One transaction: all periods succeed together; existing period snapshots are replaced.
   const booked=await repository.recordProjectBatches(inputs);
   job.results=report.results.map((r,i)=>({month:r.month,total:r.cost_total,projects:r.project_costs,filename:inputs[i].resultFile.filename,...booked.results[i]}));job.outputPaths=report.results.map(r=>r.output_path);job.status='complete';
   for(const file of job.files)await rm(file.path,{force:true}).catch(()=>{});
  }catch(error){job.status='failed';job.error=error.message||'计算失败，未完成入账。';await rm(job.directory,{recursive:true,force:true}).catch(()=>{});}
 }}finally{state.running=false;}
}
export function jobStatus(job){return {id:job.id,status:job.status,error:job.error,results:job.results};}
export async function download(job,index){
 if(job.status!=='complete'||!Number.isInteger(index)||!job.outputPaths[index])fail('结果尚未生成。',404);
 const path=job.outputPaths[index],info=await stat(path);return new Response(Readable.toWeb(createReadStream(path)),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Length':String(info.size),'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(job.results[index].filename)}`,'Cache-Control':'no-store'}});
}
export async function imageWorkbook(input){
 if(!input||!Array.isArray(input.rows)||input.rows.length>1000||!['hours','salary','balance','ledger'].includes(input.kind))fail('图片复核内容无效。');
 const directory=await mkdtemp(join(tmpdir(),'suyu-image-'));try{
 const output=join(directory,'image.xlsx'),manifest=join(directory,'manifest.json');await writeFile(manifest,JSON.stringify({...input,output}),{mode:0o600});await runPython('image',manifest);return await readFile(output);
 }finally{await rm(directory,{recursive:true,force:true});}
}
