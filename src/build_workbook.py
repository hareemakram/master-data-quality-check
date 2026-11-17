"""Builds MasterDataQuality.xlsx (styled sheets, tables, formulas, dashboard,
charts, conditional formatting, data validation). Power Query is injected
afterwards by inject_powerquery.py.
"""
import json, os, datetime, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.formatting.rule import FormulaRule, CellIsRule, DataBarRule
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.chart import DoughnutChart, BarChart, Reference
from openpyxl.chart.series import DataPoint
from openpyxl.chart.label import DataLabelList
from openpyxl.utils import get_column_letter as L
from openpyxl.comments import Comment

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "build", "MasterDataQuality.xlsx")
md = json.load(open(os.path.join(ROOT, "data/master_data.json")))
ref = json.load(open(os.path.join(ROOT, "data/reference.json")))
res = json.load(open(os.path.join(ROOT, "build/result.json")))

COLS = {
    "Customers": ["CustomerID", "CustomerName", "Country", "City", "PostalCode", "Email", "Phone", "TaxID", "Currency", "PaymentTerms", "CreditLimit", "CreatedDate", "Status"],
    "Vendors": ["VendorID", "VendorName", "Country", "City", "PostalCode", "Email", "Phone", "TaxID", "Currency", "PaymentTerms", "BankIBAN", "CreatedDate", "Status"],
    "Materials": ["MaterialID", "Description", "MaterialType", "BaseUoM", "MaterialGroup", "PreferredVendorID", "Plant", "StandardPrice", "Currency", "GrossWeightKg", "CreatedDate", "Status"],
}
EX_COLS = ["ExceptionID", "RunDate", "Entity", "SourceRow", "RecordID", "RecordName", "Region", "RuleID", "Category",
           "RuleName", "Field", "Value", "Details", "Severity", "SeverityRank", "RelatedRecordID", "OwnerName", "OwnerEmail", "Status"]

FONT = "Arial"
NAVY, INDIGO, INK, MUTED, LINE, PAPER = "1E2A5A", "4F46E5", "1C2333", "5B6475", "E3E6EE", "F5F6FA"
SEV = {"Critical": ("B4232F", "FDE7EA"), "High": ("D9480F", "FFF0E6"), "Medium": ("B08900", "FFF8DB"), "Low": ("2F6FD0", "E8F1FF")}
CAT = {"Duplicate": "7C3AED", "Missing": "0891B2", "Inconsistent": "DB2777"}


def f(size=10, bold=False, color=INK, italic=False):
    return Font(name=FONT, size=size, bold=bold, color=color, italic=italic)


def fill(c):
    return PatternFill("solid", start_color=c, end_color=c)


thin = Side(style="thin", color=LINE)
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
BOTTOM = Border(bottom=thin)

wb = Workbook()
wb.remove(wb.active)


def add_table(ws, name, headers, rows, style="TableStyleMedium2", start_row=1, widths=None, date_cols=(), num_fmt=None):
    for j, h in enumerate(headers, 1):
        c = ws.cell(start_row, j, h)
        c.font = f(10, True, "FFFFFF")
    for i, r in enumerate(rows, start_row + 1):
        for j, h in enumerate(headers, 1):
            v = r.get(h) if isinstance(r, dict) else r[j - 1]
            if v == "":
                v = None
            if h in date_cols and isinstance(v, str) and len(v) == 10 and v[4] == "-" and v[7] == "-":
                v = datetime.datetime.strptime(v, "%Y-%m-%d")
            c = ws.cell(i, j, v)
            c.font = f(10)
            if isinstance(v, datetime.datetime):
                c.number_format = "yyyy-mm-dd"
            if num_fmt and h in num_fmt:
                c.number_format = num_fmt[h]
    last = start_row + max(len(rows), 1)
    t = Table(displayName=name, ref=f"A{start_row}:{L(len(headers))}{last}")
    t.tableStyleInfo = TableStyleInfo(name=style, showRowStripes=True)
    from openpyxl.worksheet.table import TableColumn
    t.tableColumns = [TableColumn(id=j, name=h) for j, h in enumerate(headers, 1)]
    from openpyxl.worksheet.filters import AutoFilter
    t.autoFilter = AutoFilter(ref=t.ref)
    ws.add_table(t)
    for j, h in enumerate(headers, 1):
        ws.column_dimensions[L(j)].width = (widths or {}).get(h, max(12, min(40, len(h) + 4)))
    ws.freeze_panes = ws.cell(start_row + 1, 1)
    ws.sheet_view.zoomScale = 95
    return t


# ============================================================ Dashboard (first tab, filled later)
dash = wb.create_sheet("Dashboard")
exc = wb.create_sheet("Exceptions")

# ============================================================ Source data sheets
TAB = {"Dashboard": NAVY, "Exceptions": "B4232F", "Customers": "2563EB", "Vendors": "2563EB", "Materials": "2563EB",
       "Automated Run": "7C3AED", "Rules": "059669", "Required Fields": "059669", "Owners": "059669",
       "Countries": "059669", "Lists": "059669", "Settings": "059669", "How It Works": "64748B"}
ENT = {"Customers": "Customer", "Vendors": "Vendor", "Materials": "Material"}
for sheet, cols in COLS.items():
    ws = wb.create_sheet(sheet)
    headers = cols + ["DQ_Issues"]
    widths = {"CustomerName": 34, "VendorName": 34, "Description": 32, "Email": 34, "BankIBAN": 32, "TaxID": 20,
              "Phone": 18, "PostalCode": 12, "City": 16, "Country": 10, "Currency": 10, "Status": 11, "DQ_Issues": 11}
    t = add_table(ws, "tbl" + sheet, headers, md[sheet], widths=widths, date_cols=("CreatedDate",),
                  num_fmt={"CreditLimit": "#,##0", "StandardPrice": "#,##0.00", "GrossWeightKg": "0.000"})
    n = len(md[sheet])
    dq_col = L(len(headers))
    formula = f'=COUNTIFS(Exceptions!$C:$C,"{ENT[sheet]}",Exceptions!$D:$D,ROW()-ROW({sheet}!$A$1))'
    for i in range(2, n + 2):
        c = ws[f"{dq_col}{i}"]
        c.value = formula
        c.font = f(10, True)
        c.alignment = Alignment(horizontal="center")
    from openpyxl.worksheet.table import TableFormula
    t.tableColumns[-1].calculatedColumnFormula = TableFormula(attr_text=formula[1:])
    rng = f"A2:{L(len(cols))}{n + 1}"
    # highlight the exact offending cell, then tint the whole record
    ws.conditional_formatting.add(rng, FormulaRule(
        formula=[f'COUNTIFS(Exceptions!$C:$C,"{ENT[sheet]}",Exceptions!$D:$D,ROW()-1,Exceptions!$K:$K,A$1)>0'],
        fill=fill("FAD4D8"), font=Font(name=FONT, color="9B1C2C", bold=True), stopIfTrue=True))
    ws.conditional_formatting.add(f"{dq_col}2:{dq_col}{n + 1}", CellIsRule(operator="greaterThan", formula=["0"],
                                  fill=fill("FDE7EA"), font=Font(name=FONT, color="B4232F", bold=True)))
    ws.conditional_formatting.add(f"{dq_col}2:{dq_col}{n + 1}", CellIsRule(operator="equal", formula=["0"],
                                  fill=fill("E7F6EC"), font=Font(name=FONT, color="1E7B3A", bold=True)))
    ws[f"{dq_col}1"].comment = Comment("Number of open data-quality exceptions for this record (from the Exceptions sheet). "
                                       "Cells with an issue are highlighted in red.", "Data Quality")

# ============================================================ Exceptions (Power Query output)
add_table(exc, "tblExceptions", EX_COLS, res["exceptions"], style="TableStyleMedium15",
          widths={"ExceptionID": 30, "RunDate": 11, "Entity": 10, "SourceRow": 10, "RecordID": 11, "RecordName": 32,
                  "Region": 11, "RuleID": 9, "Category": 12, "RuleName": 30, "Field": 17, "Value": 26, "Details": 56,
                  "Severity": 10, "SeverityRank": 8, "RelatedRecordID": 12, "OwnerName": 28, "OwnerEmail": 30, "Status": 9})
nx = len(res["exceptions"]) + 1
for sev, (fg, bg) in SEV.items():
    exc.conditional_formatting.add("N2:N20000", CellIsRule(operator="equal", formula=[f'"{sev}"'], fill=fill(bg),
                                   font=Font(name=FONT, color=fg, bold=True)))
for cat, col in CAT.items():
    exc.conditional_formatting.add("I2:I20000", CellIsRule(operator="equal", formula=[f'"{cat}"'], font=Font(name=FONT, color=col, bold=True)))

# ============================================================ Automated Run (Office Script output)
auto = wb.create_sheet("Automated Run")
auto["A1"] = "Weekly automated run log"
auto["A1"].font = f(14, True, NAVY)
auto["A2"] = ("Written by the Office Script that Power Automate runs every Monday. The script runs the same rules as Power Query "
              "(Excel for the web cannot refresh Power Query from a flow) and records each run here.")
auto["A2"].font = f(9, False, MUTED, True)
RUNLOG = ["RunDate", "RunTimestampUTC", "Records", "RecordsWithExceptions", "CleanRate", "Exceptions", "Critical", "High",
          "Medium", "Low", "OwnersNotified", "ReportFile"]
t = res["totals"]
add_table(auto, "tblRunLog", RUNLOG, [{
    "RunDate": res["runDate"], "RunTimestampUTC": res["runDate"] + "T07:00:00Z", "Records": t["records"],
    "RecordsWithExceptions": t["recordsWithExceptions"], "CleanRate": t["cleanRate"], "Exceptions": t["exceptions"],
    "Critical": t["critical"], "High": t["high"], "Medium": t["medium"], "Low": t["low"],
    "OwnersNotified": len({e["OwnerEmail"] for e in res["exceptions"]}),
    "ReportFile": f"DQ_Exception_Report_{res['runDate']}.csv"}], style="TableStyleMedium12", start_row=4,
    num_fmt={"CleanRate": "0.0%"}, widths={"RunTimestampUTC": 22, "RecordsWithExceptions": 22, "ReportFile": 36})
auto.freeze_panes = None

# ============================================================ Config sheets
rules_rows = [dict(r, Enabled="Yes" if r["Enabled"] else "No") for r in ref["Rules"]]
ws = wb.create_sheet("Rules")
add_table(ws, "tblRules", ["RuleID", "Category", "RuleName", "AppliesTo", "Severity", "Enabled", "Threshold", "Description"],
          rules_rows, style="TableStyleMedium7", widths={"RuleName": 34, "AppliesTo": 26, "Description": 90, "Threshold": 11})
nr = len(rules_rows) + 1
dv = DataValidation(type="list", formula1='"Critical,High,Medium,Low"', allow_blank=False); ws.add_data_validation(dv); dv.add(f"E2:E{nr}")
dv = DataValidation(type="list", formula1='"Yes,No"', allow_blank=False); ws.add_data_validation(dv); dv.add(f"F2:F{nr}")
for sev, (fg, bg) in SEV.items():
    ws.conditional_formatting.add(f"E2:E{nr}", CellIsRule(operator="equal", formula=[f'"{sev}"'], fill=fill(bg), font=Font(name=FONT, color=fg, bold=True)))
ws.conditional_formatting.add(f"F2:F{nr}", CellIsRule(operator="equal", formula=['"No"'], fill=fill("EEEEEE"), font=Font(name=FONT, color="888888")))
for r in range(2, nr + 1):
    ws[f"H{r}"].alignment = Alignment(wrap_text=True, vertical="top")
ws["G7"].comment = Comment("Similarity threshold (0-1) for fuzzy duplicate matching. Lower = more matches.", "Data Quality")

ws = wb.create_sheet("Required Fields")
add_table(ws, "tblRequiredFields", ["Entity", "Field", "Severity"], ref["RequiredFields"], style="TableStyleMedium7",
          widths={"Field": 22})
dv = DataValidation(type="list", formula1='"Critical,High,Medium,Low"'); ws.add_data_validation(dv); dv.add("C2:C500")
dv = DataValidation(type="list", formula1='"Customer,Vendor,Material"'); ws.add_data_validation(dv); dv.add("A2:A500")

ws = wb.create_sheet("Owners")
add_table(ws, "tblOwners", ["Entity", "Region", "OwnerName", "OwnerEmail"], ref["Owners"], style="TableStyleMedium7",
          widths={"OwnerName": 34, "OwnerEmail": 34})
ws["F1"] = "Routing: an exception goes to the owner matching Entity + Region, then Entity + *, then * + *."
ws["F1"].font = f(9, False, MUTED, True)
ws["F2"] = "Region comes from the record's country (Countries sheet). Invalid countries route to the * + * owner."
ws["F2"].font = f(9, False, MUTED, True)

ws = wb.create_sheet("Countries")
countries = [dict(c, PhoneCode=str(c["PhoneCode"])) for c in ref["Countries"]]
add_table(ws, "tblCountries", ["CountryCode", "CountryName", "Region", "DefaultCurrency", "PhoneCode", "PostalPattern",
                               "TaxIDPattern", "IBANLength"], countries, style="TableStyleMedium7",
          widths={"CountryName": 22, "PostalPattern": 42, "TaxIDPattern": 22})
ws["J1"] = "Pattern legend"; ws["J1"].font = f(10, True, NAVY)
for i, line in enumerate(["#  = any digit 0-9", "@  = any letter A-Z", "?  = letter or digit", "|  = separates alternative formats",
                          "Any other character must match literally.", "Blank pattern = not validated."], 2):
    ws[f"J{i}"] = line; ws[f"J{i}"].font = f(9, False, MUTED)
ws.column_dimensions["J"].width = 36

ws = wb.create_sheet("Lists")
add_table(ws, "tblLists", ["ListName", "Value"], ref["Lists"], style="TableStyleMedium7", widths={"ListName": 24, "Value": 16})
ws["D1"] = "Approved values used by the INC-006/007/010/011/012/017 and MIS-002 rules. Add rows to extend a list."
ws["D1"].font = f(9, False, MUTED, True)

ws = wb.create_sheet("Settings")
add_table(ws, "tblSettings", ["Setting", "Value", "Notes"], ref["Settings"], style="TableStyleMedium7",
          widths={"Setting": 20, "Value": 48, "Notes": 80})
ws["B2"].fill = fill("FFF7CC")
ws["B2"].comment = Comment("Input cell. Leave blank for today's date, or type yyyy-mm-dd to re-run a past week.", "Data Quality")

# ============================================================ How It Works
hw = wb.create_sheet("How It Works")
hw.sheet_view.showGridLines = False
hw.column_dimensions["A"].width = 3; hw.column_dimensions["B"].width = 120
lines = [
    ("Automated Master Data Quality Check", "title"),
    ("Excel Power Query flags duplicate, missing and inconsistent customer, vendor and material master records. "
     "A weekly Power Automate flow saves the exception report to SharePoint and emails each data owner.", "sub"),
    ("", None),
    ("Refresh the checks", "h"),
    ("1. Paste or link your master data into the Customers, Vendors and Materials tables (keep the column names).", None),
    ("2. Data > Refresh All. Power Query rebuilds the Exceptions sheet; the Dashboard and the red cell highlights update automatically.", None),
    ("3. Open Data > Queries & Connections to see the 24 queries: Cfg_* (configuration), Src_* (sources), fn* (rule functions), Exceptions (output).", None),
    ("", None),
    ("Tune the rules without touching code", "h"),
    ("Rules: switch any rule on/off (Enabled), change its Severity, or change the fuzzy-duplicate Threshold (DUP-005).", None),
    ("Required Fields: add/remove mandatory fields per entity and set their severity.", None),
    ("Owners: who receives each exception (Entity + Region, with * as a fallback).", None),
    ("Countries / Lists: tax ID, postal code and phone formats per country; approved currencies, payment terms, UoMs, plants, statuses.", None),
    ("Settings: RunDateOverride re-runs a past week; GovernanceEmail and ReportLibrary are used by the weekly flow.", None),
    ("", None),
    ("Colour key", "h"),
    ("Red cell on a source sheet = the exact field that failed a rule.  DQ_Issues column = open exceptions for that record.", None),
    ("Severity: Critical (fix now: duplicate IDs, shared bank accounts) > High > Medium > Low (formatting).", None),
    ("", None),
    ("Weekly automation", "h"),
    ("Power Automate runs the RunQualityChecks Office Script on this workbook in SharePoint every Monday 07:00, "
     "writes DQ_Exception_Report_<date>.csv and .html to the SharePoint report library, emails each owner their own exceptions, "
     "sends a summary to the governance mailbox and appends a row to the Automated Run sheet. See docs/SETUP.md.", None),
    ("", None),
    ("Sample data", "h"),
    ("The workbook ships with 498 fictional records (contoso.com owners) containing 168 deliberately planted defects so you can see every rule fire. "
     "Replace them with your own data.", None),
]
for i, (text, kind) in enumerate(lines, 2):
    c = hw[f"B{i}"]; c.value = text; c.alignment = Alignment(wrap_text=True, vertical="top")
    c.font = {"title": f(20, True, NAVY), "sub": f(11, False, MUTED), "h": f(12, True, INDIGO)}.get(kind, f(10))
    if kind == "h":
        c.border = BOTTOM

# ============================================================ Dashboard
d = dash
d.sheet_view.showGridLines = False
d.sheet_view.zoomScale = 90
d.column_dimensions["A"].width = 2
for col in range(2, 18):
    d.column_dimensions[L(col)].width = 12.5
d.column_dimensions["R"].width = 2

EXR = "Exceptions!$N$2:$N$20000"   # Severity
EXC = "Exceptions!$I$2:$I$20000"   # Category
EXE = "Exceptions!$C$2:$C$20000"   # Entity
EXRULE = "Exceptions!$H$2:$H$20000"
EXOWN = "Exceptions!$R$2:$R$20000"

for r in range(2, 6):
    for c in range(2, 18):
        d.cell(r, c).fill = fill(NAVY)
d.merge_cells("B2:Q3")
d["B2"] = "Master Data Quality Dashboard"
d["B2"].font = f(22, True, "FFFFFF"); d["B2"].alignment = Alignment(vertical="center", indent=1)
d.merge_cells("B4:Q4")
d["B4"] = '="Customer, vendor & material master  ·  Run date "&IF(Exceptions!$B$2="","-",Exceptions!$B$2)&"  ·  Refresh with Data > Refresh All"'
d["B4"].font = f(10, False, "C7D2FE"); d["B4"].alignment = Alignment(vertical="center", indent=1)
d.row_dimensions[2].height = 22; d.row_dimensions[3].height = 22; d.row_dimensions[4].height = 20; d.row_dimensions[5].height = 6

# entity helper (feeds KPIs) — placed in section 3
ent_rows = {"Customer": ("Customers", "N"), "Vendor": ("Vendors", "N"), "Material": ("Materials", "M")}

# ---- KPI cards (row 7-10), 6 cards x 2 cols + gaps
kpis = [
    ("Records checked", "=SUM($K$15:$K$17)", "#,##0", NAVY),
    ("Open exceptions", "=COUNTA(Exceptions!$A$2:$A$20000)", "#,##0", INDIGO),
    ("Clean record rate", "=IF($B$8=0,0,1-SUM($L$15:$L$17)/$B$8)", "0.0%", "1E7B3A"),
    ("Critical", f'=COUNTIF({EXR},"Critical")', "#,##0", SEV["Critical"][0]),
    ("High", f'=COUNTIF({EXR},"High")', "#,##0", SEV["High"][0]),
    ("Owners to notify", "=0", "#,##0", "7C3AED"),  # set after the owner table is built
]
# card column spans -> value cells B8, E8, H8, J8, L8, O8
cards = [(2, 4), (5, 7), (8, 9), (10, 11), (12, 14), (15, 17)]
for (c1, c2), (label, formula, fmt, color) in zip(cards, kpis):
    for r in range(7, 11):
        for c in range(c1, c2 + 1):
            d.cell(r, c).fill = fill(PAPER)
    for c in range(c1, c2 + 1):
        d.cell(7, c).fill = fill(color)
    d.row_dimensions[7].height = 5
    d.merge_cells(start_row=8, start_column=c1, end_row=8, end_column=c2)
    d.merge_cells(start_row=9, start_column=c1, end_row=9, end_column=c2)
    v = d.cell(8, c1, formula); v.font = f(24, True, color); v.number_format = fmt
    v.alignment = Alignment(horizontal="center", vertical="center")
    lab = d.cell(9, c1, label.upper()); lab.font = f(8, True, MUTED); lab.alignment = Alignment(horizontal="center")
d.row_dimensions[8].height = 38; d.row_dimensions[10].height = 6


def section(cell_range, title):
    first = cell_range.split(":")[0]
    d.merge_cells(cell_range)
    d[first] = title
    d[first].font = f(11, True, NAVY)
    d[first].border = Border(bottom=Side(style="medium", color=INDIGO))
    r = d[first].row
    c1 = d[first].column
    c2 = d[cell_range.split(":")[1]].column
    for c in range(c1, c2 + 1):
        d.cell(r, c).border = Border(bottom=Side(style="medium", color=INDIGO))


def header_row(r, c1, labels):
    for i, lab in enumerate(labels):
        c = d.cell(r, c1 + i, lab)
        c.font = f(9, True, "FFFFFF"); c.fill = fill(NAVY); c.alignment = Alignment(horizontal="center", wrap_text=True)


# ---- Section: severity (B12:D18)
section("B12:D12", "Exceptions by severity")
header_row(14, 2, ["Severity", "Count", "Share"])
for i, sev in enumerate(SEV, 15):
    d.cell(i, 2, sev).font = f(10, True, SEV[sev][0]); d.cell(i, 2).fill = fill(SEV[sev][1])
    d.cell(i, 3, f'=COUNTIF({EXR},B{i})').font = f(10, True)
    c = d.cell(i, 4, f"=IF(SUM($C$15:$C$18)=0,0,C{i}/SUM($C$15:$C$18))"); c.number_format = "0.0%"; c.font = f(10)
    for cc in (2, 3, 4):
        d.cell(i, cc).border = BOX; d.cell(i, cc).alignment = Alignment(horizontal="center")

# ---- Section: category (F12:H17)
section("F12:H12", "Exceptions by category")
header_row(14, 6, ["Category", "Count", "Share"])
for i, cat in enumerate(CAT, 15):
    d.cell(i, 6, cat).font = f(10, True, CAT[cat])
    d.cell(i, 7, f'=COUNTIF({EXC},F{i})').font = f(10, True)
    c = d.cell(i, 8, f"=IF(SUM($G$15:$G$17)=0,0,G{i}/SUM($G$15:$G$17))"); c.number_format = "0.0%"; c.font = f(10)
    for cc in (6, 7, 8):
        d.cell(i, cc).border = BOX; d.cell(i, cc).alignment = Alignment(horizontal="center")

# ---- Section: entity health (J12:Q17)
section("J12:Q12", "Health by entity")
header_row(14, 10, ["Entity", "Records", "With issues", "Clean rate", "Critical", "High", "Medium", "Low"])
d.row_dimensions[14].height = 26
for i, (ent, (sheet, dqcol)) in enumerate(ent_rows.items(), 15):
    d.cell(i, 10, ent).font = f(10, True)
    d.cell(i, 11, f'=SUMPRODUCT(--(LEN({sheet}!$A$2:$A$5000&{sheet}!$B$2:$B$5000&{sheet}!$C$2:$C$5000)>0))')
    d.cell(i, 12, f'=COUNTIF({sheet}!${dqcol}$2:${dqcol}$5000,">0")')
    c = d.cell(i, 13, f"=IF(K{i}=0,0,1-L{i}/K{i})"); c.number_format = "0.0%"
    for j, sev in enumerate(SEV, 14):
        d.cell(i, j, f'=COUNTIFS({EXE},$J{i},{EXR},"{sev}")').font = f(10, False, SEV[sev][0])
    for cc in range(10, 18):
        d.cell(i, cc).border = BOX; d.cell(i, cc).alignment = Alignment(horizontal="center")
        if cc in (11, 12, 13):
            d.cell(i, cc).font = f(10)
d.conditional_formatting.add("M15:M17", DataBarRule(start_type="num", start_value=0, end_type="num", end_value=1, color="22C55E"))

# ---- Charts row 20-36
d.merge_cells("B20:Q20")
d["B20"] = "Visual summary"; d["B20"].font = f(11, True, NAVY)
for c in range(2, 18):
    d.cell(20, c).border = Border(bottom=Side(style="medium", color=INDIGO))

dn = DoughnutChart(holeSize=55)
dn.title = "Severity mix"
dn.add_data(Reference(d, min_col=3, min_row=14, max_row=18), titles_from_data=True)
dn.set_categories(Reference(d, min_col=2, min_row=15, max_row=18))
s = dn.series[0]
for idx, sev in enumerate(SEV):
    pt = DataPoint(idx=idx); pt.graphicalProperties.solidFill = SEV[sev][0]; pt.graphicalProperties.line.solidFill = "FFFFFF"
    s.dPt.append(pt)
s.dLbls = DataLabelList(); s.dLbls.showVal = True; s.dLbls.showLegendKey = False; s.dLbls.showCatName = False; s.dLbls.showSerName = False; s.dLbls.showPercent = False; s.dLbls.showLeaderLines = False
dn.legend.position = "b"; dn.legend.overlay = False
dn.roundedCorners = False
dn.width, dn.height = 9.5, 7.6
d.add_chart(dn, "B22")

bc = BarChart(); bc.type = "bar"; bc.grouping = "stacked"; bc.overlap = 100
bc.title = "Exceptions by entity and severity"
bc.add_data(Reference(d, min_col=14, max_col=17, min_row=14, max_row=17), titles_from_data=True)
bc.set_categories(Reference(d, min_col=10, min_row=15, max_row=17))
for s, sev in zip(bc.series, SEV):
    s.graphicalProperties.solidFill = SEV[sev][0]; s.graphicalProperties.line.solidFill = SEV[sev][0]
bc.legend.position = "b"; bc.legend.overlay = False
bc.x_axis.delete = False; bc.y_axis.delete = False
bc.y_axis.majorGridlines = None
bc.gapWidth = 60
bc.roundedCorners = False
bc.width, bc.height = 11.5, 7.6
d.add_chart(bc, "F22")

cc_ = BarChart(); cc_.type = "col"; cc_.title = "Clean record rate by entity"
cc_.add_data(Reference(d, min_col=13, min_row=14, max_row=17), titles_from_data=True)
cc_.set_categories(Reference(d, min_col=10, min_row=15, max_row=17))
cc_.series[0].graphicalProperties.solidFill = "22C55E"; cc_.series[0].graphicalProperties.line.solidFill = "22C55E"
cc_.series[0].dLbls = DataLabelList(); cc_.series[0].dLbls.showVal = True
for a in ("showSerName", "showCatName", "showPercent", "showLegendKey"):
    setattr(cc_.series[0].dLbls, a, False)
cc_.series[0].dLbls.numFmt = "0%"
cc_.y_axis.scaling.min = 0; cc_.y_axis.scaling.max = 1; cc_.y_axis.numFmt = "0%"; cc_.y_axis.majorGridlines = None
cc_.legend = None
cc_.x_axis.delete = False; cc_.y_axis.delete = False
cc_.gapWidth = 80
cc_.roundedCorners = False
cc_.width, cc_.height = 9.5, 7.6
d.add_chart(cc_, "M22")

# ---- Owner workload (B40:H) and rule hits (J40:Q)
section("B41:H41", "Data owner workload (who gets this week's email)")
header_row(43, 2, ["Entity", "Region", "Owner", "", "", "Open", "Crit+High"])
d.merge_cells("D43:F43")
d["D43"] = "Owner"; d["G43"] = "Open"; d["H43"] = "Crit+High"
d["G43"].font = d["H43"].font = f(9, True, "FFFFFF")
d["G43"].fill = d["H43"].fill = fill(NAVY)
owners = ref["Owners"]
for k in range(len(owners)):
    i, r = 44 + k, k + 2
    d.cell(i, 2, f"=Owners!A{r}").font = f(10)
    d.cell(i, 3, f"=Owners!B{r}").font = f(10)
    d.merge_cells(start_row=i, start_column=4, end_row=i, end_column=6)
    d.cell(i, 4, f"=Owners!C{r}").font = f(10)
    d.cell(i, 7, f"=COUNTIF({EXOWN},Owners!D{r})").font = f(10, True)
    d.cell(i, 8, f'=COUNTIFS({EXOWN},Owners!D{r},{EXR},"Critical")+COUNTIFS({EXOWN},Owners!D{r},{EXR},"High")').font = f(10)
    for cc in range(2, 9):
        d.cell(i, cc).border = BOTTOM
    for cc in (2, 3, 7, 8):
        d.cell(i, cc).alignment = Alignment(horizontal="center")
last_owner = 43 + len(owners)
d.conditional_formatting.add(f"G44:G{last_owner}", DataBarRule(start_type="num", start_value=0, end_type="max", color="6366F1"))
d.conditional_formatting.add(f"H44:H{last_owner}", CellIsRule(operator="greaterThan", formula=["0"], font=Font(name=FONT, color=SEV["Critical"][0], bold=True)))
d["O8"].value = f'=COUNTIF($G$44:$G${last_owner},">0")'

section("J41:Q41", "Rule hits this run")
header_row(43, 10, ["Rule", "Rule name", "", "", "Category", "Severity", "Enabled", "Hits"])
d.merge_cells("K43:M43")
for k in range(len(rules_rows)):
    i, r = 44 + k, k + 2
    d.cell(i, 10, f"=Rules!A{r}").font = f(9, True, INK)
    d.cell(i, 11, f"=Rules!C{r}").font = f(9)
    d.merge_cells(start_row=i, start_column=11, end_row=i, end_column=13)
    d.cell(i, 14, f"=Rules!B{r}").font = f(9, False, MUTED)
    d.cell(i, 15, f"=Rules!E{r}").font = f(9, True)
    d.cell(i, 16, f"=Rules!F{r}").font = f(9, False, MUTED)
    d.cell(i, 17, f"=COUNTIF({EXRULE},J{i})").font = f(10, True)
    for cc in range(10, 18):
        d.cell(i, cc).border = BOTTOM
    for cc in (10, 14, 15, 16, 17):
        d.cell(i, cc).alignment = Alignment(horizontal="center")
last_rule = 43 + len(rules_rows)
d.conditional_formatting.add(f"Q44:Q{last_rule}", DataBarRule(start_type="num", start_value=0, end_type="max", color="EC4899"))
for sev, (fg, bg) in SEV.items():
    d.conditional_formatting.add(f"O44:O{last_rule}", CellIsRule(operator="equal", formula=[f'"{sev}"'], fill=fill(bg), font=Font(name=FONT, color=fg, bold=True)))
d.conditional_formatting.add(f"P44:P{last_rule}", CellIsRule(operator="equal", formula=['"No"'], font=Font(name=FONT, color="B4232F", bold=True)))

d.freeze_panes = "A6"
d.page_setup.orientation = "landscape"; d.page_setup.fitToWidth = 1; d.page_setup.fitToHeight = 1
d.sheet_properties.pageSetUpPr.fitToPage = True
d.print_area = f"A1:R{last_rule + 1}"
d.sheet_properties.tabColor = NAVY
for name, color in TAB.items():
    if name in wb.sheetnames:
        wb[name].sheet_properties.tabColor = color
wb.active = 0
wb.properties.title = "Automated Master Data Quality Check"
wb.properties.creator = "Master Data Quality Check"
wb.save(OUT)
print("saved", OUT)
