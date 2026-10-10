import ExcelJS from 'exceljs';
import XLSX from 'xlsx';
import { unzipSync } from 'fflate';
import '../../../public/salary/payroll-engine.js';
const Engine=globalThis.PayrollEngine;
const clone=value=>value===undefined?undefined:structuredClone(value);
const borders={thin:1,hair:2,dotted:3,dashed:4,dashDot:5,dashDotDot:6,double:7,medium:8,mediumDashed:9,mediumDashDot:10,mediumDashDotDot:11,slantDashDot:12,thick:13};
const theme=['#FFFFFF','#000000','#E7E6E6','#44546A','#4472C4','#ED7D31','#A5A5A5','#FFC000','#5B9BD5','#70AD47'];
function color(value){if(!value)return undefined;if(value.argb)return '#'+value.argb.slice(-6);if(value.theme!==undefined){const hex=theme[value.theme]||'#000000',t=value.tint||0;return '#'+[1,3,5].map(i=>{const n=parseInt(hex.slice(i,i+2),16);return Math.round(t<0?n*(1+t):n+(255-n)*t).toString(16).padStart(2,'0');}).join('');}return undefined;}
const excelColor=value=>value?.rgb?{argb:'FF'+value.rgb.replace('#','').slice(-6).toUpperCase()}:undefined;
function styleToSheet(cell){const font=cell.font||{},a=cell.alignment||{},style={};
  if(font.name)style.ff=font.name;if(font.size)style.fs=font.size;if(font.bold!==undefined)style.bl=Number(font.bold);if(font.italic!==undefined)style.it=Number(font.italic);
  if(font.underline)style.ul={s:1,t:font.underline==='double'?10:12};if(font.strike)style.st={s:1};
  const fg=color(font.color),bg=color(cell.fill?.fgColor);if(fg)style.cl={rgb:fg};if(bg)style.bg={rgb:bg};
  if(a.horizontal)style.ht={left:1,center:2,right:3,justify:4,distributed:6}[a.horizontal]||0;
  if(a.vertical)style.vt={top:1,middle:2,bottom:3}[a.vertical]||0;
  if(a.wrapText!==undefined)style.tb=a.wrapText?3:1;
  if(typeof a.textRotation==='number')style.tr={a:a.textRotation};
  if(cell.numFmt)style.n={pattern:cell.numFmt};
  for(const [side,key] of [['top','t'],['bottom','b'],['left','l'],['right','r']]){const b=cell.border?.[side];if(b?.style){style.bd ||= {};style.bd[key]={s:borders[b.style]||1,cl:{rgb:color(b.color)||'#000000'}};}}
  return style;
}
function styleToExcel(style={}){const font={},a={},result={};
  if(style.ff)font.name=style.ff;if(style.fs)font.size=style.fs;if(style.bl!=null)font.bold=!!style.bl;if(style.it!=null)font.italic=!!style.it;
  if(style.ul?.s)font.underline=style.ul.t===10?'double':'single';if(style.st?.s)font.strike=true;if(style.cl)font.color=excelColor(style.cl);
  if(Object.keys(font).length)result.font=font;
  if(style.bg)result.fill={type:'pattern',pattern:'solid',fgColor:excelColor(style.bg)};
  if(style.ht)a.horizontal={1:'left',2:'center',3:'right',4:'justify',6:'distributed'}[style.ht];
  if(style.vt)a.vertical={1:'top',2:'middle',3:'bottom'}[style.vt];if(style.tb)a.wrapText=style.tb===3;if(style.tr?.a)a.textRotation=style.tr.a;
  if(Object.keys(a).length)result.alignment=a;if(style.n?.pattern)result.numFmt=style.n.pattern;
  for(const [key,side] of [['t','top'],['b','bottom'],['l','left'],['r','right']]){const b=style.bd?.[key];if(b?.s){result.border ||= {};result.border[side]={style:Object.keys(borders).find(s=>borders[s]===b.s)||'thin',color:excelColor(b.cl)};}}
  return result;
}
function serial(date,date1904){return (date.getTime()-Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:30))/86400000;}
function valueToSheet(cell,date1904){const value=cell.value;
  if(value==null)return {};
  if(value instanceof Date)return {v:serial(value,date1904),t:2};
  if(typeof value==='number')return {v:value,t:2};if(typeof value==='boolean')return {v:Number(value),t:3};if(typeof value==='string')return {v:value,t:1};
  if(value.formula||value.sharedFormula){const result=value.result instanceof Date?serial(value.result,date1904):value.result;return {f:'='+cell.formula,...(result!==undefined?{v:result?.error||result,t:typeof result==='number'?2:typeof result==='boolean'?3:1}:{})};}
  if(value.richText)return {v:value.richText.map(run=>run.text).join(''),t:1};
  if(value.text!=null)return {v:value.text,t:1};if(value.error)return {v:value.error,t:1};return {v:String(value),t:1};
}
export function toSnapshot(workbook,name){const snapshot={id:'payroll-'+crypto.randomUUID(),name,appVersion:'1.0.3',locale:'zhCN',sheetOrder:[],styles:{},sheets:{}};const styleIds=new Map();
  for(const ws of workbook.worksheets){const id='sheet-'+ws.id;const frozen=ws.views?.find(v=>v.state==='frozen');
    const sheet={id,name:ws.name,tabColor:color(ws.properties.tabColor)||'',hidden:ws.state==='visible'?0:1,rowCount:Math.max(200,ws.rowCount+50),columnCount:Math.max(26,ws.columnCount+5),zoomRatio:(ws.views?.[0]?.zoomScale||100)/100,freeze:{startRow:frozen?.ySplit?frozen.ySplit-1:-1,startColumn:frozen?.xSplit?frozen.xSplit-1:-1,ySplit:frozen?.ySplit||0,xSplit:frozen?.xSplit||0},scrollTop:0,scrollLeft:0,defaultColumnWidth:100,defaultRowHeight:24,mergeData:[],cellData:{},rowData:{},columnData:{},showGridlines:ws.views?.[0]?.showGridLines===false?0:1,rowHeader:{width:46},columnHeader:{height:24},rightToLeft:ws.views?.[0]?.rightToLeft?1:0,custom:{excelDate1904:!!workbook.properties.date1904,sourceSheetId:ws.id,pageSetup:clone(ws.pageSetup)}};
    for(const col of ws.columns||[]){if(col.width||col.hidden)sheet.columnData[col.number-1]={w:col.width?Math.round(col.width*7+5):100,hd:col.hidden?1:0};}
    ws.eachRow({includeEmpty:true},(row,r)=>{if(row.height||row.hidden)sheet.rowData[r-1]={h:row.height?row.height*4/3:24,hd:row.hidden?1:0};
      row.eachCell({includeEmpty:true},(cell,c)=>{if(cell.isMerged&&cell.master.address!==cell.address)return;const data=valueToSheet(cell,workbook.properties.date1904),style=styleToSheet(cell);if(Object.keys(style).length){const signature=JSON.stringify(style);if(!styleIds.has(signature)){const sid='style-'+styleIds.size;styleIds.set(signature,sid);snapshot.styles[sid]=style;}data.s=styleIds.get(signature);}
        if(cell.note||cell.value?.hyperlink||cell.dataValidation)data.custom={note:clone(cell.note),hyperlink:cell.value?.hyperlink,dataValidation:clone(cell.dataValidation)};
        if(Object.keys(data).length){sheet.cellData[r-1] ||= {};sheet.cellData[r-1][c-1]=data;}
      });
    });
    for(const ref of ws.model.merges||[]){const range=XLSX.utils.decode_range(ref);sheet.mergeData.push({startRow:range.s.r,endRow:range.e.r,startColumn:range.s.c,endColumn:range.e.c});}
    snapshot.sheetOrder.push(id);snapshot.sheets[id]=sheet;
  }
  const filters={};for(const ws of workbook.worksheets){if(!ws.autoFilter)continue;const range=typeof ws.autoFilter==='string'?XLSX.utils.decode_range(ws.autoFilter):{s:typeof ws.autoFilter.from==='string'?XLSX.utils.decode_cell(ws.autoFilter.from):{r:ws.autoFilter.from.row-1,c:ws.autoFilter.from.column-1},e:typeof ws.autoFilter.to==='string'?XLSX.utils.decode_cell(ws.autoFilter.to):{r:ws.autoFilter.to.row-1,c:ws.autoFilter.to.column-1}};filters['sheet-'+ws.id]={ref:{startRow:range.s.r,endRow:range.e.r,startColumn:range.s.c,endColumn:range.e.c},filterColumns:[]};}if(Object.keys(filters).length)snapshot.resources=[{name:'SHEET_FILTER_PLUGIN',data:JSON.stringify(filters)}];
  return snapshot;
}
export function validateSnapshot(snapshot){
  if(!snapshot||!Array.isArray(snapshot.sheetOrder)||!snapshot.sheetOrder.length||snapshot.sheetOrder.length>100||!snapshot.sheets)throw new Error('工作簿结构无效');
  let cells=0;const names=new Set(),ids=new Set();for(const id of snapshot.sheetOrder){const sheet=snapshot.sheets[id];if(ids.has(id)||!sheet||typeof sheet.name!=='string'||!sheet.name.trim()||sheet.name.length>31||/[\\/*?:\[\]]/.test(sheet.name)||names.has(sheet.name.toLowerCase()))throw new Error('工作表名称或顺序无效');names.add(sheet.name.toLowerCase());ids.add(id);
    for(const [r,row] of Object.entries(sheet.cellData||{})){if(!/^\d+$/.test(r)||Number(r)>1048575)throw new Error('行号超出 Excel 范围');for(const [c,cell] of Object.entries(row||{})){if(!/^\d+$/.test(c)||Number(c)>16383||!cell||typeof cell!=='object')throw new Error('单元格无效');if(++cells>500000)throw new Error('当前工作簿超出 50 万单元格限制');}}
  }return snapshot;
}
export async function toXlsx(snapshot){validateSnapshot(snapshot);const workbook=new ExcelJS.Workbook();workbook.creator='溯驭技术';workbook.properties.date1904=!!snapshot.sheets[snapshot.sheetOrder[0]].custom?.excelDate1904;workbook.calcProperties.fullCalcOnLoad=true;
  let filters={};try{filters=JSON.parse(snapshot.resources?.find(r=>r.name==='SHEET_FILTER_PLUGIN')?.data||'{}');}catch{}
  for(const id of snapshot.sheetOrder){const s=snapshot.sheets[id],ws=workbook.addWorksheet(s.name,{state:s.hidden?'hidden':'visible',properties:{...(s.tabColor?{tabColor:{argb:'FF'+s.tabColor.replace('#','')}}:{})},pageSetup:s.custom?.pageSetup||{}});
    ws.views=[{state:s.freeze?.xSplit||s.freeze?.ySplit?'frozen':'normal',xSplit:s.freeze?.xSplit||0,ySplit:s.freeze?.ySplit||0,zoomScale:Math.round((s.zoomRatio||1)*100),showGridLines:s.showGridlines!==0,rightToLeft:!!s.rightToLeft}];
    for(const [c,data] of Object.entries(s.columnData||{})){const col=ws.getColumn(Number(c)+1);col.width=Math.max(0,(Number(data.w||s.defaultColumnWidth||100)-5)/7);col.hidden=!!data.hd;}
    for(const [r,data] of Object.entries(s.rowData||{})){const row=ws.getRow(Number(r)+1);row.height=Number(data.h||s.defaultRowHeight||24)*3/4;row.hidden=!!data.hd;}
    for(const [r,row] of Object.entries(s.cellData||{}))for(const [c,data] of Object.entries(row)){const cell=ws.getCell(Number(r)+1,Number(c)+1);let value=data.v;
      if(data.p?.body?.dataStream!=null)value=data.p.body.dataStream.replace(/[\r\n]+$/,'');
      if(data.t===3)value=!!value;
      if(data.f){const result=typeof value==='string'&&/^#(?:REF!|VALUE!|DIV\/0!|N\/A|NAME\?|NUM!|SPILL!|CALC!|NULL!)$/.test(value)?{error:value}:value;cell.value={formula:data.f.replace(/^=/,''),...(result!=null?{result}:{})};}
      else if(data.custom?.hyperlink)cell.value={text:String(value??''),hyperlink:data.custom.hyperlink};else cell.value=value??null;
      const style=typeof data.s==='string'?snapshot.styles?.[data.s]:data.s;cell.style=styleToExcel(style);if(data.custom?.note)cell.note=clone(data.custom.note);if(data.custom?.dataValidation)cell.dataValidation=clone(data.custom.dataValidation);
    }
    const range=filters[id]?.ref;if(range)ws.autoFilter={from:{row:range.startRow+1,column:range.startColumn+1},to:{row:range.endRow+1,column:range.endColumn+1}};
    for(const m of s.mergeData||[])ws.mergeCells(m.startRow+1,m.startColumn+1,m.endRow+1,m.endColumn+1);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
export function inspectArchive(buffer){const entries=[];let expandedSize=0;unzipSync(new Uint8Array(buffer),{filter:file=>{entries.push(file.name);expandedSize+=file.originalSize;return false;}});if(expandedSize>100*1024*1024)throw new Error('工作簿解压后超过 100MB，服务器文件处理已停止');return entries;}
export async function fromXlsx(buffer,name){const entries=inspectArchive(buffer),warnings=[];
  if(entries.some(p=>/^xl\/(charts|drawings|media|pivotTables|externalLinks)\//.test(p)))warnings.push('该文件包含图片、图表、透视表或外部链接，当前网页编辑及导出不保留这些对象；原始文件会作为只读副本保留。');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);if(!workbook.worksheets.length)throw new Error('Excel 中没有工作表');
  const snapshot=toSnapshot(workbook,name);validateSnapshot(snapshot);return {snapshot,warnings};
}
export function fromRows(key,rows,name){const workbook=new ExcelJS.Workbook();const defaults=key==='roster'?['姓名','工号','公司','一级部门','二级部门','职位','入职日期','离职日期','转正日期','是否实习生','银行卡号','开户行']:['姓名','基本工资','岗位工资','绩效基数','转正日期','转正前工资','转正后工资'];
  const headers=[...new Set(rows.flatMap(row=>Object.keys(row).filter(k=>!k.startsWith('_'))))],fields=headers.length?headers:defaults;
  const groups=key==='roster'?[['在职员工',rows.filter(r=>!r._rosterSource?.departedSheet)],['离职员工',rows.filter(r=>r._rosterSource?.departedSheet)]]:[['基本工资表',rows]];
  for(const [sheetName,list] of groups){if(!list.length&&sheetName==='离职员工')continue;const ws=workbook.addWorksheet(sheetName);ws.addRow(fields);list.forEach(row=>ws.addRow(fields.map(field=>row[field]??null)));ws.views=[{state:'frozen',ySplit:1}];ws.columns.forEach((col,i)=>{col.width=/银行|公司|部门|日期/.test(fields[i])?24:18;});ws.getRow(1).height=30;ws.getRow(1).eachCell(cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'},size:11};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF176E63'}};cell.alignment={vertical:'middle'};});}
  return toSnapshot(workbook,name);
}
export function payrollRows(snapshot,key){validateSnapshot(snapshot);const combined=[];let eligible=0;
  for(const id of snapshot.sheetOrder){const s=snapshot.sheets[id];if(key==='roster'&&!Engine.isRosterSheet(s.name))continue;eligible++;const grid=[];
    for(const [r,row] of Object.entries(s.cellData||{})){const values=[];for(const [c,cell] of Object.entries(row)){let value=cell.p?.body?.dataStream?.replace(/[\r\n]+$/,'')??cell.v;if(cell.t===3)value=!!value;const style=typeof cell.s==='string'?snapshot.styles?.[cell.s]:cell.s;const pattern=style?.n?.pattern;if(typeof value==='number'&&pattern&&XLSX.SSF.is_date(pattern)){const date=XLSX.SSF.parse_date_code(value,{date1904:!!s.custom?.excelDate1904});value=date?`${date.y}-${String(date.m).padStart(2,'0')}-${String(date.d).padStart(2,'0')}`:value;}if(cell.f&&(value==null||typeof value==='string'&&value.startsWith('#')))throw new Error(`${s.name} ${XLSX.utils.encode_cell({r:Number(r),c:Number(c)})} 的公式尚未计算或存在错误，请修正后保存`);values[Number(c)]=value??null;}grid[Number(r)]=values;}
    for(let i=0;i<grid.length;i++)grid[i] ||= [];
    const headerRow=grid.findIndex(r=>r.some(v=>Engine.key(v)==='姓名'));if(headerRow<0)continue;
    let rows;try{rows=Engine.rowsFromGrid(grid);}catch(error){if(error.message==='Excel 文件没有员工数据行')continue;throw error;}
    const headers=grid[headerRow].map(v=>String(v??'').trim());const rowNumbers=grid.slice(headerRow+1).flatMap((values,i)=>{const row=Object.fromEntries(headers.flatMap((h,c)=>h?[[h,values[c]??null]]:[])),name=String(row.姓名??'').trim();return values.every(Engine.blank)||Engine.rosterSectionHeader(row)||/^(?:合计|总计|汇总)$/.test(name)?[]:[headerRow+i+2];});
    rows.forEach((row,i)=>combined.push(key==='roster'?{...row,_rosterSource:{sheetName:s.name,rowNumber:rowNumbers[i],departedSheet:/离职/.test(s.name)}}:row));
    if(key==='salary'&&rows.length)break;
  }
  if(key==='roster'&&!eligible)throw new Error('花名册需保留名称含“在职”或“离职”的工作表，才能确定计薪人员范围');
  if(!combined.length)throw new Error('未找到带“姓名”表头的员工数据，请保留表头并至少填写一名员工');
  if(combined.some(row=>!String(Engine.normalizeRosterRow(row).values.name??'').trim()))throw new Error('存在空姓名，请补齐后再用于算薪');
  return combined;
}
