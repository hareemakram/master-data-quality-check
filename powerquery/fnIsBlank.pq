// True when a cell is null or only whitespace.
(v as any) as logical =>
    v = null or (v is text and Text.Trim(v) = "")
