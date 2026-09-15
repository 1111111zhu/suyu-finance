import { createPool } from '../../database/payroll/pool.mjs';
import { createPayrollServer } from './http.mjs';

const port=Number(process.env.PAYROLL_API_PORT||3002);
if (!Number.isInteger(port)||port<1||port>65535) throw new Error('Invalid PAYROLL_API_PORT');
if (!process.env.PAYROLL_PUBLIC_ORIGIN) throw new Error('Set PAYROLL_PUBLIC_ORIGIN to the website origin');
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the restricted payroll runtime connection');
if (process.env.PAYROLL_ALLOW_DEMO==='yes') throw new Error('Demo initialization must not be enabled in the API service');
const pool=createPool();
pool.on('error',()=>process.stderr.write('Payroll database connection interrupted.\n'));
const server=createPayrollServer({pool,publicOrigin:process.env.PAYROLL_PUBLIC_ORIGIN,
  production:!['development','test'].includes(process.env.NODE_ENV),
  trustedProxies:(process.env.PAYROLL_TRUSTED_PROXIES||'').split(',').map(value=>value.trim()).filter(Boolean)});
server.on('error',()=>{process.stderr.write('Payroll API failed to listen.\n');process.exitCode=1;void pool.end();});
server.listen(port,process.env.PAYROLL_API_HOST||'127.0.0.1',()=>process.stdout.write(`Payroll API listening on port ${port}.\n`));
let stopping=false;
const stop=()=>{
  if (stopping) return; stopping=true;
  server.close(()=>{void pool.end();});
  const timer=setTimeout(()=>{server.closeAllConnections();},10_000);timer.unref();
};
process.on('SIGTERM',stop);
process.on('SIGINT',stop);
