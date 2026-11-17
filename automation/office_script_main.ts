
// ============================================================================
// Office Script entry point - called by the Power Automate flow ("Run script").
// ============================================================================
interface DQScriptResult {
  runDate: string; reportName: string; records: number; recordsWithExceptions: number; cleanRate: number;
  exceptions: number; critical: number; high: number; medium: number; low: number;
  ownerCount: number; owners: DQOwnerPacket[]; csv: string; reportHtml: string; summaryHtml: string;
}

function dqReadTable(workbook: ExcelScript.Workbook, name: string): DQRow[] {
  const table = workbook.getTable(name);
  if (!table) throw new Error("Table " + name + " was not found in the workbook.");
  const headers = table.getHeaderRowRange().getValues()[0].map(h => String(h));
  const body = table.getRangeBetweenHeaderAndTotal().getValues();
  return body.map(row => {
    const rec: DQRow = {};
    headers.forEach((h, i) => { rec[h] = row[i] as Cell; });
    return rec;
  });
}

/**
 * @param runDate yyyy-MM-dd supplied by the flow (in the business time zone). Blank = Settings / today (UTC).
 */
function main(workbook: ExcelScript.Workbook, runDate?: string): DQScriptResult {
  const settings = dqReadTable(workbook, "tblSettings");
  let date = runDate && dqDate(runDate) ? (dqDate(runDate) as string) : "";
  if (!date) {
    const hit = settings.filter(s => dqTrim(s.Setting) === "RunDateOverride");
    const override: Cell = hit.length ? hit[0].Value : "";
    date = dqIsBlank(override) ? new Date().toISOString().substr(0, 10) : (dqDate(override) || new Date().toISOString().substr(0, 10));
  }

  const input: DQInput = {
    customers: dqReadTable(workbook, "tblCustomers"),
    vendors: dqReadTable(workbook, "tblVendors"),
    materials: dqReadTable(workbook, "tblMaterials"),
    countries: dqReadTable(workbook, "tblCountries"),
    lists: dqReadTable(workbook, "tblLists"),
    rules: dqReadTable(workbook, "tblRules") as unknown as DQRule[],
    requiredFields: dqReadTable(workbook, "tblRequiredFields"),
    owners: dqReadTable(workbook, "tblOwners"),
  };
  const result = runQualityChecks(input, date);
  const placeholder = "{{REPORT_URL}}";
  const owners = dqOwnerPackets(result, placeholder);
  const reportName = "DQ_Exception_Report_" + date;

  // Append to the run log on the "Automated Run" sheet
  const log = workbook.getTable("tblRunLog");
  if (log) {
    const t = result.totals;
    log.addRow(-1, [date, new Date().toISOString(), t.records, t.recordsWithExceptions, t.cleanRate, t.exceptions,
      t.critical, t.high, t.medium, t.low, owners.length, reportName + ".csv"]);
  }

  const t = result.totals;
  console.log("Run " + date + ": " + t.exceptions + " exceptions in " + t.records + " records, " + owners.length + " owners.");
  return {
    runDate: date, reportName, records: t.records, recordsWithExceptions: t.recordsWithExceptions, cleanRate: t.cleanRate,
    exceptions: t.exceptions, critical: t.critical, high: t.high, medium: t.medium, low: t.low,
    ownerCount: owners.length, owners, csv: dqToCsv(result.exceptions), reportHtml: dqReportHtml(result),
    summaryHtml: dqSummaryEmailHtml(result, owners, placeholder),
  };
}
