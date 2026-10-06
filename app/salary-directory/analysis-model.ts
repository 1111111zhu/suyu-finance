import { occursInPayrollMonth, type Person } from './roster-model';
export function personnelTags(person: Person, month: string) {
  const v = person.values, tags: string[] = [];
  if (occursInPayrollMonth(v.join, month)) tags.push('入职');
  if (occursInPayrollMonth(v.regularizationDate, month)) tags.push('转正');
  const transfer = Object.entries(person.raw).find(([key]) => /调岗日期|调动日期|调薪日期/.test(key))?.[1];
  if (occursInPayrollMonth(transfer, month)) tags.push('调动');
  if (occursInPayrollMonth(v.leave, month)) tags.push('离职');
  if (v.isIntern === true) tags.push('实习生');
  if (!tags.length) tags.push(v.status === '离职' ? '历史离职' : v.regularizationDate && String(v.regularizationDate) < month ? '正职' : '在职 · 转正待核对');
  return tags;
}
export type Cost = { name: string; employeeNumber: string; gross: number | null; net: number | null; cost: number | null };
const clean = (v: unknown) => String(v ?? '').replace(/\s/g,'');
const amount = (v: unknown): number | null => { if (v === null || v === undefined || String(v).trim() === '') return null; const n=Number(String(v).replace(/[,￥¥]/g,'')); return Number.isFinite(n) ? n : null; };
export function parseCosts(grid: unknown[][]): Cost[] {
  const at=grid.findIndex(row=>row.some(v=>['姓名','员工姓名'].includes(clean(v))) && row.some(v=>/^(应发工资|实发工资|公司成本|企业成本|公司总成本)$/.test(clean(v))));
  if(at<0) throw new Error('工资结果需包含姓名及应发工资、实发工资或公司成本列。');
  const headers=grid[at].map(clean);
  const get=(r:unknown[], aliases:string[])=>r[headers.findIndex(h=>aliases.includes(h))];
  const rows=grid.slice(at+1).filter(r=>clean(get(r,['姓名','员工姓名'])) && !/合计|汇总/.test(clean(get(r,['姓名','员工姓名'])))).map(r=>{
    const gross=amount(get(r,['应发工资'])), social=amount(get(r,['公司缴纳社保','公司社保'])), fund=amount(get(r,['公司缴纳公积金','公司公积金']));
    const explicit=amount(get(r,['公司成本','企业成本','公司总成本']));
    return {name:String(get(r,['姓名','员工姓名'])).trim(),employeeNumber:clean(get(r,['工号','员工编号'])),gross,net:amount(get(r,['实发工资'])),cost:explicit ?? (gross!==null && social!==null && fund!==null ? gross+social+fund : null)};
  });
  const keys=rows.map(r=>r.employeeNumber||r.name); if(new Set(keys).size!==keys.length) throw new Error('工资结果存在重复人员，请先核对，避免重复统计。');
  return rows;
}
export function matchCost(person: Person, rows: Cost[]) {
  const id=String(person.values.employeeNumber||'');
  const byId=id?rows.filter(r=>r.employeeNumber===id):[];
  if(byId.length===1)return byId[0];
  const byName=rows.filter(r=>r.name===person.values.name && (!id || !r.employeeNumber));
  return byName.length===1?byName[0]:undefined;
}
