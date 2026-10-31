import { evaluate, isError, type Value } from './formula';

/**
 * Observation sheet templates are pure data: fields, constants, formulas, rule checks,
 * a chart and the rows that feed the test report. New tests are added as data, not code.
 */

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'textarea';

export interface HeaderField {
  key: string; label: string; type: FieldType; unit?: string; options?: string[]; required?: boolean;
  /** Pre-filled from the sample/test record, e.g. 'sample.code', 'sample.received_date'. */
  source?: string;
}
export interface Constant {
  key: string; label: string; unit?: string; value?: number;
  /** Read from the selected equipment's calibration data instead of a fixed value. */
  fromEquipment?: string;
  note?: string;
}
export interface Calc { key: string; label: string; formula: string; unit?: string; decimals?: number; note?: string }
export interface GridColumn {
  key: string; label: string; unit?: string; decimals?: number;
  input?: boolean; formula?: string; width?: number;
}
export interface Grid {
  key: string; label: string; columns: GridColumn[];
  /** Fixed rows with pre-set values (e.g. dial readings); otherwise `rows` empty rows. */
  fixedRows?: Record<string, number | string>[];
  rows?: number;
}
export interface Check { when: string; level: 'warning' | 'error'; message: string }
export interface ChartDef { grid: string; x: string; y: string; title: string; xLabel: string; yLabel: string }
export interface ReportRow { group?: string; name: string; unit: string; result: string; decimals?: number }
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
  instructions?: string;
  simplified?: boolean;
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

  for (const f of t.headerFields) {
    const v = input.header[f.key];
    scalars[f.key] = f.type === 'number' ? toNum(v) : (v ?? null) as Value;
  }
  for (const c of t.constants) {
    let v: number | null = toNum(input.constants?.[c.key]);
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
    const out: Record<string, Value>[] = [];
    for (const r of rows) {
      const row: Record<string, Value> = {};
      for (const c of g.columns) {
        if (c.formula) row[c.key] = evaluate(c.formula, scope(row));
        else row[c.key] = toNum(r[c.key]) ?? (typeof r[c.key] === 'string' && r[c.key] !== '' ? (r[c.key] as string) : null);
      }
      out.push(row);
    }
    grids[g.key] = out;
    for (const c of g.columns) scalars[`${g.key}.${c.key}`] = out.map((r) => r[c.key]);
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
