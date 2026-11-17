// Runs the generated Office Script's main() against a mock ExcelScript workbook that behaves like
// Excel for the web (dates as serial numbers, blanks as "", header row + body ranges, addRow).
const fs = require('fs'), path = require('path'), assert = require('assert'), esbuild = require('esbuild');
const { COLS, ROWS, cellValue } = require('../src/workbook_model');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'automation/RunQualityChecks.ts'), 'utf8') + '\nmodule.exports = { main };';
const js = esbuild.transformSync(src, { loader: 'ts', format: 'cjs' }).code;
const m = { exports: {} }; new Function('module', 'exports', 'console', js)(m, m.exports, { log: s => console.log('  [script log]', s) });
const serial = iso => { const [y, mo, d] = iso.split('-').map(Number); return (Date.UTC(y, mo - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };
const tables = {};
for (const name of Object.keys(COLS)) {
  const body = ROWS[name].map(r => COLS[name].map(c => { const v = cellValue(c, r[c]); return v === null || v === undefined ? '' : v.date ? serial(v.date) : v; }));
  tables[name] = { header: [COLS[name]], body };
}
tables.tblRunLog = { header: [['RunDate', 'RunTimestampUTC', 'Records', 'RecordsWithExceptions', 'CleanRate', 'Exceptions', 'Critical', 'High', 'Medium', 'Low', 'OwnersNotified', 'ReportFile']], body: [] };
const wb = { getTable: n => tables[n] && {
  getHeaderRowRange: () => ({ getValues: () => tables[n].header }),
  getRangeBetweenHeaderAndTotal: () => ({ getValues: () => tables[n].body }),
  addRow: (i, v) => tables[n].body.push(v) } };
const out = m.exports.main(wb, '2026-11-17');
const truth = JSON.parse(fs.readFileSync(path.join(root, 'data/expected_exceptions.json')));
const mrows = JSON.parse(fs.readFileSync(path.join(root, 'build/m_result.json')));
let fails = 0; const t = (n, f) => { try { f(); console.log('PASS', n); } catch (e) { fails++; console.log('FAIL', n, '-', e.message.slice(0, 600)); } };
t('script finds every planted defect and nothing else', () => assert.strictEqual(out.exceptions, truth.Expected.length));
t('script CSV identical to Power Query output (every column)', () => {
  const lines = out.csv.split('\r\n'); assert.strictEqual(lines.length, mrows.length + 1);
  const cols = lines[0].split(',');
  const parse = l => { const r = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const c = l[i];
    if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { r.push(cur); cur = ''; } else cur += c; } r.push(cur); return r; };
  lines.slice(1).forEach((l, i) => { const v = parse(l); cols.forEach((c, j) => assert.strictEqual(v[j], String(mrows[i][c]), `row ${i} ${c}`)); });
});
t('one email packet per owner with placeholder link', () => { assert.strictEqual(out.ownerCount, 10); assert.ok(out.owners.every(o => o.Html.includes('{{REPORT_URL}}'))); });
t('run log row appended', () => { assert.strictEqual(tables.tblRunLog.body.length, 1); assert.strictEqual(tables.tblRunLog.body[0][5], 168); });
t('report html + summary html produced', () => { assert.ok(out.reportHtml.startsWith('<!doctype html>') && out.reportHtml.includes('DUP-006')); assert.ok(out.summaryHtml.includes('Exceptions by data owner')); });
t('blank runDate falls back to Settings / today', () => { const o2 = m.exports.main(wb, ''); assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(o2.runDate)); });
fs.writeFileSync(path.join(root, 'build/script_output.json'), JSON.stringify(out, null, 1));
console.log(fails ? `${fails} FAILED` : 'Office Script OK'); process.exit(fails ? 1 : 0);
