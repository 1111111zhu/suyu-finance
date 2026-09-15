ALTER TABLE payroll.items ADD COLUMN name text;
COMMENT ON COLUMN payroll.items.name IS '姓名；JS: name';
ALTER TABLE payroll.items ADD COLUMN company text;
COMMENT ON COLUMN payroll.items.company IS '公司；JS: company';
ALTER TABLE payroll.items ADD COLUMN dept text;
COMMENT ON COLUMN payroll.items.dept IS '一级部门；JS: dept';
ALTER TABLE payroll.items ADD COLUMN subdept text;
COMMENT ON COLUMN payroll.items.subdept IS '二级部门；JS: subdept';
ALTER TABLE payroll.items ADD COLUMN bank_card text;
COMMENT ON COLUMN payroll.items.bank_card IS '银行卡号；JS: bankCard';
ALTER TABLE payroll.items ADD COLUMN bank_name text;
COMMENT ON COLUMN payroll.items.bank_name IS '开户行；JS: bankName';
ALTER TABLE payroll.items ADD COLUMN status text;
COMMENT ON COLUMN payroll.items.status IS '是否入离职；JS: status';
ALTER TABLE payroll.items ADD COLUMN join_date date;
COMMENT ON COLUMN payroll.items.join_date IS '入职日期；JS: join';
ALTER TABLE payroll.items ADD COLUMN leave_date date;
COMMENT ON COLUMN payroll.items.leave_date IS '离职日期；JS: leave';
ALTER TABLE payroll.items ADD COLUMN workdays numeric(10,4) CHECK (workdays <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.workdays IS '应发薪；JS: workdays';
ALTER TABLE payroll.items ADD COLUMN payable_days numeric(10,4) CHECK (payable_days <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.payable_days IS '实发薪天数；JS: payableDays';
ALTER TABLE payroll.items ADD COLUMN base numeric(18,2) CHECK (base <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.base IS '基本工资；JS: base';
ALTER TABLE payroll.items ADD COLUMN post numeric(18,2) CHECK (post <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.post IS '岗位工资；JS: post';
ALTER TABLE payroll.items ADD COLUMN perf_base numeric(18,2) CHECK (perf_base <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.perf_base IS '绩效基数；JS: perfBase';
ALTER TABLE payroll.items ADD COLUMN effective_score numeric(10,4) CHECK (effective_score <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.effective_score IS '绩效分数；JS: effectiveScore';
ALTER TABLE payroll.items ADD COLUMN performance_pay numeric(18,2) CHECK (performance_pay <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.performance_pay IS '绩效工资；JS: performancePay';
ALTER TABLE payroll.items ADD COLUMN subtotal numeric(18,2) CHECK (subtotal <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.subtotal IS '工资小计；JS: subtotal';
ALTER TABLE payroll.items ADD COLUMN meal numeric(18,2) CHECK (meal <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.meal IS '餐饮津贴；JS: meal';
ALTER TABLE payroll.items ADD COLUMN transit numeric(18,2) CHECK (transit <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.transit IS '交通津贴；JS: transit';
ALTER TABLE payroll.items ADD COLUMN other_allow numeric(18,2) CHECK (other_allow <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.other_allow IS '其他津贴；JS: otherAllow';
ALTER TABLE payroll.items ADD COLUMN sick_subsidy numeric(18,2) CHECK (sick_subsidy <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.sick_subsidy IS '病假补贴；JS: sickSubsidy';
ALTER TABLE payroll.items ADD COLUMN other_add numeric(18,2) CHECK (other_add <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.other_add IS '其他加；JS: otherAdd';
ALTER TABLE payroll.items ADD COLUMN annual numeric(10,4) CHECK (annual <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.annual IS '年假天数；JS: annual';
ALTER TABLE payroll.items ADD COLUMN flexible numeric(10,4) CHECK (flexible <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.flexible IS '弹性假天数；JS: flexible';
ALTER TABLE payroll.items ADD COLUMN compensatory numeric(10,4) CHECK (compensatory <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.compensatory IS '调休假天数；JS: compensatory';
ALTER TABLE payroll.items ADD COLUMN sick numeric(10,4) CHECK (sick <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.sick IS '病假天数；JS: sick';
ALTER TABLE payroll.items ADD COLUMN personal numeric(10,4) CHECK (personal <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.personal IS '事假天数；JS: personal';
ALTER TABLE payroll.items ADD COLUMN absent numeric(10,4) CHECK (absent <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.absent IS '旷工天数；JS: absent';
ALTER TABLE payroll.items ADD COLUMN deduct_days numeric(10,4) CHECK (deduct_days <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.deduct_days IS '假勤扣薪天数；JS: deductDays';
ALTER TABLE payroll.items ADD COLUMN attendance_deduct numeric(18,2) CHECK (attendance_deduct <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.attendance_deduct IS '假勤扣款；JS: attendanceDeduct';
ALTER TABLE payroll.items ADD COLUMN other_reduction numeric(18,2) CHECK (other_reduction <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.other_reduction IS '其他减；JS: otherReduction';
ALTER TABLE payroll.items ADD COLUMN gross numeric(18,2) CHECK (gross <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.gross IS '应发工资；JS: gross';
ALTER TABLE payroll.items ADD COLUMN social numeric(18,2) CHECK (social <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.social IS '个人社保；JS: social';
ALTER TABLE payroll.items ADD COLUMN fund numeric(18,2) CHECK (fund <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.fund IS '个人公积金；JS: fund';
ALTER TABLE payroll.items ADD COLUMN is_intern boolean;
COMMENT ON COLUMN payroll.items.is_intern IS '是否实习生；JS: isIntern';
ALTER TABLE payroll.items ADD COLUMN daily_rate numeric(18,2) CHECK (daily_rate <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.daily_rate IS '日薪；JS: dailyRate';
ALTER TABLE payroll.items ADD COLUMN regularization_date date;
COMMENT ON COLUMN payroll.items.regularization_date IS '转正日期；JS: regularizationDate';
ALTER TABLE payroll.items ADD COLUMN probation_workdays numeric(10,4) CHECK (probation_workdays <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.probation_workdays IS '转正前应出勤天数；JS: probationWorkdays';
ALTER TABLE payroll.items ADD COLUMN regular_workdays numeric(10,4) CHECK (regular_workdays <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.regular_workdays IS '转正后应出勤天数；JS: regularWorkdays';
ALTER TABLE payroll.items ADD COLUMN probation_salary numeric(18,2) CHECK (probation_salary <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.probation_salary IS '转正前工资；JS: probationSalary';
ALTER TABLE payroll.items ADD COLUMN regular_salary numeric(18,2) CHECK (regular_salary <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.regular_salary IS '转正后工资；JS: regularSalary';
ALTER TABLE payroll.items ADD COLUMN probation_subtotal numeric(18,2) CHECK (probation_subtotal <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.probation_subtotal IS '转正前工资小计；JS: probationSubtotal';
ALTER TABLE payroll.items ADD COLUMN regular_subtotal numeric(18,2) CHECK (regular_subtotal <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.regular_subtotal IS '转正后工资小计；JS: regularSubtotal';
ALTER TABLE payroll.items ADD COLUMN other_deduct numeric(18,2) CHECK (other_deduct <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.other_deduct IS '其它代扣；JS: otherDeduct';
ALTER TABLE payroll.items ADD COLUMN utility numeric(18,2) CHECK (utility <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.utility IS '水电代扣；JS: utility';
ALTER TABLE payroll.items ADD COLUMN meal_deduct numeric(18,2) CHECK (meal_deduct <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.meal_deduct IS '餐费代扣；JS: mealDeduct';
ALTER TABLE payroll.items ADD COLUMN tax numeric(18,2) CHECK (tax <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.tax IS '个税；JS: tax';
ALTER TABLE payroll.items ADD COLUMN after_tax_total numeric(18,2) CHECK (after_tax_total <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.after_tax_total IS '税后代扣合计；JS: afterTaxTotal';
ALTER TABLE payroll.items ADD COLUMN net numeric(18,2) CHECK (net <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.net IS '实发工资；JS: net';
ALTER TABLE payroll.items ADD COLUMN company_social numeric(18,2) CHECK (company_social <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.company_social IS '公司缴纳社保；JS: companySocial';
ALTER TABLE payroll.items ADD COLUMN company_fund numeric(18,2) CHECK (company_fund <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.company_fund IS '公司缴纳公积金；JS: companyFund';
ALTER TABLE payroll.items ADD COLUMN company_cost numeric(18,2) CHECK (company_cost <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.company_cost IS '公司总成本；JS: companyCost';
ALTER TABLE payroll.items ADD COLUMN remark text;
COMMENT ON COLUMN payroll.items.remark IS '备注；JS: remark';
ALTER TABLE payroll.items ADD COLUMN employee_number text;
COMMENT ON COLUMN payroll.items.employee_number IS '工号；JS: employeeNumber';
ALTER TABLE payroll.items ADD COLUMN score numeric(10,4) CHECK (score <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.score IS '绩效系数（调整输入）；JS: score';
ALTER TABLE payroll.items ADD COLUMN actual_paid_days numeric(10,4) CHECK (actual_paid_days <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.actual_paid_days IS '实发薪天数（调整输入）；JS: actualPaidDays';
ALTER TABLE payroll.items ADD COLUMN probation_total numeric(18,2) CHECK (probation_total <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.probation_total IS '转正前月薪；JS: probationTotal';
ALTER TABLE payroll.items ADD COLUMN regular_total numeric(18,2) CHECK (regular_total <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.regular_total IS '转正后月薪；JS: regularTotal';
ALTER TABLE payroll.items ADD COLUMN probation_base numeric(18,2) CHECK (probation_base <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.probation_base IS '转正前基本工资；JS: probationBase';
ALTER TABLE payroll.items ADD COLUMN regular_base numeric(18,2) CHECK (regular_base <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.regular_base IS '转正后基本工资；JS: regularBase';
ALTER TABLE payroll.items ADD COLUMN probation_post numeric(18,2) CHECK (probation_post <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.probation_post IS '转正前岗位工资；JS: probationPost';
ALTER TABLE payroll.items ADD COLUMN regular_post numeric(18,2) CHECK (regular_post <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.regular_post IS '转正后岗位工资；JS: regularPost';
ALTER TABLE payroll.items ADD COLUMN probation_perf_base numeric(18,2) CHECK (probation_perf_base <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.probation_perf_base IS '转正前绩效基数；JS: probationPerfBase';
ALTER TABLE payroll.items ADD COLUMN regular_perf_base numeric(18,2) CHECK (regular_perf_base <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.regular_perf_base IS '转正后绩效基数；JS: regularPerfBase';
ALTER TABLE payroll.items ADD COLUMN gross_target numeric(18,2) CHECK (gross_target <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.gross_target IS '应发工资调整目标；JS: grossTarget';
ALTER TABLE payroll.items ADD COLUMN net_target numeric(18,2) CHECK (net_target <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.net_target IS '实发工资调整目标；JS: netTarget';
ALTER TABLE payroll.items ADD COLUMN intern_pay numeric(18,2) CHECK (intern_pay <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.intern_pay IS '实习工资；JS: internPay';
ALTER TABLE payroll.items ADD COLUMN computed_gross numeric(18,2) CHECK (computed_gross <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.computed_gross IS '调整前应发工资；JS: computedGross';
ALTER TABLE payroll.items ADD COLUMN gross_adjustment numeric(18,2) CHECK (gross_adjustment <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.gross_adjustment IS '应发工资调整额；JS: grossAdjustment';
ALTER TABLE payroll.items ADD COLUMN computed_net numeric(18,2) CHECK (computed_net <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.computed_net IS '调整前实发工资；JS: computedNet';
ALTER TABLE payroll.items ADD COLUMN net_adjustment numeric(18,2) CHECK (net_adjustment <> 'NaN'::numeric);
COMMENT ON COLUMN payroll.items.net_adjustment IS '实发工资调整额；JS: netAdjustment';

CREATE VIEW payroll.run_company_totals AS
SELECT run_id, company_id, count(*) AS employee_count,
  sum(gross) AS gross, sum(net) AS net, sum(social) AS social, sum(fund) AS fund,
  sum(tax) AS tax, sum(after_tax_total) AS after_tax_total,
  sum(company_social) AS company_social, sum(company_fund) AS company_fund, sum(company_cost) AS company_cost,
  count(*) FILTER (WHERE gross IS NULL) AS missing_gross_count,
  count(*) FILTER (WHERE net IS NULL) AS missing_net_count,
  count(*) FILTER (WHERE company_cost IS NULL) AS missing_cost_count
FROM payroll.items GROUP BY run_id,company_id;

CREATE VIEW payroll.run_department_totals AS
SELECT run_id,company_id,employee_snapshot->>'department' AS department,
  count(*) AS employee_count,sum(gross) AS gross,sum(net) AS net,sum(company_cost) AS company_cost
FROM payroll.items GROUP BY run_id,company_id,employee_snapshot->>'department';

CREATE FUNCTION payroll.check_confirmation_amounts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'confirmed' AND EXISTS (SELECT 1 FROM payroll.items WHERE run_id = NEW.id
      AND (gross IS NULL OR (NEW.scope <> 'gross' AND net IS NULL))) THEN
    RAISE EXCEPTION 'Missing gross/net amounts block confirmation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER confirmation_amounts BEFORE UPDATE ON payroll.runs FOR EACH ROW EXECUTE FUNCTION payroll.check_confirmation_amounts();
