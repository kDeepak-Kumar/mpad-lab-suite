import { evaluate, isError, type Value } from './formula';

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
export interface Calc { key: string; label: string; formula: string; unit?: string; decimals?: number; note?: string }
export interface GridColumn {
  key: string; label: string; unit?: string; decimals?: number;
  input?: boolean; formula?: string; width?: number;
  /** Text input (IDs, remarks) instead of a number. */
  text?: boolean;
  /** Drop-down input, e.g. Pass / Fail. */
  options?: string[];
}
export interface Grid {
  key: string; label: string; columns: GridColumn[];
  /** Fixed rows with pre-set values (e.g. dial readings); otherwise `rows` empty rows. */
  fixedRows?: Record<string, number | string>[];
  rows?: number;
}
export interface Check { when: string; level: 'warning' | 'error'; message: string }
export interface ChartSeries { y: string; label: string; dashed?: boolean; markers?: boolean }
export interface ChartDef {
  grid: string; x: string; y: string; title: string; xLabel: string; yLabel: string;
  /** Extra lines from the same grid, e.g. lower and upper grading limits. */
  series?: ChartSeries[];
  /** Logarithmic x axis (sieve sizes, number of blows). */
  xLog?: boolean;
  /** Draw a straight best-fit line instead of joining the points (flow curve, shear envelope). */
  fit?: 'line';
}
export interface ReportRow {
  group?: string; name: string; unit: string; result: string; decimals?: number;
  /** Requirement / limit as per the IS specification, shown in its own column on the report. */
  spec?: string;
  /** Formula giving the requirement text, e.g. depending on the grade selected on the sheet. */
  specFormula?: string;
}
/** A grid printed on the report as its own table (sieve analysis, individual cubes, bars). */
export interface ReportTable {
  title: string; grid: string;
  columns: { key: string; label: string; decimals?: number }[];
  /** Skip rows where this column is blank. */
  skipBlank?: string;
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
  reportRows: ReportRow[];
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
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return isNaN(n) ? null : n;
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

/** Points for every line of a chart (main series first). */
export function chartSeries(t: ObservationTemplate, res: ObservationResult): { label: string; dashed?: boolean; markers?: boolean; points: [number, number][] }[] {
  const ch = t.chart; if (!ch) return [];
  const rows = res.grids[ch.grid] ?? [];
  const pts = (y: string) => rows.map((r) => [r[ch.x], r[y]]).filter(([x, v]) => typeof x === 'number' && typeof v === 'number' && (!ch.xLog || (x as number) > 0)) as [number, number][];
  return [{ label: ch.yLabel, markers: true, points: pts(ch.y) }, ...(ch.series ?? []).map((s) => ({ label: s.label, dashed: s.dashed, markers: s.markers, points: pts(s.y) }))];
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
  return t.sampleCalc.map((line) => line.replace(/\{([\w.#]+)(?::(\d+))?\}/g, (_, ref: string, d?: string) => {
    const v = pickValue(res, ref);
    return formatValue(v, d === undefined ? undefined : Number(d)) || '—';
  }));
}
