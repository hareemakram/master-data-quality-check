# Setup guide: SharePoint, Office Script and Power Automate

This takes about 20 minutes. You need a Microsoft 365 work account with Excel for the web, SharePoint and Power Automate (the standard connectors Excel Online (Business), SharePoint and Office 365 Outlook are all included in Microsoft 365 licences).

## 1. Put the workbook in SharePoint

1. Create (or pick) a SharePoint site, for example `https://<tenant>.sharepoint.com/sites/DataGovernance`.
2. In its **Documents** library create two folders:
   - `Data Quality` - upload `MasterDataQuality.xlsx` here.
   - `Data Quality/Exception Reports` - the flow saves the weekly reports here.
3. Open the workbook in Excel desktop once, go to **Data > Refresh All**, and save. This confirms Power Query works with your data. If Excel asks about privacy levels, choose **Ignore privacy levels** for this file (all queries read tables inside the same workbook).

## 2. Replace the sample data with yours

Keep the table and column names. Paste your data into `tblCustomers`, `tblVendors` and `tblMaterials` (the table grows automatically), or change the `Src_*` queries to read from your system, for example:

```m
// Src_Vendors reading an ERP extract from SharePoint
let
    Files = SharePoint.Files("https://<tenant>.sharepoint.com/sites/DataGovernance", [ApiVersion = 15]),
    File = Files{[Name = "vendor_master.csv", #"Folder Path" = "https://<tenant>.sharepoint.com/sites/DataGovernance/Shared Documents/Extracts/"]}[Content],
    Source = Table.PromoteHeaders(Csv.Document(File, [Delimiter = ",", Encoding = 65001])),
    Indexed = Table.AddIndexColumn(Source, "SourceRow", 1, 1, Int64.Type)
in
    Indexed
```

If you switch a source away from the workbook tables, the weekly Office Script still reads the workbook tables. In that case schedule a refresh (Excel desktop, or Power BI dataflow) before Monday 07:00, or keep the tables as the hand-off point.

Then review the configuration sheets: **Rules**, **Required Fields**, **Owners** (put your real data owners and the governance mailbox here), **Countries**, **Lists** and **Settings**.

## 3. Add the Office Script

Power Automate cannot refresh Power Query in Excel for the web, so the flow runs an Office Script that applies the same 25 rules (one rules engine, tested to give identical output to the Power Query version).

1. Open `MasterDataQuality.xlsx` in **Excel for the web** from SharePoint.
2. **Automate > New Script**. Delete the sample code.
3. Paste the whole of `automation/RunQualityChecks.ts` and click **Save script**. Name it `RunQualityChecks`.
4. Click **Run** once. The **Automated Run** sheet gets a new row and the output pane shows `Run <date>: 168 exceptions in 498 records, 10 owners.` (numbers change with your data).

## 4. Import the flow

1. Go to <https://make.powerautomate.com> > **My flows > Import > Import Package (Legacy)**.
2. Upload `automation/MasterDataQuality_WeeklyFlow.zip`.
3. For each of the three connections (Excel Online (Business), SharePoint, Office 365 Outlook) click **Select during import** and pick or create your connection. Click **Import**.
4. Open the flow and **Edit**:
   - **Settings** (first action): set `SiteUrl`, `ReportFolder`, `GovernanceEmail`, `TimeZone` (a Windows time-zone name such as `GMT Standard Time` or `Arabian Standard Time`). `SendOwnerEmails` can be set to `false` for a dry run.
   - **Try > Run quality checks**: re-select **Location** (your SharePoint site), **Document Library** (Documents), **File** (`/Data Quality/MasterDataQuality.xlsx`) and **Script** (`RunQualityChecks`). The `runDate` parameter is already filled in.
   - **Every Monday 7am** trigger: change the day, time or time zone if needed.
5. **Save**, then **Test > Manually** to run it once.

If the legacy import is not available in your tenant, build it by hand in 10 minutes using section 6.

## 5. What a run does

| Step | Result |
|---|---|
| Recurrence (Monday 07:00) | Starts the run |
| Settings | Reads site, folder, governance mailbox, time zone |
| Run quality checks | Office Script checks all records, appends a row to **Automated Run**, returns the report, CSV and one email packet per data owner |
| Save CSV / HTML report | `DQ_Exception_Report_<yyyy-MM-dd>.csv` and `.html` in the report folder |
| For each data owner | Email with only that owner's exceptions, severity tiles and a button to the HTML report. Importance is High when they have Critical or High items |
| Governance summary | KPIs, health by entity, exceptions by owner, CSV attached |
| Catch | If anything in Try fails or times out, the governance mailbox gets a failure alert with a link to the failed run |

## 6. Building the flow by hand (fallback)

1. **Scheduled cloud flow**, recurrence every 1 week, Monday, 07:00, your time zone.
2. **Compose** named `Settings` with the JSON object from `automation/flow/definition.json` (`actions.Settings.inputs`).
3. **Scope** named `Try`. Inside it:
   1. **Excel Online (Business) > Run script** named `Run quality checks`, with `runDate` = `formatDateTime(convertFromUtc(utcNow(), outputs('Settings')?['TimeZone']), 'yyyy-MM-dd')`.
   2. **SharePoint > Create file** named `Save CSV report to SharePoint`: Site `outputs('Settings')?['SiteUrl']`, Folder `outputs('Settings')?['ReportFolder']`, File name `concat(outputs('Run_quality_checks')?['body/result']?['reportName'], '.csv')`, content `outputs('Run_quality_checks')?['body/result']?['csv']`.
   3. Same for `.html` with `...['reportHtml']`, named `Save HTML report to SharePoint`.
   4. **Compose** `Report link`: `concat(outputs('Settings')?['SiteUrl'], replace(outputs('Save_HTML_report_to_SharePoint')?['body/Path'], ' ', '%20'))`.
   5. **Condition** exceptions > 0 and `SendOwnerEmails` is true. In **Yes**: **Apply to each** over `outputs('Run_quality_checks')?['body/result']?['owners']` with **Send an email (V2)**: To `items('For_each_data_owner')?['OwnerEmail']`, Body `replace(items('For_each_data_owner')?['Html'], '{{REPORT_URL}}', outputs('Report_link'))`.
   6. **Send an email (V2)** to `GovernanceEmail` with Body `replace(...['summaryHtml'], '{{REPORT_URL}}', outputs('Report_link'))` and attachment `base64(...['csv'])`.
4. **Send an email (V2)** after `Try` with **Configure run after > has failed, has timed out** for the failure alert.

Every expression above is copied from `automation/flow/definition.json`, which is the source of truth.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `Formula.Firewall` / privacy prompt on refresh | File > Options > Privacy > Ignore privacy levels for this workbook |
| Run script: `Table tblX was not found` | A table was renamed. Table names must match those listed in README |
| Owner never receives email | Check the Owners sheet: Entity + Region must match, otherwise the `* / *` owner gets it |
| Too many fuzzy duplicates | Raise `Threshold` on DUP-005 in the Rules sheet (0.85 by default; 0.90 is stricter) |
| Need to re-run a past week | Settings > RunDateOverride = `yyyy-mm-dd`, then Refresh All (clear it afterwards) |
| Flow times out on very large masters | Office Scripts run up to about 5 minutes. Split masters across workbooks or move the check to Power Query refresh on desktop |
