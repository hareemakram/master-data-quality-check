// Number from a numeric cell or numeric text ("-12.50"); null when the value is not numeric.
(v as any) as nullable number =>
let
    T = if v is text then Text.Trim(v) else "",
    Body = if Text.StartsWith(T, "-") then Text.Middle(T, 1) else T,
    Parts = Text.Split(Body, "."),
    AllDigits = (s as text) as logical => s <> "" and Text.Select(s, {"0".."9"}) = s,
    IsNumericText = List.Count(Parts) <= 2 and List.AllTrue(List.Transform(Parts, AllDigits)),
    Result =
        if v is number then v
        else if v is text and IsNumericText then Number.FromText(T, "en-US")
        else null
in
    Result
