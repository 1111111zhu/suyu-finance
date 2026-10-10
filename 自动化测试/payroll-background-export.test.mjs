import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import XLSX from 'xlsx';
const base=new URL('../public/salary/',import.meta.url);
function model(){
 const ctx=vm.createContext({structuredClone,setTimeout:()=>0,clearTimeout(){},window:{XLSX}});
 const run=code=>vm.runInContext(code,ctx);
 for(const name of ['payroll-engine.js','payroll-email-engine.js','calculation-model.js','workbench-core.js'])run(fs.readFileSync(new URL(name,base),'utf8'));
 run(`showToast=()=>{};render=()=>{};sourceRows={roster:[{姓名:'甲',公司:'公司',一级部门:'研发',入职日期:'2024/3/8',工号:'001'}],salary:[{姓名:'甲',基本工资:10000,绩效基数:1000}],attendance:[{姓名:'甲',实际出勤天数:22}]};sourceRows.roster.sheetName='原花名册';sourceRows.roster.sourceStartRow=7;state.liveImport=true;currentMonth='2026-09';currentWorkdays=22;recalculateEmployees();state.selectedId=employees[0].id;`);
 return {ctx,run};
}
function snapshot(run){return run(`structuredClone({month:currentMonth,workdays:currentWorkdays,makeupWorkdays,state:{...state,batches:[structuredClone(currentBatch())]},importErrors:importSession().items.filter(item=>item.error).map(({filename,error})=>({filename,error})),sourceRows,employees,generatedEmployees,profiles,rawProfiles:[...PayrollWorkbench.rawProfiles]})`);}
function worker(request){
 let result;const ctx=vm.createContext({structuredClone,setTimeout:()=>0,clearTimeout(){}});ctx.self=ctx;
 ctx.importScripts=(...names)=>names.forEach(name=>vm.runInContext(fs.readFileSync(new URL(name.replace('./','').split('?')[0],base),'utf8'),ctx));
 ctx.postMessage=data=>{result=data;};
 vm.runInContext(fs.readFileSync(new URL('export-worker.js',base),'utf8'),ctx);
 ctx.request=request;vm.runInContext('self.onmessage({data:request})',ctx);
 assert.equal(result.error,undefined);return result;
}
const normalized=book=>JSON.parse(JSON.stringify(book.Sheets));
for(const mode of ['gross','net','uploaded-net'])test(`background ${mode} export matches authoritative formulas, dates, adjustments and summaries`,()=>{
 const {run}=model();
 run(`const k=PayrollWorkbench.key(employees[0]);PayrollWorkbench.data().gross[k]={grossTarget:11234.56};PayrollWorkbench.data().history.push({key:k,scope:'gross',field:'grossTarget',before:11000,value:11234.56,reason:'人工核对'});recalculateEmployees();`);
 if(mode!=='gross')run(`state.payrollStage='net';sourceRows.tax=[{姓名:'甲',税:200}];sourceRows.netSocial=[{姓名:'甲',个人总计:500,公司总计:1000}];recalculateEmployees();`);
 if(mode==='uploaded-net')run(`sourceRows.grossUpload=[{姓名:'甲',公司:'公司',一级部门:'研发',入职日期:'2021-06-30',应发工资:12000}];recalculateEmployees();`);
 run(`state.comparison={differences:[{name:'缺失员工',reason:'上传表缺失人员'}]};importSession().items=[{filename:'失败.xlsx',error:'表头错误'}];`);
 const kind=mode==='gross'?'gross':'net',s=snapshot(run);
 const expected=run(`(()=>{const b=window.XLSX.utils.book_new();window.XLSX.utils.book_append_sheet(b,detailSheet(${kind==='gross'}),'${kind==='gross'?'应发工资表':'工资明细表'}');${kind==='net'?"window.XLSX.utils.book_append_sheet(b,summarySheet(),'汇总统计');":''}return window.XLSX.write(b,{bookType:'xlsx',type:'array'});})()`);
 // UI mutations after dispatch must never leak into the file.
 run(`employees[0].gross=999999;currentMonth='2027-01';sourceRows.roster[0]['入职日期']='changed';`);
 const result=worker({id:1,kind,version:{revision:3},snapshot:s});
 assert.deepEqual(normalized(XLSX.read(new Uint8Array(result.bytes),{type:'array',cellStyles:true})),normalized(XLSX.read(new Uint8Array(expected),{type:'array',cellStyles:true})));
 const restored=XLSX.read(new Uint8Array(result.bytes),{type:'array'});assert.match(restored.Sheets[restored.SheetNames[0]].A2.c[0].t,/失败.xlsx/);if(kind==='net')assert.match(restored.Sheets[restored.SheetNames[0]].A2.c[0].t,/缺失员工/);
 assert.match(result.filename,/2026-09/);assert.equal(result.version.revision,3);
});
test('employee detail background export matches the existing adjustment-aware slip',()=>{
 const {run}=model();const s=snapshot(run);
 run(`payrollExportReady=()=>true;globalThis.result=null;downloadXlsx=(book,filename)=>{result={bytes:window.XLSX.write(book,{bookType:'xlsx',type:'array'}),filename}};downloadSlip();`);
 const expected=run('result'),result=worker({id:2,kind:'slip',version:{},snapshot:s});
 assert.equal(result.filename,expected.filename);
 assert.deepEqual(normalized(XLSX.read(new Uint8Array(result.bytes),{type:'array'})),normalized(XLSX.read(new Uint8Array(expected.bytes),{type:'array'})));
});
test('controller prevents duplicate exports and releases failed jobs for retry',async()=>{
 const {ctx,run}=model();const calls=[],downloads=[];
 ctx.URL=class extends URL {static createObjectURL(){return 'blob:test';}static revokeObjectURL(){}};
 ctx.location={origin:'https://example.test'};ctx.Blob=Blob;
 ctx.document={currentScript:{src:'https://example.test/salary/workbench-export.js'},createElement:()=>({click(){downloads.push(this.download);},remove(){}}),body:{appendChild(){}}};
 ctx.PayrollWorkbookAPI={binary:(path,request)=>new Promise((resolve,reject)=>calls.push({path,request:structuredClone(request),resolve,reject}))};
 run(fs.readFileSync(new URL('workbench-export.js',base),'utf8'));
 const first=run('downloadGross()');assert.equal(await run('downloadGross()'),false);assert.equal(calls.length,1);
 calls[0].reject(new Error('模拟导出失败'));
 assert.equal(await first,false);assert.equal(run('PayrollExport.busy'),false);assert.equal(downloads.length,0);
 run(`state.sourceStatus.roster.previews=[{rows:['large preview']}];currentBatch().data.extraLarge=['not needed'];`);
 const second=run('downloadGross()'),request=calls[1].request;
 assert.equal(request.snapshot.state.sourceStatus.roster.previews,undefined);assert.equal(request.snapshot.state.batches[0].data.extraLarge,undefined);
 const standalone=run('PayrollExport.snapshot()');run(`sourceRows.roster[0]['入职日期']='later';`);assert.equal(standalone.sourceRows.roster[0]['入职日期'],'2024/3/8');
 run(`currentMonth='2027-01';`);
 calls[1].resolve(new Response(new ArrayBuffer(8),{headers:{'X-Workbook-Filename':encodeURIComponent('应发工资表_2026-09.xlsx')}}));
 const completed=await second;assert.ok(completed);ctx.completed=completed;assert.equal(run('PayrollExport.matchesCurrent(completed)'),false);
 run(`currentMonth='2026-09'`);assert.equal(run('PayrollExport.matchesCurrent(completed)'),true);
 run(`sourceRows.attendance=[...sourceRows.attendance]`);assert.equal(run('PayrollExport.matchesCurrent(completed)'),false);
 assert.deepEqual(downloads,['应发工资表_2026-09.xlsx']);assert.equal(run('PayrollExport.busy'),false);
});

test('large 1200 employee net export completes with source caches',()=>{
 const {run}=model();
 run(`const template=profiles[0];profiles.splice(0,profiles.length,...Array.from({length:1200},(_,i)=>({...template,id:'EMP'+i,name:'员工'+i})));
 sourceRows={roster:profiles.map(p=>({姓名:p.name,入职日期:'2024-01-01'})),other:profiles.map(p=>({姓名:p.name,其他加:5})),tax:profiles.map(p=>({姓名:p.name,税:200})),netSocial:profiles.map(p=>({姓名:p.name,个人总计:100,公司总计:200})),netFund:profiles.map(p=>({姓名:p.name,个人缴纳:50,公司缴纳:50})),afterTax:profiles.map(p=>({姓名:p.name,其他代扣:5}))};
 generatedEmployees=profiles.map(p=>calcSalary(p,currentMonth,currentWorkdays));employees=PayrollEngine.calculateNet(generatedEmployees,sourceRows);state.payrollStage='net';`);
 const started=performance.now(),result=worker({id:1,kind:'net',version:{},snapshot:snapshot(run)}),elapsed=performance.now()-started;
 const book=XLSX.read(new Uint8Array(result.bytes),{type:'array'});assert.equal(book.SheetNames.length,2);
 console.log('1200 employee background export '+Math.round(elapsed)+' ms');assert.ok(elapsed<30000,'export exceeds 30 seconds');
});
