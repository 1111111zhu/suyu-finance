/* Shared two-stage workbench: search -> inspect -> edit one item -> save -> next. */
globalThis.PayrollWorkbenchUI=(()=>{
  const W=PayrollWorkbench, P=PayrollWorkbenchPages, esc=escapeHtml, fmt=money;
  const original={bind:bindView};
  const ui={tab:'all',page:1,detailTab:'pay',draft:null,query:'',sourceOpen:false,queue:[]};
  const icons={search:'<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>',edit:'<svg viewBox="0 0 24 24"><path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z"/></svg>'};
  const navIcons={monthly:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/></svg>',batches:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',email:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>',directory:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 7h5m-5 4h5m-5 4h4"/></svg>',settings:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',home:'<svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7M5 10v10h14V10"/></svg>'};
  const navLabel=(icon,label)=>`<span class="wb-nav-icon" aria-hidden="true">${navIcons[icon]}</span><span class="wb-nav-label">${label}</span>`;
  const title=()=>state.payrollStage==='gross'?'应发':'实发';
  const action=(label,cmd,extra='',cls='wb-link')=>`<button type="button" class="${cls}" data-wb="${cmd}" ${extra}>${label}</button>`;
  const sign=n=>(n>0?'+':'')+fmt(n);
  const isDayField=field=>/Days$|Workdays$/.test(field)||['sick','personal','absent','annual','flexible','compensatory'].includes(field);
  const valueText=(field,value)=>isDayField(field)?`${integer(value)} 天`:field==='score'?integer(value):fmt(value);
  const queryBox=(id,placeholder,value='',small=false)=>`<div class="wb-search${small?' compact':''}">${icons.search}<input id="${id}" aria-label="${placeholder}" placeholder="${placeholder}" value="${esc(value)}" autocomplete="off" />${small?'<div class="wb-search-results" id="employeeMatches" hidden></div>':''}</div>`;
  const monthlyViews=['upload','mapping','results','slip','exceptions'];
  const preferredStatuses=['正职','入职','离职','转正','实习生','在职','薪资异动'];
  let monthlyLocation=null, initializing=null;
  function grossUploadDone(){const required=['roster','salary','performance','attendance','other'];return !!state.liveImport&&required.every(key=>state.sourceStatus[key]?.uploaded&&sourceRows[key]?.length);}
  function grossResultDone(){return grossUploadDone()&&generatedEmployees.length>0&&currentBatch().status==='已计算';}
  function netUploadDone(){const required=['tax','netSocial','netFund','afterTax'];return grossResultDone()&&!!state.liveImport&&required.every(key=>state.sourceStatus[key]?.uploaded&&sourceRows[key]?.length);}
  function netResultDone(){const list=PayrollEngine.calculateNet(sourceRows.grossUpload?PayrollEngine.uploadedEmployees(sourceRows.grossUpload):generatedEmployees,sourceRows),old=state.payrollStage;state.payrollStage='net';const done=netUploadDone()&&list.length>0&&list.every(e=>W.isReviewed(e));state.payrollStage=old;return done;}
  function stages(){
    const working=['upload','mapping'].includes(state.view),inPayroll=monthlyViews.includes(state.view);
    const currentIndex=!inPayroll?0:state.payrollStage==='gross'?(working?0:1):(working?2:3);
    const complete=[grossUploadDone(),grossResultDone(),netUploadDone(),netResultDone()];
    const steps=[['gross','upload','应发核算','准备资料'],['gross','results','应发核算','核对工资'],['net','upload','实发核算','准备资料'],['net','results','实发核算','核对工资']];
    return `<section class="wb-workflow wb-workflow-guide" aria-label="本月工资核算流程"><nav class="wb-flow-groups" aria-label="算薪步骤">${steps.map(([stage,view,phase,label],index)=>{
      const active=index===currentIndex,done=complete[index];
      return `${index?`<span class="wb-flow-link ${complete[index-1]?'done':''}" aria-hidden="true"><i></i></span>`:''}${action(`<span class="wb-step-dot">${done?'✓':String(index+1).padStart(2,'0')}</span><span class="wb-step-text"><strong>${label}</strong><small>${phase}</small></span>${active?'<em>当前</em>':''}`,'workflow',`data-stage="${stage}" data-route="${view}" aria-label="${phase}：${label}" ${active?'aria-current="step"':''}`,'wb-flow-step'+(active?' active':'')+(done?' done':''))}`;
    }).join('')}</nav></section>`;
  }
  function header(){const active=state.view;document.querySelector('.topbar').innerHTML=`<a class="wb-brand" href="./index.html" aria-label="SEEEX TECH 溯驭技术薪资系统"><span class="wb-brand-mark" aria-hidden="true"></span></a><nav class="wb-topnav" aria-label="主导航">${action(navLabel('monthly','本月工资'),'monthly','aria-label="本月工资"',monthlyViews.includes(active)?'active wb-month-home':'wb-month-home')}${[['directory','人员归集'],['batches','历史批次'],['email','邮件发送']].map(([v,t])=>action(navLabel(v,t),'route',`data-route="${v}" aria-label="${t}"`,active===v?'active':'')).join('')}<details class="wb-nav-menu"><summary>${navLabel('settings','核算设置')}<span class="wb-nav-chevron">⌄</span></summary><div>${[['mapping','实习生日薪与字段映射'],['exceptions','异常记录'],['rules','核算规则'],['templates','输出模板']].map(([v,t])=>action(t,'route',`data-route="${v}"`,'')).join('')}</div></details></nav>`;}
  function employeeTags(e){const roster=String(e.status||e.statusRaw||'').trim(),tags=[...(e.payrollTags||[])];if(!tags.length&&roster)tags.push(roster);if(e.regularizationActive)tags.push('转正');if(e.isIntern)tags.push('实习生');if(Object.keys(W.overrides(e)).length||num(e.grossAdjustment)||num(e.netAdjustment)||e._grossPinned||e._netPinned)tags.push('薪资异动');return [...new Set(tags)];}
  function statusOptions(){const tags=[...new Set(employees.flatMap(employeeTags).filter(Boolean))];return [...preferredStatuses.filter(t=>tags.includes(t)),...tags.filter(t=>!preferredStatuses.includes(t)).sort((a,b)=>a.localeCompare(b,'zh-CN'))];}
  function searchEmployees(){const q=state.search.trim().toLowerCase();return employees.filter(e=>(!q||String(e.name).toLowerCase().includes(q)||String(e.employeeNumber||e.id).toLowerCase().includes(q))&&(state.dept==='全部部门'||e.dept===state.dept)&&(state.status==='全部状态'||employeeTags(e).includes(state.status)));}
  function filtered(){return searchEmployees().filter(e=>ui.tab==='issues'?visibleIssues(e).length>0:ui.tab==='adjusted'?Object.keys(W.overrides(e)).length>0:ui.tab==='reviewed'?W.isReviewed(e):true);}
  function empty(){return `<div class="wb-empty"><h2>还没有${title()}工资结果</h2><p>${state.payrollStage==='gross'?'上传花名册和工资资料，即可开始本月核算。':'使用第一阶段应发结果，或上传已有应发表，再补充扣款资料。'}</p>${action('上传资料，开始核算','route','data-route="upload"','btn btn-primary')}</div>`;}
  function status(e){const issues=visibleIssues(e);if(issues.length)return `<span class="wb-status warn" title="${esc(issues.join('；'))}">● ${esc(issues[0].length>18?issues[0].slice(0,18)+'…':issues[0])}</span>`;if(W.isReviewed(e))return `<span class="wb-status good">✓ 已核对${Object.keys(W.overrides(e)).length?' · 已调整':''}</span>`;if(Object.keys(W.overrides(e)).length)return '<span class="wb-status good">已调整</span>';return '<span class="wb-status">待核对</span>';}
  function rowsHTML(){const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/8));ui.page=Math.min(ui.page,pages);const start=(ui.page-1)*8,gross=state.payrollStage==='gross';
    return `<div class="wb-table-shell"><table class="wb-table"><thead><tr><th>员工</th><th class="amount">${gross?'工资与补贴':'应发工资'}</th><th class="amount">${gross?'税前扣减':'扣款合计'}</th><th class="amount">${title()}工资</th><th>核对状态</th><th></th></tr></thead><tbody>${rows.slice(start,start+8).map(e=>`<tr data-wb="person" data-id="${esc(e.id)}"><td>${action(esc(e.name||'未命名员工'),'person',`data-id="${esc(e.id)}"`,'wb-name')}<span class="wb-meta">${esc(e.dept)} · ${esc(e.employeeNumber||e.id)}${e.payrollTags?.length?' · '+esc(e.payrollTags.join('、')):e.isIntern?' · 实习生':''}</span></td><td class="amount">${fmt(gross?earnings(e):e.gross)}</td><td class="amount">${fmt(gross?pretax(e):deductions(e))}</td><td class="amount"><strong>${fmt(gross?e.gross:e.net)}</strong></td><td>${status(e)}</td><td>${action(visibleIssues(e).length?'去处理 →':'查看明细 ↗','person',`data-id="${esc(e.id)}"`)}</td></tr>`).join('')||'<tr><td colspan="6" class="wb-muted" style="padding:40px;text-align:center">没有找到匹配的员工</td></tr>'}</tbody></table></div><div class="wb-pagination"><span>显示 ${rows.length?start+1:0}–${Math.min(start+8,rows.length)} / ${rows.length} 位员工</span><div class="wb-row">${action('‹','page',`aria-label="上一页" data-page="-1" ${ui.page===1?'disabled':''}`,'')}<span>${ui.page} / ${pages}</span>${action('›','page',`aria-label="下一页" data-page="1" ${ui.page===pages?'disabled':''}`,'')}</div></div>`;
  }
  function results(){const gross=state.payrollStage==='gross',issues=employees.filter(e=>visibleIssues(e).length),adjusted=employees.filter(e=>Object.keys(W.overrides(e)).length);
    return `<div class="wb-page-head"><div><h1>核对${title()}工资</h1></div><div class="wb-actions">${action(`导出${title()}工资表`,'export',employees.length?'':'disabled',gross?'btn':'btn btn-primary')}${gross&&employees.length?action('下一步：准备实发资料 →','workflow','data-stage="net" data-route="upload"','btn btn-primary'):''}</div></div>${employees.length?`<div class="wb-totals"><span>应发合计 <strong>¥ ${fmt(payrollTotal('gross'))}</strong></span>${gross?'':`<span>实发合计 <strong>¥ ${fmt(payrollTotal('net'))}</strong></span>`}</div>`:''}${!gross&&sourceRows.grossUpload?`<div class="wb-notice info"><span>应发来源：${esc(state.sourceStatus.grossUpload?.filename||'上传的应发工资表')}</span>${action('查看来源与差异','route','data-route="upload"')}</div>`:''}${issues.length?`<button type="button" class="wb-notice wb-notice-action" data-wb="pending" aria-label="查看全部 ${issues.length} 位待处理员工"><span class="wb-bullet" aria-hidden="true"></span><strong>${issues.length} 位员工需要处理</strong><span class="wb-muted">缺少资料或核算结果待确认</span><span class="wb-notice-arrow" aria-hidden="true">→</span></button>`:''}${employees.length?`<div class="wb-toolbar">${queryBox('wbResultSearch','输入姓名或工号，快速找到员工',state.search)}<select class="select" id="wbDept" aria-label="按部门筛选"><option>全部部门</option>${[...new Set(employees.map(e=>e.dept))].map(d=>`<option ${state.dept===d?'selected':''}>${esc(d)}</option>`).join('')}</select><select class="select" id="wbStatus" aria-label="按员工状态筛选"><option>全部状态</option>${statusOptions().map(v=>`<option ${state.status===v?'selected':''}>${esc(v)}</option>`).join('')}</select></div><div class="wb-tabs">${[['all','全部',employees.length],['issues','待处理',issues.length],['adjusted','已调整',adjusted.length],['reviewed','已核对',employees.filter(W.isReviewed).length]].map(([id,label,count])=>action(`${label}<em>${count}</em>`,'filter',`data-filter="${id}"`,ui.tab===id?'active':'')).join('')}<span class="wb-small">金额单位：元</span></div><div id="wbResultRows">${rowsHTML()}</div><div class="wb-detail-footer wb-detail-footer-end">${gross?action('下一步：准备实发资料 →','workflow','data-stage="net" data-route="upload"'):action('下一步：邮件发送 →','route','data-route="email"')}</div>`:empty()}`;
  }
  function earnings(e){return e.isIntern?e.computedGross:roundNumber(num(e.subtotal)+num(e.meal)+num(e.transit)+num(e.otherAllow)+num(e.sickSubsidy)+num(e.otherAdd));}
  function pretax(e){return roundNumber(num(e.attendanceDeduct)+num(e.otherReduction));}
  function deductions(e){return roundNumber(num(e.social)+num(e.fund)+num(e.tax)+num(e.afterTaxTotal));}
  const roundNumber=PayrollEngine.round;
  function equation(e){const gross=state.payrollStage==='gross',before=ui.draft?.employee,after=gross?e.gross:e.net,delta=before?roundNumber(after-(gross?before.gross:before.net)):0;
    return `<div class="wb-equation" id="wbEquation"><div class="wb-part"><label>${gross?'工资与补贴':'应发工资'}</label><strong>${fmt(gross?earnings(e):e.gross)}</strong></div><span class="wb-operator">−</span><div class="wb-part"><label>${gross?'税前扣减':'扣款合计'}</label><strong>${fmt(gross?pretax(e):deductions(e))}</strong></div>${(gross?e.grossAdjustment:e.netAdjustment)?`<span class="wb-operator">${(gross?e.grossAdjustment:e.netAdjustment)>0?'+':'−'}</span><div class="wb-part adjustment"><label>人工调整</label><strong>${fmt(Math.abs(gross?e.grossAdjustment:e.netAdjustment))}</strong></div>`:''}<span class="wb-operator">=</span><div class="wb-part final"><label>${ui.draft?'预计':''}${title()}</label><strong>${fmt(after)}</strong>${delta?`<span class="wb-delta">${sign(delta)}</span>`:''}</div>${action(`调整${title()}金额`,'edit',`data-field="${gross?'grossTarget':'netTarget'}"`,'btn')}</div>`;
  }
  function item(e,field,note='',editable=true){const label=W.fields[field]?.[0]||field,active=ui.draft?.field===field,display=W.value(e,field),changed=Object.hasOwn(W.overrides(e),field),old=active?W.value(ui.draft.employee,field):null;
    const f=v=>valueText(field,v);
    return `<div class="wb-item ${active?'active':''}"><div><div class="wb-item-name">${esc(label)}</div>${note?`<div class="wb-item-note">${esc(note)}</div>`:changed?'<div class="wb-item-note">已人工调整</div>':''}</div><div class="wb-item-value">${active&&old!==display?`<del>${f(old)}</del><span>→</span>`:''}<span class="${changed?'edited':''}">${f(display)}</span>${editable?action(icons.edit,'edit',`data-field="${field}" title="修改${label}" aria-label="修改${label}"`,'wb-edit'):''}</div></div>`;
  }
  const group=(name,total)=>`<div class="wb-group-head"><span>${name}</span>${total===undefined?'':`<strong>${fmt(total)}</strong>`}</div>`;
  function ledger(e){const gross=state.payrollStage==='gross';
    if(ui.detailTab==='history')return historyHTML(e);
    if(ui.detailTab==='people')return group('人事信息')+[['姓名',e.name],['工号',e.employeeNumber||e.id],['公司',e.company],['部门',e.dept],['入职日期',e.join||'—'],['离职日期',e.leave||'—'],['转正日期',e.regularizationDate||'—']].map(([label,v])=>`<div class="wb-item"><span class="wb-item-name">${label}</span><span>${esc(v)}</span></div>`).join('')+group('考勤记录')+['actualPaidDays','annual','flexible','compensatory','sick','personal','absent'].map(f=>item(e,f)).join('')+(e.regularizationActive?group('转正分段')+(e._input?.probationTotal!=null?['probationTotal','regularTotal']:['probationBase','regularBase','probationPost','regularPost','probationPerfBase','regularPerfBase']).concat(['probationWorkdays','regularWorkdays']).map(f=>item(e,f)).join(''):'');
    if(ui.detailTab==='company')return group('公司承担',num(e.companySocial)+num(e.companyFund))+item(e,'companySocial')+item(e,'companyFund')+`<div class="wb-group-head"><span>公司总成本</span><strong>${fmt(e.companyCost)}</strong></div><p class="wb-small">应发工资 + 公司社保 + 公司公积金</p>`;
    if(gross){if(e.isIntern)return group('实习生工资',e.gross)+item(e,'dailyRate')+item(e,'actualPaidDays')+`<div class="wb-reference"><p>工资 = 日薪 × 实发薪天数。可通过“调整应发金额”保留特殊补发差额。</p></div>`;
      return group('工资与补贴',earnings(e))+(e.regularizationActive?`<div class="wb-item"><span>转正分段工资</span><strong>${fmt(e.subtotal)}</strong>${action('查看分段','detailtab','data-tab="people"')}</div>`:['base','post','performancePay'].map(f=>item(e,f,f==='performancePay'?`${fmt(e.perfBase)} × ${integer(e.effectiveScore)}`:'')).join(''))+['meal',...(e.transit?['transit']:[]),...(e.otherAllow?['otherAllow']:[]),...(e.sickSubsidy?['sickSubsidy']:[]),'otherAdd'].map(f=>item(e,f)).join('')+group('税前扣减',pretax(e))+item(e,'attendanceDeduct',`工资小计 ÷ 21.75 × ${integer(e.deductDays)} 天`)+item(e,'otherReduction')+(e._grossPinned?`<div class="wb-item"><span>应发人工调整</span><strong>${sign(e.grossAdjustment)}</strong>${action('恢复计算','reset','data-field="grossTarget"')}</div>`:'')+`<details class="wb-reference"><summary>个税测算参考 · 社保与公积金</summary><p>仅列示，不从应发扣除。</p>${item(e,'social')}${item(e,'fund')}</details>`;
    }
    return `<div class="wb-item"><strong>应发工资</strong><div class="wb-item-value"><strong>${fmt(e.gross)}</strong>${action('查看构成','grossdetail')}</div></div>`+(e.isIntern?'<p class="wb-small">实习生不参与常规代扣；默认实发等于应发。</p>':group('社保、公积金与个税',num(e.social)+num(e.fund)+num(e.tax))+['social','fund','tax'].map(f=>item(e,f,f==='tax'?'个税表':f==='social'?'第二阶段社保表':'第二阶段公积金表')).join('')+group('税后代扣',e.afterTaxTotal)+['utility','mealDeduct','otherDeduct'].map(f=>item(e,f,f==='mealDeduct'?'税后代扣表':'')).join(''))+(e._netPinned?`<div class="wb-item"><span>实发人工调整</span><strong>${sign(e.netAdjustment)}</strong>${action('恢复计算','reset','data-field="netTarget"')}</div>`:'');
  }
  function historyHTML(e){const list=W.history(e).slice().reverse();return group('调整记录')+(list.length?list.map(h=>`<div class="wb-history-item"><div class="wb-row wb-between"><strong>${esc(W.fields[h.field]?.[0]||h.field)}</strong><span>${valueText(h.field,h.before)} → ${valueText(h.field,h.value)}</span></div>${h.reason?`<p>${esc(h.reason)}</p>`:''}<div class="wb-row wb-between"><span class="wb-small">${new Date(h.at).toLocaleString('zh-CN')}${h.revoked?' · 已撤销':''}</span>${h.revoked?'':action('撤销此次修改','undo',`data-id="${esc(h.id)}"`)}</div></div>`).join(''):'<p class="wb-muted" style="padding:25px 0">尚无调整，所有金额均来自当前核算结果。</p>');}
  function impact(e){const d=ui.draft;if(!d)return '';const gross=state.payrollStage==='gross',old=d.employee;return `<h3>本次影响</h3>${(gross?[['应发工资',old.gross,e.gross]]:[['扣款合计',deductions(old),deductions(e)],['实发工资',old.net,e.net]]).map(([label,a,b])=>`<div class="wb-impact-row"><span>${label}</span><span>${fmt(a)}　→　<strong>${fmt(b)}</strong></span></div>`).join('')}<div class="wb-impact-row"><span>${title()}变化</span><strong>${sign(gross?e.gross-old.gross:e.net-old.net)}</strong></div>`;}
  function editor(e){const d=ui.draft,gross=state.payrollStage==='gross';
    if(!d)return `<aside class="wb-editor"><div class="wb-editor-idle"><div class="wb-small">${title()}核对</div><h2>${W.isReviewed(e)?'这位员工已核对':'核对本人工资'}</h2><p>在左侧点击工资项目，查看来源、调整金额。</p><div class="wb-review-meter"><span>本批次已核对</span><strong>${employees.filter(W.isReviewed).length} / ${employees.length}</strong></div><div class="wb-shortcuts">${action(W.isReviewed(e)?'继续下一位 →':'核对完成，下一位 →','review-next','','btn btn-primary')}${action(gross?'补发 / 扣减项目　＋':'添加代扣项目　＋','add','','btn')}</div><div class="wb-review-tools">${action('导出明细 ↓','export-person')}${action('打印明细','print-person')}</div>${W.ambiguous(e)?'<p class="wb-small">存在同名人员，请先核对源表。</p>':''}</div></aside>`;
    const f=d.field,source=W.source(e,f),target=f.endsWith('Target'),days=isDayField(f),prefix=f==='score'?'×':days?'':'¥';
    return `<aside class="wb-editor" id="wbEditor"><span class="wb-small">正在修改</span><h2>${esc(W.fields[f][0])}</h2><label for="wbAmount">${days?'调整后天数':target?'指定最终金额':'调整后数值'}</label><div class="wb-money-input">${prefix?`<span>${prefix}</span>`:''}<input id="wbAmount" inputmode="decimal" value="${esc(d.value)}" aria-label="${days?'调整后天数':'调整后数值'}" /></div><div class="wb-original"><span>修改前 ${valueText(f,W.value(d.employee,f))}</span>${action('查看来源','source')}</div>${days?'':`<label for="wbReason">修改原因</label><textarea id="wbReason" placeholder="例如：补发补贴、餐费更正">${esc(d.reason)}</textarea>`}<div class="wb-error" id="wbEditError"></div><div class="wb-impact" id="wbImpact" aria-live="polite">${impact(e)}</div><div class="wb-small">${target?'指定金额会保留，后续重算同步更新人工调整差额。':`保存后同步${title()}工资表与汇总。`}</div>${gross&&!['social','fund'].includes(f)?'<div class="wb-small" style="margin-top:7px">使用本次应发的实发结果将重算，个税需复核。</div>':''}<div class="wb-editor-actions">${action('取消','cancel-edit','','btn')}${action('保存修改','save','','btn btn-primary')}</div><div class="wb-row wb-between" style="margin-top:13px"><span class="wb-small">${esc(source.label)}</span>${Object.hasOwn(W.overrides(d.employee),f)?action('恢复来源值','reset',`data-field="${f}"`):''}</div></aside>`;
  }
  function detail(){const e=W.selected();if(!e)return empty();const gross=state.payrollStage==='gross',issues=visibleIssues(e);
    return `<div class="wb-person-nav">${action(`← ${title()}工资总表`,'route','data-route="results"','wb-link neutral')}<div class="wb-row">${queryBox('wbPersonSearch','搜索姓名，切换员工','',true)}${action('上一位','previous')}${action('下一位 →','next')}</div></div><div class="wb-person-head"><div><h1>${esc(e.name||'未命名员工')}<span>${e.isIntern?'实习生':esc(e.status)}</span></h1><span class="wb-muted">${esc(e.dept)} · ${esc(e.employeeNumber||e.id)}</span></div><span class="wb-stage-label">${title()}工资明细</span></div>${gross?'':`<div class="wb-source-line">${action('查看该员工应发明细 ↗','grossdetail')}</div>`}${issues.length?`<details class="wb-reference" style="margin-bottom:12px"><summary style="color:var(--orange)">${issues.length} 项待核对 · 点击查看</summary>${issues.map(x=>`<p>${esc(x)}</p>`).join('')}${action('资料与来源','route','data-route="upload"')}</details>`:''}${equation(e)}<div class="wb-detail-grid"><section class="wb-ledger"><div class="wb-tabs">${[['pay',`${title()}构成`],[gross?'people':'company',gross?'考勤与人事':'公司承担'],['history','调整记录']].map(([id,label])=>action(label,'detailtab',`data-tab="${id}"`,ui.detailTab===id?'active':'')).join('')}${action(gross?'＋ 添加工资项目':'＋ 添加代扣','add')}</div><div id="wbLedger">${ledger(e)}</div></section><div id="wbEditorSlot">${editor(e)}</div></div><div class="wb-detail-footer"><span class="wb-small">已下载的工资表需重新导出</span>${action(`返回${title()}工资总表 →`,'route','data-route="results"')}</div>`;
  }
  // Keep the current workbench data and routes, but retain the original batch-management view.
  function batchAmount(batch,metric){
    const people=batch.personnelAnalysis?.people;
    if(batch.draftOrigin==='demo'||Object.values(batch.data?.sourceStatus||{}).some(s=>s?.demo)||!people?.length||people.some(p=>!Number.isFinite(p[metric])))return '待提供';
    return fmt(people.reduce((sum,p)=>sum+p[metric],0));
  }
  function batches(){return `<div class="wb-page-head"><div><h1>批次管理</h1></div>${action('新建批次','new','','btn btn-primary')}</div><section class="card"><div class="section-head"><div><div class="section-title">算薪批次列表</div></div><div class="search-wrap">${icons.search}<input class="input" placeholder="搜索批次…" id="wbBatchSearch" aria-label="搜索批次" autocomplete="off" /></div></div><div class="section-body"><div class="batch-list" id="batchList">${state.batches.map((b,i)=>`<div class="batch-row" data-wb-batch-row data-name="${esc(b.name+' '+b.month)}"><div><div class="batch-name">${esc(b.name)} ${b.active?'<span class="badge blue">当前批次</span>':''}</div></div><div><div class="batch-stat-label">员工人数</div><div class="batch-stat-value">${b.employees||0} 人</div></div><div><div class="batch-stat-label">应发金额</div><div class="batch-stat-value">${batchAmount(b,'gross')}</div></div><div><div class="batch-stat-label">实发金额</div><div class="batch-stat-value">${batchAmount(b,'net')}</div></div><div class="batch-actions">${action('查看明细','batch',`data-index="${i}"`,'btn btn-sm')}${b.active?action('重算','batch-rerun',`data-index="${i}"`,'btn btn-sm'):''}${action('导出','batch-export',`data-index="${i}"`,'btn btn-sm')}</div></div>`).join('')}</div></div></section>`;}
  function dirty(){return !!ui.draft&&(String(ui.draft.value)!==String(W.value(ui.draft.employee,ui.draft.field))||!!ui.draft.reason);}
  function leave(){if(dirty()&&!window.confirm('当前修改尚未保存。放弃修改并继续？'))return false;if(ui.draft){W.clearPreview();ui.draft=null;}return true;}
  function mount(view=state.view,guard=true){
    if(guard&&!leave())return;
    const previous=state.view;state.view=view==='overview'?'upload':view;
    if(state.view==='email'&&state.payrollStage!=='net'){state.payrollStage='net';recalculateEmployees();saveBatchData();}
    if(monthlyViews.includes(state.view))monthlyLocation={stage:state.payrollStage,view:state.view};
    header();let body;
    if(state.view==='results')body=(W.orphaned().length?`<div class="wb-notice"><strong>${W.orphaned().length} 位员工的调整需要重新关联</strong>${action('关联员工 →','relink')}</div>`:'')+results();
    else if(state.view==='directory')body=globalThis.PersonnelDirectory?.render?.()||'<div class="wb-empty"><h2>人员归集正在加载</h2></div>';
    else if(state.view==='slip')body=detail();else if(state.view==='batches')body=batches();
    else if(P[state.view])body=P[state.view]();else {state.view='upload';body=P.upload();}
    content.dataset.view=state.view;
    content.innerHTML=(['upload','results','slip'].includes(state.view)?stages():'')+body;
    if(['upload','mapping','rules'].includes(state.view))original.bind();
    P.bind();bindInputs();if(state.view==='directory')globalThis.PersonnelDirectory?.bind?.(previous!=='directory');
    if(previous!==state.view)window.scrollTo?.({top:0,behavior:'instant'});
    if(window.history?.replaceState)window.history.replaceState(null,'',`#${state.payrollStage}/${state.view}${state.view==='slip'?'/'+encodeURIComponent(state.selectedId):''}`);
    // Import/compute finally blocks can finish without another local save. Notify only;
    // cloud status packing calls the original snapshot writer, never this mount or save queue.
    W.notifyState();
  }
  render=view=>mount(view||state.view);
  stepper=()=>'';
  switchPayrollStage=stage=>changeStage(stage);
  function changeStage(stage,targetView){if(importSession().busy){showToast('资料正在解析，请稍候');return;}if(!leave())return;const e=W.selected(),k=e&&W.key(e),view=state.view;state.payrollStage=stage;recalculateEmployees();const match=employees.find(p=>W.key(p)===k);state.selectedId=match?.id||employees[0]?.id;ui.detailTab='pay';ui.page=1;saveBatchData();mount(targetView||(view==='slip'&&match?'slip':['upload','mapping'].includes(view)?view:employees.length?'results':'upload'),false);}
  function refreshResults(){document.getElementById('wbResultRows').innerHTML=rowsHTML();}
  function bindInputs(){
    document.getElementById('wbStatus')?.addEventListener('change',e=>{state.status=e.target.value;ui.page=1;refreshResults();});
    document.getElementById('wbResultSearch')?.addEventListener('input',e=>{state.search=e.target.value;ui.page=1;refreshResults();});
    document.getElementById('wbDept')?.addEventListener('change',e=>{state.dept=e.target.value;ui.page=1;refreshResults();});
    document.getElementById('wbBatchSearch')?.addEventListener('input',e=>content.querySelectorAll('[data-wb-batch-row]').forEach(r=>r.hidden=!r.dataset.name.includes(e.target.value)));
    document.getElementById('wbPersonSearch')?.addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase(),list=document.getElementById('employeeMatches');list.hidden=!q;const matches=employees.filter(p=>p.name.toLowerCase().includes(q)||String(p.employeeNumber||p.id).toLowerCase().includes(q));list.innerHTML=matches.slice(0,12).map(p=>action(`${esc(p.name)} <span class="wb-meta">${esc(p.dept)} · ${esc(p.employeeNumber||p.id)}</span>`,'person',`data-id="${esc(p.id)}"`,'')).join('')||'<div class="wb-small">没有找到匹配员工</div>';});
    bindEditor();
  }
  function bindEditor(){document.getElementById('wbAmount')?.addEventListener('input',e=>{ui.draft.value=e.target.value;try{const emp=W.previewChange(ui.draft.employee,ui.draft.field,e.target.value);document.getElementById('wbEquation').outerHTML=equation(emp);document.getElementById('wbLedger').innerHTML=ledger(emp);document.getElementById('wbImpact').innerHTML=impact(emp);document.getElementById('wbEditError').textContent='';}catch(err){document.getElementById('wbEditError').textContent=err.message;}});document.getElementById('wbReason')?.addEventListener('input',e=>ui.draft.reason=e.target.value);}
  function edit(field){if(!leave())return;const e=W.selected();if(W.ambiguous(e)){showToast('存在重复姓名，请先核对来源并区分员工',4500);return;}ui.draft={field,employee:structuredClone(e),value:W.value(e,field)??'',reason:''};ui.detailTab=ui.detailTab==='history'?'pay':ui.detailTab;mount('slip',false);document.getElementById('wbAmount')?.focus();document.getElementById('wbAmount')?.select();}
  function person(id){if(!leave())return;if(state.view!=='slip')ui.queue=(filtered().some(e=>e.id===id)?filtered():employees).map(e=>W.key(e));state.selectedId=id;ui.detailTab='pay';mount('slip',false);}
  function next(direction){if(!leave())return;const pool=ui.queue.length?ui.queue.map(k=>employees.find(e=>W.key(e)===k)).filter(Boolean):employees,index=pool.findIndex(e=>e.id===state.selectedId),target=pool[index+direction];if(target)person(target.id);else showToast(direction>0?'已经是本组最后一位':'已经是本组第一位');}
  function dialog(html){document.querySelector('.wb-dialog')?.remove();const d=document.createElement('dialog');d.className='wb-dialog';d.innerHTML=html+`<div class="wb-row" style="justify-content:flex-end;margin-top:20px">${action('关闭','close-dialog','','btn')}</div>`;document.body.append(d);d.showModal();return d;}
  async function handle(event){const b=event.target.closest('[data-wb]');if(!b||b.disabled)return;const cmd=b.dataset.wb;try{
    if(cmd==='route')mount(b.dataset.route);
    if(cmd==='stage')changeStage(b.dataset.stage);
    if(cmd==='workflow')changeStage(b.dataset.stage,b.dataset.route);
    if(cmd==='monthly'){const target=monthlyLocation||{stage:state.payrollStage,view:employees.length?'results':'upload'};changeStage(target.stage,target.view);}
    if(cmd==='pending'){
      if(!leave())return;
      state.search='';state.dept='全部部门';state.company='全部公司';state.status='全部状态';ui.tab='issues';ui.page=1;mount('results',false);
      const tab=content.querySelector('[data-filter="issues"]');tab?.focus({preventScroll:true});tab?.scrollIntoView({block:'center',behavior:'instant'});
    }
    if(cmd==='person')person(b.dataset.id);
    if(cmd==='next')next(1);if(cmd==='previous')next(-1);
    if(cmd==='format-stage'){if(!leave())return;state.payrollStage=b.dataset.stage;recalculateEmployees();saveBatchData();mount('templates',false);}
    if(cmd==='clear-filters'){state.search='';state.dept='全部部门';state.company='全部公司';state.status='全部状态';ui.tab='all';ui.page=1;mount('results');}
    if(cmd==='filter'){ui.tab=b.dataset.filter;ui.page=1;mount('results');}
    if(cmd==='page'){ui.page+=Number(b.dataset.page);refreshResults();}
    if(cmd==='detailtab'){if(!leave())return;ui.detailTab=b.dataset.tab;mount('slip',false);}
    if(cmd==='edit')edit(b.dataset.field);
    if(cmd==='cancel-edit'){W.clearPreview();ui.draft=null;mount('slip',false);}
    if(cmd==='save'){const d=ui.draft;if(!d)return;const e=W.saveChange(d.employee,d.field,d.value,isDayField(d.field)?'':d.reason);ui.draft=null;state.selectedId=e?.id||state.selectedId;b.disabled=true;const error=await W.flush();mount('slip',false);showToast(error?'当前会话已更新，但本机保存失败：'+error:`已同步${title()}工资表与汇总`,error?6000:2600);}
    if(cmd==='reset'){if(!leave())return;W.resetField(W.selected(),b.dataset.field);mount('slip',false);showToast('已恢复计算或来源值');}
    if(cmd==='undo'){W.undo(b.dataset.id);mount('slip',false);showToast('已撤销，工资表已同步');}
    if(cmd==='review-next'){if(!leave())return;const pool=ui.queue.length?ui.queue.map(k=>employees.find(e=>W.key(e)===k)).filter(Boolean):employees,index=pool.findIndex(e=>e.id===state.selectedId),target=pool[index+1];W.markReviewed(W.selected());if(target){person(target.id);showToast('已核对，已切换下一位');}else{mount('results',false);showToast('本组已核对完成');}}
    if(cmd==='export'){if(!leave())return;if(state.payrollStage==='gross')downloadGross();else downloadCsv();}
    if(cmd==='export-person'){if(!leave())return;downloadSlip();}
    if(cmd==='print-person'){if(!leave())return;if(payrollExportReady())window.print();}
    if(cmd==='calculate'){calculateStage();}
    if(cmd==='new'){if(!leave())return;openModal();}
    if(cmd==='batch'){if(!leave())return;saveBatchData();const batch=state.batches[Number(b.dataset.index)];if(!batch)return;document.getElementById('content').innerHTML=`<div class="wb-page-head"><div><h1>${esc(batch.name)}</h1></div>${action('返回历史批次','batch-back','','btn')}</div><iframe title="月度人员明细" src="/salary-directory?embed=1&month=${encodeURIComponent(batch.month)}&detail=1" style="width:100%;height:75vh;border:0"></iframe>`;}
    if(cmd==='batch-back'){mount('batches',false);}
    if(cmd==='batch-rerun'){if(!leave())return;const batch=state.batches[Number(b.dataset.index)];if(!batch)return;setCurrentBatch(batch);recalculateEmployees();saveBatchData();mount('batches',false);showToast('批次已重新计算');}
    if(cmd==='batch-export'){if(!leave())return;const previous=currentBatch();const batch=state.batches[Number(b.dataset.index)];setCurrentBatch(batch);try{if(state.payrollStage==='gross')downloadGross();else downloadCsv();}finally{setCurrentBatch(previous);mount('batches',false);}}
    if(cmd==='source'){const e=W.selected(),s=W.source(e,ui.draft?.field);dialog(`<h2>数据来源</h2><p>${esc(s.filename||s.label)}${s.sheet?' · '+esc(s.sheet):''}${s.row?' · 第 '+s.row+' 行':''}</p>${s.record?`<table class="wb-table">${Object.entries(s.record).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`:'<p class="wb-muted">此项来自计算结果或示例数据。原始文件不会被修改。</p>'}`);}
    if(cmd==='grossdetail'){if(sourceRows.grossUpload){const selected=W.selected(),e=PayrollEngine.uploadedEmployees(sourceRows.grossUpload).find(x=>W.key(x)===W.key(selected))||selected;dialog(`<h2>上传应发表 · ${esc(e.name)}</h2><p class="wb-muted">当前实发使用上传表。本批次生成应发与此来源分别保留。</p><table class="wb-table">${exportDescriptors(true).map(([label,f])=>`<tr><td>${label}</td><td>${esc(e[f]??'—')}</td></tr>`).join('')}</table>`);}else changeStage('gross');}
    if(cmd==='add'){const gross=state.payrollStage==='gross',e=W.selected();const choices=gross?(e.isIntern?['dailyRate','actualPaidDays','grossTarget']:['otherAdd','otherReduction','transit','otherAllow','meal','sickSubsidy','perfBase','score','grossTarget']):e.isIntern?['netTarget']:['otherDeduct','utility','mealDeduct','netTarget'];dialog(`<h2>${gross?'选择工资项目':'选择代扣或调整'}</h2><div class="wb-shortcuts">${choices.map(f=>action(W.fields[f][0],'choose-field',`data-field="${f}"`,'btn')).join('')}</div>`);}
    if(cmd==='choose-field'){document.querySelector('.wb-dialog')?.close();edit(b.dataset.field);}
    if(cmd==='relink'){const orphans=W.orphaned();dialog(`<h2>关联原有调整</h2><p class="wb-muted">选择此人现在对应的员工。原金额及修改原因会一并保留。</p>${orphans.map((o,i)=>{const pool=o.scope==='netUploaded'?employees:generatedEmployees;return `<div class="wb-history-item"><p>${esc(o.name)} · ${Object.keys(o.values).length} 项调整</p><div class="wb-row"><select class="select" id="relink-${i}">${pool.map(e=>`<option value="${esc(W.key(e))}">${esc(e.name)} · ${esc(e.company)} · ${esc(e.dept)}</option>`).join('')}</select>${action('确认关联','apply-relink',`data-index="${i}"`,'btn btn-primary')}</div></div>`;}).join('')}`);}
    if(cmd==='apply-relink'){const i=Number(b.dataset.index),o=W.orphaned()[i],newKey=document.getElementById('relink-'+i).value;if(!newKey)throw new Error('请选择员工');W.rebind(o.key,o.scope,newKey);document.querySelector('.wb-dialog')?.close();mount('results',false);showToast('原有调整已关联到所选员工');}
    if(cmd==='close-dialog')b.closest('dialog').close();
  }catch(err){const inline=document.getElementById('wbEditError');if(inline)inline.textContent=err.message;else showToast(err.message,5000);}}
  function demo(onlyProfiles=false){const defaults={company:'溯驭技术',subdept:'',status:'在职',join:'2024-01-01',leave:'',base:8000,post:2000,perfBase:1200,score:1,actualPaidDays:22,meal:300,transit:0,otherAllow:0,otherAdd:0,sick:0,personal:0,absent:0,social:800,fund:300,exception:''};
    currentBatch().draftOrigin='demo';
    profiles.splice(0,profiles.length,...[['林晓','研发部',8000],['陈晨','财务部',6400],['许宁','研发部',10500],['周悦','行政部',5500],['方远','销售部',7000],['苏禾','研发部',0]].map(([name,dept,base],i)=>({...defaults,name,dept,base,id:'SY00'+(i+1),...(i===5?{isIntern:true,dailyRate:150}:{} )})));
    if(onlyProfiles)return;
    sourceRows.netSocial=profiles.map(p=>({姓名:p.name,个人总计:800,公司总计:1200}));sourceRows.netFund=profiles.map(p=>({姓名:p.name,个人缴纳:300,公司缴纳:300}));sourceRows.tax=profiles.map(p=>({姓名:p.name,税:200}));sourceRows.afterTax=profiles.map(p=>({姓名:p.name,水电代扣:0,餐费代扣:200,其它代扣:0}));
    state.batches=[{name:monthLabel(currentMonth)+'工资 · 示例批次',company:'溯驭技术',month:currentMonth,workdays:22,status:'已计算',employees:6,sources:12,date:new Date().toISOString().slice(0,10),active:true,draftOrigin:'demo'}];
    recalculateEmployees();saveBatchData();
  }
  function setupModal(){const oldOpen=openModal,oldClose=closeModal,modal=document.getElementById('batchModal');let trigger=null;
    openModal=()=>{trigger=document.activeElement;oldOpen();document.getElementById('batchDays').value=currentWorkdays;document.getElementById('batchMonth').focus();};
    closeModal=()=>{oldClose();trigger?.focus?.();};
    for(const id of ['closeModal','cancelModal'])document.getElementById(id).addEventListener('click',()=>trigger?.focus?.());
    modal.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const list=[...modal.querySelectorAll('button,input,select')].filter(el=>!el.disabled&&el.getClientRects().length),first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}});
    const month=document.getElementById('batchMonth'),name=document.getElementById('batchName');month.addEventListener('change',()=>{if(/^\d{4}-\d{2}$/.test(month.value)&&/^\d{4}年\d+月工资批次$/.test(name.value))name.value=monthLabel(month.value)+'工资批次';});
  }
  async function initialize(){setupModal();document.addEventListener('click',e=>{document.querySelectorAll('.wb-nav-menu[open],.wb-filter-menu[open]').forEach(d=>{if(!d.contains(e.target))d.open=false;});const matches=document.getElementById('employeeMatches');if(matches&&!e.target.closest('.wb-search'))matches.hidden=true;});document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.querySelectorAll('.wb-nav-menu[open],.wb-filter-menu[open]').forEach(d=>d.open=false);const m=document.getElementById('employeeMatches');if(m)m.hidden=true;}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'&&ui.draft){e.preventDefault();document.querySelector('[data-wb=save]')?.click();}});document.title='薪资 · 两阶段算薪工作台';document.querySelector('.topbar').addEventListener('click',handle);content.addEventListener('click',handle);document.body.addEventListener('click',e=>{if(e.target.closest('.wb-dialog'))handle(e);});window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}});
    const restored=await W.restore();if(restored&&!state.liveImport&&currentBatch().draftOrigin!=='empty'&&!currentBatch().workbench?.demoProfiles&&currentBatch().name.includes('示例批次')){demo(true);recalculateEmployees();}saveBatchData();
    const route=window.location.hash.slice(1).split('/').filter(Boolean),validViews=['results','slip','upload','email','batches','mapping','rules','templates','exceptions','directory'],hasRoute=['gross','net'].includes(route[0]),view=hasRoute?route[1]:route[0];
    if(hasRoute){state.payrollStage=route[0];recalculateEmployees();}
    else{state.payrollStage='gross';recalculateEmployees();}
    const selectedId=hasRoute?route[2]:route[1];
    if(selectedId)state.selectedId=decodeURIComponent(selectedId);
    mount(validViews.includes(view)?view:'upload',false);
  }
  function init(){return initializing ||= initialize();}
  function prepareCloud(action){
    if(importSession().busy||state.calculating)throw new Error('资料正在处理，请稍候再操作服务器草稿');
    if(action==='save'&&ui.draft)throw new Error('请先保存或取消当前项目的修改，再保存服务器草稿');
    return action==='restore'?leave():true;
  }
  function cloudRestored(){
    state.search='';state.dept='全部部门';state.company='全部公司';state.status='全部状态';
    ui.tab='all';ui.page=1;ui.detailTab='pay';ui.queue=[];ui.draft=null;
    mount(employees.length?'results':'upload',false);
  }
  if(!globalThis.__PAYROLL_TEST__)init().catch(e=>{content.innerHTML=`<div class="wb-empty"><h2>工作台未能加载</h2><p>${esc(e.message)}</p></div>`;});
  return {ui,results,detail,mount,init,demo,ledger,equation,prepareCloud,cloudRestored};
})();
