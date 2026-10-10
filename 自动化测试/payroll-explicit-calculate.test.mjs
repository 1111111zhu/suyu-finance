import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ui=fs.readFileSync(new URL('../public/salary/workbench-ui.js',import.meta.url),'utf8');
const compute=fs.readFileSync(new URL('../public/salary/workbench-compute.js',import.meta.url),'utf8');
test('all four workflow steps display progress without clickable calculation commands',()=>{
 const start=ui.indexOf('  function stages(){'),end=ui.indexOf('  function header()',start);
 for(const stage of ['gross','net'])for(const view of ['upload','results']){
  const html=vm.runInNewContext(ui.slice(start,end)+';stages()', {state:{payrollStage:stage,view},monthlyViews:['upload','mapping','results','slip','exceptions'],grossUploadDone:()=>false,grossResultDone:()=>false,netUploadDone:()=>false,netResultDone:()=>false});
  assert.equal((html.match(/class="wb-flow-step/g)||[]).length,4);
  assert.equal((html.match(/aria-current="step"/g)||[]).length,1);
  assert(!/data-wb|<button|onclick/.test(html));
 }
 assert(ui.includes("if(cmd==='calculate'){await calculateStage();}"));
});
test('navigation and data refresh cannot schedule a server calculation',async()=>{
 let timers=0;const context=vm.createContext({clearTimeout(){},setTimeout(){timers++;throw Error('Unexpected automatic timer');}});
 vm.runInContext(compute,context);
 vm.runInContext('PayrollCalculation.schedule();PayrollCalculation.schedule();',context);
 await vm.runInContext('calculateStage({automatic:true})',context);
 assert.equal(timers,0);
});
