// Only the current, confirmed net run of a real formal batch contributes here.
// Money is accumulated as integer cents; draft workspace snapshots never enter this query.
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
function invalid(message) { const e=new Error(message); e.code='PAYROLL_VALIDATION'; throw e; }
function currentMonth() {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).formatToParts(new Date());
  return `${parts.find(p=>p.type==='year').value}-${parts.find(p=>p.type==='month').value}`;
}
function monthIndex(value) { return Number(value.slice(0,4))*12+Number(value.slice(5))-1; }
function monthAt(index) { return `${String(Math.floor(index/12)).padStart(4,'0')}-${String(index%12+1).padStart(2,'0')}`; }
function cents(value) {
  if(!/^-?\d+(?:\.\d{1,2})?$/.test(String(value))) invalid('已确认工资存在无效的实发金额，请联系管理员核验');
  const sign=String(value).startsWith('-')?-1n:1n;
  const [whole,fraction='']=String(value).replace(/^-/, '').split('.');
  return sign*(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
}
function money(value) {
  if(value===null) return null;
  if(value>BigInt(Number.MAX_SAFE_INTEGER)||value<(-BigInt(Number.MAX_SAFE_INTEGER))) invalid('汇总金额超出安全展示范围');
  return Number(value)/100;
}
function average(value,count) {
  if(value===null||!count) return null;
  const divisor=BigInt(count), half=divisor/2n;
  return money(value>=0n?(value+half)/divisor:(value-half)/divisor);
}
export function createPayrollSummaryService({pool,corpId=null}) {
  return {
    async summary({from,to,departmentId,userid}={}) {
      const end=to||currentMonth(), start=from||monthAt(monthIndex(end)-11);
      if(!MONTH.test(start)||!MONTH.test(end)||monthIndex(end)<monthIndex(start)||monthIndex(end)-monthIndex(start)>119) invalid('请选择不超过 120 个月的有效起止月份');
      if(departmentId!==undefined && (typeof departmentId!=='string'||!departmentId||departmentId.length>100)) invalid('部门编号无效');
      if(userid!==undefined && (typeof userid!=='string'||!userid||userid.length>200)) invalid('企微成员编号无效');
      // A department filter is explicitly about today's observed WeCom directory.
      // Historical item snapshots retain their own payroll-time department separately.
      const rows=(await pool.query(`SELECT to_char(b.month,'YYYY-MM') AS month,
          i.employee_id, i.net::text AS net,
          coalesce(i.employee_snapshot->>'name', e.name) AS name,
          coalesce(i.employee_snapshot->>'department','') AS payroll_department,
          l.userid, m.department_ids,
          r.id AS run_id, r.confirmed_at
        FROM payroll.batches b
        JOIN payroll.runs r ON r.id=b.current_run_id AND r.batch_id=b.id
        JOIN payroll.items i ON i.run_id=r.id
        JOIN payroll.employees e ON e.id=i.employee_id
        LEFT JOIN payroll.wecom_employee_links l ON l.employee_id=i.employee_id AND l.corp_id=$3
        LEFT JOIN payroll.wecom_members m ON m.corp_id=l.corp_id AND m.userid=l.userid AND m.active
        WHERE b.month BETWEEN $1::date AND $2::date
          AND b.status IN ('confirmed','archived') AND r.status IN ('confirmed','archived')
          AND r.scope IN ('net_generated','net_uploaded') AND i.net IS NOT NULL
          AND ($4::text IS NULL OR l.userid=$4)
          AND ($5::text IS NULL OR m.department_ids ? $5)
        ORDER BY month, i.employee_id, r.confirmed_at DESC, r.id DESC`,
        [start+'-01',end+'-01',corpId,userid??null,departmentId??null])).rows;
      const seen=new Set(), selected=[], duplicateMonths=new Set();
      for(const row of rows) {
        const key=`${row.month}:${row.employee_id}`;
        if(seen.has(key)) { duplicateMonths.add(row.month); continue; }
        seen.add(key); selected.push(row);
      }
      const monthMap=new Map(), personMap=new Map();
      for(const row of selected) {
        const value=cents(row.net);
        const m=monthMap.get(row.month)||{net:0n,count:0}; m.net+=value;m.count++;monthMap.set(row.month,m);
        let p=personMap.get(row.employee_id);
        if(!p) {p={userid:row.userid??null,employeeId:row.employee_id,name:row.name,dept:row.payroll_department,total:0n,byMonth:new Map()};personMap.set(row.employee_id,p);}
        p.total+=value;p.byMonth.set(row.month,value);
        p.name=row.name;p.dept=row.payroll_department;p.userid=row.userid??p.userid;
      }
      const labels=Array.from({length:monthIndex(end)-monthIndex(start)+1},(_,index)=>monthAt(monthIndex(start)+index));
      let running=0n;
      const months=labels.map(month=>{
        const found=monthMap.get(month);
        if(!found) return {month,totalNet:null,headcount:null,averageNet:null,cumulativeNet:null,missing:true};
        running+=found.net;
        return {month,totalNet:money(found.net),headcount:found.count,averageNet:average(found.net,found.count),cumulativeNet:money(running),missing:false};
      });
      const people=[...personMap.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')||a.employeeId.localeCompare(b.employeeId)).map(p=>{
        let cumulative=0n;
        return {userid:p.userid,employeeId:p.employeeId,name:p.name,dept:p.dept,totalNet:money(p.total),months:labels.map(month=>{
          const value=p.byMonth.get(month);
          if(value===undefined) return {month,net:null,cumulativeNet:null,missing:true};
          cumulative+=value;return {month,net:money(value),cumulativeNet:money(cumulative),missing:false};
        })};
      });
      return {from:start,to:end,months,people,warnings:[...duplicateMonths].sort().map(month=>({month,reason:'该月同一员工存在多个已确认批次，仅采用最近确认版本，未重复计入'}))};
    }
  };
}
