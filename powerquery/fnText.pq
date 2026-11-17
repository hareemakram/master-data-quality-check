// Converts any cell value to text ("" for null) without failing on numbers, dates or logicals.
(v as any) as text =>
    if v = null then ""
    else if v is text then v
    else if v is logical then (if v then "TRUE" else "FALSE")
    else Text.From(v, "en-US")
