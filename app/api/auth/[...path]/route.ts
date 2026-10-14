import {authResponse} from '../../../../server/access/session.mjs';
import {authFailureResponse} from '../../../../server/access/auth-errors.mjs';
async function handle(request:Request){try{return await authResponse(request);}catch(error){return authFailureResponse(request,error);}}
export const GET=handle;
export const POST=handle;
