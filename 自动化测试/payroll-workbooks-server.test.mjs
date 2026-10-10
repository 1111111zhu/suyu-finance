import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import ExcelJS from 'exceljs';
import XLSX from 'xlsx';
import {fromRows,fromXlsx,toXlsx,payrollRows} from '../server/payroll/workbooks/model.mjs';
import {createWorkbookJobs} from '../server/payroll/workbooks/jobs.mjs';
import {createWorkbookRepository} from '../server/payroll/workbooks/repository.mjs';
import {createWorkbookResponse} from '../server/payroll/workbooks/response.mjs';
import {openTestDatabase} from './helpers/payroll-postgres.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
async function completed(jobs,owner,id){const deadline=Date.now()+30000;while(Date.now()<deadline){const state=jobs.get(owner,id);if(state.status==='completed')return jobs.result(owner,id);if(state.status==='failed')throw Error(state.error);await new Promise(r=>setTimeout(r,30));}throw Error('Test timed out');}
test('Excel round trip preserves styles, dates, text IDs, merge, freeze and sheet order',async()=>{
 const book=new ExcelJS.Workbook(),s=book.addWorksheet('在职员工');s.mergeCells('A1:D1');s.getCell('A1').value='员工资料';s.getCell('A1').font={bold:true,color:{argb:'FF176E63'}};
 s.addRow(['姓名','工号','入职日期','银行卡号']);s.addRow(['甲','00001',new Date('2024-02-01T00:00:00Z'),'000123456789012345678']);s.getCell('C3').numFmt='yyyy-mm-dd';s.views=[{state:'frozen',ySplit:2}];s.getColumn(1).width=22;s.getRow(2).height=30;s.autoFilter='A2:D3';book.addWorksheet('离职员工').addRow(['姓名']);
 const {snapshot}=await fromXlsx(await book.xlsx.writeBuffer(),'花名册.xlsx');assert.equal(payrollRows(snapshot,'roster')[0].工号,'00001');assert.equal(payrollRows(snapshot,'roster')[0].入职日期,'2024-02-01');
 const out=new ExcelJS.Workbook();await out.xlsx.load(await toXlsx(snapshot));assert.deepEqual(out.worksheets.map(w=>w.name),['在职员工','离职员工']);assert.equal(out.worksheets[0].getCell('D3').value,'000123456789012345678');assert.equal(out.worksheets[0].getCell('A1').font.bold,true);assert.equal(out.worksheets[0].getCell('A1').isMerged,true);assert.equal(out.worksheets[0].views[0].ySplit,2);assert.equal(out.worksheets[0].getColumn(1).width,22);
});
test('server worker recomputes formulas and does not block the request event loop',async()=>{
 const jobs=createWorkbookJobs({root});try {
  const snapshot=fromRows('salary',[{姓名:'甲',基本工资:8800},{姓名:'乙',基本工资:1}],'基本工资.xlsx');snapshot.sheets[snapshot.sheetOrder[0]].cellData[2][1]={f:'=B2+1000',v:-999,t:2};
  const job=jobs.submit('甲',{action:'export',key:'salary',bytes:Buffer.from(JSON.stringify({snapshot}))});let ticks=0;const timer=setInterval(()=>ticks++,5);
  let result;try{result=await completed(jobs,'甲',job.id);}finally{clearInterval(timer);}assert(ticks>10);const out=new ExcelJS.Workbook();await out.xlsx.load(result.bytes);assert.equal(out.worksheets[0].getCell('B3').formula,'B2+1000');assert.equal(out.worksheets[0].getCell('B3').result,9800);assert.throws(()=>jobs.result('乙',job.id),e=>e.status===404);
 }finally{jobs.close();}
});
test('all payroll imports run the current authoritative multi-file parser on the server',async()=>{
 const book=new ExcelJS.Workbook();book.addWorksheet('基本工资表').addRows([['姓名','基本工资'],['甲',6000]]);const jobs=createWorkbookJobs({root});try{
 const job=jobs.submit('甲',{action:'source-import',key:'salary',filename:'工资.xlsx',month:'2026-09',stage:'gross',bytes:Buffer.from(await book.xlsx.writeBuffer())});const data=JSON.parse((await completed(jobs,'甲',job.id)).bytes);assert.equal(data.rows[0].姓名,'甲');assert.equal(data.rows[0].基本工资,6000);assert.equal(data.metadata.importItems[0].key,'salary');
 }finally{jobs.close();}
});
test('server payroll exports retain authoritative formulas and immutable calculated inputs',async()=>{
 const context=vm.createContext({structuredClone,setTimeout:()=>0,clearTimeout(){},window:{XLSX}});
 for(const f of ['payroll-engine.js','payroll-email-engine.js','calculation-model.js','workbench-core.js'])vm.runInContext(readFileSync(new URL('../public/salary/'+f,import.meta.url),'utf8'),context);
 vm.runInContext(`showToast=()=>{};render=()=>{};sourceRows={roster:[{姓名:'甲',公司:'公司',一级部门:'研发',入职日期:'2024-03-08',工号:'001'}],salary:[{姓名:'甲',基本工资:10000,绩效基数:1000}],attendance:[{姓名:'甲',实际出勤天数:22}]};state.liveImport=true;currentMonth='2026-09';currentWorkdays=22;recalculateEmployees();`,context);
 const snapshot=vm.runInContext(`structuredClone({month:currentMonth,workdays:currentWorkdays,makeupWorkdays,state:{...state,batches:[structuredClone(currentBatch())]},sourceRows,employees,generatedEmployees,profiles,rawProfiles:[...PayrollWorkbench.rawProfiles],importErrors:[]})`,context),jobs=createWorkbookJobs({root});
 try{const job=jobs.submit('甲',{action:'source-export',bytes:Buffer.from(JSON.stringify({kind:'gross',snapshot}))});const result=await completed(jobs,'甲',job.id);assert.equal(result.filename,'应发工资表_2026-09.xlsx');const wb=XLSX.read(result.bytes,{type:'buffer'});assert.deepEqual(wb.SheetNames,['应发工资表']);assert(Object.values(wb.Sheets[wb.SheetNames[0]]).some(c=>c?.f));}finally{jobs.close();}
});
test('database append-only versions, isolation, original copies, idempotency and optimistic conflicts',async()=>{
 const db=await openTestDatabase();try{
  const ids=(await db.pool.query("INSERT INTO payroll.users(username,display_name,password_hash) VALUES('test1','甲','scrypt$test'),('test2','乙','scrypt$test') RETURNING id")).rows.map(r=>r.id),repo=createWorkbookRepository(db.pool);
  const snapshot=fromRows('salary',[{姓名:'甲',基本工资:6000}],'工资.xlsx'),bytes=await toXlsx(snapshot);
  const input={snapshot,rows:payrollRows(snapshot,'salary'),filename:'工资.xlsx',warnings:[],requestKey:randomUUID(),requestSha256:createHash('sha256').update('one').digest('hex'),expectedRevision:0,originalBase64:bytes.toString('base64')};
  const first=await repo.save(ids[0],'salary',input);assert.equal(first.revision,1);assert.equal((await repo.save(ids[0],'salary',input)).revision,1);assert.equal(await repo.read(ids[1],'salary'),null);assert.deepEqual((await repo.original(ids[0],first.originalId)).bytes,bytes);await assert.rejects(repo.original(ids[1],first.originalId),e=>e.status===404);
  await assert.rejects(repo.save(ids[0],'salary',{...input,requestSha256:'0'.repeat(64)}),e=>e.status===409);
  snapshot.sheets[snapshot.sheetOrder[0]].cellData[1][1].v=8800;
  const second=await repo.save(ids[0],'salary',{...input,rows:payrollRows(snapshot,'salary'),expectedRevision:1,requestKey:randomUUID(),requestSha256:'1'.repeat(64),originalBase64:null,originalId:first.originalId});assert.equal(second.revision,2);assert.equal((await repo.read(ids[0],'salary',1)).rows[0].基本工资,6000);assert.equal((await repo.read(ids[0],'salary')).rows[0].基本工资,8800);
  await assert.rejects(repo.save(ids[0],'salary',{...input,requestKey:randomUUID(),requestSha256:'2'.repeat(64)}),e=>e.status===409);
  await assert.rejects(db.pool.query('DELETE FROM payroll.workbook_versions WHERE master_id=$1',[first.id]));await assert.rejects(db.pool.query('UPDATE payroll.workbook_masters SET owner_id=$1,revision=revision+1 WHERE id=$2',[ids[1],first.id]));
 }finally{await db.close();}
});
test('job queues are bounded, private and time out without exposing worker exceptions',async()=>{
 const workers=[],jobs=createWorkbookJobs({root,timeoutMs:30,workerFactory:()=>{const w=new EventEmitter();w.terminate=async()=>{};workers.push(w);return w;}});
 try{const one=jobs.submit('甲',{action:'export',bytes:Buffer.alloc(0)});jobs.submit('甲',{action:'read'});assert.throws(()=>jobs.submit('甲',{}),e=>e.status===429);assert.throws(()=>jobs.get('乙',one.id),e=>e.status===404);await new Promise(r=>setTimeout(r,40));assert.equal(jobs.get('甲',one.id).status,'failed');assert.throws(()=>jobs.result('甲',one.id),e=>e.status===409);}finally{jobs.close();}
});
test('HTTP authentication, bounded streaming upload and owner-bound task downloads',async()=>{
 const jobs=createWorkbookJobs({root}),route=createWorkbookResponse({authorize:async request=>{if(request.headers.get('X-Test-User')==='denied')throw Object.assign(Error('无权访问'),{status:403});return {userid:request.headers.get('X-Test-User')||'甲'};},jobs});
 try{
  const denied=await route(new Request('http://127.0.0.1:3220/api/payroll/workbooks/salary',{headers:{'X-Test-User':'denied'}}));assert.equal(denied.status,403);
  const huge=await route(new Request('http://127.0.0.1:3220/api/payroll/workbooks/salary/import',{method:'POST',headers:{'Content-Length':String(21*1024*1024)}}));assert.equal(huge.status,413);
  const snapshot=fromRows('salary',[{姓名:'甲',基本工资:6000}],'工资.xlsx'),res=await route(new Request('http://127.0.0.1:3220/api/payroll/workbooks/salary/export',{method:'POST',body:JSON.stringify({snapshot})}));assert.equal(res.status,202);const job=await res.json();await completed(jobs,'甲',job.id);
  const other=await route(new Request(`http://127.0.0.1:3220/api/payroll/workbooks/jobs/${job.id}/result`,{headers:{'X-Test-User':'other'}}));assert.equal(other.status,404);
  const result=await route(new Request(`http://127.0.0.1:3220/api/payroll/workbooks/jobs/${job.id}/result`));assert(result.headers.get('content-type').includes('spreadsheet'));assert((await result.arrayBuffer()).byteLength>1000);
 }finally{jobs.close();}
});
