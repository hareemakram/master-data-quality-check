// Settings table (sheet "Settings") - key/value pairs that drive the run.
let
    Source = Excel.CurrentWorkbook(){[Name = "tblSettings"]}[Content],
    Typed = Table.TransformColumnTypes(Source, {{"Setting", type text}})
in
    Typed
