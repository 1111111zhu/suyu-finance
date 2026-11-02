/* Blank source workbooks: the same module is used by the browser and parser tests. */
globalThis.PayrollInputTemplates = (() => {
  const templates = {
    roster: { name: '花名册', stage: 'gross', sheets: [{ name: '在职员工', headers: ['姓名','工号','公司','一级部门','二级部门','三级部门','职位','入职日期','离职日期','劳动合同止','转正日期','银行卡号','开户行'], note: '姓名和工号必填；工号、银行卡号按文本填写，保留前导零。日期填写 YYYY-MM-DD；职位含“实习”时按实习生识别。本月离职人员也可填在本表，并填写离职日期。' }] },
    salary: { name: '员工基本工资表', stage: 'gross', sheets: [{ name: '员工基本工资表', headers: ['姓名','基本工资','岗位工资','绩效基数','转正前工资','转正后工资','转正前基本工资','转正后基本工资','转正前岗位工资','转正后岗位工资','转正前绩效基数','转正后绩效基数'], note: '填写月度工资标准；当月转正人员按实际资料补充转正前后薪资，并在考勤表填写两段应出勤天数。无关字段留空，不要填入已折算的应发结果。' }] },
    performance: { name: '绩效考核表', stage: 'gross', sheets: [{ name: '绩效考核表', headers: ['姓名','绩效系数'], note: '绩效系数填写实际系数，例如 0.9；0 表示零绩效，请勿用 90 代替 0.9。' }] },
    attendance: { name: '考勤统计表', stage: 'gross', sheets: [{ name: '考勤统计表', headers: ['姓名','实际出勤天数','餐补合计','交通补贴','年假天数','弹性假天数','调休假天数','产检假天数','产假天数','陪产假天数','婚假天数','丧假天数','哺乳假天数','病假天数','事假天数','旷工天数','转正前应出勤天数','转正后应出勤天数','备注'], note: '实际出勤天数必须填写，假期均以天为单位，补贴以元为单位。当月转正人员两段应出勤天数合计应等于页面计薪天数。' }] },
    other: { name: '其他加减', stage: 'gross', sheets: [{ name: '其他加减', headers: ['姓名','其他津贴','其他加','其他减'], note: '其他加必须填写有效数字，无发生额填 0；其他减填写正数表示税前扣减。餐费、水电费及其他税后代扣请填第二阶段税后代扣表。' }] },
    grossUpload: { name: '应发工资表', stage: 'net', sheets: [{ name: '应发工资表', headers: ['姓名','工号','公司','一级部门','二级部门','银行卡号','开户行','是否实习生','应发工资'], note: '可选：仅在使用外部应发结果时填写。上传后优先使用本表应发金额；否则直接衔接第一阶段结果。是否实习生填写“是”或“否”。' }] },
    tax: { name: '个税表', stage: 'net', sheets: [{ name: '个税表', headers: ['姓名','应补（退）税额'], note: '应补（退）税额必填有效数字，无税额填 0；退税可填负数。不要填写累计应纳税额或已缴税额。' }] },
    netBenefits: { name: '社保公积金', stage: 'net', sheets: [
      { name: '社保个人明细', headers: ['姓名','个人总计','公司总计'], note: '个人总计为个人社保扣款，公司总计用于公司成本。无发生额填 0。请保留工作表名称“社保个人明细”。' },
      { name: '公积金个人明细', headers: ['姓名','个人缴纳','个人补缴','公司缴纳'], note: '个人公积金按个人缴纳加个人补缴计算，无补缴填 0；公司缴纳用于公司成本。请保留工作表名称“公积金个人明细”。' }
    ] },
    afterTax: { name: '税后代扣表', stage: 'net', sheets: [{ name: '税后代扣表', headers: ['姓名','水电代扣','餐费代扣','其它代扣'], note: '各项代扣以元为单位填写，扣款填正数，无发生额填 0；本表不填写社保、公积金或个税。' }] }
  };
  const textHeaders = new Set(['姓名','工号','公司','一级部门','二级部门','三级部门','职位','入职日期','离职日期','劳动合同止','转正日期','银行卡号','开户行','是否实习生','备注']);
  function build(XLSX, key, month = '') {
    if (!XLSX?.utils?.book_new) throw new Error('Excel 组件尚未加载，请稍候重试');
    const selected = [templates[key]].filter(Boolean);
    if (!selected.length) throw new Error('未找到对应的导入模板');
    const workbook = XLSX.utils.book_new();
    const notes = {
      工号: '按文本填写，保留开头的 0。',
      银行卡号: '按文本填写，避免号码变形。',
      入职日期: '格式：2026-11-01。',
      离职日期: '未离职留空。',
      转正日期: '未转正留空。',
      绩效系数: '例如 0.9，不填 90。',
      '应补（退）税额': '无税额填 0；退税填负数。',
      个人补缴: '无补缴填 0。',
      是否实习生: '填写“是”或“否”。'
    };
    for (const item of selected) for (const definition of item.sheets) {
      const sheet = XLSX.utils.aoa_to_sheet([definition.headers]);
      sheet['!cols'] = definition.headers.map(header => ({ wch: Math.max(16, Math.min(26, header.length * 2 + 2)) }));
      sheet['!rows'] = [{ hpt: 28 }];
      definition.headers.forEach((header, column) => {
        const cell = sheet[XLSX.utils.encode_cell({r:0,c:column})];
        if (notes[header]) cell.c = [{ a: '备注', t: notes[header] }];
        for (let row = 1; row <= 50; row++) sheet[XLSX.utils.encode_cell({r:row,c:column})] = { t:'s', v:'', z:textHeaders.has(header) ? '@' : '0.00' };
      });
      sheet['!ref'] = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:50,c:definition.headers.length-1}});
      XLSX.utils.book_append_sheet(workbook, sheet, definition.name);
    }
    workbook.Props = { Title: '溯驭财务工资资料导入模板', Author: '溯驭财务' };
    const label = selected[0].name;
    const suffix = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? '_' + month : '';
    return { workbook, filename: `${label}_导入模板${suffix}.xlsx` };
  }
  function download(key, month) {
    const {workbook,filename} = build(globalThis.XLSX,key,month);
    const bytes=globalThis.XLSX.write(workbook,{bookType:'xlsx',type:'array'});
    const mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const url = URL.createObjectURL(new Blob([bytes],{type:mime}));
    const link = document.createElement('a');link.href=url;link.download=filename;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    return filename;
  }
  return { build, download };
})();
