/**
 * Editable report layout: the body of a test report as an ordered list of sections (tables and text),
 * stored on the report itself. Report formats generate it from the report data; the user then edits it
 * like a word processor. Templates, client master and observation data are never changed by these edits.
 *
 * Tables are kept as a full grid: every row has one cell per column; a merged cell is an anchor with
 * rs / cs > 1 and the cells it covers are marked `m` (they hold no content). This keeps row / column
 * insertion, deletion, merge and split simple and safe.
 */

export type Align = 'left' | 'center' | 'right' | 'justify';
export interface Cell {
  /** Rich text (limited, sanitised HTML). May contain tokens such as {{number}}. */
  h: string;
  cs?: number; rs?: number;
  /** Covered by a merged cell. */
  m?: boolean;
  al?: Align; va?: 'top' | 'middle' | 'bottom';
  b?: boolean; sz?: number; bg?: string;
  /** Content generated from data (customer, additional info…); can be refreshed from the source. */
  role?: string;
}
export interface TableSection {
  id: string; type: 'table';
  /** Relative column widths (percent, summing to ~100). */
  cols: number[];
  rows: Cell[][];
  /** Minimum row heights in mm (null = automatic). */
  rh?: (number | null)[];
  /** Leading heading rows (repeated when the table continues on the next page). */
  head?: number;
  border?: 'all' | 'outer' | 'none' | 'inner';
  /** Table width as % of the text width, and its position. */
  width?: number; align?: 'left' | 'center' | 'right';
  /** Font size (pt), cell padding (px), space before (mm). */
  sz?: number; pad?: number; mt?: number;
  role?: string;
}
export interface TextSection {
  id: string; type: 'text';
  h: string;
  al?: Align;
  sz?: number;
  /** Line height (multiple), space before / after (mm), left indent (mm). */
  lh?: number; mt?: number; mb?: number; indent?: number;
  /** Heading: kept with what follows it. */
  heading?: boolean;
  /** Text box: bordered, optional width (% of text width). */
  box?: boolean; width?: number;
  role?: string;
}
/** Generated content that is not edited as a table (graphs, borehole logs, detailed calculations). */
export interface AutoSection { id: string; type: 'auto'; what: 'details' | 'charts'; mt?: number; role?: string }
export type Section = TableSection | TextSection | AutoSection;
export interface ReportLayout { format: string; version: 1; sections: Section[]; edited?: boolean }

let seq = 0;
export const newId = (p = 's') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// ---------------------------------------------------------------- sanitising

const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 'sup', 'sub', 'br', 'span', 'div', 'p', 's']);
const STYLE_OK: Record<string, RegExp> = {
  'font-size': /^\d{1,2}(\.\d)?(pt|px)$/,
  'font-weight': /^(bold|normal|[1-9]00)$/,
  'font-style': /^(italic|normal)$/,
  'text-decoration': /^(underline|line-through|none)( solid)?$/,
  'text-decoration-line': /^(underline|line-through|none)$/,
  'font-family': /^[\w ,'"-]{1,80}$/,
  'text-align': /^(left|center|right|justify)$/,
  'line-height': /^\d(\.\d{1,2})?$/,
  'letter-spacing': /^\d(\.\d{1,2})?pt$/,
  color: /^(#[0-9a-f]{3,8}|rgb\(\d{1,3}, ?\d{1,3}, ?\d{1,3}\)|black|red|blue|green)$/i,
};
const escapeText = (s: string) => s.replace(/&(?!(#\d{1,6}|#x[0-9a-f]{1,6}|[a-z]{2,8});)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escapeHtml = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function cleanStyle(style: string): string {
  const out: string[] = [];
  for (const part of style.split(';')) {
    const i = part.indexOf(':'); if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase(), v = part.slice(i + 1).trim().replace(/\s*!important$/, '');
    if (STYLE_OK[k]?.test(v) && !/url\(|expression|javascript:/i.test(v)) out.push(`${k}: ${v}`);
  }
  return out.join('; ');
}

/**
 * Keep only simple formatting: bold, italic, underline, super/subscript, line breaks and a few inline styles.
 * Everything else (scripts, links, images, event handlers) is dropped or escaped. Works without a DOM.
 */
export function cleanHtml(input: unknown): string {
  const s = String(input ?? '');
  if (!s) return '';
  let out = '';
  const open: string[] = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|<!--[\s\S]*?-->/g;
  let last = 0, m: RegExpExecArray | null;
  let skipUntil: string | null = null;
  while ((m = re.exec(s))) {
    const text = s.slice(last, m.index); last = re.lastIndex;
    if (!skipUntil) out += escapeText(text);
    const tag = m[1]?.toLowerCase();
    const closing = m[0].startsWith('</');
    if (skipUntil) { if (closing && tag === skipUntil) skipUntil = null; continue; }
    if (!tag) continue; // comments, stray "<"
    if (['script', 'style', 'iframe', 'object', 'textarea', 'title', 'template', 'svg', 'math'].includes(tag)) { if (!closing && !m[0].endsWith('/>')) skipUntil = tag; continue; }
    const t = tag === 'strong' ? 'b' : tag === 'em' ? 'i' : tag === 'font' ? 'span' : tag;
    if (!ALLOWED.has(t) && tag !== 'font') continue;
    if (t === 'br') { out += '<br>'; continue; }
    if (closing) {
      const k = open.lastIndexOf(t);
      if (k < 0) continue;
      while (open.length > k) out += `</${open.pop()}>`;
      continue;
    }
    let attrs = '';
    const a = m[2] ?? '';
    const style = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(a);
    let st = style ? cleanStyle((style[2] ?? style[3] ?? '').replace(/&quot;/g, '"')) : '';
    if (tag === 'font') { const sz = /\ssize\s*=\s*"?(\d)/i.exec(a); if (sz) st = [st, `font-size: ${[0, 8, 10, 12, 14, 18, 24, 32][Number(sz[1])] ?? 12}pt`].filter(Boolean).join('; '); }
    if (st) attrs += ` style="${escapeHtml(st)}"`;
    const tok = /\sdata-token\s*=\s*"([a-zA-Z.]{1,40})"/.exec(a);
    if (t === 'span' && tok) attrs += ` data-token="${tok[1]}" contenteditable="false"`;
    if (m[0].endsWith('/>')) { out += `<${t}${attrs}></${t}>`; continue; }
    out += `<${t}${attrs}>`; open.push(t);
  }
  if (!skipUntil) out += escapeText(s.slice(last));
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

/** Plain text → safe rich text (line breaks kept). */
export const textToHtml = (s: unknown) => escapeHtml(String(s ?? '')).replace(/\r?\n/g, '<br>');
/** Rich text → plain text (for search, checks and tests). */
export const htmlToText = (h: string) => String(h ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\n+$/, '');

/** Values known only on issue (report number, issue date) are kept as tokens and filled when rendering. */
export const TOKENS: Record<string, string> = { number: 'Report no. (on issue)', issueText: 'Issue date (on issue)', pageOf: 'Page 1 of the printed pages' };
export const token = (k: keyof typeof TOKENS | string) => `{{${k}}}`;
export function fillTokens(h: string, v: Record<string, string | null | undefined>, editing = false) {
  return String(h ?? '').replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const val = v[k];
    // same text as printed (so the preview wraps exactly like the PDF), marked as a field in the editor
    if (editing) return `<span data-token="${k}" contenteditable="false" class="lay-token" title="${escapeHtml(TOKENS[k] ?? k)}">${escapeHtml(val || (k === 'pageOf' ? 'Page 1 of 1' : TOKENS[k] ? '(on issue)' : ''))}</span>`;
    return escapeHtml(val || (k === 'pageOf' ? 'Page 1 of 1' : TOKENS[k] ? '(on issue)' : ''));
  });
}
/** Turn token chips from the editor back into {{tokens}} before saving. */
export const unfillTokens = (h: string) => h.replace(/<span[^>]*data-token="(\w+)"[^>]*>[\s\S]*?<\/span>/g, '{{$1}}');

// ---------------------------------------------------------------- tables

export const emptyCell = (): Cell => ({ h: '' });
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** Make a table rectangular and its merges consistent (used after loading or any operation). */
export function normalise(t: TableSection): TableSection {
  const n = Math.max(1, t.cols.length, ...t.rows.map((r) => r.length));
  const rows = t.rows.map((r) => { const x = r.slice(0, n).map((c) => ({ ...c })); while (x.length < n) x.push(emptyCell()); return x; });
  const R = rows.length;
  // re-apply coverage from the anchors (clamping spans to the grid); stray covered cells become empty cells
  const covered = rows.map((r) => r.map(() => false));
  for (let i = 0; i < R; i++) for (let j = 0; j < n; j++) {
    const c = rows[i][j];
    if (covered[i][j]) { rows[i][j] = { h: '', m: true }; continue; }
    if (c.m) { rows[i][j] = { h: '' }; continue; }
    const rs = Math.max(1, Math.min(c.rs ?? 1, R - i)), cs = Math.max(1, Math.min(c.cs ?? 1, n - j));
    // a span may not run into an earlier anchor's area: shrink until free
    let rr = rs, cc = cs;
    for (let a = i; a < i + rr; a++) for (let b = j; b < j + cc; b++) if ((a !== i || b !== j) && covered[a][b]) { if (a > i) rr = a - i; else cc = b - j; }
    if (rr > 1) c.rs = rr; else delete c.rs;
    if (cc > 1) c.cs = cc; else delete c.cs;
    for (let a = i; a < i + rr; a++) for (let b = j; b < j + cc; b++) if (a !== i || b !== j) covered[a][b] = true;
  }
  for (let i = 0; i < R; i++) for (let j = 0; j < n; j++) if (covered[i][j]) rows[i][j] = { h: '', m: true };
  let cols = t.cols.slice(0, n);
  while (cols.length < n) cols.push(cols.length ? cols.reduce((a, b) => a + b, 0) / cols.length : 100);
  const sum = cols.reduce((a, b) => a + b, 0) || 1;
  cols = cols.map((w) => Math.round((w / sum) * 1000) / 10);
  const rh = t.rh ? rows.map((_, i) => t.rh![i] ?? null) : undefined;
  return { ...t, cols, rows, rh, head: Math.min(t.head ?? 0, R) };
}

/** The anchor (top-left) cell covering grid position r, c. */
export function anchorOf(t: TableSection, r: number, c: number): [number, number] {
  if (!t.rows[r]?.[c]?.m) return [r, c];
  for (let i = r; i >= 0; i--) for (let j = c; j >= 0; j--) {
    const a = t.rows[i][j];
    if (!a.m && i + (a.rs ?? 1) > r && j + (a.cs ?? 1) > c) return [i, j];
  }
  return [r, c];
}

export function insertRow(t0: TableSection, at: number, copyStyleFrom?: number): TableSection {
  const t = clone(t0);
  const n = t.cols.length;
  const src = copyStyleFrom !== undefined ? t.rows[copyStyleFrom] : undefined;
  const row: Cell[] = Array.from({ length: n }, (_, j) => ({ h: '', ...(src?.[j] && !src[j].m ? { al: src[j].al, va: src[j].va, sz: src[j].sz } : {}) }));
  // a merged cell spanning across the insertion point grows to cover the new row
  for (let j = 0; j < n; j++) {
    if (at <= 0 || at >= t.rows.length) continue;
    const [ai, aj] = anchorOf(t, at, j);
    if (ai < at) { const a = t.rows[ai][aj]; if (aj === j) a.rs = (a.rs ?? 1) + 1; row[j] = { h: '', m: true }; }
  }
  t.rows.splice(at, 0, row);
  if (t.rh) t.rh.splice(at, 0, null);
  if (t.head && at < t.head) t.head++;
  return normalise(t);
}

export function deleteRow(t0: TableSection, r: number): TableSection {
  if (t0.rows.length <= 1) return t0;
  const t = clone(t0);
  const n = t.cols.length;
  for (let j = 0; j < n; j++) {
    const c = t.rows[r][j];
    if (!c.m && (c.rs ?? 1) > 1 && t.rows[r + 1]) t.rows[r + 1][j] = { ...c, rs: (c.rs ?? 1) - 1, m: false }; // anchor moves down
    else if (c.m) { const [ai, aj] = anchorOf(t, r, j); if (ai < r && aj === j) { const a = t.rows[ai][aj]; a.rs = Math.max(1, (a.rs ?? 1) - 1); } }
  }
  t.rows.splice(r, 1);
  if (t.rh) t.rh.splice(r, 1);
  if (t.head && r < t.head) t.head--;
  return normalise(t);
}

export function insertCol(t0: TableSection, at: number): TableSection {
  const t = clone(t0);
  const width = t.cols.length ? t.cols.reduce((a, b) => a + b, 0) / t.cols.length : 20;
  for (let i = 0; i < t.rows.length; i++) {
    let cell: Cell = { h: '' };
    if (at > 0 && at < t.cols.length) {
      const [ai, aj] = anchorOf(t, i, at);
      if (aj < at) { if (ai === i) t.rows[ai][aj].cs = (t.rows[ai][aj].cs ?? 1) + 1; cell = { h: '', m: true }; }
    }
    t.rows[i].splice(at, 0, cell);
  }
  t.cols.splice(at, 0, width);
  return normalise(t);
}

export function deleteCol(t0: TableSection, c: number): TableSection {
  if (t0.cols.length <= 1) return t0;
  const t = clone(t0);
  for (let i = 0; i < t.rows.length; i++) {
    const x = t.rows[i][c];
    if (!x.m && (x.cs ?? 1) > 1) t.rows[i][c + 1] = { ...x, cs: (x.cs ?? 1) - 1, m: false };
    else if (x.m) { const [ai, aj] = anchorOf(t, i, c); if (aj < c && ai === i) { const a = t.rows[ai][aj]; a.cs = Math.max(1, (a.cs ?? 1) - 1); } }
  }
  for (const r of t.rows) r.splice(c, 1);
  t.cols.splice(c, 1);
  return normalise(t);
}

/** Merge the rectangle r1..r2 × c1..c2 (grown to include any merged cell it cuts through). */
export function mergeCells(t0: TableSection, r1: number, c1: number, r2: number, c2: number): TableSection {
  const t = clone(t0);
  let [a, b, c, d] = [Math.min(r1, r2), Math.min(c1, c2), Math.max(r1, r2), Math.max(c1, c2)];
  // grow until no merged cell crosses the border
  for (let changed = true; changed;) {
    changed = false;
    for (let i = a; i <= c; i++) for (let j = b; j <= d; j++) {
      const [ai, aj] = anchorOf(t, i, j); const x = t.rows[ai][aj];
      const ei = ai + (x.rs ?? 1) - 1, ej = aj + (x.cs ?? 1) - 1;
      if (ai < a) { a = ai; changed = true; } if (aj < b) { b = aj; changed = true; }
      if (ei > c) { c = ei; changed = true; } if (ej > d) { d = ej; changed = true; }
    }
  }
  if (a === c && b === d) return t0;
  const parts: string[] = [];
  for (let i = a; i <= c; i++) for (let j = b; j <= d; j++) { const x = t.rows[i][j]; if (!x.m && x.h && htmlToText(x.h).trim()) parts.push(x.h); }
  const anchor = t.rows[a][b];
  anchor.h = parts.join('<br>');
  anchor.rs = c - a + 1; anchor.cs = d - b + 1; delete anchor.m;
  for (let i = a; i <= c; i++) for (let j = b; j <= d; j++) if (i !== a || j !== b) t.rows[i][j] = { h: '', m: true };
  return normalise(t);
}

/** Undo a merge: the anchor keeps the content, the covered cells become empty cells again. */
export function splitCell(t0: TableSection, r: number, c: number): TableSection {
  const t = clone(t0);
  const [ai, aj] = anchorOf(t, r, c);
  const a = t.rows[ai][aj];
  const rs = a.rs ?? 1, cs = a.cs ?? 1;
  if (rs === 1 && cs === 1) return t0;
  for (let i = ai; i < ai + rs; i++) for (let j = aj; j < aj + cs; j++) if (i !== ai || j !== aj) t.rows[i][j] = { h: '', al: a.al, va: a.va, sz: a.sz };
  delete a.rs; delete a.cs;
  return normalise(t);
}

/** Change the width of column c by delta (percent), taking it from / giving it to the next column. */
export function resizeCol(t0: TableSection, c: number, delta: number): TableSection {
  const t = clone(t0);
  const k = c + 1 < t.cols.length ? c + 1 : c - 1;
  if (k < 0) return t0;
  const d = Math.max(-(t.cols[c] - 3), Math.min(t.cols[k] - 3, delta));
  t.cols[c] = Math.round((t.cols[c] + d) * 10) / 10; t.cols[k] = Math.round((t.cols[k] - d) * 10) / 10;
  return t;
}

/** Build a table from a compact description: strings or cell objects; null = covered by a merge. */
export type CellSpec = string | number | null | undefined | (Partial<Cell> & { h?: string; t?: string });
export function table(cols: number[], rows: CellSpec[][], opts: Partial<TableSection> = {}): TableSection {
  const n = cols.length;
  const grid: Cell[][] = rows.map((r) => {
    const out: Cell[] = [];
    for (const s of r) {
      if (s === null) { out.push({ h: '', m: true }); continue; }
      if (s === undefined || typeof s === 'string' || typeof s === 'number') { out.push({ h: textToHtml(s ?? ''), al: 'center' }); continue; }
      const { t: text, ...rest } = s;
      out.push({ al: 'center', ...rest, h: rest.h ?? textToHtml(text ?? '') });
    }
    while (out.length < n) out.push({ h: '', al: 'center' });
    return out;
  });
  return normalise({ id: newId('t'), type: 'table', cols, rows: grid, border: 'all', ...opts });
}
export const text = (h: string, opts: Partial<TextSection> = {}): TextSection => ({ id: newId('p'), type: 'text', h, ...opts });

/** Validate and clean a layout received from a browser (server side, before saving). */
export function cleanLayout(x: unknown): ReportLayout | null {
  if (!x || typeof x !== 'object') return null;
  const l = x as ReportLayout;
  if (!Array.isArray(l.sections)) return null;
  const num = (v: unknown, lo: number, hi: number) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : undefined);
  const al = (v: unknown) => (['left', 'center', 'right', 'justify'].includes(String(v)) ? (v as Align) : undefined);
  const strip = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([k, v]) => k === 'h' || (v !== undefined && v !== null && v !== ''))) as T;
  const sections: Section[] = [];
  for (const s of l.sections.slice(0, 300)) {
    if (!s || typeof s !== 'object') continue;
    const id = String((s as Section).id ?? newId()).slice(0, 40);
    if (s.type === 'auto') { sections.push({ id, type: 'auto', what: (s as AutoSection).what === 'charts' ? 'charts' : 'details', mt: num((s as AutoSection).mt, 0, 50) }); continue; }
    if (s.type === 'text') {
      const p = s as TextSection;
      sections.push(strip({ id, type: 'text' as const, h: cleanHtml(p.h).slice(0, 50000), al: al(p.al), sz: num(p.sz, 5, 30), lh: num(p.lh, 0.8, 3), mt: num(p.mt, 0, 80), mb: num(p.mb, 0, 80), indent: num(p.indent, 0, 120), heading: p.heading ? true : undefined, box: p.box ? true : undefined, width: num(p.width, 10, 100), role: p.role ? String(p.role).slice(0, 30) : undefined }) as TextSection);
      continue;
    }
    if (s.type === 'table') {
      const p = s as TableSection;
      if (!Array.isArray(p.rows) || !Array.isArray(p.cols)) continue;
      const cols = p.cols.slice(0, 40).map((w) => num(w, 0.5, 100) ?? 10);
      const rows = p.rows.slice(0, 500).map((r) => (Array.isArray(r) ? r : []).slice(0, 40).map((c: Cell) => strip({
        h: c?.m ? '' : cleanHtml(c?.h).slice(0, 20000), cs: num(c?.cs, 1, 40), rs: num(c?.rs, 1, 500), m: c?.m ? true : undefined, al: al(c?.al),
        va: ['top', 'middle', 'bottom'].includes(String(c?.va)) ? c.va : undefined, b: c?.b ? true : undefined, sz: num(c?.sz, 5, 30),
        bg: /^#[0-9a-f]{3,8}$/i.test(String(c?.bg ?? '')) ? c.bg : undefined, role: c?.role ? String(c.role).slice(0, 30) : undefined,
      }) as Cell));
      sections.push(normalise(strip({
        id, type: 'table' as const, cols, rows, rh: Array.isArray(p.rh) ? p.rh.slice(0, 500).map((h) => num(h, 2, 200) ?? null) : undefined, head: num(p.head, 0, 20),
        border: ['all', 'outer', 'none', 'inner'].includes(String(p.border)) ? p.border : undefined, width: num(p.width, 10, 100),
        align: ['left', 'center', 'right'].includes(String(p.align)) ? p.align : undefined, sz: num(p.sz, 5, 30), pad: num(p.pad, 0, 20), mt: num(p.mt, 0, 80), role: p.role ? String(p.role).slice(0, 30) : undefined,
      }) as TableSection));
    }
  }
  return { format: String(l.format ?? 'custom').slice(0, 40), version: 1, sections, edited: Boolean(l.edited) };
}
