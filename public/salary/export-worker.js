/* Export the immutable, already calculated snapshot. Never recalculate payroll here. */
globalThis.window=globalThis;
importScripts('./xlsx.full.min.js','./payroll-engine.js?v=20261010-other-add-header-v1','./payroll-email-engine.js','./calculation-model.js?v=20261010-other-add-header-v1','./workbench-core.js');
self.onmessage=({data:request})=>{
  try {
    const s=request.snapshot;
    calculationRowCache=new WeakMap();calculationHeaderCache=new Map();rosterExportIndex=null;
    currentMonth=s.month;currentWorkdays=s.workdays;makeupWorkdays=s.makeupWorkdays;
    Object.assign(state,s.state);sourceRows=s.sourceRows;importSession().items=s.importErrors||[];
    employees=s.employees;generatedEmployees=s.generatedEmployees;
    profiles.splice(0,profiles.length,...s.profiles);
    PayrollWorkbench.rawProfiles.clear();
    for(const [key,value] of s.rawProfiles)PayrollWorkbench.rawProfiles.set(key,value);
    const book=XLSX.utils.book_new(),gross=request.kind==='gross';
    let filename;
    if(request.kind==='slip') {
      const e=PayrollWorkbench.selected();if(!e)throw new Error('没有可导出的员工');
      const isGross=state.payrollStage==='gross',items=exportDescriptors(isGross),record=exportRecord(e,isGross);
      const rows=[['员工工资明细',monthLabel(currentMonth)],['阶段',isGross?'应发工资':'实发工资'],...items.map(([label])=>[label,record[label]??''])];
      const ws=formatNumbers(XLSX.utils.aoa_to_sheet(rows)),ref=f=>'B'+(items.findIndex(d=>d[1]===f)+3);
      items.forEach(([,field,type])=>{const cell=ws[ref(field)];if(cell?.t==='n'&&['money','number'].includes(type))cell.z=type==='money'?'0.00########':'0.########';});
      applyPayrollExportFormulas(ws,e,ref,isGross);
      const notes=PayrollWorkbench.history(e).filter(h=>!h.revoked).map(h=>`${PayrollWorkbench.fields[h.field]?.[0]||h.field}：${h.before} → ${h.value}${h.reason?`（${h.reason}）`:''}`);
      if(notes.length)ws.B1.c=[{a:'工资调整',t:notes.join('\n')}];
      ws['!cols']=[{wch:28},{wch:28}];XLSX.utils.book_append_sheet(book,ws,isGross?'应发明细':'实发明细');
      filename=`${isGross?'应发':'实发'}明细_${e.name}_${currentMonth}.xlsx`;
    } else {
      XLSX.utils.book_append_sheet(book,detailSheet(gross),gross?'应发工资表':'工资明细表');
      if(!gross)XLSX.utils.book_append_sheet(book,summarySheet(),'汇总统计');
      filename=`${gross?'应发':'实发'}工资表_${currentMonth}.xlsx`;
    }
    const bytes=XLSX.write(book,{bookType:'xlsx',type:'array'});
    self.postMessage({id:request.id,version:request.version,filename,bytes},[bytes]);
  }catch(error){self.postMessage({id:request.id,error:error.message||'工资表导出失败'});}
};
