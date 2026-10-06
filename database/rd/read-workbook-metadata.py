"""Read the supplied workbook without loading or rewriting its unsupported styles."""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
PLATFORMS = {'一体化电控平台': 'electronic', '氢动力飞行器及平台项目': 'aircraft',
             '自研工装': 'tooling', '氢锂混电系统及平台研究与应用': 'hybrid',
             '氢助力两轮车及平台项目': 'bicycle', '氢能前沿研究及应用': 'frontier'}


def extract(path):
    platforms, projects = {}, {}
    with zipfile.ZipFile(path) as archive:
        strings = [''.join(t.text or '' for t in item.iter('{'+NS['m']+'}t'))
                   for item in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        rels = {r.attrib['Id']: r.attrib['Target'] for r in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        for sheet in workbook.find('m:sheets', NS):
            sheet_name = sheet.attrib['name']
            match = re.fullmatch(r'(2025|2026)年研发项目平台', sheet_name)
            if not match:
                continue
            year = int(match[1])
            target = rels[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
            tree = ET.fromstring(archive.read(target.lstrip('/') if target.startswith('/') else 'xl/'+target))
            cells = {}
            for cell in tree.findall('m:sheetData/m:row/m:c', NS):
                value = cell.find('m:v', NS)
                if value is not None:
                    cells[cell.attrib['r']] = (strings[int(value.text)] if cell.attrib.get('t') == 's' else value.text).strip()
            # Propagate only vertical merged cells, never blank project codes outside a merge.
            for merge in tree.findall('m:mergeCells/m:mergeCell', NS):
                merged = re.fullmatch(r'([BCD])(\d+):\1(\d+)', merge.attrib['ref'])
                if merged:
                    col, start, end = merged.groups()
                    for row in range(int(start)+1, int(end)+1):
                        cells[f'{col}{row}'] = cells.get(f'{col}{start}', '')
            for row in range(2, 150):
                number = cells.get(f'D{row}', '')
                if not number:
                    continue
                platform = PLATFORMS[cells[f'C{row}']]
                platform_number = cells[f'B{row}']
                code = {'year': year, 'number': platform_number}
                if code not in platforms.setdefault(platform, []):
                    platforms[platform].append(code)
                name = cells.get(f'F{row}', '')
                item = projects.setdefault(number, {'number': number, 'platformId': platform, 'sourceYear': year,
                    'sourceStatus': cells.get(f'H{row}') or None, 'financialEntity': None,
                    'materials': [], 'parentNumber': None, 'rows': [], 'sheet': sheet_name,
                    'sourceName': name or None, 'note': cells.get(f'I{row}') or None})
                item['rows'].append(row)
                material = cells.get(f'E{row}', '')
                if material and material != '/':
                    item['materials'].append({'number': material, 'name': name})
                # Only modern, source-year-consistent codes encode financial entity.
                modern = re.fullmatch(r'R[DC]([123])'+str(year)[-2:]+r'\d{2}(?:-?\d{2,3})', number)
                if modern and number != 'RD12502-01':
                    item['financialEntity'] = {'1': '苏州', '2': '杭州', '3': '连云港'}[modern[1]]
        for number, item in projects.items():
            parent = number.rsplit('-', 1)[0] if '-' in number else None
            if parent in projects and projects[parent]['platformId'] == item['platformId']:
                item['parentNumber'] = parent
    if len(platforms) != 6 or len(projects) != 41:
        raise ValueError('原表平台或项目数量发生变化，请先复核映射')
    return {'platforms': [{'id': key, 'codes': sorted(value, key=lambda c: c['year'])} for key, value in platforms.items()],
            'projects': list(projects.values())}


if __name__ == '__main__':
    print(json.dumps(extract(sys.argv[1]), ensure_ascii=False))
