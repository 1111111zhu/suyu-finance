"""End-to-end accounting contract against the real fixed-template engine."""
import sys, json, hashlib, unittest, tempfile
from pathlib import Path
from decimal import Decimal
from openpyxl import Workbook, load_workbook
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"public"/"py"))
from rd_cost_workflow_v1.engine import build_output, classify_input_workbooks, OUTPUT_TEMPLATE
def save(path,rows,title="Sheet1"):
    wb=Workbook();ws=wb.active;ws.title=title
    for row in rows:ws.append(row)
    wb.save(path)
def fixtures(folder):
    paths=[folder/"工时.xlsx",folder/"工资.xlsx",folder/"核算维度与科目组合表9月.xlsx",folder/"费用明细账.xlsx"]
    save(paths[0],[["序号","姓名","9月","RD141232","RD1260301","工时合计"],[None,None,None,"80V低压驱动器研发","生产自研工装",None],[1,"虚拟测试员工",100,60,40,100]],"工时")
    save(paths[1],[["序号","人员名称","9月","9月工资费用"],["001","虚拟测试员工",100,1000]])
    save(paths[2],[["费用项目",None,None,"研发项目","借方发生(原币)"],["FYXM02_SYS  运费",None,None,"RD9999  研发公摊",100],["FYXM28_SYS  直接材料",None,None,"RD141232  80V低压驱动器研发",200]])
    save(paths[3],[["日期","会计年度","期间","凭证字","凭证号","摘要","借方","研发项目","研发名称"],["2025/9/1",2025,9,"记",1,"运费测试",100,"RD9999","研发公摊"]],"FYXM02_SYS_运费")
    return paths
class AccountingTest(unittest.TestCase):
    def test_frontier_rc_projects_are_not_dropped(self):
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp);paths=fixtures(folder)
            for path in paths:
                book=load_workbook(path)
                for sheet in book:
                    for row in sheet:
                        for cell in row:
                            if isinstance(cell.value,str):
                                cell.value=cell.value.replace("RD1260301","RC22505-01")
                book.save(path)
            classified=classify_input_workbooks(paths)
            result=build_output(classified["hours"],classified["salary"],classified["dimension_ledger"],classified["expense_ledgers"],folder/"result.xlsx")
            totals={p["code"]:p["total"] for p in result["project_costs"]}
            self.assertEqual(totals["RC22505-01"],"440.00")
            self.assertEqual(result["cost_total"],"1300.00")
    def test_workbook_and_database_payload_match(self):
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp);paths=fixtures(folder)
            hashes={p:hashlib.sha256(p.read_bytes()).hexdigest() for p in [*paths,OUTPUT_TEMPLATE]}
            classified=classify_input_workbooks(paths)
            output=folder/"result.xlsx"
            result=build_output(classified["hours"],classified["salary"],classified["dimension_ledger"],classified["expense_ledgers"],output)
            totals={p["code"]:Decimal(p["total"]) for p in result["project_costs"]}
            self.assertEqual(totals,{"RD141232":Decimal("860.00"),"RD1260301":Decimal("440.00")})
            self.assertEqual(result["cost_total"],"1300.00")
            self.assertEqual(result["year"],2025)
            self.assertEqual(result["month"],9)
            self.assertEqual(hashes,{p:hashlib.sha256(p.read_bytes()).hexdigest() for p in hashes})
            wb=load_workbook(output,data_only=False);source=load_workbook(OUTPUT_TEMPLATE,data_only=False)
            self.assertEqual(wb.sheetnames,[name.replace("汇总表1月","汇总表9月") for name in source.sheetnames])
            main=wb["研发项目主表"]
            for record in result["project_costs"]:
                row=next(r for r in main.iter_rows() if r[0].value==record["code"])
                self.assertEqual(sum((Decimal(str(c.value or 0)) for c in row[2:24]),Decimal(0)),Decimal(record["total"]))
            # A JSON round-trip must preserve exact decimals for the web/API boundary.
            payload=json.loads(json.dumps(result,default=str))
            self.assertEqual(payload["project_costs"][0]["costs"][0]["amount"],"200.00")
if __name__=="__main__":unittest.main()
