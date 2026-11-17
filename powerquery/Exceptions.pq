// MAIN OUTPUT - loaded to the "Exceptions" sheet (table tblExceptions).
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
    Typed
