// Lower-case, "&" -> " and ", every character outside [a-z0-9] -> space, collapse spaces and
// (for business partners) drop legal-form tokens such as Inc, Ltd, GmbH, LLC.
(v as any, dropLegal as logical) as text =>
let
    LegalTokens = {"inc", "incorporated", "ltd", "limited", "llc", "gmbh", "ag", "sa", "sarl", "bv", "nv", "plc",
                   "co", "corp", "corporation", "company", "pty", "pte", "pvt", "srl", "spa", "sl", "kk", "ltda",
                   "de", "cv", "the"},
    Allowed = {"a".."z", "0".."9"},
    Lower = Text.Replace(Text.Lower(fnText(v)), "&", " and "),
    Cleaned = Text.Combine(List.Transform(Text.ToList(Lower), each if List.Contains(Allowed, _) then _ else " ")),
    Tokens = List.Select(Text.Split(Cleaned, " "), each _ <> "" and not (dropLegal and List.Contains(LegalTokens, _)))
in
    Text.Combine(Tokens, " ")
