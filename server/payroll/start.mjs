import { readFileSync, statSync } from 'node:fs';
import { createPool } from '../../database/payroll/pool.mjs';
import { createPayrollServer } from './http.mjs';
import { createPersonnelService } from './personnel-service.mjs';
import { createWorkspaceConfirmationService } from './workspace-confirmation.mjs';

const port=Number(process.env.PAYROLL_API_PORT||3002);
if (!Number.isInteger(port)||port<1||port>65535) throw new Error('Invalid PAYROLL_API_PORT');
if (!process.env.PAYROLL_PUBLIC_ORIGIN) throw new Error('Set PAYROLL_PUBLIC_ORIGIN to the website origin');
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the restricted payroll runtime connection');
if (process.env.PAYROLL_ALLOW_DEMO==='yes') throw new Error('Demo initialization must not be enabled in the API service');
const pool=createPool();
pool.on('error',()=>process.stderr.write('Payroll database connection interrupted.\n'));
let personnelService=null;
const corpId=process.env.WECOM_CORP_ID?.trim()||null;
const preferredSecretPath=process.env.WECOM_SECRET_FILE?.trim()||null;
const legacySecretPath=process.env.WECOM_APP_SECRET_FILE?.trim()||null;
if(preferredSecretPath && legacySecretPath && preferredSecretPath!==legacySecretPath)
  throw new Error('WECOM_SECRET_FILE and WECOM_APP_SECRET_FILE point to different files');
const secretPath=preferredSecretPath||legacySecretPath;
if(corpId && secretPath) {
  const info=statSync(secretPath);
  if(!info.isFile() || (info.mode & 0o077)) throw new Error('WECOM_SECRET_FILE must be a private file (mode 0600)');
  const appSecret=readFileSync(secretPath,'utf8').trim();
  if(!appSecret) throw new Error('WECOM_SECRET_FILE is empty');
  personnelService=createPersonnelService({pool,corpId,appSecret});
} else if(corpId || secretPath) process.stderr.write('WeCom directory configuration is incomplete; personnel page will show waiting-for-connection.\n');
const confirmationService=createWorkspaceConfirmationService({pool,corpId});
const server=createPayrollServer({pool,publicOrigin:process.env.PAYROLL_PUBLIC_ORIGIN,
  production:!['development','test'].includes(process.env.NODE_ENV),
  trustedProxies:(process.env.PAYROLL_TRUSTED_PROXIES||'').split(',').map(value=>value.trim()).filter(Boolean),
  personnelService,corpId,confirmationService});
server.on('error',()=>{process.stderr.write('Payroll API failed to listen.\n');process.exitCode=1;void pool.end();});
server.listen(port,process.env.PAYROLL_API_HOST||'127.0.0.1',()=>{
  process.stdout.write(`Payroll API listening on port ${port}.\n`);
  if(personnelService) void personnelService.sync().catch(()=>process.stderr.write('WeCom directory sync failed; previous successful snapshot remains available.\n'));
});
const syncTimer=personnelService?setInterval(()=>{
  void personnelService.sync().catch(()=>process.stderr.write('WeCom directory sync failed; previous successful snapshot remains available.\n'));
},6*60*60*1000):null;
syncTimer?.unref();
let stopping=false;
const stop=()=>{
  if (stopping) return; stopping=true;
  if(syncTimer) clearInterval(syncTimer);
  server.close(()=>{void pool.end();});
  const timer=setTimeout(()=>{server.closeAllConnections();},10_000);timer.unref();
};
process.on('SIGTERM',stop);
process.on('SIGINT',stop);
