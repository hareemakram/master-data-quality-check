// ============================================================================
// Minimal Power Query M interpreter used ONLY for testing.
// ----------------------------------------------------------------------------
// Power Query cannot run on Linux/CI, so this evaluates the exact Section1.m
// that is embedded in the workbook (parsed with Microsoft's official
// @microsoft/powerquery-parser) against the sample data, implementing the M
// language semantics and the ~75 standard-library functions the queries use.
// It enforces parameter/return type assertions, lazy let/record evaluation,
// cyclic-reference detection and M's null/equality rules, so that typos,
// unknown identifiers, wrong argument types and logic errors surface here.
// ============================================================================
const PQP = require('@microsoft/powerquery-parser');

class MError extends Error { constructor(msg) { super(msg); this.isM = true; } }
class MDate { constructor(y, m, d) { this.y = y; this.m = m; this.d = d; } }
class MDateTime { constructor(y, m, d) { this.y = y; this.m = m; this.d = d; } }
class MType { constructor(name, nullable) { this.name = name; this.nullable = !!nullable; } }
class MFunction { constructor(fn, name) { this.fn = fn; this.name = name || 'fn'; } }
class MRecord {
  constructor() { this.names = []; this.thunks = new Map(); this.cache = new Map(); }
  static from(obj) { const r = new MRecord(); for (const k of Object.keys(obj)) r.setValue(k, obj[k]); return r; }
  setValue(k, v) { if (!this.thunks.has(k)) this.names.push(k); this.thunks.set(k, () => v); this.cache.set(k, v); }
  setThunk(k, t) { if (this.thunks.has(k)) throw new MError(`Duplicate field '${k}'`); this.names.push(k); this.thunks.set(k, t); }
  has(k) { return this.thunks.has(k); }
  get(k) {
    if (!this.thunks.has(k)) throw new MError(`The field '${k}' of the record wasn't found.`);
    if (this.cache.has(k)) { const v = this.cache.get(k); if (v === CYCLE) throw new MError(`Cyclic reference to '${k}'`); return v; }
    this.cache.set(k, CYCLE);
    try { const v = this.thunks.get(k)(); this.cache.set(k, v); return v; }
    catch (e) { this.cache.delete(k); throw e; }
  }
}
const CYCLE = Symbol('cycle');
class MTable {
  constructor(columns, rows) { this.columns = columns; this.rows = rows; } // rows: arrays of values
  record(i) { const r = new MRecord(); this.columns.forEach((c, j) => r.setValue(c, this.rows[i][j])); return r; }
  records() { return this.rows.map((_, i) => this.record(i)); }
  static fromRecords(recs, columns) {
    const cols = columns || (recs.length ? recs[0].names.slice() : []);
    return new MTable(cols, recs.map(r => cols.map(c => r.get(c))));
  }
}

// ----------------------------------------------------------------- helpers
const isText = v => typeof v === 'string';
const isNum = v => typeof v === 'number';
const isList = v => Array.isArray(v);
const isRecord = v => v instanceof MRecord;
const isTable = v => v instanceof MTable;
function typeName(v) {
  if (v === null) return 'null';
  if (isText(v)) return 'text'; if (isNum(v)) return 'number'; if (typeof v === 'boolean') return 'logical';
  if (isList(v)) return 'list'; if (isRecord(v)) return 'record'; if (isTable(v)) return 'table';
  if (v instanceof MFunction) return 'function'; if (v instanceof MDate) return 'date';
  if (v instanceof MDateTime) return 'datetime'; if (v instanceof MType) return 'type';
  throw new Error('unknown value ' + v);
}
function conforms(v, t) {
  if (t === 'any' || t === 'anynonnull' && v !== null) return true;
  if (v === null) return t === 'null';
  return typeName(v) === t;
}
function assertType(v, t, nullable, what) {
  if (t === 'any') return v;
  if (v === null && nullable) return v;
  if (!conforms(v, t)) throw new MError(`Expression.Error: We cannot convert ${typeName(v)} to ${t} (${what})`);
  return v;
}
function mEquals(a, b) {
  if (a === null || b === null) return a === b;
  const ta = typeName(a), tb = typeName(b);
  if (ta !== tb) return false;
  if (ta === 'list') return a.length === b.length && a.every((x, i) => mEquals(x, b[i]));
  if (ta === 'record') return a.names.length === b.names.length && a.names.every(n => b.has(n) && mEquals(a.get(n), b.get(n)));
  if (ta === 'date' || ta === 'datetime') return a.y === b.y && a.m === b.m && a.d === b.d;
  if (ta === 'table') throw new MError('table equality not supported in test interpreter');
  return a === b;
}
function mCompare(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return -1; if (b === null) return 1;
  const ta = typeName(a), tb = typeName(b);
  if (ta !== tb) throw new MError(`Expression.Error: cannot compare ${ta} with ${tb}`);
  if (ta === 'number' || ta === 'text') return a < b ? -1 : a > b ? 1 : 0;
  if (ta === 'logical') return a === b ? 0 : a ? 1 : -1;
  if (ta === 'date' || ta === 'datetime') return mCompare(a.y * 10000 + a.m * 100 + a.d, b.y * 10000 + b.m * 100 + b.d);
  throw new MError('cannot compare ' + ta);
}
function decodeText(lit) {
  let s = lit.slice(1, -1).replace(/""/g, '"');
  return s.replace(/#\(([^)]+)\)/g, (m, code) => {
    const map = { tab: '\t', cr: '\r', lf: '\n', 'cr,lf': '\r\n', '#': '#' };
    if (code in map) return map[code];
    if (/^[0-9A-Fa-f]{4}$/.test(code)) return String.fromCharCode(parseInt(code, 16));
    throw new MError('bad escape ' + m);
  });
}
const pad = (n, w) => String(n).padStart(w, '0');
function validDate(y, m, d) { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d; }
function oleToDate(n) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000); return new MDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
function needText(v, fn) { if (!isText(v)) throw new MError(`${fn}: expected text, got ${typeName(v)}`); return v; }
function needList(v, fn) { if (!isList(v)) throw new MError(`${fn}: expected list, got ${typeName(v)}`); return v; }
function needNum(v, fn) { if (!isNum(v)) throw new MError(`${fn}: expected number, got ${typeName(v)}`); return v; }
function needTable(v, fn) { if (!isTable(v)) throw new MError(`${fn}: expected table, got ${typeName(v)}`); return v; }
function call(f, args) { if (!(f instanceof MFunction)) throw new MError('Expression.Error: cannot invoke ' + typeName(f)); return f.fn(args); }
function charList(x) { if (isText(x)) return [x]; return needList(x, 'chars'); }
function sortCriteria(crit) {
  // "col" | {"col"} | {{"col", Order}} | {"col", Order}
  if (isText(crit)) return [[crit, 0]];
  if (isList(crit) && crit.length === 2 && isText(crit[0]) && isNum(crit[1])) return [[crit[0], crit[1]]];
  return crit.map(c => isText(c) ? [c, 0] : [c[0], c[1] || 0]);
}

// ----------------------------------------------------------------- stdlib
function makeLibrary(ctx) {
  const L = {};
  const def = (name, fn) => { L[name] = new MFunction(args => fn(...args), name); };
  // Text
  def('Text.From', (v) => v === null ? null : isText(v) ? v : isNum(v) ? String(v) : typeof v === 'boolean' ? String(v)
    : (() => { throw new MError('Text.From unsupported for ' + typeName(v)); })());
  def('Text.Trim', t => t === null ? null : needText(t, 'Text.Trim').trim());
  def('Text.Lower', t => t === null ? null : needText(t, 'Text.Lower').toLowerCase());
  def('Text.Upper', t => t === null ? null : needText(t, 'Text.Upper').toUpperCase());
  def('Text.Length', t => t === null ? null : needText(t, 'Text.Length').length);
  def('Text.Middle', (t, s, c) => t === null ? null : needText(t, 'Text.Middle').substr(needNum(s, 'Text.Middle'), c === undefined || c === null ? undefined : c));
  def('Text.Start', (t, n) => t === null ? null : needText(t, 'Text.Start').substr(0, n));
  def('Text.Replace', (t, a, b) => t === null ? null : needText(t, 'Text.Replace').split(needText(a, 'Text.Replace')).join(needText(b, 'Text.Replace')));
  def('Text.Remove', (t, chars) => { if (t === null) return null; const set = charList(chars); return [...needText(t, 'Text.Remove')].filter(c => !set.includes(c)).join(''); });
  def('Text.Select', (t, chars) => { if (t === null) return null; const set = charList(chars); return [...needText(t, 'Text.Select')].filter(c => set.includes(c)).join(''); });
  def('Text.Split', (t, sep) => needText(t, 'Text.Split').split(needText(sep, 'Text.Split')));
  def('Text.Combine', (l, sep) => needList(l, 'Text.Combine').filter(x => x !== null).map(x => needText(x, 'Text.Combine')).join(sep || ''));
  def('Text.ToList', t => [...needText(t, 'Text.ToList')]);
  def('Text.Contains', (t, s) => t === null ? null : needText(t, 'Text.Contains').includes(needText(s, 'Text.Contains')));
  def('Text.StartsWith', (t, s) => t === null ? null : needText(t, 'Text.StartsWith').startsWith(needText(s, 'Text.StartsWith')));
  def('Text.EndsWith', (t, s) => t === null ? null : needText(t, 'Text.EndsWith').endsWith(needText(s, 'Text.EndsWith')));
  def('Text.PadStart', (t, n, ch) => needText(t, 'Text.PadStart').padStart(n, ch || ' '));
  def('Text.AfterDelimiter', (t, d, idx) => {
    needText(t, 'Text.AfterDelimiter');
    let pos;
    if (isList(idx) && idx[1] === 1) { const k = idx[0]; let p = t.length; for (let i = 0; i <= k; i++) { p = t.lastIndexOf(d, p - 1); if (p < 0) return ''; } pos = p; }
    else { const k = isList(idx) ? idx[0] : (idx || 0); let p = -1; for (let i = 0; i <= k; i++) { p = t.indexOf(d, p + 1); if (p < 0) return ''; } pos = p; }
    return t.substr(pos + d.length);
  });
  // List
  def('List.Accumulate', (l, seed, f) => needList(l, 'List.Accumulate').reduce((st, x) => call(f, [st, x]), seed));
  def('List.AllTrue', l => needList(l, 'List.AllTrue').every(x => { if (typeof x !== 'boolean') throw new MError('List.AllTrue: non-logical'); return x; }));
  def('List.AnyTrue', l => needList(l, 'List.AnyTrue').some(x => { if (typeof x !== 'boolean') throw new MError('List.AnyTrue: non-logical'); return x; }));
  def('List.Buffer', l => needList(l, 'List.Buffer').slice());
  def('List.Combine', l => needList(l, 'List.Combine').reduce((a, x) => a.concat(needList(x, 'List.Combine item')), []));
  def('List.Contains', (l, v) => needList(l, 'List.Contains').some(x => mEquals(x, v)));
  def('List.Count', l => needList(l, 'List.Count').length);
  def('List.Distinct', l => { const out = []; needList(l, 'List.Distinct').forEach(x => { if (!out.some(y => mEquals(x, y))) out.push(x); }); return out; });
  def('List.First', (l, d) => needList(l, 'List.First').length ? l[0] : (d === undefined ? null : d));
  def('List.FirstN', (l, n) => needList(l, 'List.FirstN').slice(0, needNum(n, 'List.FirstN')));
  def('List.Min', l => { const v = needList(l, 'List.Min').filter(x => x !== null); return v.length ? v.reduce((a, b) => mCompare(a, b) <= 0 ? a : b) : null; });
  def('List.RemoveNulls', l => needList(l, 'List.RemoveNulls').filter(x => x !== null));
  def('List.Select', (l, f) => needList(l, 'List.Select').filter(x => { const r = call(f, [x]); if (typeof r !== 'boolean') throw new MError('List.Select predicate returned ' + typeName(r)); return r; }));
  def('List.Skip', (l, n) => needList(l, 'List.Skip').slice(n === undefined ? 1 : n));
  def('List.Sort', (l, cmp) => { const a = needList(l, 'List.Sort').slice(); if (cmp instanceof MFunction) { a.sort((x, y) => call(cmp, [x, y])); } else a.sort(mCompare); return a; });
  def('List.Sum', l => { const v = needList(l, 'List.Sum').filter(x => x !== null); return v.length ? v.reduce((a, b) => a + needNum(b, 'List.Sum')) : null; });
  def('List.Transform', (l, f) => needList(l, 'List.Transform').map(x => call(f, [x])));
  def('List.Zip', ls => { const lists = needList(ls, 'List.Zip'); const n = Math.max(0, ...lists.map(x => x.length)); return Array.from({ length: n }, (_, i) => lists.map(x => i < x.length ? x[i] : null)); });
  // Number
  def('Number.From', v => { if (v === null) return null; if (isNum(v)) return v; if (typeof v === 'boolean') return v ? 1 : 0;
    if (isText(v)) { if (!/^\s*[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?\s*$/.test(v)) throw new MError(`DataFormat.Error: We couldn't convert to Number. Details: ${v}`); return Number(v); }
    throw new MError('Number.From unsupported ' + typeName(v)); });
  def('Number.FromText', (t) => { if (t === null) return null; if (!/^\s*[-+]?[0-9]*\.?[0-9]+\s*$/.test(t)) throw new MError('DataFormat.Error: ' + t); return Number(t); });
  def('Number.Mod', (a, b) => a === null ? null : a % b);
  def('Number.RoundDown', v => v === null ? null : Math.floor(needNum(v, 'Number.RoundDown')));
  def('Number.ToText', (n, fmt) => { needNum(n, 'Number.ToText'); const m = /^F(\d+)$/.exec(fmt || ''); if (m) return n.toFixed(Number(m[1])); return String(n); });
  // Record
  def('Record.Field', (r, f) => { if (!isRecord(r)) throw new MError('Record.Field: expected record, got ' + typeName(r)); return r.get(needText(f, 'Record.Field')); });
  def('Record.FieldOrDefault', (r, f, d) => { if (!isRecord(r)) throw new MError('Record.FieldOrDefault: expected record'); return r.has(f) ? r.get(f) : (d === undefined ? null : d); });
  def('Record.HasFields', (r, f) => { if (!isRecord(r)) throw new MError('Record.HasFields: expected record'); return isList(f) ? f.every(x => r.has(x)) : r.has(needText(f, 'Record.HasFields')); });
  def('Record.FromList', (vals, names) => { needList(vals, 'Record.FromList'); needList(names, 'Record.FromList');
    if (vals.length !== names.length) throw new MError('Record.FromList: length mismatch'); const r = new MRecord();
    names.forEach((n, i) => { if (r.has(needText(n, 'Record.FromList name'))) throw new MError(`Record.FromList: duplicate field '${n}'`); r.setValue(n, vals[i]); }); return r; });
  // Table
  def('Table.AddColumn', (t, name, f) => { needTable(t, 'Table.AddColumn'); if (t.columns.includes(name)) throw new MError('column exists ' + name);
    return new MTable(t.columns.concat([name]), t.rows.map((row, i) => row.concat([call(f, [t.record(i)])]))); });
  def('Table.AddIndexColumn', (t, name, start, step) => { needTable(t, 'Table.AddIndexColumn');
    return new MTable(t.columns.concat([name]), t.rows.map((row, i) => row.concat([(start || 0) + i * (step === undefined ? 1 : step)]))); });
  def('Table.Combine', ts => { const tabs = needList(ts, 'Table.Combine').map(x => needTable(x, 'Table.Combine'));
    const cols = []; tabs.forEach(t => t.columns.forEach(c => { if (!cols.includes(c)) cols.push(c); }));
    return new MTable(cols, [].concat(...tabs.map(t => t.rows.map(r => cols.map(c => { const j = t.columns.indexOf(c); return j < 0 ? null : r[j]; }))))); });
  def('Table.First', (t, d) => needTable(t, 'Table.First').rows.length ? t.record(0) : (d === undefined ? null : d));
  def('Table.FromRecords', (recs, cols) => { needList(recs, 'Table.FromRecords'); recs.forEach(r => { if (!isRecord(r)) throw new MError('Table.FromRecords: not a record'); });
    if (cols !== undefined && cols !== null) { recs.forEach(r => { if (r.names.length !== cols.length || !cols.every(c => r.has(c))) throw new MError('Table.FromRecords: record fields do not match columns ' + r.names.join(',')); }); }
    return MTable.fromRecords(recs, cols === undefined || cols === null ? undefined : cols); });
  def('Table.Group', (t, keys, aggs) => { needTable(t, 'Table.Group'); const ks = isText(keys) ? [keys] : keys;
    const aggList = isList(aggs[0]) ? aggs : [aggs]; const groups = [];
    t.rows.forEach(row => { const kv = ks.map(k => row[t.columns.indexOf(k)]);
      let g = groups.find(x => x.kv.every((v, i) => mEquals(v, kv[i]))); if (!g) { g = { kv, rows: [] }; groups.push(g); } g.rows.push(row); });
    return new MTable(ks.concat(aggList.map(a => a[0])), groups.map(g => g.kv.concat(aggList.map(a => call(a[1], [new MTable(t.columns, g.rows)]))))); });
  def('Table.RemoveColumns', (t, cols) => { needTable(t, 'Table.RemoveColumns'); const c = isText(cols) ? [cols] : cols;
    c.forEach(x => { if (!t.columns.includes(x)) throw new MError(`The column '${x}' of the table wasn't found.`); });
    const keep = t.columns.map((x, i) => [x, i]).filter(([x]) => !c.includes(x)); return new MTable(keep.map(k => k[0]), t.rows.map(r => keep.map(k => r[k[1]]))); });
  def('Table.SelectRows', (t, f) => { needTable(t, 'Table.SelectRows'); return new MTable(t.columns, t.rows.filter((r, i) => { const v = call(f, [t.record(i)]); if (typeof v !== 'boolean') throw new MError('Table.SelectRows predicate returned ' + typeName(v)); return v; })); });
  def('Table.Sort', (t, crit) => { needTable(t, 'Table.Sort'); const cs = sortCriteria(crit).map(([c, o]) => { const j = t.columns.indexOf(c); if (j < 0) throw new MError(`The column '${c}' of the table wasn't found.`); return [j, o]; });
    const rows = t.rows.map((r, i) => [r, i]); rows.sort((a, b) => { for (const [j, o] of cs) { const c = mCompare(a[0][j], b[0][j]); if (c) return o === 1 ? -c : c; } return a[1] - b[1]; });
    return new MTable(t.columns, rows.map(x => x[0])); });
  def('Table.ToRecords', t => needTable(t, 'Table.ToRecords').records());
  def('Table.TransformColumns', (t, ops) => { needTable(t, 'Table.TransformColumns'); const list = isText(ops[0]) ? [ops] : ops;
    const rows = t.rows.map(r => r.slice()); list.forEach(([c, f]) => { const j = t.columns.indexOf(c); if (j < 0) throw new MError(`The column '${c}' of the table wasn't found.`); rows.forEach(r => { r[j] = call(f, [r[j]]); }); });
    return new MTable(t.columns, rows); });
  def('Table.TransformColumnTypes', (t, ops) => { needTable(t, 'Table.TransformColumnTypes'); const list = isText(ops[0]) ? [ops] : ops;
    const rows = t.rows.map(r => r.slice()); list.forEach(([c, ty]) => { const j = t.columns.indexOf(c); if (j < 0) throw new MError(`The column '${c}' of the table wasn't found.`);
      rows.forEach(r => { const v = r[j]; if (v === null) return;
        if (ty.name === 'text') r[j] = isText(v) ? v : isNum(v) ? String(v) : (() => { throw new MError('cannot convert to text'); })();
        else if (ty.name === 'number') { if (!isNum(v)) { if (isText(v) && /^-?\d+(\.\d+)?$/.test(v.trim())) r[j] = Number(v); else throw new MError(`DataFormat.Error converting '${v}' to number`); } if (ty.int && !Number.isInteger(r[j])) r[j] = Math.round(r[j]); } }); });
    return new MTable(t.columns, rows); });
  // Date
  def('Date.From', v => { if (v === null) return null; if (v instanceof MDate) return v; if (v instanceof MDateTime) return new MDate(v.y, v.m, v.d);
    if (isNum(v)) return oleToDate(v); throw new MError('Date.From unsupported ' + typeName(v)); });
  def('Date.ToText', (d, opts) => { if (d === null) return null; if (!(d instanceof MDate)) throw new MError('Date.ToText expects date, got ' + typeName(d));
    const fmt = isRecord(opts) ? opts.get('Format') : opts; if (fmt !== 'yyyy-MM-dd') throw new MError('format unsupported in test interpreter: ' + fmt);
    return `${pad(d.y, 4)}-${pad(d.m, 2)}-${pad(d.d, 2)}`; });
  def('DateTime.LocalNow', () => ctx.now);
  def('#date', (y, m, d) => { [y, m, d].forEach(x => needNum(x, '#date')); if (!validDate(y, m, d)) throw new MError('Expression.Error: The Date operation failed'); return new MDate(y, m, d); });
  def('Character.ToNumber', c => needText(c, 'Character.ToNumber').charCodeAt(0));
  def('Value.Compare', (a, b) => mCompare(a, b));
  def('Excel.CurrentWorkbook', () => ctx.workbook);
  L['Order.Ascending'] = 0; L['Order.Descending'] = 1; L['RelativePosition.FromEnd'] = 1; L['RelativePosition.FromStart'] = 0;
  L['Int64.Type'] = Object.assign(new MType('number'), { int: true });
  return L;
}

// ----------------------------------------------------------------- evaluator
class Env {
  constructor(parent) { this.parent = parent; this.vars = new Map(); }
  lookup(name) {
    for (let e = this; e; e = e.parent) if (e.vars.has(name)) return e.vars.get(name)();
    throw new MError(`Expression.Error: The name '${name}' wasn't recognized. Make sure it's spelled correctly.`);
  }
  defineLazy(name, thunk) {
    let state = 0, value;
    this.vars.set(name, () => {
      if (state === 2) return value;
      if (state === 1) throw new MError(`Cyclic reference involving '${name}'`);
      state = 1;
      try { value = thunk(); state = 2; return value; } catch (e) { state = 0; throw e; }
    });
  }
}
const csv = w => (w && w.elements ? w.elements.map(c => c.node) : []);
const BIN = new Set(['ArithmeticExpression', 'EqualityExpression', 'RelationalExpression', 'LogicalExpression', 'IsExpression']);

function primitive(node) {
  // PrimitiveType | NullablePrimitiveType | AsNullablePrimitiveType | TypePrimaryType
  if (!node) return { t: 'any', nullable: true };
  if (node.kind === 'AsNullablePrimitiveType') return primitive(node.paired);
  if (node.kind === 'NullablePrimitiveType') return { t: primitive(node.paired).t, nullable: true };
  if (node.kind === 'PrimitiveType') return { t: node.primitiveTypeKind, nullable: false };
  if (node.kind === 'TypePrimaryType') return primitive(node.paired);
  throw new Error('type node ' + node.kind);
}

function ev(node, env) {
  switch (node.kind) {
    case 'LiteralExpression':
      switch (node.literalKind) {
        case 'Numeric': return Number(node.literal);
        case 'Text': return decodeText(node.literal);
        case 'Null': return null;
        case 'Logical': return node.literal === 'true';
      }
      throw new Error('literal ' + node.literalKind);
    case 'IdentifierExpression': return env.lookup(node.identifier.literal);
    case 'ParenthesizedExpression': return ev(node.content, env);
    case 'LetExpression': {
      const e = new Env(env);
      for (const p of csv(node.variableList)) { const v = p.value; e.defineLazy(p.key.literal, () => ev(v, e)); }
      return ev(node.expression, e);
    }
    case 'RecordExpression': {
      const r = new MRecord(); const e = new Env(env);
      for (const p of csv(node.content)) {
        const name = p.key.literal, v = p.value;
        e.defineLazy(name, () => r.get(name));
        r.setThunk(name, () => ev(v, e));
      }
      return r;
    }
    case 'ListExpression': {
      const out = [];
      for (const item of csv(node.content)) {
        if (item.kind === 'RangeExpression') {
          const a = ev(item.left, env), b = ev(item.right, env);
          if (isNum(a) && isNum(b)) { for (let i = a; i <= b; i++) out.push(i); }
          else if (isText(a) && isText(b) && a.length === 1 && b.length === 1) { for (let c = a.charCodeAt(0); c <= b.charCodeAt(0); c++) out.push(String.fromCharCode(c)); }
          else throw new MError('bad range');
        } else out.push(ev(item, env));
      }
      return out;
    }
    case 'IfExpression': {
      const c = ev(node.condition, env);
      if (typeof c !== 'boolean') throw new MError('Expression.Error: if condition is ' + typeName(c) + ', expected logical');
      return c ? ev(node.trueExpression, env) : ev(node.falseExpression, env);
    }
    case 'ErrorHandlingExpression': {
      try { return ev(node.protectedExpression, env); }
      catch (e) { if (!e.isM) throw e; if (!node.handler) throw new Error('try without otherwise unsupported'); return ev(node.handler.paired, env); }
    }
    case 'EachExpression': {
      const body = node.paired;
      return new MFunction(args => { const e = new Env(env); e.vars.set('_', () => args[0]); return ev(body, e); }, 'each');
    }
    case 'FunctionExpression': {
      const params = csv(node.parameters.content).map(p => ({ name: p.name.literal, optional: !!p.optionalConstant, ...primitive(p.parameterType) }));
      const ret = node.functionReturnType ? primitive(node.functionReturnType) : { t: 'any', nullable: true };
      const body = node.expression;
      return new MFunction(args => {
        const required = params.filter(p => !p.optional).length;
        if (args.length < required || args.length > params.length) throw new MError(`Expression.Error: function expects ${required}-${params.length} arguments, got ${args.length}`);
        const e = new Env(env);
        params.forEach((p, i) => { const v = i < args.length ? args[i] : null; assertType(v, p.t, p.nullable || p.optional, 'parameter ' + p.name); e.vars.set(p.name, () => v); });
        const out = ev(body, e);
        return assertType(out, ret.t, ret.nullable, 'return value');
      });
    }
    case 'TypePrimaryType': { const p = primitive(node.paired); return new MType(p.t, p.nullable); }
    case 'UnaryExpression': {
      let v = ev(node.typeExpression, env);
      for (const op of [...node.operators.elements].reverse()) {
        const k = op.constantKind;
        if (k === 'not') { if (typeof v !== 'boolean') throw new MError('not on ' + typeName(v)); v = !v; }
        else if (k === '-') v = v === null ? null : -needNum(v, 'unary -');
        else if (k === '+') v = v;
        else throw new Error('unary ' + k);
      }
      return v;
    }
    case 'FieldSelector': // implicit [Field] inside each
      return fieldSelect(env.lookup('_'), node);
    case 'RecursivePrimaryExpression': {
      let v = ev(node.head, env);
      for (const r of node.recursiveExpressions.elements) {
        if (r.kind === 'InvokeExpression') v = call(v, csv(r.content).map(a => ev(a, env)));
        else if (r.kind === 'ItemAccessExpression') v = itemAccess(v, ev(r.content, env), !!r.optionalConstant);
        else if (r.kind === 'FieldSelector') v = fieldSelect(v, r);
        else throw new Error('recursive ' + r.kind);
      }
      return v;
    }
    default:
      if (BIN.has(node.kind)) return binary(node, env);
      throw new Error('Unsupported node ' + node.kind);
  }
}
function fieldSelect(v, node) {
  const name = node.content.literal, opt = !!node.optionalConstant;
  if (isRecord(v)) { if (!v.has(name) && opt) return null; return v.get(name); }
  if (isTable(v)) { const j = v.columns.indexOf(name); if (j < 0) { if (opt) return null; throw new MError(`The column '${name}' of the table wasn't found.`); } return v.rows.map(r => r[j]); }
  if (v === null && opt) return null;
  throw new MError(`Expression.Error: We cannot apply field access to the type ${typeName(v)}.`);
}
function itemAccess(v, key, opt) {
  if (isList(v)) { needNum(key, 'item access'); if (key < 0 || key >= v.length) { if (opt) return null; throw new MError('Expression.Error: There weren\'t enough elements in the enumeration to complete the operation.'); } return v[key]; }
  if (isTable(v)) {
    if (isNum(key)) { if (key >= v.rows.length) throw new MError('row index'); return v.record(key); }
    if (isRecord(key)) {
      const hits = v.records().filter(r => key.names.every(n => r.has(n) && mEquals(r.get(n), key.get(n))));
      if (hits.length !== 1) { if (opt && hits.length === 0) return null; throw new MError(`Expression.Error: The key ${hits.length ? 'matched more than one row' : "didn't match any rows"} in the table.`); }
      return hits[0];
    }
  }
  throw new MError('item access on ' + typeName(v));
}
function binary(node, env) {
  const op = node.operatorConstant.constantKind;
  if (node.kind === 'LogicalExpression') {
    const a = ev(node.left, env);
    if (typeof a !== 'boolean') throw new MError(`Expression.Error: ${op} applied to ${typeName(a)}`);
    if (op === 'and' && !a) return false; if (op === 'or' && a) return true;
    const b = ev(node.right, env); if (typeof b !== 'boolean') throw new MError(`Expression.Error: ${op} applied to ${typeName(b)}`);
    return b;
  }
  if (node.kind === 'IsExpression') { const a = ev(node.left, env); const t = primitive(node.right); return a === null ? (t.nullable || t.t === 'null' || t.t === 'any') : conforms(a, t.t); }
  const a = ev(node.left, env), b = ev(node.right, env);
  if (node.kind === 'EqualityExpression') return op === '=' ? mEquals(a, b) : !mEquals(a, b);
  if (node.kind === 'RelationalExpression') {
    if (a === null || b === null) return null;
    const c = mCompare(a, b);
    return op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0;
  }
  // arithmetic & concatenation
  if (op === '&') {
    if (a === null || b === null) return null;
    if (isText(a) && isText(b)) return a + b;
    if (isList(a) && isList(b)) return a.concat(b);
    if (isRecord(a) && isRecord(b)) { const r = new MRecord(); a.names.forEach(n => r.setThunk(n, () => a.get(n))); b.names.forEach(n => { if (r.has(n)) { r.thunks.set(n, () => b.get(n)); } else r.setThunk(n, () => b.get(n)); }); return r; }
    throw new MError(`Expression.Error: We cannot apply operator & to types ${typeName(a)} and ${typeName(b)}.`);
  }
  if (a === null || b === null) return null;
  needNum(a, 'arith ' + op); needNum(b, 'arith ' + op);
  switch (op) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; }
  throw new Error('op ' + op);
}

async function evaluateSection(sectionText, ctx) {
  const res = await PQP.TaskUtils.tryLexParse(PQP.DefaultSettings, sectionText);
  if (!PQP.TaskUtils.isParseStageOk(res)) throw new Error('parse failed: ' + res.error.message);
  const lib = makeLibrary(ctx);
  const root = new Env(null);
  for (const k of Object.keys(lib)) { const v = lib[k]; root.vars.set(k, () => v); }
  const env = new Env(root);
  for (const m of res.ast.sectionMembers.elements) {
    const p = m.namePairedExpression; env.defineLazy(p.key.literal, () => ev(p.value, env));
  }
  return name => env.lookup(name);
}

module.exports = { evaluateSection, MTable, MRecord, MDate, MDateTime, MError };
