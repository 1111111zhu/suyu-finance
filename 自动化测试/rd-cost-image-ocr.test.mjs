import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { parseImageNumber, parseCostImageTsv, recognizeCostImage, imageFormat } from '../database/rd/cost-image-ocr.mjs';
const fixture = rows => 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'+rows.flatMap((row,r)=>row.flatMap((text,c)=>text===null ? [] : [`5\t1\t1\t1\t${r+1}\t${c+1}\t${20+c*200}\t${20+r*40}\t${text.length*12}\t20\t95\t${text}`])).join('\n');
test('numeric punctuation remains exact, blank never becomes zero',()=>{
 assert.equal(parseImageNumber('１，２３４．５０'),1234.5);
 assert.equal(parseImageNumber('(1,234.50)'),-1234.5);
 assert.equal(parseImageNumber('￥ 100.25'),100.25);
 assert.equal(parseImageNumber(''),null);
 assert.equal(parseImageNumber('0'),0);
 for(const text of ['1,23','1O0','—','1.2.3','1,234,56'])assert.throws(()=>parseImageNumber(text),{status:422});
});
test('hours uses named columns and preserves missing project cell without shifting',()=>{
 const result=parseCostImageTsv(fixture([['姓名','10月','RD01','RD02'],['张三','160',null,'40'],['李四','160','100','60']]),'hours');
 assert.deepEqual(result.rows[2],['张三',160,null,40]);
 assert.equal(result.needsReview,true); assert.match(result.warning,/未自动填零/);
});
test('salary and balance recognized into original header contracts',()=>{
 assert.deepEqual(parseCostImageTsv(fixture([['人员名称','10月工资费用'],['张三','10,000.50']]),'salary').rows,[['人员名称','10月工资费用'],['张三',10000.5]]);
 const result=parseCostImageTsv(fixture([['费用项目','研发项目','借方发生(原币)'],['材料','RD01','1,200.00']]),'balance');
 assert.deepEqual(result.rows[1],['材料','RD01',1200]);
});
test('ledger preserves dates, missing credit, explicit debit zero',()=>{
 const result=parseCostImageTsv(fixture([['日期','摘要','借方','贷方','研发项目','费用项目'],['2026-10-01','材料','0',null,'RD01','直接材料']]),'ledger');
 assert.deepEqual(result.rows[1],['2026-10-01','材料',0,null,'RD01','直接材料']);
});
test('reject missing headers, no data, missing row keys and ambiguous headers',()=>{
 for(const rows of [[],[['姓名','工资费用']],[['姓名','工资费用'],[null,'100']],[['姓名','工资费用'],['姓名','工资费用'],['张三','100']]]) {
  assert.throws(()=>parseCostImageTsv(fixture(rows),'salary'),{status:422});
 }
 assert.throws(()=>parseCostImageTsv(fixture([['姓名','10月','RD01'],['张三','160','160']]),'hours'),{status:422});
});
test('image magic required, executable args fixed and files ephemeral on success/failure',async()=>{
 const png=Buffer.from([137,80,78,71,13,10,26,10]);
 assert.equal(imageFormat(png),'png'); assert.throws(()=>imageFormat(Buffer.from('fake.png')),{status:422});
 let path;
 const executor=async(command,args,options)=>{assert.equal(command,process.env.RD_OCR_PYTHON || '/opt/suyu-finance/ocr-venv/bin/python3'); assert.match(args[0],/rapidocr_bridge\.py$/); assert.equal(options.timeout,120000);path=args[1]; await access(path);return {stdout:fixture([['姓名','工资费用'],['张三','100']])};};
 const result=await recognizeCostImage(png,'salary',{executor});assert.equal(result.rows[1][1],100);await assert.rejects(access(path));
 await assert.rejects(recognizeCostImage(png,'salary',{executor:async(_command,args)=>{path=args[1];throw new Error('SECRET /tmp/location');}}),error=>error.status===503&&!error.message.includes('SECRET'));
 await assert.rejects(access(path));
});

test('hours preserves project-name metadata and ambiguous RD header for human correction',()=>{
 const result=parseCostImageTsv(fixture([['姓名','10月','RDO1','RD02'],[null,null,'控制器项目','系统项目'],['张三','160','100','60']]),'hours');
 assert.equal(result.rows[0][2],'RDO1'); assert.deepEqual(result.rows[1],[null,null,'控制器项目','系统项目']); assert.deepEqual(result.rows[2],['张三',160,100,60]);
});

test('uncertain numeric OCR retained raw for blocked human review',()=>{ const result=parseCostImageTsv(fixture([['姓名','工资费用'],['张三','1O0.00']]),'salary'); assert.equal(result.rows[1][1],'1O0.00'); assert.match(result.warning,/保留原文/); });
test('unavailable RapidOCR fails sanitized without a low-accuracy fallback',async()=>{
 const png=Buffer.from([137,80,78,71,13,10,26,10]); let calls=0, path;
 await assert.rejects(recognizeCostImage(png,'salary',{executor:async(_command,args)=>{path=args[1];calls++;throw new Error('SECRET');}}),{status:503});
 assert.equal(calls,1);await assert.rejects(access(path));
});
test('nested and alphanumeric project headers retain full engine-compatible codes',()=>{ const result=parseCostImageTsv(fixture([['姓名','10月','RD2026-01','RC2026-A1'],[null,null,'平台','硬件'],['张三','160','100','60']]),'hours'); assert.deepEqual(result.rows[0],['姓名','10月','RD2026-01','RC2026-A1']); assert.deepEqual(result.rows[2],['张三',160,100,60]); });
test('right-aligned numeric cells stay before next header left edge',()=>{
 const header='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n';
 const words=[[20,20,24,'序号'],[220,20,48,'姓名'],[420,20,36,'10月'],[620,20,48,'RD01'],[820,20,48,'RD02'],[180,60,12,'1'],[220,60,36,'张三'],[560,60,36,'160'],[760,60,36,'100'],[970,60,24,'20']];
 const tsv=header+words.map(([x,y,w,text],i)=>`5\t1\t1\t1\t1\t${i+1}\t${x}\t${y}\t${w}\t20\t95\t${text}`).join('\n');
 const result=parseCostImageTsv(tsv,'hours');assert.deepEqual(result.rows[2],['1','张三',160,100,20]);
});
test('cosmetic quotation around categorical header is removed only from header',()=>{
 const result=parseCostImageTsv(fixture([['”费用项目','研发项目','借方发生(原币)'],['“直接材料”','RD01项目A','3000']]),'balance');
 assert.equal(result.rows[0][0],'费用项目');assert.equal(result.rows[1][0],'“直接材料”');
});

test('one OCR process at a time prevents memory exhaustion',async()=>{
 const png=Buffer.from([137,80,78,71,13,10,26,10]);let release, started;
 const entered=new Promise(resolve=>{started=resolve;});
 const first=recognizeCostImage(png,'salary',{executor:async()=>{started();await new Promise(resolve=>{release=resolve;});return {stdout:fixture([['姓名','工资费用'],['张三','100']])};}});
 await entered;
 await assert.rejects(recognizeCostImage(png,'salary',{executor:async()=>{throw new Error('must not execute');}}),error=>error.status===503&&error.code==='RD_IMAGE_OCR_BUSY');
 release(); await first;
 const result=await recognizeCostImage(png,'salary',{executor:async()=>({stdout:fixture([['姓名','工资费用'],['张三','200']])})});assert.equal(result.rows[1][1],200);
});

test('RapidOCR bridge maps polygon/confidence into clean TSV without data invention',async()=>{
 const script=`import importlib.util
spec=importlib.util.spec_from_file_location('bridge','database/rd/rapidocr_bridge.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
tsv=m.output_tsv([[[10,20],[110,20],[110,40],[10,40]]],['姓名\\t测试'],[.95])
assert '\\t10\\t20\\t100\\t20\\t95.0\\t姓名 测试' in tsv
assert m.output_tsv(None,None,None)==m.TSV_HEADER+'\\n'
try:
 m.output_tsv([[[float('nan'),1]]],['secret'],[.9]);raise AssertionError('expected rejection')
except ValueError:pass
print('ok')`;
 const {stdout}=await promisify(execFile)('python3',['-c',script]);assert.equal(stdout.trim(),'ok');
});
test('observed grid lines split merged OCR boxes by recropping, never by text guesses',async()=>{
 const script=`import importlib.util, cv2, numpy as np
spec=importlib.util.spec_from_file_location('bridge','database/rd/rapidocr_bridge.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
image=np.full((200,220,3),255,np.uint8)
for x in (10,100,200):cv2.line(image,(x,0),(x,199),(0,0,0),1)
box=[[[90,50],[150,50],[150,70],[90,70]]]
calls=[]
def read(cell):
 calls.append(cell.shape)
 return ('1' if cell.shape[1]==86 else '测试员工甲',.99)
boxes,texts,scores=m.split_crossing_cells(image,box,['1测试员工甲'],[.9],read)
assert tuple(texts)==('1','测试员工甲'),texts
assert len(calls)==2
white=np.full((200,220,3),255,np.uint8)
assert m.split_crossing_cells(white,box,['1测试员工甲'],[.9],read)[1]==['1测试员工甲']
print('ok')`;
 const {stdout}=await promisify(execFile)('python3',['-c',script]);assert.equal(stdout.trim(),'ok');
});
test('spreadsheet coordinate chrome is removed before clustering data rows',()=>{
 const header='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n';
 const words=[[57,211,55,34,'序号'],[262,212,95,31,'人员名称'],[736,214,138,28,'10月工资费用'],[21,370,18,23,'6'],[62,375,198,35,'3'],[264,375,468,35,'测试员工丙'],[1385,382,92,27,'2,000.00']];
 const tsv=header+words.map(([x,y,w,h,text],i)=>`5\t1\t1\t1\t1\t${i+1}\t${x}\t${y}\t${w}\t${h}\t95\t${text}`).join('\n');
 assert.deepEqual(parseCostImageTsv(tsv,'salary').rows,[['序号','人员名称','10月工资费用'],['3','测试员工丙',2000]]);
});
