// Reference table tblLists (sheet "Config"). Edit the Excel table to change behaviour - no M changes needed.
let
    Source = Excel.CurrentWorkbook(){[Name = "tblLists"]}[Content]
in
    Source
