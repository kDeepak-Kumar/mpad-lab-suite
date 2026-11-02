import type { ObservationTemplate, GridColumn } from '../observation';
import { SOIL_NAMES } from './soil-legend';

/**
 * Field tests on soil and foundations:
 * plate load (IS 1888), SPT (IS 2131), borehole log (IS 1892), safe bearing capacity (IS 6403 / Teng – Terzaghi & Peck),
 * pile pull-out and lateral load tests (IS 2911 Part 4).
 * Every number used in a calculation is a constant or a header value, so the lab can change it in Settings → Templates.
 */

const doc = (n: string) => ({ docNo: `OBS/FT/${n}`, issueNo: '01', issueDate: '', amendmentNo: '0' });
const T = 9.80665; // kN per tonne-force

// ---------------------------------------------------------------- plate load test
export const PLATE_LOAD: ObservationTemplate = {
  code: 'PLT', version: 1, material: 'Soil', category: 'Soil field tests',
  name: 'Plate load test',
  method: 'IS 1888 : 1982 (RA 2021)',
  docControl: doc('01'),
  equipment: [{ key: 'dg', label: 'Dial gauge', category: 'Dial gauge' }, { key: 'jack', label: 'Hydraulic jack / pressure gauge', category: 'Hydraulic jack' }],
  headerFields: [
    { key: 'test_no', label: 'Test no.', type: 'text', required: true },
    { key: 'location', label: 'Test location', type: 'text', required: true },
    { key: 'depth', label: 'Test level below ground', type: 'number', unit: 'm' },
    { key: 'shape', label: 'Plate shape', type: 'select', options: ['Square', 'Circular'], default: 'Square' },
    { key: 'plate', label: 'Plate size (side / diameter)', type: 'select', options: ['0.30', '0.45', '0.60', '0.75'], unit: 'm', default: '0.30' },
    { key: 'reaction', label: 'Reaction', type: 'select', options: ['Kentledge', 'JCB / loaded vehicle', 'Reaction truss with anchors'], default: 'Kentledge' },
    { key: 'soil', label: 'Soil at test level', type: 'select', options: ['Granular (sand / gravel)', 'Cohesive (clay / silt)'], default: 'Granular (sand / gravel)' },
    { key: 'design', label: 'Design pressure of the structure', type: 'number', unit: 'T/m²' },
    { key: 'bf', label: 'Proposed footing width', type: 'number', unit: 'm', default: 2, help: 'Used to convert the permissible settlement of the footing to the plate' },
    { key: 'sf', label: 'Permissible settlement of footing', type: 'number', unit: 'mm', default: 25 },
    { key: 'pu', label: 'Ultimate pressure from the curves (only if failure was observed)', type: 'number', unit: 'T/m²', help: 'Leave blank if the plate did not fail' },
    { key: 'remarks', label: 'Field remarks', type: 'text' },
  ],
  constants: [
    { key: 'lc', label: 'Dial gauge least count', unit: 'mm/div', fromEquipment: 'dg.lc', value: 0.01 },
    { key: 'fos', label: 'Factor of safety (shear)', value: 2.5, note: 'IS 1888 / IS 6403: 2.5 to 3' },
    { key: 'rnd', label: 'Round the safe bearing capacity down to', unit: 'T/m²', value: 1 },
    { key: 'g', label: 'kN per tonne', value: T, locked: true },
  ],
  derived: [
    { key: 'bp', label: 'Plate size', formula: 'IF(plate="","",plate*1)', unit: 'm', decimals: 2 },
    { key: 'area', label: 'Plate area', formula: 'IF(bp="","",IF(shape="Circular",PI()*bp^2/4,bp^2))', unit: 'm²', decimals: 4 },
    { key: 'sp', label: 'Plate settlement equivalent to the permissible footing settlement', formula: 'IF(OR(bp="",bf="",sf=""),"",IF(LEFT(soil,1)="C",sf*bp/bf,sf*(bp*(bf+0.3)/(bf*(bp+0.3)))^2))', unit: 'mm', decimals: 2 },
  ],
  grids: [{
    key: 'ld', label: 'Load increments – final dial readings after the settlement rate fell below 0.02 mm/min (first row = zero / seating load)', rows: 8,
    fixedRows: [{ load: 0 }, {}, {}, {}, {}, {}, {}, {}],
    columns: [
      { key: 'load', label: 'Load on plate', unit: 'T', input: true },
      { key: 'dg1', label: 'Dial gauge 1', unit: 'div', input: true },
      { key: 'dg2', label: 'Dial gauge 2', unit: 'div', input: true },
      { key: 'p', label: 'Pressure', unit: 'T/m²', formula: 'IF(OR(load="",area=""),"",load/area)', decimals: 2 },
      { key: 'pk', label: 'Pressure', unit: 'kN/m²', formula: 'IF(p="","",p*g)', decimals: 1 },
      { key: 's1', label: 'Settlement DG 1', unit: 'mm', formula: 'IF(dg1="","",ABS(dg1-INDEX(ld.dg1,1))*lc)', decimals: 2 },
      { key: 's2', label: 'Settlement DG 2', unit: 'mm', formula: 'IF(dg2="","",ABS(dg2-INDEX(ld.dg2,1))*lc)', decimals: 2 },
      { key: 's', label: 'Cumulative settlement (mean)', unit: 'mm', formula: 'IF(COUNT(s1,s2)=0,"",AVERAGE(s1,s2))', decimals: 2 },
      { key: 'ds', label: 'Settlement in this increment', unit: 'mm', formula: 'IF(OR(s="",ROW()=1),"",s-INDEX(ld.s,ROW()-1))', decimals: 2 },
    ],
  }, {
    key: 'tm', label: 'Time – settlement record (optional; 1, 2.25, 4, 6.25, 9, 16, 25 min … for each load)', rows: 6,
    columns: [
      { key: 'load', label: 'Load', unit: 'T', input: true },
      { key: 'time', label: 'Elapsed time', unit: 'min', input: true },
      { key: 'dg1', label: 'Dial gauge 1', unit: 'div', input: true },
      { key: 'dg2', label: 'Dial gauge 2', unit: 'div', input: true },
    ],
  }],
  results: [
    { key: 'lmax', label: 'Maximum load applied', formula: 'IF(COUNT(ld.p)=0,"",MAX(ld.load))', unit: 'T', decimals: 2 },
    { key: 'pmax', label: 'Maximum test pressure', formula: 'IF(COUNT(ld.p)=0,"",MAX(ld.p))', unit: 'T/m²', decimals: 2 },
    { key: 'smax', label: 'Cumulative settlement at maximum load', formula: 'IF(COUNT(ld.s)=0,"",INDEX(ld.s,MATCH(lmax,ld.load,0)))', unit: 'mm', decimals: 2 },
    { key: 'qshear', label: 'Safe pressure – shear criterion', formula: 'IF(pmax="","",IF(pu<>"",pu,pmax)/fos)', unit: 'T/m²', decimals: 2 },
    { key: 'psett', label: 'Pressure at the equivalent plate settlement', formula: 'IF(OR(sp="",smax=""),"",IF(sp>MAX(ld.s),"",INTERP(sp,ld.s,ld.p)))', unit: 'T/m²', decimals: 2 },
    { key: 'sbc_raw', label: 'Safe bearing capacity (calculated)', formula: 'IF(qshear="","",IF(psett="",qshear,MIN(qshear,psett)))', unit: 'T/m²', decimals: 2 },
    { key: 'sbc', label: 'Safe bearing capacity (reported)', formula: 'IF(sbc_raw="","",INT(sbc_raw/rnd)*rnd)', unit: 'T/m²', decimals: 1 },
    { key: 'sbc_kn', label: 'Safe bearing capacity', formula: 'IF(sbc="","",sbc*g)', unit: 'kN/m²', decimals: 0 },
    { key: 'governs', label: 'Governing criterion', formula: 'IF(sbc_raw="","",IF(psett="","Shear (plate settlement of "&FIXED(sp,2)&" mm not reached)",IF(qshear<=psett,"Shear criterion","Settlement criterion")))' },
    { key: 'basis', label: 'Basis of shear criterion', formula: 'IF(pmax="","",IF(pu<>"","ultimate pressure "&FIXED(pu,2)&" T/m² from the curves","maximum test pressure "&FIXED(pmax,2)&" T/m² (failure not reached)"))' },
  ],
  checks: [
    { when: 'AND(pmax<>"",design<>"",pmax<2.5*design)', level: 'warning', message: 'Maximum test pressure is less than 2.5 × the design pressure: the test may not prove the design value.' },
    { when: 'AND(sbc<>"",design<>"",sbc<design)', level: 'warning', message: 'Safe bearing capacity is less than the design pressure.' },
    { when: 'AND(smax<>"",smax>=25)', level: 'warning', message: 'Settlement reached 25 mm: IS 1888 treats this as the end of the test.' },
    { when: 'COUNTIF(ld.ds,"<0")>0', level: 'warning', message: 'Settlement decreased between two load steps: check the dial gauge readings.' },
  ],
  chart: { grid: 'ld', x: 'p', y: 's', yReverse: true, xTop: true, title: 'Pressure – settlement curve', label: 'Cumulative settlement', xLabel: 'Pressure on plate (T/m²)', yLabel: 'Cumulative settlement (mm)',
    note: 'Settlement increases with pressure up to the maximum test pressure of {pmax:2} T/m², where the cumulative settlement is {smax:2} mm. Governing criterion: {governs}.' },
  charts: [{ grid: 'ld', x: 's', y: 'p', xLog: true, yLog: true, title: 'Log – log plot of settlement and pressure', label: 'Test points', xLabel: 'Settlement (mm, log scale)', yLabel: 'Pressure (T/m², log scale)',
    note: 'On the log–log plot a clear break in the line marks the yield (ultimate) pressure. If a break is seen, enter that pressure as the ultimate pressure; otherwise the shear criterion uses the maximum test pressure.' }],
  reportLabel: '"Test "&test_no&IF(location="",""," – "&location)',
  reportIntro: [
    { title: 'Scope', text: 'To determine the safe bearing capacity of the foundation soil and its settlement characteristics by plate load test as per IS 1888 : 1982.' },
    { title: 'Procedure', text: 'A {plate} m {shape} plate was seated on the levelled test surface and loaded through a hydraulic jack against the reaction ({reaction}). Settlements were measured to 0.01 mm with two dial gauges on an independent datum bar. After a seating pressure of 7 kN/m², the load was applied in equal increments; each increment was maintained until the rate of settlement fell below 0.02 mm/min, with readings at 1, 2.25, 4, 6.25, 9, 16 and 25 minutes. The test was continued to failure, to 25 mm settlement, or to the maximum load planned (about 2.5 to 3 times the design pressure).' },
    { title: 'Interpretation', text: 'The pressure–settlement curve is drawn on natural and log–log scales. The safe bearing capacity is the smaller of (a) the ultimate pressure (or, where the plate did not fail, the maximum test pressure) divided by the factor of safety, and (b) the pressure producing the plate settlement equivalent to the permissible settlement of the proposed footing.' },
  ],
  reportInfo: [
    { label: 'Test no.', value: 'test_no' }, { label: 'Location', value: 'location' }, { label: 'Test level below ground', value: 'depth', unit: 'm', decimals: 2 },
    { label: 'Plate', value: 'shape&" "&FIXED(bp,2)&" m"' }, { label: 'Reaction', value: 'reaction' }, { label: 'Design pressure', value: 'design', unit: 'T/m²', decimals: 1 },
    { label: 'Maximum load applied', value: 'lmax', unit: 'T', decimals: 2 }, { label: 'Cumulative settlement', value: 'smax', unit: 'mm', decimals: 2 },
  ],
  reportRows: [
    { group: 'Plate load test', name: 'Maximum test pressure', unit: 'T/m²', result: 'pmax', decimals: 2 },
    { group: 'Plate load test', name: 'Cumulative settlement', unit: 'mm', result: 'smax', decimals: 2 },
    { group: 'Plate load test', name: 'Safe bearing capacity', unit: 'T/m²', result: 'sbc', decimals: 1, specFormula: 'IF(design="","--","Design "&FIXED(design,1))' },
    { group: 'Plate load test', name: 'Safe bearing capacity', unit: 'kN/m²', result: 'sbc_kn', decimals: 0 },
  ],
  reportTables: [{ title: 'Plate load test observations', grid: 'ld', skipBlank: 'p', columns: [
    { key: 'load', label: 'Load (T)', decimals: 2 }, { key: 'p', label: 'Pressure (T/m²)', decimals: 2 }, { key: 'pk', label: 'Pressure (kN/m²)', decimals: 1 },
    { key: 'ds', label: 'Settlement in increment (mm)', decimals: 2 }, { key: 's', label: 'Cumulative settlement (mm)', decimals: 2 }] }],
  reportText: [
    { title: 'Bearing capacity calculation', text: 'Plate area = {area:4} m². Maximum test pressure = {lmax:2} T ÷ {area:4} m² = {pmax:2} T/m². Shear criterion: safe pressure = {basis} ÷ FOS {fos:1} = {qshear:2} T/m².' },
    { text: 'Settlement criterion: a {sf:0} mm settlement of a {bf:2} m wide footing corresponds to {sp:2} mm settlement of the {bp:2} m plate. Pressure at that settlement = {psett:2} T/m².', when: 'psett<>""' },
    { text: 'Settlement criterion: a {sf:0} mm settlement of a {bf:2} m wide footing corresponds to {sp:2} mm settlement of the plate, which was not reached in the test (maximum {smax:2} mm), so the settlement criterion does not govern.', when: 'AND(psett="",sp<>"")' },
    { title: 'Result', text: 'Safe bearing capacity = {sbc:1} T/m² ({sbc_kn:0} kN/m²), governed by: {governs}.' },
    { title: 'Field remarks', text: '{remarks}', when: 'remarks<>""' },
  ],
  references: [
    'IS 1888 : 1982 (RA 2021) – Method of load test on soils. Seating pressure 7 kN/m², load increments about 1/5 of the expected safe pressure, readings at 1, 2.25, 4, 6.25, 9, 16, 25 min and then hourly until the rate falls below 0.02 mm/min.',
    'Plate to footing settlement (IS 1888 Fig. / Terzaghi & Peck): granular soil Sp = Sf [Bp (Bf + 0.3) / (Bf (Bp + 0.3))]²; cohesive soil Sp = Sf × Bp / Bf.',
    'Without failure the shear criterion conservatively uses the maximum test pressure; it is not an ultimate value.',
  ],
  procedure: [
    'Excavate a pit at least five times the plate width and level the test area. Place the plate on a thin sand layer at the test level.',
    'Erect the reaction (kentledge or loaded vehicle), place the hydraulic jack centrally on the plate and fix two dial gauges on an independent datum bar resting at least 1.5 m from the plate.',
    'Apply a seating pressure of 7 kN/m² and release it; set the dial gauges to zero (first row of the sheet).',
    'Apply the load in equal increments (about one-fifth of the expected safe pressure). Read both dial gauges at 1, 2.25, 4, 6.25, 9, 16 and 25 minutes and then hourly.',
    'Apply the next increment when the rate of settlement falls below 0.02 mm per minute. Enter the final readings of each increment in the main table.',
    'Continue until failure, until settlement reaches 25 mm, or until the pressure reaches 2.5–3 times the design pressure.',
    'Plot pressure against settlement (natural and log–log scales). If the plate failed, read the ultimate pressure from the break in the curves.',
    'Safe bearing capacity is the smaller of the shear value (ultimate or maximum pressure ÷ FOS) and the pressure that gives the permissible footing settlement.',
  ],
  sampleCalc: [
    'Plate 0.30 m × 0.30 m → area {area:4} m². At the maximum load {lmax:2} T the pressure is {lmax:2} ÷ {area:4} = {pmax:2} T/m².',
    'Settlement at {lmax:2} T = mean of the two dial gauges = {smax:2} mm.',
    'Shear: {pmax:2} ÷ {fos:1} = {qshear:2} T/m² (failure was not reached, so the maximum pressure is used).',
    'Settlement: 25 mm for a {bf:2} m footing on sand ≡ 25 × [0.30 × ({bf:2} + 0.3) / ({bf:2} × 0.60)]² = {sp:2} mm on the plate – larger than the {smax:2} mm measured, so shear governs.',
    'Safe bearing capacity = {qshear:2} → rounded down to {sbc:1} T/m² = {sbc_kn:0} kN/m².',
  ],
  example: {
    input: { header: { test_no: '1', location: 'TC03 area, outrigger 01', depth: 1.5, plate: '0.30', design: 25, bf: 3 }, grids: { ld: [
      { load: 0, dg1: 0, dg2: 0 }, { load: 1.2, dg1: 70, dg2: 72 }, { load: 2.4, dg1: 114, dg2: 116 }, { load: 3.6, dg1: 265, dg2: 267 }, { load: 4.8, dg1: 335, dg2: 337 }, { load: 6, dg1: 364, dg2: 366 },
    ] } },
    expect: { pmax: 66.67, smax: 3.65, qshear: 26.67, sp: 7.56, sbc: 26, governs: 'Shear (plate settlement of 7.56 mm not reached)' },
  },
};

// ---------------------------------------------------------------- SPT
const sptColumns = (gridKey: string, withSoil: boolean): GridColumn[] => [
  { key: 'depth', label: 'Depth', unit: 'm', input: true },
  ...(withSoil ? [{ key: 'soil', label: 'Soil description', input: true, text: true }] : []),
  { key: 'p1', label: 'Blows 1st 15 cm (seating)', input: true },
  { key: 'p2', label: 'Blows 2nd 15 cm', input: true },
  { key: 'p3', label: 'Blows 3rd 15 cm', input: true },
  { key: 'pen', label: 'Penetration at refusal', unit: 'cm', input: true },
  { key: 'fine', label: 'Fine sand / silt', input: true, options: ['No', 'Yes'] },
  { key: 'ref', label: 'Refusal', formula: 'IF(OR(depth="",p1=""),"",IF(OR(p1>=50,p2>=50,p3>=50,SUM(p2,p3)>=100),"Yes","No"))' },
  { key: 'n', label: 'N (observed)', formula: 'IF(ref="","",IF(ref="Yes",nref,p2+p3))', decimals: 0 },
  { key: 'nl', label: 'N reported', formula: 'IF(n="","",IF(ref="Yes",">"&FIXED(nref,0)&" (refusal"&IF(pen="","",", "&pen&" cm")&")",FIXED(n,0)))' },
  { key: 'sv', label: "Effective overburden σ'", unit: 'kN/m²', formula: 'IF(depth="","",gamma*depth-9.81*IF(wt="",0,MAX(0,depth-wt)))', decimals: 1 },
  { key: 'cn', label: 'Overburden factor CN', formula: 'IF(OR(sv="",n=""),"",IF(sv<=0,2,MIN(2,0.77*LOG10(2000/sv))))', decimals: 2 },
  { key: 'n1', label: 'N corrected for overburden', formula: 'IF(OR(n="",cn=""),"",IF(ref="Yes",n,n*cn))', decimals: 0 },
  { key: 'nc', label: 'N corrected (overburden + dilatancy)', formula: 'IF(n1="","",IF(AND(fine="Yes",wt<>"",depth>wt,n1>15),15+0.5*(n1-15),n1))', decimals: 0 },
];
const sptHeader = [
  { key: 'wt', label: 'Water table below ground (blank = not met)', type: 'number' as const, unit: 'm' },
  { key: 'gamma', label: 'Unit weight of soil (for overburden)', type: 'number' as const, unit: 'kN/m³', default: 18 },
  { key: 'hammer', label: 'Hammer release', type: 'select' as const, options: ['Automatic trip', 'Rope and pulley'], default: 'Automatic trip' },
];
const sptConstants = [{ key: 'nref', label: 'N used for refusal (graphs and calculations)', value: 50, note: 'IS 2131: 50 blows within a 15 cm drive is refusal' }];

export const SPT: ObservationTemplate = {
  code: 'SPT', version: 1, material: 'Soil', category: 'Soil field tests',
  name: 'Standard penetration test',
  method: 'IS 2131 : 1981 (RA 2021)',
  docControl: doc('02'),
  headerFields: [{ key: 'bh', label: 'Borehole no.', type: 'text', required: true }, { key: 'location', label: 'Location / chainage', type: 'text' }, ...sptHeader],
  constants: sptConstants, derived: [],
  grids: [{ key: 'spt', label: 'SPT records (63.5 kg hammer, 750 mm drop, split spoon)', rows: 10, columns: sptColumns('spt', true) }],
  results: [
    { key: 'tests', label: 'Number of tests', formula: 'COUNT(spt.n)', decimals: 0 },
    { key: 'nmin', label: 'Lowest corrected N', formula: 'IF(COUNT(spt.nc)=0,"",MIN(spt.nc))', decimals: 0 },
    { key: 'refusal', label: 'Refusal first met at', formula: 'IF(COUNTIF(spt.ref,"Yes")=0,"Not met",FIXED(INDEX(spt.depth,MATCH("Yes",spt.ref,0)),2)&" m")' },
  ],
  checks: [{ when: 'COUNTIF(spt.p1,">=50")>0', level: 'warning', message: 'Refusal in the seating drive: IS 2131 requires the test to be stopped and reported as refusal, not as N.' }],
  chart: { grid: 'spt', x: 'n', y: 'depth', yReverse: true, xTop: true, xMin: 0, title: 'SPT N value with depth', xLabel: 'SPT N', yLabel: 'Depth below ground (m)', label: 'N observed', series: [{ x: 'nc', y: 'depth', label: 'N corrected', dashed: true }],
    note: 'Observed N (solid) and N corrected for overburden and dilatancy (dashed). Refusal is plotted at N = {nref:0}.' },
  reportLabel: '"Borehole "&bh',
  reportInfo: [{ label: 'Borehole', value: 'bh' }, { label: 'Location', value: 'location' }, { label: 'Water table', value: 'IF(wt="","Not met",FIXED(wt,2)&" m below ground")' }, { label: 'Hammer release', value: 'hammer' }],
  reportIntro: [{ title: 'Method', text: 'The standard penetration test was conducted as per IS 2131 : 1981 by driving a split-spoon sampler 45 cm with a 63.5 kg hammer falling 750 mm. The blows for the last 30 cm give the N value; 50 blows within any 15 cm drive is recorded as refusal.' }],
  reportRows: [{ group: 'SPT', name: 'Refusal', unit: '--', result: 'refusal' }, { group: 'SPT', name: 'Lowest corrected N', unit: '--', result: 'nmin', decimals: 0 }],
  reportTables: [{ title: 'Standard penetration test results', grid: 'spt', skipBlank: 'n', columns: [
    { key: 'depth', label: 'Depth (m)', decimals: 2 }, { key: 'soil', label: 'Soil' }, { key: 'p1', label: '0–15 cm', decimals: 0 }, { key: 'p2', label: '15–30 cm', decimals: 0 }, { key: 'p3', label: '30–45 cm', decimals: 0 },
    { key: 'nl', label: 'N observed' }, { key: 'nc', label: 'N corrected', decimals: 0 }] }],
  reportText: [{ text: 'N is the number of blows for the last 30 cm of the 45 cm drive. Values are corrected for overburden pressure (CN = 0.77 log10(2000/σ′), maximum 2) and, for fine sand or silt below the water table with N above 15, for dilatancy (15 + 0.5 (N − 15)).' }],
  references: ['IS 2131 : 1981 – 63.5 kg hammer falling 750 mm; N = blows for the 2nd and 3rd 15 cm; 50 blows in the seating drive is refusal.', 'Overburden correction after Peck, Hanson & Thornburn (as in IS 2131 Fig. 1); dilatancy correction as IS 2131 cl. 4.2.'],
  procedure: [
    'Clean the borehole to the test depth and lower the split-spoon sampler on the drill rods.',
    'Drive the sampler 45 cm with the 63.5 kg hammer falling freely 750 mm, counting blows for each 15 cm.',
    'The first 15 cm is the seating drive. N = blows for the 2nd and 3rd 15 cm.',
    'If 50 blows are needed for any 15 cm (or 100 for the last 30 cm), stop: record refusal and the penetration achieved.',
    'Recover the sampler, describe and preserve the soil, and note the water level.',
    'Correct N for overburden and, for submerged fine sand or silt, for dilatancy.',
  ],
  sampleCalc: ['At {spt.depth#2:1} m: blows {spt.p1#2:0} / {spt.p2#2:0} / {spt.p3#2:0} → N = {spt.p2#2:0} + {spt.p3#2:0} = {spt.n#2:0}.',
    "σ′ = 18 × {spt.depth#2:1} = {spt.sv#2:1} kN/m² → CN = 0.77 log10(2000 / {spt.sv#2:1}) = {spt.cn#2:2} → N corrected = {spt.n1#2:0}.",
    'At {spt.depth#3:1} m the seating drive needed 50 blows: reported as {spt.nl#3}.'],
  example: { input: { header: { bh: 'BH-1', gamma: 18 }, grids: { spt: [{ depth: 1.5, soil: 'Clayey soil', p1: 4, p2: 5, p3: 5 }, { depth: 3, soil: 'Clayey soil', p1: 6, p2: 7, p3: 8 }, { depth: 4.5, soil: 'SDR', p1: 50, pen: 8 }] } },
    expect: { 'spt.n#2': 15, 'spt.cn#2': 1.21, 'spt.nl#3': '>50 (refusal, 8 cm)', refusal: '4.50 m' } },
};

// ---------------------------------------------------------------- borehole log
export const BOREHOLE: ObservationTemplate = {
  code: 'BH-LOG', version: 1, material: 'Soil', category: 'Soil field tests',
  name: 'Borehole log',
  method: 'IS 1892 : 2021 & IS 2131 : 1981',
  docControl: doc('03'),
  headerFields: [
    { key: 'bh', label: 'Borehole no.', type: 'text', required: true },
    { key: 'location', label: 'Location / chainage', type: 'text' },
    { key: 'coords', label: 'Coordinates (N, E)', type: 'text' },
    { key: 'rl', label: 'Ground level (RL)', type: 'number', unit: 'm' },
    { key: 'boring', label: 'Type of boring', type: 'select', options: ['Rotary drilling', 'Auger boring', 'Shell and auger', 'Wash boring'], default: 'Rotary drilling' },
    { key: 'dia', label: 'Borehole diameter', type: 'number', unit: 'mm', default: 150 },
    { key: 'termination', label: 'Reason for termination', type: 'select', options: ['As per client requirement', 'Refusal / hard rock met', 'Planned depth reached'], default: 'As per client requirement' },
    ...sptHeader,
  ],
  constants: sptConstants, derived: [],
  grids: [
    { key: 'st', label: 'Strata', rows: 5, columns: [
      { key: 'from', label: 'From', unit: 'm', input: true }, { key: 'to', label: 'To', unit: 'm', input: true },
      { key: 'soil', label: 'Soil / rock type', input: true, options: SOIL_NAMES, width: 22 },
      { key: 'desc', label: 'Description (colour, consistency, IS 1498 group)', input: true, text: true, width: 26 },
      { key: 'thick', label: 'Thickness', unit: 'm', formula: 'IF(OR(from="",to=""),"",to-from)', decimals: 2 },
      { key: 'line', label: 'Summary', formula: 'IF(OR(from="",to="",soil=""),"",FIXED(from,2)&" – "&FIXED(to,2)&" m: "&soil&IF(desc="",""," ("&desc&")")&". ")', hidden: true },
    ] },
    { key: 'spt', label: 'Standard penetration tests', rows: 8, columns: sptColumns('spt', false) },
    { key: 'sm', label: 'Samples', rows: 6, columns: [
      { key: 'depth', label: 'Depth', unit: 'm', input: true },
      { key: 'type', label: 'Type', input: true, options: ['DS (disturbed)', 'UDS (undisturbed)', 'SPT sample', 'Core', 'Water'] },
      { key: 'ref', label: 'Sample ref.', input: true, text: true },
    ] },
    { key: 'cr', label: 'Rock core runs (if cored)', rows: 4, columns: [
      { key: 'from', label: 'From', unit: 'm', input: true }, { key: 'to', label: 'To', unit: 'm', input: true },
      { key: 'rec', label: 'Core recovered', unit: 'cm', input: true }, { key: 'p10', label: 'Pieces ≥ 10 cm (total)', unit: 'cm', input: true },
      { key: 'crp', label: 'Core recovery', unit: '%', formula: 'IF(OR(from="",to="",rec=""),"",rec/((to-from)*100)*100)', decimals: 0 },
      { key: 'rqd', label: 'RQD', unit: '%', formula: 'IF(OR(from="",to="",p10=""),"",p10/((to-from)*100)*100)', decimals: 0 },
    ] },
  ],
  results: [
    { key: 'depth', label: 'Depth of borehole', formula: 'MAX(st.to,spt.depth,cr.to)', unit: 'm', decimals: 2 },
    { key: 'wt_txt', label: 'Water table', formula: 'IF(wt="","Not met",FIXED(wt,2)&" m below ground")' },
    { key: 'strata', label: 'Strata', formula: 'CONCAT(st.line)' },
    { key: 'refusal', label: 'SPT refusal', formula: 'IF(COUNTIF(spt.ref,"Yes")=0,"Not met",FIXED(INDEX(spt.depth,MATCH("Yes",spt.ref,0)),2)&" m")' },
    { key: 'nmin', label: 'Lowest corrected N', formula: 'IF(COUNT(spt.nc)=0,"",MIN(spt.nc))', decimals: 0 },
  ],
  checks: [
    { when: 'COUNT(st.from)=0', level: 'warning', message: 'Enter the strata (from – to depths and soil type) to draw the borehole log.' },
    { when: 'IFERROR(ABS(SUM(st.thick)-(MAX(st.to)-MIN(st.from)))>0.001,FALSE)', level: 'warning', message: 'Strata have gaps or overlaps: check the from / to depths.' },
    { when: 'COUNTIF(spt.p1,">=50")>0', level: 'warning', message: 'Refusal in the seating drive is reported as refusal (">50"), not as an N value.' },
  ],
  charts: [{ grid: 'spt', x: 'n', y: 'depth', yReverse: true, xTop: true, xMin: 0, title: 'SPT N value with depth', xLabel: 'SPT N', yLabel: 'Depth below ground (m)', label: 'N observed', series: [{ x: 'nc', y: 'depth', label: 'N corrected', dashed: true }], report: false }],
  borelog: { strata: { grid: 'st', from: 'from', to: 'to', soil: 'soil', desc: 'desc' }, spt: { grid: 'spt', depth: 'depth', n: 'n', label: 'nl' }, samples: { grid: 'sm', depth: 'depth', type: 'type' }, core: { grid: 'cr', from: 'from', to: 'to', rec: 'crp', rqd: 'rqd' }, waterTable: 'wt', title: 'bh' },
  reportIntro: [
    { title: 'Drilling', text: 'Boreholes were advanced by {boring} ({dia} mm diameter) as per IS 1892. Strata were logged at every change and disturbed / undisturbed samples were collected for laboratory testing. Rock, where met, was cored with a double-tube core barrel and core recovery and RQD were recorded.' },
    { title: 'Standard penetration test', text: 'SPT was conducted as per IS 2131 at regular intervals and at changes of strata. N values are reported as observed and corrected for overburden pressure and, where applicable, dilatancy; 50 blows within any 15 cm drive is reported as refusal.' },
    { title: 'Borehole logs', text: 'Each log shows the strata with the legend pattern, the description, SPT N values plotted with depth, samples collected and, for rock, core recovery (CR) and rock quality designation (RQD). Where more than one borehole is reported, the geotechnical profile of the site is drawn on a common depth scale.' },
  ],
  reportLabel: '"Borehole "&bh',
  reportInfo: [
    { label: 'Borehole', value: 'bh' }, { label: 'Location', value: 'location' }, { label: 'Coordinates', value: 'coords' }, { label: 'Ground level (RL)', value: 'rl', unit: 'm', decimals: 2 },
    { label: 'Type of boring', value: 'boring&IF(dia="",""," – "&dia&" mm dia")' }, { label: 'Depth drilled', value: 'depth', unit: 'm', decimals: 2 }, { label: 'Water table', value: 'wt_txt' }, { label: 'Termination', value: 'termination' },
  ],
  reportRows: [
    { group: 'Borehole', name: 'Depth drilled', unit: 'm', result: 'depth', decimals: 2 },
    { group: 'Borehole', name: 'Water table', unit: '--', result: 'wt_txt' },
    { group: 'Borehole', name: 'SPT refusal', unit: '--', result: 'refusal' },
  ],
  reportTables: [{ title: 'SPT results', grid: 'spt', skipBlank: 'n', columns: [
    { key: 'depth', label: 'Depth (m)', decimals: 2 }, { key: 'p1', label: '0–15 cm', decimals: 0 }, { key: 'p2', label: '15–30 cm', decimals: 0 }, { key: 'p3', label: '30–45 cm', decimals: 0 },
    { key: 'nl', label: 'N observed' }, { key: 'nc', label: 'N corrected', decimals: 0 }] }],
  reportText: [{ title: 'Strata met', text: '{strata}' }, { text: 'The borehole was terminated at {depth:2} m ({termination}). Water table: {wt_txt}.' }],
  references: ['IS 1892 : 2021 – subsurface investigation; IS 2131 – SPT; IS 2132 – undisturbed sampling; IS 1498 – soil classification.', 'Core recovery = recovered length ÷ run length; RQD = total length of pieces ≥ 10 cm ÷ run length.'],
  procedure: [
    'Set up the rig at the marked location, record coordinates and ground level.',
    'Advance the borehole by the chosen method, keeping it stable with casing or drilling mud below the water table.',
    'Record each change of strata (depth, colour, consistency, soil type) and collect disturbed samples at every change and at regular intervals.',
    'Conduct SPT at 1.5 m intervals and at every change of strata; take undisturbed samples in cohesive soil.',
    'In rock, core with a double-tube barrel (NX), measuring recovery and pieces longer than 10 cm for RQD.',
    'Record the water level at the start and end of each day and 24 hours after completion.',
    'Draw the log: strata column with legend, SPT N with depth, samples and core recovery / RQD.',
  ],
  sampleCalc: ['Strata: {strata}', 'Core run {cr.from#1:1}–{cr.to#1:1} m: recovery {cr.rec#1:0} cm of {cr.to#1:1}−{cr.from#1:1} m → {cr.crp#1:0} %; pieces ≥ 10 cm total {cr.p10#1:0} cm → RQD {cr.rqd#1:0} %.'],
  example: {
    input: { header: { bh: 'BH-1', location: 'Compound wall, north side', boring: 'Rotary drilling', gamma: 18 }, grids: {
      st: [{ from: 0, to: 1, soil: 'Filled-up soil', desc: 'brown, loose' }, { from: 1, to: 4, soil: 'Clay (CH)', desc: 'black, stiff' }, { from: 4, to: 10, soil: 'Soft disintegrated rock (SDR)', desc: 'greyish, gravelly' }],
      spt: [{ depth: 1.5, p1: 3, p2: 4, p3: 6 }, { depth: 3, p1: 5, p2: 7, p3: 8 }, { depth: 4.5, p1: 9, p2: 11, p3: 13 }, { depth: 7, p1: 14, p2: 18, p3: 22 }, { depth: 10, p1: 50, pen: 6 }],
      sm: [{ depth: 1.5, type: 'DS (disturbed)', ref: 'S1' }, { depth: 3, type: 'UDS (undisturbed)', ref: 'U1' }],
      cr: [{ from: 8.5, to: 10, rec: 105, p10: 45 }],
    } },
    expect: { depth: 10, 'cr.crp#1': 70, 'cr.rqd#1': 30, refusal: '10.00 m' },
  },
};

// ---------------------------------------------------------------- safe bearing capacity from SPT
export const SBC_SPT: ObservationTemplate = {
  code: 'SBC-SPT', version: 1, material: 'Soil', category: 'Soil field tests',
  name: 'Safe bearing capacity from SPT (cohesionless soil)',
  method: 'IS 6403 : 1981 & IS 8009 (Part 1) : 1976 – Teng / Terzaghi & Peck',
  docControl: doc('04'),
  headerFields: [
    { key: 'bh', label: 'Borehole(s) considered', type: 'text' },
    { key: 'dw', label: 'Water table below ground (0 = assume at ground; blank = not met)', type: 'number', unit: 'm' },
    { key: 'dil', label: 'Dilatancy correction (submerged fine sand / silt)', type: 'select', options: ['No', 'Yes'], default: 'No' },
    { key: 'sf', label: 'Permissible settlement', type: 'number', unit: 'mm', default: 40, help: 'IS 1904: isolated footings on sand up to 50 mm, rafts up to 75 mm' },
    { key: 'usekd', label: 'Include depth factor Kd = 1 + 0.33 Df/B (≤ 1.33)', type: 'select', options: ['No', 'Yes'], default: 'No' },
  ],
  constants: [
    { key: 'k1sq', label: 'Teng square footing – width term', value: 0.1047, note: '2 N² B Rw (psf, ft) ÷ FOS 3 in kN/m², m' },
    { key: 'k2sq', label: 'Teng square footing – depth term', value: 0.3142 },
    { key: 'k1st', label: 'Teng strip footing – width term', value: 0.1571 },
    { key: 'k2st', label: 'Teng strip footing – depth term', value: 0.2618 },
    { key: 'ks', label: 'Terzaghi–Peck settlement coefficient (25 mm)', value: 34.47, unit: 'kN/m²' },
    { key: 'g', label: 'kN per tonne', value: T, locked: true },
  ],
  derived: [],
  grids: [{
    key: 'f', label: 'Footings considered (N = average corrected N within depth B below the base)', rows: 5,
    columns: [
      { key: 'df', label: 'Depth of foundation Df', unit: 'm', input: true },
      { key: 'b', label: 'Width B', unit: 'm', input: true },
      { key: 'shape', label: 'Shape', input: true, options: ['Square / circular', 'Strip'] },
      { key: 'nobs', label: 'N (field)', input: true },
      { key: 'n', label: 'N for design', formula: 'IF(nobs="","",IF(AND(dil="Yes",nobs>15),15+0.5*(nobs-15),nobs))', decimals: 1 },
      { key: 'rw', label: 'Rw (water below base)', formula: 'IF(OR(df="",b=""),"",IF(dw="",1,IF(dw<=df,0.5,IF(dw>=df+b,1,0.5*(1+(dw-df)/b)))))', decimals: 2 },
      { key: 'rd', label: 'Rd (water above base)', formula: 'IF(df="","",IF(dw="",1,IF(dw>=df,1,0.5*(1+dw/df))))', decimals: 2 },
      { key: 'qs', label: 'Net safe pressure – shear (FOS 3)', unit: 'kN/m²', formula: 'IF(OR(n="",b="",df=""),"",IF(shape="Strip",k1st*n^2*b*rw+k2st*(100+n^2)*df*rd,k1sq*n^2*b*rw+k2sq*(100+n^2)*df*rd))', decimals: 1 },
      { key: 'kd', label: 'Kd', formula: 'IF(OR(df="",b=""),"",IF(usekd="Yes",MIN(1.33,1+0.33*df/b),1))', decimals: 2 },
      { key: 'qa', label: 'Allowable pressure – settlement', unit: 'kN/m²', formula: 'IF(OR(n="",b=""),"",MAX(0,ks*(n-3)*((b+0.305)/(2*b))^2*rw*kd*sf/25))', decimals: 1 },
      { key: 'sbc', label: 'Safe bearing capacity', unit: 'kN/m²', formula: 'IF(OR(qs="",qa=""),"",MIN(qs,qa))', decimals: 1 },
      { key: 'sbct', label: 'Safe bearing capacity', unit: 'T/m²', formula: 'IF(sbc="","",sbc/g)', decimals: 2 },
      { key: 'gov', label: 'Governs', formula: 'IF(sbc="","",IF(qs<=qa,"Shear","Settlement"))' },
    ],
  }],
  results: [
    { key: 'sbc', label: 'Safe bearing capacity (first footing)', formula: 'IFERROR(INDEX(f.sbc,1)*1,"")', unit: 'kN/m²', decimals: 1 },
    { key: 'sbct', label: 'Safe bearing capacity (first footing)', formula: 'IFERROR(INDEX(f.sbct,1)*1,"")', unit: 'T/m²', decimals: 2 },
    { key: 'gov', label: 'Governing criterion', formula: 'IFERROR(INDEX(f.gov,1),"")' },
  ],
  checks: [
    { when: 'COUNTIF(f.n,"<=3")>0', level: 'warning', message: 'N of 3 or less: the settlement formula gives no allowable pressure (very loose soil) – consider improvement or deep foundations.' },
    { when: 'COUNTIF(f.nobs,">50")>0', level: 'warning', message: 'N above 50 is outside the range of the Teng / Terzaghi–Peck charts; use 50.' },
  ],
  reportLabel: 'IF(bh="","SBC","SBC – "&bh)',
  reportIntro: [{ title: 'Basis', text: 'The safe bearing capacity of the cohesionless strata is evaluated from the SPT N values as per IS 6403 / IS 8009 using Teng\'s relation for shear failure (factor of safety 3 included) and the Terzaghi & Peck relation for the permissible settlement. The smaller of the two values is recommended.' }],
  reportInfo: [{ label: 'Boreholes considered', value: 'bh' }, { label: 'Water table assumed', value: 'IF(dw="","Not met",IF(dw=0,"At ground level (conservative)",FIXED(dw,2)&" m below ground"))' }, { label: 'Permissible settlement', value: 'sf', unit: 'mm', decimals: 0 }],
  reportRows: [
    { group: 'Safe bearing capacity', name: 'Net safe bearing capacity', unit: 'kN/m²', result: 'sbc', decimals: 1 },
    { group: 'Safe bearing capacity', name: 'Net safe bearing capacity', unit: 'T/m²', result: 'sbct', decimals: 2 },
    { group: 'Safe bearing capacity', name: 'Governing criterion', unit: '--', result: 'gov' },
  ],
  reportTables: [{ title: 'Safe bearing capacity recommendations', grid: 'f', skipBlank: 'sbc', columns: [
    { key: 'df', label: 'Df (m)', decimals: 2 }, { key: 'b', label: 'B (m)', decimals: 2 }, { key: 'shape', label: 'Shape' }, { key: 'n', label: 'N', decimals: 0 },
    { key: 'qs', label: 'Shear (kN/m²)', decimals: 0 }, { key: 'qa', label: 'Settlement (kN/m²)', decimals: 0 }, { key: 'sbc', label: 'SBC (kN/m²)', decimals: 0 }, { key: 'sbct', label: 'SBC (T/m²)', decimals: 1 }] }],
  reportText: [
    { title: 'Method', text: 'Shear criterion (Teng, factor of safety 3 included): square footing qs = 0.105 N² B Rw + 0.314 (100 + N²) Df Rd; strip footing qs = 0.157 N² B Rw + 0.262 (100 + N²) Df Rd (kN/m², B and Df in m). Settlement criterion (Terzaghi & Peck): qa = 34.5 (N − 3) [(B + 0.3)/2B]² Rw × S/25 for a permissible settlement S of {sf:0} mm. The smaller value is the safe bearing capacity.' },
    { text: 'For the first footing (Df = {f.df#1:2} m, B = {f.b#1:2} m, N = {f.n#1:0}): shear {f.qs#1:1} kN/m², settlement {f.qa#1:1} kN/m² → safe bearing capacity {sbc:1} kN/m² ({sbct:2} T/m²), governed by {gov}.' },
  ],
  references: ['IS 6403 : 1981 – bearing capacity of shallow foundations; IS 8009 (Part 1) – settlement; IS 1904 – permissible settlements.', 'Teng (1962) and Terzaghi & Peck (1967) SPT relations, SI form. Rw and Rd are water-table factors (0.5 when the water table is at or above the level considered, 1 when it is deeper than B below the base).'],
  procedure: [
    'From the borehole logs take the corrected N values within a depth B below the proposed foundation level and average them.',
    'Apply the dilatancy correction only for fine sand or silt below the water table with N above 15.',
    'Choose the water table depth (0 if it may rise to ground level) to get Rw and Rd.',
    'Compute the net safe pressure for shear (Teng, FOS 3 included) and the allowable pressure for the permissible settlement (Terzaghi & Peck).',
    'Report the smaller value for each footing size and depth considered.',
  ],
  sampleCalc: [
    'Field N = {f.nobs#1:0}; dilatancy correction 15 + 0.5 ({f.nobs#1:0} − 15) = {f.n#1:0}. Water table at ground: Rw = {f.rw#1:2}, Rd = {f.rd#1:2}.',
    'Shear: 0.1047 × {f.n#1:0}² × {f.b#1:1} × {f.rw#1:2} + 0.3142 × (100 + {f.n#1:0}²) × {f.df#1:1} × {f.rd#1:2} = {f.qs#1:1} kN/m² (FOS 3 already included – do not divide again).',
    'Settlement ({sf:0} mm): 34.47 × ({f.n#1:0} − 3) × [({f.b#1:1} + 0.305)/(2 × {f.b#1:1})]² × {f.rw#1:2} × {sf:0}/25 = {f.qa#1:1} kN/m².',
    'Safe bearing capacity = smaller value = {sbc:1} kN/m² = {sbct:2} T/m² ({gov} governs).',
  ],
  example: { input: { header: { dw: 0, dil: 'Yes', sf: 40 }, grids: { f: [{ df: 2, b: 3, shape: 'Square / circular', nobs: 31 }] } }, expect: { 'f.n#1': 23, 'f.qs#1': 280.7, 'f.qa#1': 167.4, sbc: 167.4, gov: 'Settlement' } },
};

// ---------------------------------------------------------------- safe bearing capacity from shear parameters
export const SBC_SHEAR: ObservationTemplate = {
  code: 'SBC-IS6403', version: 1, material: 'Soil', category: 'Soil field tests',
  name: 'Safe bearing capacity from shear parameters',
  method: 'IS 6403 : 1981 (RA 2021)',
  docControl: doc('05'),
  headerFields: [
    { key: 'shape', label: 'Footing shape', type: 'select', options: ['Strip', 'Square', 'Circular', 'Rectangular'], default: 'Square' },
    { key: 'b', label: 'Width B', type: 'number', unit: 'm', required: true },
    { key: 'l', label: 'Length L (rectangular)', type: 'number', unit: 'm' },
    { key: 'df', label: 'Depth of foundation Df', type: 'number', unit: 'm', required: true },
    { key: 'c', label: 'Cohesion c', type: 'number', unit: 'kN/m²', default: 0 },
    { key: 'phi', label: 'Angle of shearing resistance φ', type: 'number', unit: 'degree', default: 0 },
    { key: 'gamma', label: 'Unit weight γ', type: 'number', unit: 'kN/m³', default: 18 },
    { key: 'failure', label: 'Mode of failure', type: 'select', options: ['General shear (dense / stiff)', 'Local shear (loose / soft)'], default: 'General shear (dense / stiff)' },
    { key: 'dw', label: 'Water table below ground (blank = deep)', type: 'number', unit: 'm' },
    { key: 'src', label: 'Source of c and φ', type: 'text', help: 'e.g. UCS / direct shear on UDS from BH-1 at 3.0 m' },
  ],
  constants: [{ key: 'fos', label: 'Factor of safety', value: 2.5, note: 'IS 6403: 2.5 to 3' }, { key: 'gw', label: 'Unit weight of water', value: 9.81, unit: 'kN/m³' }, { key: 'g', label: 'kN per tonne', value: T, locked: true }],
  derived: [
    { key: 'loc', label: 'Local shear', formula: 'LEFT(failure,1)="L"' },
    { key: 'ph', label: 'φ used', formula: 'IF(loc,DEGREES(ATAN(2/3*TAN(RADIANS(phi)))),phi)', unit: 'degree', decimals: 2 },
    { key: 'cu', label: 'c used', formula: 'IF(loc,2/3*c,c)', unit: 'kN/m²', decimals: 2 },
    { key: 'r', label: 'φ in radians', formula: 'RADIANS(ph)', decimals: 4 },
    { key: 'nq', label: 'Nq', formula: 'EXP(PI()*TAN(r))*TAN(RADIANS(45+ph/2))^2', decimals: 2 },
    { key: 'nc', label: 'Nc', formula: 'IF(ph=0,5.14,(nq-1)/TAN(r))', decimals: 2 },
    { key: 'ng', label: 'Nγ', formula: '2*(nq+1)*TAN(r)', decimals: 2 },
    { key: 'bl', label: 'B / L', formula: 'IF(shape="Rectangular",IF(l="",1,b/l),IF(shape="Strip",0,1))', decimals: 2 },
    { key: 'sc', label: 'sc', formula: 'IF(shape="Strip",1,IF(shape="Rectangular",1+0.2*bl,1.3))', decimals: 2 },
    { key: 'sq', label: 'sq', formula: 'IF(shape="Strip",1,IF(shape="Rectangular",1+0.2*bl,1.2))', decimals: 2 },
    { key: 'sg', label: 'sγ', formula: 'IF(shape="Strip",1,IF(shape="Rectangular",1-0.4*bl,IF(shape="Circular",0.6,0.8)))', decimals: 2 },
    { key: 'nphi', label: 'Nφ = tan²(45 + φ/2)', formula: 'TAN(RADIANS(45+ph/2))^2', decimals: 3 },
    { key: 'dc', label: 'dc', formula: '1+0.2*df/b*SQRT(nphi)', decimals: 3 },
    { key: 'dq', label: 'dq = dγ', formula: 'IF(ph<10,1,1+0.1*df/b*SQRT(nphi))', decimals: 3 },
    { key: 'wf', label: "W' (water table factor)", formula: 'IF(dw="",1,IF(dw<=df,0.5,IF(dw>=df+b,1,0.5*(1+(dw-df)/b))))', decimals: 2 },
    { key: 'q', label: 'Effective overburden at base q', formula: 'IF(dw="",gamma*df,gamma*MIN(df,dw)+(gamma-gw)*MAX(0,df-dw))', unit: 'kN/m²', decimals: 2 },
  ],
  grids: [],
  results: [
    { key: 't1', label: 'Cohesion term', formula: 'cu*nc*sc*dc', unit: 'kN/m²', decimals: 1 },
    { key: 't2', label: 'Surcharge term', formula: 'q*(nq-1)*sq*dq', unit: 'kN/m²', decimals: 1 },
    { key: 't3', label: 'Self-weight term', formula: '0.5*b*IF(dw="",gamma,IF(dw<=df,gamma-gw,gamma))*ng*sg*dq*wf', unit: 'kN/m²', decimals: 1 },
    { key: 'qnu', label: 'Net ultimate bearing capacity', formula: 't1+t2+t3', unit: 'kN/m²', decimals: 1 },
    { key: 'qns', label: 'Net safe bearing capacity', formula: 'qnu/fos', unit: 'kN/m²', decimals: 1 },
    { key: 'qnst', label: 'Net safe bearing capacity', formula: 'qns/g', unit: 'T/m²', decimals: 2 },
  ],
  checks: [{ when: 'AND(shape="Rectangular",l="")', level: 'warning', message: 'Enter the length L for a rectangular footing.' }, { when: 'AND(c=0,phi=0)', level: 'error', message: 'Enter c and/or φ.' }],
  reportLabel: '"SBC – "&shape&" "&FIXED(b,2)&" m at "&FIXED(df,2)&" m"',
  reportInfo: [{ label: 'Footing', value: 'shape&" "&FIXED(b,2)&" m"&IF(shape="Rectangular"," × "&FIXED(l,2)&" m","")' }, { label: 'Depth of foundation', value: 'df', unit: 'm', decimals: 2 },
    { label: 'Shear parameters', value: '"c = "&FIXED(c,1)&" kN/m², φ = "&FIXED(phi,1)&"°"' }, { label: 'Source', value: 'src' }, { label: 'Mode of failure', value: 'failure' }],
  reportRows: [
    { group: 'Safe bearing capacity', name: 'Net ultimate bearing capacity', unit: 'kN/m²', result: 'qnu', decimals: 1 },
    { group: 'Safe bearing capacity', name: 'Net safe bearing capacity', unit: 'kN/m²', result: 'qns', decimals: 1, specFormula: '"FOS "&FIXED(fos,1)' },
    { group: 'Safe bearing capacity', name: 'Net safe bearing capacity', unit: 'T/m²', result: 'qnst', decimals: 2 },
  ],
  reportText: [{ title: 'Calculation (IS 6403)', text: 'qnu = c Nc sc dc + q (Nq − 1) sq dq + ½ B γ Nγ sγ dγ W′. With φ = {ph:1}°: Nc = {nc:2}, Nq = {nq:2}, Nγ = {ng:2}; sc = {sc:2}, sq = {sq:2}, sγ = {sg:2}; dc = {dc:3}, dq = dγ = {dq:3}; W′ = {wf:2}; q = {q:1} kN/m². Terms: {t1:1} + {t2:1} + {t3:1} = {qnu:1} kN/m². Net safe = {qnu:1} ÷ {fos:1} = {qns:1} kN/m² ({qnst:2} T/m²).' }],
  references: ['IS 6403 : 1981 – Nq = e^(π tanφ) tan²(45 + φ/2), Nc = (Nq − 1) cot φ (5.14 for φ = 0), Nγ = 2 (Nq + 1) tan φ; shape factors Table 2; depth factors cl. 5.1.2; local shear with tan φ′ = ⅔ tan φ and c′ = ⅔ c.'],
  procedure: ['Obtain c and φ from laboratory tests (direct shear, triaxial or UCS) on samples from the foundation level.', 'Choose general shear for dense / stiff soils and local shear for loose / soft soils.', 'Enter the footing size, depth and water table, then read the net safe bearing capacity. Check settlement separately for important structures.'],
  sampleCalc: ['φ = {ph:0}°: Nq = e^(π tan30°) tan²(60°) = {nq:2}; Nγ = 2 ({nq:2} + 1) tan30° = {ng:2}.', 'Square footing 2.0 m at 1.5 m: q = 18 × 1.5 = {q:1} kN/m²; dq = 1 + 0.1 × 1.5/2 × √{nphi:2} = {dq:3}.',
    'qnu = 0 + {t2:1} + {t3:1} = {qnu:1} kN/m² → net safe = {qnu:1} ÷ 2.5 = {qns:1} kN/m².'],
  example: { input: { header: { shape: 'Square', b: 2, df: 1.5, c: 0, phi: 30, gamma: 18 }, grids: {} }, expect: { nq: 18.4, ng: 22.4, nc: 30.14, qns: 400.6 } },
};

// ---------------------------------------------------------------- pile load tests (pull-out and lateral)
function pileTest(kind: 'uplift' | 'lateral'): ObservationTemplate {
  const up = kind === 'uplift';
  return {
    code: up ? 'PILE-UPLIFT' : 'PILE-LATERAL', version: 1, material: 'Pile / pier', category: 'Soil field tests',
    name: up ? 'Pull-out (uplift) load test on pile' : 'Lateral load test on pile',
    method: 'IS 2911 (Part 4) : 2013 (RA 2018)',
    docControl: doc(up ? '06' : '07'),
    equipment: [{ key: 'dg', label: 'Dial gauge', category: 'Dial gauge' }],
    headerFields: [
      { key: 'test_no', label: 'Test no.', type: 'text', required: true },
      { key: 'pile', label: 'Pile / pier identification', type: 'text', required: true },
      { key: 'ftype', label: 'Foundation type', type: 'text' },
      { key: 'section', label: 'Section profile', type: 'text', help: 'e.g. HAP rebar, SAP cage, ISMC 100' },
      { key: 'length', label: 'Total length of pile', type: 'number', unit: 'm' },
      { key: 'embed', label: 'Depth of embedment', type: 'number', unit: 'm' },
      ...(up ? [] : [{ key: 'hload', label: 'Height of load application above ground', type: 'number' as const, unit: 'm' }]),
      { key: 'hmeas', label: 'Height of displacement measurement above ground', type: 'number', unit: 'm', default: 0.1 },
      { key: 'target', label: 'Target test load', type: 'number', unit: 'kN' },
      { key: 'perm', label: 'Maximum permissible displacement', type: 'number', unit: 'mm' },
      { key: 'basis', label: 'Displacement taken as', type: 'select', options: ['Average of dial gauges (IS 2911-4)', 'Maximum of dial gauges'], default: 'Average of dial gauges (IS 2911-4)' },
      { key: 'reaction', label: 'Reaction system', type: 'text' },
      { key: 'coord_n', label: 'Coordinate N', type: 'text' }, { key: 'coord_e', label: 'Coordinate E', type: 'text' },
      { key: 'remarks', label: 'Observation at the end of the test', type: 'text', help: up ? 'e.g. JCB could not apply more load' : 'e.g. section bent and concrete cracked at 40.1 kN' },
    ],
    constants: [{ key: 'lc', label: 'Dial gauge least count', unit: 'mm/div', fromEquipment: 'dg.lc', value: 0.01 }, { key: 'dlim', label: 'IS 2911 reference displacement', unit: 'mm', value: 12 }, ...(up ? [] : [{ key: 'd5', label: 'IS 2911 lateral displacement limit', unit: 'mm', value: 5 }])],
    derived: [],
    grids: [{
      key: 'ld', label: 'Load steps (first row = zero load initial readings; unloading rows are allowed)', rows: 14, fixedRows: [{ tload: 0 }, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}],
      columns: [
        { key: 'tload', label: 'Target load', unit: 'kN', input: true },
        { key: 'aload', label: 'Actual load', unit: 'kN', input: true },
        { key: 'hold', label: 'Hold time', unit: 'min', input: true },
        { key: 'dg1', label: 'Dial gauge 1', unit: 'div', input: true },
        { key: 'dg2', label: 'Dial gauge 2', unit: 'div', input: true },
        { key: 'note', label: 'Note', input: true, text: true },
        { key: 'load', label: 'Load', unit: 'kN', formula: 'IF(aload<>"",aload,tload)', decimals: 2 },
        { key: 'd1', label: 'Displacement DG 1', unit: 'mm', formula: 'IF(dg1="","",ABS(dg1-INDEX(ld.dg1,1))*lc)', decimals: 2 },
        { key: 'd2', label: 'Displacement DG 2', unit: 'mm', formula: 'IF(dg2="","",ABS(dg2-INDEX(ld.dg2,1))*lc)', decimals: 2 },
        { key: 'd', label: 'Net displacement', unit: 'mm', formula: 'IF(COUNT(d1,d2)=0,"",IF(LEFT(basis,1)="M",MAX(d1,d2),AVERAGE(d1,d2)))', decimals: 2 },
        { key: 'prev', label: 'Highest earlier load', formula: 'IF(ROW()=1,0,MAXTO(ld.load,ROW()-1))', decimals: 2, hidden: true },
        { key: 'envd', label: 'Virgin curve displacement', formula: 'IF(OR(d="",load=""),"",IF(OR(ROW()=1,load>prev),d,""))', decimals: 2, hidden: true },
        { key: 'envl', label: 'Virgin curve load', formula: 'IF(envd="","",load)', decimals: 2, hidden: true },
        { key: 'zrow', label: 'Zero-load row', formula: 'IF(AND(ROW()>1,load=0,d<>""),ROW(),"")', decimals: 0, hidden: true },
      ],
    }],
    results: [
      { key: 'lmax', label: 'Maximum load applied', formula: 'IF(COUNT(ld.d)=0,"",MAX(ld.envl))', unit: 'kN', decimals: 2 },
      { key: 'dmax', label: 'Displacement at maximum load', formula: 'IF(lmax="","",INDEX(ld.envd,MATCH(lmax,ld.envl,0)))', unit: 'mm', decimals: 2 },
      { key: 'dtarget', label: 'Displacement at target load', formula: 'IF(OR(target="",lmax=""),"",IF(target>lmax,"",INTERP(target,ld.envl,ld.envd)))', unit: 'mm', decimals: 2 },
      { key: 'resid', label: 'Residual displacement (last zero-load reading)', formula: 'IFERROR(INDEX(ld.d,MAX(ld.zrow))*1,"")', unit: 'mm', decimals: 2 },
      { key: 'verdict', label: 'Result against permissible displacement', formula: 'IF(OR(perm="",dmax=""),"",IF(AND(dtarget<>"",dtarget<=perm),"Satisfactory – "&FIXED(dtarget,2)&" mm at target load",IF(AND(target<>"",target>lmax),IF(dmax<=perm,"Target load not reached; "&FIXED(dmax,2)&" mm at "&FIXED(lmax,1)&" kN","Not satisfactory"),IF(dmax<=perm,"Satisfactory","Not satisfactory"))))' },
      { key: 'l12', label: 'Load at reference displacement', formula: 'IF(OR(dmax="",MAX(ld.envd)<dlim),"",INTERP(dlim,ld.envd,ld.envl))', unit: 'kN', decimals: 1 },
      ...(up
        ? [{ key: 'safe', label: 'Safe uplift load (IS 2911-4: ⅔ of load at 12 mm)', formula: 'IF(l12="","",2/3*l12)', unit: 'kN', decimals: 1 }]
        : [
          { key: 'l5', label: 'Load at 5 mm displacement', formula: 'IF(OR(dmax="",MAX(ld.envd)<d5),"",INTERP(d5,ld.envd,ld.envl))', unit: 'kN', decimals: 1 },
          { key: 'safe', label: 'Safe lateral load (IS 2911-4: least of ½ load at 12 mm and load at 5 mm)', formula: 'IF(AND(l12="",l5=""),"",IF(l12="",l5,IF(l5="",0.5*l12,MIN(0.5*l12,l5))))', unit: 'kN', decimals: 1 },
        ]),
      { key: 'safe_txt', label: 'IS 2911 safe load', formula: up ? 'IF(safe="","Not reached – displacement stayed below "&FIXED(dlim,0)&" mm",FIXED(safe,1)&" kN")' : 'IF(safe="","Not reached – displacement stayed below "&FIXED(d5,0)&" mm",FIXED(safe,1)&" kN")' },
    ],
    checks: [
      { when: 'AND(perm<>"",dmax<>"",dmax>perm)', level: 'warning', message: 'Displacement exceeded the permissible value.' },
      { when: 'AND(target<>"",lmax<>"",lmax<target)', level: 'warning', message: 'The target test load was not reached: record the reason in the remarks.' },
    ],
    chart: { grid: 'ld', x: 'load', y: 'd', title: 'Load – displacement curve', xLabel: 'Load (kN)', label: 'Net displacement', yLabel: up ? 'Uplift displacement (mm)' : 'Lateral deflection (mm)', series: [{ y: 'd1', label: 'Dial gauge 1', dashed: true }, { y: 'd2', label: 'Dial gauge 2', dashed: true }],
      note: 'Net displacement ({basis}) against load, including unloading cycles. Maximum load {lmax:1} kN gave {dmax:2} mm; permissible {perm:1} mm.' },
    reportLabel: '"Test "&test_no&" – "&pile',
    reportIntro: [
      { title: 'Scope', text: up ? 'To determine the pull-out (uplift) capacity and load–displacement behaviour of the pile / pier as per IS 2911 (Part 4) : 2013.' : 'To determine the lateral load capacity and load–deflection behaviour of the pile / pier as per IS 2911 (Part 4) : 2013.' },
      { title: 'Procedure', text: up ? 'The uplift load was applied concentrically through a jack against the reaction ({reaction}) in increments, each held for the specified time, with unloading cycles as specified. Displacement was measured with two dial gauges (least count 0.01 mm) mounted on an independent datum at the specified height above ground.' : 'The lateral load was applied with a jack at the specified height above ground, in the direction of the design load, in increments held for the specified time with unloading cycles. Deflection was measured with two dial gauges (least count 0.01 mm) on an independent datum at the specified height.' },
    ],
    reportInfo: [
      { label: 'Test no.', value: 'test_no' }, { label: 'Pile / pier', value: 'pile' }, { label: 'Foundation type', value: 'ftype' }, { label: 'Section profile', value: 'section' },
      { label: 'Depth of embedment', value: 'embed', unit: 'm', decimals: 3 }, ...(up ? [] : [{ label: 'Load application height', value: 'hload', unit: 'm', decimals: 3 }]),
      { label: 'Displacement measured at', value: 'IF(hmeas="","--",FIXED(hmeas*100,0)&" cm above ground")' }, { label: 'Target test load', value: 'target', unit: 'kN', decimals: 1 },
      { label: 'Maximum permissible displacement', value: 'perm', unit: 'mm', decimals: 1 }, { label: 'Coordinates', value: 'IF(AND(coord_n="",coord_e=""),"--","N "&coord_n&", E "&coord_e)' },
    ],
    reportRows: [
      { group: up ? 'Pull-out test' : 'Lateral load test', name: 'Maximum load applied', unit: 'kN', result: 'lmax', decimals: 2 },
      { group: up ? 'Pull-out test' : 'Lateral load test', name: 'Displacement at maximum load', unit: 'mm', result: 'dmax', decimals: 2, specFormula: 'IF(perm="","--","Max "&FIXED(perm,1))' },
      { group: up ? 'Pull-out test' : 'Lateral load test', name: 'Residual displacement', unit: 'mm', result: 'resid', decimals: 2 },
      { group: up ? 'Pull-out test' : 'Lateral load test', name: 'Result', unit: '--', result: 'verdict' },
      { group: up ? 'Pull-out test' : 'Lateral load test', name: 'Safe load (IS 2911-4)', unit: '--', result: 'safe_txt' },
    ],
    reportTables: [{ title: up ? 'Pull-out test observations' : 'Lateral load test observations', grid: 'ld', skipBlank: 'd', columns: [
      { key: 'tload', label: 'Target load (kN)', decimals: 1 }, { key: 'aload', label: 'Actual load (kN)', decimals: 2 }, { key: 'hold', label: 'Hold (min)', decimals: 0 },
      { key: 'dg1', label: 'DG 1 (div)', decimals: 0 }, { key: 'dg2', label: 'DG 2 (div)', decimals: 0 }, { key: 'd', label: 'Net displacement (mm)', decimals: 2 }] }],
    reportText: [
      { title: 'Interpretation', text: `The ${up ? 'pull-out' : 'lateral'} load was applied in increments up to {lmax:1} kN. The net displacement (${'{basis}'}) at the maximum load was {dmax:2} mm. Result: {verdict}.` },
      { text: 'On unloading to zero after the last cycle the residual displacement was {resid:2} mm.', when: 'resid<>""' },
      { text: up ? 'IS 2911 (Part 4) safe uplift load is two-thirds of the load at which the total displacement reaches 12 mm: {safe_txt}.' : 'IS 2911 (Part 4) safe lateral load is the least of half the load at 12 mm displacement and the load at 5 mm displacement: {safe_txt}.' },
      { title: 'Remarks', text: '{remarks}', when: 'remarks<>""' },
    ],
    references: [
      'IS 2911 (Part 4) : 2013 – load test on piles. Displacement is the average of the dial gauges unless the project specification asks for the maximum (choose in the header).',
      up ? 'Safe uplift load: two-thirds of the final load at which the total displacement is 12 mm (or the load at a clear break in the curve).' : 'Safe lateral load: least of 50% of the final load at which total displacement is 12 mm and the final load at which total displacement is 5 mm.',
    ],
    procedure: up ? [
      'Fix the pulling arrangement (jack and reaction frame or vehicle) concentric with the pile and clamp the pile head securely.',
      'Mount two dial gauges diametrically opposite on an independent datum bar, measuring at the specified height above ground. Record zero-load readings (first row).',
      'Apply the uplift load in increments (about 20% of the target), holding each until movement stops (or for the specified hold time).',
      'Unload to zero at the specified stages to record recovery, then reload and continue.',
      'Stop at the target load, at failure, or when the reaction cannot apply more load; record the reason.',
    ] : [
      'Apply the lateral load with a jack against a reaction at the specified height above ground, in line with the design load direction.',
      'Mount two dial gauges on an independent datum at the specified height and record zero-load readings (first row).',
      'Apply load in increments, holding each for the specified time, and unload to zero at the specified stages to record recovery.',
      'Continue to the target load or until failure (bending of the section, cracking) and record the observation.',
    ],
    sampleCalc: up ? [
      'At {ld.load#13:1} kN: DG 1 {ld.dg1#1:0} → {ld.dg1#13:0} = {ld.d1#13:2} mm, DG 2 {ld.dg2#1:0} → {ld.dg2#13:0} = {ld.d2#13:2} mm → average {ld.d#13:2} mm (the old sheet used the larger value, {ld.d2#13:2} mm).',
      'Maximum displacement {dmax:2} mm < permissible {perm:1} mm → {verdict}. 12 mm was not reached, so the IS safe load cannot be derived: {safe_txt}.',
    ] : [
      'At {ld.load#18:2} kN: DG 1 moved {ld.d1#18:2} mm and DG 2 {ld.d2#18:2} mm → average {ld.d#18:2} mm.',
      'Load at 12 mm by interpolation = {l12:1} kN → half = ½ × {l12:1}; load at 5 mm = {l5:1} kN. Safe lateral load = {safe_txt}.',
    ],
    example: up
      ? { input: { header: { test_no: '02', pile: 'P29', ftype: 'T', section: 'HAP rebar', embed: 1.83, hmeas: 0.1, perm: 19, remarks: 'At 36.0 kN the reaction (JCB) could not apply more load.' }, grids: { ld: [
        { tload: 0, hold: 1, dg1: 2140, dg2: 2250 }, { tload: 0.5, hold: 1, dg1: 2138, dg2: 2249 }, { tload: 1, hold: 1, dg1: 2137, dg2: 2248 }, { tload: 1.5, hold: 1, dg1: 2137, dg2: 2248 }, { tload: 2, hold: 1, dg1: 2137, dg2: 2247 },
        { tload: 4, hold: 1, dg1: 2136, dg2: 2245 }, { tload: 6, hold: 1, dg1: 2136, dg2: 2245 }, { tload: 8, hold: 1, dg1: 2135, dg2: 2243 }, { tload: 10, hold: 1, dg1: 2134, dg2: 2242 },
        { tload: 15, aload: 15.1, hold: 1, dg1: 2132, dg2: 2239 }, { tload: 20, hold: 1, dg1: 2130, dg2: 2236 }, { tload: 25, hold: 1, dg1: 2127, dg2: 2232 }, { aload: 36, hold: 1, dg1: 2112, dg2: 2214 }, {},
      ] } }, expect: { lmax: 36, dmax: 0.32, verdict: 'Satisfactory', safe_txt: 'Not reached – displacement stayed below 12 mm' } }
      : { input: { header: { test_no: '2', pile: 'P18', ftype: 'L', section: 'SAP cage', embed: 1.524, hload: 0.76, hmeas: 0.1, perm: 25.4, remarks: 'At 40.10 kN the steel section bent and the concrete cracked.' }, grids: { ld: [
        { tload: 0, hold: 1, dg1: 2069, dg2: 210 }, { tload: 1.5, hold: 1, dg1: 2065, dg2: 212 }, { tload: 3, hold: 1, dg1: 2058, dg2: 217 }, { tload: 4.5, hold: 1, dg1: 2050, dg2: 223 }, { tload: 0, hold: 1, dg1: 2068, dg2: 206 },
        { tload: 4.5, hold: 1, dg1: 2058, dg2: 222 }, { tload: 6, hold: 1, dg1: 2041, dg2: 230 }, { tload: 7.5, hold: 1, dg1: 2032, dg2: 239 }, { tload: 0, hold: 1, dg1: 2068, dg2: 207 }, { tload: 10.5, hold: 1, dg1: 2017, dg2: 250 },
        { tload: 12.5, hold: 1, dg1: 2006, dg2: 261 }, { tload: 15, aload: 15.1, hold: 1, dg1: 1956, dg2: 312 }, { tload: 0, hold: 1, dg1: 2050, dg2: 220 }, { tload: 15, aload: 15.1, hold: 1, dg1: 1948, dg2: 317 },
        { tload: 17, hold: 1, dg1: 1918, dg2: 342 }, { tload: 19, aload: 19.1, hold: 1, dg1: 1895, dg2: 368 }, { tload: 0, hold: 1, dg1: 2032, dg2: 230 }, { aload: 40.1, hold: 1, dg1: 809, dg2: 1420 },
      ] } }, expect: { lmax: 40.1, dmax: 12.35, l12: 39.41, l5: 25.66, safe: 19.7 } },
  };
}
export const PILE_UPLIFT = pileTest('uplift');
export const PILE_LATERAL = pileTest('lateral');

export const SOIL_FIELD_TEMPLATES: ObservationTemplate[] = [PLATE_LOAD, SPT, BOREHOLE, SBC_SPT, SBC_SHEAR, PILE_UPLIFT, PILE_LATERAL];
