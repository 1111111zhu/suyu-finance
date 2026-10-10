/* Shared browser/Node payroll data rules. No file, network or UI side effects. */
globalThis.PayrollEngine = (() => {
  const fields = [
    ['姓名','name','text',['员工姓名']],['公司','company','text',['签约公司']],['一级部门','dept','text',['部门','一级部门名称']],
    ['二级部门','subdept','text',['二级部门名称']],['银行卡号','bankCard','text',['银行卡']],['开户行','bankName','text',['银行','开户银行']],
    ['是否入离职','status','text',['员工状态','在职状态','入离职状态']],['入职日期','join','date',['入职时间','入职日']],['离职日期','leave','date',['离职时间','离职日']],
    ['应发薪','workdays','number',['应发薪天数']],['实际出勤天数','payableDays','number',['实发薪天数','实际出勤','出勤天数']],
    ['基本工资','base','money',['工资基数']],['岗位工资','post','money'],['绩效基数','perfBase','money'],
    ['绩效分数','effectiveScore','number',['绩效系数']],['绩效工资','performancePay','money'],['工资小计','subtotal','money'],
    ['餐饮津贴','meal','money',['餐补合计','餐补','餐饮补贴','餐费补贴']],['交通津贴','transit','money',['交通补贴','交通补贴合计']],
    ['其他津贴','otherAllow','money'],['病假补贴','sickSubsidy','money'],['其他加','otherAdd','money'],
    ['年假天数','annual','number',['年假(天)','年假']],['弹性假天数','flexible','number',['弹性假(天)','弹性假']],
    ['调休假天数','compensatory','number',['调休假(天)','调休假','调休','调休天数','调休(天)']],['病假天数','sick','number',['病假(天)','病假']],
    ['事假天数','personal','number',['事假(天)','事假']],['旷工天数','absent','number',['旷工(天)','旷工']],
    ['假勤扣薪天数','deductDays','number'],['假勤扣款','attendanceDeduct','money'],['其他减','otherReduction','money'],
    ['应发工资','gross','money',['应发','应发金额','应发合计','本月应发']],['个人社保','social','money',['个人总计']],['个人公积金','fund','money',['个人缴纳']],
    ['是否实习生','isIntern','intern',['是否实习','实习标识','本月是否为实习生','实习']],['日薪','dailyRate','money'],
    ['转正日期','regularizationDate','date',['转正日','转正时间']],
    ['转正前应出勤天数','probationWorkdays','number',['试用期应出勤天数','转正前出勤天数','试用期计薪天数']],
    ['转正后应出勤天数','regularWorkdays','number',['转正后出勤天数','转正后计薪天数']],
    ['转正前工资','probationSalary','money'],['转正后工资','regularSalary','money'],
    ['转正前工资小计','probationSubtotal','money'],['转正后工资小计','regularSubtotal','money']
  ];
  const netFields = [
    ['其它代扣','otherDeduct','money',['其他代扣']],['水电代扣','utility','money',['员工宿舍水电费代扣','水电费代扣','水电费合计']],
    ['餐费代扣','mealDeduct','money',['餐费合计']],['个税','tax','money',['应补（退）税额','税','个人所得税','税额']],
