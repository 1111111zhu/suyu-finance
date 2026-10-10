import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function createWorkbookJobs({root=process.cwd(),timeoutMs=120000,retentionMs=300000,workerFactory=data=>new Worker(join(root,'server/payroll/workbooks/thread.mjs'),{workerData:data,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:384}})}={}) {
  const jobs=new Map();let running=0,closed=false;
  function prune(){for(const [id,j]of jobs)if(j.finished&&Date.now()-j.finished>retentionMs)jobs.delete(id);}
  const timer=setInterval(prune,30000);timer.unref();
  function finish(job,status,payload={}) {
    if(job.status!=='running')return;
    clearTimeout(job.timer);job.worker.removeAllListeners();job.worker.on('error',()=>{});void job.worker.terminate();
    delete job.worker;delete job.timer;delete job.inputSize;running--;Object.assign(job,{status,finished:Date.now()},payload);pump();
  }
  function pump(){if(closed||running)return;const job=[...jobs.values()].find(j=>j.status==='queued');if(!job)return;job.status='running';running++;
    try {job.worker=workerFactory(job.input);delete job.input;
      job.timer=setTimeout(()=>finish(job,'failed',{error:'服务器处理超时，请重试；保存重试使用相同请求编号',errorStatus:504}),timeoutMs);
      job.worker.once('message',m=>m.error?finish(job,'failed',{error:m.error,errorStatus:m.status}):finish(job,'completed',{bytes:Buffer.from(m.bytes),binary:m.binary,filename:m.filename}));
      job.worker.once('error',()=>finish(job,'failed',{error:'服务器后台任务异常，请重试',errorStatus:503}));
      job.worker.once('exit',()=>finish(job,'failed',{error:'后台任务中断，请重试',errorStatus:503}));
    }catch{if(job.worker)finish(job,'failed',{error:'后台线程无法启动',errorStatus:503});else{running--;Object.assign(job,{status:'failed',finished:Date.now(),error:'后台线程无法启动',errorStatus:503});pump();}}
  }
  function owned(owner,id){prune();const j=jobs.get(id);if(!j||j.owner!==owner)throw fail(404,'后台任务不存在或已过期');return j;}
  return {
    submit(owner,input) {
      prune();if(closed)throw fail(503,'服务器正在重启，请稍后重试');
      const active=[...jobs.values()].filter(j=>!j.finished);
      if(active.filter(j=>j.owner===owner).length>=2||active.length>=4)throw fail(429,'后台任务较多，请稍后重试');
      
      if([...jobs.values()].reduce((n,j)=>n+(j.bytes?.length||j.inputSize||0),input.bytes?.length||0)>80*1024*1024 || jobs.size>=20)throw fail(429,'后台文件服务繁忙，请稍后重试');
      const job={id:randomUUID(),owner,inputSize:input.bytes?.length||0,input:{...input,owner,root},status:'queued'};jobs.set(job.id,job);pump();return {id:job.id,status:job.status};
    },
    get(owner,id){const j=owned(owner,id);return {id,status:j.status,...j.error?{error:j.error,errorStatus:j.errorStatus}:{},binary:!!j.binary};},
    result(owner,id){const j=owned(owner,id);if(j.status!=='completed')throw fail(409,'后台任务尚未完成');return {bytes:j.bytes,binary:j.binary,filename:j.filename};},
    remove(owner,id){const j=owned(owner,id);if(!j.finished)throw fail(409,'任务执行中，请等待完成');jobs.delete(id);return {removed:true};},
    close(){closed=true;clearInterval(timer);for(const j of jobs.values()){clearTimeout(j.timer);void j.worker?.terminate();}jobs.clear();},
  };
}
