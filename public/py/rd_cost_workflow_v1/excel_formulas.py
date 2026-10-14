"""Formula-backed calculations inside existing template cells, with initial caches."""
from decimal import Decimal
from collections import defaultdict
from openpyxl.utils import get_column_letter
from openpyxl.cell.cell import MergedCell
import re, zipfile, xml.etree.ElementTree as ET


def apply(wb, hours, projects, records, salaries, month, rules, material_code, public_code, norm, code_key, table_locator):
    cache={}
    def ref(sheet,cell): return "'"+sheet.replace("'","''")+"'!"+cell
    def put(ws,row,col,expression,value=None):
        cell=ws.cell(row,col)
        if isinstance(cell,MergedCell):raise ValueError(f'公式槽位映射失败：{ws.title}!{cell.coordinate}')
        if value is None: value=cell.value
        if len(expression)>8191:raise ValueError(f'计算公式过长：{ws.title}!{cell.coordinate}，请拆分资料。')
        if not isinstance(value,(int,float,Decimal)):raise ValueError(f'公式缓存缺少数值：{ws.title}!{cell.coordinate}')
        cache[(ws.title,cell.coordinate)]=str(value);cell.value='='+expression
    matrix=wb['研发人员工时统计合计'];raw=wb['研发人员工时统计']
    codes=list(projects);hour_codes=[p['project_code'] for p in hours['projects']]
    matrix_cols={code:4+i for i,code in enumerate(hour_codes)}
    last=3+len(hours['people'])
    # Locate original project columns by their actual headers, never assume order.
    raw_cols={}
    for row in raw.iter_rows(min_row=1,max_row=min(10,raw.max_row),max_col=29):
        for cell in row:
            code=code_key(cell.value)
            if code in hour_codes:raw_cols.setdefault(code,cell.column)
    for i,person in enumerate(hours['people'],3):
        source_row=int(person['row'])
        actual_refs=[]
        for code in hour_codes:
            if code not in raw_cols:raise ValueError(f'源工时项目未保留在模板预留区：{code}')
            actual_refs.append(ref(raw.title,f'{get_column_letter(raw_cols[code])}{source_row}'))
        put(raw,source_row,31,'SUM('+','.join(actual_refs)+')',person['actual_hours'])
        put(raw,source_row,32,f'C{source_row}-AE{source_row}',person['allocated_hours'])
        put(raw,source_row,30,f'C{source_row}',person['final_hours'])
        for code in hour_codes:
            actual=ref(raw.title,f'{get_column_letter(raw_cols[code])}{source_row}')
            put(matrix,i,matrix_cols[code],f'IFERROR({actual}*(1+{ref(raw.title,f"AF{source_row}")}/{ref(raw.title,f"AE{source_row}")}),0)',person['final_by_project'][code])
        put(matrix,i,3,f'SUM(D{i}:{get_column_letter(3+len(hour_codes))}{i})',person['final_hours'])
        for col,source_col,key in ((30,30,'final_hours'),(31,31,'actual_hours'),(32,32,'allocated_hours')):
            put(matrix,i,col,ref(raw.title,f'{get_column_letter(source_col)}{source_row}'),person[key])
    for col in [3,*matrix_cols.values(),30,31,32]:
        put(matrix,last,col,f'SUM({get_column_letter(col)}3:{get_column_letter(col)}{last-1})')
    for col in (3,30,31,32):
        rows=[int(p['row']) for p in hours['people']]
        put(raw,36,col,'SUM('+','.join(f'{get_column_letter(col)}{r}' for r in rows)+')')
    weights={c:ref(matrix.title,f'{get_column_letter(matrix_cols[c])}{last}') if c in matrix_cols else '0' for c in codes}
    weight_values={c:projects[c].final_hours for c in codes}
    for i,c in enumerate(codes):
        for ws,row,col in ((raw,45+i,4),(matrix,43+i,10)):
            # Displayed percentage rounds to 4 decimals and assigns remainder last.
            earlier=[f'ROUND(IFERROR({weights[k]}/SUM({",".join(weights.values())}),0),4)' for k in codes[:i]]
            exp=f'ROUND(IFERROR({weights[c]}/SUM({",".join(weights.values())}),0),4)'
            later=','.join(weights[k] for k in codes[i+1:]) or '0'
            exp=f'IF(AND({weights[c]}>0,SUM({later})=0),1-SUM('+(','.join(earlier) or '0')+'),'+exp+')'
            put(ws,row,col,exp)
    put(raw,63,4,'SUM(D45:D62)');put(matrix,61,10,'SUM(J43:J60)')
    def allocate(total,selected,refs,values):
        positive=[c for c in selected if values.get(c,0)>0]
        if not positive:return {}
        denominator='SUM('+','.join(refs[c] for c in positive)+')'
        bases={c:f'ROUND(({total})*({refs[c]})/({denominator}),2)' for c in positive}
        output={}
        for c in positive:
            prior=[k for k in sorted(positive) if k<c]
            condition='AND('+','.join([f'{refs[c]}=MAX({",".join(refs[k] for k in positive)})',*[f'{refs[k]}<{refs[c]}' for k in prior]])+')'
            output[c]=bases[c]+f'+IF({condition},ROUND({total},2)-SUM({",".join(bases.values())}),0)'
        return output
    # Existing source-summary amount cells are authoritative, not expense narratives.
    summary=wb[f'项目分类明细汇总表{month or 1}月'] if f'项目分类明细汇总表{month or 1}月' in wb.sheetnames else None;source_map=defaultdict(list)
    if summary is not None:
        # Resolve the copied source's actual headers/columns. No fixed B/C/D
        # positions and no subtotal or unsupported-category deletion.
        header_row=0;fee_col=project_col=amount_col=0
        for row in range(1,min(summary.max_row,30)+1):
            headers={}
            for col in range(1,summary.max_column+1):headers.setdefault(norm(summary.cell(row,col).value),col)
            if '费用项目' not in headers or '研发项目' not in headers:continue
            fee_col=headers['费用项目'];project_col=headers['研发项目']
            amounts=[col for text,col in headers.items() if col>project_col and text in {'借方发生(原币)','借方发生','费用金额(元)','费用金额（元）'}]
            if amounts:header_row=row;amount_col=min(amounts);break
        if not header_row:raise ValueError('原始汇总表未找到明确的费用、项目和金额列，不能猜测公式引用。')
        fee=''
        for row in range(header_row+1,summary.max_row+1):
            text=norm(summary.cell(row,fee_col).value)
            if text:
                match=re.search(r'FYXM\d+[-_]SYS',text,re.I)
                if match:fee=code_key(match.group())
            project=re.search(r'R[DC][0-9A-Z]+(?:-[0-9A-Z]+)*',norm(summary.cell(row,project_col).value),re.I)
            amount=summary.cell(row,amount_col).value
            if project and isinstance(amount,(int,float,Decimal)) and not any(word in text for word in ('小计','总计','合计')):
                source_map[(fee,code_key(project.group()),Decimal(str(amount)))].append(ref(summary.title,f'{get_column_letter(amount_col)}{row}'))
    def source(record):
        candidates=source_map.get((record.fee_code,record.project_code,record.amount))
        if candidates:return candidates.pop(0)
        # Raw imported amount, not a precomputed allocation result.
        return format(record.amount,'f')
    def fee_expressions(items,displayed=False):
        terms=defaultdict(list);pools=[]
        for r in items:
            total=source(r)
            if r.project_code==public_code:pools.append(total);continue
            if r.project_code in projects:terms[r.project_code].append(f'ROUND({total},2)');continue
            descendants=[c for c in codes if c.startswith(r.project_code+'-')]
            for c,e in allocate(total,descendants,weights,weight_values).items():terms[c].append(e)
        if pools:
            pool='SUM('+','.join(pools)+')'
            if displayed:
                rates={c:ref(matrix.title,f'J{43+i}') for i,c in enumerate(codes)}
                bases={c:f'ROUND(({pool})*{rates[c]},2)' for c in codes}
                for i,c in enumerate(codes):
                    later=','.join(rates[k] for k in codes[i+1:]) or '0'
                    earlier=','.join(bases[k] for k in codes[:i]) or '0'
                    terms[c].append(f'IF(AND({rates[c]}>0,SUM({later})=0),ROUND({pool},2)-SUM({earlier}),{bases[c]})')
            else:
                for c,e in allocate(pool,codes,weights,weight_values).items():terms[c].append(e)
        return {c:'SUM('+(','.join(terms[c]) or '0')+')' for c in codes}
    by_fee=defaultdict(list)
    for r in records:by_fee[r.fee_code].append(r)
    linked={}
    for rule in rules['fee_items']:
        ws=wb[rule['detail_sheet']];expressions=fee_expressions(by_fee[rule['code']],displayed=rule['code']=='FYXM02-SYS')
        if rule['code']=='FYXM02-SYS':
            header=next(r for r in range(1,ws.max_row+1) if norm(ws.cell(r,6).value)=='项目编码' and norm(ws.cell(r,7).value)=='科目名称')
            rows=list(range(header+2,header+20));totalrow=header+20;col=8
        else:_,rows,totalrow=table_locator(ws);col=3
        for i,c in enumerate(codes):
            put(ws,rows[i],col,expressions[c]);linked[(norm(rule['master_header']),c)]=ref(ws.title,f'{get_column_letter(col)}{rows[i]}')
        for row in rows[len(codes):]:
            if isinstance(ws.cell(row,col).value,(int,float)):put(ws,row,col,'SUM(0)')
        put(ws,totalrow,col,f'SUM({get_column_letter(col)}{rows[0]}:{get_column_letter(col)}{rows[-1]})')
    material=wb['14.材料明细账']
    direct=fee_expressions([r for r in by_fee[material_code] if r.project_code!=public_code])
    shared=fee_expressions([r for r in by_fee[material_code] if r.project_code==public_code])
    for c in codes:
        row=next(r for r in range(1,material.max_row+1) if material.cell(r,1).value==c and material.cell(r,5).value==c and material.cell(r,9).value==c)
        put(material,row,3,direct[c]);put(material,row,7,shared[c]);put(material,row,11,f'SUM(C{row},G{row})')
        linked[(norm('直接材料'),c)]=ref(material.title,f'K{row}')
    for col in (3,7,11):
        last_project_row=max(r for r in range(1,material.max_row+1) if material.cell(r,1).value in codes and material.cell(r,5).value in codes and material.cell(r,9).value in codes)
        totalrow=next(r for r in range(last_project_row+1,material.max_row+1) if material.cell(r,col-2).value=='合计')
        occupied=[r for r in range(1,totalrow) if material.cell(r,col-2).value in codes]
        put(material,totalrow,col,'SUM('+','.join(f'{get_column_letter(col)}{r}' for r in occupied)+')',sum(Decimal(cache[(material.title,f'{get_column_letter(col)}{r}')]) for r in occupied))
    labor=wb['2.直接人工'];_,rows,totalrow=table_locator(labor)
    # Share the complete salary pool using the visible 0.01% project rates.
    rate_refs={c:ref(matrix.title,f"$J${43+i}") for i,c in enumerate(codes)}
    for i,c in enumerate(codes):
        expression=f"ROUND($G$5*{rate_refs[c]},2)"
        put(labor,rows[i],3,expression)
        linked[(norm("人员人工（含社保+公积金）"),c)]=ref(labor.title,f"C{rows[i]}")
    put(labor,totalrow,3,f'SUM(C{rows[0]}:C{rows[-1]})',sum(Decimal(cache[(labor.title,f'C{rows[i]}')]) for i in range(len(codes))))
    put(labor,5,7,'SUM('+','.join(format(a['salary'].salary,'f') for a in salaries)+')',sum((a['salary'].salary for a in salaries),Decimal('0')))
    main=wb['研发项目主表']
    for row,c in enumerate(codes,3):
        for col in range(3,25):
            header=norm(main.cell(1,col).value)
            put(main,row,col,linked.get((header,c),'SUM(0)'))
        put(main,row,25,f'SUM(C{row}:X{row})')
    for row in range(1,min(main.max_row,30)+1):
        if main.cell(row,1).value=='合计' or main.cell(row,2).value=='合计':
            for col in range(3,26):
                value=main.cell(row,col).value
                if isinstance(value,(int,float,Decimal)) or isinstance(value,str) and value.startswith('='):
                    total=sum(Decimal(cache[(main.title,f'{get_column_letter(col)}{r}')]) for r in range(3,3+len(codes)))
                    put(main,row,col,f'SUM({get_column_letter(col)}3:{get_column_letter(col)}20)',total)
    return cache


def save_caches(path,cache):
    # XLSX stores formulas and last calculated values separately. Keep both so
    # previews/data-only readers do not show blanks before Excel opens the file.
    ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(path) as source:
        files={name:source.read(name) for name in source.namelist()}
    workbook=ET.fromstring(files['xl/workbook.xml'])
    rels=ET.fromstring(files['xl/_rels/workbook.xml.rels'])
    targets={r.attrib['Id']:r.attrib['Target'] for r in rels}
    for sheet in workbook.find('s:sheets',ns):
        name=sheet.attrib['name'];rid=sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
        target=targets[rid].lstrip('/');target=target if target.startswith('xl/') else 'xl/'+target
        root=ET.fromstring(files[target])
        changed=False
        for cell in root.findall('.//s:sheetData/s:row/s:c',ns):
            key=(name,cell.attrib['r'])
            if key not in cache:continue
            cell.attrib.pop('t',None);value=cell.find('s:v',ns)
            if value is None:value=ET.SubElement(cell,'{'+ns['s']+'}v')
            value.text=cache[key];changed=True
        if changed:files[target]=ET.tostring(root,encoding='utf-8',xml_declaration=True)
    with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as output:
        for name,data in files.items():output.writestr(name,data)
