import { readFileSync } from 'node:fs';
import { createPool } from '../../database/payroll/pool.mjs';
import { createPayrollServer } from './http.mjs';
import { createWeComDirectory } from './wecom-directory.mjs';

const port=Number(process.env.PAYROLL_API_PORT||3002);
if (!Number.isInteger(port)||port<1||port>65535) throw new Error('Invalid PAYROLL_API_PORT');
if (!process.env.PAYROLL_PUBLIC_ORIGIN) throw new Error('Set PAYROLL_PUBLIC_ORIGIN to the website origin');
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the restricted payroll runtime connection');
if (process.env.PAYROLL_ALLOW_DEMO==='yes') throw new Error('Demo initialization must not be enabled in the API service');
const pool=createPool();
pool.on('error',()=>process.stderr.write('Payroll database connection interrupted.\n'));
const directoryEnabled=process.env.WECOM_DIRECTORY_SYNC_ENABLED==='1';
let wecomDirectory=null;
let directoryInterval=null;
if (directoryEnabled) {
  const corpId=process.env.WECOM_CORP_ID?.trim();
  const secretFile=process.env.WECOM_APP_SECRET_FILE?.trim();
  const interval=Number(process.env.WECOM_DIRECTORY_SYNC_INTERVAL_SECONDS||21600);
  const maxMembers=Number(process.env.WECOM_DIRECTORY_MAX_MEMBERS||10000);
  if (!corpId || !secretFile) throw new Error('Directory sync requires WECOM_CORP_ID and WECOM_APP_SECRET_FILE');
  if (!Number.isInteger(interval) || interval<300) throw new Error('Invalid WECOM_DIRECTORY_SYNC_INTERVAL_SECONDS');
  const appSecret=readFileSync(secretFile,'utf8').trim();
  wecomDirectory=createWeComDirectory({pool,corpId,appSecret,maxMembers,syncIntervalSeconds:interval});
  const run=()=>{void wecomDirectory.sync().catch(()=>{
    process.stderr.write('Enterprise WeChat directory sync failed; the previous snapshot remains available.\n');
  });};
  directoryInterval={interval,run};
}
const server=createPayrollServer({pool,publicOrigin:process.env.PAYROLL_PUBLIC_ORIGIN,
  production:!['development','test'].includes(process.env.NODE_ENV),
  trustedProxies:(process.env.PAYROLL_TRUSTED_PROXIES||'').split(',').map(value=>value.trim()).filter(Boolean),wecomDirectory});
server.on('error',()=>{process.stderr.write('Payroll API failed to listen.\n');process.exitCode=1;void pool.end();});
server.listen(port,process.env.PAYROLL_API_HOST||'127.0.0.1',()=>{
  process.stdout.write(`Payroll API listening on port ${port}.\n`);
  if (directoryInterval) {
    directoryInterval.run();
    directoryInterval.timer=setInterval(directoryInterval.run,directoryInterval.interval*1000);
    directoryInterval.timer.unref();
  }
});
let stopping=false;
const stop=()=>{
  if (stopping) return; stopping=true;
  if (directoryInterval?.timer) clearInterval(directoryInterval.timer);
  server.close(()=>{void pool.end();});
  const timer=setTimeout(()=>{server.closeAllConnections();},10_000);timer.unref();
};
process.on('SIGTERM',stop);
process.on('SIGINT',stop);
