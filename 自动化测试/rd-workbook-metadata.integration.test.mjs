import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {openTestDatabase} from './helpers/payroll-postgres.mjs';
import {migrate} from '../database/rd/migrate.mjs';
import {importCatalog} from '../database/rd/import-catalog.mjs';
import {importWorkbookMetadata} from '../database/rd/import-workbook-metadata.mjs';
import {createRdRepository} from '../database/rd/repository.mjs';

const workbook=process.env.RD_SOURCE_WORKBOOK||'/Users/zhujiaying/Desktop/研发项目命名规则及研发项目平台.xlsx';
test('Excel原表元数据保留项目ID、费用、跨平台归属并支持重复导入',{skip:!existsSync(workbook)},async()=>{
  const db=await openTestDatabase();
  try{
    await migrate(db.pool);
    await importCatalog(db.pool,'/nonexistent-source-images');
    const repo=createRdRepository(db.pool);
    const before=await repo.listProjects();
    await repo.recordProjectBatch({requestKey:randomUUID(),scope:'苏州',year:2026,month:9,total:'12.34',projects:[{code:'RD1250101',total:'12.34',costs:[{category:'材料',amount:'12.34'}]}]});
    for(let pass=0;pass<2;pass++)await importWorkbookMetadata(db.pool,workbook);
    const projects=await repo.listProjects(),platforms=await repo.listPlatforms();
    assert.deepEqual(projects.map(p=>p.id),before.map(p=>p.id));
    assert.equal(projects.length,41);assert.equal(platforms.length,6);
    assert.equal(platforms.reduce((n,p)=>n+p.codes.length,0),9);
    await assert.rejects(repo.manage({action:'create',kind:'platform',number:'RD12501',name:'重复历史编码'}),/历年编码/);
    const tools=projects.find(p=>p.number==='RD1250101');
    assert.equal(tools.actual,12.34);assert.equal(tools.materials.length,3);assert.equal(tools.sourceStatus,'暂停');
    assert.equal(platforms.find(p=>p.id==='electronic').actual,12.34);
    assert.equal(tools.sourceRecords.filter(r=>r.filename.endsWith('.xlsx')).length,1);
    assert.equal(projects.find(p=>p.number==='RD141031-1').parentNumber,'RD141031');
    assert.equal(projects.find(p=>p.number==='RD141031-5').parentNumber,null);
    assert.equal(projects.find(p=>p.number==='RD141031-5').platformId,'frontier');
    assert.equal(projects.find(p=>p.number==='RD2260203').financialEntity,'杭州');
    assert.equal(projects.find(p=>p.number==='RD12502-01').financialEntity,null);
    assert.equal(projects.find(p=>p.number==='RD141031').financialEntity,null);
    const newProject=await repo.createProject({number:'MANUAL-1',name:'手动新增',platformId:'electronic'});
    assert.deepEqual(newProject.materials,[]);assert.equal(newProject.parentNumber,null);assert.equal(newProject.sourceStatus,null);
  }finally{await db.close();}
});
