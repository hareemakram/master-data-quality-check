// Assembles powerquery/*.pq into a Power Query section document (Section1.m) and
// validates every query with Microsoft's official Power Query parser.
const fs = require('fs'), path = require('path');
const PQP = require('@microsoft/powerquery-parser');
const root = path.join(__dirname, '..');
const ORDER = ['Cfg_Settings', 'RunDate', 'Cfg_Countries', 'Cfg_Lists', 'Cfg_Rules', 'Cfg_RequiredFields', 'Cfg_Owners',
  'Src_Customers', 'Src_Vendors', 'Src_Materials', 'fnIsBlank', 'fnText', 'fnTrim', 'fnDisplay', 'fnNormalizeName',
  'fnDice', 'fnMatchesPattern', 'fnValidEmail', 'fnPhoneProblem', 'fnValidIban', 'fnToNumber', 'fnToDate',
  'fnEntityChecks', 'Exceptions'];
const files = fs.readdirSync(path.join(root, 'powerquery')).filter(f => f.endsWith('.pq')).map(f => f.slice(0, -3));
const missing = files.filter(f => !ORDER.includes(f)).concat(ORDER.filter(f => !files.includes(f)));
if (missing.length) throw new Error('ORDER mismatch: ' + missing);
(async () => {
  let ok = true;
  const members = [];
  for (const name of ORDER) {
    const text = fs.readFileSync(path.join(root, 'powerquery', name + '.pq'), 'utf8').trim();
    const res = await PQP.TaskUtils.tryLexParse(PQP.DefaultSettings, text);
    if (!PQP.TaskUtils.isParseStageOk(res)) {
      ok = false;
      const err = res.error;
      console.log('PARSE ERROR in', name, ':', err.message || err.innerError?.message);
    }
    members.push({ name, text });
  }
  const section = 'section Section1;\r\n\r\n' + members.map(m => `shared ${m.name} = ${m.text.replace(/\n/g, '\r\n')};`).join('\r\n\r\n') + '\r\n';
  // also validate the whole section document
  const sres = await PQP.TaskUtils.tryLexParse(PQP.DefaultSettings, section);
  if (!PQP.TaskUtils.isParseStageOk(sres)) { ok = false; console.log('SECTION PARSE ERROR', sres.error.message); }
  fs.writeFileSync(path.join(root, 'build/Section1.m'), section);
  fs.writeFileSync(path.join(root, 'build/queries.json'), JSON.stringify(members.map(m => ({ name: m.name, isFunction: m.name.startsWith('fn') }))));
  console.log(ok ? `All ${members.length} queries parse OK` : 'PARSE FAILURES');
  process.exit(ok ? 0 : 1);
})();
