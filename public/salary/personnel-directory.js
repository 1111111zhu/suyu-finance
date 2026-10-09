// 人员归集在 3220 工作台内运行；企微通讯录来自同端口只读接口。
globalThis.PersonnelDirectory = (() => {
  const base = '/api/payroll';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const str = value => String(value ?? '').trim();
  const isoDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const monthAgo = count => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth()-count); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };
  const dateTime = value => { const d = value ? new Date(value) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—'; };
  const amount = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const shortAmount = value => { const n=Number(value); return Math.abs(n)>=10000 ? `${(n/10000).toFixed(1)}万` : Math.round(n).toLocaleString('zh-CN'); };
  const isMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  const fields = [
    ['name','姓名'],['employeeNumber','工号'],['company','签约公司'],['dept','一级部门'],
    ['subdept','二级部门'],['thirdDept','三级部门'],['position','职位'],['status','员工状态'],
    ['employmentType','员工类型'],['isIntern','是否实习'],['join','入职日期'],
    ['regularizationDate','转正日期'],['leave','离职日期'],
    ['bankCard','银行卡号（工资条专用）'],['bankName','开户行（工资条专用）']
  ];
  const sensitive = new Set(['bankCard','bankName']);
  const state = {
    initialized:false, loading:false, syncing:false, uploadBusy:false, serviceError:'', actionError:'',
    user:null, directory:null, directorySource:'wecom', wecomConfigured:false, localDirectory:null, events:[], conflicts:[], summary:null, errorBySection:{},
    tab:'current', query:'', departmentId:'', selectedUserid:'', from:monthAgo(11), to:monthAgo(0),
    historicalOnly:false, roster:null, rosterResult:null, linkUserid:'', linkRosterRowId:'', candidates:null, candidateError:'',
    candidateId:'', linkReason:'', lastLoad:0, timer:null, loadId:0
  };
  function redraw() { if(document.getElementById('content')?.dataset?.view === 'directory') globalThis.PayrollWorkbenchUI?.mount('directory',false); }
  async function api(path, options={}) {
    const response=await fetch(base+path,{method:options.method||'GET',headers:{...(options.method?{'Content-Type':'application/json','X-Suyu-Local':'1'}:{})},body:options.body?JSON.stringify(options.body):undefined,cache:'no-store',credentials:'same-origin'});
    const result=await response.json().catch(()=>null);
    if(!response.ok||!result?.ok) throw new Error(result?.error?.message||`人员接口暂不可用（${response.status}）`);
    return result.data;
  }
  function requestKey() {
    if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    if(globalThis.crypto?.getRandomValues) return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
    throw new Error('当前浏览器无法生成安全请求编号');
  }
  function summaryPath() {
    const params=new URLSearchParams({from:state.from,to:state.to});
    if(state.departmentId) params.set('departmentId',state.departmentId);
    if(state.selectedUserid) params.set('userid',state.selectedUserid);
    return '/personnel/payroll-summary?'+params;
  }
  async function load() {
    const loadId=++state.loadId;
    state.loading=true;state.serviceError='';redraw();
    try {
      const directory=await api('/personnel/directory');
      if(loadId!==state.loadId) return;
      state.wecomConfigured=Boolean(directory?.configured);
      state.directory=directory?.syncedAt||!state.localDirectory?directory:state.localDirectory;
      state.directorySource=directory?.syncedAt||!state.localDirectory?'wecom':'local';
      state.lastLoad=Date.now();
      await refreshPeriod();
    } catch(error) {
      if(loadId!==state.loadId) return;
      state.serviceError=error.message;
      if(!state.directory) state.directory={configured:false,syncedAt:null,departments:[],members:[]};
    } finally {if(loadId===state.loadId){state.loading=false;redraw();}}
  }
  async function refreshPeriod() {
    if(!isMonth(state.from)||!isMonth(state.to)||state.from>state.to) {
      state.actionError='请选择有效起止月份，开始月份不能晚于结束月份';redraw();return;
    }
    state.actionError='';state.errorBySection={};
    try {
      state.events=await api('/personnel/events?'+new URLSearchParams({from:state.from,to:state.to}));
    } catch(error) {state.errorBySection.events=error.message;state.events=[];}
    // Wage data remains protected; never substitute unavailable months with zeros.
    state.summary={months:[],people:[]};
    redraw();
  }
  async function sync() {
    if(state.syncing) return;
    state.syncing=true;state.actionError='';redraw();
    try {
      await api('/personnel/directory/sync',{method:'POST',body:{}});
      await load();
      globalThis.showToast?.('企业微信通讯录已同步');
    } catch(error) {state.actionError=error.message;}
    finally {state.syncing=false;redraw();}
  }
  const departments=()=>Array.isArray(state.directory?.departments)?state.directory.departments:[];
  const members=()=>Array.isArray(state.directory?.members)?state.directory.members:[];
  const deptById=()=>new Map(departments().map(dept=>[String(dept.id),dept]));
  const deptName=id=>deptById().get(String(id))?.name||String(id||'未分组');
  const memberDept=member=>(member.departmentIds||[]).map(deptName).join(' / ')||'—';
  function descendantIds(id) {
    if(!id) return null;
    const ids=new Set([String(id)]);let changed=true;
    while(changed) {changed=false;for(const dept of departments()) if(ids.has(String(dept.parentId))&&!ids.has(String(dept.id))) {ids.add(String(dept.id));changed=true;}}
    return ids;
  }
  function visibleMembers() {
    const q=state.query.toLocaleLowerCase('zh-CN'),ids=descendantIds(state.departmentId);
    return members().filter(member=>(!ids||(member.departmentIds||[]).some(id=>ids.has(String(id)))) &&
      (!q||[member.name,member.userid,member.position,memberDept(member)].some(value=>str(value).toLocaleLowerCase('zh-CN').includes(q))));
  }
  function tree() {
    const rows=departments(),ids=new Set(rows.map(row=>String(row.id))),children=new Map();
    for(const row of rows) {
      const parent=String(row.parentId||''), key=parent&&ids.has(parent)&&parent!==String(row.id)?parent:'';
      if(!children.has(key)) children.set(key,[]);
      children.get(key).push(row);
    }
    const branch=(parent,seen=new Set())=>(children.get(parent)||[])
      .slice().sort((a,b)=>Number(b.order||0)-Number(a.order||0)||str(a.name).localeCompare(str(b.name),'zh-CN'))
      .map(dept=>{
        const id=String(dept.id);if(seen.has(id)) return '';
        const next=new Set(seen);next.add(id);
        const count=members().filter(member=>(member.departmentIds||[]).some(item=>String(item)===id)).length;
        return `<li><button type="button" class="${state.departmentId===id?'active':''}" data-pd-dept="${esc(id)}" aria-pressed="${state.departmentId===id}">${esc(dept.name)}<em>${count}</em></button>${children.has(id)?`<ul>${branch(id,next)}</ul>`:''}</li>`;
      }).join('');
    return `<div class="pd-tree"><button type="button" class="${!state.departmentId?'active':''}" data-pd-dept="" aria-pressed="${!state.departmentId}">全部部门 <em>${members().length}</em></button><ul>${branch('')}</ul></div>`;
  }
  function memberTable() {
    const wecom=state.directorySource==='wecom';
    return `<div class="pd-table-wrap"><table class="pd-table"><thead><tr><th>人员</th><th>${wecom?'企微 ID':'工号'}</th><th>部门</th><th>职位</th><th>来源</th></tr></thead><tbody>${visibleMembers().map(member=>`<tr><td><strong>${esc(member.name||'未命名')}</strong></td><td>${esc(wecom?member.userid:member.employeeNumber||'—')}</td><td>${esc(memberDept(member))}</td><td>${esc(member.position||'—')}</td><td>${wecom?'企业微信通讯录':'本地花名册'}</td></tr>`).join('')||'<tr><td colspan="5" class="pd-no-rows">没有符合条件的人员</td></tr>'}</tbody></table></div>`;
  }
  async function openLink(userid,rosterRowId='') {
    const member=members().find(item=>item.userid===userid);if(!member) return;
    state.linkUserid=userid;state.linkRosterRowId=rosterRowId;state.candidates=null;state.candidateError='';state.candidateId='';state.linkReason='';
    state.tab='current';state.departmentId='';state.query='';redraw();
    try {
      const params=new URLSearchParams({name:member.name,asOf:isoDay()});
      const result=await api('/employee-candidates?'+params);
      if(state.linkUserid===userid) {
        const candidates=result?.candidates||[];
        state.candidates=member.employeeId&&!candidates.some(item=>item.employee_id===member.employeeId)
          ? [{employee_id:member.employeeId,name:member.name,employee_number:'企微成员已关联',department:memberDept(member)},...candidates]
          : candidates;
      }
    } catch(error) {state.candidates=[];state.candidateError=error.message;state.actionError=`工资员工候选查询失败：${error.message}`;}
    redraw();
  }
  async function saveLink() {
    const member=members().find(item=>item.userid===state.linkUserid);
    const createNew=state.candidateId==='__new__';
    const candidate=state.candidates?.find(item=>item.employee_id===state.candidateId);
    if(state.candidateError) {state.actionError='候选查询失败；为避免重复建档，请先恢复工资 API 后重新打开关联';redraw();return;}
    if(!member||(!candidate&&!createNew)||!str(state.linkReason)) {state.actionError='请选择已有工资员工或明确新建，并填写关联原因';redraw();return;}
    if(createNew&&member.employeeId) {state.actionError='该企微成员已关联工资员工，不能再次新建';redraw();return;}
    const target=createNew?'新建工资员工记录（请确认此人不是已有员工）':`工资员工“${candidate.name}（${candidate.employee_number||candidate.employee_id}）”`;
    if(!confirm(`确认将企微成员“${member.name}（${member.userid}）”关联到${target}${state.linkRosterRowId?'，并关联所选花名册行':''}？`)) return;
    state.loading=true;state.actionError='';redraw();
    try {
      await api('/personnel/links',{method:'POST',body:{requestKey:requestKey(),userid:member.userid,...(createNew?{createNew:true}:{employeeId:candidate.employee_id}),reason:state.linkReason,
        ...(state.linkRosterRowId?{rosterRowId:state.linkRosterRowId}:{})}});
      state.linkUserid='';state.linkRosterRowId='';state.candidates=null;
      state.directory=await api('/personnel/directory');
      state.conflicts=await api('/personnel/conflicts');
      await refreshPeriod();
      globalThis.showToast?.('身份关联已确认');
    } catch(error) {state.actionError=error.message;}
    finally {state.loading=false;redraw();}
  }
  function headerKey(value) {return str(value).replace(/[\s（）()【】\[\]]/g,'').toLowerCase();}
  function column(index) {let n=index+1,s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
  function uniqueHeaders(raw) {
    const counts=new Map();for(const header of raw) counts.set(headerKey(header),(counts.get(headerKey(header))||0)+1);
    return raw.map((header,index)=>counts.get(headerKey(header))>1?`${str(header)}〔${column(index)}列〕`:str(header));
  }
  function sourceCandidate(workbook, selectedSheet) {
    let best=null;
    for(const sheetName of workbook.SheetNames.filter(globalThis.PayrollEngine.isRosterSheet)) {
      if(selectedSheet && sheetName!==selectedSheet) continue;
      const grid=globalThis.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:null,raw:true,blankrows:false});
      for(let index=0;index<Math.min(grid.length,20);index++) {
        const rawHeaders=(grid[index]||[]).map(str),headers=uniqueHeaders(rawHeaders);
        const mapping=globalThis.PayrollEngine.rosterFieldMap(headers);
        const hasName=!!mapping.map?.name||rawHeaders.some(header=>['姓名','员工姓名','人员姓名','姓名中文'].includes(headerKey(header)));
        if(!hasName) continue;
        const hasData=grid.slice(index+1).some(row=>(row||[]).some(value=>value!==null&&value!==undefined&&str(value)));
        const score=Object.keys(mapping.map||{}).length+(hasData?100:0);
        if(!best||score>best.score) best={sheetName,grid,index,rawHeaders,headers,mapping,score};
      }
    }
    return best;
  }
  function normalizedRows(roster) {
    const result=[];
    const mapping={...roster.mapping,issues:(roster.mapping.issues||[]).filter(issue=>!roster.confirmed.has(issue.field))};
    for(let i=roster.index+1;i<roster.grid.length;i++) {
      const cells=roster.grid[i]||[];
      if(!cells.some(value=>value!==null&&value!==undefined&&str(value))) continue;
      const raw=Object.fromEntries(roster.headers.map((header,index)=>[header,cells[index]??'']));
      const normalized=globalThis.PayrollEngine.normalizeRosterRow(raw,mapping);
      const values={...normalized.values};
      for(const field of sensitive) delete values[field];
      result.push({rowNumber:i+1,values,fieldIssues:normalized.issues||[],fieldSources:normalized.sources||{}});
    }
    return result;
  }
  function mappingIssues(roster) {
    const issues=(roster.mapping.issues||[]).filter(issue=>!roster.confirmed.has(issue.field)),counts=new Map();
    for(const header of roster.rawHeaders) if(header) counts.set(headerKey(header),(counts.get(headerKey(header))||0)+1);
    for(const [header,count] of counts) if(count>1) issues.push({field:'表头',reason:'duplicate',message:`“${header}”出现 ${count} 次，请选择带列号的来源列`});
    return issues;
  }
  function unresolved(roster) {
    const out=new Set();
    for(const issue of roster.issues||[]) if(/ambig|duplic|歧义|重复|多列|冲突/i.test(str(issue.reason)+' '+str(issue.message))&&fields.some(spec=>spec[0]===issue.field)&&!roster.confirmed.has(issue.field)) out.add(issue.field);
    for(const [field,header] of Object.entries(roster.mapping.map||{})) if(/〔[A-Z]+列〕$/.test(str(header))&&!roster.confirmed.has(field)) out.add(field);
    return [...out];
  }
  async function upload(file) {
    if(!file) return;
    if(!globalThis.PayrollEngine.isSpreadsheetFile(file.name)) throw new Error('请选择 Excel 或 CSV 花名册');
    if(file.size>20*1024*1024) throw new Error('花名册不能超过 20 MB');
    if(!globalThis.XLSX||!globalThis.PayrollEngine?.rosterFieldMap||!globalThis.PayrollEngine?.normalizeRosterRow) throw new Error('工资条共用字段匹配组件尚未加载');
    const bytes=await file.arrayBuffer(),workbook=globalThis.PayrollEngine.readSpreadsheet(globalThis.XLSX,bytes,file.name,{cellDates:true});
    const candidate=sourceCandidate(workbook);
    if(!candidate) throw new Error('在职或离职子表未识别到姓名表头，请检查花名册');
    if(!globalThis.crypto?.subtle) throw new Error('浏览器不能计算文件校验值，请通过可信地址打开网站');
    const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
    const sha256=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
    const roster={...candidate,workbook,fileName:file.name,sha256,month:state.to,confirmed:new Set()};
    roster.issues=mappingIssues(roster);roster.unresolved=unresolved(roster);roster.rows=normalizedRows(roster);
    state.roster=roster;state.rosterResult=null;state.tab='roster';state.actionError='';redraw();
  }
  function chooseMap(field,header) {
    const roster=state.roster;if(!roster) return;
    roster.mapping={...roster.mapping,map:{...roster.mapping.map,[field]:header||undefined}};
    roster.confirmed.add(field);roster.issues=mappingIssues(roster);roster.unresolved=unresolved(roster);roster.rows=normalizedRows(roster);redraw();
  }
  function rosterRowsForApi(roster) {
    return roster.rows.filter(row=>str(row.values.name)).map(row=>({
      rowNumber:row.rowNumber,name:str(row.values.name),employeeNumber:str(row.values.employeeNumber)||null,
      company:str(row.values.company)||null,department:str(row.values.dept)||null,
      subdepartment:str(row.values.subdept)||null,thirdDepartment:str(row.values.thirdDept)||null,position:str(row.values.position)||null,
      employeeType:str(row.values.employmentType)||(row.values.isIntern===true?'实习':null),employeeStatus:str(row.values.status)||null,
      joinedOn:str(row.values.join)||null,regularizationOn:str(row.values.regularizationDate)||null,
      leftOn:str(row.values.leave)||null,
      fieldSources:Object.fromEntries(Object.entries(row.fieldSources).filter(([field])=>!sensitive.has(field)))
    }));
  }
  function activateLocalRoster(roster) {
    const departmentIds=new Map(),departments=[];
    const departmentId=name=>{
      const key=str(name)||'未分组';
      if(!departmentIds.has(key)) {const id=`roster-dept-${departmentIds.size+1}`;departmentIds.set(key,id);departments.push({id,name:key,parentId:null,order:departmentIds.size});}
      return departmentIds.get(key);
    };
    const members=roster.rows.filter(row=>str(row.values.name)).map(row=>{
      const values=row.values,dept=[values.dept,values.subdept,values.thirdDept].filter(Boolean).join(' / ')||'未分组';
      return {userid:`roster-${row.rowNumber}`,name:str(values.name),employeeNumber:str(values.employeeNumber),departmentIds:[departmentId(dept)],position:str(values.position),status:str(values.status)||'花名册记录'};
    });
    state.localDirectory={configured:true,syncedAt:null,fresh:false,departments,members};
    if(!state.directory?.syncedAt) {state.directory=state.localDirectory;state.directorySource='local';}
    state.events=[];state.conflicts=[];state.summary={months:[],people:[]};
  }
  async function saveRoster() {
    const roster=state.roster;if(!roster?.rows.length||!roster.mapping.map?.name||roster.unresolved.length) return;
    if(!isMonth(roster.month)) {state.actionError='请选择有效的花名册计薪月';redraw();return;}
    const blocking=roster.rows.flatMap(row=>row.fieldIssues||[]).filter(issue=>!sensitive.has(issue.field)&&(['invalid','conflict','text-required'].includes(issue.reason)||issue.field==='name'));
    if(blocking.length) {state.actionError=`花名册有 ${blocking.length} 项无效或冲突字段，请先修正原文件或映射后再导入`;redraw();return;}
    state.uploadBusy=true;state.actionError='';redraw();
    activateLocalRoster(roster);
    state.rosterResult={rowCount:state.localDirectory.members.length,conflictCount:0};
    state.uploadBusy=false;
    globalThis.showToast?.('花名册已在当前浏览器归集');
    redraw();
  }
  function statusBanner() {
    const directory=state.directory;
    if(state.serviceError) return `<div class="pd-banner error"><strong>通讯录读取失败</strong><span>${esc(state.serviceError)}</span></div>`;
    if(state.directorySource==='local') return `<div class="pd-banner warning"><strong>当前显示本地花名册，不是企业微信数据</strong><span>共 ${members().length} 人；配置企微只读应用并成功同步后，会切换到企微通讯录。</span></div>`;
    if(!directory?.configured) return '<div class="pd-banner warning"><strong>企业微信尚未接入</strong><span>需要在 3220 服务端配置 CorpID 和通讯录只读 Secret；配置前不会展示模拟人员，也不需要管理员登录。</span></div>';
    if(!directory.syncedAt) return `<div class="pd-banner warning"><strong>等待首次企业微信同步</strong><span>${esc(directory.lastError||'可点击“同步企微”获取当前通讯录。')}</span></div>`;
    const cls=directory.lastError||!directory.fresh?'warning':'good';
    return `<div class="pd-banner ${cls}"><strong>企业微信通讯录 · ${esc(dateTime(directory.syncedAt))}</strong><span>共 ${members().length} 人、${departments().length} 个部门。${directory.lastError?`最近一次同步失败：${esc(directory.lastError)}`:directory.fresh?'数据在更新周期内。':'数据可能已过期，请重新同步。'}</span></div>`;
  }
  function currentSection() {
    const directory=state.directory;
    if(!directory?.configured) return '<div class="pd-empty"><strong>等待企业微信通讯录</strong><p>配置只读应用后从本页同步；辅助花名册仅供本地核对，不会冒充企微人员。</p></div>';
    if(state.directorySource==='wecom'&&!directory.syncedAt) return '<div class="pd-empty"><strong>尚无成功的企业微信快照</strong><p>请先处理上方同步错误，再点击“同步企微”；当前人数未知，不按 0 人处理。</p></div>';
    return `<div class="pd-directory-layout"><aside class="pd-departments"><h2>${state.directorySource==='wecom'?'企微部门':'花名册部门'}</h2>${tree()}</aside><div class="pd-directory-main"><div class="pd-toolbar"><label>搜索人员<input class="input" id="pdSearch" value="${esc(state.query)}" placeholder="姓名、${state.directorySource==='wecom'?'企微 ID':'工号'}、部门或职位" autocomplete="off"></label><span>显示 ${visibleMembers().length} / ${members().length} 人</span></div>${memberTable()}</div></div>`;
  }
  function linkPanel() {
    if(!state.linkUserid) return '';
    const member=members().find(item=>item.userid===state.linkUserid),list=state.candidates;
    const existing=list?.map(item=>`<label><input type="radio" name="pdCandidate" value="${esc(item.employee_id)}" ${state.candidateId===item.employee_id?'checked':''}><span><strong>${esc(item.name)}</strong><small>${esc(item.employee_number||'无工号')} · ${esc(item.department||'未填写部门')} · ${esc(item.employee_id)}</small></span></label>`).join('')||'';
    const create=member&&!member.employeeId&&!state.candidateError?`<label class="pd-create-choice"><input type="radio" name="pdCandidate" value="__new__" ${state.candidateId==='__new__'?'checked':''}><span><strong>新建工资员工记录并关联</strong><small>仅用于确认这是新的工资库人员；请先排除同名或已有员工记录，避免重复建档。</small></span></label>`:'';
    const choices=state.candidateError?`<p class="pd-warning">候选查询失败：${esc(state.candidateError)}。恢复连接前不能安全关联或新建。</p>`:
      list===null?'<p class="pd-muted">正在查找工资库候选…</p>':`<div class="pd-candidates">${existing}${create}</div>`;
    return `<section class="pd-link-panel" aria-label="工资员工身份关联"><div class="pd-section-head"><div><h3>确认关联：${esc(member?.name||state.linkUserid)}</h3><p>姓名只用于查找候选，不会自动关联或新建；请选择工资库员工或明确新建，并填写原因。</p></div><button type="button" class="btn" data-pd-link-cancel>取消</button></div>${choices}<label class="pd-reason">关联原因<input class="input" id="pdLinkReason" maxlength="300" placeholder="例如：核对工号和签约公司后确认" value="${esc(state.linkReason)}"></label><button type="button" class="btn btn-primary" data-pd-link-save ${list===null||state.candidateError?'disabled':''}>确认关联</button></section>`;
  }
  function eventName(event) {return event.after?.name||event.before?.name||members().find(item=>item.userid===event.userid)?.name||event.userid||'未知成员';}
  function eventValue(value) {
    if(value==null) return '无';
    if(typeof value!=='object') return String(value);
    const department=value.departmentName||value.department||(value.departmentIds||[]).map(deptName).join(' / ');
    return [value.name,department,value.position,value.status].filter(Boolean).join(' / ')||'资料已变更';
  }
  function eventsSection() {
    const currentIds=new Set(members().map(item=>item.userid)),q=state.query.toLocaleLowerCase('zh-CN');
    const list=state.events.filter(item=>(!state.historicalOnly||!currentIds.has(item.userid))&&
      (!q||[eventName(item),item.userid,item.label,item.reason].some(value=>str(value).toLocaleLowerCase('zh-CN').includes(q))));
    const cards=list.map(item=>{
      const roster=item.source==='花名册'||item.type==='regularization_recorded';
      const when=roster&&item.effectiveOn?`${item.effectiveOn}（花名册记载）`:dateTime(item.eventAt||item.detectedAt);
      const source=roster?`花名册：${item.sourceDetail?.fileName||'未命名文件'} / ${item.sourceDetail?.sheetName||'工作表'} / 第 ${item.sourceDetail?.rowNumber||'—'} 行 · 导入记录于 ${dateTime(item.detectedAt)}`:
        `上次同步：${dateTime(item.previousSyncedAt)} · 本次同步：${dateTime(item.currentSyncedAt)}`;
      return `<article class="pd-event"><span class="pd-event-dot" aria-hidden="true"></span><div><div class="pd-event-top"><span class="pd-tag pd-event-type">${esc(item.label||item.type||'变动')}</span><strong>${esc(eventName(item))}</strong><small>${esc(item.userid||'')}</small><time>${esc(when)}</time></div><p>${esc(item.reason||'相邻企微快照出现差异')}</p>${roster?'':`<div class="pd-event-values">变动前：${esc(eventValue(item.before))}　→　变动后：${esc(eventValue(item.after))}</div>`}<small class="pd-muted">${esc(source)}</small></div></article>`;
    }).join('');
    return `<section class="pd-card"><div class="pd-section-head"><div><h2>人员异动记录</h2><p>企微异动按系统发现时间留痕；花名册转正日期单独标注来源，首次同步不倒推历史。</p></div><label class="pd-check"><input id="pdHistoricalOnly" type="checkbox" ${state.historicalOnly?'checked':''}> 仅看已不在当前通讯录者</label></div><div class="pd-event-search"><label>搜索历史人员<input class="input" id="pdEventSearch" value="${esc(state.query)}" placeholder="姓名、企微 ID 或变动原因" autocomplete="off"></label><button class="btn" type="button" data-pd-event-search>搜索</button></div>${state.errorBySection.events?`<p class="pd-warning">${esc(state.errorBySection.events)}</p>`:''}<div class="pd-event-list">${cards||'<div class="pd-empty compact"><strong>所选月份暂无异动记录</strong><p>可调整月份，或等待下一次成功的通讯录同步。</p></div>'}</div></section>`;
  }
  function safeConflict(field,value) {return /bank|card|账户|银行卡/i.test(str(field))?'••••（人员页不展示）':str(value)||'未提供';}
  function conflictsSection() {
    const list=state.conflicts;
    const cards=list.map(item=>{
      const src=item.rosterSource||{},source=typeof src==='object'
        ? `${src.fileName||'花名册'} / ${src.sheetName||'工作表'} / 第 ${src.rowNumber||item.rowNumber||'—'} 行`
        : `${src} / 第 ${item.rowNumber||'—'} 行`;
      const link=item.field==='identity'&&item.rosterRowId&&members().length
        ? `<div class="pd-conflict-link"><label>手动选择对应企微成员<select class="select" data-pd-roster-select="${esc(item.rosterRowId)}"><option value="">请选择成员</option>${members().slice().sort((a,b)=>str(a.name).localeCompare(str(b.name),'zh-CN')).map(member=>`<option value="${esc(member.userid)}">${esc(member.name)} · ${esc(member.userid)}</option>`).join('')}</select></label><button class="btn" type="button" data-pd-roster-link="${esc(item.rosterRowId)}">核对工资身份并关联此行</button></div>`
        : '';
      return `<article class="pd-conflict"><div class="pd-conflict-top"><strong>${esc(item.reason||'来源不一致')}</strong><span>${esc(item.field||'身份')}</span></div><p>花名册：<b>${esc(safeConflict(item.field,item.rosterValue))}</b>　·　企微：<b>${esc(safeConflict(item.field,item.wecomValue))}</b></p><small>${esc(source)} · ${esc(item.wecomSource||'企微通讯录')} · 同步于 ${esc(dateTime(item.wecomSyncedAt))}</small>${link}</article>`;
    }).join('');
    return `<section class="pd-card"><div class="pd-section-head"><div><h2>花名册核对提示</h2><p>企微当前状态优先；逐项列出来源、原值和判断原因，不自动覆盖。</p></div><span class="pd-count">${list.length} 项</span></div>${state.errorBySection.conflicts?`<p class="pd-warning">${esc(state.errorBySection.conflicts)}</p>`:''}${list.length?`<div class="pd-conflict-list">${cards}</div>`:'<div class="pd-empty compact"><strong>暂无冲突提示</strong><p>上传花名册并完成企微同步后，这里显示需要核对的差异。</p></div>'}</section>`;
  }
  function chart(months) {
    const valid=months.filter(item=>!item.missing&&item.totalNet!==null);
    if(!valid.length) return '<div class="pd-empty compact"><strong>所选月份无已确认工资</strong><p>未确认或缺失月份不计为 0。</p></div>';
    const width=Math.max(700,months.length*82+80),top=26,bottom=200,height=254;
    const maxBar=Math.max(1,...valid.map(item=>Number(item.totalNet)||0)),maxLine=Math.max(1,...valid.map(item=>Number(item.cumulativeNet)||0));
    const x=i=>44+i*(width-84)/Math.max(1,months.length-1);
    const yBar=value=>bottom-(Number(value)||0)/maxBar*(bottom-top);
    const yLine=value=>bottom-(Number(value)||0)/maxLine*(bottom-top);
    const points=months.map((item,index)=>item.missing||item.cumulativeNet===null?null:[x(index),yLine(item.cumulativeNet),item]);
    const segments=[];let segment=[];
    for(const point of points) {if(point) segment.push(point);else if(segment.length){segments.push(segment);segment=[];}}
    if(segment.length) segments.push(segment);
    const grid=[0,.5,1].map(rate=>`<line x1="34" x2="${width-30}" y1="${bottom-rate*(bottom-top)}" y2="${bottom-rate*(bottom-top)}" class="pd-chart-grid"/><text x="4" y="${bottom-rate*(bottom-top)+4}" class="pd-chart-axis">${esc(shortAmount(maxBar*rate))}</text>`).join('');
    return `<div class="pd-chart-scroll"><svg class="pd-chart" viewBox="0 0 ${width} ${height}" style="min-width:${width}px" role="img" aria-label="月度实发总额柱状图与区间累计实发折线图">${grid}${months.map((item,index)=>item.missing?`<text x="${x(index)}" y="${bottom-8}" text-anchor="middle" class="pd-chart-missing">缺</text>`:`<rect x="${x(index)-17}" y="${yBar(item.totalNet)}" width="34" height="${Math.max(0,bottom-yBar(item.totalNet))}" rx="5" class="pd-chart-bar"><title>${esc(item.month)} 月度实发 ¥${esc(amount(item.totalNet))}</title></rect>`).join('')}${segments.map(list=>`<polyline points="${list.map(point=>point[0]+','+point[1]).join(' ')}" class="pd-chart-line"/>`).join('')}${points.filter(Boolean).map(point=>`<circle cx="${point[0]}" cy="${point[1]}" r="4.5" class="pd-chart-point"><title>${esc(point[2].month)} 区间累计实发 ¥${esc(amount(point[2].cumulativeNet))}</title></circle>`).join('')}${months.map((item,index)=>`<text x="${x(index)}" y="${height-24}" text-anchor="middle" class="pd-chart-month">${esc(item.month)}</text>`).join('')}</svg></div><div class="pd-legend"><span><i class="pd-legend-bar"></i> 月度实发总额（左轴）</span><span><i class="pd-legend-line"></i> 区间累计实发（悬停各点看金额）</span></div>`;
  }
  function payrollSection() {
    const summary=state.summary||{},months=Array.isArray(summary.months)?summary.months:[],people=Array.isArray(summary.people)?summary.people:[];
    return `<section class="pd-card"><div class="pd-section-head"><div><h2>跨月实发归集</h2><p>${esc(state.from)} 至 ${esc(state.to)}（含首尾月份） · 只统计已确认的当前工资版本，按员工 ID 去重。</p></div>${state.selectedUserid?'<button class="btn" type="button" data-pd-clear-person>清除人员筛选</button>':''}</div>${state.errorBySection.payroll?`<p class="pd-warning">${esc(state.errorBySection.payroll)}</p>`:''}${chart(months)}<div class="pd-table-wrap"><table class="pd-table"><thead><tr><th>月份</th><th class="pd-number">实发总额</th><th class="pd-number">计薪人数</th><th class="pd-number">人均实发</th><th class="pd-number">区间累计实发</th></tr></thead><tbody>${months.map(item=>`<tr><td>${esc(item.month)}</td>${item.missing?'<td colspan="4" class="pd-missing">无已确认数据（不计为 0）</td>':`<td class="pd-number">¥ ${esc(amount(item.totalNet))}</td><td class="pd-number">${esc(item.headcount)}</td><td class="pd-number">¥ ${esc(amount(item.averageNet))}</td><td class="pd-number">¥ ${esc(amount(item.cumulativeNet))}</td>`}</tr>`).join('')||'<tr><td colspan="5" class="pd-no-rows">选择月份并查询正式工资</td></tr>'}</tbody></table></div><h3 class="pd-subtitle">员工区间累计实发</h3><div class="pd-table-wrap"><table class="pd-table"><thead><tr><th>员工</th><th>工资条部门快照</th><th class="pd-number">累计实发</th><th>逐月明细</th></tr></thead><tbody>${people.map(person=>`<tr><td><strong>${esc(person.name||person.userid||person.employeeId)}</strong><small>${esc(person.userid||person.employeeId||'')}</small></td><td>${esc(person.dept||'—')}</td><td class="pd-number">¥ ${esc(amount(person.totalNet))}</td><td class="pd-month-detail">${(person.months||[]).map(item=>item.missing?`<span>${esc(item.month)}：无数据</span>`:`<span>${esc(item.month)}：¥ ${esc(amount(item.net))}</span>`).join('')||'—'}</td></tr>`).join('')||'<tr><td colspan="4" class="pd-no-rows">当前筛选没有已确认的员工实发记录</td></tr>'}</tbody></table></div></section>`;
  }
  function rosterPreview() {
    const roster=state.roster,map=roster.mapping.map||{},issues=roster.issues||[],rowIssues=roster.rows.flatMap(row=>row.fieldIssues||[]);
    return `<div class="pd-roster-meta"><strong>${esc(roster.fileName)}</strong><label>工作表<select class="select" data-pd-sheet aria-label="花名册工作表">${roster.workbook.SheetNames.filter(globalThis.PayrollEngine.isRosterSheet).map(name=>`<option value="${esc(name)}" ${name===roster.sheetName?'selected':''}>${esc(name)}</option>`).join('')}</select></label><span>工作表：${esc(roster.sheetName)} · 表头第 ${roster.index+1} 行 · ${roster.rows.length} 条人员行 · 实习生 ${roster.rows.filter(row=>row.values.isIntern===true).length} 人</span></div><div class="pd-mapping"><table class="pd-table"><thead><tr><th>工资条字段</th><th>来源表头（可手动确认）</th><th>状态</th></tr></thead><tbody>${fields.map(([field,label])=>`<tr><td>${esc(label)}</td><td><select class="select" data-pd-map="${esc(field)}" aria-label="${esc(label)}来源表头"><option value="">不导入此字段</option>${roster.headers.map(header=>`<option value="${esc(header)}" ${map[field]===header?'selected':''}>${esc(header)}</option>`).join('')}</select></td><td>${sensitive.has(field)?'<span class="pd-muted">工资条专用 · 原值不上传</span>':roster.unresolved.includes(field)?'<span class="pd-warning">请确认来源列</span>':map[field]?'<span class="pd-linked">已匹配</span>':'<span class="pd-muted">未提供</span>'}</td></tr>`).join('')}</tbody></table></div>${issues.length||rowIssues.length?`<div class="pd-issues"><strong>字段核对提示</strong><ul>${[...issues,...rowIssues].slice(0,24).map(issue=>`<li>${esc(issue.message||issue.reason||'字段值待确认')}${issue.field?`（${esc(issue.field)}）`:''}</li>`).join('')}</ul>${issues.length+rowIssues.length>24?`<p>另有 ${issues.length+rowIssues.length-24} 项，正式工资确认前仍需核对。</p>`:''}</div>`:''}<div class="pd-preview"><h3>预览（不显示银行卡原值）</h3><div class="pd-table-wrap"><table class="pd-table"><thead><tr><th>行</th><th>姓名 / 工号</th><th>签约公司</th><th>部门</th><th>状态 / 类型</th><th>转正日期</th></tr></thead><tbody>${roster.rows.slice(0,5).map(row=>`<tr><td>${row.rowNumber}</td><td>${esc(row.values.name||'—')}<small>${esc(row.values.employeeNumber||'—')}</small></td><td>${esc(row.values.company||'—')}</td><td>${esc([row.values.dept,row.values.subdept,row.values.thirdDept].filter(Boolean).join(' / ')||'—')}</td><td>${esc([row.values.status,row.values.employmentType].filter(Boolean).join(' / ')||'—')}</td><td>${esc(row.values.regularizationDate||'—')}</td></tr>`).join('')||'<tr><td colspan="6" class="pd-no-rows">表头已找到，但没有人员行</td></tr>'}</tbody></table></div></div><div class="pd-roster-actions"><p>请确认有歧义的来源列。原 Excel 只读，银行卡原值不传入人员归集。</p><button class="btn btn-primary" type="button" data-pd-roster-save ${!roster.rows.length||!map.name||roster.unresolved.length||state.uploadBusy?'disabled':''}>${state.uploadBusy?'正在导入…':'确认导入辅助花名册'}</button></div>`;
  }
  function rosterSection() {
    const month=state.roster?`<div class="pd-roster-month"><label>花名册计薪月<input id="pdRosterMonth" class="input" type="month" value="${esc(state.roster.month)}"></label><span>转正日期等字段按这一计薪月核对；不要用今天的企微状态改写历史工资条。</span></div>`:'';
    return `<section class="pd-card"><div class="pd-section-head"><div><h2>辅助花名册与工资条字段</h2><p>使用工资条共用表头词典，不按列位置；仅在当前浏览器核对字段，银行卡及开户行原值不进入人员归集。</p></div><div><input id="pdFile" type="file" accept="${globalThis.PayrollEngine.spreadsheetAccept}" hidden><button class="btn btn-primary" type="button" data-pd-upload>选择 Excel 花名册</button></div></div>${state.rosterResult?`<p class="pd-success">已读取 ${esc(state.rosterResult.rowCount||0)} 行辅助花名册 · ${esc(state.rosterResult.conflictCount||0)} 项提示。企微当前人员未被覆盖。</p>`:''}${month}${state.roster?rosterPreview():'<div class="pd-empty compact"><strong>尚未选择花名册</strong><p>选择后可检查字段映射、缺失和歧义；不需要管理员登录。</p></div>'}</section>`;
  }
  function render() {
    const directory=state.directory,hasPeople=state.directorySource==='local'||Boolean(directory?.syncedAt),tabs=[['current','当前人员',hasPeople?members().length:null],['events','异动记录',state.events.length],['conflicts','冲突提示',state.conflicts.length],['payroll','跨月工资',null],['roster','辅助花名册',null]];
    const body=state.tab==='current'?currentSection():state.tab==='events'?eventsSection():state.tab==='conflicts'?conflictsSection():state.tab==='payroll'?payrollSection():rosterSection();
    const currentSource=state.directorySource==='wecom'?'企微':'本地';
    return `<div class="pd-page"><div class="wb-page-head"><div><h1>人员归集</h1><p>在统一 3220 工作台中查看企业微信只读通讯录与人员异动。</p></div><div class="wb-actions"><button class="btn" type="button" data-pd-sync ${!state.wecomConfigured||state.syncing?'disabled':''}>${state.syncing?'正在同步…':'同步企微'}</button><button class="btn btn-primary" type="button" data-pd-open-roster>导入花名册</button></div></div>${statusBanner()}${state.actionError?`<div class="pd-banner error" role="alert">${esc(state.actionError)}</div>`:''}<div class="pd-metrics"><div><span>当前${currentSource}人员</span><strong>${hasPeople?members().length:'—'}</strong></div><div><span>${currentSource}部门</span><strong>${hasPeople?departments().length:'—'}</strong></div><div><span>所选区间异动</span><strong>${state.events.length}</strong></div><div><span>待核对提示</span><strong>${state.conflicts.length}</strong></div></div><section class="pd-panel"><div class="pd-period"><label>从<input class="input" id="pdFrom" type="month" value="${esc(state.from)}"></label><label>到<input class="input" id="pdTo" type="month" value="${esc(state.to)}"></label><button class="btn" type="button" data-pd-period>查询区间</button><span>跨年范围含首尾月份；未导入实发结果的月份不会显示为 0。</span></div><div class="pd-tabs" role="tablist" aria-label="人员归集内容">${tabs.map(([id,label,count])=>`<button type="button" role="tab" aria-selected="${state.tab===id}" class="${state.tab===id?'active':''}" data-pd-tab="${id}">${label}${count===null?'':`<em>${count}</em>`}</button>`).join('')}</div>${body}</section></div>`;
  }
  function bind(entered=false) {
    const root=document.getElementById('content');if(!root) return;
    if(!state.initialized) {
      state.initialized=true;
      queueMicrotask(()=>load());
    } else if(entered) queueMicrotask(()=>load());
    root.querySelector('[data-pd-sheet]')?.addEventListener('change',event=>{
      const previous=state.roster,candidate=sourceCandidate(previous.workbook,event.target.value);
      if(!candidate) {state.actionError='所选工作表未识别到姓名表头，请选择人员工作表';redraw();return;}
      const roster={...previous,...candidate,confirmed:new Set()};
      roster.issues=mappingIssues(roster);roster.unresolved=unresolved(roster);roster.rows=normalizedRows(roster);
      state.roster=roster;state.rosterResult=null;state.actionError='';redraw();
    });
    root.querySelector('[data-pd-open-roster]')?.addEventListener('click',()=>{state.tab='roster';redraw();});
    root.querySelector('[data-pd-sync]')?.addEventListener('click',sync);
    root.querySelectorAll('[data-pd-tab]').forEach(button=>button.addEventListener('click',()=>{state.tab=button.dataset.pdTab;redraw();}));
    root.querySelectorAll('[data-pd-dept]').forEach(button=>button.addEventListener('click',()=>{state.departmentId=button.dataset.pdDept;redraw();refreshPeriod();}));
    root.querySelector('#pdSearch')?.addEventListener('input',event=>{state.query=event.target.value;const target=root.querySelector('.pd-directory-main .pd-table-wrap');if(target) target.outerHTML=memberTable();});
    root.querySelector('.pd-directory-main')?.addEventListener('click',event=>{
      const link=event.target.closest('[data-pd-link]'),person=event.target.closest('[data-pd-person]');
      if(link) openLink(link.dataset.pdLink);
      if(person) {state.selectedUserid=person.dataset.pdPerson;state.tab='payroll';redraw();refreshPeriod();}
    });
    root.querySelector('#pdHistoricalOnly')?.addEventListener('change',event=>{state.historicalOnly=event.target.checked;redraw();});
    root.querySelector('[data-pd-event-search]')?.addEventListener('click',()=>{state.query=root.querySelector('#pdEventSearch')?.value||'';redraw();});
    root.querySelector('#pdEventSearch')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();state.query=event.target.value;redraw();}});
    root.querySelectorAll('[data-pd-roster-link]').forEach(button=>button.addEventListener('click',()=>{
      const rosterRowId=button.dataset.pdRosterLink;
      const userid=root.querySelector(`[data-pd-roster-select="${rosterRowId}"]`)?.value;
      if(!userid) {state.actionError='请先选择对应的企微成员，再核对工资员工身份';redraw();return;}
      openLink(userid,rosterRowId);
    }));
    root.querySelector('#pdFrom')?.addEventListener('change',event=>{state.from=event.target.value;});
    root.querySelector('#pdTo')?.addEventListener('change',event=>{state.to=event.target.value;});
    root.querySelector('[data-pd-period]')?.addEventListener('click',refreshPeriod);
    root.querySelector('[data-pd-clear-person]')?.addEventListener('click',()=>{state.selectedUserid='';refreshPeriod();});
    root.querySelector('[data-pd-link-cancel]')?.addEventListener('click',()=>{state.linkUserid='';state.linkRosterRowId='';state.candidates=null;redraw();});
    root.querySelectorAll('[name=pdCandidate]').forEach(input=>input.addEventListener('change',event=>{state.candidateId=event.target.value;}));
    root.querySelector('#pdLinkReason')?.addEventListener('input',event=>{state.linkReason=event.target.value;});
    root.querySelector('[data-pd-link-save]')?.addEventListener('click',saveLink);
    root.querySelector('[data-pd-upload]')?.addEventListener('click',()=>root.querySelector('#pdFile')?.click());
    root.querySelector('#pdFile')?.addEventListener('change',event=>upload(event.target.files?.[0]).catch(error=>{state.actionError=error.message;redraw();}));
    root.querySelector('#pdRosterMonth')?.addEventListener('change',event=>{if(state.roster) state.roster.month=event.target.value;});
    root.querySelectorAll('[data-pd-map]').forEach(select=>select.addEventListener('change',event=>chooseMap(event.target.dataset.pdMap,event.target.value)));
    root.querySelector('[data-pd-roster-save]')?.addEventListener('click',saveRoster);
  }
  return {data:state,render,bind,upload,load,sync,api,normalizedRows,rosterRowsForApi};
})();
