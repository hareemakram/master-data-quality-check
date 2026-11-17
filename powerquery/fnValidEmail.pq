// One "@", non-empty local part and domain, allowed characters only, no leading/trailing/double dots,
// a dotted domain and an alphabetic top-level domain of 2+ characters. No whitespace anywhere.
(v as text) as logical =>
let
    S = Text.Trim(v),
    Letters = {"A".."Z", "a".."z"},
    Digits = {"0".."9"},
    HasWhitespace = Text.Length(Text.Select(S, {" ", "#(tab)", "#(cr)", "#(lf)", "#(00A0)"})) > 0,
    Parts = Text.Split(S, "@"),
    Local = Parts{0},
    Domain = if List.Count(Parts) > 1 then Parts{1} else "",
    LocalOk = Local <> "" and Text.Remove(Local, Letters & Digits & {".", "_", "%", "+", "'", "-"}) = ""
              and not Text.StartsWith(Local, ".") and not Text.EndsWith(Local, ".") and not Text.Contains(Local, ".."),
    DomainOk = Domain <> "" and Text.Remove(Domain, Letters & Digits & {".", "-"}) = ""
               and Text.Contains(Domain, ".") and not Text.StartsWith(Domain, ".") and not Text.EndsWith(Domain, ".")
               and not Text.Contains(Domain, ".."),
    Tld = if DomainOk then Text.AfterDelimiter(Domain, ".", {0, RelativePosition.FromEnd}) else "",
    TldOk = Text.Length(Tld) >= 2 and Text.Remove(Tld, Letters) = ""
in
    not HasWhitespace and List.Count(Parts) = 2 and LocalOk and DomainOk and TldOk
