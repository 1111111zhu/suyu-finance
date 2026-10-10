/* Read-only formatted cell previews; originals are never changed. */
function sourcePreviewFiles(key) {
  const status=key==='netBenefits'?benefitStatus():state.sourceStatus[key] || {},previews=status.previews || {};
  const names=status.filenames || Object.keys(previews);
  if(names.length && names.every(name=>previews[name]))return names.map(name=>previews[name]);
  // Older saved batches have imported rows, but no original cell snapshot.
  const files=new Map();
  for(const row of key==='netBenefits'?[...(sourceRows.netSocial||[]),...(sourceRows.netFund||[])]:sourceRows[key] || []) {
    const source=row._importSource || row._rosterSource || row._deductionSource || {};
    const filename=source.filename || status.filename || '已导入资料',name=source.sheetName || '已导入数据';
    if(!files.has(filename))files.set(filename,new Map());
    const sheets=files.get(filename);if(!sheets.has(name))sheets.set(name,[]);sheets.get(name).push(row);
  }
  return [...files].map(([filename,sheets])=>previews[filename] || {filename,importedOnly:true,sheets:[...sheets].map(([name,rows])=>{
    const headers=[...new Set(rows.flatMap(row=>Object.keys(row)))].filter(header=>!header.startsWith('_'));
    return {name,grid:[headers,...rows.map(row=>headers.map(header=>row[header] ?? ''))],rowCount:rows.length+1,columnCount:headers.length};
  })});
}
function sourcePreviewTable(sheet,page=0) {
  const grid=sheet.grid || [],start=page*50,rows=grid.slice(start,start+50);
  const columns=Math.max(0,...grid.map(row=>row.length));
  if(!rows.length)return '<p class="wb-small">此工作表为空。</p>';
  return `<div class="wb-preview-scroll"><table class="wb-preview-table"><thead><tr><th>行</th>${Array.from({length:columns},(_,i)=>`<th>${window.XLSX.utils.encode_col(i)}</th>`).join('')}</tr></thead><tbody>${rows.map((row,i)=>`<tr><th>${start+i+1}</th>${Array.from({length:columns},(_,j)=>`<td>${escapeHtml(row[j])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function openSourcePreview(key) {
  const files=sourcePreviewFiles(key);if(!files.length){showToast('暂无可预览的上传资料');return;}
  document.querySelector('.wb-source-preview')?.remove();
  const dialog=document.createElement('dialog');dialog.className='wb-dialog wb-source-preview';
  dialog.setAttribute('aria-label','上传文件预览');
  let fileIndex=0,sheetIndex=0,page=0;
  function draw() {
    const file=files[fileIndex],sheet=file.sheets[sheetIndex],pages=Math.max(1,Math.ceil((sheet?.grid.length || 0)/50));
    dialog.innerHTML=`<div class="wb-preview-head"><h2>上传文件预览</h2><button type="button" class="btn btn-sm" data-preview-close>关闭</button></div><div class="wb-preview-controls"><label>文件 <select class="select" data-preview-file>${files.map((file,i)=>`<option value="${i}" ${i===fileIndex?'selected':''}>${escapeHtml(file.filename)}</option>`).join('')}</select></label><label>工作表 <select class="select" data-preview-sheet>${file.sheets.map((sheet,i)=>`<option value="${i}" ${i===sheetIndex?'selected':''}>${escapeHtml(sheet.name)}</option>`).join('')}</select></label></div><p class="wb-small">${file.importedOnly?'此历史批次仅保留已导入数据；重新上传后可预览原文件单元格。':'只读单元格内容预览，保留读取时的显示值。'}${sheet?` · ${sheet.rowCount} 行 / ${sheet.columnCount} 列`:''}${sheet?.truncated?' · 大表仅预览前 200 行、50 列；核算仍读取全部数据。':''}</p>${sheet?sourcePreviewTable(sheet,page):'<p>暂无工作表。</p>'}<div class="wb-preview-paging"><button type="button" class="btn btn-sm" data-preview-prev ${page===0?'disabled':''}>上一页</button><span>${page+1} / ${pages}</span><button type="button" class="btn btn-sm" data-preview-next ${page+1>=pages?'disabled':''}>下一页</button></div>`;
    dialog.querySelector('[data-preview-close]').addEventListener('click',()=>dialog.close());
    dialog.querySelector('[data-preview-file]').addEventListener('change',event=>{fileIndex=Number(event.target.value);sheetIndex=0;page=0;draw();});
    dialog.querySelector('[data-preview-sheet]').addEventListener('change',event=>{sheetIndex=Number(event.target.value);page=0;draw();});
    dialog.querySelector('[data-preview-prev]').addEventListener('click',()=>{page--;draw();});
    dialog.querySelector('[data-preview-next]').addEventListener('click',()=>{page++;draw();});
  }
  dialog.addEventListener('close',()=>dialog.remove());draw();document.body.appendChild(dialog);dialog.showModal();
}
