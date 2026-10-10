/* Snapshot immediately; workbook creation and ZIP serialization run off the UI thread. */
globalThis.PayrollExport=(()=>{
  const workerURL=new URL('export-worker.js?v=20261010-tax-refund-v1',document.currentScript?.src||new URL('salary/workbench-export.js',location.origin+'/'));
  let pending=null,sequence=0;
  function snapshot(clone=true){
    const batch=currentBatch();
    // Export needs source identity/status, not image previews or a second copy of all batch data.
    const sourceStatus=Object.fromEntries(Object.entries(state.sourceStatus).map(([key,value])=>
      [key,Object.fromEntries(Object.entries(value).filter(([field])=>field!=='previews'))]));
    const payload={month:currentMonth,workdays:currentWorkdays,makeupWorkdays,
      state:{payrollStage:state.payrollStage,sourceStatus,liveImport:state.liveImport,
        calculated:state.calculated,comparison:{differences:(state.comparison?.differences||[]).filter(d=>d.reason==='上传表缺失人员').map(({name,reason})=>({name,reason}))},selectedId:state.selectedId,grossSource:state.grossSource,
        batches:[{name:batch.name,month:batch.month,workdays:batch.workdays,status:batch.status,
          active:true,workbench:batch.workbench,data:{internDailyRates:batch.data?.internDailyRates||{}}}]},
      importErrors:importSession().items.filter(item=>item.error).map(({filename,error})=>({filename,error})),
      sourceRows,employees,generatedEmployees,profiles,rawProfiles:[...PayrollWorkbench.rawProfiles]};
    return clone?structuredClone(payload):payload;
  }
  function token(){return {batch:currentBatch(),month:currentMonth,workdays:currentWorkdays,
    stage:state.payrollStage,revision:currentBatch().workbench?.revision||0,
    sources:Object.entries(sourceRows),employees,generatedEmployees,makeupWorkdays};}
  function matchesCurrent(result){
    const t=result?.token;if(!t||state.calculating||(globalThis.PayrollCalculation&&!state.calculated))return false;
    return t.batch===currentBatch()&&t.month===currentMonth&&t.workdays===currentWorkdays&&
      t.stage===state.payrollStage&&t.revision===(currentBatch().workbench?.revision||0)&&
      t.employees===employees&&t.generatedEmployees===generatedEmployees&&t.makeupWorkdays===makeupWorkdays&&
      t.sources.length===Object.keys(sourceRows).length&&t.sources.every(([key,rows])=>sourceRows[key]===rows);
  }
  async function run(kind){
    if(pending){showToast('工资表正在后台生成，请稍候');return false;}
    if(state.calculating||(globalThis.PayrollCalculation&&!state.calculated)){showToast('请等待工资计算完成后导出');return false;}
    if(kind==='gross'){
      if(PayrollWorkbench.orphaned('gross').length){showToast('应发调整存在未关联员工，请先关联后导出');return false;}
      if(!generatedEmployees.length){showToast('没有第一阶段生成结果，请先上传应发工资源表');return false;}
    }else if(!payrollExportReady())return false;
    if(typeof Worker==='undefined'){showToast('当前浏览器不支持后台导出，请升级浏览器');return false;}
    const exportToken=token(),batch=exportToken.batch,version={month:currentMonth,stage:state.payrollStage,revision:batch.workbench?.revision||0,createdAt:new Date().toISOString()},id=++sequence;
    let worker;
    try{worker=new Worker(workerURL);}catch{showToast('后台导出无法启动，请重试',5000);return false;}
    pending={id,worker};
    try {
      showToast('正在后台生成工资表，可继续操作页面');
      const result=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('工资表导出超时，请重试')),120000);
        worker.onmessage=({data})=>{if(data.id!==id)return;clearTimeout(timer);if(data.error)reject(new Error(data.error));else resolve(data);};
        worker.onerror=()=>{clearTimeout(timer);reject(new Error('后台导出失败，请重试'));};
        worker.onmessageerror=()=>{clearTimeout(timer);reject(new Error('后台导出结果读取失败，请重试'));};
        try{worker.postMessage({id,kind,version,snapshot:snapshot(false)});}catch(error){clearTimeout(timer);reject(error);}
      });
      const blob=new Blob([result.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),a=document.createElement('a');
      try{a.href=url;a.download=result.filename;document.body.appendChild(a);a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
      showToast(`${result.filename} 已导出${currentBatch()!==batch?'（导出时的批次）':''}`);
      return {batch,version,filename:result.filename,token:exportToken};
    }catch(error){showToast(error.message||'工资表导出失败',5000);return false;}
    finally{try{worker.terminate();}finally{pending=null;}}
  }
  downloadGross=()=>run('gross');downloadCsv=()=>run(state.payrollStage==='gross'?'gross':'net');downloadSlip=()=>run('slip');
  return {run,snapshot,matchesCurrent,get busy(){return Boolean(pending);}};
})();
