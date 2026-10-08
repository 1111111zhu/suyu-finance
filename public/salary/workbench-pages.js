/* All payroll pages share the same controls and keep the existing data handlers. */
globalThis.PayrollWorkbenchPages = (() => {
  const esc=escapeHtml, fmt=money;
  const btn=(text,command,extra='',primary=false)=>`<button type="button" class="btn${primary?' btn-primary':''}" data-wb="${command}" ${extra}>${text}</button>`;
  const route=(text,view,primary=false)=>btn(text,'route',`data-route="${view}"`,primary);
  const title=()=>state.payrollStage==='gross'?'应发':'实发';
  const head=(name,note='',actions='')=>`<div class="wb-page-head"><div><h1>${name}</h1>${note?`<p>${note}</p>`:''}</div><div class="wb-actions">${actions}</div></div>`;
  const label=(name,note='',right='')=>`<div class="wb-section-head"><div><h2>${name}</h2>${note?`<p>${note}</p>`:''}</div>${right}</div>`;
  function sourceRow(sheet,compact=false){
    const st=state.sourceStatus[sheet.key]||{},busy=importSession().busy;
    const wecomNote=sheet.key==='roster'&&!compact?'<small class="wb-source-integration-note">企微通讯录可供核对人员与部门；计薪仍以花名册为准</small>':'';
    const directoryButton=sheet.key==='roster'&&!compact?'<button type="button" class="btn" data-wecom-directory>查看企微通讯录</button>':'';
    return `<div class="wb-source-row"><div class="wb-source-symbol">${sheet.icon}</div><div class="wb-source-info"><strong>${sheet.name}</strong>${compact?'':`<span>${sheet.desc}</span>${st.uploaded?`<small title="${esc(st.filename)}">${esc(st.filename)}${st.rows?' · '+st.rows+' 行':''}${st.demo?' · 示例':''}</small>`:''}${wecomNote}`}</div><span class="wb-source-state ${st.uploaded?'ready':''}">${st.uploaded?'✓ 已就绪':sheet.key==='roster'?'先上传此表':'未上传'}</span><input type="file" accept=".xlsx" id="file-${sheet.key}" data-source-input="${sheet.key}" hidden><button class="btn" data-upload="${sheet.key}" ${busy?'disabled':''}>${st.uploaded?'替换':'上传'}</button>${directoryButton}</div>`;
  }
  function parameterBar(){
    const defaultYear=Number(currentMonth.slice(0,4)),defaultMonth=currentMonth.slice(5,7);
    const start=Math.min(2000,defaultYear,Number(currentMonth.slice(0,4))),end=Math.max(today.getFullYear()+10,defaultYear,Number(currentMonth.slice(0,4)));
    const yearOptions=Array.from({length:end-start+1},(_,i)=>start+i).map(y=>`<option value="${y}" ${y===defaultYear?'selected':''}>${y}年</option>`).join('');
    const monthOptions=Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0')).map(m=>`<option value="${m}" ${m===defaultMonth?'selected':''}>${Number(m)}月</option>`).join('');
    return `<details class="wb-parambar"><summary><span>计薪参数</span><strong>${defaultYear}年${Number(defaultMonth)}月 · ${integer(currentWorkdays)} 天</strong><em>调整</em></summary><form id="payrollSettings" class="wb-parambar-panel" aria-label="调整计薪参数"><label><span>年份</span><select class="select" id="payrollYear" aria-label="计薪年份" required>${yearOptions}</select></label><label><span>月份</span><select class="select" id="payrollMonth" aria-label="计薪月份" required>${monthOptions}</select></label><label class="wb-days-field"><span>天数</span><input class="input" id="payrollDays" aria-label="计薪天数" type="number" min="0.01" max="31" step="any" value="${currentWorkdays}" placeholder="" required><em>天</em></label><button class="btn btn-primary" type="submit">应用</button></form></details>`;
  }
  function upload(){
    const net=state.payrollStage==='net',busy=importSession().busy,sheets=stageSheets(),main=sheets.filter(s=>net?s.key!=='grossUpload':!['social','fund'].includes(s.key)).sort((a,b)=>(a.key==='attendance'?-1:b.key==='attendance'?1:0)),done=main.filter(s=>state.sourceStatus[s.key]?.uploaded).length;
    const rejected=(sourceRows.roster||[]).map((row,i)=>({row,i,issues:PayrollEngine.rosterIdentityIssues(row)})).filter(x=>PayrollEngine.rosterRowInMonth(x.row,currentMonth)&&x.issues.length);
    const identityNotice=!net&&rejected.length?`<section class="wb-panel"><h3>花名册 ${rejected.length} 行未进入算薪名单</h3><p>必须同时有姓名和工号，请修正原表后重新上传。</p>${rejected.map(x=>`<p>${esc(x.row._rosterSource?.sheetName||'花名册')}第 ${x.row._rosterSource?.rowNumber||x.i+2} 行：${esc(x.issues.join('、'))}</p>`).join('')}</section>`:'';
    const need=net?'扣款资料':'工资资料',total=employees.reduce((s,e)=>s+num(e.gross),0);
    return `${identityNotice}<section class="wb-panel wb-upload-top"><input type="file" id="bulk-source-input" accept=".xlsx" multiple hidden><div class="wb-drop-area" data-bulk-upload role="button" tabindex="0" aria-label="批量选择 Excel 源表" aria-disabled="${busy}"><span class="wb-drop-icon">${icon.upload}</span><div><strong>${busy?'正在读取文件…':'拖入 Excel，自动识别资料'}</strong><p>也可以点击选择多个文件 · .xlsx · 单个不超过 20 MB</p></div><span class="wb-drop-choose">选择文件 ↗</span></div></section><div class="wb-upload-layout"><div class="wb-upload-main">${net?`<section class="wb-panel wb-gross-source">${label('应发工资来源',sourceRows.grossUpload?esc(state.sourceStatus.grossUpload?.filename||'上传应发表'):'',`<span class="wb-pill">${sourceRows.grossUpload?'上传文件':'自动衔接'}</span>`)}<div class="wb-source-total"><strong>¥ ${fmt(total)}</strong><span>${employees.length} 位员工</span>${btn('查看应发明细','workflow','data-stage="gross" data-route="results"')}</div><details class="wb-alternative" ${sourceRows.grossUpload?'open':''}><summary>使用已有应发工资表 <span>⌄</span></summary>${sourceRow(sheets.find(s=>s.key==='grossUpload'),true)}${sourceRows.grossUpload?'<button class="wb-link" data-remove-gross>恢复使用第一阶段结果</button>':'<p>未上传使用第一阶段生成结果，上传后以该文件为准。</p>'}</details></section>`:''}
      <section class="wb-panel">${renderImportReview()}
      ${label(need,net?'社保、公积金、个税及税后代扣在此阶段扣除。':'按姓名关联各张资料表，上传后可随时替换。',`<span class="wb-small">${done} / ${main.length} 张就绪</span>`)}<div class="wb-source-list">${main.map(sourceRow).join('')}</div></section>
      ${net?(sourceRows.grossUpload?`<div class="wb-compare">${renderComparison()}</div>`:''):`<details class="wb-panel wb-reference-sources"><summary><span>个税测算参考</span><span>社保、公积金 · 不计入应发扣款 ⌄</span></summary><div class="wb-source-list">${sheets.filter(s=>['social','fund'].includes(s.key)).map(sourceRow).join('')}</div></details>`}
      </div><aside class="wb-upload-side"><section class="wb-panel wb-run-panel"><span class="wb-eyebrow">${net?'第二阶段':'第一阶段'}</span><h2>${title()}核算</h2><p class="wb-small">${monthLabel(currentMonth)} · ${esc(currentBatch().company||'当前批次')}</p><div class="wb-checklist"><div><span>员工范围</span><strong>${employees.length?employees.length+' 人':'等待资料'}</strong></div><div><span>${need}</span><strong>${done} / ${main.length}</strong></div><div class="wb-edit-days"><label for="payrollDays">计薪天数</label><form id="payrollSettings" class="wb-days-control" aria-label="调整计薪天数"><input type="hidden" id="payrollYear" value="${currentMonth.slice(0,4)}"><input type="hidden" id="payrollMonth" value="${currentMonth.slice(5,7)}"><input type="hidden" id="makeupWorkdays" value="${esc(makeupWorkdays.join(','))}"><input type="number" class="input" id="payrollDays" aria-label="计薪天数" min="0.01" max="31" step="any" required value="${currentWorkdays}"><span>天</span></form></div></div>${!stageReady()?`<div class="wb-hint">${net?'请先计算应发，或上传已有应发工资表。':'先上传花名册，确定本批次员工范围。'}</div>`:''}${btn(`计算并核对${title()} →`,'calculate',!stageReady()||busy?'disabled':'',true)}</section></aside></div>`;
  }
  function mapping(){
    const gross=state.payrollStage==='gross',names=stageSheets().map(s=>s.name),interns=generatedEmployees.filter(e=>e.isIntern);
    const rows=gross?[...mappingRows.filter(r=>names.includes(r[1])&&r[0]!=='其他代扣'),['个人社保','社保表','个人总计 / 个人社保'],['个人公积金','公积金表','个人缴纳 / 个人公积金']]:[['应发工资','应发表 / 第一阶段结果','应发工资'],['个人社保','社保表','个人总计 / 个人社保'],['公司社保','社保表','公司总计 / 公司缴纳社保'],['个人公积金','公积金表','个人缴纳 / 个人公积金'],['公司公积金','公积金表','公司缴纳 / 公司缴纳公积金'],['个税','个税表','税 / 个税 / 个人所得税 / 税额'],['水电、餐费、其他代扣','税后代扣表','水电代扣 / 餐费代扣 / 其它代扣']];
    const internTable=interns.length?`<div class="wb-intern-toolbar"><label><input type="checkbox" id="selectAllInterns"> 全选实习生</label><div class="wb-row"><label for="bulkInternRate">批量日薪</label><div class="wb-inline-money"><span>¥</span><input id="bulkInternRate" type="number" min="0" step="0.01" placeholder="填写金额"></div><button class="btn btn-primary" data-apply-intern-rate>应用到已选</button></div></div><div class="wb-table-shell"><table class="wb-table"><thead><tr><th></th><th>员工</th><th class="amount">实际出勤天数</th><th class="amount">日薪</th><th class="amount">应发工资</th><th></th></tr></thead><tbody>${interns.map(e=>`<tr><td><input type="checkbox" aria-label="选择${esc(e.name)}" data-intern-select="${encodeURIComponent(e.name)}"></td><td><strong>${esc(e.name)}</strong><span class="wb-meta">${esc(e.dept)}</span></td><td class="amount">${integer(e.payableDays)} 天</td><td class="amount"><input class="input wb-rate-input" aria-label="${esc(e.name)}的日薪" type="number" min="0" step="0.01" value="${e.dailyRate??''}" data-intern-rate="${encodeURIComponent(e.name)}"></td><td class="amount">${fmt(e.gross)}</td><td>${btn('查看明细 ↗','person',`data-id="${esc(e.id)}"`)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="wb-inline-empty">${state.liveImport?'花名册中没有实习生。':'上传花名册后，可在这里统一设置实习生日薪。'}</div>`;
    return head(gross?'日薪与字段映射':'扣款字段映射','修改日薪后，明细与工资表同步更新。',route('返回资料准备','upload'))+`${gross?`<section class="wb-panel">${label('实习生日薪','日薪 × 考勤表实际出勤天数',`<span class="wb-pill">${interns.length} 人</span>`)}${internTable}</section>`:''}<section class="wb-panel wb-mapping-panel">${label('字段对应关系','上传时自动匹配以下字段；需要更正时可替换资料。')}<div class="wb-table-shell"><table class="wb-table"><thead><tr><th>工资字段</th><th>来源资料</th><th>识别的表头</th></tr></thead><tbody>${rows.map(r=>`<tr>${r.slice(0,3).map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  }
  function exceptions(){
    const list=employees.filter(e=>visibleIssues(e).length||e.payrollBlocked);
    return head('处理待核对事项',`${title()}阶段 · ${list.length} 位员工`,route('返回工资总表','results'))+`<section class="wb-panel">${label('按员工核对','金额可在明细调整；资料问题可返回上传页处理。',route('管理源表','upload'))}${list.length?`<div class="wb-issue-list">${list.map(e=>`<article class="wb-issue-person"><div><strong>${esc(e.name||'未命名员工')}</strong><span class="wb-meta">${esc(e.dept)} · ${esc(e.employeeNumber||e.id)}</span></div><div>${visibleIssues(e).map(x=>`<p><i></i>${esc(x)}</p>`).join('')}${e.rosterRow?`<small>花名册第 ${e.rosterRow} 行</small>`:''}</div>${btn('核对明细 →','person',`data-id="${esc(e.id)}"`)}</article>`).join('')}</div>`:'<div class="wb-inline-empty"><span class="wb-success-mark">✓</span><h2>当前没有待处理事项</h2><p>可以继续核对工资，或导出本批次结果。</p></div>'}</section>`;
  }
  function email(){
    const d=ensureEmailDraft(),v=d.validation;
    if(!employees.length)return head('邮件发送',esc(currentBatch().name))+`<div class="wb-empty"><h2>先完成本批次实发核算</h2><p>工资说明会使用实发结果与公司成本。</p>${route('准备实发资料','upload',true)}</div>`;
    const issues=[...v.errors,...v.warnings];
    return head('邮件发送',`${esc(currentBatch().name)} · 使用本批次实发结果`,`${route('返回实发总表','results')}<button class="btn" data-email-refresh>从最新工资更新</button>`)+`${d.workbenchStale?'<div class="wb-notice"><strong>工资结果已变化</strong><span>请从最新工资更新正文，并重新导出附件。</span></div>':''}<div class="wb-email-layout"><section class="wb-panel wb-mail-compose">${label('邮件内容','所有修改自动保存在当前批次。','<button class="wb-link" data-email-copy>复制正文</button>')}<div class="wb-address-grid"><label>收件人<input class="input" id="emailRecipient" data-email-field="recipient" value="${esc(d.recipient||'')}" /></label><label>称呼<input class="input" id="emailRecipientName" data-email-field="recipientName" value="${esc(d.recipientName||'')}" /></label><label class="wb-full">主题<input class="input" id="emailSubject" data-email-field="subject" value="${esc(d.subject||'')}" /></label></div><div class="wb-mail-body-head"><label for="emailPreview">正文</label><div class="wb-row"><button class="wb-link" data-email-apply ${d.bodyOverride?'':'hidden'}>按事项更新正文</button><span class="wb-small" id="wbBodyMode">${d.bodyOverride?'以手动正文为准':'可直接修改'}</span></div></div><textarea id="emailPreview" class="wb-mail-body" data-email-body aria-label="邮件正文">${esc(emailBody(d))}</textarea><div class="wb-mail-footer"><span class="wb-small" id="wbMailSaveState" aria-live="polite">已保存本批次草稿</span><span class="wb-small">附件需要在邮箱中手动添加</span></div></section>
    <aside class="wb-email-side"><section class="wb-panel wb-mail-send">${label('工资表与核对',`${employees.length} 位员工 · 实发阶段`)}<div class="wb-checklist"><div><span>实发合计</span><strong>¥ ${fmt(payrollTotal('net'))}</strong></div><div><span>公司总成本</span><strong id="wbMailCost">¥ ${fmt(d.summary.total)}</strong></div></div><div class="wb-attachment"><span class="wb-file-symbol">XLS</span><div><strong>本批次实发工资表</strong><small>${esc(d.sourceFilename)}</small></div></div><button class="btn wb-wide" data-email-export>导出工资表附件 ↓</button><span class="wb-small" id="wbAttachmentStatus">${d.attachmentReady?'✓ 已导出，请在邮箱中添加':'尚未导出附件'}</span><details class="wb-mail-validation" ${v.errors.length?'open':''}><summary id="wbMailValidationSummary">${issues.length?`${issues.length} 项核对提示`:'核对项已满足'} <span>⌄</span></summary><div id="wbMailValidationIssues">${issues.map(x=>`<p>${esc(x)}</p>`).join('')}</div></details><label class="wb-ack"><input type="checkbox" data-email-ack ${d.acknowledgedWarnings?'checked':''}>我已核对正文、金额和附件</label><button class="btn btn-primary wb-wide" data-email-open>打开邮箱编辑 →</button></section>
    <section class="wb-panel wb-mail-extra">${label('事项与成本','展开对应项目，补充或更正正文。')}${PayrollEmailEngine.SECTION_ORDER.map(([key,name])=>`<details><summary>${esc(name)}<span>编辑 ⌄</span></summary><textarea class="email-textarea" data-email-section="${key}" aria-label="${esc(name)}">${esc(d.sections?.[key]||'')}</textarea></details>`).join('')}<details><summary>成本与补充说明<span>编辑 ⌄</span></summary><label>公司总成本<input class="input" data-email-summary="total" value="${d.summary.total??''}"></label><label>平均人员成本<input class="input" data-email-summary="average" value="${d.summary.average??''}"></label><textarea class="email-textarea" data-email-manual-summary aria-label="补充说明" placeholder="补充部门或其他事项">${esc(d.manualSummary||'')}</textarea></details></section></aside></div>`;
  }
  function templates(){
    const desc=exportDescriptors(state.payrollStage==='gross');
    return head('工资表输出格式','当前核算使用统一格式，明细调整同步回填到导出文件。',btn(`导出当前${title()}工资表`,'export',employees.length?'':'disabled',true))+`<section class="wb-panel">${label('当前工资表格式','导出为 Excel，可继续用于下一阶段核算。','<span class="wb-pill">使用中</span>')}<div class="wb-template-options">${[['应发工资表','工资构成、税前扣减与应发合计','gross'],['实发工资表','应发、代扣、实发与公司成本','net']].map(([name,note,stage])=>`<button class="wb-template-option ${state.payrollStage===stage?'active':''}" data-wb="format-stage" data-stage="${stage}"><span class="wb-file-symbol">XLS</span><div><strong>${name}</strong><p>${note}</p></div><span>${state.payrollStage===stage?'✓':'→'}</span></button>`).join('')}</div><div class="wb-template-note"><span>输出字段</span><strong>${desc.length} 项</strong><span>当前阶段</span><strong>${title()}工资</strong></div><div class="wb-field-grid">${desc.map(([name],i)=>`<div><span>${String(i+1).padStart(2,'0')}</span>${name}</div>`).join('')}</div></section><div class="wb-detail-footer"><span class="wb-small">已下载文件需要重新导出，才会包含最新修改。</span>${route('查看字段来源','mapping')}</div>`;
  }
  function rules(){
    return head('核算规则','查看当前系统使用的口径与资料来源。',route('返回资料准备','upload'))+`<div class="wb-rules-layout"><nav class="wb-rule-nav"><a href="#rule-gross" data-rule-anchor="rule-gross">应发工资</a><a href="#rule-net" data-rule-anchor="rule-net">实发工资</a><a href="#rule-people" data-rule-anchor="rule-people">特殊人员</a><a href="#rule-edit" data-rule-anchor="rule-edit">明细调整</a></nav><div class="wb-rules-content"><section class="wb-panel" id="rule-gross">${label('01 应发工资','第一阶段：先核算工资构成')}<div class="wb-formula-text">工资与补贴 − 税前扣减 = 应发工资</div><p>基本工资、岗位工资、绩效工资和各项津贴计入工资与补贴。个人社保、公积金在第一阶段仅供个税测算参考。</p><details open><summary>计薪参数与员工假勤规则 ⌃</summary>${payrollSettings()}</details></section><section class="wb-panel" id="rule-net">${label('02 实发工资','第二阶段：补充代扣资料')}<div class="wb-formula-text">应发 − 社保 − 公积金 − 个税 − 税后代扣 = 实发</div><p>社保、公积金需在第二阶段补充。上传的应发表优先使用，可查看与第一阶段的差异，也可移除后恢复本批次生成结果。</p><p>个税使用上传金额。应发发生变化后，需要重新核对个税。</p></section><section class="wb-panel" id="rule-people">${label('特殊人员','沿用当前批次的计薪参数')}<h3>实习生</h3><p>实习工资 = 日薪 × 考勤表实际出勤天数，默认实发等于应发，不扣常规个人代扣。</p><h3>当月转正</h3><p>转正前后工资各按当月应出勤天数折算，两段天数合计应等于本月值。可在员工明细的考勤与人事页核对。</p></section><section class="wb-panel" id="rule-edit">${label('明细调整','保存后同步总表、汇总与导出')}<p>修改工资项目会更新相关计算。直接指定最终应发或实发时，系统单列人工调整差额，并保留修改原因。</p><p>每项调整支持撤销。原始资料不被回写；已经下载的工资表需重新导出。</p></section></div></div>`;
  }
  let rosterMapping = null;
  function rosterMappingPanel(){
    const d=rosterMapping;
    const options=(items,value)=>items.map(h=>`<option value="${esc(h)}" ${h===value?'selected':''}>${esc(h||'未提供')}</option>`).join('');
    return `<section class="wb-panel" id="rule-roster"><h2>字段映射与原表核对</h2><button type="button" class="btn" data-roster-upload>上传或更换花名册</button><p>花名册提供人员状态，考勤取自考勤表。企业成本 = 应发工资 + 公司社保 + 公司公积金。未匹配或缺失金额不计入已知成本合计。</p>${!d?.filename?'<p>请先在人员归集上传花名册。</p>':`<p>${esc(d.filename)}</p><label>人员来源<select data-roster-role><option value="active" ${d.role==='active'?'selected':''}>在职</option><option value="left" ${d.role==='left'?'selected':''}>离职</option></select></label><label>来源工作表<select data-roster-sheet>${options(['',...d.sheets],d.sheetName)}</select></label><div class="wb-roster-mapping">${d.fields.map(([field,label])=>`<label>${esc(label)}<select data-roster-field="${esc(field)}">${options(['',...d.headers],d.map[field]||'')}</select></label>`).join('')}</div>`}</section>`;
  }
  function bindRosterMapping(){
    const panel=document.getElementById('rule-roster');if(!panel)return;
    panel.querySelector('[data-roster-upload]')?.addEventListener('click',()=>window.parent.postMessage({type:'suyu-roster-mapping-edit',upload:true},location.origin));
    panel.querySelectorAll('[data-roster-field]').forEach(el=>el.addEventListener('change',()=>window.parent.postMessage({type:'suyu-roster-mapping-edit',sheet:rosterMapping.sheetName,field:el.dataset.rosterField,header:el.value},location.origin)));
    panel.querySelector('[data-roster-role]')?.addEventListener('change',e=>window.parent.postMessage({type:'suyu-roster-mapping-edit',role:e.target.value},location.origin));
    panel.querySelector('[data-roster-sheet]')?.addEventListener('change',e=>window.parent.postMessage({type:'suyu-roster-mapping-edit',sheetName:e.target.value},location.origin));
  }
  window.addEventListener?.('message',event=>{
    if(event.origin!==location.origin || event.source!==window.parent || event.data?.type!=='suyu-roster-mapping-state')return;
    rosterMapping=event.data.payload;
    const panel=document.getElementById('rule-roster');if(panel){panel.outerHTML=rosterMappingPanel();bindRosterMapping();}
  });
  function bindEmail(){
    const sync=()=>{const d=ensureEmailDraft(),area=document.getElementById('emailPreview');if(document.activeElement!==area)area.value=emailBody(d);document.getElementById('wbMailCost').textContent='¥ '+fmt(d.summary.total);const list=[...d.validation.errors,...d.validation.warnings];document.getElementById('wbMailValidationSummary').textContent=list.length?list.length+' 项核对提示 ⌄':'核对项已满足';document.getElementById('wbMailValidationIssues').innerHTML=list.map(x=>`<p>${esc(x)}</p>`).join('');document.getElementById('wbMailSaveState').textContent='已保存本批次草稿';document.querySelector('[data-email-apply]').hidden=!d.bodyOverride;document.getElementById('wbBodyMode').textContent=d.bodyOverride?'以手动正文为准':'可直接修改';};
    for(const [attr,fn] of [['field',setEmailField],['section',setEmailSection],['summary',setEmailSummary]])content.querySelectorAll(`[data-email-${attr}]`).forEach(el=>el.addEventListener('input',()=>{const d=ensureEmailDraft(),manual=d.bodyOverride;fn(el.dataset['email'+attr[0].toUpperCase()+attr.slice(1)],el.value);if(manual){d.bodyOverride=manual;saveBatchData();}sync();}));
    content.querySelector('[data-email-body]')?.addEventListener('input',e=>{const d=ensureEmailDraft();d.bodyOverride=e.target.value;d.validation=PayrollEmailEngine.validate(d);saveBatchData();sync();});
    content.querySelector('[data-email-manual-summary]')?.addEventListener('input',e=>{const d=ensureEmailDraft();d.manualSummary=e.target.value;saveBatchData();sync();});
    content.querySelector('[data-email-ack]')?.addEventListener('change',e=>{const d=ensureEmailDraft();d.acknowledgedWarnings=e.target.checked;d.validation=PayrollEmailEngine.validate(d);saveBatchData();sync();});
    content.querySelector('[data-email-apply]')?.addEventListener('click',()=>{if(!window.confirm('用当前事项与成本更新正文？手动正文将被替换。'))return;const d=ensureEmailDraft();d.bodyOverride='';saveBatchData();sync();});
    content.querySelector('[data-email-copy]')?.addEventListener('click',copyEmailBody);
    content.querySelector('[data-email-open]')?.addEventListener('click',openEmailComposer);
    content.querySelector('[data-email-refresh]')?.addEventListener('click',()=>{const d=ensureEmailDraft();if(d.bodyOverride&&!window.confirm('更新将替换手动编辑的正文，收件人与主题会保留。继续更新？'))return;ensureEmailDraft(true);render('email');showToast('已更新为本批次最新实发结果');});
    content.querySelector('[data-email-export]')?.addEventListener('click',()=>{if(!payrollExportReady())return;downloadCsv();const d=ensureEmailDraft();d.attachmentReady=true;saveBatchData();document.getElementById('wbAttachmentStatus').textContent='✓ 已导出，请在邮箱中添加';sync();});
  }
  function bind(){
    const daysForm=content.querySelector('.wb-days-control'), daysInput=daysForm?.querySelector('#payrollDays');
    if(daysInput){
      const commit=()=>{if(Number(daysInput.value)===Number(currentWorkdays) && daysInput.value.trim()!=='')return;if(daysForm.reportValidity())daysForm.requestSubmit();};
      daysInput.addEventListener('blur',commit);
      daysInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();commit();}});
    }

    if(state.view==='email')bindEmail();
    if(state.view==='rules'){bindRosterMapping();window.parent.postMessage({type:'suyu-roster-mapping-request'},location.origin);}
    content.querySelectorAll('[data-rule-anchor]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();document.getElementById(a.dataset.ruleAnchor)?.scrollIntoView({behavior:'smooth',block:'start'});}));
  }
  const legacyMapping=mapping;
  mapping=function(){
    return legacyMapping()
      .replace('日薪与字段映射','实习生工资与字段映射')
      .replace('修改日薪后，明细与工资表同步更新。','有基本工资时优先取基本工资；日薪只用于未填基本工资的实习生。')
      .replace('批量日薪','批量日薪（无基本工资时）')
      .replace('>日薪</th>','>日薪（无基本工资时）</th>')
      .replace('实习生日薪','实习生工资')
      .replace('日薪 × 考勤表实际出勤天数','有基本工资时取基本工资；未填基本工资时，日薪 × 考勤表实际出勤天数')
      .replace('可在这里统一设置实习生日薪。','可在这里为未填基本工资的实习生统一设置日薪。');
  };
  const legacyRules=rules;
  rules=function(){
    return legacyRules().replace('<div class="wb-rules-content">','<div class="wb-rules-content">'+rosterMappingPanel()).replace('<nav class="wb-rule-nav">','<nav class="wb-rule-nav"><a href="#rule-roster" data-rule-anchor="rule-roster">花名册字段映射</a>').replace(
      '实习工资 = 日薪 × 考勤表实际出勤天数，默认实发等于应发，不扣常规个人代扣。',
      '有基本工资时，实习工资取基本工资；未填基本工资时，按日薪 × 考勤表实际出勤天数。实发工资扣个税和税后代扣；个人社保、公积金不扣。'
    );
  };
  return {upload,mapping,exceptions,email,templates,rules,bind};
})();
