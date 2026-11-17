// Returns null when the phone number is valid, otherwise the reason.
// Valid = "+" then 8-15 digits starting with the country calling code (spaces, dashes, dots, brackets ignored).
(v as text, phoneCode as nullable text) as nullable text =>
let
    S = Text.Remove(Text.Trim(v), {" ", "-", "(", ")", "."}),
    Digits = Text.Middle(S, 1),
    Result =
        if not Text.StartsWith(S, "+") then "must start with + and the country calling code"
        else if Digits = "" or Text.Select(Digits, {"0".."9"}) <> Digits then "contains characters other than digits"
        else if Text.Length(Digits) < 8 or Text.Length(Digits) > 15 then "must contain 8-15 digits"
        else if phoneCode <> null and not Text.StartsWith(Digits, phoneCode)
            then "calling code does not match country (+" & phoneCode & ")"
        else null
in
    Result
