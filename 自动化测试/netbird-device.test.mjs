import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {netbirdDeviceAccess,payrollActorUsername} from '../server/access/netbird-device.mjs';
import {requireAccess} from '../server/access/session.mjs';

test('registered NetBird peer proof is required; missing, forged, revoked, or insecure proof fails closed',async()=>{
  const root=mkdtempSync(join(tmpdir(),'suyu-device-test-')),file=join(root,'proof');
  const keys=['NODE_ENV','SUYU_NETBIRD_DEVICE_ID','SUYU_NETBIRD_DEVICE_SECRET_FILE','SUYU_PUBLIC_ORIGIN'];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const id='test-personal-peer',proof=randomBytes(32).toString('base64url');
  const request=(device=id,token=proof,method='GET',origin)=>new Request('https://finance.example.invalid/api/payroll/session',{method,headers:{'x-suyu-netbird-device':device,'x-suyu-netbird-proof':token,...origin?{origin}:{}}});
  try{
    Object.assign(process.env,{NODE_ENV:'production',SUYU_NETBIRD_DEVICE_ID:id,SUYU_NETBIRD_DEVICE_SECRET_FILE:file,SUYU_PUBLIC_ORIGIN:'https://finance.example.invalid'});
    writeFileSync(file,proof,{mode:0o600});
    const user=netbirdDeviceAccess(request());
    assert.equal(user.role,'manager');assert.equal(user.deviceId,id);
    assert.equal(payrollActorUsername(user),'netbird:'+id);
    assert.equal((await requireAccess(request(),'payroll')).deviceId,id);
    await assert.rejects(requireAccess(request(id,proof,'POST','https://evil.invalid'),'payroll'),e=>e.status===403);
    await assert.rejects(requireAccess(request(id,proof,'POST'),'payroll'),e=>e.status===403);
    assert.equal((await requireAccess(request(id,proof,'POST','https://finance.example.invalid'),'payroll')).deviceId,id);
    for(const r of [new Request('https://finance.example.invalid'),request('other-peer'),request(id,randomBytes(32).toString('base64url')),request(id,'short')])assert.equal(netbirdDeviceAccess(r),null);
    chmodSync(file,0o644);assert.equal(netbirdDeviceAccess(request()),null);
    chmodSync(file,0o600);writeFileSync(file,randomBytes(32).toString('base64url'));assert.equal(netbirdDeviceAccess(request()),null);
    process.env.NODE_ENV='development';assert.equal(netbirdDeviceAccess(request()),null);
    process.env.NODE_ENV='production';delete process.env.SUYU_NETBIRD_DEVICE_ID;assert.equal(netbirdDeviceAccess(request()),null);
  }finally{
    for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;
    rmSync(root,{recursive:true,force:true});
  }
});
