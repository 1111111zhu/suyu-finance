/* All payroll pages share the same controls and keep the existing data handlers. */
globalThis.PayrollWorkbenchPages = (() => {
  const esc=escapeHtml, fmt=money;
  const btn=(text,command,extra='',primary=false)=>`<button type="button" class="btn${primary?' btn-primary':''}" data-wb="${command}" ${extra}>${text}</button>`;
  const route=(text,view,primary=false)=>btn(text,'route',`data-route="${view}"`,primary);
  const title=()=>state.payrollStage==='gross'?'应发':'实发';
  const head=(name,note='',actions='')=>`<div class="wb-page-head"><div><h1>${name}</h1>${note?`<p>${note}</p>`:''}</div><div class="wb-actions">${actions}</div></div>`;
  const label=(name,note='',right='')=>`<div class="wb-section-head"><div><h2>${name}</h2>${note?`<p>${note}</p>`:''}</div>${right}</div>`;
  function sourceRow(sheet,compact=false){
    const st=sheet.key==='netBenefits'?benefitStatus():state.sourceStatus[sheet.key]||{},busy=importSession().busy;
    const wecomNote=sheet.key==='roster'&&!compact?'<small class="wb-source-integration-note">企微通讯录可供核对人员与部门；计薪仍以花名册为准</small>':'';
    const directoryButton=sheet.key==='roster'&&!compact?'<button type="button" class="btn" data-wecom-directory>查看企微通讯录</button>':'';
    return `<div class="wb-source-row"><div class="wb-source-symbol">${sheet.icon}</div><div class="wb-source-info"><strong>${sheet.name}</strong>${compact?'':`<span>${sheet.desc}${sheet.key==='netBenefits'?'；子表名称包含上述文字即可识别':'；表头、文件名或工作表名任一处出现对应字段即可识别'}</span>${st.uploaded?`<small title="${esc(st.filename)}">${esc(st.filename)}${st.files?' · '+st.files+' 个文件':''}${st.rows?' · '+st.rows+' 行':''}${st.demo?' · 示例':''}</small>`:''}${wecomNote}`}</div><span class="wb-source-state ${st.uploaded?'ready':''}">${st.uploaded?(sheet.key==='netBenefits'&&!st.complete?'缺少：'+st.missing.join('、'):'✓ 已就绪'):sheet.key==='roster'?'先上传此表':sheet.key==='afterTax'?'可选':sheet.key==='netBenefits'?'缺少：'+st.missing.join('、'):'未上传'}</span><input type="file" accept="${PayrollEngine.spreadsheetAccept}" id="file-${sheet.key}" data-source-input="${sheet.key}" multiple hidden><button class="btn" data-upload="${sheet.key}" ${busy?'disabled':''}>${st.uploaded?'追加上传':'上传多个表格'}</button>${st.uploaded?`<button type="button" class="btn btn-sm wb-source-replace" data-upload="${sheet.key}" data-upload-mode="replace" title="替换本模块的全部已上传文件" ${busy?'disabled':''}>替换</button><button type="button" class="btn btn-sm" data-source-preview="${sheet.key}" ${st.demo?'disabled':''}>预览</button><button type="button" class="btn btn-sm wb-source-delete" data-source-delete="${sheet.key}" title="删除本模块的全部已上传文件" ${busy||st.demo?'disabled':''}>删除</button>`:''}${directoryButton}</div>`;
  }
  function parameterBar(){
    const defaultYear=Number(currentMonth.slice(0,4)),defaultMonth=currentMonth.slice(5,7);
    const start=Math.min(2000,defaultYear,Number(currentMonth.slice(0,4))),end=Math.max(today.getFullYear()+10,defaultYear,Number(currentMonth.slice(0,4)));
    const yearOptions=Array.from({length:end-start+1},(_,i)=>start+i).map(y=>`<option value="${y}" ${y===defaultYear?'selected':''}>${y}年</option>`).join('');
    const monthOptions=Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0')).map(m=>`<option value="${m}" ${m===defaultMonth?'selected':''}>${Number(m)}月</option>`).join('');
    return `<details class="wb-parambar"><summary><span>计薪参数</span><strong>${defaultYear}年${Number(defaultMonth)}月 · ${integer(currentWorkdays)} 天</strong><em>调整</em></summary><form id="payrollSettings" class="wb-parambar-panel" aria-label="调整计薪参数"><label><span>年份</span><select class="select" id="payrollYear" aria-label="计薪年份" required>${yearOptions}</select></label><label><span>月份</span><select class="select" id="payrollMonth" aria-label="计薪月份" required>${monthOptions}</select></label><label class="wb-days-field"><span>天数</span><input class="input" id="payrollDays" aria-label="计薪天数" type="number" min="0.01" max="31" step="any" value="${currentWorkdays}" placeholder="" required><em>天</em></label><button class="btn btn-primary" type="submit">应用</button></form></details>`;
  }
  // Imports, deletes and batch restoration replace source arrays. Retain only the
  // current roster/month result so unrelated upload progress renders do no scans.
  let rosterIdentityCache=null;
  function rosterIdentityRejections(){
    const rows=sourceRows.roster;
    if(!rows)return [];
    if(rosterIdentityCache?.rows===rows&&rosterIdentityCache.length===rows.length&&rosterIdentityCache.month===currentMonth)return rosterIdentityCache.rejected;
    const rejected=[];
    rows.forEach((row,i)=>{
      if(!PayrollEngine.rosterRowInMonth(row,currentMonth))return;
      const issues=PayrollEngine.rosterIdentityIssues(row);
      if(issues.length)rejected.push({row,i,issues});
    });
    rosterIdentityCache={rows,length:rows.length,month:currentMonth,rejected};
    return rejected;
  }
  function upload(){
    const net=state.payrollStage==='net',busy=importSession().busy,sheets=displayStageSheets(),main=sheets.filter(s=>!net||s.key!=='grossUpload').sort((a,b)=>(a.key==='attendance'?-1:b.key==='attendance'?1:0)),done=main.filter(s=>s.key==='netBenefits'?benefitStatus().uploaded:state.sourceStatus[s.key]?.uploaded).length;
    const rejected=net?[]:rosterIdentityRejections();
    const identityNotice=!net&&rejected.length?`<section class="wb-panel"><h3>花名册 ${rejected.length} 行未进入算薪名单</h3><p>必须同时有姓名和工号，请修正原表后重新上传。</p>${rejected.map(x=>`<p>${esc(x.row._rosterSource?.sheetName||'花名册')}第 ${x.row._rosterSource?.rowNumber||x.i+2} 行：${esc(x.issues.join('、'))}</p>`).join('')}</section>`:'';
    const need=net?'扣款资料':'工资资料',total=employees.reduce((s,e)=>s+num(e.gross),0);
    return `${identityNotice}<section class="wb-panel wb-upload-top"><input type="file" id="bulk-source-input" accept="${PayrollEngine.spreadsheetAccept}" multiple hidden><div class="wb-drop-area" data-bulk-upload role="button" tabindex="0" aria-label="批量选择 Excel 源表" aria-disabled="${busy}"><span class="wb-drop-icon">${icon.upload}</span><div><strong>${busy?'正在读取文件…':'拖入 Excel，自动识别资料'}</strong><p>也可以点击选择多个 Excel / CSV 文件 · 单个不超过 20 MB</p></div><span class="wb-drop-choose">选择文件 ↗</span></div></section><div class="wb-upload-layout"><div class="wb-upload-main">${net?`<section class="wb-panel wb-gross-source">${label('应发工资来源',sourceRows.grossUpload?esc(state.sourceStatus.grossUpload?.filename||'上传应发表'):'',`<span class="wb-pill">${sourceRows.grossUpload?'上传文件':'自动衔接'}</span>`)}<div class="wb-source-total"><strong>¥ ${fmt(total)}</strong><span>${employees.length} 位员工</span>${btn('查看应发明细','workflow','data-stage="gross" data-route="results"')}</div><details class="wb-alternative" ${sourceRows.grossUpload?'open':''}><summary>使用已有应发工资表 <span>⌄</span></summary>${sourceRow(sheets.find(s=>s.key==='grossUpload'),true)}${sourceRows.grossUpload?'<button class="wb-link" data-remove-gross>恢复使用第一阶段结果</button>':'<p>未上传使用第一阶段生成结果，上传后以该文件为准。</p>'}</details></section>`:''}
      <section class="wb-panel">${renderImportReview()}
      ${label(need,net?'社保、公积金、个税及税后代扣在此阶段扣除。':'按姓名关联各张资料表，各类资料可上传多个表格，合并读取；同名文件重新上传时更新该文件；“替换”会用新文件替换该模块全部已有资料。',`<span class="wb-small">${done} / ${main.length} 张就绪</span>`)}<div class="wb-source-list">${main.map(sheet=>sourceRow(sheet)).join('')}</div></section>
      ${net&&sourceRows.grossUpload?`<div class="wb-compare">${renderComparison()}</div>`:''}
      </div><aside class="wb-upload-side"><section class="wb-panel wb-run-panel"><span class="wb-eyebrow">${net?'第二阶段':'第一阶段'}</span><h2>${title()}核算</h2><p class="wb-small">${monthLabel(currentMonth)} · ${esc(currentBatch().company||'当前批次')}</p><div class="wb-checklist"><div><span>员工范围</span><strong>${employees.length?employees.length+' 人':'等待资料'}</strong></div><div><span>${need}</span><strong>${done} / ${main.length}</strong></div><div class="wb-edit-days"><label for="payrollDays">计薪天数</label><form id="payrollSettings" class="wb-days-control" aria-label="调整计薪天数"><input type="hidden" id="payrollYear" value="${currentMonth.slice(0,4)}"><input type="hidden" id="payrollMonth" value="${currentMonth.slice(5,7)}"><input type="hidden" id="makeupWorkdays" value="${esc(makeupWorkdays.join(','))}"><input type="number" class="input" id="payrollDays" aria-label="计薪天数" min="0.01" max="31" step="any" required value="${currentWorkdays}"><span>天</span></form></div></div>${!stageReady()?`<div class="wb-hint">${net?'请先计算应发，或上传已有应发工资表。':'先上传花名册，确定本批次员工范围。'}</div>`:''}${btn(`计算并核对${title()} →`,'calculate',!stageReady()||busy?'disabled':'',true)}</section></aside></div>`;
  }
  function mapping(){
    const gross=state.payrollStage==='gross',names=stageSheets().map(s=>s.name),interns=generatedEmployees.filter(e=>e.isIntern);
    const rows=gross?mappingRows.filter(r=>names.includes(r[1])&&r[0]!=='其他代扣'):[['应发工资','应发表 / 第一阶段结果','应发工资'],['个人社保','社保公积金 · 社保个人明细','个人缴纳＋个人补缴'],['个人公积金','社保公积金 · 公积金个人明细','个人缴纳＋个人补缴'],['个税','个税表','应补（退）税额'],['水电、餐费、其他代扣','税后代扣表','水电代扣 / 餐费代扣 / 其它代扣']];
