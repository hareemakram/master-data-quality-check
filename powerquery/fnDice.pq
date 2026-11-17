// Sorensen-Dice similarity on character bigrams (spaces removed, multiset intersection). 0..1.
(a as text, b as text) as number =>
let
    X = Text.Remove(a, " "),
    Y = Text.Remove(b, " "),
    Bigrams = (s as text) as list => List.Transform({0 .. Text.Length(s) - 2}, each Text.Middle(s, _, 2)),
    BX = Bigrams(X),
    BY = Bigrams(Y),
    Counts = (l as list, g as text) as number => List.Count(List.Select(l, each _ = g)),
    Inter = List.Sum(List.Transform(List.Distinct(BX), (g) => List.Min({Counts(BX, g), Counts(BY, g)}))),
    Result = if Text.Length(X) < 2 or Text.Length(Y) < 2 then (if X = Y then 1 else 0)
             else 2 * Inter / (List.Count(BX) + List.Count(BY))
in
    Result
