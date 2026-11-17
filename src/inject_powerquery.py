"""Embeds the Power Query queries (build/Section1.m) into the workbook as a real Excel
DataMashup (MS-QDEFF), registers workbook connections, and binds the Exceptions sheet table
to the 'Exceptions' query as a query table (so Data > Refresh All rebuilds it)."""
import base64, io, json, os, re, struct, sys, uuid, zipfile, datetime
from xml.sax.saxutils import escape

ROOT = os.path.join(os.path.dirname(__file__), "..")
WB = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "build/MasterDataQuality.xlsx")
SECTION = open(os.path.join(ROOT, "build/Section1.m"), encoding="utf-8", newline="").read()
QUERIES = json.load(open(os.path.join(ROOT, "build/queries.json")))
LOADED, TABLE_NAME, SHEET_NAME = "Exceptions", "tblExceptions", "Exceptions"
TABLE_QUERIES = {q["name"] for q in QUERIES if q["name"].startswith(("Cfg_", "Src_"))} | {LOADED}


def guid():
    return "{" + str(uuid.uuid4()).upper() + "}"


# ------------------------------------------------------------------ template blocks
tz = zipfile.ZipFile(os.path.join(ROOT, "build/pq_template.xlsx"))
tmpl = tz.read("customXml/item1.xml").decode("utf-16")
raw = base64.b64decode(re.search(r">([A-Za-z0-9+/=]+)</DataMashup>", tmpl).group(1))
o = 4
n, = struct.unpack("<I", raw[o:o + 4]); o += 4; tpkg = zipfile.ZipFile(io.BytesIO(raw[o:o + n])); o += n
n, = struct.unpack("<I", raw[o:o + 4]); o += 4; permissions = raw[o:o + n]; o += n
n, = struct.unpack("<I", raw[o:o + 4]); o += 4; tmeta = raw[o:o + n]; o += n
n, = struct.unpack("<I", raw[o:o + 4]); o += 4; bindings = raw[o:o + n]; o += n
xl_len, = struct.unpack("<I", tmeta[4:8]); meta_content = tmeta[8 + xl_len:]  # length-prefixed empty zip

# ------------------------------------------------------------------ package parts
pkg_buf = io.BytesIO()
with zipfile.ZipFile(pkg_buf, "w", zipfile.ZIP_STORED) as z:
    z.writestr("Config/Package.xml", tpkg.read("Config/Package.xml"))
    z.writestr("[Content_Types].xml", tpkg.read("[Content_Types].xml"))
    z.writestr("Formulas/Section1.m", SECTION.encode("utf-8"))
    z.writestr("Formulas/", b"")
pkg = pkg_buf.getvalue()

# ------------------------------------------------------------------ metadata
wbz = zipfile.ZipFile(WB)
names = wbz.namelist()
table_part = next(p for p in names if p.startswith("xl/tables/table") and f'displayName="{TABLE_NAME}"' in wbz.read(p).decode())
table_xml = wbz.read(table_part).decode()
columns = re.findall(r'<tableColumn [^>]*name="([^"]+)"', table_xml)
ref = re.search(r' ref="([A-Z]+\d+:[A-Z]+\d+)"', table_xml).group(1)
row_count = int(re.search(r"\d+$", ref).group(0)) - 1
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.0000000Z")


def entry(t, v):
    return f'<Entry Type="{t}" Value="{escape(v, {chr(34): "&quot;"})}"/>'


items = ['<Item><ItemLocation><ItemType>AllFormulas</ItemType><ItemPath/></ItemLocation><StableEntries/></Item>']
for q in QUERIES:
    nm = q["name"]
    if nm == LOADED:
        ent = [entry("IsPrivate", "l0"), entry("FillEnabled", "l1"), entry("FillObjectType", "sTable"),
               entry("FillToDataModelEnabled", "l0"), entry("BufferNextRefresh", "l1"), entry("ResultType", "sTable"),
               entry("NameUpdatedAfterFill", "l0"), entry("NavigationStepName", "sNavigation"),
               entry("FillTarget", "s" + TABLE_NAME), entry("FilledCompleteResultToWorksheet", "l1"),
               entry("AddedToDataModel", "l0"), entry("FillCount", f"l{row_count}"), entry("FillErrorCode", "sUnknown"),
               entry("FillErrorCount", "l0"), entry("FillLastUpdated", "d" + now),
               entry("FillColumnNames", "s" + json.dumps(columns)), entry("FillStatus", "sComplete")]
    else:
        ent = [entry("IsPrivate", "l0"), entry("FillEnabled", "l0"), entry("FillObjectType", "sConnectionOnly"),
               entry("FillToDataModelEnabled", "l0"), entry("BufferNextRefresh", "l1"),
               entry("ResultType", "sFunction" if q["isFunction"] else ("sText" if nm == "RunDate" else "sTable")),
               entry("NameUpdatedAfterFill", "l0"), entry("NavigationStepName", "sNavigation"),
               entry("AddedToDataModel", "l0"), entry("FillErrorCode", "sUnknown"), entry("FillLastUpdated", "d" + now),
               entry("FillStatus", "sComplete")]
    items.append(f"<Item><ItemLocation><ItemType>Formula</ItemType><ItemPath>Section1/{nm}</ItemPath></ItemLocation>"
                 f"<StableEntries>{''.join(ent)}</StableEntries></Item>")
meta_xml = ('<?xml version="1.0" encoding="utf-8"?><LocalPackageMetadataFile xmlns:xsd="http://www.w3.org/2001/XMLSchema" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Items>' + "".join(items) + "</Items></LocalPackageMetadataFile>").encode("utf-8")
meta = struct.pack("<I", 0) + struct.pack("<I", len(meta_xml)) + meta_xml + meta_content


def block(b):
    return struct.pack("<I", len(b)) + b


mashup = struct.pack("<I", 0) + block(pkg) + block(permissions) + block(meta) + block(bindings)
datamashup_xml = ('<?xml version="1.0" encoding="utf-16"?><DataMashup xmlns="http://schemas.microsoft.com/DataMashup">'
                  + base64.b64encode(mashup).decode() + "</DataMashup>").encode("utf-16")

# ------------------------------------------------------------------ connections & query table
conns, conn_id = [], {}
for i, nm in enumerate([LOADED] + sorted(TABLE_QUERIES - {LOADED}), 1):
    conn_id[nm] = i
    loaded = nm == LOADED
    conns.append(
        f'<connection id="{i}" xr16:uid="{guid()}" keepAlive="1" name="Query - {nm}" '
        f'description="Connection to the \'{nm}\' query in the workbook." type="5" refreshedVersion="{8 if loaded else 0}" '
        f'background="1"{" saveData=\"1\"" if loaded else ""}><dbPr connection="Provider=Microsoft.Mashup.OleDb.1;'
        f'Data Source=$Workbook$;Location={nm};Extended Properties=&quot;&quot;" command="SELECT * FROM [{nm}]"/></connection>')
connections_xml = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="xr16" '
                   'xmlns:xr16="http://schemas.microsoft.com/office/spreadsheetml/2017/revision16">' + "".join(conns) + "</connections>")

fields = "".join(f'<queryTableField id="{i}" name="{escape(c)}" tableColumnId="{i}"/>' for i, c in enumerate(columns, 1))
query_table_xml = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<queryTable xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="xr16" '
                   'xmlns:xr16="http://schemas.microsoft.com/office/spreadsheetml/2017/revision16" name="ExternalData_1" '
                   f'connectionId="{conn_id[LOADED]}" xr16:uid="{guid()}" autoFormatId="16" applyNumberFormats="0" applyBorderFormats="0" '
                   'applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="0">'
                   f'<queryTableRefresh nextId="{len(columns) + 1}"><queryTableFields count="{len(columns)}">{fields}</queryTableFields>'
                   '</queryTableRefresh></queryTable>')

new_table_xml = table_xml.replace("<table ", '<table tableType="queryTable" ', 1)
for i, c in enumerate(columns, 1):
    new_table_xml = re.sub(rf'<tableColumn id="{i}" name="{re.escape(escape(c))}"',
                           f'<tableColumn id="{i}" uniqueName="{i}" name="{escape(c)}" queryTableFieldId="{i}"', new_table_xml, count=1)
assert new_table_xml.count("queryTableFieldId") == len(columns), "column rewrite failed"
table_rels_part = table_part.replace("xl/tables/", "xl/tables/_rels/") + ".rels"
table_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
              '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/queryTable" '
              'Target="../queryTables/queryTable1.xml"/></Relationships>')
item_props = ('<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<ds:datastoreItem ds:itemID="' + guid() +
              '" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs>'
              '<ds:schemaRef ds:uri="http://schemas.microsoft.com/DataMashup"/></ds:schemaRefs></ds:datastoreItem>')
item_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>')

# ------------------------------------------------------------------ workbook-level edits
ct = wbz.read("[Content_Types].xml").decode()
add_ct = ('<Override PartName="/xl/connections.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml"/>'
          '<Override PartName="/xl/queryTables/queryTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml"/>'
          '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>')
assert "connections.xml" not in ct
ct = ct.replace("</Types>", add_ct + "</Types>")

wrels = wbz.read("xl/_rels/workbook.xml.rels").decode()
ids = [int(x) for x in re.findall(r'Id="rId(\d+)"', wrels)]
r1, r2 = max(ids) + 1, max(ids) + 2
wrels = wrels.replace("</Relationships>",
                      f'<Relationship Id="rId{r1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections" Target="connections.xml"/>'
                      f'<Relationship Id="rId{r2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/></Relationships>')

wbxml = wbz.read("xl/workbook.xml").decode()
sheet_names = re.findall(r'<sheet [^>]*name="([^"]+)"', wbxml)
local_id = sheet_names.index(SHEET_NAME)
dn = f'<definedName name="ExternalData_1" localSheetId="{local_id}" hidden="1">{SHEET_NAME}!${ref.split(":")[0][0]}$1:${re.match(r"[A-Z]+", ref.split(":")[1]).group(0)}${row_count + 1}</definedName>'
if "<definedNames>" in wbxml:
    wbxml = wbxml.replace("<definedNames>", "<definedNames>" + dn, 1)
elif "<definedNames/>" in wbxml:
    wbxml = wbxml.replace("<definedNames/>", "<definedNames>" + dn + "</definedNames>", 1)
else:
    wbxml = wbxml.replace("</sheets>", "</sheets><definedNames>" + dn + "</definedNames>", 1)

out = io.BytesIO()
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for item in wbz.infolist():
        data = wbz.read(item.filename)
        if item.filename == "[Content_Types].xml": data = ct.encode()
        elif item.filename == "xl/_rels/workbook.xml.rels": data = wrels.encode()
        elif item.filename == "xl/workbook.xml": data = wbxml.encode()
        elif item.filename == table_part: data = new_table_xml.encode()
        z.writestr(item, data)
    z.writestr("xl/connections.xml", connections_xml)
    z.writestr("xl/queryTables/queryTable1.xml", query_table_xml)
    z.writestr(table_rels_part, table_rels)
    z.writestr("customXml/item1.xml", datamashup_xml)
    z.writestr("customXml/itemProps1.xml", item_props)
    z.writestr("customXml/_rels/item1.xml.rels", item_rels)
wbz.close()
open(WB, "wb").write(out.getvalue())
print(f"Injected {len(QUERIES)} queries ({len(conns)} connections), {TABLE_NAME} bound to '{LOADED}' ({row_count} rows)")
