// Source master data: tblMaterials. Replace this step with your ERP / SharePoint / CSV source if required
// (keep the column names) - e.g. SharePoint.Files(...) or Sql.Database(...).
let
    Source = Excel.CurrentWorkbook(){[Name = "tblMaterials"]}[Content],
    Indexed = Table.AddIndexColumn(Source, "SourceRow", 1, 1, Int64.Type)
in
    Indexed
