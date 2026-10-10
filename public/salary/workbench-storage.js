/* Incremental persistence transport. Source modules are immutable between imports. */
globalThis.PayrollLocalStore = (() => {
  let worker, serial=0;
  const pending=new Map(), caches=new Map();
  const workerURL=new URL('storage-worker.js',document.currentScript?.src || location.href);
  function fail(error) {
    worker?.terminate();worker=null;caches.clear();
    for(const job of pending.values()){clearTimeout(job.timer);job.reject(error);}
    pending.clear();
  }
  function request(type,payload) {
    return new Promise((resolve,reject)=>{
      try {
        if(!worker) {
          worker=new Worker(workerURL);
          worker.onmessage=({data})=>{const job=pending.get(data.id);if(!job)return;pending.delete(data.id);clearTimeout(job.timer);if(data.error)job.reject(new Error(data.error));else job.resolve(data.result);};
          worker.onerror=()=>fail(new Error('本地保存后台线程异常，请重试'));
          worker.onmessageerror=()=>fail(new Error('本地保存数据传输失败，请重试'));
        }
        const id=++serial,timer=setTimeout(()=>fail(new Error('本地保存超时，请重试')),30000);pending.set(id,{resolve,reject,timer});
        try {worker.postMessage({id,type,payload});}catch(error){pending.delete(id);clearTimeout(timer);reject(error);}
      }catch(error){reject(error);}
    });
  }
  async function save({batches=[],order,activeId,trash,clearTrash=false}) {
    const nextCaches=new Map(), packed=batches.map(({id,batch})=>{
      const old=caches.get(id)||new Map(),next=new Map(), sources=[];
      const sourceRows=batch.data?.sourceRows||{},status=batch.data?.sourceStatus||{};
      for(const [key,rows] of Object.entries(sourceRows)) {
        const previous=old.get(key);next.set(key,{rows,status:status[key]});
        if(!previous||previous.rows!==rows||previous.status!==status[key]) sources.push({key,rows,sheetName:rows.sheetName||'',sourceStartRow:rows.sourceStartRow||2,previews:status[key]?.previews});
      }
      for(const key of old.keys())if(!Object.hasOwn(sourceRows,key))sources.push({key,remove:true});
      const data={...batch.data};delete data.sourceRows;
      data.sourceStatus=Object.fromEntries(Object.entries(status).map(([key,value])=>{const clean={...value};delete clean.previews;return [key,clean];}));
      nextCaches.set(id,next);return {id,batch:{...batch,data},sourceKeys:Object.keys(sourceRows),sources};
    });
    try {
      const result=await request('save',{batches:packed,order,activeId,trash,clearTrash});
      for(const [id,cache] of nextCaches)caches.set(id,cache);
      if(order)for(const id of caches.keys())if(!order.includes(id))caches.delete(id);
      return result;
    }catch(error){caches.clear();throw error;}
  }
  return {save,load:async()=>{const result=await request('load');caches.clear();return result;},readTrash:()=>request('readTrash')};
})();
