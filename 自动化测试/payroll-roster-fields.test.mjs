import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fromLegacyPayrollRow } from '../database/payroll/fields.mjs';

const salaryRoot = new URL('../public/salary/', import.meta.url);
const engineText = fs.readFileSync(new URL('payroll-engine.js', salaryRoot), 'utf8');
const html = fs.readFileSync(new URL('index.html', salaryRoot), 'utf8');

function engine() {
  const context = vm.createContext({Date});
  vm.runInContext(engineText, context);
  return expression => { const value=vm.runInContext(expression, context);return value===undefined?undefined:JSON.parse(JSON.stringify(value)); };
}

function app() {
  const element={addEventListener(){},classList:{add(){},remove(){},toggle(){}},textContent:''};
  const context=vm.createContext({document:{getElementById:()=>({...element}),querySelectorAll:()=>[],addEventListener(){}},window:{},structuredClone,setTimeout:()=>0,clearTimeout(){}});
  const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1].replace("    render('overview');\n  ", '');
  assert.ok(inline, 'salary inline application script exists');
  vm.runInContext(engineText, context);
  vm.runInContext(inline, context);
  vm.runInContext('render=()=>{};showToast=()=>{};', context);
  return expression => { const value=vm.runInContext(expression, context);return value===undefined?undefined:JSON.parse(JSON.stringify(value)); };
}

test('the supplied 38-column header-only roster maps salary-required fields without column positions', () => {
  const run=engine();
  const headers=['序号','姓名','工号','一级部门','二级部门','三级部门','职位','代任岗位','签约公司','性别','年龄',
    '入职时间','转正日期','劳动合同起','劳动合同止','第一份劳动合同','员工类型','员工状态','政治面貌','学历',
    '毕业院校','专业','专业技术职称','毕业时间','证件号码','出生日期','手机号','紧急联系人','紧急联系方式',
    '户籍性质','籍贯','身份证地址','现居住地址','银行卡号','开户行','上家单位','渠道','备注'];
  const mapping=run(`PayrollEngine.rosterFieldMap(${JSON.stringify(headers)})`);
  assert.deepEqual(mapping.issues,[]);
  assert.deepEqual(Object.fromEntries(['name','employeeNumber','company','dept','subdept','thirdDept','position',
    'join','regularizationDate','employmentType','status','bankCard','bankName'].map(key=>[key,mapping.map[key]])),{
    name:'姓名',employeeNumber:'工号',company:'签约公司',dept:'一级部门',subdept:'二级部门',
    thirdDept:'三级部门',position:'职位',join:'入职时间',regularizationDate:'转正日期',
    employmentType:'员工类型',status:'员工状态',bankCard:'银行卡号',bankName:'开户行'
  });
});

test('salary roster maps sample header aliases by keyword, independently of position', () => {
  const run=engine();
  const headers=['职位','员工状态','银行卡号','姓名','三级部门','签约公司','转正日期','员工类型','工号','开户行','入职时间','一级部门','离职日期'];
  const mapped=run(`PayrollEngine.rosterFieldMap(${JSON.stringify(headers)})`);
  assert.deepEqual(mapped.issues, []);
  assert.equal(mapped.map.name, '姓名');
  assert.equal(mapped.map.company, '签约公司');
  assert.equal(mapped.map.join, '入职时间');
  assert.equal(mapped.map.status, '员工状态');
  assert.equal(mapped.map.thirdDept, '三级部门');
  assert.equal(mapped.map.position, '职位');
  const row={职位:'工程师',员工状态:'在职',银行卡号:'0012345678901234',姓名:'测试甲',三级部门:'软件组',签约公司:'测试公司',转正日期:'2026/09/15',员工类型:'试用期',工号:'00042',开户行:'测试银行',入职时间:'2026年01月02日',一级部门:'研发',离职日期:''};
  const normalized=run(`PayrollEngine.normalizeRosterRow(${JSON.stringify(row)})`);
  assert.equal(normalized.values.employeeNumber, '00042');
  assert.equal(normalized.values.company, '测试公司');
  assert.equal(normalized.values.join, '2026-01-02');
  assert.equal(normalized.values.regularizationDate, '2026-09-15');
  assert.equal(normalized.values.employmentType, '试用');
  assert.equal(normalized.values.isIntern, false);
  assert.equal(normalized.values.status, '在职');
  assert.deepEqual(normalized.issues, []);
  assert.equal(normalized.sources.isIntern, '员工类型');
  assert.equal(normalized.sources.bankCard, '银行卡号');
  assert.ok(!JSON.stringify(normalized.issues).includes(row.银行卡号));
});

test('canonical roster header wins an alias but semantic duplicates require review', () => {
  const run=engine();
  const mapping=run("PayrollEngine.rosterFieldMap(['签约公司','姓名','公司','员工状态','员工类型'])");
  assert.equal(mapping.map.company, '公司');
  assert.ok(mapping.issues.some(issue=>issue.field==='company' && issue.reason==='ambiguous'));
  const twoAliases=run("PayrollEngine.rosterFieldMap(['姓名','签约公司','员工状态','在职状态','员工类型'])");
  assert.ok(!Object.hasOwn(twoAliases.map,'status'));
  assert.ok(twoAliases.issues.some(issue=>issue.field==='status' && issue.reason==='ambiguous'));
  const unknown=run("PayrollEngine.rosterFieldMap(['姓名','本月实习备注','员工状态'])");
  assert.ok(!Object.hasOwn(unknown.map,'isIntern'));
});

test('invalid dates, employment type and conflicting internship flags are explicit and do not leak bank values', () => {
  const run=engine();
  const row={姓名:'测试乙',员工状态:'未知状态',员工类型:'实习生',是否实习生:'否',入职时间:'2026-02-31',银行卡号:'00999988887777'};
  const result=run(`PayrollEngine.normalizeRosterRow(${JSON.stringify(row)})`);
  assert.ok(result.issues.some(issue=>issue.field==='status' && issue.reason==='invalid'));
  assert.ok(result.issues.some(issue=>issue.field==='join' && issue.reason==='invalid'));
  assert.ok(result.issues.some(issue=>issue.field==='isIntern' && issue.reason==='conflict'));
  assert.ok(!JSON.stringify(result.issues).includes(row.银行卡号));
  const joining=run("PayrollEngine.normalizeRosterRow({姓名:'测试丙',员工状态:'入职',员工类型:'正式'})");
  assert.ok(joining.issues.some(issue=>issue.field==='join' && issue.reason==='missing'));
  const leaving=run("PayrollEngine.normalizeRosterRow({姓名:'测试丁',员工状态:'离职',员工类型:'正式'})");
  assert.ok(leaving.issues.some(issue=>issue.field==='leave' && issue.reason==='missing'));
});

test('server legacy field mapping accepts the same salary-facing roster aliases', () => {
  assert.deepEqual(fromLegacyPayrollRow({签约公司:'测试公司',入职时间:'2026-09-01',员工状态:'在职',开户银行:'测试银行',本月是否为实习生:'否'}), {
    values:{company:'测试公司',join:'2026-09-01',status:'在职',bankName:'测试银行',isIntern:'否'},unmapped:{}
  });
});

test('salary import reads aliases, keeps roster regularization authoritative and flags conflicts for confirmation', () => {
  const run=app();
  run("sourceRows={roster:[{姓名:'测试甲',工号:'00042',签约公司:'测试公司',一级部门:'研发',三级部门:'软件组',职位:'工程师',员工状态:'在职',员工类型:'试用期',入职时间:'2025-01-02',转正日期:'2026-09-15',银行卡号:'0012345678901234'}],salary:[{姓名:'测试甲',基本工资:10000,转正前工资:10000,转正后工资:20000,转正日期:'2026-09-15'}],attendance:[{姓名:'测试甲',实发薪天数:22}]};sourceRows.roster.sourceStartRow=5;state.liveImport=true;applyPayrollSettings('2026-09',22);");
  assert.equal(run('employees[0].company'),'测试公司');
  assert.equal(run('employees[0].join'),'2025-01-02');
  assert.equal(run('employees[0].employeeNumber'),'00042');
  assert.equal(run('employees[0].rosterRow'),5);
  assert.equal(run('employees[0].isIntern'),false);
  assert.equal(run('employees[0].regularizationDate'),'2026-09-15');
  assert.equal(run('employees[0].regularizationBlocked'),false);
  assert.equal(run('employees[0].probationWorkdays+employees[0].regularWorkdays'),22);
  assert.ok(!run('employees[0].payrollSourceBlocked'));
  run("sourceRows.salary[0].转正日期='2026-09-16';recalculateEmployees()");
  assert.equal(run('employees[0].regularizationDate'),'2026-09-15');
  assert.equal(run('employees[0].payrollSourceBlocked'),true);
  assert.match(run('employees[0].exception'),/转正日期冲突.*花名册.*基本工资表/);
  const slip=run("state.payrollStage='net';state.selectedId=employees[0].id;renderNetSlip()");
  assert.match(slip,/•••• 1234/);
  assert.ok(!slip.includes('0012345678901234'));
});


test('occupational employee types preserve their category and shared internship mapping handles all rows', () => {
  const run=engine();
  for (const [raw,expected,isIntern] of [['技术人员','技术人员',false],['经理','经理',false],['普通员工','普通员工',false],['实习生','实习',true]]) {
    const result=run(`PayrollEngine.normalizeRosterRow(${JSON.stringify({姓名:'测试人员',员工状态:'在职',员工类型:raw})}, {map:{name:'姓名',status:'员工状态',employmentType:'员工类型',isIntern:'员工类型'}})`);
    assert.equal(result.values.employmentType,expected);
    assert.equal(result.values.isIntern,isIntern);
    assert.equal(result.issues.length,0);
  }
  const unknown=run("PayrollEngine.normalizeRosterRow({姓名:'测试人员',员工状态:'在职',员工类型:'未知类别'})");
  assert.ok(unknown.issues.some(issue=>issue.field==='employmentType' && issue.reason==='invalid'));
});
