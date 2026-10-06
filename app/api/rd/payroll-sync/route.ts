import {createPool} from '../../../../database/payroll/pool.mjs';
import {createPayrollSyncService} from '../../../../database/rd/payroll-sync.mjs';
import {requireAccess} from '../../../../server/access/session.mjs';
import {assertSameOrigin,jsonBody,rdError} from '../_database';
export const runtime='nodejs';
const state=globalThis as typeof globalThis & {__laborPools?:{rd:ReturnType<typeof createPool>;payroll:ReturnType<typeof createPool>}};
function service(){
 if(!process.env.RD_DATABASE_URL||!(process.env.PAYROLL_DATABASE_URL||process.env.DATABASE_URL))throw Object.assign(new Error('数据库尚未配置'),{code:'RD_UNCONFIGURED'});
 if(!state.__laborPools){state.__laborPools={rd:createPool({connectionString:process.env.RD_DATABASE_URL,application_name:'rd-payroll-sync'}),payroll:createPool({connectionString:process.env.PAYROLL_DATABASE_URL||process.env.DATABASE_URL,application_name:'rd-payroll-source'})};for(const pool of Object.values(state.__laborPools))pool.on('error',()=>process.stderr.write('Labor database connection interrupted.\n'));}
 return createPayrollSyncService({rdPool:state.__laborPools.rd,payrollPool:state.__laborPools.payroll});
}
export async function GET(request:Request){try{
 const actor=await requireAccess(request,'rd');const url=new URL(request.url);const runId=url.searchParams.get('runId');
 if(url.searchParams.has('sources')||runId){await requireAccess(request,'payroll');return Response.json(runId?{personnel:await service().personnel(runId)}:{sources:await service().sources()},{headers:{'Cache-Control':'no-store'}});}
 return Response.json({snapshots:await service().list(actor.role==='manager')},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return rdError(error);}}
export async function POST(request:Request){try{const actor=await requireAccess(request,'payroll');assertSameOrigin(request);const input=await jsonBody(request);return Response.json(await service().sync(input,actor.userid),{headers:{'Cache-Control':'no-store'}});}catch(error){return rdError(error);}}
