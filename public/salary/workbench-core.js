/* Batch-local adjustment layer. Imported rows and original files remain read-only. */
globalThis.PayrollWorkbench = (() => {
  const round = PayrollEngine.round;
  const original = {calc:calcSalary, net:PayrollEngine.calculateNet, recalc:recalculateEmployees,
    save:saveBatchData, batch:setCurrentBatch, commit:commitSource, issues:visibleIssues, detail:detailSheet, summary:summarySheet};
  const rawProfiles = new Map();
  const defaultProfiles = structuredClone(profiles);
  let preview = null, hydrating = false, storageError = '', queue = Promise.resolve();
  const fields = {
    base:['基本工资','salary'], post:['岗位工资','salary'], perfBase:['绩效基数','salary'], score:['绩效系数','performance'],
    performancePay:['绩效工资','performance'], meal:['餐饮津贴','attendance'], transit:['交通津贴','attendance'],
    otherAllow:['其他津贴','other'], otherAdd:['其他加项','other'], otherReduction:['其他减项','other'],
    actualPaidDays:['实发薪天数','attendance'], sick:['病假天数','attendance'], personal:['事假天数','attendance'],
    absent:['旷工天数','attendance'], annual:['年假天数','attendance'], flexible:['弹性假天数','attendance'],
    compensatory:['调休假天数','attendance'], attendanceDeduct:['假勤扣款','attendance'], sickSubsidy:['病假补贴','attendance'],
    dailyRate:['实习生日薪','manual'], probationTotal:['转正前月薪','salary'], regularTotal:['转正后月薪','salary'],
    probationWorkdays:['转正前应出勤天数','attendance'], regularWorkdays:['转正后应出勤天数','attendance'],
    probationBase:['转正前基本工资','salary'], regularBase:['转正后基本工资','salary'],
    probationPost:['转正前岗位工资','salary'], regularPost:['转正后岗位工资','salary'],
    probationPerfBase:['转正前绩效基数','salary'], regularPerfBase:['转正后绩效基数','salary'],
    social:['个人社保','social'], fund:['个人公积金','fund'], tax:['个税','tax'],
    utility:['水电代扣','afterTax'], mealDeduct:['餐费代扣','afterTax'], otherDeduct:['其他代扣','afterTax'],
    companySocial:['公司缴纳社保','netSocial'], companyFund:['公司缴纳公积金','netFund'],
    grossTarget:['应发工资','manual'], netTarget:['实发工资','manual']
  };
  const computedFields = new Set(['performancePay','attendanceDeduct','sickSubsidy','grossTarget']);
  const netFields = new Set(['social','fund','tax','utility','mealDeduct','otherDeduct','companySocial','companyFund','netTarget']);
  function data() {
    const b=currentBatch();
    b.workbench ||= {version:1,gross:{},netGenerated:{},netUploaded:{},history:[],reviewed:{},revision:0};
    return b.workbench;
  }
  function key(e) { return JSON.stringify([String(e.name||'').trim(),String(e.company||'').trim(),String(e.dept||'').trim()]); }
  function scope(stage=state.payrollStage) {return stage==='gross'?'gross':sourceRows.grossUpload?'netUploaded':'netGenerated';}
  function overrides(e,stage=state.payrollStage) {
    const s=scope(stage), k=key(e), values={...(data()[s][k]||{})};
    if(preview && preview.scope===s && preview.key===k) values[preview.field]=preview.value;
    return values;
  }
  function ambiguous(e,stage=state.payrollStage) {
    const rows=stage==='net'&&sourceRows.grossUpload?sourceRows.grossUpload:sourceRows.roster;
    return (rows||[]).filter(r=>String(rowValue(r,['姓名'])||'').trim()===String(e.name||'').trim()).length>1;
  }
  function calculatedGross(profile,month,days) {
    const k=key(profile), o=overrides(profile,'gross');
    rawProfiles.set(k,structuredClone(profile));
    const roster=profile.rosterRow?sourceRows.roster?.[profile.rosterRow-2]:null;
    const p={...profile,employeeNumber:String(rowValue(roster,['工号','员工编号','员工工号'])||profile.employeeNumber||profile.id)};
    for(const [field,value] of Object.entries(o)) if(!computedFields.has(field)) p[field]=value;
    if(Object.hasOwn(o,'actualPaidDays')) p.paidDayIssues=(p.paidDayIssues||[]).filter(x=>!(/实发薪天数|未上传考勤|考勤统计表中未找到/.test(x)));
    const e=original.calc(p,month,days);
    e._workbenchKey=k;
    e._input={...p};
    e._grossOriginal=round(original.calc(profile,month,days).gross);
    if(!e.isIntern) {
      if(Object.hasOwn(o,'performancePay')) {
        const delta=o.performancePay-e.performancePay;
        e.performancePay=o.performancePay; e.subtotal+=delta;
        if(e.attendanceDeduct!==null) e.attendanceDeduct=e.subtotal/21.75*e.deductDays;
      }
      for(const field of ['attendanceDeduct','sickSubsidy']) if(Object.hasOwn(o,field)) e[field]=o[field];
      e.gross=round(e.subtotal+num(e.meal)+num(e.transit)+num(e.otherAllow)+num(e.sickSubsidy)+num(e.otherAdd)-num(e.attendanceDeduct)-num(e.otherReduction));
    }
    e.computedGross=round(e.gross);
    e.grossAdjustment=Object.hasOwn(o,'grossTarget')?round(o.grossTarget-e.computedGross):0;
    e.gross=round(e.computedGross+e.grossAdjustment); e.net=e.gross;
    if(e.isIntern) e.internPay=e.gross;
    e._grossPinned=Object.hasOwn(o,'grossTarget');
    return e;
  }
  calcSalary=calculatedGross;
  const originalUploaded=PayrollEngine.uploadedEmployees;
  PayrollEngine.uploadedEmployees=rows=>originalUploaded(rows).map(e=>({...e,employeeNumber:String(rowValue(rows.find(r=>String(rowValue(r,['姓名'])||'').trim()===e.name),['工号','员工编号','员工工号'])||e.id)}));
  PayrollEngine.calculateNet=(list,sources)=>original.net(list,sources).map(e=>{
    const o=overrides(e,'net');
    e._netOriginal=e.net;
    for(const [field,value] of Object.entries(o)) if(netFields.has(field)&&field!=='netTarget') e[field]=value;
    if(e.isIntern) for(const f of ['social','fund','tax','utility','mealDeduct','otherDeduct']) e[f]=0;
    e.afterTaxTotal=round(e.utility+e.mealDeduct+e.otherDeduct);
    e.computedNet=e.isIntern?e.gross:round(e.gross-e.social-e.fund-e.tax-e.afterTaxTotal);
    e.netAdjustment=Object.hasOwn(o,'netTarget')?round(o.netTarget-e.computedNet):0;
    e.net=round(e.computedNet+e.netAdjustment);
    e.companyCost=round(e.gross+e.companySocial+e.companyFund);
    e._netPinned=Object.hasOwn(o,'netTarget');
    e.deductionIssues=(e.deductionIssues||[]).filter(issue=>!Object.keys(o).some(f=>f!=='netTarget'&&issue.startsWith(fields[f]?.[0])));
    return e;
  });
  function history(e,stage=state.payrollStage) { return data().history.filter(h=>h.key===key(e)&&h.scope===scope(stage)); }
  function adjustmentNotes(e,stage=state.payrollStage) {
    return history(e,stage).filter(h=>!h.revoked).map(h=>`${fields[h.field]?.[0]||h.field}：${h.before} → ${h.value}${h.reason?`（${h.reason}）`:''}`);
  }
  visibleIssues=(e,stage=state.payrollStage)=>{
    const issues=original.issues(e,stage);
    const k=key(e), d=data();
    if(stage==='net'&&!sourceRows.grossUpload&&d.taxReview?.[k]) issues.push('应发已调整，请核对个税表金额');
    if(d.sourceChanged&&Object.keys(overrides(e,stage)).length&&!isReviewed(e)) issues.push('源表已更新，请复核本人的人工调整');
    return [...new Set(issues)];
  };
  function selected() {return employees.find(e=>e.id===state.selectedId)||employees[0];}
  function value(e,field) {
    if(field==='grossTarget') return e.gross;
    if(field==='netTarget') return e.net;
    if(state.payrollStage==='gross'&&!computedFields.has(field)&&e._input&&field in e._input) return e._input[field];
    return e[field];
  }
  function validate(e,field,input,reason) {
    if(!e||!fields[field]) throw new Error('请选择可修改的工资项目');
    if(ambiguous(e)) throw new Error('源表存在重复姓名，请先核对并区分同名员工后再修改');
    if(state.payrollStage==='net'&&!netFields.has(field)) throw new Error('请到第一阶段修改应发项目');
    if(state.payrollStage==='gross'&&netFields.has(field)&&!['social','fund'].includes(field)) throw new Error('该项目在第二阶段调整');
    if(e.isIntern&&state.payrollStage==='net'&&!['netTarget','companySocial','companyFund'].includes(field)) throw new Error('实习生不参与常规扣款');
    const v=PayrollEngine.numeric(input);
    if(v===null||!Number.isFinite(v)) throw new Error('请输入有效数字，空白不会按 0 保存');
    const days=/Days$|Workdays$/.test(field)||['sick','personal','absent','annual','flexible','compensatory'].includes(field);
    if((days||!['grossTarget','netTarget'].includes(field))&&v<0) throw new Error('该项目不能填写负数');
    if(days&&v>31) throw new Error('天数不能超过 31 天');
    if(reason!==undefined&&!String(reason).trim()) throw new Error('请填写简短的修改原因');
    return days||field==='score'?v:round(v);
  }
  function previewChange(e,field,input) {
    preview={key:key(e),scope:scope(),field,value:validate(e,field,input)};
    original.recalc();return selected();
  }
  function clearPreview() {preview=null;original.recalc();}
  function saveChange(e,field,input,reason) {
    const v=validate(e,field,input,reason), k=key(e), s=scope(), before=value(e,field), d=data();
    const prior=d[s][k]?.[field];
    preview=null;d[s][k]||={};d[s][k][field]=v;
    d.history.push({id:Date.now()+'-'+d.history.length,key:k,name:e.name,scope:s,field,before,value:v,previous:prior??null,reason:String(reason).trim(),at:new Date().toISOString()});
    delete d.reviewed[s+':'+k];d.revision++;
    if(s==='gross'&&!['social','fund'].includes(field)){d.taxReview||={};d.taxReview[k]=true;delete d.reviewed['netGenerated:'+k];}
    if(s==='netGenerated'&&field==='tax'&&d.taxReview) delete d.taxReview[k];
    if(state.emailDraft){state.emailDraft.workbenchStale=true;state.emailDraft.attachmentReady=false;state.emailDraft.acknowledgedWarnings=false;}
    original.recalc();saveBatchData();return selected();
  }
  function undo(id) {
    const d=data(), h=d.history.find(x=>x.id===id);
    if(!h||h.revoked) return;
    const latest=d.history.filter(x=>!x.revoked&&x.key===h.key&&x.scope===h.scope&&x.field===h.field).at(-1);
    if(latest!==h) throw new Error('请先撤销这个项目较新的修改');
    if(h.previous===null) delete d[h.scope][h.key][h.field];else d[h.scope][h.key][h.field]=h.previous;
    h.revoked=true;h.revokedAt=new Date().toISOString();d.revision++;delete d.reviewed[h.scope+':'+h.key];
    if(h.scope==='gross'){d.taxReview||={};d.taxReview[h.key]=true;}
    if(h.scope==='netGenerated'&&h.field==='tax'){d.taxReview||={};d.taxReview[h.key]=true;}
    if(state.emailDraft){state.emailDraft.workbenchStale=true;state.emailDraft.attachmentReady=false;}
    original.recalc();saveBatchData();
  }
  function resetField(e,field) {
    const d=data(), k=key(e), s=scope(), o=d[s][k]||{};
    if(!Object.hasOwn(o,field)) return;
    const previous=o[field];delete o[field];preview=null;original.recalc();
    d.history.push({id:Date.now()+'-'+d.history.length,key:k,name:e.name,scope:s,field,before:previous,value:value(selected(),field),previous,reason:'恢复自动计算 / 来源值',at:new Date().toISOString(),reset:true});
    d.revision++;delete d.reviewed[s+':'+k];
    if(s==='gross'&&!['social','fund'].includes(field)){d.taxReview||={};d.taxReview[k]=true;delete d.reviewed['netGenerated:'+k];}
    if(s==='netGenerated'&&field==='tax'){d.taxReview||={};d.taxReview[k]=true;}
    if(state.emailDraft){state.emailDraft.workbenchStale=true;state.emailDraft.attachmentReady=false;state.emailDraft.acknowledgedWarnings=false;}
    saveBatchData();
  }
  function markReviewed(e) {const d=data(),k=key(e);if(scope()==='netGenerated'&&d.taxReview)delete d.taxReview[k];d.reviewed[scope()+':'+k]=JSON.stringify([e.gross,e.net,overrides(e)]);saveBatchData();}
  function isReviewed(e) {return data().reviewed[scope()+':'+key(e)]===JSON.stringify([e.gross,e.net,overrides(e)]);}
  function source(e,field) {
    let sourceKey=fields[field]?.[1];
    if(state.payrollStage==='net'&&sourceKey==='social')sourceKey='netSocial';
    if(state.payrollStage==='net'&&sourceKey==='fund')sourceKey='netFund';
    const rows=sourceRows[sourceKey]||[], i=rows.findIndex(r=>String(rowValue(r,['姓名'])||'').trim()===e.name.trim());
    return {label:sourceSheets.find(s=>s.key===sourceKey)?.name||'人工调整',filename:state.sourceStatus[sourceKey]?.filename||'',row:i>=0?i+(rows.sourceStartRow||2):null,sheet:rows.sheetName||'',record:i>=0?rows[i]:null};
  }
  commitSource=(k,item)=>{
    if(!state.liveImport) {currentBatch().workbench=null;rawProfiles.clear();}
    else if(data().history.length) data().sourceChanged=true;
    preview=null;return original.commit(k,item);
  };
  // Existing exports retain their sheet layout and receive an explicit adjustment term in formulas.
  detailSheet=(grossOnly=false)=>{
    const ws=original.detail(grossOnly), list=grossOnly?generatedEmployees:employees, desc=exportDescriptors(grossOnly);
    list.forEach((e,i)=>{
      const r=i+3, netCol=desc.findIndex(d=>d[1]==='net');
      if(!grossOnly&&e.netAdjustment&&netCol>=0){const c=ws[excelColumn(netCol)+r];if(c?.f)c.f=`ROUND((${c.f})+(${e.netAdjustment}),2)`;}
      const notes=[...(grossOnly||!sourceRows.grossUpload?adjustmentNotes(e,'gross'):[]),...(!grossOnly?adjustmentNotes(e,'net'):[])];
      if(notes.length){ws['A'+r]||={t:'s',v:e.name};ws['A'+r].c||=[];ws['A'+r].c.push({a:'工资调整',t:notes.join('\n')});}
    });return ws;
  };
  summarySheet=()=>{
    const ws=original.summary(), desc=exportDescriptors(false);
    // Original exporter indexed the unfiltered schema. Resolve columns from the actual output instead.
    for(const cell of Object.values(ws)) if(cell?.f?.includes('SUMIF')) {
      const m=cell.f.match(/,'工资明细表'!([A-Z]+)\$/);
      if(m){const all=[...PayrollEngine.fields,...PayrollEngine.netFields];let idx=0;for(const c of m[1])idx=idx*26+c.charCodeAt(0)-64;
        const field=all[idx-1]?.[1], newIdx=desc.findIndex(d=>d[1]===field);
        if(newIdx>=0)cell.f=cell.f.replace(new RegExp(`${m[1]}\\$`,'g'),`${excelColumn(newIdx)}$`);
      }
    }return ws;
  };
  downloadSlip=()=>{
    if(!workbookReady())return;const e=selected(),gross=state.payrollStage==='gross';if(!e)return;
    const items=gross?exportDescriptors(true):exportDescriptors(false);
    const rows=[['员工工资明细',monthLabel(currentMonth)],['阶段',gross?'应发工资':'实发工资'],...items.map(([label,field])=>[label,field==='isIntern'?(e.isIntern?'是':'否'):e[field]??''])];
    const ws=formatNumbers(window.XLSX.utils.aoa_to_sheet(rows));
    const ref=f=>'B'+(items.findIndex(d=>d[1]===f)+3);
    if(!gross){numericCell(ws,ref('afterTaxTotal'),e.afterTaxTotal,`ROUND(${ref('utility')}+${ref('mealDeduct')}+${ref('otherDeduct')},2)`);
      numericCell(ws,ref('net'),e.net,e.isIntern?`ROUND(${ref('gross')}+(${e.netAdjustment||0}),2)`:`ROUND(${ref('gross')}-${ref('social')}-${ref('fund')}-${ref('tax')}-${ref('afterTaxTotal')}+(${e.netAdjustment||0}),2)`);
      numericCell(ws,ref('companyCost'),e.companyCost,`ROUND(${ref('gross')}+${ref('companySocial')}+${ref('companyFund')},2)`);}
    const notes=adjustmentNotes(e);if(notes.length)ws.B1.c=[{a:'工资调整',t:notes.join('\n')}];
    ws['!cols']=[{wch:28},{wch:28}];const book=window.XLSX.utils.book_new();window.XLSX.utils.book_append_sheet(book,ws,gross?'应发明细':'实发明细');
    downloadXlsx(book,`${gross?'应发':'实发'}明细_${e.name}_${currentMonth}.xlsx`);
  };
  function orphaned(stage=state.payrollStage){
    const d=data(),scopes=stage==='gross'?['gross']:sourceRows.grossUpload?['netUploaded']:['gross','netGenerated'];
    return scopes.flatMap(s=>{const list=s==='netUploaded'?PayrollEngine.uploadedEmployees(sourceRows.grossUpload||[]):generatedEmployees,keys=new Set(list.map(key));
      return Object.entries(d[s]).filter(([k,o])=>Object.keys(o).length&&!keys.has(k)).map(([k,values])=>({scope:s,key:k,name:JSON.parse(k)[0],values}));});
  }
  function rebind(oldKey,s,newKey){
    const d=data();if(Object.keys(d[s][newKey]||{}).length)throw new Error('该员工已有调整，请先核对并撤销冲突项目');
    d[s][newKey]=d[s][oldKey];delete d[s][oldKey];
    d.history.filter(h=>h.key===oldKey&&h.scope===s).forEach(h=>{h.originalKey||=h.key;h.key=newKey;h.relinkedAt=new Date().toISOString();});
    if(s==='gross'){d.taxReview||={};d.taxReview[newKey]=true;}d.revision++;
    original.recalc();saveBatchData();
  }
  const oldExportReady=payrollExportReady;
  payrollExportReady=()=>{if(orphaned().length){showToast('有未关联的员工调整，请先在总表中关联后导出',5000);return false;}return oldExportReady();};
  const oldDownloadGross=downloadGross;
  downloadGross=()=>{if(orphaned('gross').length){showToast('应发调整存在未关联员工，请先关联后导出',5000);return;}return oldDownloadGross();};
  const oldEnsureEmail=ensureEmailDraft;
  ensureEmailDraft=(refresh=false)=>{
    const old=state.emailDraft, draft=oldEnsureEmail(refresh), fingerprint=JSON.stringify(emailRows());
    if(old&&draft!==old){for(const field of ['recipient','recipientName','subject','mailboxUrl'])if(old[field])draft[field]=old[field];}
    if(draft===old&&draft.workbenchFingerprint&&draft.workbenchFingerprint!==fingerprint){
      draft.workbenchStale=true;draft.attachmentReady=false;draft.acknowledgedWarnings=false;
    }
    draft.workbenchFingerprint=fingerprint;draft.validation=PayrollEmailEngine.validate(draft);
    return draft;
  };
  const oldOpenEmail=openEmailComposer;
  openEmailComposer=()=>{if(state.emailDraft?.workbenchStale){showToast('工资已有修改，请先从最新结果重新生成正文并核对附件',5000);return;}return oldOpenEmail();};
  // Both the original bulk settings and the detail editor write the same adjustment.
  function syncInternRates(names, input) {
    if(!validNonNegativeNumber(input)){showToast('请输入有效的非负日薪');return false;}
    const stage=state.payrollStage;
    state.payrollStage='gross';original.recalc();
    try {
      const list=[...new Set(names.map(canonicalKey))].map(name=>generatedEmployees.find(e=>e.isIntern&&canonicalKey(e.name)===name));
      if(list.some(e=>!e||ambiguous(e,'gross'))){showToast('存在同名或未匹配的实习生，请先核对花名册');return false;}
      for(const e of list) if(value(e,'dailyRate')==null||Number(value(e,'dailyRate'))!==Number(input)) saveChange(e,'dailyRate',input,list.length>1?'批量设置实习生日薪':'实习生日薪设置');
      return true;
    } finally {state.payrollStage=stage;original.recalc();saveBatchData();}
  }
  setInternDailyRate=(name,input)=>syncInternRates([name],input);
  applyBulkInternRate=(names,input)=>syncInternRates(names,input);
  setCurrentBatch=batch=>{
    original.batch(batch);
    if(!state.liveImport)profiles.splice(0,profiles.length,...structuredClone(batch.workbench?.demoProfiles||defaultProfiles));
    original.recalc();saveBatchData();
  };
  function openDB(){return new Promise((resolve,reject)=>{if(!globalThis.indexedDB){reject(new Error('本地存储不可用'));return;}const req=indexedDB.open('payroll-workbench-local',1);req.onupgradeneeded=()=>req.result.createObjectStore('workspace');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  async function persist(){const snapshot=structuredClone(state.batches);try{const db=await openDB();await new Promise((resolve,reject)=>{const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put(snapshot,'batches');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();storageError='';}catch(e){storageError=e.message||'无法保存到本机';}}
  saveBatchData=()=>{original.save();if(!state.liveImport)data().demoProfiles=structuredClone(profiles);if(!hydrating)queue=queue.then(persist);};
  async function restore(){
    hydrating=true;
    try{const db=await openDB();const saved=await new Promise((resolve,reject)=>{const req=db.transaction('workspace').objectStore('workspace').get('batches');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();
      if(!Array.isArray(saved)||!saved.length)return false;
      state.batches=saved;const b=currentBatch();currentMonth=b.month;currentWorkdays=b.workdays||22;
      sourceRows=structuredClone(b.data?.sourceRows||{});state.sourceStatus=structuredClone(b.data?.sourceStatus||{});
      state.liveImport=!!b.data?.liveImport;if(!state.liveImport)profiles.splice(0,profiles.length,...structuredClone(b.workbench?.demoProfiles||defaultProfiles));state.payrollStage=b.data?.payrollStage||'gross';makeupWorkdays=b.data?.makeupWorkdays||[];state.emailDraft=b.data?.emailDraft||null;
      original.recalc();return true;
    }catch(e){storageError=e.message;return false;}finally{hydrating=false;}
  }
  return {fields,key,scope,data,selected,overrides,history,value,source,ambiguous,previewChange,clearPreview,saveChange,undo,resetField,markReviewed,isReviewed,restore,orphaned,rebind,
    flush:async()=>{await queue;return storageError;}, get storageError(){return storageError;}, rawProfiles};
})();
