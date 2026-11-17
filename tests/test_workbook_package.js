// Validates the packaged workbook: Microsoft's connected-workbooks library re-parses our
// DataMashup, the embedded Section1.m is byte-identical to the tested one, every XML part is
// well-formed, and the query table / connection / defined name wiring is consistent.
const fs = require('fs'), path = require('path'), assert = require('assert');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const mdp = require('@microsoft/connected-workbooks/dist/utils/mashupDocumentParser');
const pq = require('@microsoft/connected-workbooks/dist/utils/pqUtils').default;
const root = path.join(__dirname, '..');
const file = process.argv[2] || path.join(root, 'build/MasterDataQuality.xlsx');
let fails = 0; const t = async (n, f) => { try { await f(); console.log('PASS', n); } catch (e) { fails++; console.log('FAIL', n, '-', e.message); } };
(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  await t('all XML parts are well-formed', async () => {
    for (const name of Object.keys(zip.files).filter(n => /\.(xml|rels)$/.test(n))) {
      const buf = await zip.file(name).async('uint8array');
      const text = buf[0] === 0xff && buf[1] === 0xfe ? new TextDecoder('utf-16le').decode(buf.slice(2)) : new TextDecoder().decode(buf);
      const errors = []; new DOMParser({ onError: (lvl, msg) => { if (lvl !== 'warning') errors.push(msg); } }).parseFromString(text, 'text/xml');
      assert.deepStrictEqual(errors, [], name);
    }
  });
  const b64 = await pq.getBase64(zip);
  await t('Microsoft connected-workbooks parses the DataMashup', async () => {
    const c = mdp.getPackageComponents(b64);
    assert.deepStrictEqual([...c.version], [0, 0, 0, 0]); assert.ok(c.packageOPC.length > 1000); assert.ok(c.metadata.length > 1000);
    const pkg = await JSZip.loadAsync(c.packageOPC);
    const m = await pkg.file('Formulas/Section1.m').async('text');
    assert.strictEqual(m, fs.readFileSync(path.join(root, 'build/Section1.m'), 'utf8'), 'Section1.m differs from tested version');
    const meta = new TextDecoder().decode(c.metadata.slice(8));
    assert.strictEqual((meta.match(/<ItemType>Formula<\/ItemType>/g) || []).length, 24);
    assert.ok(meta.includes('sTable"/><Entry Type="FillToDataModelEnabled"') || meta.includes('FillTarget" Value="stblExceptions"'));
  });
  await t('query table wiring is consistent', async () => {
    const conns = await zip.file('xl/connections.xml').async('text');
    const qt = await zip.file('xl/queryTables/queryTable1.xml').async('text');
    const wb = await zip.file('xl/workbook.xml').async('text');
    const tableName = Object.keys(zip.files).find(n => /^xl\/tables\/table\d+\.xml$/.test(n) && 0);
    let tx = '';
    for (const n of Object.keys(zip.files).filter(n => /^xl\/tables\/table\d+\.xml$/.test(n))) { const s = await zip.file(n).async('text'); if (s.includes('displayName="tblExceptions"')) tx = s; }
    assert.ok(tx.includes('tableType="queryTable"'));
    assert.strictEqual((tx.match(/queryTableFieldId=/g) || []).length, 19);
    assert.strictEqual((qt.match(/<queryTableField /g) || []).length, 19);
    assert.ok(/connectionId="1"/.test(qt) && /<connection id="1"[^>]*name="Query - Exceptions"/.test(conns));
    assert.ok(/definedName name="ExternalData_1" localSheetId="1" hidden="1">Exceptions!\$A\$1:\$S\$169</.test(wb));
    const ct = await zip.file('[Content_Types].xml').async('text');
    for (const p of ['/xl/connections.xml', '/xl/queryTables/queryTable1.xml', '/customXml/itemProps1.xml']) assert.ok(ct.includes(p), p);
  });
  console.log(fails ? `${fails} FAILED` : 'Workbook package OK'); process.exit(fails ? 1 : 0);
})();
