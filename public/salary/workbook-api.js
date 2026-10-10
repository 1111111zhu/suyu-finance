/* Only display/edit interactions remain in the page; transport uses a dedicated worker. */
globalThis.PayrollWorkbookAPI=(()=>{
  const worker=new Worker(new URL('workbook-network-worker.js?v=20261010-server-v1',document.currentScript.src));
  const pending=new Map();let sequence=0;
  worker.onmessage=({data})=>{const task=pending.get(data.id);if(!task)return;clearTimeout(task.timer);pending.delete(data.id);if(data.error)task.reject(Object.assign(new Error(data.error),{status:data.status}));else task.resolve(data);};
  worker.onerror=()=>{for(const task of pending.values()){clearTimeout(task.timer);task.reject(new Error('后台请求组件不可用，请刷新页面'));}pending.clear();};
  function run(path,options={},jsonBody,jsonResult=false){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('后台请求超时，请重试'));},180000);pending.set(id,{resolve,reject,timer});try{worker.postMessage({id,path,options,jsonBody,jsonResult});}catch(e){clearTimeout(timer);pending.delete(id);reject(e);}});}
  async function request(path,options={}){const result=await run(path,options);return new Response(result.bytes,{headers:result.headers});}
  async function json(path,data,method='POST',headers={}){const options={method,headers};if(data instanceof Blob)options.body=data;const result=await run(path,options,data instanceof Blob?undefined:data,true);return result.result;}
  async function binary(path,data){const result=await run(path,{method:'POST'},data,false);return new Response(result.bytes,{headers:result.headers});}
  return {request,json,binary};
})();
