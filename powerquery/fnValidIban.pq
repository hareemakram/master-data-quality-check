// ISO 13616 IBAN validation: alphanumeric, length defined for the IBAN country, mod-97 = 1.
(v as text, ibanLengths as record) as logical =>
let
    S = Text.Remove(Text.Upper(v), " "),
    Alnum = {"A".."Z", "0".."9"},
    CC = Text.Start(S, 2),
    ExpectedLength = Record.FieldOrDefault(ibanLengths, CC, null),
    Rearranged = Text.Middle(S, 4) & Text.Start(S, 4),
    Remainder = List.Accumulate(Text.ToList(Rearranged), 0, (state, c) =>
        let
            d = if c >= "A" and c <= "Z" then Text.From(Character.ToNumber(c) - 55) else c
        in
            List.Accumulate(Text.ToList(d), state, (s2, ch) => Number.Mod(s2 * 10 + Number.From(ch), 97))),
    Result =
        if Text.Select(S, Alnum) <> S or Text.Length(S) < 5 then false
        else if ExpectedLength = null or Text.Length(S) <> ExpectedLength then false
        else Remainder = 1
in
    Result
