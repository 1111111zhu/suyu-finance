import {parentPort} from 'node:worker_threads';
import {Worker} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
parentPort.on('message',({id,input})=>{
  const worker=new Worker(new URL('../../server/payroll/calculation-thread.mjs',import.meta.url),{
    workerData:{root:fileURLToPath(new URL('../../',import.meta.url)),input}});
  worker.on('message',data=>parentPort.postMessage({id,...data}));
  worker.on('error',error=>parentPort.postMessage({id,error:error.message}));
});
