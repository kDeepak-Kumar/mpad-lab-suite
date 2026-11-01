/**
 * Report builder engine. A report is a JSON spec (object, date range, filters, group by, measure, chart);
 * the AI assistant produces the same spec, so its answers are always safe, explainable and re-runnable.
 */

export type RField = { key: string; label: string; type: 'string' | 'number' | 'currency' | 'date'; group?: boolean; measure?: boolean };
export interface RObject { key: string; label: string; dateField: string; fields: RField[] }

const s = (key: string, label: string): RField => ({ key, label, type: 'string', group: true });
const m = (key: string, label: string, type: 'number' | 'currency' = 'currency'): RField => ({ key, label, type, measure: true });
const time: RField[] = [
  { key: 'month', label: 'Month', type: 'string', group: true }, { key: 'week', label: 'Week', type: 'string', group: true },
  { key: 'day', label: 'Day', type: 'string', group: true }, { key: 'quarter', label: 'Quarter', type: 'string', group: true }, { key: 'fy', label: 'Financial year', type: 'string', group: true },
];

export const REPORT_OBJECTS: RObject[] = [
  { key: 'invoices', label: 'Invoices (revenue)', dateField: 'date', fields: [{ key: 'date', label: 'Invoice date', type: 'date' }, ...time, s('client', 'Client'), s('site', 'Site'), s('accreditation', 'Report type'), s('status', 'Status'), s('number', 'Invoice no.'),
    m('total', 'Amount incl. GST'), m('taxable', 'Taxable value'), m('gst', 'GST'), m('received', 'Received'), m('balance', 'Balance due')] },
  { key: 'invoice_lines', label: 'Invoice lines (by test)', dateField: 'date', fields: [{ key: 'date', label: 'Invoice date', type: 'date' }, ...time, s('client', 'Client'), s('site', 'Site'), s('test', 'Test / service'), s('material', 'Material'), s('accreditation', 'Report type'),
    m('qty', 'Quantity', 'number'), m('amount', 'Amount (before GST)')] },
  { key: 'quotes', label: 'Quotations', dateField: 'date', fields: [{ key: 'date', label: 'Quote date', type: 'date' }, ...time, s('client', 'Client'), s('site', 'Site'), s('status', 'Status'), s('accreditation', 'Report type'), m('total', 'Value')] },
  { key: 'samples', label: 'Samples received', dateField: 'date', fields: [{ key: 'date', label: 'Received date', type: 'date' }, ...time, s('client', 'Client'), s('site', 'Site'), s('material', 'Material'), s('accreditation', 'Report type'), s('status', 'Status'), m('tests', 'Number of tests', 'number')] },
  { key: 'tests', label: 'Tests performed', dateField: 'date', fields: [{ key: 'date', label: 'Completed / due date', type: 'date' }, ...time, s('test', 'Test'), s('material', 'Material'), s('client', 'Client'), s('status', 'Status'), s('technician', 'Technician'), s('accreditation', 'Report type'), m('tat', 'Turnaround (days)', 'number'), m('value', 'Billing value')] },
  { key: 'payments', label: 'Payments received', dateField: 'date', fields: [{ key: 'date', label: 'Payment date', type: 'date' }, ...time, s('client', 'Client'), s('mode', 'Mode'), m('amount', 'Amount'), m('tds', 'TDS')] },
  { key: 'outstanding', label: 'Outstanding invoices', dateField: 'date', fields: [{ key: 'date', label: 'Invoice date', type: 'date' }, ...time, s('client', 'Client'), s('ageing', 'Ageing bucket'), s('accreditation', 'Report type'), s('number', 'Invoice no.'), m('balance', 'Balance due'), m('days', 'Days outstanding', 'number')] },
];
export const reportObject = (k: string) => REPORT_OBJECTS.find((o) => o.key === k);

export type DatePreset = 'all' | 'today' | 'this_week' | 'last_7' | 'last_30' | 'last_90' | 'this_month' | 'last_month' | 'this_quarter' | 'this_fy' | 'last_fy' | 'last_12_months' | 'this_year' | 'next_7' | 'next_30';
export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'all', label: 'All time' }, { value: 'today', label: 'Today' }, { value: 'this_week', label: 'This week' }, { value: 'last_7', label: 'Last 7 days' },
  { value: 'last_30', label: 'Last 30 days' }, { value: 'last_90', label: 'Last 90 days' }, { value: 'this_month', label: 'This month' }, { value: 'last_month', label: 'Last month' },
  { value: 'this_quarter', label: 'This quarter' }, { value: 'this_fy', label: 'This financial year' }, { value: 'last_fy', label: 'Last financial year' },
  { value: 'last_12_months', label: 'Last 12 months' }, { value: 'this_year', label: 'This calendar year' }, { value: 'next_7', label: 'Next 7 days' }, { value: 'next_30', label: 'Next 30 days' },
];

export interface ReportFilter { field: string; op: 'eq' | 'neq' | 'in' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte'; value: unknown }
export interface ReportSpec {
  title?: string;
  object: string;
  dateRange?: { preset?: DatePreset; from?: string; to?: string };
  filters?: ReportFilter[];
  groupBy?: string[];
  measure: { agg: 'count' | 'sum' | 'avg' | 'min' | 'max'; field?: string };
  sort?: 'value_desc' | 'value_asc' | 'label';
  limit?: number;
  chart?: 'bar' | 'hbar' | 'line' | 'pie' | 'table' | 'number';
  forecast?: number;
}
export interface ReportResult {
  title: string; spec: ReportSpec; range: { from: string; to: string };
  rows: { label: string; label2?: string; value: number; forecast?: boolean }[];
  series2?: string[]; total: number; count: number; measureLabel: string; groupLabel?: string; group2Label?: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addD = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
export function resolveRange(r: ReportSpec['dateRange'] | undefined, today: string): { from: string; to: string } {
  if (!r || (!r.preset && !r.from && !r.to)) return { from: '0000-01-01', to: '9999-12-31' };
  if (!r.preset) return { from: r.from || '0000-01-01', to: r.to || '9999-12-31' };
  const [y, mo] = today.split('-').map(Number);
  const fyStart = mo >= 4 ? y : y - 1;
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastDay = (yy: number, mm: number) => iso(new Date(Date.UTC(yy, mm, 0)));
  const dow = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7;
  switch (r.preset) {
    case 'today': return { from: today, to: today };
    case 'this_week': return { from: addD(today, -dow), to: addD(today, 6 - dow) };
    case 'last_7': return { from: addD(today, -6), to: today };
    case 'last_30': return { from: addD(today, -29), to: today };
    case 'last_90': return { from: addD(today, -89), to: today };
    case 'next_7': return { from: today, to: addD(today, 7) };
    case 'next_30': return { from: today, to: addD(today, 30) };
    case 'this_month': return { from: monthStart, to: lastDay(y, mo) };
    case 'last_month': { const py = mo === 1 ? y - 1 : y, pm = mo === 1 ? 12 : mo - 1; return { from: `${py}-${String(pm).padStart(2, '0')}-01`, to: lastDay(py, pm) }; }
    case 'this_quarter': { const q0 = Math.floor((mo - 1) / 3) * 3 + 1; return { from: `${y}-${String(q0).padStart(2, '0')}-01`, to: lastDay(y, q0 + 2) }; }
    case 'this_fy': return { from: `${fyStart}-04-01`, to: `${fyStart + 1}-03-31` };
    case 'last_fy': return { from: `${fyStart - 1}-04-01`, to: `${fyStart}-03-31` };
    case 'last_12_months': { const d = new Date(Date.UTC(y, mo - 12, 1)); return { from: iso(d), to: today }; }
    case 'this_year': return { from: `${y}-01-01`, to: `${y}-12-31` };
    default: return { from: '0000-01-01', to: '9999-12-31' };
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Add derived time fields (month, week, quarter, fy) to a row from its date. */
export function withTime<T extends Record<string, unknown>>(r: T, date?: string | null): T & Record<string, unknown> {
  if (!date) return { ...r, month: '', week: '', day: '', quarter: '', fy: '' };
  const [y, mo] = date.slice(0, 10).split('-').map(Number);
  const dow = (new Date(date.slice(0, 10) + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const fy = mo >= 4 ? y : y - 1;
  return { ...r, day: date.slice(0, 10), month: `${y}-${String(mo).padStart(2, '0')}`, week: addD(date.slice(0, 10), -dow), quarter: `${y}-Q${Math.floor((mo - 1) / 3) + 1}`, fy: `FY ${String(fy).slice(2)}-${String(fy + 1).slice(2)}` };
}
export const timeLabel = (field: string, key: string) =>
  field === 'month' && /^\d{4}-\d{2}$/.test(key) ? `${MONTHS[Number(key.slice(5)) - 1]} ${key.slice(2, 4)}` : field === 'week' && key ? `Wk of ${key.slice(8)}/${key.slice(5, 7)}` : key;

const TIME_FIELDS = ['month', 'week', 'day', 'quarter', 'fy'];
function nextKey(field: string, k: string): string {
  if (field === 'month') { const [y, mo] = k.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; }
  if (field === 'week') return addD(k, 7);
  if (field === 'day') return addD(k, 1);
  if (field === 'quarter') { const [y, q] = [Number(k.slice(0, 4)), Number(k.slice(-1))]; return q === 4 ? `${y + 1}-Q1` : `${y}-Q${q + 1}`; }
  return k;
}

export function runReport(rows: Record<string, any>[], spec: ReportSpec, today: string): ReportResult {
  const obj = reportObject(spec.object);
  if (!obj) throw new Error(`Unknown report object ${spec.object}`);
  const range = resolveRange(spec.dateRange, today);
  let data = rows.filter((r) => { const d = String(r[obj.dateField] ?? ''); return !d ? range.from === '0000-01-01' : d >= range.from && d <= range.to; });
  for (const f of spec.filters ?? []) {
    data = data.filter((r) => {
      const v = r[f.field];
      const cmp = (x: unknown) => String(x ?? '').toLowerCase();
      switch (f.op) {
        case 'eq': return cmp(v) === cmp(f.value);
        case 'neq': return cmp(v) !== cmp(f.value);
        case 'in': return (Array.isArray(f.value) ? f.value : [f.value]).map(cmp).includes(cmp(v));
        case 'contains': return cmp(v).includes(cmp(f.value));
        case 'gt': return Number(v) > Number(f.value);
        case 'gte': return Number(v) >= Number(f.value);
        case 'lt': return Number(v) < Number(f.value);
        case 'lte': return Number(v) <= Number(f.value);
      }
      return true;
    });
  }
  const mf = spec.measure.field;
  const agg = (list: Record<string, any>[]) => {
    if (spec.measure.agg === 'count') return list.length;
    const nums = list.map((r) => Number(r[mf!] ?? 0)).filter((n) => !isNaN(n));
    if (!nums.length) return 0;
    if (spec.measure.agg === 'sum') return nums.reduce((a, b) => a + b, 0);
    if (spec.measure.agg === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
    if (spec.measure.agg === 'min') return Math.min(...nums);
    return Math.max(...nums);
  };
  const fl = obj.fields.find((x) => x.key === mf)?.label ?? mf ?? '';
  const measureLabel = spec.measure.agg === 'count' ? `Number of ${obj.label.replace(/ \(.*\)$/, '').toLowerCase()}` : `${{ sum: 'Total', avg: 'Average', min: 'Minimum', max: 'Maximum' }[spec.measure.agg]} ${fl.charAt(0).toLowerCase() + fl.slice(1)}`;
  const [g1, g2] = spec.groupBy ?? [];
  const label = (k: string) => obj.fields.find((x) => x.key === k)?.label ?? k;
  const total = agg(data);
  const result: ReportResult = { title: spec.title || `${measureLabel.replace(/^Total amount incl\. GST/, 'Revenue (incl. GST)')}${g1 ? ` by ${label(g1).toLowerCase()}` : ''}`, spec, range, rows: [], total, count: data.length, measureLabel, groupLabel: g1 ? label(g1) : undefined, group2Label: g2 ? label(g2) : undefined };
  if (!g1) { result.rows = [{ label: 'Total', value: total }]; return result; }

  const groups = new Map<string, Record<string, any>[]>();
  for (const r of data) { const k = String(r[g1] ?? '') || '(blank)'; groups.set(k, [...(groups.get(k) ?? []), r]); }
  // fill gaps in time series so trends and forecasts are honest
  if (TIME_FIELDS.includes(g1) && g1 !== 'fy' && groups.size) {
    const keys = [...groups.keys()].filter((k) => k !== '(blank)').sort();
    let k = keys[0]; let guard = 0;
    while (k && k < keys[keys.length - 1] && guard++ < 500) { k = nextKey(g1, k); if (!groups.has(k)) groups.set(k, []); }
  }
  if (g2) {
    const s2 = [...new Set(data.map((r) => String(r[g2] ?? '') || '(blank)'))].sort();
    result.series2 = s2;
    for (const [k, list] of groups) for (const v2 of s2) result.rows.push({ label: k, label2: v2, value: agg(list.filter((r) => (String(r[g2] ?? '') || '(blank)') === v2)) });
  } else {
    for (const [k, list] of groups) result.rows.push({ label: k, value: agg(list) });
  }
  const isTime = TIME_FIELDS.includes(g1);
  if (isTime || spec.sort === 'label') result.rows.sort((a, b) => a.label.localeCompare(b.label) || String(a.label2).localeCompare(String(b.label2)));
  else result.rows.sort((a, b) => (spec.sort === 'value_asc' ? a.value - b.value : b.value - a.value));
  if (spec.limit && !g2 && !isTime) result.rows = result.rows.slice(0, spec.limit);

  if (spec.forecast && isTime && !g2 && result.rows.length >= 3) {
    const pts = result.rows.slice(-12);
    const n = pts.length, xs = pts.map((_, i) => i), ys = pts.map((p) => p.value);
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / (xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1);
    let k = result.rows[result.rows.length - 1].label;
    for (let i = 1; i <= spec.forecast; i++) {
      k = nextKey(g1, k);
      result.rows.push({ label: k, value: Math.max(0, Math.round(my + slope * (n - 1 + i - mx))), forecast: true });
    }
  }
  return result;
}
