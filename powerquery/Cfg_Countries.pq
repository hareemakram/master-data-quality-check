// Reference table tblCountries (sheet "Config"). Edit the Excel table to change behaviour - no M changes needed.
let
    Source = Excel.CurrentWorkbook(){[Name = "tblCountries"]}[Content]
in
    Source
