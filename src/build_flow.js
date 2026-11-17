// Generates the Power Automate cloud flow:
//   automation/flow/definition.json            - the workflow definition (readable / for review)
//   automation/MasterDataQuality_WeeklyFlow.zip - import package (Power Automate > My flows > Import > Import Package (Legacy))
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const JSZip = require('jszip');
const root = path.join(__dirname, '..');
const uuid = () => crypto.randomUUID();

const API = id => `/providers/Microsoft.PowerApps/apis/${id}`;
const host = (conn, op) => ({ connectionName: conn, operationId: op, apiId: API(conn) });
const S = "outputs('Settings')";
const R = "outputs('Run_quality_checks')?['body/result']";

const settings = {
  SiteUrl: 'https://contoso.sharepoint.com/sites/DataGovernance',
  ReportFolder: '/Shared Documents/Data Quality/Exception Reports',
  GovernanceEmail: 'data.governance@contoso.com',
  TimeZone: 'Eastern Standard Time',
  SendOwnerEmails: true,
};

const tryActions = {
  Run_quality_checks: {
    runAfter: {}, type: 'OpenApiConnection',
    description: 'Runs the RunQualityChecks Office Script in the workbook (same rules as Power Query) and returns the report, CSV and one email packet per data owner. Re-select Location / Document Library / File / Script after import.',
    inputs: {
      host: host('shared_excelonlinebusiness', 'RunScriptProd'),
      parameters: {
        source: 'sites/contoso.sharepoint.com,00000000-0000-0000-0000-000000000000,00000000-0000-0000-0000-000000000000',
        drive: 'b!REPLACE_WITH_DOCUMENT_LIBRARY',
        file: 'REPLACE_WITH_MasterDataQuality.xlsx',
        scriptId: 'REPLACE_WITH_RunQualityChecks',
        'ScriptParameters/runDate': `@{formatDateTime(convertFromUtc(utcNow(), ${S}?['TimeZone']), 'yyyy-MM-dd')}`,
      },
      authentication: "@parameters('$authentication')",
    },
  },
  Save_CSV_report_to_SharePoint: {
    runAfter: { Run_quality_checks: ['Succeeded'] }, type: 'OpenApiConnection',
    description: 'Weekly exception report (CSV, opens in Excel).',
    inputs: {
      host: host('shared_sharepointonline', 'CreateFile'),
      parameters: {
        dataset: `@${S}?['SiteUrl']`, folderPath: `@${S}?['ReportFolder']`,
        name: `@{${R}?['reportName']}.csv`, body: `@${R}?['csv']`,
      },
      authentication: "@parameters('$authentication')",
    },
    runtimeConfiguration: { contentTransfer: { transferMode: 'Chunked' } },
  },
  Save_HTML_report_to_SharePoint: {
    runAfter: { Run_quality_checks: ['Succeeded'] }, type: 'OpenApiConnection',
    description: 'Styled, filterable HTML version of the report (linked from the emails).',
    inputs: {
      host: host('shared_sharepointonline', 'CreateFile'),
      parameters: {
        dataset: `@${S}?['SiteUrl']`, folderPath: `@${S}?['ReportFolder']`,
        name: `@{${R}?['reportName']}.html`, body: `@${R}?['reportHtml']`,
      },
      authentication: "@parameters('$authentication')",
    },
  },
  Report_link: {
    runAfter: { Save_HTML_report_to_SharePoint: ['Succeeded'], Save_CSV_report_to_SharePoint: ['Succeeded'] }, type: 'Compose',
    inputs: `@{${S}?['SiteUrl']}@{replace(outputs('Save_HTML_report_to_SharePoint')?['body/Path'], ' ', '%20')}`,
  },
  Notify_owners_if_any_exceptions: {
    runAfter: { Report_link: ['Succeeded'] }, type: 'If',
    expression: { and: [{ greater: [`@${R}?['exceptions']`, 0] }, { equals: [`@${S}?['SendOwnerEmails']`, true] }] },
    actions: {
      For_each_data_owner: {
        runAfter: {}, type: 'Foreach', foreach: `@${R}?['owners']`,
        runtimeConfiguration: { concurrency: { repetitions: 5 } },
        actions: {
          Email_data_owner: {
            runAfter: {}, type: 'OpenApiConnection',
            inputs: {
              host: host('shared_office365', 'SendEmailV2'),
              parameters: {
                'emailMessage/To': "@items('For_each_data_owner')?['OwnerEmail']",
                'emailMessage/Subject': `Action needed: @{items('For_each_data_owner')?['Count']} master data exceptions (@{items('For_each_data_owner')?['Critical']} critical) - week of @{${R}?['runDate']}`,
                'emailMessage/Body': `@{replace(items('For_each_data_owner')?['Html'], '{{REPORT_URL}}', outputs('Report_link'))}`,
                'emailMessage/Importance': "@{if(greater(add(items('For_each_data_owner')?['Critical'], items('For_each_data_owner')?['High']), 0), 'High', 'Normal')}",
              },
              authentication: "@parameters('$authentication')",
            },
          },
        },
      },
    },
    else: { actions: {} },
  },
  Email_governance_summary: {
    runAfter: { Notify_owners_if_any_exceptions: ['Succeeded'] }, type: 'OpenApiConnection',
    inputs: {
      host: host('shared_office365', 'SendEmailV2'),
      parameters: {
        'emailMessage/To': `@${S}?['GovernanceEmail']`,
        'emailMessage/Subject': `Master data quality: @{${R}?['exceptions']} exceptions, @{formatNumber(mul(${R}?['cleanRate'], 100), '0.0')}% clean - @{${R}?['runDate']}`,
        'emailMessage/Body': `@{replace(${R}?['summaryHtml'], '{{REPORT_URL}}', outputs('Report_link'))}`,
        'emailMessage/Attachments': [{ Name: `@{${R}?['reportName']}.csv`, ContentBytes: `@{base64(${R}?['csv'])}` }],
        'emailMessage/Importance': `@{if(greater(${R}?['critical'], 0), 'High', 'Normal')}`,
      },
      authentication: "@parameters('$authentication')",
    },
  },
};

const definition = {
  $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
  contentVersion: '1.0.0.0',
  parameters: {
    $connections: { defaultValue: {}, type: 'Object' },
    $authentication: { defaultValue: {}, type: 'SecureObject' },
  },
  triggers: {
    Every_Monday_7am: {
      recurrence: { frequency: 'Week', interval: 1, timeZone: settings.TimeZone, schedule: { weekDays: ['Monday'], hours: ['7'], minutes: [0] } },
      type: 'Recurrence',
    },
  },
  actions: {
    Settings: {
      runAfter: {}, type: 'Compose', inputs: settings,
      description: 'EDIT ME: SharePoint site, report folder, governance mailbox, time zone. Everything else reads from here.',
    },
    Try: { runAfter: { Settings: ['Succeeded'] }, type: 'Scope', actions: tryActions },
    Catch_alert_on_failure: {
      runAfter: { Try: ['Failed', 'TimedOut'] }, type: 'OpenApiConnection',
      inputs: {
        host: host('shared_office365', 'SendEmailV2'),
        parameters: {
          'emailMessage/To': `@${S}?['GovernanceEmail']`,
          'emailMessage/Subject': 'FAILED: weekly master data quality flow',
          'emailMessage/Body': "<p>The weekly master data quality run failed.</p><p><a href=\"https://make.powerautomate.com/environments/@{workflow()?['tags']?['environmentName']}/flows/@{workflow()?['name']}/runs/@{workflow()?['run']?['name']}\">Open the failed run</a></p><pre>@{string(result('Try'))}</pre>",
          'emailMessage/Importance': 'High',
        },
        authentication: "@parameters('$authentication')",
      },
    },
  },
  outputs: {},
};

const flowName = 'Weekly Master Data Quality Exception Report';
const apis = {
  shared_excelonlinebusiness: 'Excel Online (Business)',
  shared_sharepointonline: 'SharePoint',
  shared_office365: 'Office 365 Outlook',
};

(async () => {
  fs.mkdirSync(path.join(root, 'automation/flow'), { recursive: true });
  fs.writeFileSync(path.join(root, 'automation/flow/definition.json'), JSON.stringify(definition, null, 2));

  const flowId = uuid(), flowRes = uuid();
  const apiIds = {}, connIds = {};
  Object.keys(apis).forEach(a => { apiIds[a] = uuid(); connIds[a] = uuid(); });
  const resources = {
    [flowRes]: {
      type: 'Microsoft.Flow/flows', suggestedCreationType: 'New', creationType: 'Existing, New, Update',
      details: { displayName: flowName }, configurableBy: 'User', hierarchy: 'Root',
      dependsOn: Object.keys(apis).flatMap(a => [apiIds[a], connIds[a]]),
    },
  };
  for (const [a, label] of Object.entries(apis)) {
    resources[apiIds[a]] = { id: API(a), name: a, type: 'Microsoft.PowerApps/apis', suggestedCreationType: 'Existing',
      details: { displayName: label, iconUri: '' }, configurableBy: 'System', hierarchy: 'Child', dependsOn: [] };
    resources[connIds[a]] = { type: 'Microsoft.PowerApps/apis/connections', suggestedCreationType: 'Existing', creationType: 'Existing',
      details: { displayName: label, iconUri: '' }, configurableBy: 'User', hierarchy: 'Child', dependsOn: [apiIds[a]] };
  }
  const manifest = {
    schema: '1.0',
    details: { displayName: flowName, description: 'Runs the master data quality checks every Monday, saves the exception report to SharePoint and emails each data owner.',
      createdTime: new Date().toISOString(), packageTelemetryId: uuid(), creator: 'Master Data Quality Check', sourceEnvironment: '' },
    resources,
  };
  const flowDef = {
    name: flowId, id: `/providers/Microsoft.Flow/flows/${flowId}`, type: 'Microsoft.Flow/flows',
    properties: {
      apiId: '/providers/Microsoft.PowerApps/apis/shared_logicflows', displayName: flowName, definition,
      connectionReferences: Object.fromEntries(Object.keys(apis).map(a => [a, { connectionName: a, source: 'Embedded', id: API(a), tier: 'NotSpecified' }])),
      flowFailureAlertSubscribed: false,
    },
  };
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('Microsoft.Flow/flows/manifest.json', JSON.stringify({ packageSchemaVersion: '1.0', flowAssets: { assetPaths: [flowId] } }));
  zip.file(`Microsoft.Flow/flows/${flowId}/definition.json`, JSON.stringify(flowDef));
  zip.file(`Microsoft.Flow/flows/${flowId}/apisMap.json`, JSON.stringify(Object.fromEntries(Object.keys(apis).map(a => [a, apiIds[a]]))));
  zip.file(`Microsoft.Flow/flows/${flowId}/connectionsMap.json`, JSON.stringify(Object.fromEntries(Object.keys(apis).map(a => [a, connIds[a]]))));
  fs.writeFileSync(path.join(root, 'automation/MasterDataQuality_WeeklyFlow.zip'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log('flow written');
})();
