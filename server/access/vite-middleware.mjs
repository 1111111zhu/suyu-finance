import {requireAccess} from './session.mjs';
import {routeCapability,canonicalPath} from './policy.mjs';
export function accessViteMiddleware(){return {name:'suyu-access-public-guard',apply:'serve',configureServer(server){server.middlewares.use((req,res,next)=>{
 const request=new Request('http://127.0.0.1:3220'+req.url,{headers:req.headers,method:req.method});const path=canonicalPath(new URL(request.url).pathname);
 const capability=routeCapability(path,req.method);if(!capability)return next();
 void requireAccess(request,capability).then(()=>{
  next();
 }).catch(error=>{res.writeHead(error.status||503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:error.message||'访问失败'}));});
 });}};}
