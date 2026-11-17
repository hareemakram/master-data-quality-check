// Builds the self-contained web console: engine + sample data inlined into the template.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const md = JSON.parse(fs.readFileSync(path.join(root, 'data/master_data.json')));
const ref = JSON.parse(fs.readFileSync(path.join(root, 'data/reference.json')));
const truth = JSON.parse(fs.readFileSync(path.join(root, 'data/expected_exceptions.json')));
const sample = { Customers: md.Customers, Vendors: md.Vendors, Materials: md.Materials, Countries: ref.Countries, Lists: ref.Lists,
  Rules: ref.Rules.map(r => ({ ...r, Enabled: r.Enabled ? 'Yes' : 'No' })), RequiredFields: ref.RequiredFields, Owners: ref.Owners };
let html = fs.readFileSync(path.join(root, 'web/console.template.html'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'build/engine.browser.js'), 'utf8');
html = html.replace('/*__ENGINE__*/', () => engine).replace('/*__DATA__*/', () => JSON.stringify(sample).replace(/</g, '\\u003c'))
  .replace('/*__RUNDATE__*/', truth.RunDate);
fs.mkdirSync(path.join(root, 'build/web'), { recursive: true });
fs.writeFileSync(path.join(root, 'build/web/MasterDataQualityConsole.html'), html);
console.log('web console', (html.length / 1024).toFixed(0) + ' KB');
