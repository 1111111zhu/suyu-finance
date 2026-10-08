/* Shared browser/Node payroll data rules. No file, network or UI side effects. */
globalThis.PayrollEngine = (() => {
  const fields = [
    ['姓名','name','text',['员工姓名']],['公司','company','text',['签约公司']],['一级部门','dept','text',['部门','一级部门名称']],
    ['二级部门','subdept','text',['二级部门名称']],['银行卡号','bankCard','text',['银行卡']],['开户行','bankName','text',['银行','开户银行']],
    ['是否入离职','status','text',['员工状态','在职状态','入离职状态']],['入职日期','join','date',['入职时间','入职日']],['离职日期','leave','date',['离职时间','离职日']],
    ['应发薪','workdays','number',['应发薪天数']],['实际出勤天数','payableDays','number',['实发薪天数']],
    ['基本工资','base','money',['工资基数']],['岗位工资','post','money'],['绩效基数','perfBase','money'],
    ['绩效分数','effectiveScore','number',['绩效系数']],['绩效工资','performancePay','money'],['工资小计','subtotal','money'],
    ['餐饮津贴','meal','money',['餐补合计']],['交通津贴','transit','money',['交通补贴']],
    ['其他津贴','otherAllow','money'],['病假补贴','sickSubsidy','money'],['其他加','otherAdd','money'],
    ['年假天数','annual','number',['年假(天)']],['弹性假天数','flexible','number',['弹性假(天)']],
    ['调休假天数','compensatory','number',['调休假(天)']],['病假天数','sick','number',['病假(天)']],
    ['事假天数','personal','number',['事假(天)']],['旷工天数','absent','number',['旷工(天)']],
    ['假勤扣薪天数','deductDays','number'],['假勤扣款','attendanceDeduct','money'],['其他减','otherReduction','money'],
    ['应发工资','gross','money'],['个人社保','social','money',['个人总计']],['个人公积金','fund','money',['个人缴纳']],
    ['是否实习生','isIntern','intern',['是否实习','实习标识','本月是否为实习生','实习']],['日薪','dailyRate','money'],
    ['转正日期','regularizationDate','date',['转正日','转正时间']],
    ['转正前应出勤天数','probationWorkdays','number',['试用期应出勤天数','转正前出勤天数','试用期计薪天数']],
    ['转正后应出勤天数','regularWorkdays','number',['转正后出勤天数','转正后计薪天数']],
    ['转正前工资','probationSalary','money'],['转正后工资','regularSalary','money'],
    ['转正前工资小计','probationSubtotal','money'],['转正后工资小计','regularSubtotal','money']
  ];
  const netFields = [
    ['其它代扣','otherDeduct','money',['其他代扣']],['水电代扣','utility','money',['员工宿舍水电费代扣','水电费代扣','水电费合计']],
    ['餐费代扣','mealDeduct','money',['餐费合计']],['个税','tax','money',['税','个人所得税','税额']],
    ['税后代扣合计','afterTaxTotal','money'],['实发工资','net','money'],
    ['公司缴纳社保','companySocial','money',['公司总计','公司总计（社保）']],
    ['公司缴纳公积金','companyFund','money',['公司缴纳','公司缴纳（公积金）']],['公司总成本','companyCost','money'],['备注','remark','text']
  ];
  const key = value => String(value ?? '').trim().replace(/\s+/g,'').replace(/（/g,'(').replace(/）/g,')');
  // A roster is mapped by explicit labels, never by column order or fuzzy substrings.
  // Keep salary-facing aliases in fields/netFields in sync with database/payroll/fields.mjs.
  const rosterFields = Object.freeze([
    ['name','姓名',['员工姓名']],
    ['employeeNumber','工号',['员工编号','员工工号']],
    ['company','公司',['签约公司']],
    ['dept','一级部门',['一级部门名称','部门']],
    ['subdept','二级部门',['二级部门名称']],
    ['thirdDept','三级部门',['三级部门名称']],
    ['position','职位',['岗位','岗位名称','职务']],
    ['status','是否入离职',['员工状态','在职状态','入离职状态']],
    ['employmentType','员工类型',['人员类型','用工类型','员工类别']],
    ['isIntern','是否实习生',['是否实习','实习标识','本月是否为实习生','实习']],
    ['join','入职日期',['入职时间','入职日']],
    ['leave','离职日期',['离职时间','离职日']],
    ['contractEnd','劳动合同止',['劳动合同终止日期','劳动合同结束日期','合同到期日']],
    ['regularizationDate','转正日期',['转正日','转正时间']],
    ['bankCard','银行卡号',['银行卡']],
    ['bankName','开户行',['开户银行','银行']]
  ]);
  const nameKey = value => String(value ?? '').trim();
  const blank = value => value == null || (typeof value === 'string' && !value.trim());
  const intern = value => ['是','实习生','1','TRUE','Y'].includes(String(value ?? '').trim().toUpperCase());
  const round = value => Math.round((value + Math.sign(value || 1) * Number.EPSILON) * 100) / 100;
  function numeric(value) {
    if (blank(value)) return null;
    if (!['number','string'].includes(typeof value)) return NaN;
    const raw=String(value).trim().replace(/[￥¥,，\s]/g,'');
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(raw)) return NaN;
    const result=Number(raw.replace(/%$/,''))/(raw.endsWith('%')?100:1);
    return Number.isFinite(result)?result:NaN;
  }
  function canonicalHeader(header) {
    const found=[...fields,...netFields].find(([label,,,aliases=[]])=>[label,...aliases].some(alias=>key(alias)===key(header)));
    if (found) return found[0];
    return key(header);
  }
  function rosterIssue(field,reason,headers,message) { return {field,reason,headers,message}; }
  function rosterFieldMap(headers) {
    const map={},sources={},issues=[];
    const names=Array.from(headers || [],header=>String(header ?? '').trim()).filter(Boolean);
    for(const [field,label,aliases] of rosterFields) {
      const standard=names.filter(header=>key(header)===key(label));
      const alternative=names.filter(header=>aliases.some(alias=>key(header)===key(alias)));
      const matches=[...standard,...alternative];
      if(!matches.length) {
        if(field==='name') issues.push(rosterIssue(field,'missing',[],`缺少必需表头“${label}”`));
        continue;
      }
      if(standard.length===1) {map[field]=standard[0];sources[field]=standard[0];}
      else if(!standard.length && alternative.length===1) {map[field]=alternative[0];sources[field]=alternative[0];}
      if(matches.length>1) issues.push(rosterIssue(field,'ambiguous',matches,`“${label}”匹配到多列：${matches.join('、')}；${map[field]?'已优先使用标准表头，':'无法自动选择，'}请人工核对`));
    }
    return {map,issues,sources};
  }
  function validDateParts(year,month,day) {
    if(year<1 || month<1 || month>12) return false;
    const leap=year%4===0 && (year%100!==0 || year%400===0);
    return day>=1 && day<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1];
  }
  function rosterDate(value) {
    if(blank(value)) return '';
    if(Object.prototype.toString.call(value)==='[object Date]') {
      if(Number.isNaN(value.getTime())) return null;
      return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
    }
    if(typeof value==='number') {
      if(!Number.isFinite(value) || value<1 || value>2958465) return null;
      const date=new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000);
      return date.toISOString().slice(0,10);
    }
    const match=String(value).trim().match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})(?:日|T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/);
    if(!match || !validDateParts(Number(match[1]),Number(match[2]),Number(match[3]))) return null;
    return `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
  }
  function rosterStatus(value) {
    const token=String(value ?? '').trim();
    if(['在职','正常','在岗','正职','转正','调动','调岗'].includes(token)) return '在职';
    if(['入职','新入职','本月入职'].includes(token)) return '入职';
    if(['离职','已离职','本月离职'].includes(token)) return '离职';
    return null;
  }
  function rosterEmploymentType(value) {
    const token=String(value ?? '').trim();
    if(['正式','正式员工','正式工','正职','全职'].includes(token)) return '正式';
    if(['试用','试用期','试用员工','试用期员工'].includes(token)) return '试用';
    if(['实习','实习生','实习员工'].includes(token)) return '实习';
    // Occupational categories establish non-intern status, not regularization.
    if(['技术人员','经理','普通员工'].includes(token)) return token;
    return null;
  }
  function rosterInternFlag(value) {
    if(typeof value==='boolean') return value;
    const token=String(value ?? '').trim().toUpperCase();
    if(['是','实习','实习生','1','TRUE','Y'].includes(token)) return true;
    if(['否','非实习生','0','FALSE','N'].includes(token)) return false;
    return null;
  }
  function normalizeRosterRow(rawRow, headerMap=rosterFieldMap(Object.keys(rawRow || {})), payrollMonth='') {
    const mapping=headerMap?.map || headerMap || {},values={},sources={},issues=[...(headerMap?.issues || [])];
    for(const [field,label] of rosterFields) {
      const header=mapping[field];if(!header) continue;
      sources[field]=header;
      const raw=rawRow?.[header];
      if(blank(raw)) continue;
      if(['join','leave','regularizationDate','contractEnd'].includes(field)) {
        if(['/','—','——','-','无'].includes(String(raw).trim())) continue;
        const value=rosterDate(raw);
        if(value===null) issues.push(rosterIssue(field,'invalid',[header],`“${label}”日期无效，请使用真实的 YYYY-MM-DD 日期`));
        else values[field]=value;
      } else if(field==='status') {
        const value=rosterStatus(raw);
        if(value===null) issues.push(rosterIssue(field,'invalid',[header],`“${label}”取值无法判定入职、在职或离职，请人工核对`));
        else values[field]=value;
      } else if(field==='employmentType') {
        const value=rosterEmploymentType(raw);
        if(value===null) issues.push(rosterIssue(field,'invalid',[header],`“${label}”取值无法判定正式、试用或实习，请人工核对`));
        else values[field]=value;
      } else if(field==='isIntern') {
        const value=header===mapping.employmentType
          ? (rosterEmploymentType(raw)===null ? null : rosterEmploymentType(raw)==='实习')
          : rosterInternFlag(raw);
        if(value===null) issues.push(rosterIssue(field,'invalid',[header],`“${label}”取值无法判定是否实习，请人工核对`));
        else values[field]=value;
      } else {
        if(field==='employeeNumber' && typeof raw!=='string' && !(typeof raw==='number' && Number.isSafeInteger(raw) && raw>=0))
          issues.push(rosterIssue(field,'invalid',[header],'工号数值无效，请使用非负整数或文本工号'));
        if(field==='bankCard' && typeof raw!=='string')
          issues.push(rosterIssue(field,'text-required',[header],`“${label}”必须在 Excel 中保存为文本，数字单元格可能丢失前导零，请核对原表`));
        values[field]=String(raw).trim();
      }
    }
    if(!values.name) issues.push(rosterIssue('name','missing',sources.name?[sources.name]:[],'姓名为空，无法建立工资人员关联'));
    if(!values.status && !issues.some(issue=>issue.field==='status')) issues.push(rosterIssue('status','missing',sources.status?[sources.status]:[],'员工状态缺失，不能确认计薪月入离职规则'));
    if(values.status==='入职' && !values.join && !issues.some(issue=>issue.field==='join'))
      issues.push(rosterIssue('join','missing',sources.join?[sources.join]:[],'入职状态缺少入职日期，不能确认入职 15 日绩效规则'));
    if(values.status==='离职' && !values.leave && !issues.some(issue=>issue.field==='leave'))
      issues.push(rosterIssue('leave','missing',sources.leave?[sources.leave]:[],'离职状态缺少离职日期，不能确认离职记录'));
    if(values.isIntern===undefined && !values.employmentType && !issues.some(issue=>['employmentType','isIntern'].includes(issue.field)))
      issues.push(rosterIssue('employmentType','missing',[], '缺少明确的员工类型或是否实习标识，不能确认工资类型'));
    if(values.employmentType && values.isIntern!==undefined && (values.employmentType==='实习')!==values.isIntern)
      issues.push(rosterIssue('isIntern','conflict',[sources.employmentType,sources.isIntern],`“${sources.employmentType}”与“${sources.isIntern}”的实习身份不一致，请人工核对`));
    if(values.isIntern===undefined && values.employmentType) {values.isIntern=values.employmentType==='实习';sources.isIntern=sources.employmentType;}
    // Payroll-month labels are independent of the live personnel directory.
    if(/^\d{4}-(0[1-9]|1[0-2])$/.test(payrollMonth)) {
      const inMonth=date=>Boolean(date) && date.slice(0,7)===payrollMonth;
      const leaving=inMonth(values.leave) || inMonth(values.contractEnd);
      const joining=inMonth(values.join), regularizing=inMonth(values.regularizationDate);
      const positionProvided=Boolean(values.position);
      values.isIntern=positionProvided ? /实习/.test(values.position) : values.isIntern===true;
      values.status=leaving?'离职':joining?'入职':'在职';
      // Exactly one payroll category. A departure overrides an ordinary
      // employee's hire/regularization; interns retain their own pay rule.
      values.payrollTags=[values.isIntern?'实习生':leaving?'离职':joining?'入职':regularizing?'转正':'正职'];
      values.employmentType=values.isIntern?'实习':'正式';
      if(leaving && !inMonth(values.leave)) {values.leave=values.contractEnd;sources.leave=sources.contractEnd;}
      sources.status=leaving?sources.leave:joining?sources.join:regularizing?sources.regularizationDate:'计薪月日期规则';
      sources.isIntern=positionProvided?sources.position:sources.isIntern||'职位及计薪月规则';
      // Legacy type/status columns are no longer required for payroll labels.
      for(let i=issues.length-1;i>=0;i--) if(['status','employmentType','isIntern'].includes(issues[i].field) ||
        (issues[i].reason==='missing' && ['join','leave'].includes(issues[i].field))) issues.splice(i,1);
    }
    return {values,issues,sources};
  }
  function rosterSectionHeader(row) {
    const values=Object.values(row||{}).filter(value=>typeof value!=='object' && !blank(value));
    return values.length>0 && values.every(value=>typeof value==='string' && /^(?:实习协议|劳动合同)(?:起|止)$/.test(value.trim()));
  }
  function rosterRowInMonth(row,month) {
    if(rosterSectionHeader(row)) return false;
    const {values,issues}=normalizeRosterRow(row,undefined,month);
    if(values.join && values.join.slice(0,7)>month) return false;
    if(row?._rosterSource?.departedSheet) {
      const actualLeave=rosterDate(row[rosterFieldMap(Object.keys(row)).map.leave]);
      return issues.some(issue=>['leave','contractEnd'].includes(issue.field)) ||
        (!actualLeave && !values.contractEnd) || (actualLeave ? actualLeave.slice(0,7)===month : values.status==='离职');
    }
    // An actual departure before this month is not a full-month employee.
    return !values.leave || values.leave.slice(0,7)>=month;
  }
  function canonicalRow(row) {
    const result={};
    // Exact standard headers take precedence over aliases.
    for (const [header,value] of Object.entries(row)) {
      const label=canonicalHeader(header);
      if (!(label in result) || key(header)===key(label)) result[label]=value;
    }
    return result;
  }
  function rowsFromGrid(grid) {
    const headerIndex=grid.findIndex(row=>row.some(value=>key(value)==='姓名'));
    if (headerIndex<0) throw new Error('首个工作表必须包含“姓名”字段');
    const headers=grid[headerIndex].map(value=>String(value ?? '').trim());
    const nonEmpty=headers.filter(Boolean);
    if (new Set(nonEmpty.map(key)).size!==nonEmpty.length) throw new Error('表头存在重复列，请核对后重新上传');
    const rows=[];
    for (const values of grid.slice(headerIndex+1)) {
      if (values.every(blank)) continue;
      const row=Object.fromEntries(headers.flatMap((header,index)=>header?[[header,values[index] ?? null]]:[]));
      if(rosterSectionHeader(row)) continue;
      const name=nameKey(canonicalRow(row)['姓名']);
      if (/^(?:合计|总计|汇总)$/.test(name)) continue;
      rows.push(row);
    }
    if (!rows.length) throw new Error('Excel 文件没有员工数据行');
    return rows;
  }
  function grossRecord(employee) {
    return Object.fromEntries(fields.map(([label,field,type])=>{
      let value=employee[field];
      if (field==='join') value=employee.joinRaw ?? value;
      if (field==='leave') value=employee.leaveRaw ?? value;
      if (field==='status') value=employee.statusRaw ?? value;
      if (type==='intern') value=employee.isIntern?'是':'否';
      else if (type==='money') value=Number.isFinite(value)?round(value):value ?? null;
      else value=value ?? (type==='number'?null:'');
      return [label,value];
    }));
  }
  function dateValue(value) {
    if (typeof value==='number') {
      const date=new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000);
      return Number.isNaN(date.getTime())?String(value):date.toISOString().slice(0,10);
    }
    if (Object.prototype.toString.call(value)==='[object Date]') return Number.isNaN(value.getTime())?String(value):`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
    const match=String(value).trim().match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})(?:日|\b)/);
    return match?`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`:String(value).trim();
  }
  function comparable(label,value) {
    if (blank(value)) return null;
    const type=[...fields,...netFields].find(field=>field[0]===label)?.[2];
    if (type==='date') return dateValue(value);
    if (type==='intern') return intern(value);
    if (type==='money' || type==='number') {
      const number=numeric(value);
      return Number.isFinite(number)?(type==='money'?round(number):number):String(value).trim();
    }
    return String(value).trim();
  }
  function indexRows(rows) {
    const map=new Map(), duplicates=new Set();
    rows.forEach(row=>{const name=nameKey(canonicalRow(row)['姓名']);if(map.has(name))duplicates.add(name);else map.set(name,row);});
    return {map,duplicates};
  }
  function compare(generated,uploaded) {
    if (!uploaded) return {status:'not-needed',differences:[]};
    if (!generated.length) return {status:'unavailable',differences:[]};
    const left=generated.map(canonicalRow),right=uploaded.map(canonicalRow),a=indexRows(left),b=indexRows(right);
    const differences=[];
    const add=(name,field,before,after,reason)=>differences.push({name,field,before,after,reason,delta:typeof before==='number'&&typeof after==='number'?round(after-before):null});
    const leftHeaders=new Set(left.flatMap(Object.keys)),rightHeaders=new Set(right.flatMap(Object.keys));
    for (const field of new Set([...leftHeaders,...rightHeaders])) {
      if (!leftHeaders.has(field)) add('全表',field,null,'存在','上传表新增字段');
      else if (!rightHeaders.has(field)) add('全表',field,'存在',null,'上传表缺失字段');
    }
    for (const name of new Set([...a.map.keys(),...b.map.keys()])) {
      if (!name || a.duplicates.has(name)||b.duplicates.has(name)) { add(name||'（空姓名）','姓名',a.map.has(name)?name:null,b.map.has(name)?name:null,'姓名为空或重复，无法唯一比对');continue; }
      if (!a.map.has(name)) {add(name,'人员',null,'存在','上传表新增人员');continue;}
      if (!b.map.has(name)) {add(name,'人员','存在',null,'上传表缺失人员');continue;}
      for (const field of leftHeaders) {
        if (field==='姓名' || !rightHeaders.has(field)) continue;
        const before=comparable(field,a.map.get(name)[field]),after=comparable(field,b.map.get(name)[field]);
        if (before!==after) add(name,field,before,after,'数值或信息不一致');
      }
    }
    return {status:differences.length?'different':'equal',differences};
  }
  function uploadedEmployees(rows) {
    const canonical=rows.map(canonicalRow),indexed=indexRows(canonical),result=[];
    for (const [name,row] of indexed.map) {
      const issues=[];
      if (!name) issues.push('应发工资表姓名为空');
      if (indexed.duplicates.has(name)) issues.push('应发工资表姓名重复，计算沿用首条；无法唯一比对');
      if (!('是否实习生' in row)) issues.push('应发工资表缺少实习生标识，按普通员工计算');
      const employee={id:`UP${result.length+1}`,deductionIssues:[],paidDayIssues:[],payrollBlocked:false,late:false};
      for (const [label,field,type] of fields) {
        const value=row[label];
        if (type==='money'||type==='number') {
          const parsed=numeric(value);
          if ((label==='应发工资'&&blank(value)) || (!blank(value)&&!Number.isFinite(parsed))) issues.push(`${label}缺失或无效，按 0 计算`);
          employee[field]=Number.isFinite(parsed)?(type==='money'?round(parsed):parsed):0;
        } else if (type==='intern') employee[field]=intern(value);
        else employee[field]=blank(value)?'':type==='date'?dateValue(value):String(value).trim();
      }
      employee.status ||= '在职';employee.dept ||= '未分配';employee.name=name;
      employee.internPay=employee.gross;
      employee.exception=issues.join('；');
      result.push(employee);
    }
    return result;
  }
  function amount(rows,name,aliases,label,issues) {
    if (!rows) {issues.push(`${label}未上传，按 0 计算`);return 0;}
    const matches=rows.filter(row=>nameKey(canonicalRow(row)['姓名'])===name);
    if (!matches.length) {issues.push(`${label}未找到匹配姓名，按 0 计算`);return 0;}
    if(matches.length>1) issues.push(`${label}姓名重复，沿用首条金额`);
    const row=matches[0],column=aliases.map(alias=>Object.keys(row).find(header=>key(header)===key(alias))).find(header=>header!==undefined);
    const value=column===undefined?null:numeric(row[column]);
    if (value===null || !Number.isFinite(value)) {issues.push(`${label}${column===undefined?'缺少金额列':'金额缺失或无效'}，按 0 计算`);return 0;}
    return round(value);
  }
  function optionalAmount(rows,name,aliases,label,issues) {
    if (!rows) return 0;
    const matches=rows.filter(row=>nameKey(canonicalRow(row)['姓名'])===name);
    if (!matches.length) return 0;
    if(matches.length>1) issues.push(`${label}姓名重复，沿用首条金额`);
    const row=matches[0],column=aliases.map(alias=>Object.keys(row).find(header=>key(header)===key(alias))).find(header=>header!==undefined);
    const value=column===undefined?null:numeric(row[column]);
    if (value===null || value===undefined) return 0;
    if (!Number.isFinite(value)) {issues.push(`${label}金额无效，按 0 计算`);return 0;}
    return round(value);
  }
  function calculateNet(base,sources) {
    return base.map(employee=>{
      const e={...employee,deductionIssues:[]},issues=e.deductionIssues,name=nameKey(e.name);
      const get=(key,aliases,label)=>amount(sources[key],name,aliases,label,issues);
      e.companySocial=get('netSocial',['公司总计','公司缴纳社保','公司总计（社保）'],'公司缴纳社保');
      e.companyFund=get('netFund',['公司缴纳','公司缴纳公积金','公司缴纳（公积金）'],'公司缴纳公积金');
      e.social=e.isIntern?0:get('netSocial',['个人总计','个人社保'],'个人社保');
      e.fund=e.isIntern?0:get('netFund',['个人缴纳','个人公积金'],'个人公积金');
      // 实习生不承担个人社保、公积金；个税和税后代扣仍按上传资料扣除。
      e.tax=get('tax',['税','个税','个人所得税','税额'],'个税');
      e.utility=get('afterTax',['水电代扣','水电费代扣','水电费合计'],'水电代扣');
      e.mealDeduct=get('afterTax',['餐费代扣','餐费合计'],'餐费代扣');
      e.otherDeduct=get('afterTax',['其它代扣','其他代扣'],'其它代扣');
      e.otherReduction=e.isIntern?0:round(Number(e.otherReduction)||0);
      e.remark=String(sources.afterTax?.map(canonicalRow).find(row=>nameKey(row['姓名'])===name)?.['备注'] ?? '');
      e.gross=round(Number(e.gross)||0);
      e.afterTaxTotal=round(e.utility+e.mealDeduct+e.otherDeduct);
      e.net=e.isIntern
        ? round(e.gross-e.tax-e.afterTaxTotal)
        : round(e.gross-e.social-e.fund-e.tax-e.afterTaxTotal);
      e.companyCost=round(e.gross+e.companySocial+e.companyFund);
      return e;
    });
  }
  return {fields,netFields,rosterFields,key,blank,round,numeric,canonicalHeader,canonicalRow,rosterFieldMap,normalizeRosterRow,rosterRowInMonth,rosterSectionHeader,rowsFromGrid,grossRecord,compare,uploadedEmployees,calculateNet,dateValue};
})();
