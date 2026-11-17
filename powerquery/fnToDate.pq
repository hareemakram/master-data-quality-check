// yyyy-MM-dd text for a valid date (Excel date, Excel serial number or ISO text), otherwise null.
(v as any) as nullable text =>
let
    Iso = (d as date) as text => Date.ToText(d, [Format = "yyyy-MM-dd", Culture = "en-US"]),
    FromText = (t0 as text) as nullable text =>
        let
            t = Text.Trim(t0),
            Head = Text.Start(t, 10),
            Tail = Text.Middle(t, 10),
            ShapeOk = fnMatchesPattern(Head, "####-##-##")
                      and (Tail = "" or ((Text.StartsWith(Tail, "T") or Text.StartsWith(Tail, " "))
                                         and fnMatchesPattern(Text.Middle(Tail, 1), "##:##|##:##:##"))),
            Parsed = if ShapeOk
                     then try #date(Number.From(Text.Start(Head, 4)), Number.From(Text.Middle(Head, 5, 2)),
                                    Number.From(Text.Middle(Head, 8, 2))) otherwise null
                     else null
        in
            if Parsed = null then null else Iso(Parsed),
    Result =
        if v is date or v is datetime or v is datetimezone then Iso(Date.From(v))
        else if v is number then (if v >= 1 and v <= 2958465 then Iso(Date.From(Number.RoundDown(v))) else null)
        else if v is text then FromText(v)
        else null
in
    Result
