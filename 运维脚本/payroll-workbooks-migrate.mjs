import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]);
const require=createRequire(resolve(root,'package.json'));
const {Pool}=require('pg');
const migration=process.env.DATABASE_MIGRATION_URL,runtime=process.env.PAYROLL_DATABASE_URL||process.env.DATABASE_URL;
if(!migration||!runtime)throw new Error('Migration/runtime database configuration missing');
const a=new URL(migration),b=new URL(runtime);
if(a.hostname!==b.hostname||a.port!==b.port||a.pathname!==b.pathname)throw new Error('Migration/runtime targets differ');
const pool=new Pool({connectionString:migration,max:1});
try{
 const {migrate}=await import(pathToFileURL(resolve(root,'database/payroll/migrate.mjs')));
 await migrate(pool);
 const role=decodeURIComponent(b.username);if(!role)throw new Error('Runtime role missing');
 const identifier='"'+role.replaceAll('"','""')+'"';
 await pool.query(`GRANT SELECT,INSERT ON payroll.workbook_masters,payroll.workbook_versions,payroll.workbook_originals TO ${identifier}`);
 await pool.query(`GRANT UPDATE(revision,updated_at) ON payroll.workbook_masters TO ${identifier}`);
 console.log('WORKBOOK_DATABASE_MIGRATED');
}finally{await pool.end();}
const client=new Pool({connectionString:runtime,max:1});
try{
 await client.query('SELECT revision FROM payroll.workbook_masters LIMIT 0');
 await client.query('SELECT snapshot FROM payroll.workbook_versions LIMIT 0');
 await client.query('SELECT bytes FROM payroll.workbook_originals LIMIT 0');
 console.log('WORKBOOK_RUNTIME_DATABASE_PASS');
}finally{await client.end();}
