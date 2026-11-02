import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import XLSX from 'xlsx';
import '../public/salary/payroll-engine.js';
import {createWorkbookJobs} from '../server/payroll/workbooks/jobs.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const context=vm.createContext({Uint8Array});
vm.runInContext(readFileSync(new URL('../public/salary/input-templates.js',import.meta.url),'utf8'),context);
const templates=context.PayrollInputTemplates;
const grossKeys=['roster','salary','performance','attendance','other'];
const netKeys=['grossUpload','tax','netBenefits','afterTax'];
const expected={roster:['roster'],salary:['salary'],performance:['performance'],attendance:['attendance'],other:['other'],grossUpload:['grossUpload'],tax:['tax'],netBenefits:['netSocial','netFund'],afterTax:['afterTax'],gross:grossKeys,net:['grossUpload','tax','netSocial','netFund','afterTax']};
const values={产检假天数:0.5,产假天数:1,陪产假天数:2,婚假天数:1,丧假天数:0.5,哺乳假天数:1,备注:'假期按天填写',姓名:'模板测试人员',工号:'0000123',公司:'测试公司',一级部门:'研发部',二级部门:'研发组',三级部门:'项目组',职位:'工程师',入职日期:'2025-01-01',离职日期:'',劳动合同止:'',转正日期:'',银行卡号:'000123456789012345678',开户行:'测试银行',是否实习生:'否',基本工资:8000,岗位工资:1000,绩效基数:500,绩效系数:0.9,实际出勤天数:22,个人总计:200,公司总计:500,个人缴纳:100,个人补缴:20,公司缴纳:100,'应补（退）税额':-50,应发工资:10000,其他加:30};
function filled(key){
 const output=templates.build(XLSX,key,'2026-09');
 return fill(output);
}
function fill(output){
 for(const name of output.workbook.SheetNames.filter(name=>name!=='填写说明')){
  const sheet=output.workbook.Sheets[name];
  const headers=XLSX.utils.sheet_to_json(sheet,{header:1,range:0})[0];
  XLSX.utils.sheet_add_aoa(sheet,[headers.map(header=>Object.hasOwn(values,header)?values[header]:0)],{origin:'A2'});
 }
 return output;
}
async function result(jobs,job){
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){
  const status=jobs.get('template-test',job.id);
  if(status.status==='failed')throw new Error(status.error);
  if(status.status==='completed')return JSON.parse(jobs.result('template-test',job.id).bytes);
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 throw new Error('Template import timed out');
}
async function imported(jobs,output,key,stage){
 const job=jobs.submit('template-test',{action:'source-import',key,filename:output.filename,month:'2026-09',stage,bytes:XLSX.write(output.workbook,{type:'buffer',bookType:'xlsx'})});
 return result(jobs,job);
}
test('all templates contain blank data sheets, isolated instructions and text identity columns',()=>{
 for(const key of [...grossKeys,...netKeys]){
  const {workbook,filename}=templates.build(XLSX,key,'2026-09');
  assert.match(filename,/_2026-09\.xlsx$/);
  const read=XLSX.read(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{cellNF:true});
  for(const name of read.SheetNames){
   const rows=XLSX.utils.sheet_to_json(read.Sheets[name],{header:1,blankrows:false}).filter(row=>row.some(cell=>cell!==''&&cell!=null));
   if(name==='填写说明'){
    assert(!rows.some(row=>row.some(cell=>cell==='姓名')),'instructions must not be mistaken for employee headers');
   }else{
    assert.equal(rows.length,1,`${key}/${name} contains no employees`);
    for(const header of ['工号','银行卡号']){
     const index=rows[0].indexOf(header);
     if(index>=0)assert.equal(read.Sheets[name][XLSX.utils.encode_cell({r:1,c:index})].z,'@');
    }
   }
  }
 }
});
test('individual templates round trip through the actual server import worker with explicit and automatic targets',async()=>{
 const jobs=createWorkbookJobs({root});
 try{
  for(const key of [...grossKeys,...netKeys])for(const target of [key,'']){
   const data=await imported(jobs,filled(key),target,grossKeys.includes(key)?'gross':'net');
   assert.deepEqual(data.metadata.importItems.map(item=>item.key),expected[key],`${key} / ${target||'bulk'}`);
   assert.equal(data.rows.length,expected[key].length);
   assert(data.rows.every(row=>row.姓名==='模板测试人员'));
   assert(!data.metadata.sheetNames?.includes('填写说明'));
   if(key==='roster'||key==='grossUpload'){
    assert.equal(data.rows[0].工号,'0000123');
    assert.equal(data.rows[0].银行卡号,'000123456789012345678');
   }
   if(key==='netBenefits')assert.equal(data.rows.find(row=>row.个人公积金!==undefined).个人公积金,120);
   if(key==='tax')assert.equal(data.rows[0].税,-50);
   if(key==='attendance'){
    assert.equal(globalThis.PayrollEngine.paidLeaveFromRow(data.rows[0]).days,6);
    assert.equal(data.rows[0].备注,'假期按天填写');
   }
  }
 }finally{jobs.close();}
});
test('blank templates never produce employee rows on the server',async()=>{
 const jobs=createWorkbookJobs({root});
 try{
  for(const key of [...grossKeys,...netKeys]){
   try{
    const data=await imported(jobs,templates.build(XLSX,key,'2026-09'),key,grossKeys.includes(key)?'gross':'net');
    assert.equal(data.rows.length,0,key);
   }catch(error){
    assert.match(error.message,/没有可读取|没有员工数据行|未找到|对应数值列不唯一/);
   }
  }
 }finally{jobs.close();}
});
