import {createUniver,LocaleType,mergeLocales} from '@univerjs/presets';
import {UniverSheetsCorePreset} from '@univerjs/preset-sheets-core';
import {UniverSheetsFilterPreset} from '@univerjs/preset-sheets-filter';
import coreZh from '@univerjs/preset-sheets-core/locales/zh-CN';
import filterZh from '@univerjs/preset-sheets-filter/locales/zh-CN';
import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs/preset-sheets-filter/lib/index.css';
import './editor.css';
const params=new URLSearchParams(location.search),key=params.get('key'),token=params.get('token'),origin=location.origin;
if(!['roster','salary'].includes(key)||!token)throw Error('请从工资资料页打开工作簿');
const label=key==='roster'?'花名册':'员工基本工资表';
const status=document.getElementById('editorStatus'),fileInput=document.getElementById('workbookFile');
let instance=null,api=null,record=null,revision=0,dirty=false,busy=false,applying=false,initialized=false;let saveRequestKey=null;
const post=(type,payload={})=>parent.postMessage({type,token,key,...payload},origin);
async function json(action='',data,method='POST'){return globalThis.PayrollWorkbookAPI.json(`${key}${action?'/'+action:''}`,data,method);}
function message(text,error=false){status.textContent=text;status.classList.toggle('error',error);}
function markDirty(){if(applying||!initialized)return;dirty=true;saveRequestKey=null;message('有未保存修改');post('workbook-dirty',{dirty:true});}
function setBusy(value){busy=value;document.querySelectorAll('[data-action]').forEach(b=>b.disabled=value);document.getElementById('workbookClose').disabled=value;}
function sameRows(a,b){const clean=rows=>JSON.stringify((rows||[]).map(row=>Object.fromEntries(Object.entries(row).filter(([k])=>!k.startsWith('_')).sort(([a],[b])=>a.localeCompare(b)))));return clean(a)===clean(b);}
async function load(next){
  applying=true;initialized=false;
  try {if(instance)instance.dispose();
    const created=createUniver({locale:LocaleType.ZH_CN,locales:{[LocaleType.ZH_CN]:mergeLocales(coreZh,filterZh)},presets:[UniverSheetsCorePreset({workerURL:new URL('./formula-worker.js',import.meta.url).href,container:'univer',ribbonType:'classic',header:true,toolbar:true,formulaBar:true,footer:true}),UniverSheetsFilterPreset()]});instance=created.univer;api=created.univerAPI;record=next;
    api.createWorkbook(record.snapshot);dirty=false;
    api.addEvent(api.Event.CommandExecuted,event=>{if(event.id?.includes('.command.')&&!/selection|zoom|scroll|hover|activate|formula|permission|sidebar|open|editor/.test(event.id))markDirty();});
    document.getElementById('workbookName').textContent=record.filename||label+'.xlsx';
    const warnings=document.getElementById('editorWarnings');warnings.textContent=(record.warnings||[]).join(' ');warnings.hidden=!warnings.textContent;
    const original=document.getElementById('downloadOriginal');original.hidden=!(record.originalId||record.originalBase64);
    await api.getFormula().onCalculationResultApplied(15000);
    message('已打开 · Ctrl / ⌘ + S 保存');
  }finally {applying=false;initialized=true;}
}
async function snapshot(){const book=api.getActiveWorkbook();await book.endEditingAsync(true);return book.save();}
async function save(){if(busy||!record)return;setBusy(true);message('服务器正在计算公式并保存…');try{const current=await snapshot();const result=await json('',{...record,snapshot:current,expectedRevision:revision,requestKey:saveRequestKey ||= crypto.randomUUID()},'PUT');record=result.record;revision=record.revision;saveRequestKey=null;dirty=false;post('workbook-saved',{record});message('已保存到服务器数据库 · '+new Date(record.updatedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}));document.getElementById('discardChanges').hidden=true;}catch(e){message(e.message,true);}finally{setBusy(false);}}
async function download(){if(busy||!record)return;setBusy(true);message('正在生成 Excel…');try{const current=await snapshot(),response=await globalThis.PayrollWorkbookAPI.binary(`${key}/export`,{snapshot:current});const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=(record.filename||label+'.xlsx').replace(/\.(xlsx|xls|csv)$/i,'')+'_内置.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);message(dirty?'Excel 已导出，网页修改尚未保存':'Excel 已导出');}catch(e){message(e.message,true);}finally{setBusy(false);}}
function close(force=false){if(busy)return;if(dirty&&!force){document.getElementById('discardChanges').hidden=false;message('有未保存修改：请先保存，或点击“放弃修改并关闭”');return;}post('workbook-close');}
document.getElementById('workbookSave').onclick=save;document.getElementById('workbookExport').onclick=download;
document.getElementById('workbookOpen').onclick=()=>fileInput.click();document.getElementById('workbookClose').onclick=()=>close();document.getElementById('discardChanges').onclick=()=>close(true);
document.getElementById('downloadOriginal').onclick=async()=>{if(!record.originalId){message('请先保存，再下载服务器留存的原始文件');return;}setBusy(true);try{const response=await globalThis.PayrollWorkbookAPI.binary(`${key}/original?id=${record.originalId}`,{}),url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download='原始_'+record.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}catch(e){message(e.message,true);}finally{setBusy(false);}};
fileInput.onchange=async()=>{const file=fileInput.files[0];if(!file)return;if(file.size>20*1024*1024){message('Excel 文件不能超过 20MB',true);fileInput.value='';return;}if(dirty){message('请先保存当前修改，再打开其他 Excel',true);fileInput.value='';return;}setBusy(true);message('正在读取完整 Excel 工作簿…');try{const result=await globalThis.PayrollWorkbookAPI.json(`${key}/import`,file,'POST',{'X-Workbook-Filename':encodeURIComponent(file.name)});await load(result.record);markDirty();message('Excel 已打开，请保存后用于算薪');}catch(e){message(e.message,true);}finally{setBusy(false);fileInput.value='';}};
window.addEventListener('message',async event=>{if(event.origin!==origin||event.source!==parent||event.data?.token!==token)return;if(event.data.type==='workbook-request-close')return close();if(event.data.type!=='workbook-init'||record)return;setBusy(true);try{const result=await json('',undefined,'GET');revision=result.record?.revision||0;let next=result.record;
  let historical=null;if(event.data.record?.revision)historical=(await globalThis.PayrollWorkbookAPI.json(`${key}?revision=${event.data.record.revision}`,undefined,'GET')).record;
  if(historical||event.data.record?.snapshot)next=historical||event.data.record;
  else if(event.data.rows?.length&&(!result.record||!sameRows(event.data.rows,result.record.rows))){const converted=await json('from-rows',{rows:event.data.rows});next=converted.record;}
  if(!next){const converted=await json('from-rows',{rows:event.data.seedRows||[]});next=converted.record;}
  await load(next);post('workbook-loaded');
}catch(e){message('打开失败：'+e.message,true);}finally{setBusy(false);}});
window.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void save();}if(event.key==='Escape'&&!document.querySelector('[role="dialog"]'))close();},true);
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
post('workbook-ready');
