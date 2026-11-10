import { describe, expect, it } from 'vitest';
import {
  anchorOf, buildLayout, normalizeObservation, cleanHtml, cleanLayout, deleteCol, deleteRow, evaluateObservation, CIVIL_LAB_TEMPLATES, fillTokens, htmlToText, insertCol, insertRow, mergeCells,
  pickFormat, refreshRoles, resizeCol, snapTest, splitCell, table, unfillTokens, type TableSection, type TestSnap,
} from '../src/index';

const grid = (t: TableSection) => t.rows.map((r) => r.map((c) => (c.m ? '·' : htmlToText(c.h) || '_') + ((c.rs ?? 1) > 1 ? `↓${c.rs}` : '') + ((c.cs ?? 1) > 1 ? `→${c.cs}` : '')).join(' '));

describe('sanitising rich text', () => {
  it('keeps simple formatting and drops scripts, handlers and links', () => {
    expect(cleanHtml('<b>Bold</b> <i>it</i> <u>u</u> m<sup>2</sup> H<sub>2</sub>O<br>next')).toBe('<b>Bold</b> <i>it</i> <u>u</u> m<sup>2</sup> H<sub>2</sub>O<br>next');
    expect(cleanHtml('<script>alert(1)</script>ok')).toBe('ok');
    expect(cleanHtml('<img src=x onerror=alert(1)>a')).toBe('a');
    expect(cleanHtml('<a href="javascript:x">link</a>')).toBe('link');
    expect(cleanHtml('<span style="font-size: 12pt; background:url(x); color: red" onclick="x">s</span>')).toBe('<span style="font-size: 12pt; color: red">s</span>');
    expect(cleanHtml('<strong>x</strong><em>y</em>')).toBe('<b>x</b><i>y</i>');
    expect(cleanHtml('<font size="5">big</font>')).toBe('<span style="font-size: 18pt">big</span>');
    expect(cleanHtml('a < b & c')).toBe('a &lt; b &amp; c');
    expect(cleanHtml('<b>unclosed')).toBe('<b>unclosed</b>');
    expect(cleanHtml('<div><p>x</p></div>')).toBe('<div><p>x</p></div>');
  });
  it('turns token chips back into tokens', () => {
    const shown = fillTokens('No: {{number}}', { number: null }, true);
    expect(shown).toContain('data-token="number"');
    expect(unfillTokens(cleanHtml(shown))).toBe('No: {{number}}');
    expect(fillTokens('No: {{number}}', { number: 'R/1' })).toBe('No: R/1');
    expect(fillTokens('No: {{number}}', {})).toBe('No: (on issue)');
  });
});

describe('table editing', () => {
  const t0 = () => table([25, 25, 25, 25], [['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h'], ['i', 'j', 'k', 'l']]);
  it('merges and splits cells', () => {
    let t = mergeCells(t0(), 0, 0, 1, 1);
    expect(grid(t)).toEqual(['a\nb\ne\nf↓2→2 · c d', '· · g h', 'i j k l']);
    expect(anchorOf(t, 1, 1)).toEqual([0, 0]);
    t = splitCell(t, 1, 1);
    expect(grid(t)).toEqual(['a\nb\ne\nf _ c d', '_ _ g h', 'i j k l']);
  });
  it('grows a merge that would cut through another merged cell', () => {
    let t = mergeCells(t0(), 0, 1, 1, 1); // b over f
    t = mergeCells(t, 1, 0, 1, 1); // e with the lower half of b/f → must include row 0
    expect(t.rows[0][0].rs).toBe(2); expect(t.rows[0][0].cs).toBe(2);
  });
  it('inserts and deletes rows through merged cells', () => {
    let t = mergeCells(t0(), 0, 0, 2, 0); // a e i
    t = insertRow(t, 1);
    expect(t.rows.length).toBe(4); expect(t.rows[0][0].rs).toBe(4); expect(t.rows[1][0].m).toBe(true);
    t = deleteRow(t, 0); // anchor moves down, keeps content
    expect(htmlToText(t.rows[0][0].h)).toContain('a'); expect(t.rows[0][0].rs).toBe(3);
    t = deleteRow(t, 2);
    expect(t.rows[0][0].rs).toBe(2);
  });
  it('inserts and deletes columns through merged cells', () => {
    let t = mergeCells(t0(), 0, 0, 0, 2); // a b c
    t = insertCol(t, 1);
    expect(t.cols.length).toBe(5); expect(t.rows[0][0].cs).toBe(4); expect(t.rows[1][1].m).toBeFalsy();
    t = deleteCol(t, 0);
    expect(t.rows[0][0].cs).toBe(3); expect(htmlToText(t.rows[0][0].h)).toContain('a');
    expect(Math.round(t.cols.reduce((a, b) => a + b, 0))).toBe(100);
  });
  it('resizes columns without losing width', () => {
    const t = resizeCol(t0(), 1, 10);
    expect(t.cols).toEqual([25, 35, 15, 25]);
    expect(resizeCol(t0(), 1, 50).cols[2]).toBe(3); // never below 3 %
  });
});

describe('cleaning a layout from the browser', () => {
  it('drops unknown parts and sanitises every cell', () => {
    const l = cleanLayout({ format: 'cubes', sections: [{ id: 'x', type: 'table', cols: [50, 50], rows: [[{ h: '<script>x</script>A', cs: 99 }, { h: 'B', m: true }]] }, { type: 'text', h: '<b>t</b><iframe></iframe>', sz: 999 }, { type: 'evil' }] });
    expect(l!.sections.length).toBe(2);
    const t = l!.sections[0] as TableSection;
    expect(t.rows[0][0].h).toBe('A'); expect(t.rows[0][0].cs).toBe(2);
    expect((l!.sections[1] as any).h).toBe('<b>t</b>'); expect((l!.sections[1] as any).sz).toBe(30);
    expect(t.rows[0][1].h).toBe(''); // empty / covered cells keep an empty text
    expect(cleanLayout({ sections: 'no' })).toBeNull();
  });
});

const tpl = (code: string) => CIVIL_LAB_TEMPLATES.filter((t) => t.code === code).sort((a, b) => b.version - a.version)[0];
function snap(id: number, code: string, header: Record<string, unknown>, grids: Record<string, any[]>, extra: Partial<TestSnap> = {}): TestSnap {
  const t = tpl(code);
  // fixed rows (sieve sizes) are filled in by the sheet
  const full = Object.fromEntries(Object.entries(grids).map(([k, rows]) => { const fr = (t.grids.find((g) => g.key === k) as any)?.fixedRows; return [k, fr ? fr.map((f: any, i: number) => ({ ...f, ...(rows[i] ?? {}) })) : rows]; }));
  const obs = normalizeObservation(t, { header, grids: full } as any).input;
  const res = evaluateObservation(t, obs);
  return { ...snapTest({ id, template_code: code, completed_at: '2026-10-20' }, t, res, obs, { name: t.name, method: t.method, sample: 0, sampleCode: 'S-1', sampleLabel: '' }), ...extra };
}
const base = { receivedText: '20-10-2026', testDatesText: '20-10-2026', specification: '150 x 150 x 150mm Size cube', source: 'Sample supplied by the customer', condition: 'Satisfactory', notes: ['(*) Details as furnished by the customer.', 'Above test results relate only to the samples tested.'], samples: [{ label: 'Sample-01' }], materialUpper: 'CONCRETE' };
const customer = { name: 'Example Infra Pvt Ltd', address: '6th Floor, Example Towers\nHyderabad-500 032.', project: 'Pristinia', customerRef: 'EI/QC/Oct/2026', contact: { name: 'R. Kumar', phone: '90000 00000', email: 'qc@example.test' } };
const all = (l: ReturnType<typeof buildLayout>) => l.sections.map((s) => (s.type === 'table' ? s.rows.map((r) => r.map((c) => htmlToText(c.h)).join('|')).join('\n') : s.type === 'text' ? htmlToText(s.h) : '[auto]')).join('\n');

describe('report formats', () => {
  const cube = (id: number, age: number, loads: number[]) => snap(id, 'CUBE-COMP', { grade: 'M30', age, casting_date: '2026-09-22', element: 'Slab RCC, Tower-A' }, { cubes: loads.map((load, i) => ({ id: `C${i + 1}`, l: 150, b: 150, h: 150, mass: 8.3, load })) });
  it('picks the format from the tests', () => {
    expect(pickFormat(['CUBE-COMP'])).toBe('cubes');
    expect(pickFormat(['NDT-CORE'])).toBe('cores');
    expect(pickFormat(['CA-SIEVE', 'CA-AIV', 'FA-SIEVE'])).toBe('coarse-aggregate');
    expect(pickFormat(['CEM-NC', 'CEM-SET'])).toBe('cement-physical');
    expect(pickFormat(['CEM-CHEM'])).toBe('cement-chemical');
    expect(pickFormat(['SOIL-FDD-CC'])).toBe('field-density');
    expect(pickFormat(['PROCTOR-HEAVY', 'ATTERBERG'])).toBe('soil');
    expect(pickFormat(['NDT-RH'])).toBe('generic');
  });
  it('cube report: standard details section (band, customer, sample, testing) and one row per cube', () => {
    const l = buildLayout({ data: { ...base, accreditation: 'NABL', ulr: 'TC752326000003170F', jobCodeText: 'Concrete : MPAD/0044/10/2026', receivedTime: '11:40', customerRefDate: '29-10-2026', envText: '27 °C, 65 % RH', testLocation: 'Laboratory (permanent facility)', tests: [cube(1, 28, [879.8, 871.7, 842.4])], customer, options: {} } });
    expect(l.format).toBe('cubes');
    const band = l.sections[0] as TableSection;
    expect(band.role).toBe('idband');
    expect(band.rows[0].map((c) => htmlToText(c.h).split('\n')[0])).toEqual(['Test Report No.', 'ULR No.', 'Date of Issue', 'Page']);
    expect(band.rows[0][0].h).toContain('{{number}}'); expect(band.rows[0][3].h).toContain('{{pageOf}}');
    const det = l.sections[1] as TableSection;
    const cust = det.rows.flat().find((c) => c.role === 'customer')!;
    expect(htmlToText(cust.h)).toContain('Example Infra Pvt Ltd');
    expect(htmlToText(cust.h)).not.toContain('R. Kumar'); // contact details only when asked for
    const t = all(l);
    for (const x of ['CUSTOMER', 'SAMPLE', 'TESTING', 'Project / site*', 'Pristinia', 'Customer reference*', 'EI/QC/Oct/2026, dated 29-10-2026', 'Date & time of receipt', '20-10-2026, 11:40', 'Environmental conditions', '27 °C, 65 % RH', 'Test location', 'Test method', 'Condition on receipt']) expect(t).toContain(x);
    expect(t).not.toContain('not covered under the scope of NABL');
    const res = l.sections.find((s) => s.type === 'table' && s.role === 'results') as TableSection;
    expect(res.rows.length).toBe(4);
    expect(res.rows[1][1].rs).toBe(3); expect(htmlToText(res.rows[1][1].h)).toBe('M-30\nSlab RCC, Tower-A');
    expect(htmlToText(res.rows[1][7].h)).toBe('39.10'); expect(htmlToText(res.rows[1][8].h)).toBe('38.43'); // average of the unrounded strengths
    expect(res.rows[1][8].rs).toBe(3);
    expect(t).toContain('END OF REPORT');
  });
  it('non-NABL: no ULR cell, no empty rows, scope statement', () => {
    const l = buildLayout({ data: { ...base, accreditation: 'Non-NABL', ulr: '', condition: '', tests: [cube(1, 7, [600, 610, 620])], customer, options: {} } });
    const band = l.sections[0] as TableSection;
    expect(band.cols.length).toBe(3);
    expect(all(l)).not.toContain('ULR');
    expect(all(l)).not.toContain('Condition on receipt'); // empty values leave no blank row
    expect(all(l)).toContain('not covered under the scope of NABL accreditation');
    const det = l.sections[1] as TableSection;
    for (const r of det.rows) expect(r.filter((c) => !c.m).every((c) => htmlToText(c.h).trim() !== '')).toBe(true);
  });
  it('contact details and additional information can be switched on and off', () => {
    const data: any = { ...base, tests: [cube(1, 7, [600, 610, 620])], customer, extra: [{ key: 'vehicle', label: 'Vehicle No', value: 'TS 08 UH 9299' }, { key: 'inv', label: 'Invoice No', value: '6676' }], options: { includeContact: true } };
    const l = buildLayout({ data });
    expect(all(l)).toContain('Contact: R. Kumar, 90000 00000, qc@example.test');
    expect(all(l)).toContain('Additional details*|Vehicle No TS 08 UH 9299, Invoice No 6676');
    data.options = { includeContact: false, includeExtra: false };
    const l2 = refreshRoles(l, { data }, ['customer', 'extra']);
    expect(all(l2)).not.toContain('R. Kumar'); expect(all(l2)).not.toContain('Vehicle');
    data.options = { includeExtra: true, extraHidden: ['inv'], extraStyle: 'table' };
    const l3 = refreshRoles(l2, { data }, ['extra']);
    expect(all(l3)).toContain('Vehicle No*|TS 08 UH 9299');
    expect(all(l3)).not.toContain('6676');
    data.options = { includeExtra: true, extraStyle: 'below' };
    const l4 = refreshRoles(l3, { data }, ['extra']);
    expect(all(l4)).toContain('Vehicle No*: TS 08 UH 9299, Invoice No*: 6676');
    const roles = l4.sections.map((s) => (s as any).role);
    expect(roles.indexOf('extra')).toBeLessThan(roles.indexOf('notes'));
  });
  it('details typed on the report (unlocked client name, dates) refresh the details box only', () => {
    const data: any = { ...base, tests: [cube(1, 7, [600, 610, 620])], customer, options: {} };
    const l = buildLayout({ data });
    const edited = { ...l, sections: l.sections.map((s) => (s.type === 'text' && s.role === 'title' ? { ...s, h: 'MY TITLE' } : s)) };
    const d2 = { ...data, client: { name: 'Example Infra (Data Centre Division)' }, unlocked: { 'client.name': true }, receivedText: '19-10-2026' };
    const l2 = refreshRoles(edited, { data: d2 }, ['header']);
    expect(all(l2)).toContain('Example Infra (Data Centre Division)'); expect(all(l2)).toContain('19-10-2026');
    expect(all(l2)).toContain('MY TITLE');
    expect(l2.sections[0].id).toBe(l.sections[0].id);
  });
  it('parameter selection: excluded tests and rows stay off the report', () => {
    const d: any = { ...base, tests: [cube(1, 3, [300, 310, 320]), cube(2, 7, [500, 510, 520]), cube(3, 28, [800, 810, 820])], customer, options: { excluded: ['1', '3'] } };
    const l = buildLayout({ data: d });
    const res = l.sections.find((s) => s.type === 'table' && s.role === 'results') as TableSection;
    expect(res.rows.length).toBe(4);
    expect(htmlToText(res.rows[1][4].h)).toBe('7');
  });
  it('concrete cores: one row per core in the cube-report style, IS 456 acceptance', () => {
    const t = snap(9, 'NDT-CORE', { grade: 'M25', condition: 'Soaked 48 h (wet)' }, { cores: [{ id: 'C1 – Column C4', d: 150, l: 150, p: 420.6 }, { id: 'C2', d: 150, l: 150, p: 450 }, { id: 'C3', d: 150, l: 150, p: 470 }] });
    const l = buildLayout({ data: { ...base, tests: [t], customer, options: {} } });
    expect(l.format).toBe('cores');
    const res = l.sections.find((s) => s.type === 'table' && s.role === 'results') as TableSection;
    expect(res.rows.length).toBe(4);
    expect(htmlToText(res.rows[1][2].h)).toBe('C1 – Column C4');
    expect(res.rows[1][1].rs).toBe(3); expect(res.rows[1][8].rs).toBe(3);
    expect(all(l)).toContain('COMPRESSIVE STRENGTH OF CONCRETE CORES');
    expect(all(l)).toContain('Acceptance as per IS 456:2000');
    // choosing the cube format for core results is ignored (it would give an empty cube table)
    const l2 = buildLayout({ data: { ...base, tests: [t], customer, options: { format: 'cubes' } } });
    expect(l2.format).toBe('cores');
  });
  it('steel: one row per diameter, IS 1786 requirement tables', () => {
    const bar = (id: number, dia: string, ys: number) => snap(id, 'STEEL-TMT', { grade: 'Fe 550D', dia, brand: 'Jindal panther' }, { b: [1, 2, 3].map(() => ({ len: 1000, mass: (Number(dia) ** 2) / 162.2, py: ys * Math.PI * Number(dia) ** 2 / 4 / 1000, pm: ys * 1.2 * Math.PI * Number(dia) ** 2 / 4 / 1000, l0: 100, lf: 120, bend: 'Satisfactory', rebend: 'Satisfactory' })) });
    const l = buildLayout({ data: { ...base, tests: [bar(2, '10', 610), bar(1, '8', 598)], customer, options: {} } });
    expect(l.format).toBe('steel-physical');
    const res = l.sections.find((s) => s.type === 'table' && s.role === 'results') as TableSection;
    expect(htmlToText(res.rows[1][0].h)).toBe('Test Method as per IS');
    expect(htmlToText(res.rows[2][1].h)).toBe('8'); expect(htmlToText(res.rows[3][1].h)).toBe('10');
    expect(res.rows[2][2].rs).toBe(2); // same make merged
    expect(all(l)).toContain('600 or 8% more than actual proof Stress whichever is Higher');
  });
  it('coarse aggregate: sieve analysis table plus properties with requirements and method', () => {
    const sv = snap(1, 'CA-SIEVE', { agg: '20 mm single size', total: 5000 }, { sv: [{ ret: 0 }, { ret: 120 }, { ret: 4800 }, { ret: 50 }, { ret: 10 }, { ret: 5 }, { ret: 5 }, { ret: 5 }] });
    const aiv = snap(2, 'CA-AIV', {}, { t: [{ a: 300, b: 45 }, { a: 300, b: 48 }] });
    const l = buildLayout({ data: { ...base, tests: [sv, aiv], customer, options: {} } });
    expect(l.format).toBe('coarse-aggregate');
    expect(all(l)).toContain('SIEVE ANALYSIS – 20 mm single size');
    expect(all(l)).toContain('Specification as per IS:383-2016 in respect of 20 mm single size (% passing)');
    expect(all(l)).toContain('Requirements as per IS: 383-2016');
  });
  it('reports made before formats existed get a general layout', () => {
    const l = buildLayout({ data: { ...base, rows: [{ name: 'MDD', unit: 'g/cc', method: 'IS 2720 (P-8)', spec: '--', values: ['1.96'] }], client: { name: 'Old Client', address: 'Addr' } } });
    expect(l.format).toBe('generic');
    expect(all(l)).toContain('Old Client'); expect(all(l)).toContain('1.96'); expect(all(l)).toContain('IS 2720 (P-8)');
  });
});

describe('numbering helpers', () => {
  it('formats compact and material-coded numbers, and shortens code ranges', async () => {
    const { formatNumber, codeRange } = await import('../src/index');
    expect(formatNumber('{Y1}{ML}{SEQ:4}', 136, { date: '2026-10-03' })).toBe('6J0136');
    expect(formatNumber('MPAD/{MATCODE}/{SEQ:4}/{MM}/{FYFULL}', 456, { date: '2026-11-09', material: 'Cement' })).toBe('MPAD/CEM/0456/11/2026-27');
    expect(formatNumber('TC7523{YY}0{SEQ:8}{FP}', 3170, { date: '2026-07-09', fp: 'P' })).toBe('TC752326000003170P');
    expect(codeRange(['6J0136', '6J0137', '6J0138', '6J0142'])).toBe('6J0136 – 0138, 6J0142');
    expect(codeRange(['MPAD/0044/10/2026'])).toBe('MPAD/0044/10/2026');
  });
});
