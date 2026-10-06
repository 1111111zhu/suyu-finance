import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {openTestDatabase} from './helpers/payroll-postgres.mjs';
import {migrate} from '../database/rd/migrate.mjs';

test('真实HTTP接口新增、确认后软删、回收站恢复、费用联动及来源保护',async()=>{
  const db=await openTestDatabase();let child,closed;
  try{
    await migrate(db.pool);
    const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');
    const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
    const c=db.connectionOptions;
    const connection=c.connectionString||`postgresql://${c.user}@localhost/${c.database}?host=${encodeURIComponent(c.host)}&port=${c.port}`;
    child=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{env:{...process.env,RD_DATABASE_URL:connection,RD_LOCAL_PREVIEW:'1'},stdio:['ignore','pipe','pipe']});
    let log='';child.stdout.on('data',b=>{log+=b;});child.stderr.on('data',b=>{log+=b;});closed=once(child,'exit');
    const base=`http://127.0.0.1:${port}`;
    let ready=false;
    for(let n=0;n<150;n++){
      try{if((await fetch(base+'/api/rd/platforms')).ok){ready=true;break;}}catch{}
      if(child.exitCode!==null)break;
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    assert.ok(ready,'Temporary API did not start: '+log.slice(-2000));
    async function api(path,body,method='POST',expected=200,origin=base){
      const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:origin},...(body===undefined?{}:{body:JSON.stringify(body)})});
      const raw=await r.text();assert.equal(r.status,expected,raw);
      return r.headers.get('content-type')?.includes('application/json')?JSON.parse(raw):raw;
    }
    await api('/api/rd/manage',{action:'create',kind:'platform',name:'HTTP验收平台',number:'QA-HTTP'});
    const platform=(await api('/api/rd/platforms',undefined,'GET')).platforms[0];
    await api('/api/rd/manage',{action:'create',kind:'project',platformId:platform.id,name:'HTTP验收项目',number:'RD-HTTP'});
    const project=(await api('/api/rd/projects',undefined,'GET')).projects[0];
    await api('/api/rd/calculation-batches',{requestKey:randomUUID(),scope:'验收主体',year:2026,month:9,total:'10.01',files:[],projects:[{code:'RD-HTTP',total:'10.01',costs:[{category:'直接材料',amount:'10.01'}]}]});
    assert.equal((await api('/api/rd/platforms',undefined,'GET')).platforms[0].actual,10.01);
    await api('/api/rd/projects/'+project.id,undefined,'DELETE');
    assert.equal((await api('/api/rd/projects',undefined,'GET')).projects.length,0);
    const trash=(await api('/api/rd/trash',undefined,'GET')).items;
    assert.equal(trash[0].actual,10.01);
    await api('/api/rd/manage',{action:'restore',kind:'project',id:project.id});
    assert.equal((await api('/api/rd/projects',undefined,'GET')).projects[0].actual,10.01);
    await api('/api/rd/manage',{action:'delete',kind:'platform',id:platform.id});
    assert.equal((await api('/api/rd/platforms',undefined,'GET')).platforms.length,0);
    await api('/api/rd/manage',{action:'restore',kind:'platform',id:platform.id});
    assert.equal((await api('/api/rd/platforms',undefined,'GET')).platforms[0].actual,10.01);
    await api('/api/rd/manage',{action:'create',kind:'project',platformId:platform.id,name:'重复',number:'RD-HTTP'},'POST',422);
    await api('/api/rd/manage',{action:'delete',kind:'project',id:project.id},'POST',403,'https://untrusted.invalid');
    await api('/api/rd/calculations',{},'POST',410);
    assert.equal((await db.pool.query('SELECT count(*) FROM rd.ledger_entries')).rows[0].count,'1');
  }finally{
    if(child&&child.exitCode===null)child.kill('SIGTERM');
    if(closed)await closed;
    await db.close();
  }
});
