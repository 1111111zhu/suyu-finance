import {readFileSync,statSync} from 'node:fs';
import {timingSafeEqual} from 'node:crypto';

// Caddy must strip these headers on every public request and set them only
// for the exact registered peer IP arriving through the NetBird interface.
export function netbirdDeviceAccess(request) {
  const id=process.env.SUYU_NETBIRD_DEVICE_ID;
  const file=process.env.SUYU_NETBIRD_DEVICE_SECRET_FILE;
  if(process.env.NODE_ENV!=='production'||!id||!file||!/^[A-Za-z0-9_-]{8,128}$/.test(id))return null;
  if(request.headers.get('x-suyu-netbird-device')!==id)return null;
  const supplied=request.headers.get('x-suyu-netbird-proof')||'';
  if(!/^[A-Za-z0-9_-]{43}$/.test(supplied))return null;
  try{
    const info=statSync(file);
    if(!info.isFile()||(info.mode&0o077))return null;
    const expected=readFileSync(file,'utf8').trim();
    if(!/^[A-Za-z0-9_-]{43}$/.test(expected)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return null;
    return {userid:'netbird:'+id,displayName:'个人电脑',role:'manager',deviceId:id};
  }catch{return null;}
}

export function payrollActorUsername(access) {
  return access.local?process.env.SUYU_LOCAL_PAYROLL_ACTOR||'admin':access.authMethod==='password'?'account:'+access.accountId:access.deviceId?'netbird:'+access.deviceId:'wecom:'+access.userid;
}
