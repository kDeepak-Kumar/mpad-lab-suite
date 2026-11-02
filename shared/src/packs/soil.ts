import type { ObservationTemplate, GridColumn } from '../observation';
import { CBR_LAB } from './civil-lab-v1';

/** Soil: IS 2720 test methods, classification as per IS 1498 : 1970. */

const doc = (n: string) => ({ docNo: `OBS/SL/${n}`, issueNo: '01', issueDate: '', amendmentNo: '0' });
/** Container masses → water content (%), as on every IS 2720 sheet. */
const moisture = (lbl = ''): GridColumn[] => [
  { key: 'c1', label: `${lbl}Container (W1)`, unit: 'g', input: true },
  { key: 'c2', label: 'Container + wet soil (W2)', unit: 'g', input: true },
  { key: 'c3', label: 'Container + dry soil (W3)', unit: 'g', input: true },
  { key: 'w', label: 'Water content', unit: '%', formula: 'IF(OR(c1="",c2="",c3=""),"",(c2-c3)/(c3-c1)*100)', decimals: 2 },
];

export const SOIL_MC: ObservationTemplate = {
  code: 'SOIL-MC', version: 1, material: 'Soil', category: 'Soil',
  name: 'Water content of soil (oven drying)',
  method: 'IS 2720 (Part 2) : 1973 (RA 2020)',
  docControl: doc('01'),
  headerFields: [], constants: [], derived: [],
  grids: [{ key: 't', label: 'Containers', rows: 3, columns: moisture() }],
  results: [{ key: 'w', label: 'Water content (mean)', formula: 'IF(COUNT(t.w)=0,"",AVERAGE(t.w))', unit: '%', decimals: 2 }],
  checks: [],
  reportRows: [{ name: 'Natural moisture content', unit: '%', result: 'w', decimals: 2, spec: '--' }],
  references: ['IS 2720 (Part 2) : 1973 – oven drying at 105–110 °C to constant mass.'],
  procedure: ['Weigh a clean, dry container with lid (W1).', 'Place a representative specimen (about 25 g for fine soil, more for coarse) in it and weigh (W2).', 'Dry in the oven at 105–110 °C for 24 hours (to constant mass), cool in a desiccator and weigh (W3).', 'Water content w = (W2 − W3) ÷ (W3 − W1) × 100.'],
  sampleCalc: ['w = ({t.c2#1:2} − {t.c3#1:2}) ÷ ({t.c3#1:2} − {t.c1#1:2}) × 100 = {t.w#1:2} %.'],
  example: { input: { header: {}, grids: { t: [{ c1: 25.2, c2: 85.6, c3: 76.4 }] } }, expect: { 't.w#1': 17.97 } },
};

export const SOIL_SG: ObservationTemplate = {
  code: 'SOIL-SG', version: 1, material: 'Soil', category: 'Soil',
  name: 'Specific gravity of soil (density bottle)',
  method: 'IS 2720 (Part 3/Sec 1) : 1980 (RA 2021)',
  docControl: doc('02'),
  headerFields: [{ key: 'temp', label: 'Test temperature', type: 'number', unit: '°C', default: 27 }],
  constants: [], derived: [],
  grids: [{ key: 't', label: 'Density bottle trials', rows: 2, columns: [
    { key: 'w1', label: 'Bottle (W1)', unit: 'g', input: true },
    { key: 'w2', label: 'Bottle + dry soil (W2)', unit: 'g', input: true },
    { key: 'w3', label: 'Bottle + soil + water (W3)', unit: 'g', input: true },
    { key: 'w4', label: 'Bottle + water (W4)', unit: 'g', input: true },
    { key: 'g', label: 'Specific gravity', formula: 'IF(OR(w1="",w2="",w3="",w4=""),"",(w2-w1)/((w4-w1)-(w3-w2)))', decimals: 3 },
  ] }],
  results: [{ key: 'g', label: 'Specific gravity (mean)', formula: 'IF(COUNT(t.g)=0,"",AVERAGE(t.g))', decimals: 2 }],
  checks: [{ when: 'AND(COUNT(t.g)=2,ABS(INDEX(t.g,1)-INDEX(t.g,2))>0.03)', level: 'warning', message: 'The two results differ by more than 0.03: repeat the test.' }],
  reportRows: [{ name: 'Specific gravity', unit: '--', result: 'g', decimals: 2, spec: '--' }],
  references: ['IS 2720 (Part 3/Sec 1) : 1980 – fine-grained soils (density bottle). Report at 27 °C.'],
  procedure: ['Dry the density bottle and stopper and weigh (W1).', 'Add 5–10 g of oven-dried soil passing 2 mm and weigh (W2).', 'Add de-aired water to cover the soil, remove entrapped air under vacuum, fill the bottle completely, insert the stopper, wipe dry and weigh (W3).', 'Empty and clean the bottle, fill with de-aired water only and weigh (W4).', 'G = (W2 − W1) ÷ [(W4 − W1) − (W3 − W2)]. Mean of two results, which should agree within 0.03.'],
  sampleCalc: ['G = ({t.w2#1:2} − {t.w1#1:2}) ÷ [({t.w4#1:2} − {t.w1#1:2}) − ({t.w3#1:2} − {t.w2#1:2})] = {t.g#1:3}.'],
  example: { input: { header: {}, grids: { t: [{ w1: 34.12, w2: 44.12, w3: 140.36, w4: 134.12 }] } }, expect: { 't.g#1': 2.66 } },
};

export const GRADATION_SOIL_V2: ObservationTemplate = {
  code: 'GRADATION-SOIL', version: 2, material: 'Soil', category: 'Soil',
  name: 'Grain size analysis of soil (sieve)',
  method: 'IS 2720 (Part 4) : 1985 (RA 2020)',
  docControl: doc('03'),
  headerFields: [{ key: 'total', label: 'Total oven-dry mass of sample', type: 'number', unit: 'g', required: true }],
  constants: [], derived: [],
  grids: [{
    key: 'sv', label: 'Sieve analysis (wet sieving on 75 µm, dry sieving of the retained portion)',
    fixedRows: [['100 mm', 100], ['75 mm', 75], ['19 mm', 19], ['4.75 mm', 4.75], ['2.00 mm', 2], ['425 µm', 0.425], ['75 µm', 0.075], ['Pan (passing 75 µm incl. wash)', 0]].map(([s, z]) => ({ sieve: s, size: z })),
    columns: [
      { key: 'sieve', label: 'IS sieve' },
      { key: 'size', label: 'Size', unit: 'mm' },
      { key: 'ret', label: 'Mass retained', unit: 'g', input: true },
      { key: 'cum', label: 'Cumulative retained', unit: 'g', formula: 'IF(ret="","",SUMTO(sv.ret,ROW()))', decimals: 1 },
      { key: 'pass', label: 'Passing', unit: '%', formula: 'IF(OR(cum="",total="",size=0),"",100-cum/total*100)', decimals: 1 },
      { key: 'logd', label: 'log d', formula: 'IF(size>0,LOG10(size),"")', decimals: 3 },
    ],
  }],
  results: [
    { key: 'p475', label: 'Passing 4.75 mm', formula: 'IFERROR(INDEX(sv.pass,4)*1,"")', unit: '%', decimals: 1 },
    { key: 'p2', label: 'Passing 2.00 mm', formula: 'IFERROR(INDEX(sv.pass,5)*1,"")', unit: '%', decimals: 1 },
    { key: 'p425', label: 'Passing 425 µm', formula: 'IFERROR(INDEX(sv.pass,6)*1,"")', unit: '%', decimals: 1 },
    { key: 'fines', label: 'Silt & clay (passing 75 µm)', formula: 'IFERROR(INDEX(sv.pass,7)*1,"")', unit: '%', decimals: 0 },
    { key: 'gravel', label: 'Gravel (> 4.75 mm)', formula: 'IF(p475="","",100-p475)', unit: '%', decimals: 0 },
    { key: 'sand', label: 'Sand (4.75 mm – 75 µm)', formula: 'IF(OR(p475="",fines=""),"",p475-fines)', unit: '%', decimals: 0 },
    { key: 'cs', label: 'Coarse sand (4.75 – 2.0 mm)', formula: 'IF(OR(p475="",p2=""),"",p475-p2)', unit: '%', decimals: 0 },
    { key: 'ms', label: 'Medium sand (2.0 mm – 425 µm)', formula: 'IF(OR(p2="",p425=""),"",p2-p425)', unit: '%', decimals: 0 },
    { key: 'fs', label: 'Fine sand (425 – 75 µm)', formula: 'IF(OR(p425="",fines=""),"",p425-fines)', unit: '%', decimals: 0 },
    { key: 'd10', label: 'D10', formula: 'IFERROR(10^INTERP(10,sv.pass,sv.logd),"")', unit: 'mm', decimals: 3 },
    { key: 'd30', label: 'D30', formula: 'IFERROR(10^INTERP(30,sv.pass,sv.logd),"")', unit: 'mm', decimals: 3 },
    { key: 'd60', label: 'D60', formula: 'IFERROR(10^INTERP(60,sv.pass,sv.logd),"")', unit: 'mm', decimals: 3 },
    { key: 'cu', label: 'Coefficient of uniformity (Cu)', formula: 'IF(OR(d10="",d60=""),"",d60/d10)', decimals: 1 },
    { key: 'cc', label: 'Coefficient of curvature (Cc)', formula: 'IF(OR(d10="",d30="",d60=""),"",d30^2/(d10*d60))', decimals: 2 },
    { key: 'group', label: 'IS 1498 group (coarse-grained)', formula: 'IF(fines="","",IF(fines>50,"Fine-grained soil: classify from Atterberg limits",IF(fines<5,IF(gravel>sand,"G","S")&IF(AND(cu<>"",cc<>"",cu>IF(gravel>sand,4,6),cc>=1,cc<=3),"W","P"),IF(fines>12,IF(gravel>sand,"GM / GC","SM / SC")&" (confirm with Atterberg limits)","Borderline: dual symbol needed"))))' },
  ],
  checks: [{ when: 'AND(total<>"",COUNT(sv.ret)>0,ABS(SUM(sv.ret)-total)>total*0.01)', level: 'warning', message: 'Sum of retained masses (including pan/wash) differs from the total by more than 1%.' }],
  chart: { grid: 'sv', x: 'size', y: 'pass', xLog: true, title: 'Particle size distribution', xLabel: 'Particle size (mm)', yLabel: 'Passing (%)' },
  reportRows: [
    { group: 'Gradation analysis of soil', name: 'Gravel', unit: '%', result: 'gravel', decimals: 0 },
    { group: 'Gradation analysis of soil', name: 'Sand', unit: '%', result: 'sand', decimals: 0 },
    { group: 'Gradation analysis of soil', name: 'Silt & Clay', unit: '%', result: 'fines', decimals: 0 },
  ],
  reportTables: [{ title: 'Sieve analysis of soil', grid: 'sv', skipBlank: 'pass', columns: [{ key: 'sieve', label: 'IS sieve' }, { key: 'ret', label: 'Retained (g)', decimals: 1 }, { key: 'pass', label: 'Passing (%)', decimals: 1 }] }],
  references: ['IS 2720 (Part 4) : 1985 – wet sieving for soils with fines.', 'IS 1498 : 1970 – gravel > 4.75 mm, sand 4.75 mm – 75 µm, silt & clay < 75 µm; well graded: Cu > 4 (gravel) or > 6 (sand) with Cc 1–3.'],
  procedure: [
    'Oven-dry the sample and weigh it (total mass). Separate the portion retained on 4.75 mm and dry-sieve it through 100, 75, 19 and 4.75 mm sieves.',
    'Soak the portion passing 4.75 mm in water (with sodium hexametaphosphate if clayey) and wash it on the 75 µm sieve until the water runs clear.',
    'Oven-dry the material retained on 75 µm and sieve it through 2.0 mm, 425 µm and 75 µm; weigh each fraction.',
    'Mass in the pan = total mass − sum of masses retained (includes the washed fines).',
    'Compute % passing. Gravel = 100 − passing 4.75 mm; sand = passing 4.75 mm − passing 75 µm; silt & clay = passing 75 µm.',
  ],
  sampleCalc: [
    'Total {total:0} g. Passing 4.75 mm = {p475:1} %, passing 75 µm = {fines:1} %.',
    'Gravel = 100 − {p475:1} = {gravel:1} %; sand = {p475:1} − {fines:1} = {sand:1} %; silt & clay = {fines:1} %.',
    'Fines exceed 12 %, so the group is {group}.',
  ],
  example: {
    input: { header: { total: 1000 }, grids: { sv: [{ ret: 0 }, { ret: 0 }, { ret: 85 }, { ret: 160 }, { ret: 120 }, { ret: 210 }, { ret: 255 }, { ret: 170 }] } },
    expect: { gravel: 24.5, sand: 58.5, fines: 17, cs: 12, ms: 21, fs: 25.5, group: 'SM / SC (confirm with Atterberg limits)' },
  },
};

export const ATTERBERG_V2: ObservationTemplate = {
  code: 'ATTERBERG', version: 2, material: 'Soil', category: 'Soil',
  name: 'Liquid limit and plastic limit of soil',
  method: 'IS 2720 (Part 5) : 1985 (RA 2020)',
  docControl: doc('04'),
  equipment: [{ key: 'cas', label: 'Casagrande apparatus', category: 'Casagrande apparatus' }],
  headerFields: [{ key: 'np', label: 'Non-plastic (thread cannot be rolled)', type: 'select', options: ['No', 'Yes'], default: 'No' }],
  constants: [], derived: [],
  grids: [
    { key: 'll', label: 'Liquid limit (Casagrande, 15–35 blows, at least 4 points)', rows: 4, columns: [
      { key: 'n', label: 'Number of blows', input: true },
      ...moisture(),
      { key: 'logn', label: 'log N', formula: 'IF(n="","",LOG10(n))', decimals: 3 },
    ] },
    { key: 'pl', label: 'Plastic limit (thread crumbles at 3 mm)', rows: 3, columns: moisture() },
  ],
  results: [
    { key: 'llv', label: 'Liquid limit (water content at 25 blows)', formula: 'IF(COUNT(ll.w)<2,"",ROUND(FORECAST(LOG10(25),ll.w,ll.logn),0))', unit: '%', decimals: 0 },
    { key: 'plv', label: 'Plastic limit', formula: 'IF(np="Yes","NP",IF(COUNT(pl.w)=0,"",ROUND(AVERAGE(pl.w),0)))', unit: '%', decimals: 0 },
    { key: 'piv', label: 'Plasticity index', formula: 'IF(np="Yes","NP",IF(OR(llv="",plv=""),"",llv-plv))', decimals: 0 },
    { key: 'fi', label: 'Flow index', formula: 'IF(COUNT(ll.w)<2,"",-SLOPE(ll.w,ll.logn))', decimals: 1 },
    { key: 'ti', label: 'Toughness index', formula: 'IF(OR(piv="",piv="NP",fi="",fi=0),"",piv/fi)', decimals: 2 },
    { key: 'aline', label: 'A-line PI at this LL', formula: 'IF(llv="","",0.73*(llv-20))', decimals: 1 },
    { key: 'cls', label: 'IS 1498 classification (fine-grained)', formula: 'IF(llv="","",IF(np="Yes","ML (non-plastic)",IF(AND(piv>=4,piv>=aline),"C","M")&IF(llv<35,"L",IF(llv<=50,"I","H"))))' },
  ],
  checks: [
    { when: 'AND(plv<>"",plv<>"NP",llv<>"",plv>llv)', level: 'error', message: 'Plastic limit is greater than liquid limit: check entries or report the soil as non-plastic.' },
    { when: 'OR(COUNTIF(ll.n,"<15")>0,COUNTIF(ll.n,">35")>0)', level: 'warning', message: 'Blow counts should lie between 15 and 35.' },
  ],
  chart: { grid: 'll', x: 'n', y: 'w', xLog: true, fit: 'line', title: 'Flow curve', xLabel: 'Number of blows (log scale)', yLabel: 'Water content (%)' },
  reportRows: [
    { group: 'Atterberg limits', name: 'Liquid limit', unit: '%', result: 'llv', decimals: 0, spec: '--' },
    { group: 'Atterberg limits', name: 'Plastic limit', unit: '%', result: 'plv', decimals: 0, spec: '--' },
    { group: 'Atterberg limits', name: 'Plasticity index', unit: '%', result: 'piv', decimals: 0, spec: '--' },
    { name: 'Soil classification (IS 1498)', unit: '--', result: 'cls', spec: '--' },
  ],
  references: ['IS 2720 (Part 5) : 1985 – liquid limit by Casagrande (cone method may also be used), plastic limit by thread rolling.', 'IS 1498 : 1970 plasticity chart: A-line PI = 0.73 (LL − 20); L < 35, I 35–50, H > 50.'],
  procedure: [
    'Take about 120 g of air-dried soil passing 425 µm and mix with distilled water to a uniform paste; allow it to stand (24 hours for clays).',
    'Place paste in the Casagrande cup, level it to 10 mm depth and cut a groove with the standard tool.',
    'Turn the crank at 2 revolutions per second and count the blows until the groove closes over 12 mm. Take a moisture sample from the closed groove.',
    'Repeat for at least four water contents giving blows between 15 and 35.',
    'Plot water content against log of blows; the water content at 25 blows on the best-fit straight line is the liquid limit.',
    'Plastic limit: roll a ball of soil (about 8 g) into a thread on glass; the water content at which it crumbles at 3 mm diameter is the plastic limit. Average three determinations.',
    'PI = LL − PL. Classify on the plasticity chart.',
  ],
  sampleCalc: [
    'Trial 1: {ll.n#1:0} blows, w = ({ll.c2#1:2} − {ll.c3#1:2}) ÷ ({ll.c3#1:2} − {ll.c1#1:2}) × 100 = {ll.w#1:2} %. Trials 2–4: {ll.w#2:2}, {ll.w#3:2}, {ll.w#4:2} % at {ll.n#2:0}, {ll.n#3:0}, {ll.n#4:0} blows.',
    'Best-fit line of w against log N gives w = {llv:0} % at 25 blows → LL = {llv:0} %. Flow index = {fi:1}.',
    'Plastic limit = mean of {pl.w#1:2} and {pl.w#2:2} = {plv:0} %. PI = {llv:0} − {plv:0} = {piv:0}.',
    'A-line at LL {llv:0}: 0.73 × ({llv:0} − 20) = {aline:1}; PI {piv:0} is above it and LL is 35–50 → {cls}.',
  ],
  example: {
    input: { header: {}, grids: {
      ll: [{ n: 34, c1: 15.2, c2: 42.8, c3: 35.1 }, { n: 27, c1: 15.1, c2: 44.6, c3: 36.3 }, { n: 21, c1: 15.4, c2: 46.1, c3: 37.3 }, { n: 15, c1: 15.3, c2: 47.2, c3: 37.9 }],
      pl: [{ c1: 14.8, c2: 24.6, c3: 22.75 }, { c1: 15.1, c2: 25.2, c3: 23.31 }],
    } },
    expect: { llv: 40, plv: 23, piv: 17, cls: 'CI' },
  },
};

export const SHRINKAGE: ObservationTemplate = {
  code: 'SOIL-SL', version: 1, material: 'Soil', category: 'Soil',
  name: 'Shrinkage limit of soil',
  method: 'IS 2720 (Part 6) : 1972 (RA 2021)',
  docControl: doc('05'),
  headerFields: [],
  constants: [{ key: 'hg', label: 'Density of mercury', unit: 'g/cm³', value: 13.6 }],
  derived: [],
  grids: [{ key: 't', label: 'Shrinkage dish', rows: 2, columns: [
    { key: 'w1', label: 'Dish (W1)', unit: 'g', input: true },
    { key: 'w2', label: 'Dish + wet soil pat', unit: 'g', input: true },
    { key: 'w3', label: 'Dish + dry soil pat', unit: 'g', input: true },
    { key: 'mhg1', label: 'Mercury filling the dish', unit: 'g', input: true },
    { key: 'mhg2', label: 'Mercury displaced by dry pat', unit: 'g', input: true },
    { key: 'w0', label: 'Dry pat (W0)', unit: 'g', formula: 'IF(OR(w1="",w3=""),"",w3-w1)', decimals: 2 },
    { key: 'w', label: 'Initial water content', unit: '%', formula: 'IF(OR(w0="",w2=""),"",(w2-w3)/w0*100)', decimals: 2 },
    { key: 'v', label: 'Volume of wet pat (V)', unit: 'cm³', formula: 'IF(mhg1="","",mhg1/hg)', decimals: 2 },
    { key: 'v0', label: 'Volume of dry pat (V0)', unit: 'cm³', formula: 'IF(mhg2="","",mhg2/hg)', decimals: 2 },
    { key: 'sl', label: 'Shrinkage limit', unit: '%', formula: 'IF(OR(w="",v="",v0=""),"",w-(v-v0)/w0*100)', decimals: 2 },
    { key: 'sr', label: 'Shrinkage ratio', formula: 'IF(OR(w0="",v0=""),"",w0/v0)', decimals: 2 },
  ] }],
  results: [
    { key: 'sl', label: 'Shrinkage limit', formula: 'IF(COUNT(t.sl)=0,"",AVERAGE(t.sl))', unit: '%', decimals: 0 },
    { key: 'sr', label: 'Shrinkage ratio', formula: 'IF(COUNT(t.sr)=0,"",AVERAGE(t.sr))', decimals: 2 },
  ],
  checks: [],
  reportRows: [{ name: 'Shrinkage limit', unit: '%', result: 'sl', decimals: 0, spec: '--' }, { name: 'Shrinkage ratio', unit: '--', result: 'sr', decimals: 2, spec: '--' }],
  references: ['IS 2720 (Part 6) : 1972 – volumes by mercury displacement.'],
  procedure: ['Mix about 30 g of soil passing 425 µm with water to a paste wetter than the liquid limit.', 'Fill the greased shrinkage dish in three layers, tapping out air, strike off and weigh (dish + wet pat).', 'Air-dry, then oven-dry the pat and weigh (dish + dry pat).', 'Find the dish volume (wet pat) from the mass of mercury filling it, and the dry pat volume from the mercury it displaces.', 'SL = w − (V − V0) ÷ W0 × 100; shrinkage ratio = W0 ÷ V0.'],
  sampleCalc: ['W0 = {t.w3#1:2} − {t.w1#1:2} = {t.w0#1:2} g; w = ({t.w2#1:2} − {t.w3#1:2}) ÷ {t.w0#1:2} × 100 = {t.w#1:2} %.', 'V = {t.mhg1#1:1} ÷ 13.6 = {t.v#1:2} cm³; V0 = {t.mhg2#1:1} ÷ 13.6 = {t.v0#1:2} cm³.', 'SL = {t.w#1:2} − ({t.v#1:2} − {t.v0#1:2}) ÷ {t.w0#1:2} × 100 = {t.sl#1:2} %; SR = {t.sr#1:2}.'],
  example: { input: { header: {}, grids: { t: [{ w1: 20, w2: 58.6, w3: 50.2, mhg1: 254, mhg2: 216.5 }] } }, expect: { 't.w#1': 27.81, 't.sl#1': 18.68, 't.sr#1': 1.897 } },
};

export const PROCTOR_V2: ObservationTemplate = {
  code: 'PROCTOR-HEAVY', version: 2, material: 'Soil', category: 'Soil',
  name: 'Water content – dry density relation (compaction)',
  method: 'IS 2720 (Part 8) : 1983 (RA 2020)',
  docControl: doc('06'),
  equipment: [{ key: 'mould', label: 'Compaction mould', category: 'Compaction mould' }],
  headerFields: [
    { key: 'method', label: 'Compaction', type: 'select', options: ['Heavy – IS 2720 (Part 8)', 'Light – IS 2720 (Part 7)'], default: 'Heavy – IS 2720 (Part 8)' },
    { key: 'g', label: 'Specific gravity (for zero air voids line)', type: 'number', default: 2.65 },
  ],
  constants: [
    { key: 'vol', label: 'Volume of mould', unit: 'cm³', fromEquipment: 'mould.volume', value: 1000 },
    { key: 'mm', label: 'Mass of mould + base', unit: 'g', fromEquipment: 'mould.mass' },
  ],
  derived: [],
  grids: [{ key: 't', label: 'Compaction trials', rows: 6, columns: [
    { key: 'm', label: 'Mould + compacted soil', unit: 'g', input: true },
    ...moisture(),
    { key: 'wet', label: 'Wet density', unit: 'g/cc', formula: 'IF(OR(m="",mm="",vol=""),"",(m-mm)/vol)', decimals: 3 },
    { key: 'dry', label: 'Dry density', unit: 'g/cc', formula: 'IF(OR(wet="",w=""),"",wet/(1+w/100))', decimals: 3 },
    { key: 'zav', label: 'Zero air voids', unit: 'g/cc', formula: 'IF(OR(w="",g=""),"",g/(1+w*g/100))', decimals: 3 },
  ] }],
  results: [
    { key: 'mdd', label: 'Maximum dry density (MDD)', formula: 'IF(COUNT(t.dry)<3,"",PEAKY(t.w,t.dry))', unit: 'g/cc', decimals: 2 },
    { key: 'omc', label: 'Optimum moisture content (OMC)', formula: 'IF(COUNT(t.dry)<3,"",PEAKX(t.w,t.dry))', unit: '%', decimals: 1 },
  ],
  checks: [
    { when: 'mm=""', level: 'error', message: 'Enter the mass of the mould (or select a calibrated mould).' },
    { when: 'AND(COUNT(t.dry)>=3,OR(MAX(t.dry)=INDEX(t.dry,1),MAX(t.dry)=INDEX(t.dry,COUNT(t.dry))))', level: 'warning', message: 'The highest dry density is at the first or last trial: the peak is not bracketed. Add a drier or wetter trial.' },
    { when: 'COUNTIF(t.dry,">"&MAX(t.zav))>0', level: 'warning', message: 'A dry density lies above the zero air voids line: check the masses and specific gravity.' },
  ],
  chart: { grid: 't', x: 'w', y: 'dry', title: 'Compaction curve', xLabel: 'Water content (%)', yLabel: 'Dry density (g/cc)', series: [{ y: 'zav', label: 'Zero air voids', dashed: true }] },
  reportRows: [
    { group: 'Compaction', name: 'Maximum dry density', unit: 'g/cc', result: 'mdd', decimals: 2, spec: '--' },
    { group: 'Compaction', name: 'Optimum moisture content', unit: '%', result: 'omc', decimals: 1, spec: '--' },
  ],
  references: ['IS 2720 (Part 8) : 1983 – heavy compaction: 4.9 kg rammer, 450 mm drop, 5 layers × 25 blows (1000 cc mould).', 'IS 2720 (Part 7) : 1980 – light compaction: 2.6 kg rammer, 310 mm drop, 3 layers × 25 blows.', 'MDD and OMC from the peak of a parabola through the highest point and its neighbours.'],
  procedure: [
    'Take about 5 kg of air-dried soil passing 19 mm (20 mm). Mix with water to about 4–6% below the expected OMC and keep it covered for some time.',
    'Weigh the mould with base plate. Compact the soil in 5 equal layers (heavy) or 3 layers (light), 25 blows of the rammer per layer, distributed uniformly.',
    'Remove the collar, trim the soil level with the top and weigh mould + soil.',
    'Take a moisture sample from the middle of the specimen.',
    'Repeat with increasing water content (2–3% steps) until the mass of compacted soil decreases (at least 5 points).',
    'Dry density = wet density ÷ (1 + w/100). Plot dry density against water content; the peak gives MDD and OMC.',
  ],
  sampleCalc: [
    'Trial 3: mould + soil {t.m#3:0} g, mould {mm:0} g, volume {vol:0} cc → wet density = {t.wet#3:3} g/cc.',
    'Water content {t.w#3:1} % → dry density = {t.wet#3:3} ÷ (1 + {t.w#3:1}/100) = {t.dry#3:3} g/cc.',
    'A parabola through trials 2, 3 and 4 peaks at w = {omc:1} %, dry density {mdd:3} g/cc → MDD {mdd:2} g/cc, OMC {omc:1} %.',
  ],
  example: {
    input: { header: { g: 2.65 }, constants: { mm: 4250 }, grids: { t: [
      { m: 6140, c1: 20, c2: 128, c3: 120 }, { m: 6290, c1: 20, c2: 130, c3: 120 }, { m: 6390, c1: 20, c2: 132, c3: 120 }, { m: 6380, c1: 20, c2: 134, c3: 120 }, { m: 6300, c1: 20, c2: 136, c3: 120 },
    ] } },
    expect: { 't.dry#3': 1.911, omc: 12.14, mdd: 1.911 },
  },
};

export const CBR_LAB_V2: ObservationTemplate = {
  ...CBR_LAB, version: 2, category: 'Soil',
  references: ['IS 2720 (Part 16) : 1987 – standard loads 1370 kg at 2.5 mm and 2055 kg at 5.0 mm on a 50 mm plunger.', 'Proving ring factor from its calibration certificate (Equipment); it can be entered manually on the sheet if needed.'],
  procedure: [
    'Compact the soil in the CBR mould at the required density and moisture (static or dynamic compaction) with the spacer disc in place.',
    'For soaked tests, place the surcharge weights and soak for 96 hours, recording swell; drain for 15 minutes before testing.',
    'Seat the 50 mm plunger with a 4 kg load, set the dial gauges to zero and apply load at 1.25 mm per minute.',
    'Record proving ring readings at the penetrations listed (0.5 mm steps to 4 mm, then 5, 7.5, 10 and 12.5 mm).',
    'Load = reading × ring constant; divide by plunger area for kg/cm². Correct the origin if the curve is concave upward at the start.',
    'CBR = test load ÷ standard load × 100 at 2.5 mm and 5.0 mm; normally the 2.5 mm value is reported. If the 5.0 mm value is higher, repeat; if it is again higher, report it.',
  ],
  sampleCalc: [
    'Ring factor {mf:5} kN/div → {mf:5} × 1000 ÷ 9.80665 = {prc:4} kgf/div. Plunger area = π × 5² ÷ 4 = {area:3} cm².',
    'At 2.5 mm the reading is {readings.prr#7:1} div → {readings.load_kgcm2#7:3} kg/cm² → CBR = {load25:3} ÷ 70 × 100 = {cbr25:1} %.',
    'At 5.0 mm the reading is {readings.prr#10:1} div → {load50:3} kg/cm² → CBR = {load50:3} ÷ 105 × 100 = {cbr50:1} %. Reported CBR = {cbr:1} %.',
  ],
  example: {
    input: {
      header: { test_condition: 'Soaked' }, equipment: { ring: { id: 1, name: 'Proving ring', data: { factor: 0.04995 } } },
      grids: { readings: [{ prr: 0 }, { prr: 21.6 }, { prr: 28.6 }, { prr: 35.7 }, { prr: 39.5 }, { prr: 43.2 }, { prr: 45.8 }, { prr: 47.1 }, { prr: 49.3 }, { prr: 52.6 }, { prr: 55.1 }, { prr: 57.9 }, {}, {}, {}] },
    },
    expect: { load25: 11.206, cbr25: 16.01, cbr: 16.01 },
  },
};

export const FSI_V2: ObservationTemplate = {
  code: 'FSI', version: 2, material: 'Soil', category: 'Soil',
  name: 'Free swell index of soil',
  method: 'IS 2720 (Part 40) : 1977 (RA 2021)',
  docControl: doc('08'),
  headerFields: [],
  constants: [], derived: [],
  grids: [{ key: 't', label: 'Graduated cylinders (10 g oven-dry soil passing 425 µm in each)', rows: 2, columns: [
    { key: 'vd', label: 'Volume in distilled water (Vd)', unit: 'ml', input: true },
    { key: 'vk', label: 'Volume in kerosene (Vk)', unit: 'ml', input: true },
    { key: 'fsi', label: 'Free swell index', unit: '%', formula: 'IF(OR(vd="",vk=""),"",(vd-vk)/vk*100)', decimals: 1 },
  ] }],
  results: [
    { key: 'fsi', label: 'Free swell index', formula: 'IF(COUNT(t.fsi)=0,"",ROUND(AVERAGE(t.fsi),0))', unit: '%', decimals: 0 },
    { key: 'deg', label: 'Degree of expansiveness', formula: 'IF(fsi="","",IF(fsi<20,"Low",IF(fsi<=35,"Moderate",IF(fsi<=50,"High","Very high"))))' },
  ],
  checks: [],
  reportRows: [{ name: 'Free Swell Index of soil', unit: '%', result: 'fsi', decimals: 0, spec: '--' }, { name: 'Degree of expansiveness', unit: '--', result: 'deg', spec: 'IS 1498' }],
  references: ['IS 2720 (Part 40) : 1977.', 'IS 1498 : 1970 – degree of expansiveness from free swell.'],
  procedure: ['Take two 10 g samples of oven-dried soil passing 425 µm.', 'Pour one into a 100 ml graduated cylinder of distilled water and the other into kerosene; fill both to 100 ml.', 'Stir to remove entrapped air and leave undisturbed for at least 24 hours.', 'Read the final soil volumes Vd (water) and Vk (kerosene). FSI = (Vd − Vk) ÷ Vk × 100.'],
  sampleCalc: ['FSI = ({t.vd#1:1} − {t.vk#1:1}) ÷ {t.vk#1:1} × 100 = {t.fsi#1:1} % → degree of expansiveness: {deg}.'],
  example: { input: { header: {}, grids: { t: [{ vd: 14.5, vk: 10 }] } }, expect: { 't.fsi#1': 45, deg: 'High' } },
};

const ucsDials = [0, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 700, 800];
export const UCS: ObservationTemplate = {
  code: 'SOIL-UCS', version: 1, material: 'Soil', category: 'Soil',
  name: 'Unconfined compressive strength of soil',
  method: 'IS 2720 (Part 10) : 1991 (RA 2020)',
  docControl: doc('09'),
  equipment: [{ key: 'ring', label: 'Proving ring', category: 'Proving ring' }],
  headerFields: [
    { key: 'd', label: 'Specimen diameter', type: 'number', unit: 'mm', default: 38 },
    { key: 'l', label: 'Specimen length', type: 'number', unit: 'mm', default: 76 },
    { key: 'mass', label: 'Specimen mass', type: 'number', unit: 'g' },
    { key: 'w', label: 'Water content', type: 'number', unit: '%' },
  ],
  constants: [{ key: 'mf', label: 'Proving ring factor', unit: 'kN/div', fromEquipment: 'ring.factor' }, { key: 'lc', label: 'Deformation dial least count', unit: 'mm/div', value: 0.01 }],
  derived: [
    { key: 'a0', label: 'Initial area', formula: 'IF(d="","",PI()*d^2/4)', unit: 'mm²', decimals: 1 },
    { key: 'bd', label: 'Bulk density', formula: 'IF(OR(mass="",a0="",l=""),"",mass/(a0*l)*1000)', unit: 'g/cc', decimals: 3 },
  ],
  grids: [{ key: 'r', label: 'Load–deformation readings (strain rate 0.5–2% per minute)', fixedRows: ucsDials.map((x) => ({ dial: x })), columns: [
    { key: 'dial', label: 'Deformation dial', unit: 'div' },
    { key: 'prr', label: 'Proving ring reading', unit: 'div', input: true },
    { key: 'dl', label: 'Deformation', unit: 'mm', formula: 'dial*lc', decimals: 2 },
    { key: 'strain', label: 'Strain', unit: '%', formula: 'IF(l="","",dl/l*100)', decimals: 2 },
    { key: 'ac', label: 'Corrected area', unit: 'mm²', formula: 'IF(OR(a0="",strain=""),"",a0/(1-strain/100))', decimals: 1 },
    { key: 'p', label: 'Load', unit: 'N', formula: 'IF(OR(prr="",mf=""),"",prr*mf*1000)', decimals: 1 },
    { key: 's', label: 'Stress', unit: 'kPa', formula: 'IF(OR(p="",ac=""),"",p/ac*1000)', decimals: 1 },
  ] }],
  results: [
    { key: 'qu', label: 'Unconfined compressive strength (qu)', formula: 'IF(COUNT(r.s)=0,"",MAX(r.s))', unit: 'kPa', decimals: 1 },
    { key: 'ef', label: 'Strain at failure', formula: 'IF(qu="","",INDEX(r.strain,MATCH(qu,r.s,0)))', unit: '%', decimals: 1 },
    { key: 'cu', label: 'Undrained cohesion (qu / 2)', formula: 'IF(qu="","",qu/2)', unit: 'kPa', decimals: 1 },
  ],
  checks: [{ when: 'mf=""', level: 'error', message: 'Select a proving ring or enter its factor.' }],
  chart: { grid: 'r', x: 'strain', y: 's', title: 'Stress–strain curve', xLabel: 'Axial strain (%)', yLabel: 'Stress (kPa)' },
  reportRows: [{ name: 'Unconfined compressive strength', unit: 'kPa', result: 'qu', decimals: 1, spec: '--' }, { name: 'Undrained cohesion', unit: 'kPa', result: 'cu', decimals: 1, spec: '--' }],
  references: ['IS 2720 (Part 10) : 1991. qu is the peak stress, or the stress at 20% strain if no peak occurs.'],
  procedure: ['Prepare a specimen with length about twice its diameter (38 × 76 mm typical); measure and weigh it.', 'Place it centrally in the loading frame, set the proving ring and deformation dials to zero.', 'Compress at a strain rate of 0.5–2% per minute, reading the proving ring at the deformation readings listed.', 'Continue until the load falls or 20% strain is reached; sketch the failure pattern.', 'Stress = load ÷ corrected area, A = A0 ÷ (1 − ε). qu = peak stress, cu = qu ÷ 2.'],
  sampleCalc: ['A0 = π × {d:0}² ÷ 4 = {a0:1} mm². At {r.dl#8:2} mm deformation, strain = {r.strain#8:2} % and corrected area = {r.ac#8:1} mm².', 'Load = {r.prr#8:0} × {mf:4} × 1000 = {r.p#8:1} N → stress = {r.s#8:1} kPa. Peak stress qu = {qu:1} kPa at {ef:1} % strain; cu = {cu:1} kPa.'],
  example: { input: { header: { d: 38, l: 76 }, constants: { mf: 0.002 }, grids: { r: [{ prr: 0 }, { prr: 22 }, { prr: 41 }, { prr: 56 }, { prr: 67 }, { prr: 82 }, { prr: 90 }, { prr: 94 }, { prr: 93 }, { prr: 88 }] } }, expect: { 'r.s#8': 160.3, qu: 160.3, ef: 3.29 } },
};

export const DIRECT_SHEAR: ObservationTemplate = {
  code: 'SOIL-DST', version: 1, material: 'Soil', category: 'Soil',
  name: 'Direct shear test of soil',
  method: 'IS 2720 (Part 13) : 1986 (RA 2021)',
  docControl: doc('10'),
  equipment: [{ key: 'ring', label: 'Proving ring', category: 'Proving ring' }],
  headerFields: [{ key: 'cond', label: 'Test condition', type: 'select', options: ['Undrained', 'Consolidated undrained', 'Drained'], default: 'Undrained' }, { key: 'box', label: 'Shear box size', type: 'number', unit: 'mm', default: 60 }],
  constants: [{ key: 'mf', label: 'Proving ring factor', unit: 'kN/div', fromEquipment: 'ring.factor' }],
  derived: [{ key: 'area', label: 'Area of specimen', formula: 'IF(box="","",box^2)', unit: 'mm²', decimals: 0 }],
  grids: [{ key: 't', label: 'Specimens', rows: 3, columns: [
    { key: 'sn', label: 'Normal stress (σ)', unit: 'kPa', input: true },
    { key: 'prr', label: 'Peak proving ring reading', unit: 'div', input: true },
    { key: 'f', label: 'Shear force', unit: 'N', formula: 'IF(OR(prr="",mf=""),"",prr*mf*1000)', decimals: 1 },
    { key: 'tau', label: 'Shear stress (τ)', unit: 'kPa', formula: 'IF(OR(f="",area=""),"",f/area*1000)', decimals: 1 },
  ] }],
  results: [
    { key: 'c', label: 'Cohesion (c)', formula: 'IF(COUNT(t.tau)<2,"",MAX(0,INTERCEPT(t.tau,t.sn)))', unit: 'kPa', decimals: 1 },
    { key: 'phi', label: 'Angle of shearing resistance (φ)', formula: 'IF(COUNT(t.tau)<2,"",DEGREES(ATAN(SLOPE(t.tau,t.sn))))', unit: '°', decimals: 1 },
  ],
  checks: [{ when: 'mf=""', level: 'error', message: 'Select a proving ring or enter its factor.' }],
  chart: { grid: 't', x: 'sn', y: 'tau', fit: 'line', title: 'Failure envelope', xLabel: 'Normal stress (kPa)', yLabel: 'Shear stress (kPa)' },
  reportRows: [{ group: 'Shear parameters', name: 'Cohesion (c)', unit: 'kPa', result: 'c', decimals: 1, spec: '--' }, { group: 'Shear parameters', name: 'Angle of shearing resistance (φ)', unit: 'degree', result: 'phi', decimals: 1, spec: '--' }],
  references: ['IS 2720 (Part 13) : 1986 – three specimens at different normal stresses; c and φ from the straight-line failure envelope.'],
  procedure: ['Assemble the shear box with grid plates and place the specimen (60 × 60 mm typical).', 'Apply the normal load for the first specimen; for drained tests allow consolidation.', 'Shear at the specified rate (1.25 mm/min for undrained tests) and record the peak proving ring reading.', 'Repeat with two more specimens at higher normal stresses.', 'τ = shear force ÷ area. Fit a straight line τ = c + σ tan φ through the three points.'],
  sampleCalc: ['Specimen 1: {t.prr#1:0} div × {mf:4} kN/div = {t.f#1:1} N → τ = {t.f#1:1} ÷ {area:0} mm² = {t.tau#1:1} kPa at σ = {t.sn#1:0} kPa.', 'Best-fit line through ({t.sn#1:0}, {t.tau#1:1}), ({t.sn#2:0}, {t.tau#2:1}), ({t.sn#3:0}, {t.tau#3:1}) gives c = {c:1} kPa and φ = {phi:1}°.'],
  example: { input: { header: { box: 60 }, constants: { mf: 0.002 }, grids: { t: [{ sn: 50, prr: 88 }, { sn: 100, prr: 140 }, { sn: 150, prr: 192 }] } }, expect: { c: 20, phi: 30.02 } },
};

export const CORE_CUTTER: ObservationTemplate = {
  code: 'SOIL-FDD-CC', version: 1, material: 'Soil', category: 'Soil',
  name: 'Field dry density by core cutter',
  method: 'IS 2720 (Part 29) : 1975 (RA 2020)',
  docControl: doc('11'),
  equipment: [{ key: 'cutter', label: 'Core cutter', category: 'Core cutter' }],
  headerFields: [{ key: 'mdd', label: 'Laboratory MDD (for degree of compaction)', type: 'number', unit: 'g/cc' }, { key: 'reqd', label: 'Required compaction', type: 'number', unit: '%', default: 95 }, { key: 'layer', label: 'Layer / chainage', type: 'text' }],
  constants: [{ key: 'v', label: 'Volume of core cutter', unit: 'cm³', fromEquipment: 'cutter.volume' }, { key: 'mc', label: 'Mass of core cutter', unit: 'g', fromEquipment: 'cutter.mass' }],
  derived: [],
  grids: [{ key: 't', label: 'Test locations', rows: 5, columns: [
    { key: 'loc', label: 'Location', input: true, text: true },
    { key: 'm', label: 'Cutter + soil', unit: 'g', input: true },
    ...moisture(),
    { key: 'bd', label: 'Bulk density', unit: 'g/cc', formula: 'IF(OR(m="",mc="",v=""),"",(m-mc)/v)', decimals: 3 },
    { key: 'dd', label: 'Dry density', unit: 'g/cc', formula: 'IF(OR(bd="",w=""),"",bd/(1+w/100))', decimals: 3 },
    { key: 'dc', label: 'Degree of compaction', unit: '%', formula: 'IF(OR(dd="",mdd=""),"",dd/mdd*100)', decimals: 1 },
  ] }],
  results: [
    { key: 'dd', label: 'Average dry density', formula: 'IF(COUNT(t.dd)=0,"",AVERAGE(t.dd))', unit: 'g/cc', decimals: 2 },
    { key: 'dc', label: 'Average degree of compaction', formula: 'IF(COUNT(t.dc)=0,"",AVERAGE(t.dc))', unit: '%', decimals: 1 },
    { key: 'dcmin', label: 'Lowest degree of compaction', formula: 'IF(COUNT(t.dc)=0,"",MIN(t.dc))', unit: '%', decimals: 1 },
  ],
  checks: [{ when: 'OR(v="",mc="")', level: 'error', message: 'Select a calibrated core cutter or enter its volume and mass.' }, { when: 'AND(dcmin<>"",reqd<>"",dcmin<reqd)', level: 'warning', message: 'Compaction at one or more locations is below the requirement.' }],
  reportRows: [{ name: 'Field dry density (average)', unit: 'g/cc', result: 'dd', decimals: 2, spec: '--' }, { name: 'Degree of compaction (average)', unit: '%', result: 'dc', decimals: 1, specFormula: 'IF(reqd="","--","Min "&reqd)' }],
  reportTables: [{ title: 'Field density by core cutter', grid: 't', skipBlank: 'dd', columns: [{ key: 'loc', label: 'Location' }, { key: 'w', label: 'Moisture (%)', decimals: 2 }, { key: 'bd', label: 'Bulk density (g/cc)', decimals: 3 }, { key: 'dd', label: 'Dry density (g/cc)', decimals: 3 }, { key: 'dc', label: 'Compaction (%)', decimals: 1 }] }],
  references: ['IS 2720 (Part 29) : 1975 – for cohesive soils free from stones.'],
  procedure: ['Level a small area, place the dolly on the cutter and drive the cutter into the soil with the rammer until only about 15 mm of the dolly protrudes.', 'Dig out the cutter, trim both ends flush and weigh cutter + soil.', 'Take a moisture sample from the core.', 'Bulk density = (mass − cutter mass) ÷ cutter volume; dry density = bulk ÷ (1 + w/100); compaction = dry density ÷ MDD × 100.'],
  sampleCalc: ['Bulk density = ({t.m#1:0} − {mc:0}) ÷ {v:0} = {t.bd#1:3} g/cc; w = {t.w#1:2} % → dry density = {t.dd#1:3} g/cc.', 'Compaction = {t.dd#1:3} ÷ {mdd:2} × 100 = {t.dc#1:1} %.'],
  example: { input: { header: { mdd: 1.85 }, constants: { v: 1000, mc: 1050 }, grids: { t: [{ loc: 'Ch 0+100', m: 3020, c1: 20, c2: 127, c3: 115 }] } }, expect: { 't.bd#1': 1.97, 't.dd#1': 1.749, 't.dc#1': 94.5 } },
};

export const SAND_REPLACEMENT: ObservationTemplate = {
  code: 'SOIL-FDD-SR', version: 1, material: 'Soil', category: 'Soil',
  name: 'Field dry density by sand replacement',
  method: 'IS 2720 (Part 28) : 1974 (RA 2020)',
  docControl: doc('12'),
  equipment: [{ key: 'pour', label: 'Sand pouring cylinder', category: 'Sand pouring cylinder' }],
  headerFields: [{ key: 'mdd', label: 'Laboratory MDD (for degree of compaction)', type: 'number', unit: 'g/cc' }, { key: 'reqd', label: 'Required compaction', type: 'number', unit: '%', default: 95 }, { key: 'layer', label: 'Layer / chainage', type: 'text' }],
  constants: [{ key: 'cone', label: 'Mass of sand in cone (W2)', unit: 'g', fromEquipment: 'pour.cone_mass' }, { key: 'gs', label: 'Bulk density of sand (γs)', unit: 'g/cm³', fromEquipment: 'pour.sand_density' }],
  derived: [],
  grids: [{ key: 't', label: 'Test locations', rows: 5, columns: [
    { key: 'loc', label: 'Location', input: true, text: true },
    { key: 'ww', label: 'Mass of excavated soil (Ww)', unit: 'g', input: true },
    { key: 'w1', label: 'Cylinder + sand before (W1)', unit: 'g', input: true },
    { key: 'w4', label: 'Cylinder + sand after (W4)', unit: 'g', input: true },
    { key: 'sand', label: 'Sand in hole (Wb)', unit: 'g', formula: 'IF(OR(w1="",w4="",cone=""),"",w1-w4-cone)', decimals: 0 },
    { key: 'vh', label: 'Volume of hole', unit: 'cm³', formula: 'IF(OR(sand="",gs=""),"",sand/gs)', decimals: 0 },
    ...moisture(),
    { key: 'bd', label: 'Bulk density', unit: 'g/cc', formula: 'IF(OR(ww="",vh=""),"",ww/vh)', decimals: 3 },
    { key: 'dd', label: 'Dry density', unit: 'g/cc', formula: 'IF(OR(bd="",w=""),"",bd/(1+w/100))', decimals: 3 },
    { key: 'dc', label: 'Degree of compaction', unit: '%', formula: 'IF(OR(dd="",mdd=""),"",dd/mdd*100)', decimals: 1 },
  ] }],
  results: [
    { key: 'dd', label: 'Average dry density', formula: 'IF(COUNT(t.dd)=0,"",AVERAGE(t.dd))', unit: 'g/cc', decimals: 2 },
    { key: 'dc', label: 'Average degree of compaction', formula: 'IF(COUNT(t.dc)=0,"",AVERAGE(t.dc))', unit: '%', decimals: 1 },
    { key: 'dcmin', label: 'Lowest degree of compaction', formula: 'IF(COUNT(t.dc)=0,"",MIN(t.dc))', unit: '%', decimals: 1 },
  ],
  checks: [{ when: 'OR(cone="",gs="")', level: 'error', message: 'Select a calibrated sand pouring cylinder or enter the cone mass and sand density.' }, { when: 'AND(dcmin<>"",reqd<>"",dcmin<reqd)', level: 'warning', message: 'Compaction at one or more locations is below the requirement.' }],
  reportRows: [{ name: 'Field dry density (average)', unit: 'g/cc', result: 'dd', decimals: 2, spec: '--' }, { name: 'Degree of compaction (average)', unit: '%', result: 'dc', decimals: 1, specFormula: 'IF(reqd="","--","Min "&reqd)' }],
  reportTables: [{ title: 'Field density by sand replacement', grid: 't', skipBlank: 'dd', columns: [{ key: 'loc', label: 'Location' }, { key: 'w', label: 'Moisture (%)', decimals: 2 }, { key: 'bd', label: 'Bulk density (g/cc)', decimals: 3 }, { key: 'dd', label: 'Dry density (g/cc)', decimals: 3 }, { key: 'dc', label: 'Compaction (%)', decimals: 1 }] }],
  references: ['IS 2720 (Part 28) : 1974 – calibrate the cone mass and the sand density regularly and whenever the sand batch changes.'],
  procedure: ['Calibrate: find the mass of sand filling the cone (W2) and the bulk density of the sand (γs) using the calibrating container.', 'Level the ground, place the tray, excavate a hole about 100 mm diameter and 150 mm deep, and collect and weigh all excavated soil (Ww).', 'Weigh the cylinder filled with sand (W1), place it over the hole, open the shutter until sand stops running, close and weigh again (W4).', 'Sand in hole = W1 − W4 − W2; volume = sand ÷ γs. Bulk density = Ww ÷ volume; dry density = bulk ÷ (1 + w/100).'],
  sampleCalc: ['Sand in hole = {t.w1#1:0} − {t.w4#1:0} − {cone:0} = {t.sand#1:0} g → volume = {t.sand#1:0} ÷ {gs:2} = {t.vh#1:0} cm³.', 'Bulk density = {t.ww#1:0} ÷ {t.vh#1:0} = {t.bd#1:3} g/cc; w = {t.w#1:2} % → dry density {t.dd#1:3} g/cc → compaction {t.dc#1:1} %.'],
  example: { input: { header: { mdd: 1.85 }, constants: { cone: 450, gs: 1.45 }, grids: { t: [{ loc: 'Ch 0+200', ww: 3700, w1: 12000, w4: 8850, c1: 20, c2: 120, c3: 108 }] } }, expect: { 't.sand#1': 2700, 't.bd#1': 1.987, 't.dd#1': 1.749 } },
};

export const SOIL_TEMPLATES: ObservationTemplate[] = [SOIL_MC, SOIL_SG, GRADATION_SOIL_V2, ATTERBERG_V2, SHRINKAGE, PROCTOR_V2, CBR_LAB_V2, FSI_V2, UCS, DIRECT_SHEAR, CORE_CUTTER, SAND_REPLACEMENT];
