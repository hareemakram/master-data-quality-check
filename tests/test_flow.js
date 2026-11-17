// Simulates the Power Automate flow: parses and evaluates every Workflow Definition Language
// expression, runs the actions in runAfter order (including If / Foreach / Scope and the Catch
// branch), and mocks the three connectors. Uses the real Office Script output as the script result.
const fs = require('fs'), path = require('path'), assert = require('assert');
const JSZip = require('jszip');
const root = path.join(__dirname, '..');
const def = JSON.parse(fs.readFileSync(path.join(root, 'automation/flow/definition.json')));
const scriptOut = JSON.parse(fs.readFileSync(path.join(root, 'build/script_output.json')));

// ---------------------------------------------------------------- WDL expression evaluator
function tokenize(s) {
  const t = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") { let v = ''; i++; while (true) { if (i >= s.length) throw new Error('unterminated string in ' + s); if (s[i] === "'") { if (s[i + 1] === "'") { v += "'"; i += 2; continue; } i++; break; } v += s[i++]; } t.push({ k: 'str', v }); continue; }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(s[i + 1]))) { let v = c; i++; while (i < s.length && /[0-9.]/.test(s[i])) v += s[i++]; t.push({ k: 'num', v: Number(v) }); continue; }
    if (/[A-Za-z_$]/.test(c)) { let v = ''; while (i < s.length && /[A-Za-z0-9_$]/.test(s[i])) v += s[i++]; t.push({ k: 'id', v }); continue; }
    if (c === '?' && s[i + 1] === '[') { t.push({ k: '?[' }); i += 2; continue; }
    if ('()[],.'.includes(c)) { t.push({ k: c }); i++; continue; }
    throw new Error(`bad char '${c}' in ${s}`);
  }
  return t;
}
function parse(src) {
  const t = tokenize(src); let p = 0;
  const peek = () => t[p], eat = k => { if (!t[p] || t[p].k !== k) throw new Error(`expected ${k} in ${src}`); return t[p++]; };
  function primary() {
    const tok = t[p++];
    if (!tok) throw new Error('unexpected end in ' + src);
    let node;
    if (tok.k === 'str') node = { lit: tok.v };
    else if (tok.k === 'num') node = { lit: tok.v };
    else if (tok.k === 'id') {
      if (['true', 'false', 'null'].includes(tok.v) && (!peek() || peek().k !== '(')) node = { lit: JSON.parse(tok.v) };
      else { eat('('); const args = []; if (peek().k !== ')') { args.push(primary()); while (peek().k === ',') { p++; args.push(primary()); } } eat(')'); node = { call: tok.v, args }; }
    } else throw new Error(`unexpected ${tok.k} in ${src}`);
    while (peek() && (peek().k === '[' || peek().k === '?[' || peek().k === '.')) {
      const k = t[p++].k;
      if (k === '.') { node = { get: node, key: { lit: eat('id').v } }; }
      else { const key = primary(); eat(']'); node = { get: node, key, safe: k === '?[' }; }
    }
    return node;
  }
  const n = primary(); if (p !== t.length) throw new Error('trailing tokens in ' + src); return n;
}
const pad = n => String(n).padStart(2, '0');
function evalNode(n, ctx) {
  if ('lit' in n) return n.lit;
  if (n.get) { const o = evalNode(n.get, ctx), k = evalNode(n.key, ctx);
    if (o === null || o === undefined) { if (n.safe) return null; throw new Error(`property '${k}' of null`); }
    // Power Automate allows 'body/x' style paths on outputs
    if (typeof k === 'string' && k.includes('/') && !(k in o)) return k.split('/').reduce((a, s) => a == null ? null : a[s], o);
    if (!(k in o)) { if (n.safe) return null; throw new Error(`property '${k}' missing`); }
    return o[k]; }
  const a = n.args.map(x => evalNode(x, ctx));
  const F = {
    outputs: name => { if (!(name in ctx.outputs)) throw new Error(`outputs('${name}') referenced before it ran / does not exist`); return ctx.outputs[name]; },
    items: name => { if (!(name in ctx.items)) throw new Error(`items('${name}') outside its loop`); return ctx.items[name]; },
    parameters: name => ({}),
    utcNow: () => ctx.now.toISOString(),
    convertFromUtc: (ts, tz) => { if (typeof tz !== 'string' || !tz) throw new Error('timezone missing'); return ts; },
    formatDateTime: (ts, fmt) => { const d = new Date(ts); if (fmt !== 'yyyy-MM-dd') throw new Error('fmt'); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; },
    replace: (s, a1, b) => { if (typeof s !== 'string') throw new Error('replace on ' + typeof s); return s.split(a1).join(b); },
    greater: (x, y) => { if (typeof x !== 'number' || typeof y !== 'number') throw new Error('greater non-number'); return x > y; },
    equals: (x, y) => x === y,
    add: (x, y) => { if (typeof x !== 'number' || typeof y !== 'number') throw new Error('add non-number'); return x + y; },
    mul: (x, y) => x * y,
    formatNumber: (x, f) => { assert.strictEqual(f, '0.0'); return x.toFixed(1); },
    base64: s => Buffer.from(s, 'utf8').toString('base64'),
    if: (c, x, y) => { if (typeof c !== 'boolean') throw new Error('if non-boolean'); return c ? x : y; },
    string: x => typeof x === 'string' ? x : JSON.stringify(x),
    result: name => ctx.results[name] || [],
    workflow: () => ({ name: 'flow-id', tags: { environmentName: 'env' }, run: { name: 'run-id' } }),
  };
  if (!F[n.call]) throw new Error('unsupported function ' + n.call);
  return F[n.call](...a);
}
// "@expr" -> value ; "...@{expr}..." -> string interpolation ; "@@" escape
function evalValue(v, ctx) {
  if (Array.isArray(v)) return v.map(x => evalValue(x, ctx));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, evalValue(x, ctx)]));
  if (typeof v !== 'string') return v;
  if (v.startsWith('@') && !v.startsWith('@{') && !v.startsWith('@@')) return evalNode(parse(v.slice(1)), ctx);
  let out = '', i = 0;
  while (i < v.length) {
    const j = v.indexOf('@{', i);
    if (j < 0) { out += v.slice(i); break; }
    out += v.slice(i, j);
    let depth = 0, k = j + 1, inStr = false;
    for (; k < v.length; k++) { const c = v[k]; if (c === "'") inStr = !inStr; if (inStr) continue; if (c === '{') depth++; if (c === '}') { depth--; if (depth === 0) break; } }
    if (k >= v.length) throw new Error('unbalanced @{ in ' + v.slice(0, 80));
    const r = evalNode(parse(v.slice(j + 2, k)), ctx);
    out += typeof r === 'string' ? r : JSON.stringify(r);
    i = k + 1;
  }
  return out;
}

// ---------------------------------------------------------------- runner
function runActions(actions, ctx, scopeName) {
  const pending = new Set(Object.keys(actions)), status = {};
  const results = [];
  while (pending.size) {
    let progressed = false;
    for (const name of [...pending]) {
      const a = actions[name], deps = a.runAfter || {};
      Object.keys(deps).forEach(d => { if (!(d in actions)) throw new Error(`${name}.runAfter references unknown action ${d} in scope ${scopeName}`); });
      if (!Object.keys(deps).every(d => d in status)) continue;
      pending.delete(name); progressed = true;
      const ok = Object.entries(deps).every(([d, st]) => st.includes(status[d]));
      if (!ok) { status[name] = 'Skipped'; continue; }
      try { status[name] = runAction(name, a, ctx); }
      catch (e) { status[name] = 'Failed'; ctx.errors.push(`${name}: ${e.message}`); }
      results.push({ name, status: status[name] });
    }
    if (!progressed) throw new Error('runAfter cycle in ' + scopeName);
  }
  ctx.results[scopeName] = results;
  return Object.values(status).includes('Failed') ? 'Failed' : 'Succeeded';
}
function runAction(name, a, ctx) {
  switch (a.type) {
    case 'Compose': ctx.outputs[name] = evalValue(a.inputs, ctx); return 'Succeeded';
    case 'Scope': return runActions(a.actions, ctx, name);
    case 'If': {
      const ex = a.expression; const evalCond = c => {
        if (c.and) return c.and.every(evalCond); if (c.or) return c.or.some(evalCond);
        const [op, args] = Object.entries(c)[0]; const v = args.map(x => evalValue(x, ctx));
        if (op === 'greater') return v[0] > v[1]; if (op === 'equals') return v[0] === v[1]; throw new Error('cond ' + op); };
      return runActions(evalCond(ex) ? a.actions : (a.else ? a.else.actions : {}), ctx, name);
    }
    case 'Foreach': {
      const list = evalValue(a.foreach, ctx); if (!Array.isArray(list)) throw new Error('foreach over non-array');
      let st = 'Succeeded';
      for (const item of list) { ctx.items[name] = item; if (runActions(a.actions, ctx, name) === 'Failed') st = 'Failed'; }
      delete ctx.items[name]; return st;
    }
    case 'OpenApiConnection': {
      const p = evalValue(a.inputs.parameters, ctx), op = a.inputs.host.operationId;
      if (!(a.inputs.host.connectionName in ctx.connectionReferences)) throw new Error('connection not declared: ' + a.inputs.host.connectionName);
      if (op === 'RunScriptProd') { if (ctx.scriptFails) throw new Error('script error'); assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(p['ScriptParameters/runDate'])); ctx.outputs[name] = { body: { result: scriptOut } }; }
      else if (op === 'CreateFile') { const file = { Path: `${p.folderPath}/${p.name}`, Name: p.name }; ctx.files.push({ ...file, body: p.body, dataset: p.dataset }); ctx.outputs[name] = { body: file }; }
      else if (op === 'SendEmailV2') { ctx.emails.push(p); ctx.outputs[name] = { body: {} }; }
      else throw new Error('unknown op ' + op);
      return 'Succeeded';
    }
    default: throw new Error('unsupported action type ' + a.type);
  }
}
function simulate(opts = {}) {
  const ctx = { outputs: {}, items: {}, results: {}, files: [], emails: [], errors: [], now: new Date('2026-11-23T12:00:00Z'),
    connectionReferences: { shared_excelonlinebusiness: 1, shared_sharepointonline: 1, shared_office365: 1 }, ...opts };
  runActions(def.actions, ctx, 'root');
  return ctx;
}

// ---------------------------------------------------------------- tests
let fails = 0; const t = (n, f) => { try { f(); console.log('PASS', n); } catch (e) { fails++; console.log('FAIL', n, '-', e.message); } };
t('trigger is a weekly Monday 07:00 recurrence', () => {
  const tr = def.triggers.Every_Monday_7am; assert.strictEqual(tr.type, 'Recurrence');
  assert.deepStrictEqual(tr.recurrence.schedule, { weekDays: ['Monday'], hours: ['7'], minutes: [0] }); assert.strictEqual(tr.recurrence.frequency, 'Week');
});
const ok = simulate();
t('happy path runs without expression errors', () => assert.deepStrictEqual(ok.errors, []));
t('CSV + HTML reports saved to the SharePoint report folder', () => {
  assert.deepStrictEqual(ok.files.map(f => f.Path).sort(), ['/Shared Documents/Data Quality/Exception Reports/DQ_Exception_Report_2026-11-17.csv',
    '/Shared Documents/Data Quality/Exception Reports/DQ_Exception_Report_2026-11-17.html']);
  assert.strictEqual(ok.files.find(f => f.Name.endsWith('.csv')).body, scriptOut.csv);
  assert.ok(ok.files.every(f => f.dataset === 'https://contoso.sharepoint.com/sites/DataGovernance'));
});
const ownerMails = ok.emails.filter(e => e['emailMessage/To'] !== 'data.governance@contoso.com' || e['emailMessage/Subject'].startsWith('Action'));
t('one email per data owner, to the right address', () => {
  assert.strictEqual(ownerMails.length, scriptOut.owners.length);
  assert.deepStrictEqual(ownerMails.map(e => e['emailMessage/To']).sort(), scriptOut.owners.map(o => o.OwnerEmail).sort());
});
t('owner emails carry a working report link (placeholder replaced)', () => ownerMails.forEach(e => {
  assert.ok(!e['emailMessage/Body'].includes('{{REPORT_URL}}'));
  assert.ok(e['emailMessage/Body'].includes('https://contoso.sharepoint.com/sites/DataGovernance/Shared%20Documents/Data%20Quality/Exception%20Reports/DQ_Exception_Report_2026-11-17.html'));
}));
t('owner subject + importance reflect their exceptions', () => {
  const lukas = ownerMails.find(e => e['emailMessage/To'] === 'lukas.fischer@contoso.com');
  assert.match(lukas['emailMessage/Subject'], /^Action needed: 47 master data exceptions \(\d+ critical\) - week of 2026-11-17$/);
  assert.strictEqual(lukas['emailMessage/Importance'], 'High');
});
t('governance summary email with CSV attachment', () => {
  const g = ok.emails.find(e => e['emailMessage/Subject'].startsWith('Master data quality:'));
  assert.strictEqual(g['emailMessage/Subject'], 'Master data quality: 168 exceptions, 71.3% clean - 2026-11-17');
  assert.strictEqual(Buffer.from(g['emailMessage/Attachments'][0].ContentBytes, 'base64').toString(), scriptOut.csv);
  assert.ok(!g['emailMessage/Body'].includes('{{REPORT_URL}}'));
});
t('no failure alert on the happy path', () => assert.ok(!ok.emails.some(e => e['emailMessage/Subject'].startsWith('FAILED'))));
const bad = simulate({ scriptFails: true });
t('script failure triggers the Catch alert (and no owner emails)', () => {
  assert.strictEqual(bad.emails.length, 1); assert.strictEqual(bad.emails[0]['emailMessage/Subject'], 'FAILED: weekly master data quality flow');
  assert.ok(bad.emails[0]['emailMessage/Body'].includes('Run_quality_checks'));
});
(async () => {
  const z = await JSZip.loadAsync(fs.readFileSync(path.join(root, 'automation/MasterDataQuality_WeeklyFlow.zip')));
  const names = Object.keys(z.files);
  const flowId = JSON.parse(await z.file('Microsoft.Flow/flows/manifest.json').async('text')).flowAssets.assetPaths[0];
  try {
    for (const f of ['manifest.json', `Microsoft.Flow/flows/${flowId}/definition.json`, `Microsoft.Flow/flows/${flowId}/apisMap.json`, `Microsoft.Flow/flows/${flowId}/connectionsMap.json`]) assert.ok(names.includes(f), f);
    const pkgDef = JSON.parse(await z.file(`Microsoft.Flow/flows/${flowId}/definition.json`).async('text'));
    assert.deepStrictEqual(pkgDef.properties.definition, def);
    const man = JSON.parse(await z.file('manifest.json').async('text'));
    const apis = JSON.parse(await z.file(`Microsoft.Flow/flows/${flowId}/apisMap.json`).async('text'));
    const conns = JSON.parse(await z.file(`Microsoft.Flow/flows/${flowId}/connectionsMap.json`).async('text'));
    Object.values(apis).concat(Object.values(conns)).forEach(id => assert.ok(man.resources[id], 'resource ' + id));
    assert.deepStrictEqual(Object.keys(pkgDef.properties.connectionReferences).sort(), Object.keys(apis).sort());
    console.log('PASS package resources consistent');
  } catch (e) { fails++; console.log('FAIL package -', e.message); }
  console.log(fails ? `${fails} FAILED` : 'Power Automate flow OK'); process.exit(fails ? 1 : 0);
})();
