import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context=vm.createContext({console});
vm.runInContext(fs.readFileSync(new URL('../public/salary/payroll-engine.js',import.meta.url),'utf8'),context);
vm.runInContext(fs.readFileSync(new URL('../public/salary/payroll-email-engine.js',import.meta.url),'utf8'),context);

test('extracts final-table events and renders the fixed Chinese email structure',()=>{
  const rows=[
    {姓名:'颜倩倩',公司:'溯驭技术',一级部门:'研发',调整前工资:5200,调整后工资:6200,调薪生效日期:'2026-07-01',公司总成本:6200},
    {姓名:'赵原野',公司:'溯驭技术',一级部门:'研发',是否入离职:'转正',转正日期:'2026-07-01',转正后工资:14000,公司总成本:14000},
    {姓名:'浦康钊',公司:'溯驭技术',一级部门:'研发',是否入离职:'离职',离职日期:'2026-07-20',公司总成本:0},
    {姓名:'王志峰',公司:'溯驭技术',一级部门:'研发',是否入离职:'入职',工作地点:'苏州',公司总成本:6000},
    {姓名:'王竞宇',公司:'溯驭技术',一级部门:'研发',事假天数:1,假勤扣薪天数:1,假勤扣款:965.52,公司总成本:7000},
    {姓名:'毕文龙',公司:'溯驭技术',一级部门:'研发',年假天数:.56,公司总成本:7000},
    {姓名:'张云锋',公司:'溯驭技术',一级部门:'研发',调休假系统余额:71,加班费:2414,公司总成本:2414},
    {姓名:'郭晓宇',公司:'溯驭技术',一级部门:'管理',实习生劳务:14000,公司总成本:14000}
  ];
  const draft=context.PayrollEmailEngine.extract(rows,{month:'2026-07',company:'溯驭技术技术有限公司'});
  assert.equal(draft.recipient,'2745738591@qq.com');
  assert.match(draft.subject,/2026年7月溯驭技术技术有限公司工资表/);
  assert.match(draft.sections.salaryAdjustments,/颜倩倩/);
  assert.match(draft.sections.salaryAdjustments,/5,200\.00元\/月/);
  assert.match(draft.sections.regularizations,/赵原野/);
  assert.match(draft.sections.departures,/浦康钊/);
  assert.match(draft.sections.newHires,/苏州：王志峰/);
  assert.match(draft.sections.attendanceDeduct,/王竞宇\t1\t965\.52/);
  assert.match(draft.sections.attendanceNoDeduct,/毕文龙\t年假\t0\.56/);
  assert.match(draft.sections.overtime,/张云锋\t71\t2,414\.00/);
  assert.match(draft.sections.internSubsidies,/郭晓宇\t14,000\.00元/);
  const body=context.PayrollEmailEngine.render(draft,{month:'2026-07',company:'溯驭技术技术有限公司'});
  assert.match(body,/董博：/);
  assert.match(body,/本月调薪人员/);
  assert.match(body,/本月合计发薪成本/);
  assert.match(body,/研发人员总成本/);
});

test('missing summary is blocked while a manual warning can be acknowledged',()=>{
  const engine=context.PayrollEmailEngine;
  const draft=engine.defaultDraft({month:'2026-07'});
  draft.summary={total:null,average:null,departments:[]};
  assert.equal(engine.validate(draft).status,'blocked');
  draft.summary={total:100,average:100,departments:[]};
  assert.equal(engine.validate(draft).status,'warning');
  draft.acknowledgedWarnings=true;
  assert.equal(engine.validate(draft).status,'passed');
});

test('editable sections and recipient survive body rendering without inventing empty events',()=>{
  const engine=context.PayrollEmailEngine;
  const draft=engine.extract([{姓名:'甲',公司:'溯驭技术',公司总成本:100}],{month:'2026-07'});
  assert.doesNotMatch(engine.render(draft,{month:'2026-07'}),/本月调薪人员/);
  draft.recipient='2745738591@qq.com';
  draft.sections.internSubsidies='董博团队学生7月仅补助餐费15元/天，7月合计补助2325元';
  const body=engine.render(draft,{month:'2026-07'});
  assert.match(body,/本月实习生劳务核算情况/);
  assert.match(body,/2325元/);
});
