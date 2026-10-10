/* Recognition and preview formatting run outside the UI thread. */
const payrollImportWorkerURL=new URL('./import-worker.js?v=20261010-personal-benefits-v1',document.currentScript.src);
parseXlsxFile = function(file, key='') {
  return new Promise((resolve,reject)=>{
    let worker, timer;
    const finish=(error,rows)=>{clearTimeout(timer);worker?.terminate();if(error)reject(error);else resolve(rows);};
    try {
      worker=new Worker(payrollImportWorkerURL);
      timer=setTimeout(()=>finish(new Error('文件读取超时，请检查文件后重试，原有资料已保留')),120000);
      worker.onmessage=({data})=>finish(data.error?new Error(data.error):null,data.rows);
      worker.onerror=event=>{event.preventDefault();finish(new Error('后台文件读取组件加载失败，请刷新页面后重试'));};
      worker.onmessageerror=()=>finish(new Error('文件读取结果传递失败，请重试'));
      worker.postMessage({file,key,stage:state.payrollStage,month:currentMonth});
    } catch(error) {finish(error);}
  });
};
