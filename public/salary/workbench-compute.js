/* UI controller for isolated payroll calculation; previous results survive errors. */
globalThis.PayrollCalculation = (() => {
  let active = null, scheduled;
  const netResults=new WeakMap();
  const endpoint='/api/payroll/calculations';
  async function request(path, options={}) {
    const response=await fetch(path,{credentials:'same-origin',cache:'no-store',
      ...options,signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error || '服务器计算请求失败，请稍后重试');
    return data;
  }
  function serializeDate(key,value) {
    const original=this[key];
    if(Object.prototype.toString.call(original)==='[object Date]')
      return Number.isNaN(original.getTime())?null:
        `${original.getFullYear()}-${String(original.getMonth()+1).padStart(2,'0')}-${String(original.getDate()).padStart(2,'0')}`;
    return value;
  }
  async function run(input,onPhase=()=>{}) {
    if(active)throw new Error('工资正在计算，请等待或取消');
    clearTimeout(scheduled);
    const task={cancelled:false,id:null};active=task;
    try {
      const submitted=await request(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(input,serializeDate)});
      task.id=submitted.id;
      const deadline=Date.now()+135000;
      while(true) {
        if(task.cancelled)throw new Error('已取消计算，原资料和上次结果保留');
        const data=await request(endpoint+'/'+task.id);
        if(task.cancelled)throw new Error('已取消计算，原资料和上次结果保留');
        if(data.status==='completed')return data.result;
        if(data.status==='failed')throw new Error(data.error || '服务器计算失败');
        if(data.status==='cancelled')throw new Error('已取消计算，原资料和上次结果保留');
        if(Date.now()>deadline)throw new Error('服务器计算超时，请稍后重试');
        onPhase(data.status);
        await new Promise(resolve=>{task.wake=resolve;task.wait=setTimeout(resolve,500);});
      }
    } finally {
      clearTimeout(task.wait);
      if(task.id)await request(endpoint+'/'+task.id,{method:'DELETE'}).catch(()=>{});
      if(active===task)active=null;
    }
  }
  function cancel() {clearTimeout(scheduled);if(active){active.cancelled=true;clearTimeout(active.wait);active.wake?.();}}
  function schedule() {
    clearTimeout(scheduled);
    scheduled=setTimeout(()=>{
      if(state.calculating)return;
      if(importSession().busy){schedule();return;}
      if(state.payrollStage==='gross'?hasPayrollRoster():Boolean(sourceRows.grossUpload?.length || sourceRows.roster?.length))
        void calculateStage({automatic:true});
    },200);
  }
  function rememberNet() {
    netResults.set(currentBatch(),{employees,month:currentMonth,workdays:currentWorkdays,
      revision:PayrollWorkbench.data().revision,rows:Object.entries(sourceRows)});
  }
  function netEmployees() {
    const cached=netResults.get(currentBatch());
    return cached && cached.month===currentMonth && cached.workdays===currentWorkdays &&
      cached.revision===PayrollWorkbench.data().revision &&
      cached.rows.length===Object.keys(sourceRows).length && cached.rows.every(([key,rows])=>sourceRows[key]===rows)
      ? cached.employees : [];
  }
  return {run,cancel,schedule,rememberNet,netEmployees,get busy(){return !!active;}};
})();

calculateStage = async function ({automatic=false}={}) {
  if (state.calculating) return;
  if (importSession().busy) {showToast('文件正在解析，请稍候');return;}
  if (!(stageReady() || state.payrollStage==='net'&&hasPayrollRoster())) {showToast(state.payrollStage === 'net' ? '请先生成或上传应发工资表' : '请先上传花名册以确定员工范围');return;}
  state.calculating = true;
  const batch = currentBatch(), stage = state.payrollStage, view=state.view, selectedKey=PayrollWorkbench.selected()&&PayrollWorkbench.key(PayrollWorkbench.selected());
  const locked = [...document.querySelectorAll('button,input,select,textarea')].filter(element => !element.disabled);
  locked.forEach(element => {element.disabled = true;});
  const panel = document.createElement('div');
  panel.className = 'wb-notice';
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  panel.innerHTML = '<strong>正在准备工资计算…</strong><p>服务器计算期间可取消，原资料和上次结果保留。</p><button type="button" data-payroll-cancel>取消计算</button>';
  let cancelRequested = false;
  panel.querySelector('button').addEventListener('click', () => {
    cancelRequested = true;
    PayrollCalculation.cancel();
  });
  content.prepend(panel);
  const block = event => {
    if (event.target.closest?.('[data-payroll-cancel]')) return;
    event.preventDefault();event.stopImmediatePropagation();
  };
  document.addEventListener('click', block, true);
  let result, failure;
  try {
    // Paint the status before serializing the request.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (cancelRequested) throw new Error('已取消计算，原资料和上次结果保留');
    const workbench = PayrollWorkbench.data();
    result = await PayrollCalculation.run({month: currentMonth, workdays: currentWorkdays,
      makeupWorkdays, sourceRows, sourceMetadata:Object.fromEntries(Object.entries(sourceRows).map(([key,rows])=>[key,{sheetName:rows.sheetName,sourceStartRow:rows.sourceStartRow}])), sourceStatus: state.sourceStatus, liveImport: state.liveImport,
      stage, profiles, batch: {name: batch.name, month: batch.month, active: true,
        draftOrigin: batch.draftOrigin, workbench,
        data: {internDailyRates: batch.data?.internDailyRates || {}}}}, phase => {
      panel.querySelector('strong').textContent = phase==='queued'?'服务器正在排队，请稍候…':'服务器正在计算工资…';
    });
    if (batch !== currentBatch() || stage !== state.payrollStage)
      throw new Error('当前批次或核算阶段已改变，未应用旧计算结果');
  } catch (error) {failure = error;}
  finally {
    state.calculating = false;
    document.removeEventListener('click', block, true);
    locked.forEach(element => {element.disabled = false;});
    panel.remove();
  }
  if (failure) {showToast(failure.message || '工资计算失败，原结果保留', 6000);return;}
  employees = result.employees;
  generatedEmployees = result.generatedEmployees;
  state.comparison = result.comparison;
  state.grossSource = result.grossSource;
  PayrollWorkbench.rawProfiles.clear();
  for (const [key, profile] of result.rawProfiles) PayrollWorkbench.rawProfiles.set(key, profile);
  state.calculated = true;
  if(stage==='net')PayrollCalculation.rememberNet();
  batch.employees = employees.length;
  batch.status = '已计算';
  saveBatchData();
  if(selectedKey)state.selectedId=employees.find(employee=>PayrollWorkbench.key(employee)===selectedKey)?.id || state.selectedId;
  render(automatic ? view : 'results');
  const error = await PayrollWorkbench.flush();
  showToast(error ? '工资已计算，但本机草稿保存失败：' + error
    : stage === 'gross' ? '应发工资已计算' : '实发工资已更新', error ? 6000 : 2400);
};
