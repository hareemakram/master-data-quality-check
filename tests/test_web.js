// Drives the web console in Chromium: renders, tabs, filters, drawer, rule toggles,
// email preview, and uploading the generated workbook (re-checked in the browser).
const { chromium } = require('playwright');
const path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  // the sandbox cannot reach cdnjs; serve the identical SheetJS 0.18.5 build from npm
  const routeCdn = c => c.route('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    r => r.fulfill({ path: require.resolve('xlsx/dist/xlsx.full.min.js'), contentType: 'application/javascript' }));
  await routeCdn(ctx);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(root, 'build/web/MasterDataQualityConsole.html'));
  await page.waitForSelector('.kpi');
  let fails = 0; const t = async (n, f) => { try { await f(); console.log('PASS', n); } catch (e) { fails++; console.log('FAIL', n, '-', e.message); } };
  const kpi = async () => page.$$eval('.kpi b', els => els.map(e => e.textContent));
  await t('KPIs match engine', async () => assert.deepStrictEqual(await kpi(), ['498', '168', '71.3%', '10', '68', '10']));
  await page.screenshot({ path: path.join(root, 'build/shots/overview.png'), fullPage: true });
  await t('severity legend click filters explorer', async () => {
    await page.click('[data-goto="Severity:Critical"]');
    await page.waitForSelector('#view-exceptions:not([hidden])');
    assert.match(await page.textContent('#pagerInfo'), /of 10 exceptions/);
  });
  await t('search filters', async () => { await page.click('#clearF'); await page.fill('#q', 'IBAN'); assert.match(await page.textContent('#pagerInfo'), /of \d+ exceptions/);
    const n = await page.$$eval('#tbody tr', r => r.length); assert.ok(n >= 5); });
  await page.click('#clearF');
  await page.screenshot({ path: path.join(root, 'build/shots/exceptions.png') });
  await t('record drawer opens with highlighted field', async () => { await page.click('#tbody tr'); await page.waitForSelector('.drawer'); assert.ok(await page.$('.kv .bad'));
    await page.screenshot({ path: path.join(root, 'build/shots/drawer.png') }); await page.keyboard.press('Escape'); assert.ok(!(await page.$('.drawer'))); });
  await t('owner email preview renders', async () => { await page.click('.tab[data-view=owners]'); await page.click('[data-preview="lukas.fischer@contoso.com"]');
    assert.match(await page.textContent('#emailBody'), /47 exceptions need your review/); await page.screenshot({ path: path.join(root, 'build/shots/owners.png'), fullPage: true }); });
  await t('disabling DUP-005 re-runs checks', async () => { await page.click('.tab[data-view=rules]');
    const idx = await page.$$eval('.rule .mono', els => els.findIndex(e => e.textContent === 'DUP-005'));
    await page.click(`[data-on="${idx}"]`); const k = await kpi(); assert.strictEqual(k[1], String(168 - 9));
    await page.click(`[data-on="${idx}"]`); assert.strictEqual((await kpi())[1], '168'); });
  await page.screenshot({ path: path.join(root, 'build/shots/rules.png') });
  await t('uploading the generated workbook re-checks it in the browser', async () => {
    const hasXlsx = await page.evaluate(() => typeof XLSX !== 'undefined');
    if (!hasXlsx) throw new Error('SheetJS did not load (network)');
    await page.setInputFiles('#fileInput', path.join(root, 'build/MasterDataQuality.xlsx'));
    await page.waitForFunction(() => document.getElementById('srcChip').textContent.endsWith('.xlsx'));
    const k = await kpi(); assert.deepStrictEqual(k.slice(1, 5), ['168', '71.3%', '10', '68']);
  });
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' }); await routeCdn(mctx);
  await mctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const mobile = await mctx.newPage();
  await mobile.goto('file://' + path.join(root, 'build/web/MasterDataQualityConsole.html')); await mobile.waitForSelector('.kpi');
  await t('no horizontal scroll on phone', async () => assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
  await mobile.screenshot({ path: path.join(root, 'build/shots/mobile-dark.png'), fullPage: false });
  await t('no console errors', async () => assert.deepStrictEqual(errors.filter(e => !/Failed to load resource/.test(e)), []));
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'Web console OK'); process.exit(fails ? 1 : 0);
})();
