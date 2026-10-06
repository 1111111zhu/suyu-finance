export type ExpensePerson = { name: string; employeeNumber: string; dept: string; company: string; status: string; gross: number|null; net: number|null; cost: number|null };
export type ExpenseBatch = { id:string; month:string; name:string; updatedAt:string; people:ExpensePerson[] };
const number = (v:unknown):number|null => typeof v==='number' && Number.isFinite(v)?v:null;
export function expenseHistory(batches:unknown[]): ExpenseBatch[] {
  return batches.flatMap((input)=>{
    const b=input as Record<string,any>;
    if(b.draftOrigin==='demo' || Object.values(b.data?.sourceStatus||{}).some((s:any)=>s?.demo) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month||''))return [];
    const stored=b.personnelAnalysis;
    if(!stored || !Array.isArray(stored.people) || !stored.people.length){
      const rows=b.data?.sourceRows?.roster;
      if(!Array.isArray(rows)||!rows.length)return [];
      const get=(r:Record<string,unknown>,keys:string[])=>String(keys.map(k=>r[k]).find(v=>v!==undefined&&v!==null)||'');
      return [{id:String(b.id||b.name),name:String(b.name),month:b.month,updatedAt:b.date||'',people:rows.map(r=>({name:get(r,['姓名','员工姓名']),employeeNumber:get(r,['工号','员工编号']),dept:get(r,['一级部门','部门']),company:get(r,['公司','签约公司']),status:get(r,['员工状态','是否入离职','状态'])||'待核对',gross:null,net:null,cost:null})).filter(p=>p.name)}];
    }
    return [{id:String(b.id||b.name),name:String(b.name),month:b.month,updatedAt:stored.updatedAt||b.date||'',people:stored.people.map((p:any)=>({name:String(p.name||''),employeeNumber:String(p.employeeNumber||''),dept:String(p.dept||''),company:String(p.company||''),status:String(p.status||'在职'),gross:number(p.gross),net:number(p.net),cost:number(p.cost)})).filter((p:ExpensePerson)=>p.name)}];
  }).sort((a,b)=>b.month.localeCompare(a.month)||b.updatedAt.localeCompare(a.updatedAt));
}
export function personHistory(person:ExpensePerson, batches:ExpenseBatch[]){
  const found=new Map<string,{month:string;gross:number|null;net:number|null;cost:number|null}>();
  for(const batch of batches){
    if(found.has(batch.month))continue;
    const matches=batch.people.filter(p=>person.employeeNumber && p.employeeNumber ? p.employeeNumber===person.employeeNumber && p.company===person.company : p.name===person.name && p.company===person.company);
    if(matches.length===1)found.set(batch.month,{month:batch.month,gross:matches[0].gross,net:matches[0].net,cost:matches[0].cost});
  }
  return [...found.values()].sort((a,b)=>a.month.localeCompare(b.month));
}
export async function readPayrollBatches():Promise<unknown[]>{
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('payroll-workbench-local',1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('workspace'))request.result.createObjectStore('workspace');};
    request.onerror=()=>reject(new Error('工资批次缓存读取失败'));
    request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('workspace')){db.close();resolve([]);return;}const query=db.transaction('workspace','readonly').objectStore('workspace').get('batches');query.onsuccess=()=>{db.close();resolve(Array.isArray(query.result)?query.result:[]);};query.onerror=()=>{db.close();reject(new Error('工资批次读取失败'));};};
  });
}
export function monthsInRange(from:string,to:string){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(from)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(to)||from>to)return [];
  const index=(s:string)=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
  const count=index(to)-index(from)+1;if(count>120)return [];
  return Array.from({length:count},(_,i)=>{const n=index(from)+i;return `${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`;});
}
export type RangeExpense = ExpensePerson & { missing:Record<'gross'|'net'|'cost',number> };
export function latestMonthly(batches:ExpenseBatch[],from:string,to:string){
  const result=new Map<string,ExpenseBatch>();
  for(const b of [...batches].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)))if(b.month>=from&&b.month<=to&&!result.has(b.month))result.set(b.month,b);
  return [...result.values()].sort((a,b)=>a.month.localeCompare(b.month));
}
export function rangeExpenses(batches:ExpenseBatch[],from:string,to:string):RangeExpense[]{
  const months=monthsInRange(from,to);if(!months.length)return [];
  const monthly=latestMonthly(batches,from,to), people=new Map<string,ExpensePerson>();
  for(const b of monthly)for(const p of b.people)people.set(JSON.stringify([p.company,p.employeeNumber||p.name]),p);
  return [...people.values()].map(p=>{
    const points=personHistory(p,monthly), missing={gross:0,net:0,cost:0};
    const sums={gross:null as number|null,net:null as number|null,cost:null as number|null};
    for(const metric of ['gross','net','cost'] as const){const known=points.flatMap(point=>point[metric]===null?[]:[point[metric]!]);missing[metric]=months.length-known.length;sums[metric]=known.length?Math.round(known.reduce((a,b)=>a+b,0)*100)/100:null;}
    return {...p,...sums,missing};
  });
}
export function rangeTrend(person:ExpensePerson,batches:ExpenseBatch[],from:string,to:string){
  const found=new Map(personHistory(person,latestMonthly(batches,from,to)).map(p=>[p.month,p]));
  return monthsInRange(from,to).map(month=>found.get(month)||{month,gross:null,net:null,cost:null});
}
