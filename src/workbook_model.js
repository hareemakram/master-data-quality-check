// Single source of truth for how the JSON data is laid out as Excel tables
// (used by the M interpreter test and mirrored by build_workbook.py).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const md = JSON.parse(fs.readFileSync(path.join(root, 'data/master_data.json')));
const ref = JSON.parse(fs.readFileSync(path.join(root, 'data/reference.json')));
const COLS = {
  tblCustomers: ['CustomerID', 'CustomerName', 'Country', 'City', 'PostalCode', 'Email', 'Phone', 'TaxID', 'Currency', 'PaymentTerms', 'CreditLimit', 'CreatedDate', 'Status'],
  tblVendors: ['VendorID', 'VendorName', 'Country', 'City', 'PostalCode', 'Email', 'Phone', 'TaxID', 'Currency', 'PaymentTerms', 'BankIBAN', 'CreatedDate', 'Status'],
  tblMaterials: ['MaterialID', 'Description', 'MaterialType', 'BaseUoM', 'MaterialGroup', 'PreferredVendorID', 'Plant', 'StandardPrice', 'Currency', 'GrossWeightKg', 'CreatedDate', 'Status'],
  tblCountries: ['CountryCode', 'CountryName', 'Region', 'DefaultCurrency', 'PhoneCode', 'PostalPattern', 'TaxIDPattern', 'IBANLength'],
  tblLists: ['ListName', 'Value'],
  tblRules: ['RuleID', 'Category', 'RuleName', 'AppliesTo', 'Severity', 'Enabled', 'Threshold', 'Description'],
  tblRequiredFields: ['Entity', 'Field', 'Severity'],
  tblOwners: ['Entity', 'Region', 'OwnerName', 'OwnerEmail'],
  tblSettings: ['Setting', 'Value', 'Notes'],
};
const ROWS = {
  tblCustomers: md.Customers, tblVendors: md.Vendors, tblMaterials: md.Materials,
  tblCountries: ref.Countries, tblLists: ref.Lists,
  tblRules: ref.Rules.map(r => ({ ...r, Enabled: r.Enabled ? 'Yes' : 'No' })),
  tblRequiredFields: ref.RequiredFields, tblOwners: ref.Owners, tblSettings: ref.Settings,
};
// Excel cell typing: '' -> blank, ISO date in a *Date column -> real date, everything else as-is
function cellValue(col, v) {
  if (v === '' || v === undefined) return null;
  if (col === 'CreatedDate' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return { date: v };
  return v;
}
module.exports = { COLS, ROWS, cellValue };
