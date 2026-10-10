/* Standalone final-payroll import; no dependency on payroll calculation or demo batches. */
(() => {
  const $ = id => document.getElementById(id), engine = globalThis.PayrollEmailEngine;
  let workbook, draft;
  $('month').value = new Date().toLocaleDateString('sv-SE').slice(0,7);
  function context() { return {month:$('month').value, company:$('company').value,recipientName:$('name').value}; }
  function preview() { $('preview').innerHTML=engine.renderHtml($('body').value); }
  function generate() {
    if (!draft) { $('status').textContent='请先上传实发工资表。'; return; }
    draft.recipientName=$('name').value;
    document.querySelectorAll('[data-section]').forEach(el=>{draft.sections[el.dataset.section]=el.value;});
    draft.summary.total=engine.number($('total').value);draft.summary.average=engine.number($('average').value);
    draft.summary.departments=$('departments').value.split('\n').filter(line=>line.trim()).map(line=>{const [dept,total,average]=line.split('\t');return {dept,total:engine.number(total),average:engine.number(average)};});
    draft.manualSummary=$('manual').value;
    $('body').value=engine.render(draft,context());preview();
  }
  function importSheet() {
    try {
      const grid=XLSX.utils.sheet_to_json(workbook.Sheets[$('sheet').value],{header:1,defval:null,raw:true});
      const rows=PayrollEngine.rowsFromGrid(grid);
      if (!rows.length || !rows.some(row=>Object.keys(row).some(key=>key.replace(/\s/g,'')==='实发工资'))) throw new Error('所选工作表需要包含姓名、实发工资表头和人员明细。');
      draft=engine.extract(rows,context());
      const costs=rows.map(row=>engine.number(row['公司总成本']));
      if(costs.some(value=>value===null)){draft.summary.total=null;draft.summary.average=null;draft.summary.departments=[];}
      $('sections').replaceChildren();
      engine.SECTION_ORDER.forEach(([key,label])=>{const section=document.createElement('section'), title=document.createElement('label'),input=document.createElement('textarea');title.textContent=label;input.dataset.section=key;input.value=draft.sections[key];section.append(title,input);$('sections').append(section);});
      $('total').value=draft.summary.total??'';$('average').value=draft.summary.average??'';
      $('departments').value=draft.summary.departments.map(item=>`${item.dept}\t${engine.money(item.total)}\t${engine.money(item.average)}`).join('\n');
      $('status').textContent=`已读取 ${rows.length} 人。请核对特殊事项；源表未提供的事项需手动补录。`+(draft.summary.total===null?' 缺少公司总成本，请补录成本汇总；实发工资不替代公司成本。':'');generate();
    } catch(error){draft=null;$('sections').replaceChildren();$('body').value='';preview();$('status').textContent=error.message;}
  }
  $('file').addEventListener('change',async()=>{try{const file=$('file').files[0];if(!file)return;workbook=/\.csv$/i.test(file.name)?XLSX.read(await file.text(),{type:'string',raw:true}):XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});$('sheet').replaceChildren(...workbook.SheetNames.map(name=>{const option=document.createElement('option');option.value=name;option.textContent=name;return option;}));importSheet();}catch(error){$('status').textContent=error.message;}});
  $('sheet').addEventListener('change',importSheet);$('generate').addEventListener('click',generate);$('body').addEventListener('input',preview);
  $('copy').addEventListener('click',async()=>{try{if(!$('body').value)throw new Error('请先生成正文。');const body=$('body').value;if(navigator.clipboard.write&&typeof ClipboardItem!=='undefined')await navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob([body],{type:'text/plain'}),'text/html':new Blob([engine.renderHtml(body)],{type:'text/html'})})]);else await navigator.clipboard.writeText(body);$('status').textContent='正文已复制，请在邮箱核对收件人、正文和工资附件。';}catch(error){$('status').textContent=error.message;}});
})();
