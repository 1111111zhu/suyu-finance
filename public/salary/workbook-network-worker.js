/* Background transport: JSON encoding/decoding and download buffers stay off the UI thread. */
const api=(()=>{
  const base='/api/payroll/workbooks',jobs=base+'/jobs/';
  async function checked(url,options) {
    const res=await fetch(url,options);
    if(!res.ok){let data;try{data=await res.json();}catch{}throw Object.assign(new Error(data?.error||`服务器请求失败（${res.status}）`),{status:res.status});}
    return res;
  }
  async function request(path,options={}) {
    const submitted=await checked(base+'/'+path,options);
    if(submitted.status!==202)return submitted;
    const job=await submitted.json(),deadline=Date.now()+150000;
    try {
      while(true) {
        const state=await (await checked(jobs+job.id)).json();
        if(state.status==='failed')throw Object.assign(new Error(state.error),{status:state.errorStatus});
        if(state.status==='completed') {
          const result=await checked(jobs+job.id+'/result');
          // Consume before releasing the server's temporary download buffer.
          const bytes=await result.arrayBuffer();
          return new Response(bytes,{headers:result.headers,status:result.status});
        }
        if(Date.now()>deadline)throw Error('后台处理超时，请稍后重试');
        await new Promise(resolve=>setTimeout(resolve,350));
      }
    } finally {void fetch(jobs+job.id,{method:'DELETE'}).catch(()=>{});}
  }
  async function json(path,data,method='POST') {
    return (await request(path,{method,headers:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})})).json();
  }
  return {request,json};
})();

self.onmessage=async({data})=>{try{const options={...data.options};if(data.jsonBody!==undefined){options.body=JSON.stringify(data.jsonBody);options.headers={...options.headers,'Content-Type':'application/json'};}const res=await api.request(data.path,options);if(data.jsonResult)self.postMessage({id:data.id,result:await res.json()});else{const bytes=await res.arrayBuffer();self.postMessage({id:data.id,bytes,headers:[...res.headers]},[bytes]);}}catch(e){self.postMessage({id:data.id,error:e.message,status:e.status});}};
