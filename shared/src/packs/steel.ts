import type { ObservationTemplate } from '../observation';

/** High strength deformed steel bars: IS 1786 : 2008 (RA 2018) requirements, tested to IS 1608 (Part 1) and IS 1599. */

const GRADES = ['Fe 415', 'Fe 415D', 'Fe 500', 'Fe 500D', 'Fe 550', 'Fe 550D', 'Fe 600'];
const STEEL = {
  g: GRADES,
  ys: [415, 415, 500, 500, 550, 550, 600],
  ratio: [1.10, 1.12, 1.08, 1.10, 1.06, 1.08, 1.06],
  ts: [485, 500, 545, 565, 585, 600, 660],
  el: [14.5, 18, 12, 16, 10, 14.5, 10],
  agt: ['', 5, '', 5, '', 5, ''],
  bend_small: [3, 3, 4, 4, 5, 5, 5], bend_large: [4, 4, 5, 5, 6, 6, 6],
};
const L = (c: string) => `IFERROR(LOOKUPX(grade,st.g,st.${c}),"")`;

export const STEEL_TMT: ObservationTemplate = {
  code: 'STEEL-TMT', version: 1, material: 'Steel', category: 'Steel',
  name: 'Physical properties of HSD / TMT reinforcement bars',
  method: 'IS 1608 (Part 1) : 2022 & IS 1786 : 2008',
  docControl: { docNo: 'OBS/ST/01', issueNo: '01', issueDate: '', amendmentNo: '0' },
  equipment: [{ key: 'utm', label: 'Universal testing machine', category: 'Universal testing machine' }],
  headerFields: [
    { key: 'grade', label: 'Grade', type: 'select', options: GRADES, required: true, default: 'Fe 500D' },
    { key: 'dia', label: 'Nominal diameter', type: 'select', options: ['8', '10', '12', '16', '20', '25', '28', '32', '36', '40'], unit: 'mm', required: true },
    { key: 'brand', label: 'Brand / heat no.', type: 'text' },
    { key: 'basis', label: 'Area used for stress', type: 'select', options: ['Effective (from mass)', 'Nominal'], default: 'Effective (from mass)' },
  ],
  constants: [{ key: 'utm_cf', label: 'UTM correction factor', fromEquipment: 'utm.correction', value: 1 }],
  tables: { st: STEEL },
  derived: [
    { key: 'd', label: 'Nominal diameter', formula: 'IF(dia="","",dia*1)', unit: 'mm', decimals: 0 },
    { key: 'an', label: 'Nominal area', formula: 'IF(d="","",PI()*d^2/4)', unit: 'mm²', decimals: 1 },
    { key: 'mn', label: 'Nominal mass', formula: 'IF(d="","",d^2/162.2)', unit: 'kg/m', decimals: 3 },
    { key: 'tol', label: 'Mass tolerance (±, individual sample)', formula: 'IF(d="","",IF(d<=10,8,IF(d<=16,6,4)))', unit: '%', decimals: 0 },
    { key: 'ys_min', label: 'Min 0.2% proof / yield stress', formula: L('ys'), unit: 'N/mm²', decimals: 0 },
    { key: 'ts_min', label: 'Min tensile strength', formula: L('ts'), unit: 'N/mm²', decimals: 0 },
    { key: 'ratio_min', label: 'Min TS / YS ratio', formula: L('ratio'), decimals: 2 },
    { key: 'el_min', label: 'Min elongation', formula: L('el'), unit: '%', decimals: 1 },
    { key: 'agt_min', label: 'Min total elongation at max force', formula: L('agt'), unit: '%', decimals: 0 },
    { key: 'mandrel', label: 'Bend test mandrel', formula: `IF(d="","",IF(d<=20,${L('bend_small')},${L('bend_large')})&"d = "&FIXED(d*IF(d<=20,${L('bend_small')},${L('bend_large')}),0)&" mm")` },
  ],
  grids: [{
    key: 'b', label: 'Bars', rows: 3,
    columns: [
      { key: 'id', label: 'Bar ID', input: true, text: true },
      { key: 'len', label: 'Length for mass', unit: 'mm', input: true },
      { key: 'mass', label: 'Mass', unit: 'kg', input: true },
      { key: 'mpm', label: 'Mass per metre', unit: 'kg/m', formula: 'IF(OR(len="",mass=""),"",mass/(len/1000))', decimals: 3 },
      { key: 'dev', label: 'Deviation from nominal', unit: '%', formula: 'IF(OR(mpm="",mn=""),"",(mpm-mn)/mn*100)', decimals: 2 },
      { key: 'ae', label: 'Effective area', unit: 'mm²', formula: 'IF(mpm="","",mpm/0.00785)', decimals: 1 },
      { key: 'a', label: 'Area for stress', unit: 'mm²', formula: 'IF(LEFT(basis,1)="N",an,IF(ae="",an,ae))', decimals: 1 },
      { key: 'py', label: '0.2% proof / yield load', unit: 'kN', input: true },
      { key: 'pm', label: 'Maximum load', unit: 'kN', input: true },
      { key: 'l0', label: 'Gauge length marked', unit: 'mm', input: true },
      { key: 'lf', label: 'Final gauge length', unit: 'mm', input: true },
      { key: 'agt', label: 'Agt (if measured)', unit: '%', input: true },
      { key: 'ys', label: '0.2% proof stress', unit: 'N/mm²', formula: 'IF(OR(py="",a=""),"",py*utm_cf*1000/a)', decimals: 1 },
      { key: 'uts', label: 'Tensile strength', unit: 'N/mm²', formula: 'IF(OR(pm="",a=""),"",pm*utm_cf*1000/a)', decimals: 1 },
      { key: 'ratio', label: 'TS / YS', formula: 'IF(OR(ys="",uts=""),"",uts/ys)', decimals: 2 },
      { key: 'el', label: 'Elongation', unit: '%', formula: 'IF(OR(l0="",lf=""),"",(lf-l0)/l0*100)', decimals: 1 },
      { key: 'bend', label: 'Bend test', input: true, options: ['Satisfactory', 'Not satisfactory', 'Not tested'] },
      { key: 'rebend', label: 'Rebend test', input: true, options: ['Satisfactory', 'Not satisfactory', 'Not tested'] },
      { key: 'ok', label: 'Meets IS 1786', formula: 'IF(ys="","",IF(AND(ys>=ys_min,uts>=MAX(ts_min,ratio_min*ys),OR(el="",el>=el_min),OR(agt="",agt_min="",agt>=agt_min),OR(dev="",ABS(dev)<=tol)),"Yes","No"))' },
    ],
  }],
  results: [
    { key: 'mpm', label: 'Mass per metre (mean)', formula: 'IF(COUNT(b.mpm)=0,"",AVERAGE(b.mpm))', unit: 'kg/m', decimals: 3 },
    { key: 'dev', label: 'Deviation from nominal mass (mean)', formula: 'IF(COUNT(b.dev)=0,"",AVERAGE(b.dev))', unit: '%', decimals: 2 },
    { key: 'ys', label: '0.2% proof stress (min of bars)', formula: 'IF(COUNT(b.ys)=0,"",MIN(b.ys))', unit: 'N/mm²', decimals: 1 },
    { key: 'uts', label: 'Tensile strength (min of bars)', formula: 'IF(COUNT(b.uts)=0,"",MIN(b.uts))', unit: 'N/mm²', decimals: 1 },
    { key: 'ratio', label: 'TS / YS ratio (min of bars)', formula: 'IF(COUNT(b.ratio)=0,"",MIN(b.ratio))', decimals: 2 },
    { key: 'el', label: 'Elongation (min of bars)', formula: 'IF(COUNT(b.el)=0,"",MIN(b.el))', unit: '%', decimals: 1 },
    { key: 'bend', label: 'Bend test', formula: 'IF(COUNTA(b.bend)=0,"",IF(COUNTIF(b.bend,"Not satisfactory")>0,"Not satisfactory",IF(COUNTIF(b.bend,"Satisfactory")>0,"Satisfactory","Not tested")))' },
    { key: 'rebend', label: 'Rebend test', formula: 'IF(COUNTA(b.rebend)=0,"",IF(COUNTIF(b.rebend,"Not satisfactory")>0,"Not satisfactory",IF(COUNTIF(b.rebend,"Satisfactory")>0,"Satisfactory","Not tested")))' },
    { key: 'verdict', label: 'Conformity to IS 1786', formula: 'IF(COUNTA(b.ok)=0,"",IF(COUNTIF(b.ok,"No")>0,"Does not conform","Conforms to "&grade))' },
  ],
  checks: [
    { when: 'COUNTIF(b.ok,"No")>0', level: 'warning', message: 'At least one bar does not meet IS 1786 for the selected grade: check mass, strength, ratio and elongation.' },
    { when: 'IFERROR(AND(INDEX(b.l0,1)<>"",ABS(INDEX(b.l0,1)-5.65*SQRT(INDEX(b.a,1)))>2),FALSE)', level: 'warning', message: 'Marked gauge length differs from 5.65 √A by more than 2 mm.' },
  ],
  reportRows: [
    { name: 'Mass per metre', unit: 'kg/m', result: 'mpm', decimals: 3, specFormula: 'IF(mn="","","Nominal "&FIXED(mn,3)&" (± "&tol&" %)")' },
    { name: '0.2% proof stress / yield stress', unit: 'N/mm²', result: 'ys', decimals: 1, specFormula: 'IF(ys_min="","","Min "&ys_min)' },
    { name: 'Tensile strength', unit: 'N/mm²', result: 'uts', decimals: 1, specFormula: 'IF(ts_min="","","Min "&ts_min&" and ≥ "&FIXED(ratio_min,2)&" × YS")' },
    { name: 'Ratio TS / YS', unit: '--', result: 'ratio', decimals: 2, specFormula: 'IF(ratio_min="","","Min "&FIXED(ratio_min,2))' },
    { name: 'Elongation on 5.65 √A', unit: '%', result: 'el', decimals: 1, specFormula: 'IF(el_min="","","Min "&el_min)' },
    { name: 'Bend test', unit: '--', result: 'bend', specFormula: 'IF(mandrel="","--","No cracks on mandrel "&mandrel)' },
    { name: 'Rebend test', unit: '--', result: 'rebend', spec: 'No fracture' },
  ],
  reportTables: [{ title: 'Individual bar results', grid: 'b', skipBlank: 'ys', columns: [{ key: 'id', label: 'Bar' }, { key: 'mpm', label: 'Mass (kg/m)', decimals: 3 }, { key: 'ys', label: 'YS (N/mm²)', decimals: 1 }, { key: 'uts', label: 'TS (N/mm²)', decimals: 1 }, { key: 'ratio', label: 'TS/YS', decimals: 2 }, { key: 'el', label: 'Elongation (%)', decimals: 1 }] }],
  references: [
    'IS 1786 : 2008 Table 3 (mechanical properties) and mass tolerances (individual sample: ±8% up to 10 mm, ±6% over 10 up to 16 mm, ±4% over 16 mm).',
    'IS 1608 (Part 1) – tensile test; IS 1599 – bend test; rebend as per IS 1786. Effective area = mass per metre ÷ 0.00785 mm².',
  ],
  procedure: [
    'Cut bars of at least 0.5 m for mass, straighten without heating, measure the length (mm) and weigh (kg).',
    'Mass per metre = mass ÷ length; compare with nominal d² ÷ 162.2 and the tolerance for the size.',
    'Mark the gauge length 5.65 √A on the tensile specimen (A = effective area). Grip it in the UTM, load at the specified rate and record the 0.2% proof (or yield) load and the maximum load.',
    'Fit the broken pieces together and measure the final gauge length. Elongation = (final − original) ÷ original × 100. Measure Agt where required for D grades.',
    'Bend the bar through 180° over the specified mandrel; for rebend, bend 135°, age at 100 °C for 30 minutes, cool and bend back 23°. No cracks or fracture are allowed.',
    'Stress = load ÷ area; check yield, tensile strength (both the minimum and the TS/YS ratio), elongation and mass against IS 1786 for the grade.',
  ],
  sampleCalc: [
    '{grade}, {dia} mm: nominal mass = {dia}² ÷ 162.2 = {mn:3} kg/m. Bar mass {b.mass#1:3} kg over {b.len#1:0} mm → {b.mpm#1:3} kg/m, deviation {b.dev#1:2} % (allowed ± {tol:0} %).',
    'Effective area = {b.mpm#1:3} ÷ 0.00785 = {b.ae#1:1} mm². Yield = {b.py#1:1} kN × 1000 ÷ {b.a#1:1} = {b.ys#1:1} N/mm²; TS = {b.pm#1:1} × 1000 ÷ {b.a#1:1} = {b.uts#1:1} N/mm².',
    'TS/YS = {b.ratio#1:2} (min {ratio_min:2}); elongation = ({b.lf#1:1} − {b.l0#1:1}) ÷ {b.l0#1:1} × 100 = {b.el#1:1} % (min {el_min:1}). Meets IS 1786: {b.ok#1}.',
  ],
  example: {
    input: { header: { grade: 'Fe 500D', dia: '12' }, grids: { b: [{ id: 'B1', len: 1000, mass: 0.872, py: 61.5, pm: 72.4, l0: 60, lf: 71.4, bend: 'Satisfactory', rebend: 'Satisfactory' }] } },
    expect: { mn: 0.888, 'b.dev#1': -1.78, 'b.ys#1': 553.66, 'b.uts#1': 651.8, 'b.el#1': 19, 'b.ok#1': 'Yes', verdict: 'Conforms to Fe 500D' },
  },
};

export const STEEL_TEMPLATES: ObservationTemplate[] = [STEEL_TMT];
