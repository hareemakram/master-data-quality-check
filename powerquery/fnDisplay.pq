// Display form of a cell value for the exception report (dates as yyyy-MM-dd).
(v as any) as text =>
    if v is date or v is datetime or v is datetimezone
    then Date.ToText(Date.From(v), [Format = "yyyy-MM-dd", Culture = "en-US"])
    else fnText(v)
