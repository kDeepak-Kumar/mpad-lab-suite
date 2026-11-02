import { evaluate, isError, parse, references, type Value } from './formula';

/**
 * Observation sheet templates are pure data: fields, constants, formulas, rule checks,
 * a chart and the rows that feed the test report. New tests are added as data, not code.
 */

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'textarea';

export interface HeaderField {
  key: string; label: string; type: FieldType; unit?: string; options?: string[]; required?: boolean;
  /** Value used when the tester leaves the field empty (e.g. a default grade). */
  default?: string | number;
  help?: string;
  /** Pre-filled from the sample/test record, e.g. 'sample.code', 'sample.received_date'. */
  source?: string;
}
export interface Constant {
  key: string; label: string; unit?: string; value?: number;
  /** Read from the selected equipment's calibration data instead of a fixed value. */
  fromEquipment?: string;
  note?: string;
  /** Lock the value (no manual override on the sheet). By default testers may override constants with a reason. */
  locked?: boolean;
}
export interface Calc { key: string; label: string; formula: string; unit?: string; decimals?: number; note?: string; /** Calculated but not listed in the sheet's results box. */ hidden?: boolean }
export interface GridColumn {
  key: string; label: string; unit?: string; decimals?: number;
  input?: boolean; formula?: string; width?: number;
  /** Text input (IDs, remarks) instead of a number. */
  text?: boolean;
  /** Drop-down input, e.g. Pass / Fail. */
  options?: string[];
  /** Helper calculation not shown on the sheet (still usable in formulas). */
  hidden?: boolean;
}
export interface Grid {
  key: string; label: string; columns: GridColumn[];
  /** Fixed rows with pre-set values (e.g. dial readings); otherwise `rows` empty rows. */
  fixedRows?: Record<string, number | string>[];
  rows?: number;
}
export interface Check { when: string; level: 'warning' | 'error'; message: string }
export interface ChartSeries { y: string; label: string; dashed?: boolean; markers?: boolean; /** x column when it differs from the chart's (e.g. corrected N against depth). */ x?: string }
export interface ChartDef {
  grid: string; x: string; y: string; title: string; xLabel: string; yLabel: string;
  /** Extra lines from the same grid, e.g. lower and upper grading limits. */
  series?: ChartSeries[];
  /** Logarithmic x axis (sieve sizes, number of blows). */
  xLog?: boolean;
  /** Draw a straight best-fit line instead of joining the points (flow curve, shear envelope). */
  fit?: 'line';
  /** Logarithmic y axis (log-log plate load curve). */
  yLog?: boolean;
  /** Values increase downwards (settlement, depth). */
  yReverse?: boolean;
  /** Put the x axis along the top (load–settlement curves, depth logs). */
  xTop?: boolean;
  /** Fixed axis limits; leave out to scale automatically from the readings. */
  xMin?: number; xMax?: number; yMin?: number; yMax?: number;
  /** Explanation printed under the graph on the report; {name} placeholders are filled from the results. */
  note?: string;
  /** Show this graph on the report (default true). */
  report?: boolean;
  /** Legend name of the main line (defaults to the y-axis label). */
  label?: string;
}
/** Paragraph on the report, e.g. interpretation of the results. Shown when `when` (a formula) is TRUE or absent. */
export interface ReportText { title?: string; text: string; when?: string }
/** One line of the test details box on the report (plate size, location, pile id …). */
export interface ReportInfo { label: string; value: string; unit?: string; decimals?: number }
/** Borehole log drawn from grids: strata, SPT, samples and core runs. */
export interface BoreLogDef {
  strata: { grid: string; from: string; to: string; soil: string; desc?: string };
  spt?: { grid: string; depth: string; n: string; label?: string };
  samples?: { grid: string; depth: string; type: string };
  core?: { grid: string; from: string; to: string; rec?: string; rqd?: string };
  /** Scalar names for the water table depth and the borehole title. */
  waterTable?: string; title?: string;
}
export interface ReportRow {
  group?: string; name: string; unit: string; result: string; decimals?: number;
  /** Requirement / limit as per the IS specification, shown in its own column on the report. */
  spec?: string;
  /** Formula giving the requirement text, e.g. depending on the grade selected on the sheet. */
  specFormula?: string;
  /** Off by default; can be switched on for a test (customer asks for it). */
  hidden?: boolean;
}
/** A grid printed on the report as its own table (sieve analysis, individual cubes, bars). */
export interface ReportTable {
  title: string; grid: string;
  columns: { key: string; label: string; decimals?: number }[];
  /** Skip rows where this column is blank. */
  skipBlank?: string;
  /** Off by default; can be switched on for a test. */
  hidden?: boolean;
}
export interface EquipmentSlot { key: string; label: string; category: string }

export interface ObservationTemplate {
  code: string; version: number; name: string; method: string; material: string;
  docControl?: { docNo: string; issueNo: string; issueDate: string; amendmentNo: string };
  equipment?: EquipmentSlot[];
  headerFields: HeaderField[];
  constants: Constant[];
  derived: Calc[];
  grids: Grid[];
  results: Calc[];
  checks: Check[];
  chart?: ChartDef;
  /** Further graphs (e.g. natural and log-log plate load curves). */
  charts?: ChartDef[];
  reportRows: ReportRow[];
  /** Test details box on the report. */
  reportInfo?: ReportInfo[];
  /** Interpretation / calculation paragraphs on the report (for every test). */
  reportText?: ReportText[];
  /** Scope / method paragraphs printed once per report for this kind of test (filled from the first test). */
  reportIntro?: ReportText[];
  /** Formula naming the test on the report when a sample has several of them, e.g. "Test "&test_no&" – "&location. */
  reportLabel?: string;
  borelog?: BoreLogDef;
  reportTables?: ReportTable[];
  instructions?: string;
  simplified?: boolean;
  /** Lookup tables (IS limits, calibration curves) available to formulas as `name.column` lists. */
  tables?: Record<string, Record<string, (number | string)[]>>;
  /** Step-by-step test procedure for testers (shown beside the sheet). */
  procedure?: string[];
  /** Worked example with numbers, so testers can check their understanding. */
  sampleCalc?: string[];
  /** Specification / acceptance references, e.g. IS 383 : 2016 Table 9. */
  references?: string[];
  /** Grouping used in the template library: Soil, Coarse aggregate, Cement, ... */
  category?: string;
  /** Worked example: the inputs behind `sampleCalc` and the results they must give (checked by the test suite). */
  example?: { input: Partial<ObservationInput> & { grids: ObservationInput['grids'] }; expect: Record<string, number | string> };
}

export interface ObservationInput {
  header: Record<string, string | number | null>;
  /** Per-test choice of what goes on the report: keys from reportPartKeys(); missing keys use the template default. */
  show?: Record<string, boolean>;
  constants?: Record<string, number | null>;
  equipment?: Record<string, { id: number; name: string; data: Record<string, number | string> } | null>;
  grids: Record<string, Record<string, number | string | null>[]>;
}

export interface ObservationResult {
  scalars: Record<string, Value>;
  grids: Record<string, Record<string, Value>[]>;
  results: Record<string, Value>;
  checks: { level: 'warning' | 'error'; message: string }[];
  errors: string[];
}

const toNum = (v: unknown): number | null => {
  const n = parseNumberInput(v);
  return n === undefined ? null : n;
};

export function emptyInput(t: ObservationTemplate): ObservationInput {
  const grids: ObservationInput['grids'] = {};
  for (const g of t.grids) {
    const base = g.fixedRows ?? Array.from({ length: g.rows ?? 5 }, () => ({}));
    grids[g.key] = base.map((r) => {
      const row: Record<string, number | string | null> = {};
      for (const c of g.columns) if (c.input || c.key in r) row[c.key] = (r as Record<string, number | string>)[c.key] ?? null;
      return row;
    });
  }
  return { header: {}, constants: {}, equipment: {}, grids };
}

export function evaluateObservation(t: ObservationTemplate, input: ObservationInput): ObservationResult {
  const scalars: Record<string, Value> = {};
  const errors: string[] = [];

  for (const [name, cols] of Object.entries(t.tables ?? {})) for (const [col, vals] of Object.entries(cols)) scalars[`${name}.${col}`] = vals as Value[];
  for (const f of t.headerFields) {
    let v = input.header[f.key];
    if ((v === null || v === undefined || v === '') && f.default !== undefined) v = f.default;
    scalars[f.key] = f.type === 'number' ? toNum(v) : (v ?? null) as Value;
  }
  for (const c of t.constants) {
    let v: number | null = c.locked ? null : toNum(input.constants?.[c.key]);
    if (v === null && c.fromEquipment) {
      const [slot, field] = c.fromEquipment.split('.');
      v = toNum(input.equipment?.[slot]?.data?.[field]);
    }
    if (v === null) v = c.value ?? null;
    scalars[c.key] = v;
  }
  const scope = (extra?: Record<string, Value>) => (name: string): Value | undefined => {
    if (extra && name in extra) return extra[name];
    if (name in scalars) return scalars[name];
    return undefined;
  };
  for (const d of t.derived) scalars[d.key] = evaluate(d.formula, scope());

  const grids: ObservationResult['grids'] = {};
  for (const g of t.grids) {
    const rows = input.grids[g.key] ?? [];
    // Column by column, so a formula can use earlier columns of every row (cumulative sums, totals).
    const out: Record<string, Value>[] = rows.map((_, i) => ({ _row: i + 1 }));
    for (const c of g.columns) {
      rows.forEach((r, i) => {
        if (c.formula) out[i][c.key] = evaluate(c.formula, scope(out[i]));
        else { const raw = r[c.key]; out[i][c.key] = c.text || c.options ? (raw === undefined || raw === '' ? null : raw as Value) : toNum(raw) ?? (typeof raw === 'string' && raw !== '' ? raw : null); }
      });
      scalars[`${g.key}.${c.key}`] = out.map((r) => r[c.key]);
    }
    out.forEach((r) => delete r._row);
    grids[g.key] = out;
  }

  const results: Record<string, Value> = {};
  for (const r of t.results) {
    const v = evaluate(r.formula, scope());
    results[r.key] = v;
    scalars[r.key] = v;
  }

  const checks: ObservationResult['checks'] = [];
  for (const c of t.checks) {
    const v = evaluate(c.when, scope());
    if (v === true) checks.push({ level: c.level, message: c.message });
  }
  for (const [k, v] of Object.entries(results)) if (isError(v) && v.error !== '#N/A') errors.push(`${k}: ${v.error}`);
  return { scalars, grids, results, checks, errors };
}

export function formatValue(v: Value | undefined, decimals?: number): string {
  if (v === null || v === undefined || v === '') return '';
  if (isError(v)) return v.error === '#N/A' ? '' : v.error;
  if (Array.isArray(v)) return '';
  if (typeof v === 'number') return decimals === undefined ? String(Math.round(v * 1e6) / 1e6) : v.toFixed(decimals);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

/** Report requirement text for a row: fixed text or a formula over the evaluated sheet. */
export function reportSpec(rr: ReportRow, res: ObservationResult): string {
  if (rr.specFormula) { const v = evaluate(rr.specFormula, (n) => res.scalars[n]); return isError(v) ? '' : formatValue(v); }
  return rr.spec ?? '';
}

/** Rows of a report table, formatted. */
export function reportTableRows(t: ObservationTemplate, rt: ReportTable, res: ObservationResult): string[][] {
  const g = t.grids.find((x) => x.key === rt.grid);
  return (res.grids[rt.grid] ?? [])
    .filter((r) => !rt.skipBlank || (r[rt.skipBlank] !== null && r[rt.skipBlank] !== '' && r[rt.skipBlank] !== undefined))
    .map((r) => rt.columns.map((c) => formatValue(r[c.key], c.decimals ?? g?.columns.find((x) => x.key === c.key)?.decimals)));
}

/** Every graph of a template (the main chart first). */
export const allCharts = (t: ObservationTemplate): ChartDef[] => [...(t.chart ? [t.chart] : []), ...(t.charts ?? [])];

/** Points for every line of a chart (main series first). */
export function chartSeries(t: ObservationTemplate, res: ObservationResult, chart?: ChartDef): { label: string; dashed?: boolean; markers?: boolean; points: [number, number][] }[] {
  const ch = chart ?? t.chart; if (!ch) return [];
  const rows = res.grids[ch.grid] ?? [];
  const ok = (x: unknown, v: unknown) => typeof x === 'number' && typeof v === 'number' && (!ch.xLog || x > 0) && (!ch.yLog || v > 0);
  const pts = (y: string, x = ch.x) => rows.map((r) => [r[x], r[y]]).filter(([a, v]) => ok(a, v)) as [number, number][];
  return [{ label: ch.label ?? ch.yLabel, markers: true, points: pts(ch.y) }, ...(ch.series ?? []).map((s) => ({ label: s.label, dashed: s.dashed, markers: s.markers, points: pts(s.y, s.x) }))];
}

/** Fill {ref} / {ref:decimals} / {grid.col#row:decimals} placeholders from an evaluated sheet. */
export function fillRefs(text: string, res: ObservationResult): string {
  return text.replace(/\{([\w.#]+)(?::(\d+))?\}/g, (_, ref: string, d?: string) => formatValue(pickValue(res, ref), d === undefined ? undefined : Number(d)) || '—');
}

/** Report paragraphs whose condition holds, with values filled in. */
export function reportTexts(t: ObservationTemplate, res: ObservationResult, which: 'text' | 'intro' = 'text'): { title?: string; text: string }[] {
  return ((which === 'intro' ? t.reportIntro : t.reportText) ?? []).filter((x) => !x.when || evaluate(x.when, (n) => res.scalars[n] ?? res.results[n]) === true)
    .map((x) => ({ title: x.title, text: fillRefs(x.text, res) }));
}

/** Test details box values. */
export function reportInfoRows(t: ObservationTemplate, res: ObservationResult): [string, string][] {
  return (t.reportInfo ?? []).map((i) => {
    const v = evaluate(i.value, (n) => res.scalars[n] ?? res.results[n]);
    const s = isError(v) ? '' : formatValue(v, i.decimals);
    return [i.label, s ? `${s}${i.unit ? ` ${i.unit}` : ''}` : '--'] as [string, string];
  });
}

export interface BoreLogData {
  title: string; waterTable: string; depth: number;
  strata: { from: number; to: number; soil: string; desc: string }[];
  spt: { depth: number; n: number | null; label: string }[];
  samples: { depth: number; type: string }[];
  core: { from: number; to: number; rec: number | null; rqd: number | null }[];
}
/** Normalised borehole log (strata, SPT, samples, core runs) for drawing. */
export function boreLogData(t: ObservationTemplate, res: ObservationResult): BoreLogData | null {
  const b = t.borelog; if (!b) return null;
  const num = (v: Value | undefined) => (typeof v === 'number' ? v : null);
  const str = (v: Value | undefined) => (v === null || v === undefined || isError(v) ? '' : formatValue(v));
  const strata = (res.grids[b.strata.grid] ?? []).map((r) => ({ from: num(r[b.strata.from]), to: num(r[b.strata.to]), soil: str(r[b.strata.soil]), desc: b.strata.desc ? str(r[b.strata.desc]) : '' }))
    .filter((s): s is { from: number; to: number; soil: string; desc: string } => s.from !== null && s.to !== null && s.to > s.from);
  const spt = b.spt ? (res.grids[b.spt.grid] ?? []).map((r) => ({ depth: num(r[b.spt!.depth]), n: num(r[b.spt!.n]), label: b.spt!.label ? str(r[b.spt!.label]) : str(r[b.spt!.n]) }))
    .filter((s): s is { depth: number; n: number | null; label: string } => s.depth !== null) : [];
  const samples = b.samples ? (res.grids[b.samples.grid] ?? []).map((r) => ({ depth: num(r[b.samples!.depth]), type: str(r[b.samples!.type]) }))
    .filter((s): s is { depth: number; type: string } => s.depth !== null && !!s.type) : [];
  const core = b.core ? (res.grids[b.core.grid] ?? []).map((r) => ({ from: num(r[b.core!.from]), to: num(r[b.core!.to]), rec: b.core!.rec ? num(r[b.core!.rec]) : null, rqd: b.core!.rqd ? num(r[b.core!.rqd]) : null }))
    .filter((s): s is { from: number; to: number; rec: number | null; rqd: number | null } => s.from !== null && s.to !== null) : [];
  const depth = Math.max(0, ...strata.map((s) => s.to), ...spt.map((s) => s.depth), ...core.map((c) => c.to));
  return { title: b.title ? str(res.scalars[b.title]) : '', waterTable: b.waterTable ? str(res.scalars[b.waterTable]) : '', depth, strata, spt, samples, core };
}

/** Example inputs merged onto an empty sheet (fixed rows such as sieve sizes stay in place). */
export function exampleInput(t: ObservationTemplate): ObservationInput {
  const base = emptyInput(t);
  const ex = t.example?.input;
  if (!ex) return base;
  const grids = { ...base.grids };
  for (const [k, rows] of Object.entries(ex.grids ?? {})) {
    const b = grids[k] ?? [];
    const n = Math.max(b.length, rows.length);
    grids[k] = Array.from({ length: n }, (_, i) => ({ ...(b[i] ?? {}), ...(rows[i] ?? {}) }));
  }
  return { header: { ...(ex.header ?? {}) }, constants: { ...(ex.constants ?? {}) }, equipment: ex.equipment ?? {}, grids };
}

/** Value of `name`, `grid.col#row` (1-based) from an evaluated sheet. */
export function pickValue(res: ObservationResult, ref: string): Value | undefined {
  const m = /^([\w]+)\.([\w]+)#(\d+)$/.exec(ref);
  if (m) return res.grids[m[1]]?.[Number(m[3]) - 1]?.[m[2]];
  return ref in res.results ? res.results[ref] : res.scalars[ref];
}

/** Worked example text with {ref} or {ref:decimals} placeholders filled from the example inputs. */
export function renderSampleCalc(t: ObservationTemplate): string[] {
  if (!t.sampleCalc?.length) return [];
  const res = evaluateObservation(t, exampleInput(t));
  return t.sampleCalc.map((line) => fillRefs(line, res));
}

/** Every name a formula in this template may use. */
export function templateNames(t: ObservationTemplate): Set<string> {
  return new Set<string>([
    ...t.headerFields.map((f) => f.key), ...t.constants.map((c) => c.key), ...t.derived.map((d) => d.key), ...t.results.map((r) => r.key),
    ...t.grids.flatMap((g) => g.columns.flatMap((c) => [c.key, `${g.key}.${c.key}`])),
    ...Object.entries(t.tables ?? {}).flatMap(([n, cols]) => Object.keys(cols).map((c) => `${n}.${c}`)), '_row',
  ]);
}

/** Problem in a formula: syntax error or a name the template does not define. */
export function formulaIssue(src: string, names: Set<string>): string | null {
  if (!src?.trim()) return null;
  try { parse(src); } catch (e) { return `Syntax: ${(e as Error).message}`; }
  const unknown = references(src).filter((n) => !names.has(n) && !['TRUE', 'FALSE'].includes(n.toUpperCase()));
  return unknown.length ? `Unknown name${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}` : null;
}

/** Checks a template before it is published: duplicate keys, formula errors, broken report and chart references. */
export function validateTemplate(t: ObservationTemplate): { where: string; message: string }[] {
  const out: { where: string; message: string }[] = [];
  const names = templateNames(t);
  const dup = (where: string, keys: string[]) => { const seen = new Set<string>(); for (const k of keys) { if (!k) out.push({ where, message: 'A key is empty' }); else if (seen.has(k)) out.push({ where, message: `Key "${k}" is used twice` }); seen.add(k); } };
  dup('Inputs / constants / calculations', [...t.headerFields.map((f) => f.key), ...t.constants.map((c) => c.key), ...t.derived.map((d) => d.key), ...t.results.map((r) => r.key)]);
  dup('Reading tables', t.grids.map((g) => g.key));
  for (const g of t.grids) dup(`Table "${g.label || g.key}"`, g.columns.map((c) => c.key));
  const f = (where: string, src?: string) => { const m = src ? formulaIssue(src, names) : null; if (m) out.push({ where, message: m }); };
  for (const d of t.derived) f(`Derived "${d.label}"`, d.formula);
  for (const g of t.grids) for (const c of g.columns) f(`Column "${c.label}" in "${g.label}"`, c.formula);
  for (const r of t.results) f(`Result "${r.label}"`, r.formula);
  for (const c of t.checks) f(`Check "${c.message}"`, c.when);
  for (const r of t.reportRows) { if (!names.has(r.result)) out.push({ where: `Report row "${r.name}"`, message: `Result "${r.result}" does not exist` }); f(`Report row "${r.name}" requirement`, r.specFormula); }
  for (const i of t.reportInfo ?? []) f(`Report detail "${i.label}"`, i.value);
  for (const x of [...(t.reportText ?? []), ...(t.reportIntro ?? [])]) f('Report text condition', x.when);
  if (t.reportLabel) f('Report label', t.reportLabel);
  const gridCol = (grid: string, col: string) => t.grids.find((g) => g.key === grid)?.columns.some((c) => c.key === col);
  for (const ch of allCharts(t)) for (const k of [ch.x, ch.y, ...(ch.series ?? []).flatMap((s) => [s.y, s.x ?? ch.x])]) if (!gridCol(ch.grid, k)) out.push({ where: `Graph "${ch.title}"`, message: `Column "${ch.grid}.${k}" does not exist` });
  for (const rt of t.reportTables ?? []) for (const c of rt.columns) if (!gridCol(rt.grid, c.key)) out.push({ where: `Report table "${rt.title}"`, message: `Column "${rt.grid}.${c.key}" does not exist` });
  const texts = [...(t.reportText ?? []), ...(t.reportIntro ?? [])].map((x) => x.text).concat(allCharts(t).map((c) => c.note ?? ''), t.sampleCalc ?? []);
  for (const txt of texts) for (const m of txt.matchAll(/\{([\w.]+)(?:#\d+)?(?::\d+)?\}/g)) if (!names.has(m[1])) out.push({ where: 'Text placeholder', message: `{${m[1]}} is not a known name` });
  return out;
}

/** Text typed into a number cell → number. Accepts a decimal comma and surrounding spaces; returns undefined when it is not a number. */
export function parseNumberInput(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const s = String(v).trim().replace(/\s+/g, '');
  if (s === '' || s === '-' || s === '--') return null;
  const t = /^-?\d+,\d+$/.test(s) ? s.replace(',', '.') : s;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return undefined;
  return Number(t);
}

/**
 * Clean an observation before saving: numbers typed as text become numbers, and anything that is not a number
 * in a number cell is reported (row and column named) instead of silently becoming blank.
 */
export function normalizeObservation(t: ObservationTemplate, input: ObservationInput): { input: ObservationInput; issues: string[] } {
  const issues: string[] = [];
  const header: ObservationInput['header'] = { ...input.header };
  for (const f of t.headerFields) {
    if (f.type !== 'number' || header[f.key] === undefined) continue;
    const n = parseNumberInput(header[f.key]);
    if (n === undefined) issues.push(`${f.label}: "${header[f.key]}" is not a number`); else header[f.key] = n;
  }
  const constants: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(input.constants ?? {})) {
    const c = t.constants.find((x) => x.key === k);
    const n = parseNumberInput(v);
    if (n === undefined) issues.push(`${c?.label ?? k}: "${v}" is not a number`); else if (n !== null) constants[k] = n;
  }
  const grids: ObservationInput['grids'] = {};
  for (const [gk, rows] of Object.entries(input.grids ?? {})) {
    const g = t.grids.find((x) => x.key === gk);
    grids[gk] = (rows ?? []).map((r, i) => {
      const out: Record<string, number | string | null> = { ...r };
      for (const c of g?.columns ?? []) {
        if (!c.input || c.text || c.options || !(c.key in r)) continue;
        const n = parseNumberInput(r[c.key]);
        if (n === undefined) issues.push(`${g!.label || g!.key}, row ${i + 1}, ${c.label}: "${r[c.key]}" is not a number`); else out[c.key] = n;
      }
      return out;
    });
  }
  return { input: { ...input, header, constants, grids }, issues };
}

/** Everything on the report that can be switched on or off for a test, with its template default. */
export function reportParts(t: ObservationTemplate): { key: string; label: string; kind: 'row' | 'table' | 'chart' | 'info' | 'text'; on: boolean }[] {
  return [
    ...t.reportRows.map((r) => ({ key: `row:${r.group ?? ''}|${r.name}|${r.unit}`, label: `${r.group ? `${r.group} – ` : ''}${r.name}${r.unit && r.unit !== '--' ? ` (${r.unit})` : ''}`, kind: 'row' as const, on: !r.hidden })),
    ...(t.reportTables ?? []).map((r) => ({ key: `table:${r.title}`, label: `Table: ${r.title}`, kind: 'table' as const, on: !r.hidden })),
    ...allCharts(t).map((c) => ({ key: `chart:${c.title}`, label: `Graph: ${c.title}`, kind: 'chart' as const, on: c.report !== false })),
    ...((t.reportInfo ?? []).length ? [{ key: 'info', label: 'Test details box', kind: 'info' as const, on: true }] : []),
    ...((t.reportText ?? []).length ? [{ key: 'text', label: 'Interpretation / calculation text', kind: 'text' as const, on: true }] : []),
  ];
}
/** Is this report part shown for a test (its own choice, else the template default)? */
export const partShown = (t: ObservationTemplate, show: Record<string, boolean> | undefined, key: string) =>
  show?.[key] ?? reportParts(t).find((p) => p.key === key)?.on ?? true;
