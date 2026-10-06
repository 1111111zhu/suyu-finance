import {payrollResponse} from '../../../../server/access/payroll-adapter.mjs';
async function handle(request:Request){try{return await payrollResponse(request);}catch(error){return Response.json({ok:false,error:{message:error instanceof Error?error.message:'工资服务不可用'}},{status:(error as {status?:number}).status||503,headers:{'Cache-Control':'no-store'}});}}
export const GET=handle;export const POST=handle;export const PATCH=handle;export const DELETE=handle;export const PUT=handle;
