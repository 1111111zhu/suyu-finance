/* Batch-local adjustment layer. Imported rows and original files remain read-only. */
globalThis.PayrollWorkbench = (() => {
  const round = PayrollEngine.round;
  const original = {calc:calcSalary, net:PayrollEngine.calculateNet, recalc:recalculateEmployees,
    save:saveBatchData, batch:setCurrentBatch, commit:commitSource, issues:visibleIssues, detail:detailSheet, summary:summarySheet};
  const rawProfiles = new Map();
  const defaultProfiles = structuredClone(profiles);
  const listeners = new Set();
  const notify = () => listeners.forEach(listener => listener());
  let preview = null, hydrating = false, storageError = '', queue = Promise.resolve();
  const fields = {
    base:['基本工资','salary'], post:['岗位工资','salary'], perfBase:['绩效基数','salary'], score:['绩效系数','performance'],
    performancePay:['绩效工资','performance'], meal:['餐饮津贴','attendance'], transit:['交通津贴','attendance'],
    otherAllow:['其他津贴','other'], otherAdd:['其他加项','other'], otherReduction:['其他减项','other'],
    actualPaidDays:['实际出勤天数','attendance'], sick:['病假天数','attendance'], personal:['事假天数','attendance'],
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
    const roster=profile.rosterRow?sourceRows.roster?.[profile.rosterRow-(sourceRows.roster?.sourceStartRow||2)]:null;
    const p={...profile,employeeNumber:String(rowValue(roster,['工号','员工编号','员工工号'])||profile.employeeNumber||profile.id)};
    for(const [field,value] of Object.entries(o)) if(!computedFields.has(field)&&!netFields.has(field)) p[field]=value;
    if(Object.hasOwn(o,'actualPaidDays')) p.paidDayIssues=(p.paidDayIssues||[]).filter(x=>!(/实际出勤天数|未上传考勤|考勤统计表中未找到/.test(x)));
    const e=original.calc(p,month,days);
    e._workbenchKey=k;
    e._input={...p,_sourceValues:{...p._sourceValues}};
    const exportedFields={score:'effectiveScore',actualPaidDays:'payableDays'};
    for(const [field,value] of Object.entries(o))if(!computedFields.has(field)&&!netFields.has(field))e._input._sourceValues[exportedFields[field]||field]=value;
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
    if(state.payrollStage==='gross'&&netFields.has(field)) throw new Error('该项目在第二阶段调整');
    if(e.isIntern&&state.payrollStage==='net'&&!['netTarget','companySocial','companyFund'].includes(field)) throw new Error('实习生不参与常规扣款');
    const v=PayrollEngine.numeric(input);
    if(v===null||!Number.isFinite(v)) throw new Error('请输入有效数字，空白不会按 0 保存');
    const days=/Days$|Workdays$/.test(field)||['sick','personal','absent','annual','flexible','compensatory'].includes(field);
    if((days||!['grossTarget','netTarget'].includes(field))&&v<0) throw new Error('该项目不能填写负数');
    if(days&&v>31) throw new Error('天数不能超过 31 天');
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
    d.history.push({id:Date.now()+'-'+d.history.length,key:k,name:e.name,scope:s,field,before,value:v,previous:prior??null,reason:String(reason??'').trim(),at:new Date().toISOString()});
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
    if(sourceKey==='afterTax') {
      const aliases={utility:['水电代扣','水电费代扣','水电费合计'],mealDeduct:['餐费代扣','餐费合计'],otherDeduct:['其它代扣','其他代扣']}[field]||[];
      const records=(sourceRows.afterTax||[]).filter(row=>canonicalKey(rowValue(row,['姓名']))===canonicalKey(e.name)&&Object.keys(row).some(h=>aliases.some(a=>canonicalKey(h)===canonicalKey(a))));
      return {label:fields[field]?.[0]||'税后代扣',filename:[...new Set(records.map(r=>r._importSource?.filename||r._deductionSource?.filename||state.sourceStatus.afterTax?.filename||''))].join('、'),row:records[0]?._importSource?.rowNumber||records[0]?._deductionSource?.rowNumber||null,sheet:[...new Set(records.map(r=>r._importSource?.sheetName||r._deductionSource?.sheetName||''))].join('、'),record:records.length?{合计金额:e[field],费用明细:records}:null};
    }
    const rows=sourceRows[sourceKey]||[];
    const descriptor=[...PayrollEngine.fields,...PayrollEngine.netFields].find(([,f])=>f===field||field==='score'&&f==='effectiveScore');
    const labels=descriptor?[descriptor[0],...(descriptor[3]||[])]:[fields[field]?.[0]||''];
    const aliases=[...labels,...(sourceFieldGroups[sourceKey]||[]).filter(group=>group.some(alias=>labels.some(label=>PayrollEngine.canonicalHeader(alias)===PayrollEngine.canonicalHeader(label)))).flat()];
    const records=sourceKey==='roster'&&e.rosterRow?[rows[e.rosterRow-(rows.sourceStartRow||2)]].filter(Boolean):rows.filter(row=>canonicalKey(rowValue(row,['姓名']))===canonicalKey(e.name)&&Object.keys(row).some(h=>aliases.some(a=>canonicalKey(h)===canonicalKey(a))));
    const record=records[0]||null,source=record?._importSource||record?._rosterSource;
    return {label:sourceSheets.find(s=>s.key===sourceKey)?.name||'人工调整',filename:[...new Set(records.map(r=>r._importSource?.filename||r._rosterSource?.filename||state.sourceStatus[sourceKey]?.filename||''))].join('、'),row:source?.rowNumber??(record?rows.indexOf(record)+(rows.sourceStartRow||2):null),sheet:[...new Set(records.map(r=>r._importSource?.sheetName||r._rosterSource?.sheetName||rows.sheetName||''))].join('、'),record:records.length>1&&sourceKey==='other'?{合计金额:e[field],来源明细:records}:record};
  }
  commitSource=(k,item)=>{
    if(!state.liveImport) {
      currentBatch().workbench=null;rawProfiles.clear();
      // A first real import replaces the entire demonstration, including its settings/mail.
      if(currentBatch().draftOrigin!=='empty'){
        state.emailDraft=null;currentBatch().data ||= {};currentBatch().data.internDailyRates={};
      }
    }
    else if(data().history.length) data().sourceChanged=true;
    currentBatch().draftOrigin='user-import';
    preview=null;return original.commit(k,item);
  };
  // Existing exports retain their sheet layout and receive an explicit adjustment term in formulas.
  detailSheet=(grossOnly=false)=>{
    const ws=original.detail(grossOnly), list=grossOnly?generatedEmployees:employees;
    list.forEach((e,i)=>{
      const r=i+3;
      const notes=[...(grossOnly||!sourceRows.grossUpload?adjustmentNotes(e,'gross'):[]),...(!grossOnly?adjustmentNotes(e,'net'):[])];
      if(notes.length){ws['A'+r]||={t:'s',v:e.name};ws['A'+r].c||=[];ws['A'+r].c.push({a:'工资调整',t:notes.join('\n')});}
    });return ws;
  };
  downloadSlip=()=>{
    if(!workbookReady())return;const e=selected(),gross=state.payrollStage==='gross';if(!e)return;
    const items=gross?exportDescriptors(true):exportDescriptors(false);
    const record=exportRecord(e,gross);
    const rows=[['员工工资明细',monthLabel(currentMonth)],['阶段',gross?'应发工资':'实发工资'],...items.map(([label])=>[label,record[label]??''])];
    const ws=formatNumbers(window.XLSX.utils.aoa_to_sheet(rows));
    const ref=f=>'B'+(items.findIndex(d=>d[1]===f)+3);
    items.forEach(([,field,type])=>{const cell=ws[ref(field)];if(cell?.t==='n'&&['money','number'].includes(type))cell.z=type==='money'?'0.00########':'0.########';});
    applyPayrollExportFormulas(ws,e,ref,gross);
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
    if(!state.liveImport)profiles.splice(0,profiles.length,...structuredClone(batch.workbench?.demoProfiles||(batch.draftOrigin==='empty'?[]:defaultProfiles)));
    original.recalc();saveBatchData();
  };
  function openDB(){return new Promise((resolve,reject)=>{if(!globalThis.indexedDB){reject(new Error('本地存储不可用'));return;}const req=indexedDB.open('payroll-workbench-local',1);req.onupgradeneeded=()=>req.result.createObjectStore('workspace');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  async function persist(){const snapshot=structuredClone(state.batches);try{const db=await openDB();await new Promise((resolve,reject)=>{const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put(snapshot,'batches');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();storageError='';}catch(e){storageError=e.message||'无法保存到本机';}}
  saveBatchData=()=>{original.save();
    const b=currentBatch(), real=state.liveImport && b.draftOrigin!=='demo' && !Object.values(state.sourceStatus).some(st=>st?.demo);
    if(real){
      const ready=b.status==='已计算' || b.status==='已归档';
      const netReady=ready && state.payrollStage==='net';
      const rows=netReady?employees:generatedEmployees;
      const people=rows.map(e=>{
        const valid=ready && !e.payrollBlocked && !e.regularizationBlocked && !e.payrollSourceBlocked && !String(e.exception||'').split('；').filter(x=>x && !x.includes('转正日期不在当前计薪月份')).length;
        const netValid=valid && netReady && !(e.deductionIssues||[]).length;
        const contributions=state.sourceStatus.netSocial?.uploaded && state.sourceStatus.netFund?.uploaded;
        return {name:e.name,employeeNumber:String(e.employeeNumber||''),dept:e.dept||'',company:e.company||'',status:e.isIntern?'实习生':e.status||'在职',gross:valid?e.gross:null,net:netValid?e.net:null,cost:netValid&&contributions?e.companyCost:null};
      });
      // View refreshes and cloud packing may save repeatedly without changing personnel data.
      // Preserve the timestamp so an unchanged snapshot remains identical for sync and retry.
      if(!b.personnelAnalysis || JSON.stringify(b.personnelAnalysis.people)!==JSON.stringify(people))
        b.personnelAnalysis={updatedAt:new Date().toISOString(),people};
    }
if(!state.liveImport&&currentBatch().draftOrigin!=='empty')data().demoProfiles=structuredClone(profiles);if(!hydrating)queue=queue.then(persist);notify();};
  async function restore(){
    hydrating=true;
    try{const db=await openDB();const saved=await new Promise((resolve,reject)=>{const req=db.transaction('workspace').objectStore('workspace').get('batches');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();
      if(!Array.isArray(saved)||!saved.length)return false;
      state.batches=saved;const b=currentBatch();currentMonth=b.month;currentWorkdays=b.workdays||22;
      sourceRows=structuredClone(b.data?.sourceRows||{});state.sourceStatus=structuredClone(b.data?.sourceStatus||{});
      state.liveImport=!!b.data?.liveImport;if(!state.liveImport)profiles.splice(0,profiles.length,...structuredClone(b.workbench?.demoProfiles||(b.draftOrigin==='empty'?[]:defaultProfiles)));state.payrollStage=b.data?.payrollStage||'gross';makeupWorkdays=b.data?.makeupWorkdays||[];state.emailDraft=b.data?.emailDraft||null;
      original.recalc();return true;
    }catch(e){storageError=e.message;return false;}finally{hydrating=false;}
  }
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function jsonCopy(value) {
    return JSON.parse(JSON.stringify(value), (key, item) => {
      if(['__proto__','prototype','constructor'].includes(key))throw new Error('草稿包含不支持的字段');
      return item;
    });
  }
  function validateSnapshot(input) {
    const s=jsonCopy(input), b=s?.batch, d=b?.data;
    if(s?.formatVersion!==1||!record(b)||!record(d)||!record(s.sources)||!record(s.results)
      ||!['user-import','empty'].includes(s.provenance)||typeof b.name!=='string'
      ||!/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month)||!Number.isFinite(b.workdays)||b.workdays<=0||b.workdays>31
      ||!['gross','net'].includes(d.payrollStage)||!record(d.sourceStatus)
      ||!Array.isArray(s.results.gross)||!Array.isArray(s.results.net))throw new Error('服务器草稿格式不完整或版本不受支持');
    if(b.draftOrigin==='demo'||Object.values(d.sourceStatus).some(st=>st?.demo===true)
      ||(b.workbench&&Object.hasOwn(b.workbench,'demoProfiles')))throw new Error('演示数据不能保存到服务器，请新建空白批次或导入真实资料');
    if(Object.hasOwn(d,'sourceRows')||Object.hasOwn(b,'cloud'))throw new Error('草稿包含未打包的本机数据');
    if(s.provenance==='user-import'&&d.liveImport!==true)throw new Error('资料尚未确认为真实导入，不能保存到服务器');
    if(s.provenance==='empty'&&(d.liveImport===true||(b.draftOrigin!==undefined&&b.draftOrigin!=='empty')||Object.keys(s.sources).length
      ||s.results.gross.length||s.results.net.length||Object.values(d.sourceStatus).some(st=>st?.uploaded)
      ||b.workbench?.history?.length||['gross','netGenerated','netUploaded'].some(k=>Object.keys(b.workbench?.[k]||{}).length)))throw new Error('只有新建的空白批次可以作为空白服务器草稿');
    if(d.payrollStage!=='net'&&s.results.net.length)throw new Error('应发阶段不能包含当前实发结果');
    const keys=new Set(sourceSheets.map(sheet=>sheet.key));
    for(const [key,source] of Object.entries(s.sources)){
      if(!keys.has(key)||!record(source)||!Array.isArray(source.rows)||!source.rows.every(record)
        ||typeof source.sheetName!=='string'||!Number.isSafeInteger(source.sourceStartRow)||source.sourceStartRow<1)throw new Error('来源资料格式不正确');
    }
    if(![...s.results.gross,...s.results.net].every(record))throw new Error('工资结果格式不正确');
    if(b.workbench){
      if(!record(b.workbench)||!Array.isArray(b.workbench.history)||!['gross','netGenerated','netUploaded','reviewed'].every(k=>record(b.workbench[k])))throw new Error('人工调整记录格式不正确');
    }
    return s;
  }
  // JSON drops custom Array properties. Sources therefore travel in explicit envelopes.
  function packCurrent() {
    if(preview)throw new Error('请先保存或取消当前项目的修改');
    if(importSession().busy||state.calculating)throw new Error('资料正在处理，请完成后再保存服务器草稿');
    original.save();
    const b=currentBatch();
    if(Object.values(state.sourceStatus).some(st=>st?.demo===true)||Object.hasOwn(b.workbench||{},'demoProfiles')||b.draftOrigin==='demo')throw new Error('演示数据不能保存到服务器，请新建空白批次或导入真实资料');
    if(!state.liveImport&&(b.draftOrigin!=='empty'||Object.keys(sourceRows).length))throw new Error('资料尚未确认为真实导入，不能保存到服务器');
    const batch=jsonCopy(b);delete batch.cloud;delete batch.data.sourceRows;
    const sources=Object.fromEntries(Object.entries(sourceRows).map(([key,rows])=>{
      if(!Array.isArray(rows))throw new Error('来源资料不是有效数组');
      return [key,{rows:jsonCopy(rows),sheetName:rows.sheetName??'',sourceStartRow:rows.sourceStartRow??2}];
    }));
    return validateSnapshot({formatVersion:1,provenance:state.liveImport?'user-import':'empty',batch,sources,
      results:{gross:jsonCopy(generatedEmployees),net:state.payrollStage==='net'?jsonCopy(employees):[]}});
  }
  function restoreCloud(snapshot, cloud, {mode='copy'}={}) {
    if(!['copy','current'].includes(mode))throw new Error('请选择恢复到当前批次或新建本机副本');
    if(preview||importSession().busy||state.calculating)throw new Error('请先完成当前修改或资料处理');
    const s=validateSnapshot(snapshot), b=s.batch;
    if(typeof cloud?.id!=='string'||!cloud.id||!Number.isSafeInteger(cloud.revision)||cloud.revision<1)throw new Error('服务器草稿版本无效');
    b.draftOrigin=s.provenance;
    b.cloud={id:cloud.id,revision:cloud.revision,currentRevision:cloud.currentRevision??cloud.revision,updatedAt:cloud.updatedAt,ownerUserId:cloud.ownerUserId};
    b.data.sourceRows=Object.fromEntries(Object.entries(s.sources).map(([key,source])=>{
      const rows=source.rows;rows.sheetName=source.sheetName;rows.sourceStartRow=source.sourceStartRow;return [key,rows];
    }));
    const previous=currentBatch();saveBatchData();
    if(mode==='current')state.batches.splice(state.batches.indexOf(previous),1,b);else state.batches.unshift(b);
    state.batches.forEach(item=>{item.active=item===b;});
    preview=null;rawProfiles.clear();profiles.splice(0,profiles.length);
    currentMonth=b.month;currentWorkdays=b.workdays;sourceRows=structuredClone(b.data.sourceRows);
    state.liveImport=b.data.liveImport===true;state.sourceStatus=structuredClone(b.data.sourceStatus);
    state.payrollStage=b.data.payrollStage;makeupWorkdays=structuredClone(b.data.makeupWorkdays||[]);
    state.emailDraft=structuredClone(b.data.emailDraft||null);state.comparison=structuredClone(b.data.comparison||[]);
    state.grossSource=b.data.grossSource||'none';state.calculated=b.status==='已计算';
    generatedEmployees=s.results.gross;employees=state.payrollStage==='net'?s.results.net:generatedEmployees;
    state.selectedId=employees[0]?.id||'';b.employees=employees.length;data();
    saveBatchData();return b;
  }
  async function deleteBatch(batch){
    if(!state.batches.includes(batch))throw new Error('批次已不存在');
    saveBatchData();await queue;
    const db=await openDB();
    await new Promise((resolve,reject)=>{const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put(structuredClone(batch),'deletedBatch');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
    if(batch===currentBatch()) {
      const next=state.batches.find(b=>b!==batch)||{name:monthLabel(currentMonth)+'工资批次',month:currentMonth,workdays:currentWorkdays,status:'待上传',employees:0,sources:0,date:new Date().toISOString().slice(0,10),draftOrigin:'empty',data:{internDailyRates:{}}};
      if(!state.batches.includes(next))state.batches.push(next);
      setCurrentBatch(next);
    }
    state.batches.splice(state.batches.indexOf(batch),1);saveBatchData();await queue;
    if(storageError)throw new Error(storageError);
  }
  async function restoreDeletedBatch(){
    const db=await openDB();const batch=await new Promise((resolve,reject)=>{const req=db.transaction('workspace').objectStore('workspace').get('deletedBatch');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    if(!batch){db.close();showToast('没有可恢复的删除记录');return false;}
    batch.active=false;state.batches.push(batch);saveBatchData();await queue;
    if(storageError){db.close();throw new Error(storageError);}
    await new Promise((resolve,reject)=>{const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').delete('deletedBatch');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();return true;
  }
  function persistCloudMetadata(batch) {
    if(!state.batches.includes(batch))throw new Error('本机批次已不存在');
    if(batch===currentBatch())saveBatchData();else {queue=queue.then(persist);notify();}
  }
  return {fields,key,scope,data,selected,overrides,history,value,source,ambiguous,previewChange,clearPreview,saveChange,undo,resetField,markReviewed,isReviewed,restore,orphaned,rebind,
    deleteBatch,restoreDeletedBatch,packCurrent,validateSnapshot,restoreCloud,persistCloudMetadata,currentBatch,
    subscribe:listener=>{listeners.add(listener);return ()=>listeners.delete(listener);},notifyState:notify,
    flush:async()=>{await queue;return storageError;}, get storageError(){return storageError;}, rawProfiles};
})();
