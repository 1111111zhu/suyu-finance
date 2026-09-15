/* Shared browser/Node payroll data rules. No file, network or UI side effects. */
globalThis.PayrollEngine = (() => {
  const fields = [
    ['姓名','name','text'],['公司','company','text'],['一级部门','dept','text',['部门','一级部门名称']],
    ['二级部门','subdept','text',['二级部门名称']],['银行卡号','bankCard','text'],['开户行','bankName','text',['银行']],
    ['是否入离职','status','text'],['入职日期','join','date'],['离职日期','leave','date'],
    ['应发薪','workdays','number',['应发薪天数']],['实发薪天数','payableDays','number'],
    ['基本工资','base','money',['工资基数']],['岗位工资','post','money'],['绩效基数','perfBase','money'],
    ['绩效分数','effectiveScore','number',['绩效系数']],['绩效工资','performancePay','money'],['工资小计','subtotal','money'],
    ['餐饮津贴','meal','money',['餐补合计']],['交通津贴','transit','money',['交通补贴']],
    ['其他津贴','otherAllow','money'],['病假补贴','sickSubsidy','money'],['其他加','otherAdd','money'],
    ['年假天数','annual','number',['年假(天)']],['弹性假天数','flexible','number',['弹性假(天)']],
    ['调休假天数','compensatory','number',['调休假(天)']],['病假天数','sick','number',['病假(天)']],
    ['事假天数','personal','number',['事假(天)']],['旷工天数','absent','number',['旷工(天)']],
    ['假勤扣薪天数','deductDays','number'],['假勤扣款','attendanceDeduct','money'],['其他减','otherReduction','money'],
    ['应发工资','gross','money'],['个人社保','social','money',['个人总计']],['个人公积金','fund','money',['个人缴纳']],
    ['是否实习生','isIntern','intern',['是否实习','实习标识']],['日薪','dailyRate','money'],
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
    return key(header).includes('实习') ? '是否实习生' : key(header);
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
  return {fields,netFields,key,blank,round,numeric,canonicalHeader,canonicalRow,rowsFromGrid,grossRecord,compare,uploadedEmployees,calculateNet,dateValue};
})();
