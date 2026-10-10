/* Whole-workbook editor bridge. Monthly batches keep snapshots; masters live in PostgreSQL. */
globalThis.PayrollBuiltinSheets=(()=>{
  const keys=['roster','salary'],fileSources=new WeakMap(),fileCounts=new WeakMap(),pending=new Map();
  let library={},dialog=null,frame=null,session=null;
  async function request(key,action='',data,method='POST',headers={}){return (await PayrollWorkbookAPI.json(`${key}${action?'/'+action:''}`,data===null?undefined:data,method,headers)).record;}
  function copyRows(rows){return rows.slice();}
  function attach(batch,key,record){batch.workbench ||= {version:1,gross:{},netGenerated:{},netUploaded:{},history:[],reviewed:{},revision:0};batch.workbench.builtinWorkbooks ||= {};batch.workbench.builtinWorkbooks[key]={key:record.key,revision:record.revision,filename:record.filename};}
  async function persist(key,rows,file,batch){
    let record;
    if(file&&/\.xlsx$/i.test(file.name))record=await request(key,'import',file,'POST',{'X-Workbook-Filename':encodeURIComponent(file.name)});
    else record=await request(key,'from-rows',{rows:copyRows(rows)});
    const current=await request(key,'',null,'GET');
    record=await request(key,'',{...record,expectedRevision:current?.revision||0,requestKey:crypto.randomUUID()},'PUT');library[key]=record;attach(batch,key,record);
    if(currentBatch()===batch)saveBatchData();return record;
  }
  function enqueue(key,task){const operation=(pending.get(key)||Promise.resolve()).catch(()=>{}).then(task);pending.set(key,operation);operation.catch(error=>showToast(`内置${key==='roster'?'花名册':'基本工资'}保存失败：${error.message}；本批次导入数据保留`,7000)).finally(()=>{if(pending.get(key)===operation)pending.delete(key);});return operation;}
  const oldParse=parseXlsxFile;
  parseXlsxFile=async (file,key)=>{const rows=await oldParse(file,key);fileSources.set(rows,file);fileCounts.set(file,rows.length);for(const item of rows.importItems||[])fileSources.set(item.rows,file);return rows;};
  const oldCommit=commitSource;
  commitSource=(key,item,deferUpdate=false)=>{const result=oldCommit(key,item,deferUpdate);if(keys.includes(key)){const batch=currentBatch(),rows=copyRows(sourceRows[key]||[]),file=fileSources.get(item.rows);enqueue(key,()=>persist(key,rows,(file&&rows.length===fileCounts.get(file)?file:null),batch));}return result;};
  function reuse(){if(currentBatch().draftOrigin==='demo'||Object.keys(sourceRows).length)return;
    for(const key of keys)if(library[key]?.rows?.length){oldCommit(key,{rows:structuredClone(library[key].rows),filename:'内置'+(key==='roster'?'花名册':'员工基本工资表')+'.xlsx'});attach(currentBatch(),key,library[key]);}saveBatchData();
  }
  const oldBatch=setCurrentBatch;setCurrentBatch=batch=>{oldBatch(batch);reuse();};
  const oldRestore=PayrollWorkbench.restore;
  PayrollWorkbench.restore=async()=>{const restored=await oldRestore();try{
    const records=await Promise.all(keys.map(key=>request(key,'',null,'GET')));keys.forEach((key,i)=>{if(records[i])library[key]=records[i];});
    reuse();
  }catch(error){showToast('内置工作簿读取失败：'+error.message,6000);}return restored;};
  function close(){if(!dialog)return;dialog.close();dialog.remove();dialog=null;frame=null;session=null;}
  async function open(key){
    if(importSession().busy||state.calculating){showToast('资料正在处理，请稍候');return;}
    if(dialog)return;
    session={key,token:crypto.randomUUID(),batch:currentBatch(),dirty:false};
    dialog=document.createElement('dialog');dialog.className='builtin-workbook-dialog';dialog.setAttribute('aria-label',key==='roster'?'花名册 Excel 编辑器':'基本工资 Excel 编辑器');
    frame=document.createElement('iframe');frame.title=key==='roster'?'花名册 Excel 工作簿':'基本工资 Excel 工作簿';frame.src=`./workbook-editor.html?key=${key}&token=${session.token}&v=20261010-server-v1`;
    dialog.append(frame);document.body.append(dialog);dialog.showModal();dialog.addEventListener('cancel',event=>{event.preventDefault();frame.contentWindow.postMessage({type:'workbook-request-close',token:session.token},location.origin);});
  }
  window.addEventListener('message',async event=>{const data=event.data;if(!session||event.origin!==location.origin||event.source!==frame.contentWindow||data?.token!==session.token)return;
    if(data.type==='workbook-ready'){
      const selected=session;try{await pending.get(selected.key);}catch{}
      if(session!==selected)return;
      const rows=copyRows(sourceRows[selected.key]||library[selected.key]?.rows||[]);let seedRows=[];
      if(selected.key==='salary'&&!rows.length)seedRows=(sourceRows.roster||library.roster?.rows||[]).map(row=>({姓名:rowValue(row,['姓名']),基本工资:null,岗位工资:null,绩效基数:null,转正日期:null,转正前工资:null,转正后工资:null})).filter(row=>String(row.姓名??'').trim());
      frame.contentWindow.postMessage({type:'workbook-init',token:selected.token,record:selected.batch.workbench?.builtinWorkbooks?.[selected.key]||null,rows,seedRows},location.origin);
    }
    if(data.type==='workbook-dirty')session.dirty=true;
    if(data.type==='workbook-close'){close();return;}
    if(data.type==='workbook-saved'){
      if(currentBatch()!==session.batch){showToast('工作簿已保存；原工资批次已切换，请重新打开后应用',6000);return;}
      const record=data.record;if(!record||record.key!==session.key||!Array.isArray(record.rows))return;
      library[session.key]=record;oldCommit(session.key,{rows:structuredClone(record.rows),filename:'内置'+(session.key==='roster'?'花名册':'员工基本工资表')+'.xlsx'});attach(session.batch,session.key,record);saveBatchData();session.dirty=false;render('upload');showToast('完整工作簿已保存到服务器数据库，当前工资资料已更新');
    }
  });
  window.addEventListener('beforeunload',event=>{if(session?.dirty||pending.size){event.preventDefault();event.returnValue='';}});
  const oldUpload=PayrollWorkbenchPages.upload;
  PayrollWorkbenchPages.upload=()=>oldUpload().replace(/(<input type="file"[^>]*id="file-(roster|salary)"[^>]*>)/g,(_match,input,key)=>`${input}<button type="button" class="btn btn-primary" data-builtin-sheet="${key}" ${importSession().busy?'disabled':''}>打开内置 Excel</button>`);
  document.addEventListener('click',event=>{const button=event.target.closest('[data-builtin-sheet]');if(button)void open(button.dataset.builtinSheet);});
  const style=document.createElement('style');style.textContent='.builtin-workbook-dialog{padding:0;border:1px solid #dbe4e1;border-radius:12px;width:calc(100vw - 32px);height:calc(100vh - 32px);max-width:none;max-height:none;overflow:hidden;box-shadow:0 18px 80px #172d3844}.builtin-workbook-dialog::backdrop{background:#142b3e80}.builtin-workbook-dialog iframe{display:block;border:0;width:100%;height:100%;background:white}';document.head.append(style);
  return {open,reuse,flush:()=>Promise.allSettled([...pending.values()])};
})();
