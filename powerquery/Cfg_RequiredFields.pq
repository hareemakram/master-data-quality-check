// Reference table tblRequiredFields (sheet "Config"). Edit the Excel table to change behaviour - no M changes needed.
let
    Source = Excel.CurrentWorkbook(){[Name = "tblRequiredFields"]}[Content]
in
    Source
