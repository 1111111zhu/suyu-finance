import {parentPort,workerData} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import XLSX from 'xlsx';
import {payrollActor} from '../../access/payroll-tag-actor.mjs';
import {createPool} from '../../../database/payroll/pool.mjs';
import {createWorkbookRepository} from './repository.mjs';
import {fromXlsx,fromRows,toXlsx,payrollRows,validateSnapshot,inspectArchive} from './model.mjs';
import {recalculate} from './formulas.mjs';
const {key,action,root,revision,filename,month,stage,originalId}=workerData;
let pool;let actorId;
async function actor(){const repository=db();actorId ||= (await payrollActor(pool,workerData.access)).id;return {repository,owner:actorId};}
const db=()=>createWorkbookRepository(pool??=createPool({connectionString:process.env.PAYROLL_DATABASE_URL,max:1,application_name:'payroll-workbook-worker'}));
function model() {
  const context=vm.createContext({structuredClone,setTimeout,clearTimeout,TextDecoder,TextEncoder,XLSX});context.window=context;
  for(const file of ['payroll-engine.js','payroll-email-engine.js','calculation-model.js','workbench-core.js'])
    vm.runInContext(readFileSync(join(root,'public/salary',file),'utf8'),context);
  return context;
}
try {
  const bytes=Buffer.from(workerData.bytes||[]),input=bytes.length&&!['import','source-import'].includes(action)?JSON.parse(bytes.toString('utf8')):{};
  let value,binary=false,outputFilename;
  if(action==='read'){const a=await actor();value={record:await a.repository.read(a.owner,key,revision)};}
  else if(action==='original'){const a=await actor();value=(await a.repository.original(a.owner,originalId)).bytes;binary=true;}
  else if(action==='import')value={record:{key,filename,...await fromXlsx(bytes,filename),originalBase64:bytes.toString('base64')}};
  else if(action==='from-rows') {
    if(!Array.isArray(input.rows)||input.rows.length>20000)throw Object.assign(new Error('员工数据无效或超过 2 万行'),{status:413});
    value={record:{key,filename:key==='roster'?'花名册.xlsx':'基本工资.xlsx',snapshot:fromRows(key,input.rows,filename),warnings:[],originalId:null}};
  } else if(action==='save') {
    input.requestSha256=createHash('sha256').update(bytes).digest('hex');validateSnapshot(input.snapshot);input.snapshot=await recalculate(input.snapshot);
    input.rows=payrollRows(input.snapshot,key);
    input.filename=String(input.filename||'内置.xlsx').slice(0,200);
    input.warnings=Array.isArray(input.warnings)?input.warnings.filter(x=>typeof x==='string').slice(0,20):[];
    const a=await actor();value={record:await a.repository.save(a.owner,key,input)};
  } else if(action==='export') {
    validateSnapshot(input.snapshot);value=await toXlsx(await recalculate(input.snapshot));binary=true;
  } else if(action==='source-import') {
    if(bytes[0]===0x50&&bytes[1]===0x4b)inspectArchive(bytes);
    const context=model();context.file={name:filename,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
    context.explicitKey=key||'';context.month=month;context.stage=stage;
    const rows=await vm.runInContext('currentMonth=month;state.payrollStage=stage;parseXlsxFile(file,explicitKey)',context);
    value={rows:[...rows],metadata:{sheetName:rows.sheetName,sourceStartRow:rows.sourceStartRow,importItems:rows.importItems,skippedSheets:rows.skippedSheets}};
  } else if(action==='source-export') {
    const context=model(),source=readFileSync(join(root,'public/salary/export-worker.js'),'utf8');
    context.importScripts=()=>{};context.self={postMessage:result=>{if(result.error)throw new Error(result.error);value=Buffer.from(result.bytes);outputFilename=result.filename;}};
    vm.runInContext(source,context);context.request={...input,id:1};vm.runInContext('self.onmessage({data:request})',context);binary=true;
    // export-worker sends filename together with bytes; derive from this immutable input.
  } else throw Object.assign(new Error('工作簿操作不存在'),{status:404});
  const output=Uint8Array.from(binary?value:Buffer.from(JSON.stringify(value)));
  if(output.length>60*1024*1024)throw Object.assign(new Error('工作簿结果过大，请缩减资料'),{status:413});
  if(pool){await pool.end();pool=null;}
  parentPort.postMessage({bytes:output,binary,filename:outputFilename},[output.buffer]);
} catch(error) {
  if(pool)await pool.end().catch(()=>{});
  parentPort.postMessage({error:error.status?error.message:/公式|姓名|工作表|Excel|表头|工作簿|员工|数据行/.test(error.message||'')?error.message:'服务器文件处理失败，请核对资料后重试',status:error.status||422});
}
