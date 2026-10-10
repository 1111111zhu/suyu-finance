import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import XLSX from 'xlsx';
const base=new URL('../public/salary/',import.meta.url);
function app(){
 const element={innerHTML:'',value:'',dataset:{},addEventListener(){},querySelectorAll:()=>[],classList:{add(){},remove(){},toggle(){}}};
 const c=vm.createContext({document:{getElementById:()=>({...element}),querySelectorAll:()=>[],addEventListener(){}},window:{XLSX},structuredClone,setTimeout:()=>0,clearTimeout(){},__PAYROLL_TEST__:true});
 const run=code=>vm.runInContext(code,c);
 for(const file of ['payroll-engine.js','payroll-email-engine.js'])run(fs.readFileSync(new URL(file,base),'utf8'));
 run(fs.readFileSync(new URL('index.html',base),'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
 run('render=()=>{};showToast=()=>{};bindView=()=>{};');
 for(const file of ['source-preview.js','workbench-core.js','workbench-pages.js','workbench-ui.js'])run(fs.readFileSync(new URL(file,base),'utf8'));
 run('render=()=>{};showToast=()=>{};bindView=()=>{};');
 run(`currentMonth='2026-09';currentWorkdays=22;state.sourceStatus={};sourceRows={};state.liveImport=true;state.payrollStage='gross';state.batches=[{name:'测试批次',month:currentMonth,workdays:22,active:true,draftOrigin:'empty',data:{internDailyRates:{}}}];`);
 return {run,importFiles:run('importFiles'),parse:run('parseXlsxFile')};
}
function file(name,sheets){
 const book=XLSX.utils.book_new();for(const [sheet,grid] of sheets)XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(grid),sheet);
 const bytes=XLSX.write(book,{type:'array',bookType:'xlsx'});
 return {name,size:bytes.byteLength,arrayBuffer:async()=>bytes};
}
const roster=(name,id)=>[['员工姓名','工号','入职日期'],[name,id,'2025-01-01']];

const grid=(rows)=>[['姓名','本月个人缴纳（元）','个人补缴金额'],...rows];
async function setup(){const a=app();await a.importFiles([file('花名册.xlsx',[['人员', [['姓名','工号','入职日期'],['甲','001','2025-01-01'],['乙','002','2025-01-01']]]])],'roster');a.run("state.payrollStage='net'");await a.importFiles([file('应发.xlsx',[['应发工资',[['姓名','应发工资'],['甲',1000],['乙',2000]]]])],'grossUpload');return a;}
test('one benefits module recognizes containing worksheet names and joins amounts by name',async()=>{
 const a=await setup();await a.importFiles([file('资料.xlsx',[['说明',[['说明']]],['2026年9月社保个人明细导出',grid([['乙',200,20],['甲',100,10]])],['公司公积金个人明细9月',grid([['甲',80,8],['乙',160,null]])]])],'netBenefits');
 assert.equal(a.run('employees.find(e=>e.name===\'甲\').social'),110);assert.equal(a.run('employees.find(e=>e.name===\'甲\').fund'),88);assert.equal(a.run('employees.find(e=>e.name===\'甲\').net'),802);
 assert.equal(a.run('employees.find(e=>e.name===\'乙\').net'),1620);assert.equal(a.run('benefitStatus().files'),1);assert.equal(a.run('importSession().items.length'),0);
 const html=a.run('PayrollWorkbenchPages.upload()');assert.match(html,/data-upload="netBenefits"/);assert.doesNotMatch(html,/data-upload="netSocial"|data-upload="netFund"/);
 assert.equal(a.run("sourcePreviewFiles('netBenefits').length"),1);
 const ws=a.run('detailSheet(false)'),descriptors=a.run('exportDescriptors(false)');const social=descriptors.findIndex(x=>x[1]==='social');assert.equal(ws[XLSX.utils.encode_col(social)+'3'].v,110);assert.match(ws[XLSX.utils.encode_col(social)+'3'].f,/SUM\(100,10\)/);
});
test('bulk import identifies personal worksheets without explicit module',async()=>{const a=await setup();await a.importFiles([file('文件.xlsx',[['社保个人明细2026',grid([['甲',10,1]])],['9月公积金个人明细',grid([['甲',20,2]])]])]);assert.equal(a.run('employees[0].social'),11);assert.equal(a.run('employees[0].fund'),22);});
test('replacement is atomic and combined deletion removes both deductions',async()=>{
 const a=await setup();const good=file('原始.xlsx',[['社保个人明细',grid([['甲',100,10]])],['公积金个人明细',grid([['甲',80,8]])]]);await a.importFiles([good],'netBenefits');
 await a.importFiles([file('坏.xlsx',[['社保个人明细',grid([['甲',999,1]])],['公积金个人明细',grid([['甲','错误',1]])]])],'netBenefits','replace');assert.equal(a.run('employees[0].social'),110);assert.equal(a.run('employees[0].fund'),88);
 await a.importFiles([file('新.xlsx',[['社保个人明细',grid([['甲',30,3]])],['公积金个人明细',grid([['甲',40,4]])]])],'netBenefits','replace');assert.equal(a.run('employees[0].social'),33);assert.equal(a.run('employees[0].fund'),44);assert.equal(a.run('benefitStatus().filename'),'新.xlsx');assert.equal(a.run("removeSource('netBenefits')"),true);assert.equal(a.run('employees[0].social'),0);assert.equal(a.run('employees[0].fund'),0);
});
test('unrecognized sheets and ambiguous amount headers fail without modifying sources',async()=>{
 const a=await setup();for(const sheets of [[['社保汇总',grid([['甲',1,2]])]],[['社保个人明细',[['姓名','个人缴纳','补发个人缴纳','个人补缴'],['甲',1,2,3]]]]]){await a.importFiles([file('错误.xlsx',sheets)],'netBenefits');assert.equal(a.run('sourceRows.netSocial'),undefined);assert.ok(a.run('importSession().items.length')>0);}
});

test('reuploading a combined filename removes worksheets no longer in that file',async()=>{const a=await setup();await a.importFiles([file('资料.xlsx',[['社保个人明细',grid([['甲',10,1]])],['公积金个人明细',grid([['甲',20,2]])]])],'netBenefits');await a.importFiles([file('资料.xlsx',[['社保个人明细',grid([['甲',30,3]])]])],'netBenefits');assert.equal(a.run('employees[0].social'),33);assert.equal(a.run('employees[0].fund'),0);assert.equal(a.run('benefitStatus().complete'),false);});
