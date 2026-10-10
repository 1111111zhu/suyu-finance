import {parentPort, workerData} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';

// The same rules as the workbench, with no browser or database side effects.
const context = vm.createContext({structuredClone, setTimeout, clearTimeout});
context.window = context;
for (const file of ['payroll-engine.js', 'payroll-email-engine.js', 'calculation-model.js', 'workbench-core.js'])
  vm.runInContext(readFileSync(join(workerData.root, 'public/salary', file), 'utf8'), context);
context.input = workerData.input;
try {
  const result = vm.runInContext(`
    currentMonth=input.month;currentWorkdays=input.workdays;makeupWorkdays=input.makeupWorkdays;
    sourceRows=input.sourceRows;
    for(const [key,metadata] of Object.entries(input.sourceMetadata || {})) {
      if(Object.hasOwn(sourceRows,key)){sourceRows[key].sheetName=metadata.sheetName;sourceRows[key].sourceStartRow=metadata.sourceStartRow;}
    }
    profiles.splice(0,profiles.length,...input.profiles);
    state.batches=[input.batch];state.sourceStatus=input.sourceStatus;
    state.liveImport=input.liveImport;state.payrollStage=input.stage;
    recalculateEmployees();
    ({employees,generatedEmployees,comparison:state.comparison,grossSource:state.grossSource,
      rawProfiles:[...PayrollWorkbench.rawProfiles]});
  `, context);
  if(Buffer.byteLength(JSON.stringify(result))>16*1024*1024)
    parentPort.postMessage({error:'工资结果过大，请分批核算后重试'});
  else parentPort.postMessage({result});
} catch {
  // Never include employee source rows or exception dumps in HTTP responses/logs.
  parentPort.postMessage({error: '工资计算失败，请核对源表和计薪设置后重试'});
}
