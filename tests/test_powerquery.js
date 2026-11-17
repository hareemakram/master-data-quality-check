// Executes the real Section1.m (the exact text embedded in the workbook) with the test M
// interpreter against the workbook tables, then compares every column of every exception row
// with the TypeScript engine and with the planted-defect ground truth.
const fs = require('fs'), path = require('path'), assert = require('assert');
const M = require('./m_interpreter');
const DQ = require('../build/engine.cjs');
const { COLS, ROWS, cellValue } = require('../src/workbook_model');
const root = path.join(__dirname, '..');

function excelTable(name) {
  const cols = COLS[name];
  return new M.MTable(cols, ROWS[name].map(r => cols.map(c => {
    const v = cellValue(c, r[c]);
    if (v && v.date) { const [y, m, d] = v.date.split('-').map(Number); return new M.MDateTime(y, m, d); }
    return v === undefined ? null : v;
  })));
}
(async () => {
  const names = Object.keys(COLS);
  const workbook = new M.MTable(['Name', 'Content'], names.map(n => [n, excelTable(n)]));
  const section = fs.readFileSync(path.join(root, 'build/Section1.m'), 'utf8');
  const get = await M.evaluateSection(section, { workbook, now: new M.MDateTime(2026, 11, 17) });
  const t0 = Date.now();
  let table;
  try { table = get('Exceptions'); }
  catch (e) { console.log('M EVALUATION ERROR:', e.message); process.exit(1); }
  const mRows = table.rows.map(r => Object.fromEntries(table.columns.map((c, i) => [c, r[i]])));
  console.log(`M evaluated in ${Date.now() - t0} ms -> ${mRows.length} exception rows, columns: ${table.columns.length}`);

  // TypeScript engine on identical inputs
  const toJs = n => ROWS[n].map(r => Object.fromEntries(COLS[n].map(c => { const v = cellValue(c, r[c]); return [c, v && v.date ? v.date : v === undefined ? null : v]; })));
  const res = DQ.runQualityChecks({ customers: toJs('tblCustomers'), vendors: toJs('tblVendors'), materials: toJs('tblMaterials'),
    countries: toJs('tblCountries'), lists: toJs('tblLists'), rules: toJs('tblRules'), requiredFields: toJs('tblRequiredFields'),
    owners: toJs('tblOwners') }, '2026-11-17');

  let failures = 0;
  const check = (name, fn) => { try { fn(); console.log('PASS', name); } catch (e) { failures++; console.log('FAIL', name, '-', e.message.slice(0, 2000)); } };
  check('M output columns match report schema', () => assert.deepStrictEqual(table.columns, DQ.DQ_REPORT_COLUMNS));
  check('M row count equals TypeScript engine', () => assert.strictEqual(mRows.length, res.exceptions.length));
  check('M rows identical to TypeScript engine (all 19 columns, same order)', () => {
    const diffs = [];
    res.exceptions.forEach((e, i) => { const m = mRows[i] || {}; DQ.DQ_REPORT_COLUMNS.forEach(c => { if (m[c] !== e[c]) diffs.push(`row ${i} ${c}: M=${JSON.stringify(m[c])} TS=${JSON.stringify(e[c])}`); }); });
    assert.deepStrictEqual(diffs.slice(0, 15), []);
  });
  const truth = JSON.parse(fs.readFileSync(path.join(root, 'data/expected_exceptions.json')));
  const key = e => `${e.Entity}|${e.SourceRow ?? e.Row}|${e.RuleID}|${e.Field}`;
  check('M finds exactly the planted defects', () => assert.deepStrictEqual(new Set(mRows.map(key)), new Set(truth.Expected.map(key))));

  // configuration-driven behaviour through M as well
  const rules2 = ROWS.tblRules.map(r => r.RuleID === 'DUP-005' ? { ...r, Enabled: 'No' } : r.RuleID === 'INC-002' ? { ...r, Severity: 'High' } : r);
  const wb2 = new M.MTable(['Name', 'Content'], names.map(n => [n, n === 'tblRules' ? new M.MTable(COLS.tblRules, rules2.map(r => COLS.tblRules.map(c => r[c] === undefined ? null : r[c]))) : excelTable(n)]));
  const get2 = await M.evaluateSection(section, { workbook: wb2, now: new M.MDateTime(2026, 11, 17) });
  const t2 = get2('Exceptions'); const ri = t2.columns.indexOf('RuleID'), si = t2.columns.indexOf('Severity');
  check('M: disabling DUP-005 in tblRules removes those rows', () => assert.strictEqual(t2.rows.filter(r => r[ri] === 'DUP-005').length, 0));
  check('M: changing INC-002 severity in tblRules is applied', () => assert.ok(t2.rows.filter(r => r[ri] === 'INC-002').every(r => r[si] === 'High')));
  const settings3 = ROWS.tblSettings.map(s => s.Setting === 'RunDateOverride' ? { ...s, Value: '2015-06-01' } : s);
  const wb3 = new M.MTable(['Name', 'Content'], names.map(n => [n, n === 'tblSettings' ? new M.MTable(COLS.tblSettings, settings3.map(r => COLS.tblSettings.map(c => r[c] === '' ? null : r[c]))) : excelTable(n)]));
  const t3 = (await M.evaluateSection(section, { workbook: wb3, now: new M.MDateTime(2026, 11, 17) }))('Exceptions');
  check('M: RunDateOverride setting changes the future-date check', () => {
    const di = t3.columns.indexOf('RunDate'); assert.ok(t3.rows.every(r => r[di] === '2015-06-01'));
    assert.ok(t3.rows.filter(r => r[ri] === 'INC-009').length > 20);
  });
  fs.writeFileSync(path.join(root, 'build/m_result.json'), JSON.stringify(mRows));
  console.log(failures ? `\n${failures} FAILED` : '\nAll Power Query checks passed');
  process.exit(failures ? 1 : 0);
})();
