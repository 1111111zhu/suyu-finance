import {NextResponse} from 'next/server';
import {requireAccess} from './server/access/session.mjs';
import {routeCapability,canonicalPath} from './server/access/policy.mjs';
export async function middleware(request:Request){
 const path=canonicalPath(new URL(request.url).pathname);
 if(path==='/'||path.startsWith('/api/auth/')||path.startsWith('/_next/')||path.startsWith('/@')||path.startsWith('/node_modules/')||path==='/favicon.ico')return NextResponse.next();
 const capability=routeCapability(path,request.method);
 if(!capability)return NextResponse.next();
 try{const user=await requireAccess(request,capability);if(user.role==='finance'&&(path==='/rd-cost'||path.startsWith('/rd-cost/results')||path.startsWith('/rd-cost/index.html')||path.startsWith('/calculate')))return NextResponse.redirect(new URL('/rd-cost/analysis?embed=1',request.url));const response=NextResponse.next();if(path.startsWith('/salary/')&&/\.(?:html|js)$/.test(path))response.headers.set('Cache-Control','private, no-store, max-age=0');return response;}
 catch(error){const status=(error as {status?:number}).status||503;return new Response(path.startsWith('/api/')?JSON.stringify({error:status===401?'请使用企业微信登录':'没有访问权限'}):'请返回首页使用企业微信登录，或联系经理确认权限。',{status,headers:{'Content-Type':path.startsWith('/api/')?'application/json; charset=utf-8':'text/plain; charset=utf-8','Cache-Control':'no-store'}});}
}
export const config={matcher:['/((?!_next/static|_next/image).*)']};
