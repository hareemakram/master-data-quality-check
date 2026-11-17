section Section1;

shared Cfg_Settings = // Settings table (sheet "Settings") - key/value pairs that drive the run.
let
    Source = Excel.CurrentWorkbook(){[Name = "tblSettings"]}[Content],
    Typed = Table.TransformColumnTypes(Source, {{"Setting", type text}})
in
    Typed;

shared RunDate = // Run date as yyyy-MM-dd text. Uses Settings[RunDateOverride] when filled in, otherwise today.
let
    Override = try Cfg_Settings{[Setting = "RunDateOverride"]}[Value] otherwise null,
    Parsed = if fnIsBlank(Override) then null else fnToDate(Override),
    Result = if Parsed <> null then Parsed
             else Date.ToText(Date.From(DateTime.LocalNow()), [Format = "yyyy-MM-dd", Culture = "en-US"])
in
    Result;

shared Cfg_Countries = // Reference table tblCountries (sheet "Config"). Edit the Excel table to change behaviour - no M changes needed.
let
    Source = Excel.CurrentWorkbook(){[Name = "tblCountries"]}[Content]
in
    Source;

shared Cfg_Lists = // Reference table tblLists (sheet "Config"). Edit the Excel table to change behaviour - no M changes needed.
let
    Source = Excel.CurrentWorkbook(){[Name = "tblLists"]}[Content]
in
    Source;

shared Cfg_Rules = // Reference table tblRules (sheet "Config"). Edit the Excel table to change behaviour - no M changes needed.
let
    Source = Excel.CurrentWorkbook(){[Name = "tblRules"]}[Content]
in
    Source;

shared Cfg_RequiredFields = // Reference table tblRequiredFields (sheet "Config"). Edit the Excel table to change behaviour - no M changes needed.
let
    Source = Excel.CurrentWorkbook(){[Name = "tblRequiredFields"]}[Content]
in
    Source;

shared Cfg_Owners = // Reference table tblOwners (sheet "Config"). Edit the Excel table to change behaviour - no M changes needed.
let
    Source = Excel.CurrentWorkbook(){[Name = "tblOwners"]}[Content]
in
    Source;

shared Src_Customers = // Source master data: tblCustomers. Replace this step with your ERP / SharePoint / CSV source if required
// (keep the column names) - e.g. SharePoint.Files(...) or Sql.Database(...).
let
    Source = Excel.CurrentWorkbook(){[Name = "tblCustomers"]}[Content],
    Indexed = Table.AddIndexColumn(Source, "SourceRow", 1, 1, Int64.Type)
in
    Indexed;

shared Src_Vendors = // Source master data: tblVendors. Replace this step with your ERP / SharePoint / CSV source if required
// (keep the column names) - e.g. SharePoint.Files(...) or Sql.Database(...).
let
    Source = Excel.CurrentWorkbook(){[Name = "tblVendors"]}[Content],
    Indexed = Table.AddIndexColumn(Source, "SourceRow", 1, 1, Int64.Type)
in
    Indexed;

shared Src_Materials = // Source master data: tblMaterials. Replace this step with your ERP / SharePoint / CSV source if required
// (keep the column names) - e.g. SharePoint.Files(...) or Sql.Database(...).
let
    Source = Excel.CurrentWorkbook(){[Name = "tblMaterials"]}[Content],
    Indexed = Table.AddIndexColumn(Source, "SourceRow", 1, 1, Int64.Type)
in
    Indexed;

shared fnIsBlank = // True when a cell is null or only whitespace.
(v as any) as logical =>
    v = null or (v is text and Text.Trim(v) = "");

shared fnText = // Converts any cell value to text ("" for null) without failing on numbers, dates or logicals.
(v as any) as text =>
    if v = null then ""
    else if v is text then v
    else if v is logical then (if v then "TRUE" else "FALSE")
    else Text.From(v, "en-US");

shared fnTrim = (v as any) as text => Text.Trim(fnText(v));

shared fnDisplay = // Display form of a cell value for the exception report (dates as yyyy-MM-dd).
(v as any) as text =>
    if v is date or v is datetime or v is datetimezone
    then Date.ToText(Date.From(v), [Format = "yyyy-MM-dd", Culture = "en-US"])
    else fnText(v);

shared fnNormalizeName = // Lower-case, "&" -> " and ", every character outside [a-z0-9] -> space, collapse spaces and
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
    Text.Combine(Tokens, " ");

shared fnDice = // Sorensen-Dice similarity on character bigrams (spaces removed, multiset intersection). 0..1.
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
    Result;

shared fnMatchesPattern = // Mask matching without regex: "#" digit, "@" letter A-Z, "?" letter or digit, other characters literal.
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
    List.AnyTrue(List.Transform(Text.Split(pattern, "|"), Matches));

shared fnValidEmail = // One "@", non-empty local part and domain, allowed characters only, no leading/trailing/double dots,
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
    not HasWhitespace and List.Count(Parts) = 2 and LocalOk and DomainOk and TldOk;

shared fnPhoneProblem = // Returns null when the phone number is valid, otherwise the reason.
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
    Result;

shared fnValidIban = // ISO 13616 IBAN validation: alphanumeric, length defined for the IBAN country, mod-97 = 1.
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
    Result;

shared fnToNumber = // Number from a numeric cell or numeric text ("-12.50"); null when the value is not numeric.
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
    Result;

shared fnToDate = // yyyy-MM-dd text for a valid date (Excel date, Excel serial number or ISO text), otherwise null.
(v as any) as nullable text =>
let
    Iso = (d as date) as text => Date.ToText(d, [Format = "yyyy-MM-dd", Culture = "en-US"]),
    FromText = (t0 as text) as nullable text =>
        let
            t = Text.Trim(t0),
            Head = Text.Start(t, 10),
            Tail = Text.Middle(t, 10),
            ShapeOk = fnMatchesPattern(Head, "####-##-##")
                      and (Tail = "" or ((Text.StartsWith(Tail, "T") or Text.StartsWith(Tail, " "))
                                         and fnMatchesPattern(Text.Middle(Tail, 1), "##:##|##:##:##"))),
            Parsed = if ShapeOk
                     then try #date(Number.From(Text.Start(Head, 4)), Number.From(Text.Middle(Head, 5, 2)),
                                    Number.From(Text.Middle(Head, 8, 2))) otherwise null
                     else null
        in
            if Parsed = null then null else Iso(Parsed),
    Result =
        if v is date or v is datetime or v is datetimezone then Iso(Date.From(v))
        else if v is number then (if v >= 1 and v <= 2958465 then Iso(Date.From(Number.RoundDown(v))) else null)
        else if v is text then FromText(v)
        else null
in
    Result;

shared fnEntityChecks = // Runs every enabled rule against one entity ("Customer", "Vendor" or "Material") and returns
// fully-populated exception rows. Mirrors src/engine.ts rule-for-rule.
(entity as text) as table =>
let
    // ------------------------------------------------------------------ metadata
    MetaAll = [
        Customer = [Data = Src_Customers, IdField = "CustomerID", NameField = "CustomerName", Prefix = "CUS", IsPartner = true],
        Vendor   = [Data = Src_Vendors,   IdField = "VendorID",   NameField = "VendorName",   Prefix = "VEN", IsPartner = true],
        Material = [Data = Src_Materials, IdField = "MaterialID", NameField = "Description",  Prefix = "MAT", IsPartner = false]
    ],
    Meta = Record.Field(MetaAll, entity),
    IdField = Meta[IdField],
    NameField = Meta[NameField],
    IsPartner = Meta[IsPartner],
    Rows = List.Buffer(Table.ToRecords(Meta[Data])),
    Get = (r as record, field as text) as any => Record.FieldOrDefault(r, field, null),

    // ------------------------------------------------------------------ configuration lookups
    RuleRecs = Table.ToRecords(Cfg_Rules),
    RulesDict = Record.FromList(RuleRecs, List.Transform(RuleRecs, each fnTrim([RuleID]))),
    Enabled = (id as text) as logical =>
        Record.HasFields(RulesDict, id) and
        (let e = Record.Field(RulesDict, id)[Enabled] in
            not (e = false or e = 0 or (e is text and List.Contains({"false", "no", "n", "0"}, Text.Lower(Text.Trim(e)))))),
    FuzzyThreshold =
        let n = if Record.HasFields(RulesDict, "DUP-005") then fnToNumber(Record.Field(RulesDict, "DUP-005")[Threshold]) else null
        in if n = null then 0.85 else n,

    ListTable = Table.TransformColumns(Cfg_Lists, {{"ListName", fnTrim}, {"Value", fnTrim}}),
    ListGroups = Table.Group(ListTable, {"ListName"}, {{"Values", each List.Buffer([Value]), type list}}),
    ListDict = Record.FromList(ListGroups[Values], ListGroups[ListName]),
    InList = (listName as text, v as any) as logical =>
        List.Contains(Record.FieldOrDefault(ListDict, listName, {}), fnTrim(v)),

    CountryRecs = Table.ToRecords(Cfg_Countries),
    CountryCodes = List.Transform(CountryRecs, each fnTrim([CountryCode])),
    CountryDict = Record.FromList(CountryRecs, CountryCodes),
    IbanCountries = List.Select(CountryRecs, each (let n = fnToNumber([IBANLength]) in n <> null and n > 0)),
    IbanLengths = Record.FromList(List.Transform(IbanCountries, each fnToNumber([IBANLength])),
                                  List.Transform(IbanCountries, each fnTrim([CountryCode]))),
    CountryOf = (code as text) as nullable record =>
        if code <> "" and Record.HasFields(CountryDict, code) then Record.Field(CountryDict, code) else null,

    OwnerRecs = List.Buffer(Table.ToRecords(Cfg_Owners)),
    OwnerOf = (region as text) as nullable record =>
        let
            Tries = {{entity, region}, {entity, "*"}, {"*", "*"}},
            Hits = List.Transform(Tries, (t) =>
                List.First(List.Select(OwnerRecs, each fnTrim([Entity]) = t{0} and fnTrim([Region]) = t{1}), null))
        in
            List.First(List.RemoveNulls(Hits), null),

    RequiredForEntity = List.Select(Table.ToRecords(Cfg_RequiredFields), each fnTrim([Entity]) = entity),

    VendorKeyed = Table.SelectRows(Table.AddColumn(Src_Vendors, "__Id", each fnTrim([VendorID]), type text), each [__Id] <> ""),
    VendorFirst = Table.Group(VendorKeyed, {"__Id"},
        {{"__Status", each fnTrim(Table.First(Table.Sort(_, {{"SourceRow", Order.Ascending}}))[Status]), type text}}),
    VendorStatus = Record.FromList(VendorFirst[__Status], VendorFirst[__Id]),

    RegionOf = (r as record) as text =>
        if not IsPartner then "Global"
        else let c = CountryOf(Text.Upper(fnTrim(Get(r, "Country")))) in if c = null then "Unassigned" else fnTrim(c[Region]),

    // ------------------------------------------------------------------ issue constructor
    Issue = (r as record, ruleId as text, field as text, details as text,
             severityOverride as nullable text, related as nullable text) as record =>
        [SourceRow = r[SourceRow], RuleID = ruleId, Field = field, Value = fnDisplay(Get(r, field)), Details = details,
         SeverityOverride = severityOverride, RelatedRecordID = if related = null then "" else related, Row = r],

    // ------------------------------------------------------------------ duplicate groups
    GroupDup = (ruleId as text, field as text, keyFn as function, label as text) as list =>
        if not Enabled(ruleId) then {} else
        let
            Keyed = List.Select(List.Transform(Rows, each [K = keyFn(_), R = _]), each [K] <> ""),
            Grouped = Table.Group(Table.FromRecords(Keyed, {"K", "R"}), {"K"}, {{"Items", each [R], type list}}),
            Multi = List.Select(Grouped[Items], each List.Count(_) > 1),
            Out = List.Combine(List.Transform(Multi, (items) =>
                let
                    Sorted = List.Sort(items, (x, y) => Value.Compare(x[SourceRow], y[SourceRow])),
                    F = Sorted{0},
                    Fid = fnTrim(Get(F, IdField))
                in
                    List.Transform(List.Skip(Sorted, 1), (r) =>
                        Issue(r, ruleId, field, label & " as " & Fid & " (row " & Text.From(F[SourceRow]) & ")", null, Fid))))
        in
            Out,
    NormKey = (r as record) as text => fnNormalizeName(Get(r, NameField), IsPartner),
    BlockOf = (r as record) as text =>
        Text.Upper(fnTrim(if IsPartner then Get(r, "Country") else Get(r, "MaterialType"))),

    Dup001 = GroupDup("DUP-001", IdField, (r) => fnTrim(Get(r, IdField)), "Same record ID"),
    Dup002 = GroupDup("DUP-002", NameField, (r) =>
                 let n = NormKey(r) in
                 if n = "" then ""
                 else if IsPartner then n & "|" & BlockOf(r)
                 else n & "|" & BlockOf(r) & "|" & Text.Upper(fnTrim(Get(r, "BaseUoM"))),
             if IsPartner then "Same normalised name and country" else "Same normalised description, type and UoM"),
    Dup003 = if IsPartner then GroupDup("DUP-003", "TaxID", (r) =>
                 Text.Remove(Text.Upper(fnText(Get(r, "TaxID"))), {" ", "-", ".", "/"}), "Same tax ID") else {},
    Dup004 = if IsPartner then GroupDup("DUP-004", "Email", (r) => Text.Lower(fnTrim(Get(r, "Email"))), "Same email address") else {},
    Dup006 = if entity = "Vendor" then GroupDup("DUP-006", "BankIBAN", (r) =>
                 Text.Remove(Text.Upper(fnText(Get(r, "BankIBAN"))), " "), "Same bank account") else {},

    // ------------------------------------------------------------------ fuzzy duplicates
    Dup005 =
        if not Enabled("DUP-005") then {} else
        let
            Prep = List.Buffer(List.Transform(Rows, each [N = NormKey(_), B = BlockOf(_), R = _])),
            PerRow = List.Transform({0 .. List.Count(Prep) - 1}, (j) =>
                let
                    Pj = Prep{j},
                    Candidates = if Pj[N] = "" then {}
                                 else List.Select(List.FirstN(Prep, j), each [B] = Pj[B] and [N] <> "" and [N] <> Pj[N]),
                    Best = List.Accumulate(Candidates, null, (state, c) =>
                        let sc = fnDice(c[N], Pj[N]) in
                        if sc > (if state = null then 0 else state[S]) then [S = sc, C = c] else state),
                    Rid = if Best = null then "" else fnTrim(Get(Best[C][R], IdField))
                in
                    if Best <> null and Best[S] >= FuzzyThreshold
                    then {Issue(Pj[R], "DUP-005", NameField,
                                "Similar to " & Rid & " '" & fnTrim(Get(Best[C][R], NameField)) & "' (similarity " &
                                Number.ToText(Best[S], "F2", "en-US") & ")", null, Rid)}
                    else {})
        in
            List.Combine(PerRow),

    // ------------------------------------------------------------------ per-row checks
    RowIssues = (r as record) as list =>
        let
            Missing = List.Combine(List.Transform(RequiredForEntity, (f) =>
                let field = fnTrim(f[Field]), sev = fnTrim(f[Severity]) in
                if fnIsBlank(Get(r, field))
                then {Issue(r, "MIS-001", field, field & " is required but blank", if sev = "" then null else sev, null)}
                else {})),

            Nm = Get(r, NameField),
            NmText = fnText(Nm),
            NameProblems = List.RemoveNulls({
                if NmText <> Text.Trim(NmText) then "leading/trailing spaces" else null,
                if Text.Contains(NmText, "  ") then "repeated spaces" else null,
                if NmText = Text.Lower(NmText) and NmText <> Text.Upper(NmText) then "all lower-case" else null}),
            NameFmt = if not fnIsBlank(Nm) and List.Count(NameProblems) > 0
                      then {Issue(r, "INC-008", NameField, "Name has " & Text.Combine(NameProblems, ", "), null, null)} else {},

            Cur = Get(r, "Currency"),
            CurIssue = if not fnIsBlank(Cur) and not InList("Currency", Cur)
                       then {Issue(r, "INC-006", "Currency", "'" & fnTrim(Cur) & "' is not an approved currency code", null, null)} else {},
            St = Get(r, "Status"),
            StatusIssue = if not fnIsBlank(St) and not InList("Status", St)
                          then {Issue(r, "INC-010", "Status", "'" & fnTrim(St) & "' is not an approved status", null, null)} else {},
            Cd = Get(r, "CreatedDate"),
            CdText = if fnIsBlank(Cd) then null else fnToDate(Cd),
            DateIssue = if fnIsBlank(Cd) then {}
                        else if CdText = null then {Issue(r, "INC-009", "CreatedDate", "Not a valid date (expected yyyy-mm-dd)", null, null)}
                        else if CdText > RunDate then {Issue(r, "INC-009", "CreatedDate", "Date " & CdText & " is after the run date " & RunDate, null, null)}
                        else {},

            // ---- business partner checks
            CcRaw = fnTrim(Get(r, "Country")),
            C = CountryOf(CcRaw),
            Email = Get(r, "Email"),
            Phone = Get(r, "Phone"),
            PhoneProblem = if fnIsBlank(Phone) then null else fnPhoneProblem(fnText(Phone), if C = null then null else fnTrim(C[PhoneCode])),
            Tax = Get(r, "TaxID"),
            Postal = Get(r, "PostalCode"),
            Terms = Get(r, "PaymentTerms"),
            PartnerIssues = if not IsPartner then {} else
                (if CcRaw <> "" and C = null then {Issue(r, "INC-003", "Country", "'" & CcRaw & "' is not a valid ISO 3166 alpha-2 code", null, null)} else {}) &
                (if not fnIsBlank(Email) and not fnValidEmail(fnText(Email)) then {Issue(r, "INC-001", "Email", "Email address is not in a valid format", null, null)} else {}) &
                (if PhoneProblem <> null then {Issue(r, "INC-002", "Phone", "Phone " & PhoneProblem, null, null)} else {}) &
                (if C <> null and not fnIsBlank(Tax) and not fnMatchesPattern(fnText(Tax), fnText(C[TaxIDPattern]))
                    then {Issue(r, "INC-004", "TaxID", "Does not match " & CcRaw & " pattern " & fnText(C[TaxIDPattern]), null, null)} else {}) &
                (if C <> null and not fnIsBlank(Postal) and not fnIsBlank(C[PostalPattern]) and not fnMatchesPattern(fnText(Postal), fnText(C[PostalPattern]))
                    then {Issue(r, "INC-005", "PostalCode", "Does not match " & CcRaw & " pattern " & fnText(C[PostalPattern]), null, null)} else {}) &
                (if not fnIsBlank(Terms) and not InList("PaymentTerms", Terms)
                    then {Issue(r, "INC-007", "PaymentTerms", "'" & fnTrim(Terms) & "' is not an approved payment term", null, null)} else {}),

            // ---- customer / vendor specific
            Credit = Get(r, "CreditLimit"),
            CreditNum = fnToNumber(Credit),
            CustomerIssues = if entity <> "Customer" or fnIsBlank(Credit) then {}
                else if CreditNum = null then {Issue(r, "INC-015", "CreditLimit", "Credit limit is not a number", null, null)}
                else if CreditNum < 0 then {Issue(r, "INC-015", "CreditLimit", "Credit limit is negative", null, null)}
                else {},
            Iban = Get(r, "BankIBAN"),
            VendorIssues = if entity = "Vendor" and not fnIsBlank(Iban) and not fnValidIban(fnText(Iban), IbanLengths)
                then {Issue(r, "INC-016", "BankIBAN", "IBAN fails length or mod-97 checksum validation", null, null)} else {},

            // ---- material checks
            Mt = fnTrim(Get(r, "MaterialType")),
            Uom = Get(r, "BaseUoM"),
            Plant = Get(r, "Plant"),
            Vid = fnTrim(Get(r, "PreferredVendorID")),
            Price = Get(r, "StandardPrice"),
            PriceNum = fnToNumber(Price),
            Weight = Get(r, "GrossWeightKg"),
            WeightNum = fnToNumber(Weight),
            MaterialIssues = if entity <> "Material" then {} else
                (if not fnIsBlank(Uom) and not InList("UoM", Uom)
                    then {Issue(r, "INC-011", "BaseUoM", "'" & fnTrim(Uom) & "' is not an approved unit of measure", null, null)} else {}) &
                (if Mt <> "" and not InList("MaterialType", Mt)
                    then {Issue(r, "INC-012", "MaterialType", "'" & Mt & "' is not an approved material type", null, null)} else {}) &
                (if not fnIsBlank(Plant) and not InList("Plant", Plant)
                    then {Issue(r, "INC-017", "Plant", "'" & fnTrim(Plant) & "' is not an approved plant", null, null)} else {}) &
                (if Vid = "" and InList("PurchasedMaterialType", Mt)
                    then {Issue(r, "MIS-002", "PreferredVendorID", "Material type " & Mt & " is purchased and needs a preferred vendor", null, null)} else {}) &
                (if Vid = "" then {}
                 else if not Record.HasFields(VendorStatus, Vid)
                    then {Issue(r, "INC-013", "PreferredVendorID", "Vendor " & Vid & " does not exist in the vendor master", null, Vid)}
                 else if Record.Field(VendorStatus, Vid) = "Blocked"
                    then {Issue(r, "INC-014", "PreferredVendorID", "Vendor " & Vid & " is blocked", null, Vid)}
                 else {}) &
                (if fnIsBlank(Price) then {}
                 else if PriceNum = null then {Issue(r, "INC-015", "StandardPrice", "Standard price is not a number", null, null)}
                 else if PriceNum <= 0 then {Issue(r, "INC-015", "StandardPrice", "Standard price must be greater than zero", null, null)}
                 else {}) &
                (if fnIsBlank(Weight) then {}
                 else if WeightNum = null then {Issue(r, "INC-015", "GrossWeightKg", "Gross weight is not a number", null, null)}
                 else if WeightNum < 0 then {Issue(r, "INC-015", "GrossWeightKg", "Gross weight is negative", null, null)}
                 else {})
        in
            Missing & NameFmt & CurIssue & StatusIssue & DateIssue & PartnerIssues & CustomerIssues & VendorIssues & MaterialIssues,

    PerRow = List.Combine(List.Transform(Rows, RowIssues)),

    // ------------------------------------------------------------------ assemble
    AllIssues = List.Select(Dup001 & Dup002 & Dup003 & Dup004 & Dup005 & Dup006 & PerRow, each Enabled([RuleID])),
    RankMap = [Critical = 4, High = 3, Medium = 2, Low = 1],
    RunDateText = RunDate,
    Final = List.Transform(AllIssues, (i) =>
        let
            Rule = Record.Field(RulesDict, i[RuleID]),
            SevText = if i[SeverityOverride] <> null then i[SeverityOverride] else fnTrim(Rule[Severity]),
            RegionText = RegionOf(i[Row]),
            Owner = OwnerOf(RegionText)
        in
            [ExceptionID = Meta[Prefix] & "-" & Text.PadStart(Text.From(i[SourceRow]), 4, "0") & "-" & i[RuleID] & "-" & i[Field],
             RunDate = RunDateText,
             Entity = entity,
             SourceRow = i[SourceRow],
             RecordID = fnTrim(Get(i[Row], IdField)),
             RecordName = fnTrim(Get(i[Row], NameField)),
             Region = RegionText,
             RuleID = i[RuleID],
             Category = fnTrim(Rule[Category]),
             RuleName = fnTrim(Rule[RuleName]),
             Field = i[Field],
             Value = i[Value],
             Details = i[Details],
             Severity = SevText,
             SeverityRank = Record.FieldOrDefault(RankMap, SevText, 0),
             RelatedRecordID = i[RelatedRecordID],
             OwnerName = if Owner = null then "" else fnTrim(Owner[OwnerName]),
             OwnerEmail = if Owner = null then "" else fnTrim(Owner[OwnerEmail]),
             Status = "Open"]),
    Columns = {"ExceptionID", "RunDate", "Entity", "SourceRow", "RecordID", "RecordName", "Region", "RuleID",
               "Category", "RuleName", "Field", "Value", "Details", "Severity", "SeverityRank", "RelatedRecordID",
               "OwnerName", "OwnerEmail", "Status"}
in
    Table.FromRecords(Final, Columns);

shared Exceptions = // MAIN OUTPUT - loaded to the "Exceptions" sheet (table tblExceptions).
// One row per data-quality exception across customer, vendor and material master data.
let
    Combined = Table.Combine({fnEntityChecks("Customer"), fnEntityChecks("Vendor"), fnEntityChecks("Material")}),
    WithOrder = Table.AddColumn(Combined, "__EntityOrder",
        each if [Entity] = "Customer" then 1 else if [Entity] = "Vendor" then 2 else 3, Int64.Type),
    Sorted = Table.Sort(WithOrder, {{"SeverityRank", Order.Descending}, {"__EntityOrder", Order.Ascending},
        {"SourceRow", Order.Ascending}, {"RuleID", Order.Ascending}, {"Field", Order.Ascending}}),
    Cleaned = Table.RemoveColumns(Sorted, {"__EntityOrder"}),
    Typed = Table.TransformColumnTypes(Cleaned, {
        {"ExceptionID", type text}, {"RunDate", type text}, {"Entity", type text}, {"SourceRow", Int64.Type},
        {"RecordID", type text}, {"RecordName", type text}, {"Region", type text}, {"RuleID", type text},
        {"Category", type text}, {"RuleName", type text}, {"Field", type text}, {"Value", type text},
        {"Details", type text}, {"Severity", type text}, {"SeverityRank", Int64.Type},
        {"RelatedRecordID", type text}, {"OwnerName", type text}, {"OwnerEmail", type text}, {"Status", type text}})
in
    Typed;
