import {authResponse} from '../../../../server/access/session.mjs';
async function handle(request:Request){try{return await authResponse(request);}catch(error){return Response.json({error:error instanceof Error?error.message:'登录失败'},{status:(error as {status?:number}).status||503,headers:{'Cache-Control':'no-store'}});}}
export const GET=handle;
export const POST=handle;
