/* Local parsing in a background thread. */
globalThis.window=globalThis;
importScripts('./xlsx.full.min.js','./payroll-engine.js?v=20261010-import-perf-v1','./payroll-email-engine.js','./calculation-model.js?v=20261010-import-perf-v1');
self.onmessage=async ({data})=>{
  try {
    state.payrollStage=data.stage;
    currentMonth=data.month;
    const rows=await parseXlsxFile(data.file,data.key);
    self.postMessage({rows});
  } catch(error) {self.postMessage({error:error.message || '文件读取失败'});}
};
