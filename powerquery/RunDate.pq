// Run date as yyyy-MM-dd text. Uses Settings[RunDateOverride] when filled in, otherwise today.
let
    Override = try Cfg_Settings{[Setting = "RunDateOverride"]}[Value] otherwise null,
    Parsed = if fnIsBlank(Override) then null else fnToDate(Override),
    Result = if Parsed <> null then Parsed
             else Date.ToText(Date.From(DateTime.LocalNow()), [Format = "yyyy-MM-dd", Culture = "en-US"])
in
    Result
