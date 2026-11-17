// Mask matching without regex: "#" digit, "@" letter A-Z, "?" letter or digit, other characters literal.
// Alternative masks are separated by "|". Comparison is on the trimmed, upper-cased value.
(value as text, pattern as text) as logical =>
let
    V = Text.Upper(Text.Trim(value)),
    Matches = (p as text) as logical =>
        Text.Length(p) = Text.Length(V) and
        List.AllTrue(List.Transform(List.Zip({Text.ToList(p), Text.ToList(V)}), (pr) =>
            let
                m = pr{0}, c = pr{1},
                isD = c >= "0" and c <= "9",
                isL = c >= "A" and c <= "Z"
            in
                if m = "#" then isD else if m = "@" then isL else if m = "?" then isD or isL else m = c))
in
    List.AnyTrue(List.Transform(Text.Split(pattern, "|"), Matches))
