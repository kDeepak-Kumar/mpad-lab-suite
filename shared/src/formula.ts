/**
 * Excel-style formula engine.
 *
 * Supports the syntax lab staff already know from Excel:
 *   numbers, "strings", TRUE/FALSE, + - * / ^ &, = <> < > <= >=, function calls.
 * Variables are names (e.g. `prc`, `load_kgcm2`) or grid columns (`readings.pen`, an array).
 *
 * Blank inputs are `null`. As in Excel, `x = ""` is TRUE when x is blank,
 * and blanks count as 0 in arithmetic.
 */

export type FormulaError = { error: string };
export type Value = number | string | boolean | null | FormulaError | Value[];

export const isError = (v: unknown): v is FormulaError =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && 'error' in (v as object);

const err = (e: string): FormulaError => ({ error: e });
export const NA = err('#N/A');

type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'var'; name: string }
  | { t: 'call'; name: string; args: Node[] }
  | { t: 'un'; op: string; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node };

type Tok = { k: 'num' | 'str' | 'id' | 'op' | '(' | ')' | ',' ; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const s = src.trim().replace(/^=/, '');
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      if (s[j] === 'e' || s[j] === 'E') {
        j++;
        if (s[j] === '+' || s[j] === '-') j++;
        while (j < s.length && /[0-9]/.test(s[j])) j++;
      }
      out.push({ k: 'num', v: s.slice(i, j) }); i = j; continue;
    }
    if (c === '"') {
      let j = i + 1, v = '';
      while (j < s.length) {
        if (s[j] === '"' && s[j + 1] === '"') { v += '"'; j += 2; continue; }
        if (s[j] === '"') break;
        v += s[j++];
      }
      out.push({ k: 'str', v }); i = j + 1; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_.$]/.test(s[j])) j++;
      out.push({ k: 'id', v: s.slice(i, j) }); i = j; continue;
    }
    const two = s.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') { out.push({ k: 'op', v: two }); i += 2; continue; }
    if ('+-*/^&=<>'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
    if (c === '(' || c === ')' || c === ',') { out.push({ k: c, v: c }); i++; continue; }
    if (c === ';') { out.push({ k: ',', v: ',' }); i++; continue; }
    throw new Error(`Unexpected character "${c}" in formula`);
  }
  return out;
}

const PREC: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };

export function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];

  function primary(): Node {
    const t = next();
    if (!t) throw new Error('Formula ended unexpectedly');
    if (t.k === 'num') return { t: 'num', v: parseFloat(t.v) };
    if (t.k === 'str') return { t: 'str', v: t.v };
    if (t.k === 'op' && (t.v === '-' || t.v === '+')) return { t: 'un', op: t.v, a: primary() };
    if (t.k === '(') { const e = expr(0); if (next()?.k !== ')') throw new Error('Missing )'); return e; }
    if (t.k === 'id') {
      const up = t.v.toUpperCase();
      if (up === 'TRUE' || up === 'FALSE') return { t: 'bool', v: up === 'TRUE' };
      if (peek()?.k === '(') {
        next();
        const args: Node[] = [];
        if (peek()?.k !== ')') {
          for (;;) { args.push(expr(0)); if (peek()?.k === ',') { next(); continue; } break; }
        }
        if (next()?.k !== ')') throw new Error(`Missing ) after ${t.v}(`);
        return { t: 'call', name: up, args };
      }
      return { t: 'var', name: t.v };
    }
    throw new Error(`Unexpected "${t.v}"`);
  }

  function expr(min: number): Node {
    let left = primary();
    for (;;) {
      const t = peek();
      if (!t || t.k !== 'op') break;
      const pr = PREC[t.v];
      if (pr === undefined || pr < min) break;
      next();
      const right = expr(t.v === '^' ? pr : pr + 1);
      left = { t: 'bin', op: t.v, a: left, b: right };
    }
    return left;
  }

  const n = expr(0);
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}"`);
  return n;
}

export type Scope = (name: string) => Value | undefined;

const blank = (v: Value) => v === null || v === '';
function num(v: Value): number | FormulaError {
  if (isError(v)) return v;
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    if (v.trim() === '') return err('#VALUE!');
    const n = Number(v);
    return isNaN(n) ? err('#VALUE!') : n;
  }
  return err('#VALUE!');
}
const flat = (vals: Value[]): Value[] => vals.flatMap((v) => (Array.isArray(v) ? flat(v) : [v]));
const nums = (vals: Value[]) => flat(vals).filter((v): v is number => typeof v === 'number');
function firstErr(vals: Value[]): FormulaError | undefined { return flat(vals).find(isError) as FormulaError | undefined; }
const roundTo = (x: number, d: number) => { const f = Math.pow(10, d); return Math.round((x + Number.EPSILON * Math.sign(x)) * f) / f; };

function compare(a: Value, b: Value): number {
  if (blank(a) && blank(b)) return 0;
  const an = blank(a) ? (typeof b === 'string' ? '' : 0) : a;
  const bn = blank(b) ? (typeof a === 'string' ? '' : 0) : b;
  if (typeof an === 'number' && typeof bn === 'number') return an - bn;
  if (typeof an === 'string' && typeof bn === 'string') return an.toLowerCase().localeCompare(bn.toLowerCase());
  if (typeof an === 'boolean' && typeof bn === 'boolean') return Number(an) - Number(bn);
  // Excel order: numbers < text < booleans
  const rank = (v: unknown) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
  return rank(an) - rank(bn);
}

function match(v: Value, arr: Value, type: number): Value {
  if (!Array.isArray(arr)) return NA;
  const list = flat(arr);
  if (type === 0) {
    for (let i = 0; i < list.length; i++) {
      const x = list[i];
      if (typeof x === 'number' && typeof v === 'number' ? Math.abs(x - v) < 1e-9 : !isError(x) && !blank(x) && compare(x, v) === 0) return i + 1;
    }
    return NA;
  }
  // approximate match on ascending list: largest value <= v
  let best = -1;
  for (let i = 0; i < list.length; i++) { const x = list[i]; if (!isError(x) && !blank(x) && compare(x, v) <= 0) best = i; }
  return best < 0 ? NA : best + 1;
}

/** Linear interpolation of y at x over paired lists (ascending xs). */
function interp(x: number, xs: Value[], ys: Value[]): Value {
  const pts: [number, number][] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (typeof xs[i] === 'number' && typeof ys[i] === 'number') pts.push([xs[i] as number, ys[i] as number]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  if (pts.length === 0) return NA;
  for (let i = 0; i < pts.length; i++) {
    if (Math.abs(pts[i][0] - x) < 1e-9) return pts[i][1];
    if (i > 0 && pts[i - 1][0] < x && x < pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return NA;
}

function pairs(ys: Value, xs: Value): [number, number][] {
  const a = Array.isArray(xs) ? flat(xs) : [], b = Array.isArray(ys) ? flat(ys) : [];
  const out: [number, number][] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (typeof a[i] === 'number' && typeof b[i] === 'number') out.push([a[i] as number, b[i] as number]);
  return out;
}
function regress(ys: Value, xs: Value, what: 'slope' | 'intercept' | 'rsq'): Value {
  const p = pairs(ys, xs);
  if (p.length < 2) return err('#DIV/0!');
  const n = p.length, mx = p.reduce((s, q) => s + q[0], 0) / n, my = p.reduce((s, q) => s + q[1], 0) / n;
  const sxx = p.reduce((s, q) => s + (q[0] - mx) ** 2, 0), sxy = p.reduce((s, q) => s + (q[0] - mx) * (q[1] - my), 0), syy = p.reduce((s, q) => s + (q[1] - my) ** 2, 0);
  if (sxx === 0) return err('#DIV/0!');
  const slope = sxy / sxx;
  return what === 'slope' ? slope : what === 'intercept' ? my - slope * mx : syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
}
function peak(xs: Value, ys: Value, what: 'x' | 'y'): Value {
  const p = pairs(ys, xs).sort((a, b) => a[0] - b[0]);
  if (!p.length) return NA;
  let i = 0; p.forEach((q, j) => { if (q[1] > p[i][1]) i = j; });
  if (i === 0 || i === p.length - 1) return what === 'x' ? p[i][0] : p[i][1];
  const [[x0, y0], [x1, y1], [x2, y2]] = [p[i - 1], p[i], p[i + 1]];
  const den = (x0 - x1) * (x0 - x2) * (x1 - x2);
  const A = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / den;
  const B = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / den;
  const C = (x1 * x2 * (x1 - x2) * y0 + x2 * x0 * (x2 - x0) * y1 + x0 * x1 * (x0 - x1) * y2) / den;
  if (A >= 0) return what === 'x' ? x1 : y1;
  const xv = -B / (2 * A);
  return what === 'x' ? xv : A * xv * xv + B * xv + C;
}

type Fn = (args: Value[]) => Value;
const FNS: Record<string, Fn> = {
  ABS: ([a]) => { const n = num(a); return isError(n) ? n : Math.abs(n); },
  SQRT: ([a]) => { const n = num(a); return isError(n) ? n : n < 0 ? err('#NUM!') : Math.sqrt(n); },
  POWER: ([a, b]) => { const x = num(a), y = num(b); return isError(x) ? x : isError(y) ? y : Math.pow(x, y); },
  EXP: ([a]) => { const n = num(a); return isError(n) ? n : Math.exp(n); },
  LN: ([a]) => { const n = num(a); return isError(n) ? n : n <= 0 ? err('#NUM!') : Math.log(n); },
  LOG10: ([a]) => { const n = num(a); return isError(n) ? n : n <= 0 ? err('#NUM!') : Math.log10(n); },
  PI: () => Math.PI,
  ROUND: ([a, d]) => { const n = num(a), k = num(d ?? 0); return isError(n) ? n : isError(k) ? k : roundTo(n, k); },
  ROUNDUP: ([a, d]) => { const n = num(a), k = num(d ?? 0); if (isError(n)) return n; if (isError(k)) return k; const f = 10 ** k; return (Math.sign(n) * Math.ceil(Math.abs(n) * f - 1e-9)) / f; },
  ROUNDDOWN: ([a, d]) => { const n = num(a), k = num(d ?? 0); if (isError(n)) return n; if (isError(k)) return k; const f = 10 ** k; return (Math.sign(n) * Math.floor(Math.abs(n) * f + 1e-9)) / f; },
  INT: ([a]) => { const n = num(a); return isError(n) ? n : Math.floor(n); },
  MOD: ([a, b]) => { const x = num(a), y = num(b); if (isError(x)) return x; if (isError(y)) return y; return y === 0 ? err('#DIV/0!') : x - y * Math.floor(x / y); },
  SUM: (args) => firstErr(args) ?? nums(args).reduce((s, x) => s + x, 0),
  COUNT: (args) => nums(args).length,
  COUNTA: (args) => flat(args).filter((v) => !blank(v)).length,
  AVERAGE: (args) => { const e = firstErr(args); if (e) return e; const n = nums(args); return n.length ? n.reduce((s, x) => s + x, 0) / n.length : err('#DIV/0!'); },
  MIN: (args) => { const e = firstErr(args); if (e) return e; const n = nums(args); return n.length ? Math.min(...n) : 0; },
  MAX: (args) => { const e = firstErr(args); if (e) return e; const n = nums(args); return n.length ? Math.max(...n) : 0; },
  AND: (args) => { const e = firstErr(args); if (e) return e; return flat(args).every((v) => Boolean(v)); },
  OR: (args) => { const e = firstErr(args); if (e) return e; return flat(args).some((v) => Boolean(v)); },
  NOT: ([a]) => (isError(a) ? a : !a),
  NA: () => NA,
  ISBLANK: ([a]) => blank(a ?? null),
  ISNUMBER: ([a]) => typeof a === 'number',
  ISERROR: ([a]) => isError(a),
  INDEX: ([arr, i]) => {
    if (isError(arr)) return arr;
    if (!Array.isArray(arr)) return err('#REF!');
    const k = num(i); if (isError(k)) return k;
    const list = flat(arr);
    return k >= 1 && k <= list.length ? (list[k - 1] ?? null) : err('#REF!');
  },
  MATCH: ([v, arr, t]) => { if (isError(v)) return v; const ty = num(t ?? 1); return isError(ty) ? ty : match(v, arr, ty); },
  /** LOOKUPX(value, xs, ys): exact-match lookup, like INDEX(ys, MATCH(value, xs, 0)). */
  LOOKUPX: ([v, xs, ys]) => {
    const m = match(v, xs, 0);
    if (isError(m)) return m;
    return Array.isArray(ys) ? (flat(ys)[(m as number) - 1] ?? null) : err('#REF!');
  },
  /** INTERP(x, xs, ys): linear interpolation, e.g. load at 2.5 mm penetration. */
  INTERP: ([x, xs, ys]) => { const n = num(x); if (isError(n)) return n; if (!Array.isArray(xs) || !Array.isArray(ys)) return err('#REF!'); return interp(n, flat(xs), flat(ys)); },
  MEDIAN: (args) => { const e = firstErr(args); if (e) return e; const n = nums(args).sort((a, b) => a - b); if (!n.length) return err('#NUM!'); const m = Math.floor(n.length / 2); return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2; },
  STDEV: (args) => { const e = firstErr(args); if (e) return e; const n = nums(args); if (n.length < 2) return err('#DIV/0!'); const mu = n.reduce((s, x) => s + x, 0) / n.length; return Math.sqrt(n.reduce((s, x) => s + (x - mu) ** 2, 0) / (n.length - 1)); },
  LARGE: ([arr, k]) => { const n = nums([arr]).sort((a, b) => b - a); const i = num(k); return isError(i) ? i : i >= 1 && i <= n.length ? n[i - 1] : err('#NUM!'); },
  SMALL: ([arr, k]) => { const n = nums([arr]).sort((a, b) => a - b); const i = num(k); return isError(i) ? i : i >= 1 && i <= n.length ? n[i - 1] : err('#NUM!'); },
  /** SUMTO(list, n): sum of the first n items, e.g. cumulative mass retained up to this sieve. */
  SUMTO: ([arr, k]) => { if (!Array.isArray(arr)) return err('#REF!'); const i = num(k); if (isError(i)) return i; return nums(flat(arr).slice(0, Math.max(0, i))).reduce((s, x) => s + x, 0); },
  COUNTIF: ([arr, crit]) => {
    const list = Array.isArray(arr) ? flat(arr) : [arr];
    const m = typeof crit === 'string' ? /^(<=|>=|<>|<|>|=)?(.*)$/.exec(crit) : null;
    const op = m?.[1] ?? '=', rhsRaw = m ? m[2] : crit;
    const rhs: Value = typeof rhsRaw === 'string' && rhsRaw.trim() !== '' && !isNaN(Number(rhsRaw)) ? Number(rhsRaw) : rhsRaw as Value;
    return list.filter((v) => { if (blank(v) || isError(v)) return false; const c = compare(v, rhs); return op === '=' ? c === 0 : op === '<>' ? c !== 0 : op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0; }).length;
  },
  SLOPE: ([ys, xs]) => regress(ys, xs, 'slope'),
  INTERCEPT: ([ys, xs]) => regress(ys, xs, 'intercept'),
  RSQ: ([ys, xs]) => regress(ys, xs, 'rsq'),
  /** FORECAST(x, ys, xs): value on the least-squares straight line, e.g. LL at 25 blows. */
  FORECAST: ([x, ys, xs]) => { const a = regress(ys, xs, 'slope'), b = regress(ys, xs, 'intercept'), n = num(x); if (isError(a)) return a; if (isError(b)) return b; if (isError(n)) return n; return (b as number) + (a as number) * n; },
  /** PEAKX/PEAKY(xs, ys): vertex of the parabola through the highest point and its neighbours (compaction curve). */
  PEAKX: ([xs, ys]) => peak(xs, ys, 'x'),
  PEAKY: ([xs, ys]) => peak(xs, ys, 'y'),
  SIN: ([a]) => { const n = num(a); return isError(n) ? n : Math.sin(n); },
  COS: ([a]) => { const n = num(a); return isError(n) ? n : Math.cos(n); },
  TAN: ([a]) => { const n = num(a); return isError(n) ? n : Math.tan(n); },
  ATAN: ([a]) => { const n = num(a); return isError(n) ? n : Math.atan(n); },
  DEGREES: ([a]) => { const n = num(a); return isError(n) ? n : (n * 180) / Math.PI; },
  RADIANS: ([a]) => { const n = num(a); return isError(n) ? n : (n * Math.PI) / 180; },
  /** MROUND(x, 0.5): round to the nearest multiple, e.g. strength to 0.5 N/mm². */
  MROUND: ([a, m]) => { const x = num(a), k = num(m); if (isError(x)) return x; if (isError(k)) return k; return k === 0 ? 0 : roundTo(Math.round(x / k + 1e-9 * Math.sign(x)) * k, 6); },
  FIXED: ([a, d]) => { const x = num(a), k = num(d ?? 2); if (isError(x)) return x; if (isError(k)) return k; return roundTo(x, k).toFixed(Math.max(0, k)); },
  /** MINUTES("10:45") = 645; numbers pass through. Use the difference of two clock times for setting time. */
  MINUTES: ([a]) => {
    if (typeof a === 'number') return a;
    if (blank(a ?? null)) return null;
    const m = /^(\d{1,2})[:.](\d{2})(?:\s*([AaPp])[Mm])?$/.exec(String(a).trim());
    if (!m) return err('#VALUE!');
    let h = Number(m[1]); const ap = m[3]?.toLowerCase();
    if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0;
    return h * 60 + Number(m[2]);
  },
  LEFT: ([a, n]) => { const k = num(n ?? 1); return isError(k) ? k : String(a ?? '').slice(0, Math.max(0, k)); },
  RIGHT: ([a, n]) => { const k = num(n ?? 1); return isError(k) ? k : k <= 0 ? '' : String(a ?? '').slice(-k); },
  LEN: ([a]) => String(a ?? '').length,
  UPPER: ([a]) => String(a ?? '').toUpperCase(),
  CONCAT: (args) => flat(args).map((v) => (v === null ? '' : String(v))).join(''),
};

function evalNode(n: Node, scope: Scope): Value {
  switch (n.t) {
    case 'num': return n.v;
    case 'str': return n.v;
    case 'bool': return n.v;
    case 'var': {
      const v = scope(n.name);
      return v === undefined ? err('#NAME?') : v;
    }
    case 'un': {
      const a = num(evalNode(n.a, scope));
      return isError(a) ? a : n.op === '-' ? -a : a;
    }
    case 'bin': {
      const a = evalNode(n.a, scope), b = evalNode(n.b, scope);
      if (isError(a)) return a;
      if (isError(b)) return b;
      if (n.op === '&') return `${a ?? ''}${b ?? ''}`;
      if (['=', '<>', '<', '>', '<=', '>='].includes(n.op)) {
        const c = compare(a, b);
        return n.op === '=' ? c === 0 : n.op === '<>' ? c !== 0 : n.op === '<' ? c < 0 : n.op === '>' ? c > 0 : n.op === '<=' ? c <= 0 : c >= 0;
      }
      const x = num(a), y = num(b);
      if (isError(x)) return x;
      if (isError(y)) return y;
      switch (n.op) {
        case '+': return x + y;
        case '-': return x - y;
        case '*': return x * y;
        case '/': return y === 0 ? err('#DIV/0!') : x / y;
        case '^': return Math.pow(x, y);
      }
      return err('#VALUE!');
    }
    case 'call': {
      // Lazy special forms
      if (n.name === 'IF') {
        const c = evalNode(n.args[0], scope);
        if (isError(c)) return c;
        const truthy = typeof c === 'string' ? c !== '' : Boolean(c);
        const branch = truthy ? n.args[1] : n.args[2];
        return branch ? evalNode(branch, scope) : truthy;
      }
      if (n.name === 'IFERROR' || n.name === 'IFNA') {
        const v = evalNode(n.args[0], scope);
        const hit = n.name === 'IFERROR' ? isError(v) : isError(v) && v.error === '#N/A';
        return hit ? evalNode(n.args[1], scope) : v;
      }
      if (n.name === 'ROW') { const r = scope('_row'); return r === undefined ? err('#REF!') : r; }
      const fn = FNS[n.name];
      if (!fn) return err('#NAME?');
      return fn(n.args.map((a) => evalNode(a, scope)));
    }
  }
}

const cache = new Map<string, Node>();
export function compile(src: string): Node {
  let n = cache.get(src);
  if (!n) { n = parse(src); cache.set(src, n); }
  return n;
}

/** Evaluate a formula. Parse errors become a #SYNTAX error value instead of throwing. */
export function evaluate(src: string, scope: Scope | Record<string, Value>): Value {
  const fn: Scope = typeof scope === 'function' ? scope : (k) => (k in scope ? (scope as Record<string, Value>)[k] : undefined);
  try {
    return evalNode(compile(src), fn);
  } catch (e) {
    return err('#SYNTAX!');
  }
}

/** Names referenced by a formula (for dependency checks and the template editor). */
export function references(src: string): string[] {
  const out = new Set<string>();
  const walk = (n: Node) => {
    if (n.t === 'var') out.add(n.name);
    if (n.t === 'call') n.args.forEach(walk);
    if (n.t === 'un') walk(n.a);
    if (n.t === 'bin') { walk(n.a); walk(n.b); }
  };
  try { walk(compile(src)); } catch { /* ignore */ }
  return [...out];
}

export const FUNCTION_NAMES = ['IF', 'IFERROR', 'IFNA', 'ROW', ...Object.keys(FNS)];
