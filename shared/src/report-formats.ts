/**
 * Test-specific report formats. Each format turns the report data (results snapshot, customer details,
 * client-specific additional information) into an editable layout that follows the laboratory's reference
 * report for that kind of test: same header box, tables, column order, merged cells, requirement tables and notes.
 * Formats only read data; nothing here changes results, templates or master records.
 */
import type { ObservationInput, ObservationResult, ObservationTemplate } from './observation';
import { formatValue, reportSpec } from './observation';
import { formatDate } from './numbering';
import { escapeHtml, newId, table, text, textToHtml, token, type Cell, type CellSpec, type ReportLayout, type Section, type TableSection } from './report-layout';

// ---------------------------------------------------------------- snapshot of one test

export interface TestSnap {
  id: number; code: string; name: string; method: string;
  sample: number; sampleCode: string; sampleLabel: string;
  started?: string | null; completed?: string | null;
  header: Record<string, string>; headerLabels: Record<string, string>;
  consts: Record<string, string>;
  results: Record<string, string>;
  grids: Record<string, { cols: { key: string; label: string; unit?: string }[]; rows: Record<string, string>[] }>;
  rows: { id: string; group?: string; name: string; unit: string; spec: string; value: string }[];
  /** Taken from an earlier (already issued) report of the same sample. */
  previous?: string | null;
}

/** Everything a report format may need from one evaluated observation sheet, formatted for printing. */
export function snapTest(t: { id: number; template_code: string; started_at?: string | null; completed_at?: string | null }, tpl: ObservationTemplate, res: ObservationResult, obs: ObservationInput,
  o: { name: string; method: string; sample: number; sampleCode: string; sampleLabel: string; shown?: (key: string) => boolean }): TestSnap {
  const header: Record<string, string> = {}, headerLabels: Record<string, string> = {};
  for (const f of tpl.headerFields) { header[f.key] = formatValue(res.scalars[f.key] as never); headerLabels[f.key] = f.label; }
  const consts: Record<string, string> = {};
  for (const c of tpl.constants) consts[c.key] = formatValue(res.scalars[c.key] as never);
  const results: Record<string, string> = {};
  for (const r of tpl.results) results[r.key] = formatValue(res.results[r.key] as never, r.decimals);
  for (const d of tpl.derived) if (!(d.key in results)) results[d.key] = formatValue(res.scalars[d.key] as never, d.decimals);
  const grids: TestSnap['grids'] = {};
  for (const g of tpl.grids) {
    const input = obs.grids?.[g.key] ?? [];
    const rows = (res.grids[g.key] ?? []).map((r, i) => ({ r, used: g.columns.some((c) => c.input && input[i]?.[c.key] !== undefined && input[i]?.[c.key] !== null && input[i]?.[c.key] !== '') || !g.columns.some((c) => c.input && !c.text) }))
      .filter((x) => x.used)
      .map(({ r }) => Object.fromEntries(g.columns.map((c) => [c.key, formatValue(r[c.key] as never, c.decimals)])));
    grids[g.key] = { cols: g.columns.map((c) => ({ key: c.key, label: c.label, unit: c.unit })), rows };
  }
  const rows: TestSnap['rows'] = [];
  tpl.reportRows.forEach((rr, i) => {
    if (o.shown && !o.shown(`row:${rr.group ?? ''}|${rr.name}|${rr.unit}`)) return;
    const value = formatValue(res.results[rr.result] as never, rr.decimals);
    if (!tpl.grids.length && value === '') return; // direct-entry sheet: blank = not tested
    rows.push({ id: `${t.id}.${i}`, group: rr.group, name: rr.name, unit: rr.unit, spec: reportSpec(rr, res), value });
  });
  return { id: t.id, code: t.template_code, name: o.name, method: o.method, sample: o.sample, sampleCode: o.sampleCode, sampleLabel: o.sampleLabel, started: t.started_at ?? null, completed: t.completed_at ?? null, header, headerLabels, consts, results, grids, rows };
}

// ---------------------------------------------------------------- inputs

export interface ReportCustomer { name: string; address: string; project?: string; customerRef?: string; contact?: { name?: string; phone?: string; email?: string } | null; gstin?: string }
export interface ExtraValue { key: string; label: string; value: string; sample?: string }
export interface ReportOptions {
  includeContact?: boolean;
  includeExtra?: boolean;
  /** Additional-information keys left off the report. */
  extraHidden?: string[];
  extraStyle?: 'line' | 'table';
  /** Tests (by id) and result rows (by row id) left off this report. */
  excluded?: string[];
  /** Force a format instead of the one picked from the tests. */
  format?: string;
}
export interface FormatInput {
  data: Record<string, any> & { tests?: TestSnap[]; customer?: ReportCustomer; extra?: ExtraValue[]; options?: ReportOptions };
  company?: { name?: string; shortName?: string };
}

// ---------------------------------------------------------------- helpers

const h = (s: unknown) => textToHtml(s);
const short = (d?: string | null) => { const f = formatDate(d ?? null); return f ? f.replace(/-(\d{2})(\d{2})$/, '-$2') : ''; };
const uniq = <T>(a: T[]) => [...new Set(a)];
/** Fixed decimals for a printed number (text values are left as they are). */
const fix = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v).toFixed(d) : v ?? '');
const L = (t: string): CellSpec => ({ t, al: 'left' });
const C = (t: string, extra: Partial<Cell> = {}): CellSpec => ({ t, al: 'center', ...extra });
const H = (html: string, extra: Partial<Cell> = {}): CellSpec => ({ h: html, al: 'center', ...extra });
const unitHtml = (u: string) => escapeHtml(u).replace(/mm²|mm2/g, 'mm<sup>2</sup>').replace(/m²/g, 'm<sup>2</sup>').replace(/m³/g, 'm<sup>3</sup>').replace(/cm³/g, 'cm<sup>3</sup>');
const chem = (s: string) => escapeHtml(s).replace(/([A-Z][a-z]?)₂/g, '$1<sub>2</sub>').replace(/([A-Z][a-z]?)₃/g, '$1<sub>3</sub>').replace(/([A-Z][a-z]?)₄/g, '$1<sub>4</sub>').replace(/₂/g, '<sub>2</sub>').replace(/₃/g, '<sub>3</sub>').replace(/₄/g, '<sub>4</sub>');

export function excludedSet(d: FormatInput['data']) { return new Set((d.options?.excluded ?? []).map(String)); }
/** Tests and rows that go on the report (after the user's parameter selection). */
export function activeTests(d: FormatInput['data']): TestSnap[] {
  const ex = excludedSet(d);
  return (d.tests ?? []).filter((t) => !ex.has(String(t.id))).map((t) => ({ ...t, rows: t.rows.filter((r) => !ex.has(r.id)) }));
}

/** Customer block: from the client master (name, address), the site (project) and the sample (customer reference). */
export function customerHtml(d: FormatInput['data']): string {
  const c: ReportCustomer = d.customer ?? { name: d.client?.name ?? '', address: d.client?.address ?? '' };
  // name / address unlocked and typed on this report win over the client master (this report only)
  const un = (d.unlocked ?? {}) as Record<string, boolean>;
  const name = un['client.name'] && d.client?.name ? d.client.name : c.name;
  const address = un['client.address'] && d.client?.address !== undefined ? d.client.address : c.address;
  const lines: string[] = [h(name)];
  if (address) lines.push(h(address));
  const extra: string[] = [];
  if (c.project) extra.push(`Project Name*: ${h(c.project)}`);
  const ref = d.customerRef !== undefined && d.customerRef !== null ? d.customerRef : c.customerRef;
  if (ref) extra.push(`Customer Reference No*: ${h(ref)}`);
  if (d.options?.includeContact && c.contact && (c.contact.name || c.contact.phone || c.contact.email)) {
    extra.push(`Contact: ${h([c.contact.name, c.contact.phone, c.contact.email].filter(Boolean).join(', '))}`);
  }
  if (d.amendment) extra.push(`<b>Amendment ${h(d.amendment.revision)} of report ${h(d.amendment.of)}: ${h(d.amendment.reason)}</b>`);
  return [lines.join('<br>'), extra.join('<br>')].filter(Boolean).join('<br><br>');
}

/** Client-specific additional information (supplier, vehicle no., invoice no. …) as one line per sample, or a table. */
export function extraSections(d: FormatInput['data']): Section[] {
  if (d.options?.includeExtra === false) return [];
  const hidden = new Set(d.options?.extraHidden ?? []);
  const items = (d.extra ?? []).filter((x) => x.value && !hidden.has(x.key));
  if (!items.length) return [];
  const samples = uniq(items.map((x) => x.sample ?? ''));
  if (d.options?.extraStyle === 'table') {
    const keys = uniq(items.map((x) => x.label));
    const rows: CellSpec[][] = [[...(samples.length > 1 ? [C('Sample')] : []), ...keys.map((k) => C(`${k}*`, { b: true }))]];
    for (const s of samples) rows.push([...(samples.length > 1 ? [C(s)] : []), ...keys.map((k) => C(items.find((x) => x.label === k && (x.sample ?? '') === s)?.value ?? '--'))]);
    const n = rows[0].length;
    return [table(Array(n).fill(100 / n), rows, { role: 'extra', mt: 2, sz: 9.5, head: 1 })];
  }
  return [text(samples.map((s) => `${samples.length > 1 && s ? `${h(s)}: ` : ''}${items.filter((x) => (x.sample ?? '') === s).map((x) => `${h(x.label)}*: ${h(x.value)}`).join(', ')}`).join('<br>'), { role: 'extra', mt: 2, sz: 10.5 })];
}

function notesSection(d: FormatInput['data']): Section[] {
  const notes: string[] = (Array.isArray(d.notes) ? d.notes : String(d.notes ?? '').split('\n')).map((s: string) => String(s).trim().replace(/^\(?\d{1,2}[.)]\s+/, '')).filter(Boolean);
  if (!notes.length) return [];
  const t = table([9, 91], notes.map((n, i) => [i === 0 ? { t: 'Note:', al: 'left', va: 'top' } : '', { h: `${i + 1}. ${h(n)}`, al: 'left' }]), { border: 'none', sz: 8, pad: 0, mt: 2, role: 'notes' });
  return [t];
}
function remarksSection(d: FormatInput['data'], fallback?: string): Section[] {
  const r = String(d.remarks ?? '').trim() || fallback;
  return r ? [text(`Remarks: ${h(r)}`, { role: 'remarks', mt: 2, sz: 10.5 })] : [];
}
const endSection = () => text('*** END OF REPORT ***', { al: 'center', mt: 3, role: 'end' });
const title = (s: string, sub?: string) => text(`<u>${escapeHtml(s)}</u>${sub ? `<br><u>${escapeHtml(sub)}</u>` : ''}`, { al: 'center', heading: true, mt: 4, mb: 2, sz: 10.5, role: 'title' });
const subTitle = (s: string) => text(escapeHtml(s), { heading: true, mt: 2, sz: 10.5 });

/** Report details box: customer on the left, report details on the right (as on the laboratory's reports). */
export function headerBox(d: FormatInput['data'], prefix: string, rows: [string, string | null | undefined][], opts: { customerWidth?: number } = {}): TableSection {
  const items = rows.filter(([, v]) => v !== null && v !== undefined && v !== '') as [string, string][];
  const all: [string, string][] = [[`Test Order/ Report No`, `${prefix ? `${prefix}: ` : ''}${token('number')}`], ...items];
  const cw = opts.customerWidth ?? 44;
  const grid: CellSpec[][] = all.map(([label, value], i) => {
    const v: CellSpec = /\{\{\w+\}\}/.test(value) ? H(escapeHtml(value)) : C(value);
    if (i === 0) return [{ t: 'Name and Address of the Customer', al: 'center' }, L(label), v];
    if (i === 1) return [{ h: customerHtml(d), al: 'left', va: 'middle', rs: all.length - 1, role: 'customer' }, L(label), v];
    return [null, L(label), v];
  });
  if (all.length === 1) grid.push([{ h: customerHtml(d), al: 'left', role: 'customer' }, '', '']);
  return table([cw, (100 - cw) * 0.45, (100 - cw) * 0.55], grid, { role: 'header', sz: 10.5 });
}
const commonRows = (d: FormatInput['data'], extra: [string, string | null | undefined][] = [], o: { method?: string } = {}): [string, string | null | undefined][] => [
  ['ULR No.', d.ulr], ['Date of Sample Received', d.receivedText], ['Date of Test', d.testDatesText], ['Date of Issue', token('issueText')],
  ['Specification*', d.specification], ['Condition of sample at Lab', d.condition], ['Source of sample', d.source], ...extra, ...(o.method ? [['Test Method', o.method] as [string, string]] : []),
];

/** Generic results table: S.No | Test | Units | Results… | Requirements | Test method (columns re-ordered per format). */
function resultsTable(tests: TestSnap[], d: FormatInput['data'], o: { order: ('sno' | 'test' | 'unit' | 'results' | 'spec' | 'method')[]; specLabel?: string; testLabel?: string; resultLabel?: string; sampleHeader?: boolean }): TableSection | null {
  const samples: { label: string }[] = d.samples ?? [];
  const sIdx = uniq(tests.map((t) => t.sample)).sort((a, b) => a - b);
  type R = { key: string; group?: string; name: string; unit: string; spec: string; method: string; values: string[] };
  const rows: R[] = [];
  for (const t of tests) for (const r of t.rows) {
    const key = `${t.code}|${r.group ?? ''}|${r.name}|${r.unit}`;
    let x = rows.find((y) => y.key === key);
    if (!x) { x = { key, group: r.group, name: r.name, unit: r.unit, spec: r.spec, method: t.method, values: sIdx.map(() => '') }; rows.push(x); }
    x.values[sIdx.indexOf(t.sample)] = r.value;
    if (!x.spec && r.spec) x.spec = r.spec;
  }
  if (!rows.length) return null;
  const grouped = rows.some((r) => r.group);
  const nRes = sIdx.length;
  const widths: Record<string, number> = { sno: 6, test: grouped ? 30 : 30, unit: 9, spec: 22, method: 17, results: 16 };
  const cols: number[] = [];
  const heads: CellSpec[][] = [[], []];
  const twoRows = nRes > 1 || o.sampleHeader;
  for (const k of o.order) {
    if (k === 'results') {
      for (let i = 0; i < nRes; i++) cols.push(Math.max(9, widths.results / Math.max(1, nRes / 1.5)));
      if (twoRows) {
        heads[0].push(C(o.sampleHeader ? 'Sample ID*' : o.resultLabel ?? 'Results', { cs: nRes }), ...Array(nRes - 1).fill(null));
        heads[1].push(...sIdx.map((i) => C(samples[i]?.label ?? `Sample ${i + 1}`)));
      } else heads[0].push(C(o.resultLabel ?? 'Results', { rs: 1 }));
      continue;
    }
    if (k === 'test' && grouped) { cols.push(14, 20); const c = C(o.testLabel ?? 'Name of Test', { cs: 2, rs: twoRows ? 2 : 1 }); heads[0].push(c, null); if (twoRows) heads[1].push(null, null); continue; }
    cols.push(widths[k]);
    const label = k === 'sno' ? 'S.No' : k === 'test' ? o.testLabel ?? 'Name of Test' : k === 'unit' ? 'Units' : k === 'spec' ? o.specLabel ?? 'Requirements as per IS' : 'Test Method';
    heads[0].push(C(label, { rs: twoRows ? 2 : 1 })); if (twoRows) heads[1].push(null);
  }
  const body: CellSpec[][] = [];
  const span = (i: number, f: (r: R) => string | undefined) => { const v = f(rows[i]); if (!v) return 1; if (i > 0 && f(rows[i - 1]) === v) return 0; let n = 1; while (i + n < rows.length && f(rows[i + n]) === v) n++; return n; };
  rows.forEach((r, i) => {
    const line: CellSpec[] = [];
    for (const k of o.order) {
      if (k === 'sno') line.push(C(String(i + 1)));
      else if (k === 'test') {
        if (grouped) {
          if (r.group) { const gs = span(i, (x) => x.group); line.push(gs > 0 ? C(r.group, { rs: gs }) : null, H(chem(r.name))); }
          else line.push(H(chem(r.name), { cs: 2, al: 'left' }), null);
        } else line.push(H(chem(r.name), { al: 'left' }));
      } else if (k === 'unit') line.push(H(unitHtml(r.unit || '--')));
      else if (k === 'results') line.push(...r.values.map((v) => C(v || '--')));
      else if (k === 'spec') line.push(H(chem(r.spec || '--')));
      else { const ms = span(i, (x) => x.method); line.push(ms > 0 ? C(r.method, { rs: ms }) : null); }
    }
    body.push(line);
  });
  const head = twoRows ? heads : [heads[0]];
  return table(cols, [...head, ...body], { head: head.length, role: 'results', sz: 10 });
}

/** Detailed tables, graphs and calculations generated by the observation sheets (kept as they are). */
const detailsSection = (d: FormatInput['data']): Section[] =>
  ((d.details ?? []).length || (d.borelogs ?? []).length || (d.charts ?? []).length || (d.intros ?? []).length || (d.tables ?? []).length) ? [{ id: newId('a'), type: 'auto', what: 'details' }] : [];

// ---------------------------------------------------------------- formats

type Builder = (tests: TestSnap[], d: FormatInput['data']) => Section[];

const cubes: Builder = (tests, d) => {
  const rows: CellSpec[][] = [[
    C('Sl. no'), C('Grade of concrete*'), C('Date of Casting*'), C('Date of Testing'), C('Age at test (days)*'), C('Weight (Kg)'), C('Load (KN)'), H('Compressive Strength (N/mm<sup>2</sup>)'), H('Average Compressive Strength (N/mm<sup>2</sup>)'),
  ]];
  let n = 0;
  for (const t of tests) {
    const cubesRows = t.grids.cubes?.rows.filter((r) => r.fc || r.load) ?? [];
    const k = Math.max(1, cubesRows.length);
    const grade = [t.header.grade?.replace(/^M(\d)/, 'M-$1'), t.header.element].filter(Boolean).map(h).join('<br>');
    for (let i = 0; i < k; i++) {
      const c = cubesRows[i] ?? {};
      const first = i === 0;
      rows.push([
        C(`${++n}.`), first ? H(grade || '--', { rs: k }) : null, first ? C(short(t.header.casting_date) || '--', { rs: k }) : null, first ? C(short(t.completed || t.started) || '--', { rs: k }) : null,
        first ? C(t.header.age || '--', { rs: k }) : null, C(fix(c.mass, 3) || '--'), C(fix(c.load, 1) || '--'), C(c.fc || '--'), first ? C(t.results.avg || '--', { rs: k }) : null,
      ]);
    }
  }
  const method = uniq(tests.map((t) => t.method)).join('; ');
  return [
    headerBox(d, 'Cubes', commonRows(d, [], { method: method.replace(/ : /g, ':') })),
    title('TEST REPORT ON COMPRESSIVE STRENGTH TEST OF CONCRETE CUBES'),
    table([6, 15, 11, 11, 9, 10, 10, 13, 15], rows, { head: 1, role: 'results', sz: 10 }),
    ...extraSections(d), ...remarksSection(d), ...notesSection(d),
    table([34, 22, 22, 22], [[C('Requirements as per IS 456:2000', { cs: 4 }), null, null, null], [C('3 days-45%'), C('7days-60%'), C('14days-85%'), C('28days-100%')]], { width: 70, align: 'center', mt: 4, role: 'requirements', sz: 10.5 }),
    endSection(),
  ];
};

/** Concrete cores (IS 516 Part 4): laid out like the cube report – one row per core, grade and average merged. */
const cores: Builder = (tests, d) => {
  const rows: CellSpec[][] = [[
    C('Sl. no'), C('Grade of concrete*'), C('Core ID / Location*'), C('Dia (mm)'), C('L/D ratio'), C('Load (KN)'), H('Cylinder Strength (N/mm<sup>2</sup>)'), H('Equivalent Cube Strength (N/mm<sup>2</sup>)'), H('Average Equivalent Cube Strength (N/mm<sup>2</sup>)'),
  ]];
  const acc: CellSpec[][] = [[C('Acceptance as per IS 456:2000, cl. 17.4.3', { cs: 4 }), null, null, null], [C('Grade'), C('Average ≥ 0.85 fck'), C('Lowest individual ≥ 0.75 fck'), C('Result')]];
  let n = 0;
  for (const t of tests) {
    const cs = t.grids.cores?.rows.filter((r) => r.fcube || r.p) ?? [];
    const k = Math.max(1, cs.length);
    const grade = [t.header.grade?.replace(/^M(\d)/, 'M-$1'), t.header.condition].filter(Boolean).map(h).join('<br>');
    cs.forEach((c, i) => {
      const first = i === 0;
      rows.push([C(`${++n}.`), first ? H(grade || '--', { rs: k }) : null, C(c.id || '--'), C(fix(c.d, 0) || '--'), C(c.ld || '--'), C(fix(c.p, 1) || '--'), C(c.fcyl || '--'), C(c.fcube || '--'), first ? C(t.results.avg || '--', { rs: k }) : null]);
    });
    const fck = Number(t.results.fck);
    if (Number.isFinite(fck) && fck > 0) acc.push([C(t.header.grade || '--'), C(`${t.results.avg || '--'} (≥ ${(0.85 * fck).toFixed(2)})`), C(`${t.results.minv || '--'} (≥ ${(0.75 * fck).toFixed(2)})`), C(t.results.verdict || '--')]);
  }
  const method = uniq(tests.map((t) => t.method)).join('; ');
  return [
    headerBox(d, 'Cores', commonRows(d, [], { method })),
    title('TEST REPORT ON COMPRESSIVE STRENGTH OF CONCRETE CORES'),
    table([6, 13, 15, 8, 8, 9, 13, 13, 15], rows, { head: 1, role: 'results', sz: 10 }),
    ...extraSections(d), ...remarksSection(d),
    ...(acc.length > 2 ? [table([16, 28, 32, 24], acc, { width: 80, align: 'center', mt: 4, role: 'requirements', sz: 10 })] : []),
    ...notesSection(d), endSection(),
  ];
};

/** IS 1786 mass per metre (kg/m): minimum and nominal, as printed on the laboratory's steel reports. */
const STEEL_MASS: [number, number, number][] = [[8, 0.363, 0.395], [10, 0.567, 0.617], [12, 0.834, 0.888], [16, 1.483, 1.580], [20, 2.366, 2.470], [25, 3.697, 3.850], [32, 6.058, 6.310]];
const STEEL_GRADE: Record<string, { ts: number; pct: number; ys: number; el: string; c: string; s: string; p: string; ps: string }> = {
  'Fe 415': { ts: 485, pct: 10, ys: 415, el: '14.5', c: '0.300', s: '0.060', p: '0.060', ps: '0.110' },
  'Fe 415D': { ts: 500, pct: 12, ys: 415, el: '18.0', c: '0.250', s: '0.045', p: '0.045', ps: '0.085' },
  'Fe 500': { ts: 545, pct: 8, ys: 500, el: '12.0', c: '0.320', s: '0.060', p: '0.060', ps: '0.115' },
  'Fe 500D': { ts: 565, pct: 10, ys: 500, el: '16.0', c: '0.270', s: '0.045', p: '0.045', ps: '0.085' },
  'Fe 550': { ts: 585, pct: 6, ys: 550, el: '10.0', c: '0.320', s: '0.060', p: '0.060', ps: '0.110' },
  'Fe 550D': { ts: 600, pct: 8, ys: 550, el: '14.5', c: '0.270', s: '0.045', p: '0.045', ps: '0.085' },
  'Fe 600': { ts: 660, pct: 6, ys: 600, el: '10.0', c: '0.320', s: '0.045', p: '0.045', ps: '0.085' },
};
const gradeKey = (g?: string) => { const m = /fe\s*(\d{3})\s*(d?)/i.exec(g ?? ''); return m ? `Fe ${m[1]}${m[2] ? 'D' : ''}` : ''; };
const steelCommon = (tests: TestSnap[], d: FormatInput['data']) => commonRows(d, [['No. of samples tested', tests.length ? `${String(tests.length).padStart(2, '0')} only` : '']]);

const steelPhysical: Builder = (tests, d) => {
  const rows: CellSpec[][] = [
    [C('S. No'), C('Dia (mm)*'), C('Make*'), C('Weight / Meter (Kg/m)'), H('U.T.S (N/mm<sup>2</sup>)'), H('Yield Stress (N/mm<sup>2</sup>)'), C('Elongation (%)'), C('Bend Test'), C('Re Bend Test')],
    [C('Test Method as per IS', { cs: 3 }), null, null, C('1786-2008 (RA 2018)'), C('1608 (Part-1): 2022', { cs: 3 }), null, null, C('1599:2023'), C('1786-2008 (RA 2018)')],
  ];
  const sorted = [...tests].sort((a, b) => Number(a.header.dia) - Number(b.header.dia));
  const make = (t: TestSnap) => [t.header.brand, t.header.grade].filter(Boolean).join(' ');
  sorted.forEach((t, i) => {
    const m = make(t);
    let span = 1; if (i > 0 && make(sorted[i - 1]) === m) span = 0; else while (i + span < sorted.length && make(sorted[i + span]) === m) span++;
    rows.push([C(`${i + 1}.`), C(t.header.dia || '--'), span ? C(m || '--', { rs: span }) : null, C(t.results.mpm || '--'), C(t.results.uts || '--'), C(t.results.ys || '--'), C(t.results.el || '--'), C(t.results.bend || '--'), C(t.results.rebend || '--')]);
  });
  const grades = uniq(sorted.map((t) => gradeKey(t.header.grade)).filter((g) => STEEL_GRADE[g]));
  const conforms = sorted.length > 0 && sorted.every((t) => /^conforms/i.test(t.results.verdict ?? ''));
  const req: CellSpec[][] = [
    [C('Dia (mm)', { cs: 2 }), null, ...STEEL_MASS.map(([dd]) => C(String(dd)))],
    [C('Mass (kg/m)', { rs: 2 }), C('Min.'), ...STEEL_MASS.map(([, mn]) => C(mn.toFixed(3)))],
    [null, C('Max.'), ...STEEL_MASS.map(([, , mx]) => C(mx.toFixed(3)))],
  ];
  const reqT = table([9, 7, ...STEEL_MASS.map(() => 84 / STEEL_MASS.length)], req, { role: 'requirements', sz: 9.5, mt: 2 });
  const gradeRows: CellSpec[][] = [[C('Grade'), H('Ultimate Tensile Strength (N/mm<sup>2</sup>) (Min.)', { cs: 2 }), null, H('0.2% Proof Stress / Yield Stress (N/mm<sup>2</sup>) (Min.)'), C('Elongation (%) (Min.)')]];
  for (const g of grades) { const x = STEEL_GRADE[g]; gradeRows.push([C(g), C(`${x.ts} or ${x.pct}% more than actual proof Stress whichever is Higher`, { cs: 2 }), null, C(String(x.ys)), C(x.el)]); }
  return [
    headerBox(d, 'Steel P', steelCommon(tests, d)),
    title('TEST REPORT ON PHYSICAL PROPERTIES OF TMT BARS'),
    table([7, 7, 13, 12, 11, 12, 11, 13.5, 13.5], rows, { head: 1, role: 'results', sz: 10 }),
    ...extraSections(d),
    ...remarksSection(d, conforms ? `Above tested samples conform to IS 1786-2008${grades.length === 1 ? ` (${grades[0]})` : ''}.` : undefined),
    text(`Requirements as per IS: 1786-2008 (Reaffirmed 2018)`, { mt: 3, sz: 10.5, heading: true }),
    reqT,
    ...(grades.length ? [table([12, 25, 25, 26, 12], gradeRows, { role: 'requirements', sz: 9.5 })] : []),
    ...notesSection(d), endSection(),
  ];
};

const steelChemical: Builder = (tests, d) => {
  const sorted = [...tests].sort((a, b) => Number(a.header.dia) - Number(b.header.dia));
  const rows: CellSpec[][] = [[C('S. No'), C('Dia (mm)*'), C('Make*'), C('Test Method'), C('C %'), C('P %'), C('S %'), C('P + S %'), C('Remarks')]];
  const make = (t: TestSnap) => [t.header.brand, t.header.grade].filter(Boolean).join(' ');
  sorted.forEach((t, i) => {
    const m = make(t);
    let span = 1; if (i > 0 && make(sorted[i - 1]) === m) span = 0; else while (i + span < sorted.length && make(sorted[i + span]) === m) span++;
    rows.push([C(`${i + 1}.`), C(t.header.dia || '--'), span ? C(m || '--', { rs: span }) : null, i === 0 ? C(t.method, { rs: sorted.length }) : null,
      C(t.results.r_c || '--'), C(t.results.r_p || '--'), C(t.results.r_s || '--'), C(t.results.r_ps || '--'), C(t.results.verdict || '--')]);
  });
  const req: CellSpec[][] = [[C('Requirement as per IS: 1786-2008 (RA 2018) (%max) with tolerance', { cs: 5 }), null, null, null, null], [C('Grade'), C('C % (Max.)'), C('P % (Max.)'), C('S % (Max.)'), C('P + S % (Max.)')]];
  for (const g of ['Fe 500', 'Fe 500D', 'Fe 550', 'Fe 550D', 'Fe 600']) { const x = STEEL_GRADE[g]; req.push([C(g), C(x.c), C(x.p), C(x.s), C(x.ps)]); }
  return [
    headerBox(d, 'Steel C', steelCommon(tests, d)),
    title('TEST REPORT ON CHEMICAL ANALYSIS OF TMT BARS'),
    table([7, 8, 13, 15, 10, 10, 10, 12, 15], rows, { head: 1, role: 'results', sz: 10 }),
    ...extraSections(d), ...remarksSection(d),
    table([20, 20, 20, 20, 20], req, { role: 'requirements', sz: 9.5, mt: 4 }),
    ...notesSection(d), endSection(),
  ];
};

function sieveCoarse(t: TestSnap): Section[] {
  const g = t.grids.sv; if (!g) return [];
  const rows = g.rows.filter((r) => r.pass !== '');
  if (!rows.length) return [];
  const agg = t.header.agg || 'coarse aggregate';
  const out: CellSpec[][] = [
    [C('IS Sieve Size (mm)', { rs: 2 }), C('% Cumulative weight', { cs: 2 }), null, C(`Specification as per IS:383-2016 in respect of ${agg} (% passing)`), C('Test Method', { rs: 2 })],
    [null, C('Retained %'), C('Passing %'), C(/single/i.test(agg) ? 'Single size' : 'Graded'), null],
  ];
  rows.forEach((r, i) => out.push([C(r.size || r.sieve), C(r.cump || '--'), C(r.pass), C(r.limit || '--'), i === 0 ? C(t.method, { rs: rows.length }) : null]));
  return [subTitle(`SIEVE ANALYSIS – ${agg}${t.sampleLabel ? ` (${t.sampleLabel})` : ''}`), table([16, 17, 17, 32, 18], out, { head: 2, role: 'results', sz: 10 })];
}
function sieveFine(t: TestSnap): Section[] {
  const g = t.grids.sv; if (!g) return [];
  const rows = g.rows.filter((r) => r.pass !== '');
  if (!rows.length) return [];
  const out: CellSpec[][] = [
    [C('IS Sieve Size', { rs: 2 }), C('% Cumulative weight', { cs: 2 }), null, C('Specification as per IS:383-2016 in respect of fine aggregate (% passing)', { cs: 4 }), null, null, null, C('Test Method', { rs: 2 })],
    [null, C('Retained %'), C('Passing %'), C('ZONE I'), C('ZONE II'), C('ZONE III'), C('ZONE IV'), null],
  ];
  rows.forEach((r, i) => out.push([C(r.sieve || r.size), C(r.cump || '--'), C(r.pass), C(r.z1 || '--'), C(r.z2 || '--'), C(r.z3 || '--'), C(r.z4 || '--'), i === 0 ? C(t.method, { rs: rows.length }) : null]));
  const sections: Section[] = [subTitle(`SIEVE ANALYSIS${t.sampleLabel ? ` (${t.sampleLabel})` : ''}:`), table([14, 11, 11, 11, 11, 11, 11, 20], out, { head: 2, role: 'results', sz: 9.5 })];
  if (t.results.zone) sections.push(text(`Grading: ${h(t.results.zone)}${t.results.fm ? `; Fineness modulus: ${h(t.results.fm)}` : ''}`, { sz: 9.5, mt: 1 }));
  return sections;
}

const aggregate = (fine: boolean): Builder => (tests, d) => {
  const sieves = tests.filter((t) => t.code === (fine ? 'FA-SIEVE' : 'CA-SIEVE'));
  const others = tests.filter((t) => !sieves.includes(t));
  const props = resultsTable(others, d, { order: ['test', 'results', 'spec', 'method'], testLabel: 'Test Conducted', specLabel: 'Requirements as per IS: 383-2016' });
  return [
    headerBox(d, fine ? 'F Agg' : 'C Agg', commonRows(d, [['Make / Source*', d.make || '']])),
    title(fine ? 'TEST REPORT ON FINE AGGREGATE' : 'TEST REPORT ON COARSE AGGREGATE SAMPLE'),
    ...sieves.flatMap((t) => (fine ? sieveFine(t) : sieveCoarse(t))),
    ...(props ? [props] : []),
    ...extraSections(d), ...remarksSection(d), ...((d.charts ?? []).length ? [{ id: newId('a'), type: 'auto' as const, what: 'charts' as const }] : []), ...notesSection(d), endSection(),
  ];
};

/** Cement: the details box also carries the dates and the environmental conditions in a lower band. */
function cementHeader(d: FormatInput['data'], prefix: string, tests: TestSnap[]): TableSection {
  const env = tests.map((t) => [t.header.temp && `Temp.: ${t.header.temp}°C`, t.header.rh && `RH: ${t.header.rh}%`].filter(Boolean).join(', ')).find(Boolean) ?? '';
  const right: [string, string][] = ([
    ['Test Order / Report No.', `${prefix}: ${token('number')}`], ['ULR No.', d.ulr || ''], ['Condition of sample at lab', d.condition || ''],
    ['Sample Specification*', d.specification || ''], ['Qty of sample Received', d.quantity || ''], ['Source of sample', d.source || ''],
  ] as [string, string][]).filter(([k, v], i) => i === 0 || v || k === 'ULR No.');
  const rows: CellSpec[][] = right.map(([k, v], i) => [
    i === 0 ? C('Name and Address of the Customer', { cs: 2 }) : i === 1 ? { h: customerHtml(d), al: 'left', cs: 2, rs: right.length - 1, role: 'customer' } : null, null,
    L(k), /\{\{/.test(v) ? H(escapeHtml(v)) : C(v),
  ]);
  rows.push([L('Date of Sample Received'), C(d.receivedText || ''), L('Environmental conditions'), C(env || '--')]);
  rows.push([L('Date of Test'), C(d.testDatesText || ''), C(''), C('')]);
  rows.push([L('Date of Issue'), H(token('issueText')), C(''), C('')]);
  return table([24, 21, 22, 33], rows, { role: 'header', sz: 10.5 });
}
const cementPhysical: Builder = (tests, d) => {
  const t = resultsTable(tests, d, { order: ['sno', 'test', 'unit', 'results', 'spec', 'method'], testLabel: 'Test Parameter', specLabel: 'Requirements as per IS 269: 2015' });
  return [cementHeader(d, 'Cement P', tests), title('TEST REPORT ON PHYSICAL PROPERTIES OF CEMENT'), ...(t ? [t] : []), ...extraSections(d), ...remarksSection(d), ...detailsSection(d), ...notesSection(d), endSection()];
};
const cementChemical: Builder = (tests, d) => {
  const t = resultsTable(tests, d, { order: ['sno', 'test', 'unit', 'results', 'spec', 'method'], testLabel: 'Test Conducted', specLabel: 'Requirements as per IS: 269: 2015 (RA 2020) Clause 6.1' });
  return [cementHeader(d, 'Cement C', tests), title('TEST REPORT ON CHEMICAL PROPERTIES OF CEMENT'), ...(t ? [t] : []), ...extraSections(d), ...remarksSection(d), ...notesSection(d), endSection()];
};
const ggbs = (chemical: boolean): Builder => (tests, d) => {
  const t = resultsTable(tests, d, { order: chemical ? ['sno', 'test', 'unit', 'results', 'spec'] : ['sno', 'test', 'results', 'spec', 'method'], testLabel: chemical ? 'Test Conducted' : 'Test Parameters', specLabel: 'Requirements as per IS: 16714:2018' });
  const method = uniq(tests.map((x) => x.method)).join('; ');
  return [
    headerBox(d, chemical ? 'GGBS C' : 'GGBS P', commonRows(d, [], { method: chemical ? method : undefined })),
    title(chemical ? 'TEST REPORT ON CHEMICAL PROPERTIES OF GGBS SAMPLE' : 'TEST REPORT ON PHYSICAL PROPERTIES OF GGBS', chemical ? '(GROUND GRANULATED BLAST FURNACE SLAG)' : undefined),
    ...(t ? [t] : []), ...extraSections(d), ...remarksSection(d), ...notesSection(d), endSection(),
  ];
};

const soil: Builder = (tests, d) => {
  const t = resultsTable(tests, d, { order: ['sno', 'test', 'unit', 'method', 'results'], sampleHeader: true, resultLabel: 'Results' });
  return [
    headerBox(d, 'Soil', commonRows(d)),
    text('<u>TABLE-1</u><br><u>TEST REPORT ON ' + escapeHtml(String(d.materialUpper || 'SOIL')) + '</u>', { al: 'center', heading: true, mt: 1, sz: 10.5, role: 'title' }),
    ...(t ? [t] : []), ...extraSections(d), ...remarksSection(d), ...detailsSection(d), ...notesSection(d), endSection(),
  ];
};

/** Field density: one column per location, one row per measured quantity. */
const fieldDensity: Builder = (tests, d) => {
  const locs: { label: string; sample: string; r: Record<string, string>; t: TestSnap }[] = [];
  for (const t of tests) for (const r of t.grids.t?.rows.filter((x) => x.dd) ?? []) locs.push({ label: r.loc || '', sample: t.sampleLabel, r, t });
  const t0 = tests[0];
  const cc = t0?.code === 'SOIL-FDD-CC';
  const items: [string, (x: (typeof locs)[number]) => string][] = cc
    ? [
      ['Wt of soil + Core Cutter in (gm)', (x) => x.r.m],
      ['Empty Wt. of Core Cutter in (gm)', (x) => x.t.consts.mc],
      ['Weight of soil in (gm)', (x) => { const a = Number(x.r.m), b = Number(x.t.consts.mc); return Number.isFinite(a) && Number.isFinite(b) && x.r.m && x.t.consts.mc ? (a - b).toFixed(1) : ''; }],
      ['Bulk Density γ gr/cc', (x) => x.r.bd],
    ]
    : [
      ['Mass of excavated soil (gm)', (x) => x.r.ww], ['Sand in hole (gm)', (x) => x.r.sand], ['Volume of hole (cc)', (x) => x.r.vh], ['Bulk Density γ gr/cc', (x) => x.r.bd],
    ];
  const moist: [string, (x: (typeof locs)[number]) => string][] = [
    ['Weight of Dish + wet Soil (gm)', (x) => x.r.c2], ['Weight of Dish + Dry Soil (gm)', (x) => x.r.c3], ['Field Moisture Content, FMC(%)', (x) => x.r.w],
    ['Field Dry Density γd (FDD)', (x) => x.r.dd], ['Degree of Compaction ( % )', (x) => x.r.dc],
  ];
  const n = Math.max(1, locs.length);
  const rows: CellSpec[][] = [
    [C('Description/Sample ID*', { rs: 2 }), ...locs.map((_, i) => C(`Sample ${i + 1}`))],
    [null, ...locs.map((x) => C(x.label || x.sample || '--'))],
  ];
  for (const [label, f] of [...items, ...moist]) rows.push([C(label), ...locs.map((x) => C(f(x) || '--'))]);
  const mdd = uniq(tests.map((t) => t.header.mdd).filter(Boolean)).join(' / ');
  rows.push([C('Maximum Dry Density (MDD)gr/cc*'), C(mdd || '--', { cs: n }), ...Array(n - 1).fill(null)]);
  const first = 36, w = (100 - first) / n;
  const method = uniq(tests.map((t) => t.method)).join('<br>');
  return [
    headerBox(d, 'Soil', [...commonRows(d), ['Test method', method.replace(/<br>/g, '\n')]]),
    title(cc ? 'TEST REPORT ON FIELD DRY DENSITY (FDD) & FIELD MOISTURE CONTENT (FMC) BY CORE CUTTER METHOD' : 'TEST REPORT ON FIELD DRY DENSITY (FDD) & FIELD MOISTURE CONTENT (FMC) BY SAND REPLACEMENT METHOD'),
    table([first, ...Array(n).fill(w)], rows, { head: 2, role: 'results', sz: 10 }),
    ...extraSections(d), ...remarksSection(d), ...notesSection(d), endSection(),
  ];
};

const generic: Builder = (tests, d) => {
  const t = resultsTable(tests, d, { order: ['sno', 'test', 'unit', 'method', 'spec', 'results'], sampleHeader: (d.samples ?? []).length > 0 });
  return [
    headerBox(d, '', commonRows(d)),
    text('<u>TABLE-1</u><br><u>TEST REPORT ON ' + escapeHtml(String(d.materialUpper || '')) + '</u>', { al: 'center', heading: true, mt: 1, sz: 10.5, role: 'title' }),
    ...(t ? [t] : []), ...extraSections(d), ...remarksSection(d), ...detailsSection(d), ...notesSection(d), endSection(),
  ];
};

export const REPORT_FORMATS: Record<string, { label: string; build: Builder; codes?: RegExp }> = {
  cubes: { label: 'Concrete cubes – compressive strength', build: cubes, codes: /^CUBE-COMP$/ },
  cores: { label: 'Concrete cores – compressive strength', build: cores, codes: /^NDT-CORE$/ },
  'steel-physical': { label: 'Steel (TMT) – physical properties', build: steelPhysical, codes: /^STEEL-TMT$/ },
  'steel-chemical': { label: 'Steel (TMT) – chemical analysis', build: steelChemical, codes: /^STEEL-CHEM$/ },
  'coarse-aggregate': { label: 'Coarse aggregate', build: aggregate(false), codes: /^CA-/ },
  'fine-aggregate': { label: 'Fine aggregate', build: aggregate(true), codes: /^FA-/ },
  'cement-physical': { label: 'Cement – physical properties', build: cementPhysical, codes: /^CEM-(?!CHEM)/ },
  'cement-chemical': { label: 'Cement – chemical properties', build: cementChemical, codes: /^CEM-CHEM$/ },
  'ggbs-physical': { label: 'GGBS – physical properties', build: ggbs(false), codes: /^GGBS-PHY$/ },
  'ggbs-chemical': { label: 'GGBS – chemical properties', build: ggbs(true), codes: /^GGBS-CHEM$/ },
  'field-density': { label: 'Soil – field dry density', build: fieldDensity, codes: /^SOIL-FDD-/ },
  soil: { label: 'Soil – laboratory tests', build: soil, codes: /^(SOIL-(?!FDD)|PROCTOR|GRADATION-SOIL|ATTERBERG|CBR|FSI)/ },
  generic: { label: 'General (all other tests)', build: generic },
};

/** The format that fits the tests on a report (the one most tests belong to). */
export function pickFormat(codes: string[]): string {
  const count: Record<string, number> = {};
  for (const c of codes) { const f = Object.entries(REPORT_FORMATS).find(([, v]) => v.codes?.test(c))?.[0] ?? 'generic'; count[f] = (count[f] ?? 0) + 1; }
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : 'generic';
}

/** Generate the editable layout of a report from its data. */
export function buildLayout(input: FormatInput): ReportLayout {
  const d = input.data;
  const tests = activeTests(d);
  const fmt = d.options?.format && REPORT_FORMATS[d.options.format] ? d.options.format : pickFormat(tests.map((t) => t.code));
  if (!d.tests) { // reports drafted before formats existed: general layout from the result rows
    return { format: 'generic', version: 1, sections: legacyLayout(d) };
  }
  // tests that belong to another format are still shown (general results table) rather than dropped
  const main = tests.filter((t) => fmt === 'generic' || REPORT_FORMATS[fmt].codes?.test(t.code));
  const rest = tests.filter((t) => !main.includes(t));
  const sections = REPORT_FORMATS[fmt].build(main, d);
  if (rest.length) {
    const t = resultsTable(rest, d, { order: ['sno', 'test', 'unit', 'method', 'spec', 'results'], sampleHeader: true });
    if (t) { const at = sections.findIndex((s) => s.role === 'remarks' || s.role === 'notes' || s.role === 'end'); sections.splice(at < 0 ? sections.length : at, 0, subTitle('OTHER TESTS'), t); }
  }
  return { format: fmt, version: 1, sections };
}

function legacyLayout(d: FormatInput['data']): Section[] {
  const rows = (d.rows ?? []) as { group?: string; name: string; unit: string; method: string; spec?: string; values: string[] }[];
  const tests: TestSnap[] = (d.samples ?? [{ label: 'Results' }]).map((s: any, i: number) => ({
    id: -1 - i, code: 'LEGACY', name: '', method: '', sample: i, sampleCode: s.code ?? '', sampleLabel: s.label ?? '', header: {}, headerLabels: {}, consts: {}, results: {}, grids: {},
    rows: rows.map((r, k) => ({ id: `l.${k}`, group: r.group, name: r.name, unit: r.unit, spec: r.spec ?? '', value: r.values[i] ?? '' })),
  }));
  // the method lives on the row in old reports
  const t = resultsTable(tests.map((x) => ({ ...x, rows: x.rows })), d, { order: ['sno', 'test', 'unit', 'method', 'spec', 'results'], sampleHeader: true });
  if (t) { // put the methods back
    let k = 0;
    for (let i = t.head ?? 0; i < t.rows.length; i++, k++) { const mi = t.rows[0].findIndex((c) => /Test Method/.test(c.h)); if (mi >= 0 && !t.rows[i][mi].m) t.rows[i][mi].h = textToHtml(rows[k]?.method ?? ''); }
  }
  return [headerBox(d, '', commonRows(d)), text(`<u>TEST REPORT ON ${escapeHtml(String(d.materialUpper || ''))}</u>`, { al: 'center', heading: true, mt: 2, role: 'title' }), ...(t ? [t] : []), ...extraSections(d), ...remarksSection(d), ...detailsSection(d), ...notesSection(d), endSection()];
}

/** Refresh the data-driven parts (customer box, additional information) of an edited layout without touching the rest. */
export function refreshRoles(layout: ReportLayout, input: FormatInput, roles: ('customer' | 'extra' | 'notes' | 'remarks' | 'header')[]): ReportLayout {
  const d = input.data;
  const fresh = roles.includes('header') ? buildLayout(input).sections.find((s) => s.type === 'table' && s.role === 'header') : undefined;
  let sections = layout.sections.map((s) => {
    if (fresh && s.type === 'table' && s.role === 'header') return { ...fresh, id: s.id };
    if (roles.includes('customer') && s.type === 'table') return { ...s, rows: s.rows.map((r) => r.map((c) => (c.role === 'customer' ? { ...c, h: customerHtml(d) } : c))) };
    return s;
  });
  for (const role of ['extra', 'notes', 'remarks'] as const) {
    if (!roles.includes(role)) continue;
    const fresh = role === 'extra' ? extraSections(d) : role === 'notes' ? notesSection(d) : remarksSection(d);
    const at = sections.findIndex((s) => s.type !== 'auto' && s.role === role);
    sections = sections.filter((s) => s.type === 'auto' || s.role !== role);
    let pos = at;
    if (pos < 0) { // place it after the results / before remarks, notes and the end line
      const order = role === 'extra' ? ['remarks', 'notes', 'requirements', 'end'] : role === 'remarks' ? ['notes', 'requirements', 'end'] : ['end'];
      pos = sections.findIndex((s) => s.type !== 'auto' && order.includes(s.role ?? ''));
      if (pos < 0) pos = sections.length;
    } else pos = Math.min(pos, sections.length);
    sections.splice(pos, 0, ...fresh);
  }
  return { ...layout, sections };
}

