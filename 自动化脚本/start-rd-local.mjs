import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createPool} from '../database/payroll/pool.mjs';

// Use the existing persistent local PostgreSQL instance. Never start another
// cluster or silently create a replacement database when configuration fails.
const root=fileURLToPath(new URL('../',import.meta.url));
if(resolve(process.cwd())!==resolve(root)) throw new Error('Start from the authoritative workspace.');
for(const key of ['RD_DATABASE_URL','PAYROLL_DATABASE_URL']) {
  if(!process.env[key]) throw new Error(`${key} is required in the private local environment.`);
  const url=new URL(process.env[key]);
  const host=url.searchParams.get('host')||url.hostname;
  if(!['127.0.0.1','localhost','::1'].includes(host)) throw new Error('Local acceptance requires the persistent loopback database.');
  const pool=createPool({connectionString:url.toString(),max:1});
  try {
    const {rows:[row]}=await pool.query('SELECT current_database() AS database');
    console.log(`${key}: ${row.database} connected.`);
  } catch {
    throw new Error(`${key} cannot connect. Restore the configured database before starting 3220.`);
  } finally {await pool.end();}
}
const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','3220','--strictPort'],{stdio:'inherit',env:{...process.env,RD_LOCAL_PREVIEW:'1'}});
child.on('exit',code=>{process.exitCode=code||0;});
process.on('SIGINT',()=>child.kill('SIGINT'));
process.on('SIGTERM',()=>child.kill('SIGTERM'));
