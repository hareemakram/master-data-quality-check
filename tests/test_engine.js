// Test-suite: unit tests for every primitive + end-to-end comparison of the
// engine output against the ground-truth list of planted defects.
const assert = require('assert');
const fs = require('fs'), path = require('path');
const DQ = require('../build/engine.cjs');
const root = path.join(__dirname, '..');
let passed = 0, failed = 0;
function t(name, fn) { try { fn(); passed++; } catch (e) { failed++; console.log('FAIL', name, '-', e.message); } }

// ---- primitives -----------------------------------------------------------
t('normalize drops legal forms & punctuation', () => {
  assert.strictEqual(DQ.dqNormalizeName('Contoso, Ltd.', true), 'contoso');
  assert.strictEqual(DQ.dqNormalizeName('The A&B Company GmbH', true), 'a and b');
  assert.strictEqual(DQ.dqNormalizeName('Hex-Bolt  M8', false), 'hex bolt m8');
});
t('dice', () => {
  assert.strictEqual(DQ.dqDice('night', 'nacht'), 0.25);
  assert.strictEqual(DQ.dqDice('abc', 'abc'), 1);
  assert.ok(DQ.dqDice('northwind traders', 'northwindd traders') > 0.95);
  assert.strictEqual(DQ.dqDice('aa', 'aaaa'), 0.5); // multiset intersection
});
t('pattern masks', () => {
  assert.ok(DQ.dqMatchesPattern('12-3456789', '##-#######'));
  assert.ok(!DQ.dqMatchesPattern('123456789', '##-#######'));
  assert.ok(DQ.dqMatchesPattern('sw1a 1aa', '@# #@@|@## #@@|@@#@ #@@'));
  assert.ok(!DQ.dqMatchesPattern('SW1A1AA', '@# #@@|@## #@@|@@#@ #@@'));
  assert.ok(DQ.dqMatchesPattern('NL123456789B01', 'NL#########B##'));
  assert.ok(DQ.dqMatchesPattern('02139-1234', '#####|#####-####'));
});
t('email', () => {
  for (const ok of ['a@b.co', "o'neil+ap@mail.contoso.com", 'X.Y@Z-1.io']) assert.ok(DQ.dqValidEmail(ok), ok);
  for (const bad of ['john.doe@', 'accounts.contoso.com', 'billing team@fabrikam.com', 'ap@fabrikam',
    'orders@@litware.com', '.a@b.com', 'a..b@c.com', 'a@b..com', 'a@b.c1', 'a@.b.com']) assert.ok(!DQ.dqValidEmail(bad), bad);
});
t('phone', () => {
  assert.strictEqual(DQ.dqPhoneProblem('+1 (415) 555-0100', '1'), null);
  assert.ok(DQ.dqPhoneProblem('+33 612345678', '49').includes('calling code'));
  assert.ok(DQ.dqPhoneProblem('555-0199', '1').includes('must start'));
  assert.ok(DQ.dqPhoneProblem('+44 20 7946 ABCD', '44').includes('characters'));
  assert.ok(DQ.dqPhoneProblem('+4412', '44').includes('8-15'));
});
t('iban', () => {
  const L = { DE: 22, GB: 22, FR: 27 };
  assert.ok(DQ.dqValidIban('DE89 3704 0044 0532 0130 00', L));  // official example
  assert.ok(DQ.dqValidIban('GB29NWBK60161331926819', L));
  assert.ok(!DQ.dqValidIban('DE89370400440532013001', L));
  assert.ok(!DQ.dqValidIban('DE8937040044053201300', L));
  assert.ok(!DQ.dqValidIban('ZZ001234567890', L));
});
t('dates & numbers', () => {
  assert.strictEqual(DQ.dqDate('2024-02-29'), '2024-02-29');
  assert.strictEqual(DQ.dqDate('2023-02-29'), null);
  assert.strictEqual(DQ.dqDate('31/02/2024'), null);
  assert.strictEqual(DQ.dqDate(45000), '2023-03-15'); // Excel serial
  assert.strictEqual(DQ.dqNumber('12.5'), 12.5);
  assert.ok(isNaN(DQ.dqNumber('TBD')));
  assert.ok(isNaN(DQ.dqNumber(true)));
});

// ---- end-to-end against ground truth ----------------------------------------
const md = JSON.parse(fs.readFileSync(path.join(root, 'data/master_data.json')));
const ref = JSON.parse(fs.readFileSync(path.join(root, 'data/reference.json')));
const truth = JSON.parse(fs.readFileSync(path.join(root, 'data/expected_exceptions.json')));
const input = { customers: md.Customers, vendors: md.Vendors, materials: md.Materials, countries: ref.Countries,
  lists: ref.Lists, rules: ref.Rules, requiredFields: ref.RequiredFields, owners: ref.Owners };
const res = DQ.runQualityChecks(input, truth.RunDate);
const key = e => `${e.Entity}|${e.SourceRow ?? e.Row}|${e.RuleID}|${e.Field}`;
const got = new Set(res.exceptions.map(key)), want = new Set(truth.Expected.map(key));
const missing = [...want].filter(k => !got.has(k)), extra = [...got].filter(k => !want.has(k));
t('every planted defect is detected (recall 100%)', () => assert.deepStrictEqual(missing, []));
t('no false positives on clean data (precision 100%)', () => {
  if (extra.length) extra.forEach(k => { const e = res.exceptions.find(x => key(x) === k); console.log('  extra:', k, e.Value, '|', e.Details); });
  assert.deepStrictEqual(extra, []);
});
t('exception IDs unique', () => assert.strictEqual(new Set(res.exceptions.map(e => e.ExceptionID)).size, res.exceptions.length));
t('every exception has an owner', () => assert.ok(res.exceptions.every(e => e.OwnerEmail.endsWith('@contoso.com'))));
t('invalid-country records routed to governance', () =>
  assert.ok(res.exceptions.filter(e => e.Region === 'Unassigned').every(e => e.OwnerEmail === 'data.governance@contoso.com')));
t('disabling a rule removes it', () => {
  const rules = ref.Rules.map(r => r.RuleID === 'DUP-005' ? { ...r, Enabled: 'No' } : r);
  const r2 = DQ.runQualityChecks({ ...input, rules }, truth.RunDate);
  assert.strictEqual(r2.exceptions.filter(e => e.RuleID === 'DUP-005').length, 0);
  assert.strictEqual(r2.exceptions.length, res.exceptions.length - res.exceptions.filter(e => e.RuleID === 'DUP-005').length);
});
t('threshold is configurable', () => {
  const rules = ref.Rules.map(r => r.RuleID === 'DUP-005' ? { ...r, Threshold: 0.99 } : r);
  const r2 = DQ.runQualityChecks({ ...input, rules }, truth.RunDate);
  assert.ok(r2.exceptions.filter(e => e.RuleID === 'DUP-005').length < res.exceptions.filter(e => e.RuleID === 'DUP-005').length);
});
t('MIS-001 severity comes from Required Fields table', () =>
  assert.ok(res.exceptions.filter(e => e.RuleID === 'MIS-001' && e.Field === 'Email').every(e => e.Severity === 'Medium')));
t('sorted by severity desc', () => { for (let i = 1; i < res.exceptions.length; i++) assert.ok(res.exceptions[i - 1].SeverityRank >= res.exceptions[i].SeverityRank); });
t('csv round-trip row count', () => assert.strictEqual(DQ.dqToCsv(res.exceptions).split('\r\n').length, res.exceptions.length + 1));
t('owner packets cover all exceptions', () => {
  const p = DQ.dqOwnerPackets(res, 'https://x');
  assert.strictEqual(p.reduce((a, b) => a + b.Count, 0), res.exceptions.length);
  assert.ok(p.every(x => x.Html.includes('Open the full exception report')));
});

console.log(`\n${passed} passed, ${failed} failed`);
console.log(`exceptions=${res.exceptions.length} expected=${want.size} records=${res.totals.records} clean=${(res.totals.cleanRate*100).toFixed(1)}%`);
fs.writeFileSync(path.join(root, 'build/result.json'), JSON.stringify(res, null, 1));
process.exit(failed ? 1 : 0);
