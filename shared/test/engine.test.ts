import { describe, it, expect } from 'vitest';
import { evaluate, emptyInput, evaluateObservation, CBR_LAB, PROCTOR_HEAVY, FREE_SWELL, ATTERBERG, GRADATION_SOIL,
  computeTotals, amountInWords, numberToWordsIndian, formatNumber, financialYear, validateGstin, inr, fillPlaceholders } from '../src';

describe('formula engine', () => {
  it('handles Excel basics', () => {
    expect(evaluate('1+2*3^2', {})).toBe(19);
    expect(evaluate('-2^2', {})).toBe(4);
    expect(evaluate('IF(x="","blank",x*2)', { x: null })).toBe('blank');
    expect(evaluate('IF(x="","blank",x*2)', { x: 4 })).toBe(8);
    expect(evaluate('ROUND(PI(),3)', {})).toBe(3.142);
    expect(evaluate('IFERROR(1/0,"div")', {})).toBe('div');
    expect(evaluate('INDEX(a,MATCH(2.5,b,0))', { a: [10, 20, 30], b: [0, 2.5, 5] })).toBe(20);
    expect(evaluate('INTERP(2.5, xs, ys)', { xs: [2, 3], ys: [10, 20] })).toBe(15);
    expect(evaluate('"a"&"b"', {})).toBe('ab');
    expect(evaluate('AVERAGE(a)', { a: [1, 2, '', null, 3] })).toBe(2);
  });
});

describe('CBR lab template reproduces the lab Excel sheet', () => {
  const input = emptyInput(CBR_LAB);
  const prr: Record<number, number> = { 50: 21.6, 100: 28.6, 150: 35.7, 200: 39.5, 250: 43.2, 300: 45.8, 350: 47.1, 400: 49.3, 500: 52.6, 600: 55.1, 700: 57.9 };
  input.grids.readings = input.grids.readings.map((r) => ({ ...r, prr: r.dial === 0 ? 0 : prr[r.dial as number] ?? null }));
  input.header = { test_condition: 'Soaked' };
  input.equipment = { ring: { id: 1, name: 'Proving ring 50 kN', data: { factor: 0.04995 } } };
  const res = evaluateObservation(CBR_LAB, input);
  it('derives constants', () => {
    expect(res.scalars.prc as number).toBeCloseTo(5.0935, 4);
    expect(res.scalars.area as number).toBeCloseTo(19.635, 3);
  });
  it('computes loads and CBR', () => {
    expect(res.results.load25 as number).toBeCloseTo(11.206, 3);
    expect(res.results.load50 as number).toBeCloseTo(13.645, 3);
    expect(res.results.cbr25 as number).toBeCloseTo(16.01, 2);
    expect(res.results.cbr50 as number).toBeCloseTo(12.995, 2);
    expect(res.results.cbr as number).toBeCloseTo(16.01, 2);
    expect(res.grids.readings[5].load_kgf as number).toBeCloseTo(220.0, 1);
    expect(res.checks.find((c) => c.message.startsWith('CBR at 5.0'))).toBeUndefined();
  });
  it('warns when 5 mm governs', () => {
    const i2 = structuredClone(input);
    i2.grids.readings = i2.grids.readings.map((r) => (r.dial === 500 ? { ...r, prr: 90 } : r));
    expect(evaluateObservation(CBR_LAB, i2).checks.some((c) => c.message.startsWith('CBR at 5.0'))).toBe(true);
  });
  it('errors without calibration factor', () => {
    const i3 = structuredClone(input); i3.equipment = {};
    expect(evaluateObservation(CBR_LAB, i3).checks.some((c) => c.level === 'error')).toBe(true);
  });
});

describe('soil templates', () => {
  it('proctor', () => {
    const i = emptyInput(PROCTOR_HEAVY);
    i.header = { mould_mass: 4000, mould_vol: 1000 };
    i.grids.trials = [ { mass_ms: 6000, w: 8 }, { mass_ms: 6170, w: 10.2 }, { mass_ms: 6150, w: 12 }, {}, {} ] as never;
    const r = evaluateObservation(PROCTOR_HEAVY, i);
    expect(r.results.mdd as number).toBeCloseTo(2.17 / 1.102, 3);
    expect(r.results.omc).toBe(10.2);
  });
  it('fsi, atterberg, gradation', () => {
    expect(evaluateObservation(FREE_SWELL, { header: { vd: 12, vk: 10 }, grids: {} }).results.fsi).toBe(20);
    expect(evaluateObservation(ATTERBERG, { header: { ll: 28, pl: 13 }, grids: {} }).results.pi).toBe(15);
    const g = emptyInput(GRADATION_SOIL); g.header = { total: 1000, pan: 270 };
    g.grids.sieves[0].ret = 80;
    const r = evaluateObservation(GRADATION_SOIL, g);
    expect([r.results.gravel, r.results.sand, r.results.silt_clay]).toEqual([8, 65, 27]);
  });
});

describe('money', () => {
  it('reproduces invoice 183 (inter-state IGST)', () => {
    const t = computeTotals([
      { description: 'MDD & OMC', rate: 3500, qty: 1 }, { description: 'Gradation', rate: 1000, qty: 1 },
      { description: 'Atterberg', rate: 1200, qty: 1 }, { description: 'FSI', rate: 650, qty: 1 },
    ], { supplierState: '36', placeOfSupply: '27', defaultGst: 18 });
    expect(t.taxable).toBe(6350); expect(t.igst).toBe(1143); expect(t.cgst).toBe(0); expect(t.total).toBe(7493);
    expect(amountInWords(t.total)).toBe('Rupees Seven Thousand Four Hundred and Ninety Three Only');
  });
  it('splits CGST/SGST intra-state and rounds', () => {
    const t = computeTotals([{ description: 'x', rate: 999, qty: 1 }], { supplierState: '36', placeOfSupply: '36', defaultGst: 18 });
    expect(t.cgst).toBe(89.91); expect(t.sgst).toBe(89.91); expect(t.total).toBe(1179); expect(t.roundOff).toBe(0.18);
  });
  it('words and formats', () => {
    expect(numberToWordsIndian(12345678)).toBe('One Crore Twenty Three Lakh Forty Five Thousand Six Hundred and Seventy Eight');
    expect(numberToWordsIndian(100)).toBe('One Hundred');
    expect(inr(1234567)).toBe('12,34,567');
  });
  it('GSTIN check', () => {
    expect(validateGstin('36AAECS1234K1ZE').ok).toBe(true);
    expect(validateGstin('27AAACD5225H1ZW').ok).toBe(true);
    expect(validateGstin('36AAECS1234K1ZF').ok).toBe(false);
  });
});

describe('numbering', () => {
  it('formats like MPAD', () => {
    expect(formatNumber('MPAD/{SEQ:3}/{FY}', 76, { date: '2026-09-08' })).toBe('MPAD/076/26-27');
    expect(formatNumber('{SEQ}/{FY}', 183, { date: '2026-10-10' })).toBe('183/26-27');
    expect(formatNumber('MPAD/{CLIENT}/{SEQ:4}/{MM}/{YYYY}', 116, { date: '2026-10-09', client: 'xdpl' })).toBe('MPAD/XDPL/0116/10/2026');
    expect(financialYear('2027-03-31').short).toBe('26-27');
    expect(fillPlaceholders('For {{company.name}}', { company: { name: 'ACME' } })).toBe('For ACME');
  });
});

import { runReport, resolveRange, withTime, roleAllows, BUILTIN_ROLES } from '../src';
describe('analytics', () => {
  const rows = [
    withTime({ date: '2026-08-10', client: 'A', total: 100, accreditation: 'NABL' }, '2026-08-10'),
    withTime({ date: '2026-09-05', client: 'B', total: 200, accreditation: 'Non-NABL' }, '2026-09-05'),
    withTime({ date: '2026-10-01', client: 'A', total: 300, accreditation: 'NABL' }, '2026-10-01'),
    withTime({ date: '2026-10-20', client: 'A', total: 50, accreditation: 'NABL' }, '2026-10-20'),
  ];
  it('sums by client with filters and ranges', () => {
    const r = runReport(rows, { object: 'invoices', measure: { agg: 'sum', field: 'total' }, groupBy: ['client'] }, '2026-11-01');
    expect(r.rows[0]).toMatchObject({ label: 'A', value: 450 });
    const n = runReport(rows, { object: 'invoices', measure: { agg: 'sum', field: 'total' }, filters: [{ field: 'accreditation', op: 'eq', value: 'nabl' }], dateRange: { preset: 'last_month' } }, '2026-11-01');
    expect(n.total).toBe(350);
    expect(resolveRange({ preset: 'this_fy' }, '2026-11-01')).toEqual({ from: '2026-04-01', to: '2027-03-31' });
  });
  it('fills month gaps and forecasts', () => {
    const r = runReport(rows, { object: 'invoices', measure: { agg: 'sum', field: 'total' }, groupBy: ['month'], forecast: 2 }, '2026-11-01');
    expect(r.rows.map((x) => x.label)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
    expect(r.rows.filter((x) => x.forecast).length).toBe(2);
  });
  it('roles', () => {
    const tech = BUILTIN_ROLES.find((r) => r.key === 'technician');
    expect(roleAllows(tech, 'enterObservations')).toBe(true);
    expect(roleAllows(tech, 'signReports')).toBe(false);
    expect(roleAllows(BUILTIN_ROLES[0], 'anything.at.all')).toBe(true);
  });
});
