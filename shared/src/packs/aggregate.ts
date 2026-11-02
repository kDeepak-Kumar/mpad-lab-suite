import type { ObservationTemplate, Grid } from '../observation';

/**
 * Aggregates for concrete: IS 2386 (Parts 1–5) : 1963 (RA 2021) test methods,
 * IS 383 : 2016 requirements. Limits are kept as editable constants/tables so the lab can
 * align them with the edition it is accredited for.
 */

// ---------- shared pieces ----------

const usage = { key: 'usage', label: 'Intended use', type: 'select' as const, options: ['Concrete for wearing surfaces', 'Concrete other than wearing surfaces'], default: 'Concrete other than wearing surfaces' };
const wear = (lowLimit: string, highLimit: string) => `IF(usage="Concrete for wearing surfaces",${lowLimit},${highLimit})`;

// IS 383 : 2016 Table 7 – coarse aggregate grading (% passing): [lower, upper]
const CA_LIMITS: Record<string, Record<string, [number, number]>> = {
  '40 mm graded': { '80': [100, 100], '40': [95, 100], '20': [30, 70], '10': [10, 35], '4.75': [0, 5] },
  '20 mm graded': { '40': [100, 100], '20': [95, 100], '10': [25, 55], '4.75': [0, 10] },
  '16 mm graded': { '20': [100, 100], '16': [90, 100], '10': [30, 70], '4.75': [0, 10] },
  '12.5 mm graded': { '20': [100, 100], '12.5': [90, 100], '10': [40, 85], '4.75': [0, 10] },
  '63 mm single size': { '80': [100, 100], '63': [85, 100], '40': [0, 30], '20': [0, 5] },
  '40 mm single size': { '80': [100, 100], '63': [100, 100], '40': [85, 100], '20': [0, 20], '10': [0, 5] },
  '20 mm single size': { '40': [100, 100], '20': [85, 100], '10': [0, 20], '4.75': [0, 5] },
  '16 mm single size': { '20': [100, 100], '16': [85, 100], '10': [0, 30], '4.75': [0, 5] },
  '12.5 mm single size': { '16': [100, 100], '12.5': [85, 100], '10': [0, 45], '4.75': [0, 10] },
  '10 mm single size': { '12.5': [100, 100], '10': [85, 100], '4.75': [0, 20], '2.36': [0, 5] },
};
const caTable = (() => {
  const key: string[] = [], lo: number[] = [], hi: number[] = [];
  for (const [g, rows] of Object.entries(CA_LIMITS)) for (const [s, [a, b]] of Object.entries(rows)) { key.push(`${g}|${s}`); lo.push(a); hi.push(b); }
  return { key, lo, hi };
})();

// IS 383 : 2016 Table 9 – fine aggregate zones (% passing). Rows: 10, 4.75, 2.36, 1.18, 0.600, 0.300, 0.150 mm, pan.
const FA_ZONES = {
  lo1: [100, 90, 60, 30, 15, 5, 0, ''], hi1: [100, 100, 95, 70, 34, 20, 10, ''],
  lo2: [100, 90, 75, 55, 35, 8, 0, ''], hi2: [100, 100, 100, 90, 59, 30, 10, ''],
  lo3: [100, 90, 85, 75, 60, 12, 0, ''], hi3: [100, 100, 100, 100, 79, 40, 10, ''],
  lo4: [100, 95, 95, 90, 80, 15, 0, ''], hi4: [100, 100, 100, 100, 100, 50, 15, ''],
};

function sieveGrid(key: string, label: string, sieves: [string, number][]): Grid {
  return {
    key, label, fixedRows: sieves.map(([l, s]) => ({ sieve: l, size: s })),
    columns: [
      { key: 'sieve', label: 'IS sieve' },
      { key: 'size', label: 'Size', unit: 'mm' },
      { key: 'ret', label: 'Mass retained', unit: 'g', input: true },
      { key: 'cum', label: 'Cumulative retained', unit: 'g', formula: `IF(ret="","",SUMTO(${key}.ret,ROW()))`, decimals: 1 },
      { key: 'cump', label: 'Cumulative retained', unit: '%', formula: 'IF(OR(cum="",total=""),"",cum/total*100)', decimals: 1 },
      { key: 'pass', label: 'Passing', unit: '%', formula: 'IF(cump="","",IF(size=0,"",100-cump))', decimals: 1 },
    ],
  };
}

// ---------- coarse aggregate ----------

export const CA_SIEVE: ObservationTemplate = {
  code: 'CA-SIEVE', version: 1, material: 'Coarse aggregate', category: 'Coarse aggregate',
  name: 'Sieve analysis of coarse aggregate',
  method: 'IS 2386 (Part 1) : 1963 (RA 2021)',
  docControl: { docNo: 'OBS/CA/01', issueNo: '01', issueDate: '', amendmentNo: '0' },
  headerFields: [
    { key: 'agg', label: 'Nominal size / type', type: 'select', options: Object.keys(CA_LIMITS), required: true, default: '20 mm graded' },
    { key: 'total', label: 'Total oven-dry mass of sample', type: 'number', unit: 'g', required: true },
  ],
  constants: [], derived: [],
  tables: { ca: caTable },
  grids: [(() => {
    const g = sieveGrid('sv', 'Sieve analysis', [['80 mm', 80], ['63 mm', 63], ['40 mm', 40], ['20 mm', 20], ['16 mm', 16], ['12.5 mm', 12.5], ['10 mm', 10], ['4.75 mm', 4.75], ['2.36 mm', 2.36], ['Pan', 0]]);
    g.columns.push(
      { key: 'lo', label: 'IS 383 lower', unit: '%', formula: 'IF(size=0,"",IFERROR(LOOKUPX(agg&"|"&size,ca.key,ca.lo),""))', decimals: 0 },
      { key: 'hi', label: 'IS 383 upper', unit: '%', formula: 'IF(size=0,"",IFERROR(LOOKUPX(agg&"|"&size,ca.key,ca.hi),""))', decimals: 0 },
      { key: 'limit', label: 'Requirement', formula: 'IF(lo="","--",IF(lo=hi,FIXED(lo,0),FIXED(lo,0)&" - "&FIXED(hi,0)))' },
      { key: 'ok', label: 'Within limits', formula: 'IF(OR(pass="",lo=""),"",IF(AND(pass>=lo,pass<=hi),"Yes","No"))' },
    );
    return g;
  })()],
  results: [
    { key: 'sum', label: 'Sum of retained masses', formula: 'SUM(sv.ret)', unit: 'g', decimals: 1 },
    { key: 'conform', label: 'Grading', formula: 'IF(COUNT(sv.ret)=0,"",IF(COUNTIF(sv.ok,"No")>0,"Does not conform to IS 383 for "&agg,"Conforms to IS 383 for "&agg))' },
  ],
  checks: [
    { when: 'AND(total<>"",COUNT(sv.ret)>0,ABS(sum-total)>total*0.01)', level: 'warning', message: 'Sum of retained masses differs from the total mass by more than 1%: re-weigh before reporting.' },
  ],
  chart: { grid: 'sv', x: 'size', y: 'pass', xLog: true, title: 'Gradation curve', xLabel: 'IS sieve size (mm)', yLabel: 'Passing (%)', series: [{ y: 'lo', label: 'Lower limit', dashed: true }, { y: 'hi', label: 'Upper limit', dashed: true }] },
  reportRows: [{ name: 'Grading of coarse aggregate', unit: '--', result: 'conform', specFormula: '"IS 383 : 2016 Table 7 ("&agg&")"' }],
  reportTables: [{ title: 'Sieve analysis of coarse aggregate', grid: 'sv', skipBlank: 'pass', columns: [{ key: 'sieve', label: 'IS sieve' }, { key: 'pass', label: 'Passing (%)', decimals: 1 }, { key: 'limit', label: 'IS 383 requirement (%)' }] }],
  references: ['IS 2386 (Part 1) : 1963 – Particle size and shape.', 'IS 383 : 2016 Table 7 – grading limits for coarse aggregate.'],
  procedure: [
    'Reduce the sample by quartering or a riffle box to the minimum mass for the maximum size (about 50 kg for 40 mm, 25 kg for 20 mm, 5 kg for 10 mm) and oven-dry it at 110 ± 5 °C to constant mass.',
    'Weigh the dry sample (total mass) and arrange the IS sieves in order of decreasing size with the pan at the bottom.',
    'Sieve each portion by hand or machine for at least 2 minutes per sieve, without forcing particles through; do not overload any sieve.',
    'Weigh the material retained on each sieve and in the pan, to 0.1% of the sample mass.',
    'Check that the sum of the masses agrees with the total mass within 1%.',
    'Compute cumulative % retained and % passing, and compare with the IS 383 limits for the declared nominal size.',
  ],
  sampleCalc: [
    'Total mass = {total:0} g. Retained on 20 mm = {sv.ret#4:0} g → cumulative {sv.cum#4:0} g = {sv.cump#4:1} % → passing {sv.pass#4:1} % (limit {sv.limit#4}).',
    'Retained on 10 mm = {sv.ret#7:0} g → cumulative {sv.cum#7:0} g = {sv.cump#7:1} % → passing {sv.pass#7:1} % (limit {sv.limit#7}).',
    'Passing 4.75 mm = {sv.pass#8:1} % (limit {sv.limit#8}). All sieves within limits: {conform}.',
  ],
  example: {
    input: { header: { agg: '20 mm graded', total: 25000 }, grids: { sv: [{ ret: 0 }, { ret: 0 }, { ret: 0 }, { ret: 750 }, { ret: 4100 }, { ret: 5300 }, { ret: 4600 }, { ret: 8900 }, { ret: 1050 }, { ret: 300 }] } },
    expect: { 'sv.pass#4': 97, 'sv.pass#7': 41, 'sv.pass#8': 5.4, conform: 'Conforms to IS 383 for 20 mm graded' },
  },
};

const FLAKY_FRACTIONS = ['63 – 50 mm', '50 – 40 mm', '40 – 31.5 mm', '31.5 – 25 mm', '25 – 20 mm', '20 – 16 mm', '16 – 12.5 mm', '12.5 – 10 mm', '10 – 6.3 mm'];
export const CA_FLAKY: ObservationTemplate = {
  code: 'CA-FLAKY', version: 1, material: 'Coarse aggregate', category: 'Coarse aggregate',
  name: 'Flakiness and elongation index of coarse aggregate',
  method: 'IS 2386 (Part 1) : 1963 (RA 2021)',
  docControl: { docNo: 'OBS/CA/02', issueNo: '01', issueDate: '', amendmentNo: '0' },
  headerFields: [{ key: 'agg', label: 'Nominal size', type: 'select', options: ['40 mm', '20 mm', '12.5 mm', '10 mm'] }],
  constants: [{ key: 'lim', label: 'Combined index limit (IS 383)', unit: '%', value: 40 }],
  derived: [],
  grids: [{
    key: 'fr', label: 'Size fractions (test only fractions forming at least 5% of the sample; at least 200 pieces each)', fixedRows: FLAKY_FRACTIONS.map((f) => ({ fraction: f })),
    columns: [
      { key: 'fraction', label: 'Passing – retained' },
      { key: 'w', label: 'Mass of fraction', unit: 'g', input: true },
      { key: 'fl', label: 'Passing thickness gauge (flaky)', unit: 'g', input: true },
      { key: 'nf', label: 'Non-flaky', unit: 'g', formula: 'IF(w="","",w-fl)', decimals: 0 },
      { key: 'el', label: 'Retained on length gauge (elongated, of non-flaky)', unit: 'g', input: true },
    ],
  }],
  results: [
    { key: 'fi', label: 'Flakiness index', formula: 'IF(SUM(fr.w)=0,"",SUM(fr.fl)/SUM(fr.w)*100)', unit: '%', decimals: 1 },
    { key: 'ei', label: 'Elongation index', formula: 'IF(SUM(fr.nf)=0,"",SUM(fr.el)/SUM(fr.nf)*100)', unit: '%', decimals: 1 },
    { key: 'comb', label: 'Combined flakiness and elongation index', formula: 'IF(OR(fi="",ei=""),"",fi+ei)', unit: '%', decimals: 1 },
  ],
  checks: [
    { when: 'AND(comb<>"",comb>lim)', level: 'warning', message: 'Combined flakiness and elongation index exceeds the IS 383 limit.' },
    { when: 'COUNTIF(fr.nf,"<0")>0', level: 'error', message: 'Flaky mass is greater than the fraction mass in a row.' },
  ],
  reportRows: [
    { name: 'Flakiness index', unit: '%', result: 'fi', decimals: 1, spec: '--' },
    { name: 'Elongation index', unit: '%', result: 'ei', decimals: 1, spec: '--' },
    { name: 'Combined flakiness and elongation index', unit: '%', result: 'comb', decimals: 1, specFormula: '"Max "&FIXED(lim,0)' },
  ],
  references: ['IS 2386 (Part 1) : 1963 cl. 4 (flakiness) and cl. 5 (elongation).', 'IS 383 : 2016 – combined flakiness and elongation index not more than 40%. Elongation index is determined on the non-flaky portion.'],
  procedure: [
    'Sieve the sample into the size fractions shown. Fractions below 5% of the sample need not be tested; take at least 200 pieces of each fraction tested.',
    'Weigh each fraction. Pass every piece through the matching slot of the thickness gauge; weigh the pieces that pass (flaky).',
    'Gauge the remaining (non-flaky) pieces on the length gauge. Weigh the pieces that do not pass between the pins (elongated).',
    'Flakiness index = total flaky mass ÷ total mass tested × 100.',
    'Elongation index = total elongated mass ÷ total non-flaky mass × 100. Combined index = FI + EI.',
  ],
  sampleCalc: [
    'Total mass tested = {fr.w#5:0} + {fr.w#6:0} + {fr.w#7:0} + {fr.w#8:0} = 4630 g; flaky = 725 g → FI = 725 ÷ 4630 × 100 = {fi:1} %.',
    'Non-flaky = 4630 − 725 = 3905 g; elongated = 730 g → EI = 730 ÷ 3905 × 100 = {ei:1} %.',
    'Combined index = {fi:1} + {ei:1} = {comb:1} % (limit 40 %).',
  ],
  example: {
    input: { header: { agg: '20 mm' }, grids: { fr: [{}, {}, {}, {}, { w: 1250, fl: 165, el: 210 }, { w: 1480, fl: 230, el: 255 }, { w: 1120, fl: 190, el: 160 }, { w: 780, fl: 140, el: 105 }, {}] } },
    expect: { fi: 15.66, ei: 18.69, comb: 34.35 },
  },
};

export const CA_IMPACT: ObservationTemplate = {
  code: 'CA-AIV', version: 1, material: 'Coarse aggregate', category: 'Coarse aggregate',
  name: 'Aggregate impact value',
  method: 'IS 2386 (Part 4) : 1963 (RA 2021)',
  docControl: { docNo: 'OBS/CA/03', issueNo: '01', issueDate: '', amendmentNo: '0' },
  equipment: [{ key: 'imp', label: 'Impact testing machine', category: 'Impact testing machine' }],
  headerFields: [usage, { key: 'cond', label: 'Condition', type: 'select', options: ['Oven dry', 'Soaked (wet)'], default: 'Oven dry' }],
  constants: [], derived: [],
  grids: [{
    key: 't', label: 'Trials (12.5 – 10 mm fraction, 15 blows of the hammer)', rows: 2,
    columns: [
      { key: 'w1', label: 'Mass of sample (W1)', unit: 'g', input: true },
      { key: 'w2', label: 'Passing 2.36 mm (W2)', unit: 'g', input: true },
      { key: 'w3', label: 'Retained on 2.36 mm', unit: 'g', input: true },
      { key: 'loss', label: 'Loss', unit: 'g', formula: 'IF(OR(w1="",w2="",w3=""),"",w1-w2-w3)', decimals: 1 },
      { key: 'aiv', label: 'Impact value', unit: '%', formula: 'IF(OR(w1="",w2=""),"",w2/w1*100)', decimals: 1 },
    ],
  }],
  results: [{ key: 'aiv', label: 'Aggregate impact value (mean)', formula: 'IF(COUNT(t.aiv)=0,"",ROUND(AVERAGE(t.aiv),0))', unit: '%', decimals: 0 }],
  checks: [
    { when: 'COUNTIF(t.loss,">1")>0', level: 'warning', message: 'Loss in a trial is more than 1 g: discard the result and repeat.' },
    { when: `AND(aiv<>"",aiv>${wear('30', '45')})`, level: 'warning', message: 'Impact value exceeds the IS 383 limit for the intended use.' },
  ],
  reportRows: [{ name: 'Aggregate impact value', unit: '%', result: 'aiv', decimals: 0, specFormula: `"Max "&${wear('30', '45')}` }],
  references: ['IS 2386 (Part 4) : 1963 cl. 4.', 'IS 383 : 2016 – not more than 30% for wearing surfaces and 45% for other concrete.'],
  procedure: [
    'Take aggregate passing 12.5 mm and retained on 10 mm, oven-dried for 4 hours at 100–110 °C and cooled.',
    'Fill the cylindrical measure in three layers, tamping each layer 25 times with the rod; strike off level and weigh (W1).',
    'Transfer the sample to the cup of the impact machine in three layers, 25 tamps each.',
    'Raise the hammer to 380 ± 5 mm and let it fall freely 15 times at intervals of not less than one second.',
    'Sieve the crushed aggregate on the 2.36 mm sieve. Weigh the fraction passing (W2) and the fraction retained; their sum must not differ from W1 by more than 1 g.',
    'Impact value = W2 ÷ W1 × 100. Report the mean of two tests to the nearest whole number.',
  ],
  sampleCalc: [
    'Trial 1: W1 = {t.w1#1:0} g, W2 = {t.w2#1:0} g → AIV = {t.w2#1:0} ÷ {t.w1#1:0} × 100 = {t.aiv#1:2} %.',
    'Trial 2: {t.w2#2:0} ÷ {t.w1#2:0} × 100 = {t.aiv#2:2} %. Mean = {aiv:0} % (nearest whole number).',
  ],
  example: { input: { header: {}, grids: { t: [{ w1: 342, w2: 58, w3: 283.5 }, { w1: 338, w2: 55, w3: 282.6 }] } }, expect: { 't.aiv#1': 16.96, 't.aiv#2': 16.27, aiv: 17 } },
};

export const CA_CRUSHING: ObservationTemplate = {
  code: 'CA-ACV', version: 1, material: 'Coarse aggregate', category: 'Coarse aggregate',
  name: 'Aggregate crushing value',
  method: 'IS 2386 (Part 4) : 1963 (RA 2021)',
  docControl: { docNo: 'OBS/CA/04', issueNo: '01', issueDate: '', amendmentNo: '0' },
  equipment: [{ key: 'ctm', label: 'Compression testing machine', category: 'Compression testing machine' }],
  headerFields: [usage],
  constants: [], derived: [],
  grids: [{
    key: 't', label: 'Trials (12.5 – 10 mm fraction, 400 kN in 10 minutes)', rows: 2,
    columns: [
      { key: 'a', label: 'Mass of sample (A)', unit: 'g', input: true },
      { key: 'b', label: 'Passing 2.36 mm (B)', unit: 'g', input: true },
      { key: 'acv', label: 'Crushing value', unit: '%', formula: 'IF(OR(a="",b=""),"",b/a*100)', decimals: 1 },
    ],
  }],
  results: [{ key: 'acv', label: 'Aggregate crushing value (mean)', formula: 'IF(COUNT(t.acv)=0,"",ROUND(AVERAGE(t.acv),0))', unit: '%', decimals: 0 }],
  checks: [{ when: `AND(acv<>"",acv>${wear('30', '45')})`, level: 'warning', message: 'Crushing value exceeds the IS 383 limit for the intended use.' }],
  reportRows: [{ name: 'Aggregate crushing value', unit: '%', result: 'acv', decimals: 0, specFormula: `"Max "&${wear('30', '45')}` }],
  references: ['IS 2386 (Part 4) : 1963 cl. 2.', 'IS 383 : 2016 – not more than 30% for wearing surfaces and 45% for other concrete.'],
  procedure: [
    'Use surface-dry aggregate passing 12.5 mm and retained on 10 mm.',
    'Fill the cylindrical measure in three layers, 25 tamps each, strike off and weigh the sample (A).',
    'Place the sample in the steel cylinder in three layers with 25 tamps each, level it and insert the plunger.',
    'Apply load at a uniform rate to reach 400 kN in 10 minutes, then release.',
    'Sieve the crushed material on the 2.36 mm sieve and weigh the fraction passing (B).',
    'Crushing value = B ÷ A × 100. Report the mean of two results to the nearest whole number.',
  ],
  sampleCalc: ['Trial 1: {t.b#1:0} ÷ {t.a#1:0} × 100 = {t.acv#1:2} %; trial 2: {t.b#2:0} ÷ {t.a#2:0} × 100 = {t.acv#2:2} %. Mean = {acv:0} %.'],
  example: { input: { header: {}, grids: { t: [{ a: 3120, b: 680 }, { a: 3095, b: 650 }] } }, expect: { 't.acv#1': 21.79, 't.acv#2': 21.0, acv: 21 } },
};

export const CA_LA: ObservationTemplate = {
  code: 'CA-LAA', version: 1, material: 'Coarse aggregate', category: 'Coarse aggregate',
  name: 'Los Angeles abrasion value',
  method: 'IS 2386 (Part 4) : 1963 (RA 2021)',
  docControl: { docNo: 'OBS/CA/05', issueNo: '01', issueDate: '', amendmentNo: '0' },
  equipment: [{ key: 'la', label: 'Los Angeles abrasion machine', category: 'Los Angeles abrasion machine' }],
  headerFields: [usage, { key: 'grading', label: 'Grading', type: 'select', options: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], required: true, default: 'B' }],
  constants: [],
  tables: { la: { g: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], balls: [12, 11, 8, 6, 12, 12, 12], rev: [500, 500, 500, 500, 1000, 1000, 1000], mass: [5000, 5000, 5000, 5000, 10000, 10000, 10000] } },
  derived: [
    { key: 'balls', label: 'Number of abrasive spheres', formula: 'IFERROR(LOOKUPX(grading,la.g,la.balls),"")', decimals: 0 },
    { key: 'rev', label: 'Revolutions', formula: 'IFERROR(LOOKUPX(grading,la.g,la.rev),"")', decimals: 0 },
    { key: 'mass', label: 'Sample mass required', unit: 'g', formula: 'IFERROR(LOOKUPX(grading,la.g,la.mass),"")', decimals: 0 },
  ],
  grids: [{
    key: 't', label: 'Trial', rows: 1,
    columns: [
      { key: 'w1', label: 'Original mass (W1)', unit: 'g', input: true },
      { key: 'w2', label: 'Retained on 1.70 mm after test (W2)', unit: 'g', input: true },
      { key: 'laa', label: 'Abrasion value', unit: '%', formula: 'IF(OR(w1="",w2=""),"",(w1-w2)/w1*100)', decimals: 1 },
    ],
  }],
  results: [{ key: 'laa', label: 'Los Angeles abrasion value', formula: 'IF(COUNT(t.laa)=0,"",AVERAGE(t.laa))', unit: '%', decimals: 1 }],
  checks: [{ when: `AND(laa<>"",laa>${wear('30', '50')})`, level: 'warning', message: 'Abrasion value exceeds the IS 383 limit for the intended use.' }],
  reportRows: [{ name: 'Los Angeles abrasion value', unit: '%', result: 'laa', decimals: 1, specFormula: `"Max "&${wear('30', '50')}` }],
  references: ['IS 2386 (Part 4) : 1963 cl. 5 – gradings A to G with the charge and revolutions shown.', 'IS 383 : 2016 – not more than 30% for wearing surfaces and 50% for other concrete.'],
  procedure: [
    'Choose the grading closest to the aggregate supplied and prepare the sample by the size fractions given for that grading (5 kg for A–D, 10 kg for E–G), washed and oven-dried.',
    'Place the sample and the specified number of steel spheres in the drum.',
    'Rotate the drum at 30–33 rev/min for 500 revolutions (A–D) or 1000 revolutions (E–G).',
    'Remove the material, sieve it on the 1.70 mm sieve, wash and oven-dry the coarser portion and weigh it (W2).',
    'Abrasion value = (W1 − W2) ÷ W1 × 100.',
  ],
  sampleCalc: ['Grading {grading}: {balls:0} spheres, {rev:0} revolutions, sample {mass:0} g. W1 = {t.w1#1:0} g, W2 = {t.w2#1:0} g → ({t.w1#1:0} − {t.w2#1:0}) ÷ {t.w1#1:0} × 100 = {laa:1} %.'],
  example: { input: { header: { grading: 'B' }, grids: { t: [{ w1: 5000, w2: 3850 }] } }, expect: { balls: 11, rev: 500, laa: 23 } },
};

function sgTemplate(kind: 'CA' | 'FA'): ObservationTemplate {
  const ca = kind === 'CA';
  return {
    code: `${kind}-SG`, version: 1, material: ca ? 'Coarse aggregate' : 'Fine aggregate', category: ca ? 'Coarse aggregate' : 'Fine aggregate',
    name: `Specific gravity and water absorption of ${ca ? 'coarse' : 'fine'} aggregate`,
    method: 'IS 2386 (Part 3) : 1963 (RA 2021)',
    docControl: { docNo: ca ? 'OBS/CA/06' : 'OBS/FA/02', issueNo: '01', issueDate: '', amendmentNo: '0' },
    headerFields: [],
    constants: [], derived: [],
    grids: [{
      key: 't', label: ca ? 'Wire basket method (aggregate larger than 10 mm)' : 'Pycnometer method (aggregate smaller than 10 mm)', rows: 2,
      columns: ca ? [
        { key: 'a', label: 'Basket + sample in water (A1)', unit: 'g', input: true },
        { key: 'b', label: 'Basket in water (A2)', unit: 'g', input: true },
        { key: 'c', label: 'Saturated surface-dry in air (B)', unit: 'g', input: true },
        { key: 'd', label: 'Oven-dry in air (C)', unit: 'g', input: true },
        { key: 'sub', label: 'Sample in water (A)', unit: 'g', formula: 'IF(OR(a="",b=""),"",a-b)', decimals: 1 },
        { key: 'sg', label: 'Specific gravity (oven-dry)', formula: 'IF(OR(sub="",c="",d=""),"",d/(c-sub))', decimals: 3 },
        { key: 'ssd', label: 'Specific gravity (SSD)', formula: 'IF(OR(sub="",c=""),"",c/(c-sub))', decimals: 3 },
        { key: 'app', label: 'Apparent specific gravity', formula: 'IF(OR(sub="",d=""),"",d/(d-sub))', decimals: 3 },
        { key: 'wa', label: 'Water absorption', unit: '%', formula: 'IF(OR(c="",d=""),"",(c-d)/d*100)', decimals: 2 },
      ] : [
        { key: 'a', label: 'Pycnometer + sample + water (A)', unit: 'g', input: true },
        { key: 'b', label: 'Pycnometer + water (B)', unit: 'g', input: true },
        { key: 'c', label: 'Saturated surface-dry sample (C)', unit: 'g', input: true },
        { key: 'd', label: 'Oven-dry sample (D)', unit: 'g', input: true },
        { key: 'sub', label: 'A − B', unit: 'g', formula: 'IF(OR(a="",b=""),"",a-b)', decimals: 1 },
        { key: 'sg', label: 'Specific gravity (oven-dry)', formula: 'IF(OR(sub="",c="",d=""),"",d/(c-sub))', decimals: 3 },
        { key: 'ssd', label: 'Specific gravity (SSD)', formula: 'IF(OR(sub="",c=""),"",c/(c-sub))', decimals: 3 },
        { key: 'app', label: 'Apparent specific gravity', formula: 'IF(OR(sub="",d=""),"",d/(d-sub))', decimals: 3 },
        { key: 'wa', label: 'Water absorption', unit: '%', formula: 'IF(OR(c="",d=""),"",(c-d)/d*100)', decimals: 2 },
      ],
    }],
    results: [
      { key: 'sg', label: 'Specific gravity (oven-dry)', formula: 'IF(COUNT(t.sg)=0,"",AVERAGE(t.sg))', decimals: 2 },
      { key: 'ssd', label: 'Specific gravity (SSD)', formula: 'IF(COUNT(t.ssd)=0,"",AVERAGE(t.ssd))', decimals: 2 },
      { key: 'app', label: 'Apparent specific gravity', formula: 'IF(COUNT(t.app)=0,"",AVERAGE(t.app))', decimals: 2 },
      { key: 'wa', label: 'Water absorption', formula: 'IF(COUNT(t.wa)=0,"",AVERAGE(t.wa))', unit: '%', decimals: 2 },
    ],
    checks: [{ when: 'AND(COUNT(t.sg)=2,ABS(INDEX(t.sg,1)-INDEX(t.sg,2))>0.02)', level: 'warning', message: 'The two specific gravity results differ by more than 0.02: repeat the test.' }],
    reportRows: [
      { name: 'Specific gravity', unit: '--', result: 'sg', decimals: 2, spec: '--' },
      { name: 'Water absorption', unit: '%', result: 'wa', decimals: 2, spec: '--' },
    ],
    references: ['IS 2386 (Part 3) : 1963 cl. 2 – Method I (wire basket) for aggregate larger than 10 mm, Method III (pycnometer) for fine aggregate.'],
    procedure: ca ? [
      'Wash about 2 kg of aggregate retained on 10 mm to remove dust and immerse it in water at 22–32 °C for 24 ± 0.5 hours.',
      'Place it in the wire basket, jolt 25 times to remove trapped air and weigh the basket and sample in water (A1).',
      'Remove the aggregate, weigh the empty basket in water (A2).',
      'Surface-dry the aggregate with cloths until no visible film of water remains and weigh it in air (B).',
      'Oven-dry at 110 ± 5 °C for 24 hours, cool and weigh (C).',
      'Specific gravity = C ÷ (B − A); apparent specific gravity = C ÷ (C − A); water absorption = (B − C) ÷ C × 100, where A = A1 − A2.',
    ] : [
      'Soak about 500 g of fine aggregate in water for 24 hours, then spread it to dry in warm air until it just reaches the saturated surface-dry state (cone test).',
      'Weigh the SSD sample (C), place it in the pycnometer, fill with water, remove air and weigh pycnometer + sample + water (A).',
      'Empty the pycnometer, refill it with water only to the same mark and weigh (B).',
      'Oven-dry the sample at 110 ± 5 °C for 24 hours and weigh (D).',
      'Specific gravity = D ÷ (C − (A − B)); apparent = D ÷ (D − (A − B)); water absorption = (C − D) ÷ D × 100.',
    ],
    sampleCalc: ca ? [
      'A = A1 − A2 = {t.a#1:0} − {t.b#1:0} = {t.sub#1:0} g. Specific gravity = {t.d#1:0} ÷ ({t.c#1:0} − {t.sub#1:0}) = {t.sg#1:3}.',
      'Apparent specific gravity = {t.d#1:0} ÷ ({t.d#1:0} − {t.sub#1:0}) = {t.app#1:3}. Water absorption = ({t.c#1:0} − {t.d#1:0}) ÷ {t.d#1:0} × 100 = {t.wa#1:2} %.',
    ] : [
      'A − B = {t.a#1:0} − {t.b#1:0} = {t.sub#1:0} g. Specific gravity = {t.d#1:0} ÷ ({t.c#1:0} − {t.sub#1:0}) = {t.sg#1:3}.',
      'Water absorption = ({t.c#1:0} − {t.d#1:0}) ÷ {t.d#1:0} × 100 = {t.wa#1:2} %.',
    ],
    example: ca
      ? { input: { header: {}, grids: { t: [{ a: 1955, b: 680, c: 2015, d: 2000 }] } }, expect: { 't.sg#1': 2.703, 't.app#1': 2.759, 't.wa#1': 0.75 } }
      : { input: { header: {}, grids: { t: [{ a: 1866, b: 1555, c: 500, d: 494 }] } }, expect: { 't.sg#1': 2.614, 't.wa#1': 1.21 } },
  };
}
export const CA_SG = sgTemplate('CA');
export const FA_SG = sgTemplate('FA');

function bulkDensity(kind: 'CA' | 'FA'): ObservationTemplate {
  const ca = kind === 'CA';
  const grid = (key: string, label: string): Grid => ({
    key, label, rows: 3,
    columns: [
      { key: 'm', label: 'Measure + aggregate', unit: 'kg', input: true },
      { key: 'net', label: 'Aggregate', unit: 'kg', formula: 'IF(OR(m="",me=""),"",m-me)', decimals: 3 },
      { key: 'bd', label: 'Bulk density', unit: 'kg/m³', formula: 'IF(OR(net="",vol=""),"",net/vol*1000)', decimals: 0 },
    ],
  });
  return {
    code: `${kind}-BD`, version: 1, material: ca ? 'Coarse aggregate' : 'Fine aggregate', category: ca ? 'Coarse aggregate' : 'Fine aggregate',
    name: `Bulk density and voids of ${ca ? 'coarse' : 'fine'} aggregate`,
    method: 'IS 2386 (Part 3) : 1963 (RA 2021)',
    docControl: { docNo: ca ? 'OBS/CA/07' : 'OBS/FA/03', issueNo: '01', issueDate: '', amendmentNo: '0' },
    equipment: [{ key: 'meas', label: 'Cylindrical measure', category: 'Cylindrical measure' }],
    headerFields: [{ key: 'gs', label: 'Specific gravity of aggregate', type: 'number', help: 'From the specific gravity test' }],
    constants: [
      { key: 'vol', label: 'Volume of measure', unit: 'litre', fromEquipment: 'meas.volume', value: ca ? 15 : 3, note: ca ? '15 litre for 4.75–40 mm aggregate' : '3 litre for fine aggregate' },
      { key: 'me', label: 'Mass of empty measure', unit: 'kg', fromEquipment: 'meas.mass' },
    ],
    derived: [],
    grids: [grid('rod', 'Compacted (rodded) – three layers, 25 strokes each'), grid('loose', 'Loose (shovelled from 50 mm height)')],
    results: [
      { key: 'bd_rod', label: 'Bulk density – compacted', formula: 'IF(COUNT(rod.bd)=0,"",AVERAGE(rod.bd))', unit: 'kg/m³', decimals: 0 },
      { key: 'bd_loose', label: 'Bulk density – loose', formula: 'IF(COUNT(loose.bd)=0,"",AVERAGE(loose.bd))', unit: 'kg/m³', decimals: 0 },
      { key: 'voids_rod', label: 'Voids – compacted', formula: 'IF(OR(gs="",bd_rod=""),"",(gs-bd_rod/1000)/gs*100)', unit: '%', decimals: 1 },
      { key: 'voids_loose', label: 'Voids – loose', formula: 'IF(OR(gs="",bd_loose=""),"",(gs-bd_loose/1000)/gs*100)', unit: '%', decimals: 1 },
    ],
    checks: [{ when: 'me=""', level: 'warning', message: 'Enter the mass of the empty measure (or select a calibrated measure).' }],
    reportRows: [
      { name: 'Bulk density (compacted)', unit: 'kg/m³', result: 'bd_rod', decimals: 0, spec: '--' },
      { name: 'Bulk density (loose)', unit: 'kg/m³', result: 'bd_loose', decimals: 0, spec: '--' },
      { name: 'Percentage of voids (compacted)', unit: '%', result: 'voids_rod', decimals: 1, spec: '--' },
    ],
    references: ['IS 2386 (Part 3) : 1963 cl. 3. Measure sizes: 3 litre (≤ 4.75 mm), 15 litre (4.75–40 mm), 30 litre (> 40 mm).'],
    procedure: [
      'Use oven-dry aggregate. Calibrate the measure by filling it with water and weighing (1 kg water = 1 litre).',
      'Compacted: fill the measure in three layers, tamping each layer 25 times with the 16 mm rod; strike off and weigh.',
      'Loose: fill the measure to overflowing with a shovel from a height not exceeding 50 mm; strike off and weigh.',
      'Bulk density = net mass ÷ volume. Voids % = (Gs − γ) ÷ Gs × 100 with γ in g/cm³.',
    ],
    sampleCalc: [
      'Compacted: measure + aggregate = {rod.m#1:2} kg, empty = {me:2} kg → net {rod.net#1:2} kg ÷ {vol:0} litre = {rod.bd#1:0} kg/m³.',
      'Voids = ({gs:2} − {bd_rod:0}/1000) ÷ {gs:2} × 100 = {voids_rod:1} %.',
    ],
    example: ca
      ? { input: { header: { gs: 2.7 }, constants: { me: 9.2 }, grids: { rod: [{ m: 32.85 }], loose: [{ m: 30.6 }] } }, expect: { 'rod.bd#1': 1576.7, voids_rod: 41.6 } }
      : { input: { header: { gs: 2.61 }, constants: { me: 2.1 }, grids: { rod: [{ m: 7.26 }], loose: [{ m: 6.84 }] } }, expect: { 'rod.bd#1': 1720, voids_rod: 34.1 } },
  };
}
export const CA_BD = bulkDensity('CA');
export const FA_BD = bulkDensity('FA');

function soundness(kind: 'CA' | 'FA'): ObservationTemplate {
  const ca = kind === 'CA';
  const fr = ca ? ['63 – 40 mm', '40 – 20 mm', '20 – 10 mm', '10 – 4.75 mm'] : ['10 – 4.75 mm', '4.75 – 2.36 mm', '2.36 – 1.18 mm', '1.18 mm – 600 µm', '600 – 300 µm'];
  return {
    code: `${kind}-SOUND`, version: 1, material: ca ? 'Coarse aggregate' : 'Fine aggregate', category: ca ? 'Coarse aggregate' : 'Fine aggregate',
    name: `Soundness of ${ca ? 'coarse' : 'fine'} aggregate`,
    method: 'IS 2386 (Part 5) : 1963 (RA 2021)',
    docControl: { docNo: ca ? 'OBS/CA/08' : 'OBS/FA/05', issueNo: '01', issueDate: '', amendmentNo: '0' },
    headerFields: [{ key: 'sol', label: 'Solution', type: 'select', options: ['Sodium sulphate', 'Magnesium sulphate'], default: 'Sodium sulphate' }, { key: 'cycles', label: 'Number of cycles', type: 'number', default: 5 }],
    constants: [
      { key: 'lim_na', label: 'Limit with sodium sulphate', unit: '%', value: ca ? 12 : 10 },
      { key: 'lim_mg', label: 'Limit with magnesium sulphate', unit: '%', value: ca ? 18 : 15 },
    ],
    derived: [{ key: 'lim', label: 'Applicable limit', formula: 'IF(LEFT(sol,1)="M",lim_mg,lim_na)', unit: '%', decimals: 0 }],
    grids: [{
      key: 'fr', label: 'Size fractions', fixedRows: fr.map((f) => ({ fraction: f })),
      columns: [
        { key: 'fraction', label: 'Fraction' },
        { key: 'grad', label: 'Grading of original sample', unit: '%', input: true },
        { key: 'before', label: 'Mass before test', unit: 'g', input: true },
        { key: 'after', label: 'Retained after test', unit: 'g', input: true },
        { key: 'loss', label: 'Loss', unit: '%', formula: 'IF(OR(before="",after=""),"",(before-after)/before*100)', decimals: 2 },
        { key: 'wl', label: 'Weighted loss', unit: '%', formula: 'IF(OR(loss="",grad=""),"",loss*grad/100)', decimals: 2 },
      ],
    }],
    results: [{ key: 'loss', label: 'Weighted average loss', formula: 'IF(COUNT(fr.wl)=0,"",SUM(fr.wl))', unit: '%', decimals: 2 }],
    checks: [{ when: 'AND(loss<>"",loss>lim)', level: 'warning', message: 'Weighted loss exceeds the IS 383 limit.' }],
    reportRows: [{ name: 'Soundness (weighted average loss after 5 cycles)', unit: '%', result: 'loss', decimals: 2, specFormula: '"Max "&FIXED(lim,0)&" ("&sol&")"' }],
    references: ['IS 2386 (Part 5) : 1963.', `IS 383 : 2016 – average loss after 5 cycles not more than ${ca ? '12% (sodium) / 18% (magnesium)' : '10% (sodium) / 15% (magnesium)'}.`],
    procedure: [
      'Prepare the saturated sulphate solution and keep it at 27 ± 2 °C.',
      'Wash and oven-dry the sample, separate the fractions shown and weigh each fraction (mass before test).',
      'Immerse the fractions in the solution for 16 to 18 hours, then drain and oven-dry at 105–110 °C. This is one cycle; repeat for 5 cycles.',
      'After the last cycle wash out the sulphate (test with barium chloride), dry, and sieve each fraction on the sieve specified for it; weigh the retained mass.',
      'Loss % per fraction = (before − after) ÷ before × 100. Weighted loss = loss × grading % of that fraction in the original sample. Sum the weighted losses.',
    ],
    sampleCalc: [`Fraction {fr.fraction#${ca ? 2 : 2}}: ({fr.before#2:0} − {fr.after#2:0}) ÷ {fr.before#2:0} × 100 = {fr.loss#2:2} %; weighted = {fr.loss#2:2} × {fr.grad#2:0} ÷ 100 = {fr.wl#2:2} %.`, 'Sum of weighted losses = {loss:2} % (limit {lim:0} %).'],
    example: ca
      ? { input: { header: {}, grids: { fr: [{}, { grad: 35, before: 1500, after: 1462 }, { grad: 50, before: 1000, after: 968 }, { grad: 15, before: 300, after: 287 }] } }, expect: { 'fr.wl#2': 0.887, loss: 3.137 } }
      : { input: { header: {}, grids: { fr: [{}, { grad: 8, before: 100, after: 94 }, { grad: 14, before: 100, after: 95 }, { grad: 19, before: 100, after: 96 }, { grad: 28, before: 100, after: 97 }] } }, expect: { 'fr.wl#2': 0.48, loss: 2.78 } },
  };
}
export const CA_SOUND = soundness('CA');
export const FA_SOUND = soundness('FA');

export const CA_TENFINES: ObservationTemplate = {
  code: 'CA-10FINES', version: 1, material: 'Coarse aggregate', category: 'Coarse aggregate',
  name: 'Ten per cent fines value',
  method: 'IS 2386 (Part 4) : 1963 (RA 2021)',
  docControl: { docNo: 'OBS/CA/09', issueNo: '01', issueDate: '', amendmentNo: '0' },
  equipment: [{ key: 'ctm', label: 'Compression testing machine', category: 'Compression testing machine' }],
  headerFields: [usage],
  constants: [], derived: [],
  grids: [{
    key: 't', label: 'Trials (12.5 – 10 mm fraction)', rows: 2,
    columns: [
      { key: 'x', label: 'Maximum load applied (x)', unit: 'kN', input: true },
      { key: 'a', label: 'Mass of sample', unit: 'g', input: true },
      { key: 'b', label: 'Passing 2.36 mm', unit: 'g', input: true },
      { key: 'y', label: 'Fines (y)', unit: '%', formula: 'IF(OR(a="",b=""),"",b/a*100)', decimals: 2 },
      { key: 'f', label: 'Load for 10% fines', unit: 'kN', formula: 'IF(OR(x="",y=""),"",14*x/(y+4))', decimals: 1 },
    ],
  }],
  results: [{ key: 'tfv', label: 'Ten per cent fines value', formula: 'IF(COUNT(t.f)=0,"",ROUND(AVERAGE(t.f),0))', unit: 'kN', decimals: 0 }],
  checks: [{ when: 'OR(COUNTIF(t.y,"<7.5")>0,COUNTIF(t.y,">12.5")>0)', level: 'warning', message: 'Fines must lie between 7.5% and 12.5%; repeat with an adjusted load.' }],
  reportRows: [{ name: 'Ten per cent fines value', unit: 'kN', result: 'tfv', decimals: 0, specFormula: `"Min "&${wear('50', '30')}` }],
  references: ['IS 2386 (Part 4) : 1963 cl. 3.', 'Minimum 50 kN for wearing surfaces and 30 kN for other concrete (IS 383).'],
  procedure: [
    'Prepare the 12.5–10 mm fraction and fill the cylinder as for the crushing value test.',
    'Apply load uniformly so that the plunger penetrates about 15 mm (rounded), 20 mm (normal) or 24 mm (honeycombed) in 10 minutes; record the maximum load x.',
    'Sieve on 2.36 mm and weigh the fines; fines % (y) should be between 7.5 and 12.5.',
    'Load for 10% fines = 14x ÷ (y + 4). Report the mean of two tests to the nearest whole kN.',
  ],
  sampleCalc: ['x = {t.x#1:0} kN, fines y = {t.b#1:0} ÷ {t.a#1:0} × 100 = {t.y#1:2} % → 14 × {t.x#1:0} ÷ ({t.y#1:2} + 4) = {t.f#1:1} kN.'],
  example: { input: { header: {}, grids: { t: [{ x: 165, a: 2950, b: 310 }] } }, expect: { 't.y#1': 10.51, 't.f#1': 159.2 } },
};

function deleterious(kind: 'CA' | 'FA'): ObservationTemplate {
  const ca = kind === 'CA';
  return {
    code: `${kind}-DEL`, version: 1, material: ca ? 'Coarse aggregate' : 'Fine aggregate', category: ca ? 'Coarse aggregate' : 'Fine aggregate',
    name: `Material finer than 75 µm and clay lumps in ${ca ? 'coarse' : 'fine'} aggregate`,
    method: 'IS 2386 (Part 1 & Part 2) : 1963 (RA 2021)',
    docControl: { docNo: ca ? 'OBS/CA/10' : 'OBS/FA/04', issueNo: '01', issueDate: '', amendmentNo: '0' },
    headerFields: [{ key: 'type', label: 'Type of aggregate', type: 'select', options: ca ? ['Crushed', 'Uncrushed'] : ['Natural sand', 'Crushed sand', 'Mixed sand'], default: ca ? 'Crushed' : 'Natural sand' }],
    constants: [
      { key: 'lim75', label: ca ? 'Limit – finer than 75 µm' : 'Limit – finer than 75 µm (natural sand)', unit: '%', value: ca ? 1 : 3 },
      ...(ca ? [] : [{ key: 'lim75c', label: 'Limit – finer than 75 µm (crushed / mixed sand)', unit: '%', value: 15 }]),
      { key: 'limclay', label: 'Limit – clay lumps', unit: '%', value: 1 },
    ],
    derived: [{ key: 'lim', label: 'Applicable limit (finer than 75 µm)', formula: ca ? 'lim75' : 'IF(type="Natural sand",lim75,lim75c)', unit: '%', decimals: 0 }],
    grids: [
      { key: 'w', label: 'Material finer than 75 µm (decantation / washing)', rows: 2, columns: [
        { key: 'b', label: 'Original dry mass (B)', unit: 'g', input: true },
        { key: 'c', label: 'Dry mass after washing (C)', unit: 'g', input: true },
        { key: 'p', label: 'Finer than 75 µm', unit: '%', formula: 'IF(OR(b="",c=""),"",(b-c)/b*100)', decimals: 2 },
      ] },
      { key: 'cl', label: 'Clay lumps', rows: 1, columns: [
        { key: 'w', label: 'Mass of sample (W)', unit: 'g', input: true },
        { key: 'r', label: 'Mass after removing clay lumps (R)', unit: 'g', input: true },
        { key: 'p', label: 'Clay lumps', unit: '%', formula: 'IF(OR(w="",r=""),"",(w-r)/w*100)', decimals: 2 },
      ] },
    ],
    results: [
      { key: 'fines', label: 'Material finer than 75 µm', formula: 'IF(COUNT(w.p)=0,"",AVERAGE(w.p))', unit: '%', decimals: 2 },
      { key: 'clay', label: 'Clay lumps', formula: 'IF(COUNT(cl.p)=0,"",AVERAGE(cl.p))', unit: '%', decimals: 2 },
    ],
    checks: [
      { when: 'AND(fines<>"",fines>lim)', level: 'warning', message: 'Material finer than 75 µm exceeds the IS 383 limit.' },
      { when: 'AND(clay<>"",clay>limclay)', level: 'warning', message: 'Clay lumps exceed the IS 383 limit.' },
    ],
    reportRows: [
      { name: 'Material finer than 75 µm', unit: '%', result: 'fines', decimals: 2, specFormula: '"Max "&FIXED(lim,0)' },
      { name: 'Clay lumps', unit: '%', result: 'clay', decimals: 2, specFormula: '"Max "&FIXED(limclay,0)' },
    ],
    references: ['IS 2386 (Part 1) cl. 3 (finer than 75 µm by washing) and IS 2386 (Part 2) cl. 2 (clay lumps).', 'IS 383 : 2016 Table 2 – deleterious materials (limits editable above).'],
    procedure: [
      'Oven-dry the sample and weigh it (B). Place it in a container, cover with water and agitate vigorously to bring the fines into suspension.',
      'Decant the wash water over the 1.18 mm and 75 µm sieves nested together; repeat until the wash water is clear.',
      'Return the material retained on the sieves to the washed sample, oven-dry and weigh (C). Finer than 75 µm = (B − C) ÷ B × 100.',
      'Clay lumps: soak a separate dry sample for 24 hours, break any lumps between the fingers, wet-sieve on the specified sieve, dry and weigh (R). Clay lumps = (W − R) ÷ W × 100.',
    ],
    sampleCalc: ['Finer than 75 µm = ({w.b#1:0} − {w.c#1:0}) ÷ {w.b#1:0} × 100 = {w.p#1:2} % (limit {lim:0} %).', 'Clay lumps = ({cl.w#1:0} − {cl.r#1:0}) ÷ {cl.w#1:0} × 100 = {cl.p#1:2} %.'],
    example: ca
      ? { input: { header: {}, grids: { w: [{ b: 5000, c: 4962 }], cl: [{ w: 2000, r: 1990 }] } }, expect: { fines: 0.76, clay: 0.5 } }
      : { input: { header: {}, grids: { w: [{ b: 500, c: 488 }], cl: [{ w: 200, r: 199 }] } }, expect: { fines: 2.4, clay: 0.5 } },
  };
}
export const CA_DEL = deleterious('CA');
export const FA_DEL = deleterious('FA');

// ---------- fine aggregate ----------

const zoneOk = (n: number) => `IF(OR(pass="",INDEX(fz.lo${n},ROW())=""),1,IF(AND(pass>=INDEX(fz.lo${n},ROW()),pass<=IF(AND(size=0.15,sand<>"Natural sand"),20,INDEX(fz.hi${n},ROW()))),1,0))`;
const zoneLimit = (n: number) => `IF(INDEX(fz.lo${n},ROW())="","",FIXED(INDEX(fz.lo${n},ROW()),0)&IF(INDEX(fz.lo${n},ROW())=INDEX(fz.hi${n},ROW()),""," - "&FIXED(IF(AND(size=0.15,sand<>"Natural sand"),20,INDEX(fz.hi${n},ROW())),0)))`;

export const FA_SIEVE: ObservationTemplate = {
  code: 'FA-SIEVE', version: 1, material: 'Fine aggregate', category: 'Fine aggregate',
  name: 'Sieve analysis and fineness modulus of fine aggregate',
  method: 'IS 2386 (Part 1) : 1963 (RA 2021)',
  docControl: { docNo: 'OBS/FA/01', issueNo: '01', issueDate: '', amendmentNo: '0' },
  headerFields: [
    { key: 'sand', label: 'Type of sand', type: 'select', options: ['Natural sand', 'Crushed sand', 'Mixed sand'], default: 'Natural sand' },
    { key: 'total', label: 'Total oven-dry mass of sample', type: 'number', unit: 'g', required: true },
  ],
  constants: [], derived: [],
  tables: { fz: FA_ZONES },
  grids: [(() => {
    const g = sieveGrid('sv', 'Sieve analysis', [['10 mm', 10], ['4.75 mm', 4.75], ['2.36 mm', 2.36], ['1.18 mm', 1.18], ['600 µm', 0.6], ['300 µm', 0.3], ['150 µm', 0.15], ['Pan', 0]]);
    g.columns.push(
      { key: 'fm', label: 'For FM', formula: 'IF(OR(size=0,cump=""),0,cump)', decimals: 1 },
      { key: 'z1', label: 'Zone I', formula: zoneLimit(1) }, { key: 'z2', label: 'Zone II', formula: zoneLimit(2) },
      { key: 'z3', label: 'Zone III', formula: zoneLimit(3) }, { key: 'z4', label: 'Zone IV', formula: zoneLimit(4) },
      { key: 'in1', label: 'In I', formula: zoneOk(1), decimals: 0 }, { key: 'in2', label: 'In II', formula: zoneOk(2), decimals: 0 },
      { key: 'in3', label: 'In III', formula: zoneOk(3), decimals: 0 }, { key: 'in4', label: 'In IV', formula: zoneOk(4), decimals: 0 },
    );
    return g;
  })()],
  results: [
    { key: 'sum', label: 'Sum of retained masses', formula: 'SUM(sv.ret)', unit: 'g', decimals: 1 },
    { key: 'fm', label: 'Fineness modulus', formula: 'IF(COUNT(sv.ret)=0,"",SUM(sv.fm)/100)', decimals: 2 },
    { key: 'zone', label: 'Grading zone (IS 383 Table 9)', formula: 'IF(COUNT(sv.ret)=0,"",IF(COUNTIF(sv.in1,0)=0,"Zone I",IF(COUNTIF(sv.in2,0)=0,"Zone II",IF(COUNTIF(sv.in3,0)=0,"Zone III",IF(COUNTIF(sv.in4,0)=0,"Zone IV","Does not fall in any zone")))))' },
  ],
  checks: [
    { when: 'AND(total<>"",COUNT(sv.ret)>0,ABS(sum-total)>total*0.01)', level: 'warning', message: 'Sum of retained masses differs from the total mass by more than 1%.' },
    { when: 'zone="Does not fall in any zone"', level: 'warning', message: 'Grading is outside all zones. IS 383 allows a total deviation of up to 5% on sieves other than 600 µm and the outer limits; check before reporting.' },
  ],
  chart: { grid: 'sv', x: 'size', y: 'pass', xLog: true, title: 'Gradation curve', xLabel: 'IS sieve size (mm)', yLabel: 'Passing (%)' },
  reportRows: [
    { name: 'Fineness modulus', unit: '--', result: 'fm', decimals: 2, spec: '--' },
    { name: 'Grading zone', unit: '--', result: 'zone', spec: 'IS 383 : 2016 Table 9' },
  ],
  reportTables: [{ title: 'Sieve analysis of fine aggregate', grid: 'sv', skipBlank: 'pass', columns: [{ key: 'sieve', label: 'IS sieve' }, { key: 'pass', label: 'Passing (%)', decimals: 1 }, { key: 'z1', label: 'Zone I' }, { key: 'z2', label: 'Zone II' }, { key: 'z3', label: 'Zone III' }, { key: 'z4', label: 'Zone IV' }] }],
  references: ['IS 2386 (Part 1) : 1963.', 'IS 383 : 2016 Table 9 – grading zones; for crushed sand the 150 µm limit is raised to 20%.'],
  procedure: [
    'Oven-dry about 500 g of fine aggregate at 110 ± 5 °C and weigh it (total mass).',
    'Sieve through 10 mm, 4.75 mm, 2.36 mm, 1.18 mm, 600 µm, 300 µm and 150 µm IS sieves, shaking each sieve for at least 2 minutes.',
    'Weigh the material retained on each sieve and in the pan; the sum should agree with the total within 1%.',
    'Compute cumulative % retained and % passing. Fineness modulus = sum of cumulative % retained on the standard sieves (10 mm to 150 µm) ÷ 100.',
    'Compare % passing with the limits in IS 383 Table 9 and report the zone in which the sand falls.',
  ],
  sampleCalc: [
    'Total {total:0} g. Retained cumulative % on 4.75 mm, 2.36, 1.18, 0.600, 0.300, 0.150 mm: {sv.cump#2:1}, {sv.cump#3:1}, {sv.cump#4:1}, {sv.cump#5:1}, {sv.cump#6:1}, {sv.cump#7:1}.',
    'Fineness modulus = (0 + {sv.cump#2:1} + {sv.cump#3:1} + {sv.cump#4:1} + {sv.cump#5:1} + {sv.cump#6:1} + {sv.cump#7:1}) ÷ 100 = {fm:2}.',
    'Passing 600 µm = {sv.pass#5:1} % (Zone II: 35–59) and all other sieves within Zone II limits → {zone}.',
  ],
  example: {
    input: { header: { total: 500 }, grids: { sv: [{ ret: 0 }, { ret: 12 }, { ret: 38 }, { ret: 70 }, { ret: 95 }, { ret: 140 }, { ret: 110 }, { ret: 35 }] } },
    expect: { fm: 2.434, zone: 'Zone II', 'sv.pass#5': 57 },
  },
};

export const FA_BULKING: ObservationTemplate = {
  code: 'FA-BULKING', version: 1, material: 'Fine aggregate', category: 'Fine aggregate',
  name: 'Bulking of fine aggregate',
  method: 'IS 2386 (Part 3) : 1963 (RA 2021)',
  docControl: { docNo: 'OBS/FA/06', issueNo: '01', issueDate: '', amendmentNo: '0' },
  headerFields: [],
  constants: [], derived: [],
  grids: [{
    key: 't', label: 'Trials', rows: 3,
    columns: [
      { key: 'h1', label: 'Height of damp sand (h)', unit: 'mm', input: true },
      { key: 'h2', label: 'Height after inundation (h′)', unit: 'mm', input: true },
      { key: 'b', label: 'Bulking', unit: '%', formula: 'IF(OR(h1="",h2=""),"",(h1/h2-1)*100)', decimals: 1 },
    ],
  }],
  results: [{ key: 'bulk', label: 'Bulking of sand', formula: 'IF(COUNT(t.b)=0,"",AVERAGE(t.b))', unit: '%', decimals: 1 }],
  checks: [],
  reportRows: [{ name: 'Bulking of sand', unit: '%', result: 'bulk', decimals: 1, spec: '--' }],
  references: ['IS 2386 (Part 3) : 1963 cl. 4 (field method).'],
  procedure: [
    'Put sufficient damp sand loosely into a container until it is about two-thirds full. Level the top and measure the height h by pushing a steel rule down to the bottom.',
    'Empty the sand, half-fill the container with water and put back about half the sand, rodding to remove air; add the rest, rod and level.',
    'Measure the height of the inundated sand h′. Bulking % = (h ÷ h′ − 1) × 100.',
  ],
  sampleCalc: ['h = {t.h1#1:0} mm, h′ = {t.h2#1:0} mm → ({t.h1#1:0} ÷ {t.h2#1:0} − 1) × 100 = {t.b#1:1} %.'],
  example: { input: { header: {}, grids: { t: [{ h1: 200, h2: 172 }] } }, expect: { 't.b#1': 16.28 } },
};

export const AGGREGATE_TEMPLATES: ObservationTemplate[] = [CA_SIEVE, CA_FLAKY, CA_IMPACT, CA_CRUSHING, CA_LA, CA_SG, CA_BD, CA_SOUND, CA_TENFINES, CA_DEL, FA_SIEVE, FA_SG, FA_BD, FA_BULKING, FA_DEL, FA_SOUND];
