import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import XLSX from 'xlsx';
const base=new URL('../public/salary/',import.meta.url);
function app(){
 const el={addEventListener(){},classList:{add(){},remove(){},toggle(){}},textContent:''};
 const context=vm.createContext({document:{getElementById:()=>({...el}),querySelectorAll:()=>[],addEventListener(){}},window:{XLSX},structuredClone,setTimeout:()=>0,clearTimeout(){},__PAYROLL_TEST__:true});
 const run=code=>vm.runInContext(code,context);
 for(const f of ['payroll-engine.js','payroll-email-engine.js'])run(fs.readFileSync(new URL(f,base),'utf8'));
 const html=fs.readFileSync(new URL('index.html',base),'utf8');run(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
 run('render=()=>{};showToast=()=>{};');run(fs.readFileSync(new URL('workbench-core.js',base),'utf8'));
 run(`sourceRows={roster:[{姓名:'甲',公司:'测试公司',一级部门:'研发部',是否入离职:'在职'}],salary:[{姓名:'甲',基本工资:8000,岗位工资:2000,绩效基数:1200}],performance:[{姓名:'甲',绩效系数:1}],attendance:[{姓名:'甲',实际出勤天数:22,餐补合计:300}],other:[{姓名:'甲',其他加:0}],netSocial:[{姓名:'甲',个人总计:800,公司总计:1200}],netFund:[{姓名:'甲',个人缴纳:300,公司缴纳:300}],tax:[{姓名:'甲',税:200}],afterTax:[{姓名:'甲',水电代扣:0,餐费代扣:200,其它代扣:0}]};state.liveImport=true;state.sourceStatus.roster={uploaded:true};currentWorkdays=22;currentMonth='2026-08';state.payrollStage='gross';recalculateEmployees();state.selectedId=employees[0].id;globalThis.W=PayrollWorkbench;`);
 return run;
}
test('gross item edits survive recalculation, preserve sources, and reach generated net',()=>{
 const r=app(),before=r('JSON.stringify(sourceRows)');assert.equal(r('employees[0].gross'),11500);
 r("W.saveChange(employees[0],'otherAdd',200,'补发');recalculateEmployees();");assert.equal(r('employees[0].gross'),11700);assert.equal(r('JSON.stringify(sourceRows)'),before);
 r("state.payrollStage='net';recalculateEmployees()");assert.equal(r('employees[0].net'),10200);
 assert.match(r("visibleIssues(employees[0]).join('；')"),/个税/);
});
test('preview does not commit and cancel restores the result',()=>{
 const r=app();r("W.previewChange(employees[0],'otherAdd',200)");assert.equal(r('employees[0].gross'),11700);assert.equal(r('W.data().history.length'),0);
 r('W.clearPreview()');assert.equal(r('employees[0].gross'),11500);
});
test('net deductions are stage local and source totals stay immutable',()=>{
 const r=app();r("state.payrollStage='net';recalculateEmployees();W.saveChange(employees[0],'mealDeduct',150,'餐费更正');recalculateEmployees()");
 assert.equal(r('employees[0].net'),10050);assert.equal(r('employees[0].afterTaxTotal'),150);assert.equal(r('sourceRows.afterTax[0].餐费代扣'),200);
 r("state.payrollStage='gross';recalculateEmployees()");assert.equal(r('employees[0].gross'),11500);assert.equal(r('employees[0].mealDeduct'),0);
});
test('final amounts are explicit targets, recoverable, and exported with correct net formulas',()=>{
 const r=app();r("W.saveChange(employees[0],'grossTarget',12000,'应发校正');state.payrollStage='net';recalculateEmployees();W.saveChange(employees[0],'netTarget',10800,'实发校正');recalculateEmployees()");
 assert.equal(r('employees[0].net'),10800);assert.equal(r('employees[0].netAdjustment'),300);
 const formula=r("detailSheet(false)[excelColumn(exportDescriptors(false).findIndex(x=>x[1]==='net'))+'3'].f");assert.match(formula,/\+\(300\)/);
 assert.equal(r("detailSheet(false)[excelColumn(exportDescriptors(false).findIndex(x=>x[1]==='net'))+'3'].v"),10800);
 r("W.resetField(employees[0],'netTarget')");assert.equal(r('employees[0].net'),10500);
});
test('upload gross wins and its deductions do not leak into generated-source edits',()=>{
 const r=app();r("state.payrollStage='net';recalculateEmployees();W.saveChange(employees[0],'mealDeduct',150,'生成来源更正');sourceRows.grossUpload=[{姓名:'甲',公司:'测试公司',一级部门:'研发部',应发工资:9000,是否实习生:'否'}];recalculateEmployees();state.selectedId=employees[0].id;");
 assert.equal(r('employees[0].gross'),9000);assert.equal(r('employees[0].mealDeduct'),200);
 r("W.saveChange(employees[0],'mealDeduct',100,'上传来源更正');state.payrollStage='gross';recalculateEmployees();state.selectedId=employees[0].id;W.saveChange(employees[0],'otherAdd',200,'补发');state.payrollStage='net';recalculateEmployees()");
 assert.equal(r('employees[0].gross'),9000);assert.equal(r('employees[0].net'),7600);
 r('delete sourceRows.grossUpload;recalculateEmployees()');assert.equal(r('employees[0].gross'),11700);assert.equal(r('employees[0].mealDeduct'),150);
});
test('undo restores prior overrides and records reversal',()=>{
 const r=app();r("W.saveChange(employees[0],'otherAdd',200,'第一笔');W.saveChange(employees[0],'otherAdd',300,'第二笔');W.undo(W.data().history[1].id)");assert.equal(r('employees[0].gross'),11700);
 r('W.undo(W.data().history[0].id)');assert.equal(r('employees[0].gross'),11500);assert.equal(r('W.data().history.every(h=>h.revoked)'),true);
});
test('invalid numbers and ambiguous employees cannot be committed',()=>{
 const r=app();for(const input of ['',NaN,'not a number',-1])assert.throws(()=>r(`W.saveChange(employees[0],'otherAdd',${JSON.stringify(input)},'更正')`));
 assert.throws(()=>r("W.saveChange(employees[0],'actualPaidDays',32,'更正')"));assert.throws(()=>r("W.saveChange(employees[0],'otherAdd',2,'')"));
 r('sourceRows.roster.push({...sourceRows.roster[0]});recalculateEmployees()');assert.throws(()=>r("W.saveChange(employees[0],'otherAdd',2,'更正')"),/重复姓名/);
});
test('batch changes restore independent edits',()=>{
 const r=app();r("W.saveChange(employees[0],'otherAdd',200,'本批次');globalThis.first=currentBatch();globalThis.second={name:'下一月',month:'2026-09',workdays:22};state.batches.push(second);setCurrentBatch(second);");assert.equal(r('W.data().history.length'),0);
 r('setCurrentBatch(first)');assert.equal(r('employees[0].gross'),11700);
});
test('reordered roster cannot transfer adjustments to another employee',()=>{
 const r=app();r("W.saveChange(employees[0],'otherAdd',200,'甲的补发');sourceRows.roster.unshift({姓名:'乙',公司:'测试公司',一级部门:'研发部',是否入离职:'在职'});recalculateEmployees()");assert.equal(r("employees.find(e=>e.name==='甲').otherAdd"),200);assert.equal(r("employees.find(e=>e.name==='乙').otherAdd"),0);
});
test('intern adjustments preserve the existing daily-pay rule and net target export',()=>{
 const r=app();r("sourceRows.roster[0].是否实习生='是';recalculateEmployees();W.saveChange(employees[0],'dailyRate',150,'日薪设置');");assert.equal(r('employees[0].gross'),3300);
 r("state.payrollStage='net';recalculateEmployees();W.saveChange(employees[0],'netTarget',3400,'劳务补助');");assert.equal(r('employees[0].net'),3400);assert.equal(r('employees[0].netAdjustment'),100);assert.equal(r('employees[0].social'),0);
});
test('summary formulas target the actual filtered export schema',()=>{
 const r=app();r("state.payrollStage='net';recalculateEmployees();W.saveChange(employees[0],'mealDeduct',150,'餐费');");
 const col=r("excelColumn(exportDescriptors(false).findIndex(d=>d[1]==='net'))");assert.match(r("summarySheet().K2.f"),new RegExp("'工资明细表'!"+col+"\\$3:"+col+"\\$3"));assert.equal(r('summarySheet().K2.v'),10050);
});
test('restoring gross recalculation invalidates tax review and prepared email',()=>{
 const r=app();r("W.saveChange(employees[0],'otherAdd',200,'补发');state.payrollStage='net';recalculateEmployees();W.saveChange(employees[0],'tax',200,'已核税');state.emailDraft={attachmentReady:true};state.payrollStage='gross';recalculateEmployees();W.resetField(employees[0],'otherAdd');state.payrollStage='net';recalculateEmployees()");
 assert.match(r("visibleIssues(employees[0]).join('；')"),/个税表/);assert.equal(r('state.emailDraft.workbenchStale'),true);assert.equal(r('state.emailDraft.attachmentReady'),false);
});
test('uploaded-source tax does not acknowledge generated-source tax review',()=>{
 const r=app();r("W.saveChange(employees[0],'otherAdd',200,'补发');sourceRows.grossUpload=[{姓名:'甲',公司:'测试公司',一级部门:'研发部',应发工资:9000}];state.payrollStage='net';recalculateEmployees();state.selectedId=employees[0].id;W.saveChange(employees[0],'tax',200,'上传来源核税');delete sourceRows.grossUpload;recalculateEmployees()");
 assert.match(r("visibleIssues(employees[0]).join('；')"),/应发已调整/);
});
test('changed identity creates visible orphaned adjustments and explicit relinking',()=>{
 const r=app();r("W.saveChange(employees[0],'otherAdd',200,'补发');sourceRows.roster[0].一级部门='销售部';recalculateEmployees()");
 assert.equal(r('W.orphaned().length'),1);assert.equal(r('payrollExportReady()'),false);
 r('W.rebind(W.orphaned()[0].key,\'gross\',W.key(employees[0]))');assert.equal(r('employees[0].gross'),11700);assert.equal(r('W.orphaned().length'),0);
});


test('original individual and bulk intern settings share detail edits and undo history',()=>{
 const r=app();r("sourceRows.roster[0].是否实习生='是';recalculateEmployees();W.saveChange(employees[0],'dailyRate',150,'明细修改');setInternDailyRate('甲',180)");
 assert.equal(r('employees[0].gross'),3960);assert.equal(r('W.overrides(employees[0]).dailyRate'),180);
 r("applyBulkInternRate(['甲'],200)");assert.equal(r('employees[0].gross'),4400);
 r('W.undo(W.data().history.at(-1).id)');assert.equal(r('employees[0].gross'),3960);
 r("state.payrollStage='net';recalculateEmployees()");assert.equal(r('employees[0].net'),3960);
});

test('reuploading an existing source retains adjustments and updates exports and email freshness',()=>{
 const r=app();r("W.saveChange(employees[0],'otherAdd',200,'补发');state.payrollStage='net';recalculateEmployees();ensureEmailDraft();state.emailDraft.attachmentReady=true;");
 r("sourceRows.salary[0].基本工资=9000;recalculateEmployees();ensureEmailDraft()");
 assert.equal(r('employees[0].gross'),12700);assert.equal(r('employees[0].net'),11200);
 assert.equal(r('state.emailDraft.workbenchStale'),true);assert.equal(r('state.emailDraft.attachmentReady'),false);
 assert.equal(r("detailSheet(false)[excelColumn(exportDescriptors(false).findIndex(x=>x[1]==='net'))+'3'].v"),11200);
 r('ensureEmailDraft(true)');assert.equal(r('!!state.emailDraft.workbenchStale'),false);
});


test('refreshing payroll description preserves edited recipient, name and subject',()=>{
 const r=app();r("state.payrollStage='net';recalculateEmployees();ensureEmailDraft();setEmailField('recipient','payroll@example.com');setEmailField('recipientName','李老师');setEmailField('subject','八月工资复核');ensureEmailDraft(true)");
 assert.equal(r('state.emailDraft.recipient'),'payroll@example.com');assert.equal(r('state.emailDraft.recipientName'),'李老师');assert.equal(r('state.emailDraft.subject'),'八月工资复核');
});
