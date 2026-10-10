const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {Readable}=require('node:stream');const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PAYROLL_PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const {createCalculationJobs}=await import(pathToFileURL(path.join(root,'server/payroll/calculation-jobs.mjs')));
 const {createCalculationResponse}=await import(pathToFileURL(path.join(root,'server/payroll/calculation-response.mjs')));
 const jobs=createCalculationJobs({root});
 // Synthetic local QA only; production routes always use requireAccess.
 const handle=createCalculationResponse({jobs,authorize:async()=>({userid:'synthetic-local-qa'})});
 const requests=[],errors=[];
 const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname.startsWith('/api/payroll/calculations')){
   requests.push(req.method);
   const response=await handle(new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,
    ...['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'}}));
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  if(pathname.startsWith('/api/')){res.writeHead(401,{'Content-Type':'application/json'});res.end('{"ok":false}');return;}
  const file=path.join(root,'public',pathname);
  if(!file.startsWith(path.join(root,'public')+'/')){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);res.end();return;}
   res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try {
  const page=await browser.newPage();await page.addInitScript('globalThis.__PAYROLL_TEST__=true');
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/salary/index.html`);
  await page.evaluate(()=>PayrollWorkbenchUI.init());
  const result=await page.evaluate(async()=>{
   currentMonth='2026-09';currentWorkdays=22;state.payrollStage='gross';
   sourceRows={roster:[],salary:[],performance:[],attendance:[],other:[],netSocial:[],netFund:[],tax:[],afterTax:[]};
   for(let i=0;i<1200;i++){
    const name='测试员工'+i;
    sourceRows.roster.push({姓名:name,工号:String(i),公司:'测试公司',一级部门:'研发',是否入离职:'在职',入职日期:'2020-01-01',是否实习生:'否'});
    sourceRows.salary.push({姓名:name,基本工资:8000,岗位工资:2000,绩效基数:1200});
    sourceRows.performance.push({姓名:name,绩效系数:1});
    sourceRows.attendance.push({姓名:name,实际出勤天数:22,餐补合计:300});sourceRows.other.push({姓名:name,其他加:0});
    sourceRows.netSocial.push({姓名:name,个人总计:800,公司总计:1200});sourceRows.netFund.push({姓名:name,个人缴纳:300,公司缴纳:300});
    sourceRows.tax.push({姓名:name,税:200});sourceRows.afterTax.push({姓名:name,餐费代扣:200});
   }
   state.liveImport=true;state.sourceStatus=Object.fromEntries(Object.keys(sourceRows).map(key=>[key,{uploaded:true,filename:key+'.xlsx'}]));
   currentBatch().draftOrigin='user-import';currentBatch().workbench={gross:{},netGenerated:{},netUploaded:{},history:[],reviewed:{},revision:0};
   const key=JSON.stringify(['测试员工0','测试公司','研发']);PayrollWorkbench.data().gross[key]={otherAdd:200};
   const before=JSON.stringify(sourceRows);let ticks=0;const timer=setInterval(()=>ticks++,10),start=performance.now();
   await calculateStage();clearInterval(timer);
   if(employees.length!==1200||employees[0].gross!==11700||!state.calculated)throw Error('Server gross calculation failed');
   const grossMs=performance.now()-start;
   state.payrollStage='net';PayrollWorkbench.data().netGenerated[key]={tax:250};
   await calculateStage();
   if(employees[0].net!==10150||employees[1].net!==10000)throw Error('Server net calculation failed');
   const saved=JSON.stringify(employees),pending=calculateStage();
   if(!state.calculating||!document.querySelector('[data-payroll-cancel]'))throw Error('Missing busy/cancel UI');
   document.querySelector('[data-payroll-cancel]').click();await pending;
   if(JSON.stringify(employees)!==saved||state.calculating||PayrollCalculation.busy)throw Error('Cancellation changed results or remained busy');
   const lateCancel=calculateStage();setTimeout(()=>document.querySelector('[data-payroll-cancel]')?.click(),100);await lateCancel;
   if(JSON.stringify(employees)!==saved||state.calculating||PayrollCalculation.busy)throw Error('Server job cancellation failed');
   await calculateStage();if(JSON.stringify(employees)!==saved)throw Error('Retry changed results');
   // Source changes must schedule the server rather than recalculate the whole batch on the page.
   sourceRows.salary[1].基本工资=9000;recalculateEmployees();
   const deadline=Date.now()+20000;
   while(!state.calculated&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
   if(!state.calculated||employees[1].gross!==12500)throw Error('Automatic server recomputation failed');
   sourceRows.salary[1].基本工资=8000;
   if(JSON.stringify(sourceRows)!==before)throw Error('Source rows were mutated');
   await PayrollWorkbench.flush();
   return {count:employees.length,grossMs,ticks,gross:employees[0].gross,net:employees[0].net,cancelRetry:true,automatic:true};
  });
  assert(result.ticks>3);assert(requests.includes('POST')&&requests.includes('GET')&&requests.includes('DELETE'));
  assert.deepEqual(errors,[]);console.log(JSON.stringify(result));
 }finally{await browser.close();jobs.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
