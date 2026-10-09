import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import XLSX from 'xlsx';
const root=new URL('../public/salary/',import.meta.url);
const c=vm.createContext({Date});vm.runInContext(fs.readFileSync(new URL('payroll-engine.js',root),'utf8'),c);
const E=c.PayrollEngine;
const json=x=>JSON.parse(JSON.stringify(x));
test('meal title, merged two-row header, total precedence and currency',()=>{
 const rows=E.deductionRowsFromGrid([['2026年9月餐费统计'],['姓名','用餐合计','代扣金额（元）','总计金额（元）'],[null,14,15,16],['高玲',14,0,'￥210.00'],['合计',14,0,210]],'费用.xlsx','苏州');
 assert.equal(rows.length,1);assert.equal(rows[0].餐费代扣,210);assert.equal(rows[0].姓名,'高玲');
});
test('meal card table takes deduction amount, ignores guest card and totals',()=>{
 const rows=E.deductionRowsFromGrid([['连云港溯驭'],['姓名','合计','代扣金额'],['李娟',5,65],['客卡',96,1248],[null,275,3575],['张宸瑜',26,338]],'表.xlsx','Sheet1');
 assert.deepEqual(json(rows.map(r=>[r.姓名,r.餐费代扣])),[['李娟',65],['张宸瑜',338]]);
});
test('water bill selects full water/electricity total and remarks name',()=>{
 const rows=E.deductionRowsFromGrid([['2026年水电表确认单'],['序号','房间号','本月用电金额','本次抄水、电表总金额合计','备注'],[2,'1#403',684.98,794.98,'王刘超'],['合计',null,684.98,794.98,null]],'水电.xlsx','8月');
 assert.equal(rows.length,1);assert.equal(rows[0].水电代扣,794.98);assert.equal(rows[0].姓名,'王刘超');
});
test('separate bills accumulate; reupload same file replaces; optional water creates no warning',()=>{
 const first=E.deductionRowsFromGrid([['餐费'],['姓名','总计金额'],['甲',210]],'A.xlsx','1');
 const second=E.deductionRowsFromGrid([['餐费'],['姓名','代扣金额'],['甲',65]],'B.xlsx','1');
 let rows=E.mergeDeductionRows(first,second,'B.xlsx');
 const net=()=>E.calculateNet([{name:'甲',gross:1000,isIntern:false}],{afterTax:rows,netSocial:[{姓名:'甲',个人总计:0,公司总计:0}],netFund:[{姓名:'甲',个人缴纳:0,公司缴纳:0}],tax:[{姓名:'甲',税:0} ]})[0];
 assert.equal(net().mealDeduct,275);assert.equal(net().net,725);assert.equal(net().utility,0);assert.equal(net().deductionIssues.length,0);
 rows=E.mergeDeductionRows(rows,[{姓名:'甲',餐费代扣:100}],'A.xlsx');assert.equal(net().mealDeduct,165);
});
test('unrelated salary/attendance sheets remain generic; invalid expense amount rejected',()=>{
 assert.equal(E.deductionRowsFromGrid([['姓名','餐补合计','实际出勤天数'],['甲',300,22]],'考勤.xlsx','Sheet1'),null);
 assert.equal(E.deductionRowsFromGrid([['姓名','水电代扣','餐费代扣'],['甲',20,30]],'税后代扣.xlsx','Sheet1'),null);
 assert.throws(()=>E.deductionRowsFromGrid([['姓名','总计金额'],['甲','坏值']],'餐费.xlsx','Sheet1'),/金额无效/);
});
function application(){
 const store=new Map(), element={addEventListener(){},classList:{add(){},remove(){},toggle(){}},textContent:''};
 const indexedDB={open(){const req={};queueMicrotask(()=>{req.result={transaction(){const tx={objectStore(){return {put(v,k){store.set(k,structuredClone(v));queueMicrotask(()=>tx.oncomplete?.());},get(k){const r={};queueMicrotask(()=>{r.result=store.get(k);r.onsuccess?.();});return r;},delete(k){store.delete(k);queueMicrotask(()=>tx.oncomplete?.());}}}};return tx;},close(){}};req.onsuccess?.();});return req;}};
 const ctx=vm.createContext({indexedDB,structuredClone,queueMicrotask,document:{getElementById:()=>({...element}),querySelectorAll:()=>[],addEventListener(){}},window:{XLSX},setTimeout:()=>0,clearTimeout(){}});
 vm.runInContext(fs.readFileSync(new URL('payroll-engine.js',root),'utf8'),ctx);
 const html=fs.readFileSync(new URL('index.html',root),'utf8');vm.runInContext(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace("    render('overview');\n  ",''),ctx);
 vm.runInContext('render=()=>{};showToast=()=>{};',ctx);
 vm.runInContext(fs.readFileSync(new URL('workbench-core.js',root),'utf8'),ctx);
 return {run:code=>vm.runInContext(code,ctx),store};
}
test('multi-file upload and workbook multi-sheet imports all expense rows',async()=>{
 const {run}=application(); const wb=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['餐费'],['姓名','总计金额'],['甲',210]]),'苏州');
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['餐费'],['姓名','代扣金额'],['甲',65]]),'连云港');
 const bytes=XLSX.write(wb,{type:'array',bookType:'xlsx'});run('state.payrollStage="net"');
 const parse=run('parseXlsxFile');const rows=await parse({name:'餐费.xlsx',arrayBuffer:async()=>bytes});assert.equal(rows.length,2);
 run(`commitSource('afterTax',{filename:'餐费.xlsx',rows:${JSON.stringify(rows)}})`);
 run(`commitSource('afterTax',{filename:'水电.xlsx',rows:[{姓名:'甲',水电代扣:794.98}]})`);
 assert.equal(run('sourceRows.afterTax.length'),3);assert.equal(run("state.sourceStatus.afterTax.filename"),'餐费.xlsx、水电.xlsx');
});
test('deleting active and last batch persists replacement and restores original data',async()=>{
 const {run,store}=application();run("state.batches=[{name:'测试批次',month:'2026-09',workdays:22,active:true,draftOrigin:'empty',data:{internDailyRates:{甲:150}}}];state.liveImport=false;state.sourceStatus={};profiles.splice(0);recalculateEmployees();");
 await run('PayrollWorkbench.deleteBatch(currentBatch())');assert.equal(run('state.batches.length'),1);assert.equal(run('currentBatch().draftOrigin'),'empty');assert.equal(store.get('deletedBatch').name,'测试批次');
 await run('PayrollWorkbench.restoreDeletedBatch()');assert.equal(run('state.batches.length'),2);assert.equal(run('state.batches[1].data.internDailyRates.甲'),150);assert.equal(store.has('deletedBatch'),false);
});
