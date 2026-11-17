// Reference table tblRules (sheet "Config"). Edit the Excel table to change behaviour - no M changes needed.
let
    Source = Excel.CurrentWorkbook(){[Name = "tblRules"]}[Content]
in
    Source
