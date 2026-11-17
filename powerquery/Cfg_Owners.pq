// Reference table tblOwners (sheet "Config"). Edit the Excel table to change behaviour - no M changes needed.
let
    Source = Excel.CurrentWorkbook(){[Name = "tblOwners"]}[Content]
in
    Source
