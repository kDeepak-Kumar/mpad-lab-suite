import type { ObservationTemplate } from '../observation';

/**
 * Civil testing laboratory pack: observation templates.
 * CBR (lab) mirrors the lab's own Excel sheet (IS 2720 Part 16) formula for formula.
 * Templates marked `simplified` capture results with basic calculations and should be
 * replaced by the lab's own observation sheets as they are converted.
 */

const cbrDials = [0, 50, 100, 150, 200, 250, 300, 350, 400, 500, 600, 700, 750, 1000, 1250];

export const CBR_LAB: ObservationTemplate = {
  code: 'CBR-LAB', version: 1, material: 'Soil',
  name: 'Determination of CBR value (laboratory)',
  method: 'IS 2720 (Part 16) : 1987 (Reaffirmed 2021)',
  docControl: { docNo: 'OBS/BR/01', issueNo: '01', issueDate: '', amendmentNo: '0' },
  equipment: [{ key: 'ring', label: 'Proving ring', category: 'Proving ring' }],
  headerFields: [
    { key: 'test_condition', label: 'Test condition', type: 'select', options: ['Soaked', 'Unsoaked'], required: true },
    { key: 'surcharge_kg', label: 'Surcharge weight', type: 'number', unit: 'kg' },
  ],
  constants: [
    { key: 'mf', label: 'Calibration multiplying factor', unit: 'kN/div', fromEquipment: 'ring.factor', note: 'From the proving ring calibration certificate' },
    { key: 'g', label: 'Standard gravity', unit: 'm/s²', value: 9.80665, note: '1 kgf = 9.80665 N' },
    { key: 'plunger_d', label: 'Plunger diameter', unit: 'mm', value: 50, note: 'IS 2720 (Part 16) specifies 50 mm' },
    { key: 'lc', label: 'Dial gauge least count', unit: 'mm/div', value: 0.01 },
    { key: 'std25', label: 'Standard load @ 2.5 mm', unit: 'kg/cm²', value: 70, note: '1370 kg total' },
    { key: 'std50', label: 'Standard load @ 5.0 mm', unit: 'kg/cm²', value: 105, note: '2055 kg total' },
  ],
  derived: [
    { key: 'prc', label: 'Proving ring constant', formula: 'mf*1000/g', unit: 'kgf/div', decimals: 4 },
    { key: 'area', label: 'Plunger area', formula: 'PI()*(plunger_d/10)^2/4', unit: 'cm²', decimals: 3 },
    { key: 'k', label: 'Load per division', formula: 'prc/area', unit: 'kg/cm² per div', decimals: 5 },
  ],
  grids: [{
    key: 'readings', label: 'Load–penetration readings',
    fixedRows: cbrDials.map((d) => ({ dial: d })),
    columns: [
      { key: 'dial', label: 'Dial gauge reading', unit: 'div' },
      { key: 'pen', label: 'Penetration', unit: 'mm', formula: 'dial*lc', decimals: 2 },
      { key: 'prr', label: 'Proving ring reading', unit: 'div', input: true },
      { key: 'load_kgf', label: 'Load', unit: 'kgf', formula: 'IF(prr="","",prr*prc)', decimals: 1 },
      { key: 'load_kgcm2', label: 'Load', unit: 'kg/cm²', formula: 'IF(prr="","",prr*k)', decimals: 3 },
    ],
  }],
  results: [
    { key: 'load25', label: 'Test load @ 2.5 mm', formula: 'IFERROR(LOOKUPX(2.5, readings.pen, readings.load_kgcm2),"")', unit: 'kg/cm²', decimals: 3 },
    { key: 'load50', label: 'Test load @ 5.0 mm', formula: 'IFERROR(LOOKUPX(5, readings.pen, readings.load_kgcm2),"")', unit: 'kg/cm²', decimals: 3 },
    { key: 'cbr25', label: 'CBR @ 2.5 mm', formula: 'IF(load25="","",load25/std25*100)', unit: '%', decimals: 1 },
    { key: 'cbr50', label: 'CBR @ 5.0 mm', formula: 'IF(load50="","",load50/std50*100)', unit: '%', decimals: 1 },
    { key: 'cbr', label: 'Reported CBR value', formula: 'IF(OR(cbr25="",cbr50=""),"",IF(cbr50>cbr25,cbr50,cbr25))', unit: '%', decimals: 1 },
  ],
  checks: [
    { when: 'AND(cbr25<>"",cbr50<>"",cbr50>cbr25)', level: 'warning', message: 'CBR at 5.0 mm is greater than at 2.5 mm: repeat the test as per IS 2720 (Part 16). If results are identical, report the 5.0 mm value.' },
    { when: 'IFERROR(AND(INDEX(readings.prr,2)<>"",INDEX(readings.prr,3)<>"",(INDEX(readings.load_kgcm2,3)-INDEX(readings.load_kgcm2,2))>INDEX(readings.load_kgcm2,2)*1.1),FALSE)', level: 'warning', message: 'Initial portion of the curve is concave upward: apply origin correction as per IS 2720 (Part 16).' },
    { when: 'mf=""', level: 'error', message: 'Select a proving ring with a valid calibration factor.' },
  ],
  chart: { grid: 'readings', x: 'pen', y: 'load_kgcm2', title: 'Load–penetration curve', xLabel: 'Penetration (mm)', yLabel: 'Load (kg/cm²)' },
  reportRows: [{ name: 'California Bearing Ratio (CBR)', unit: '%', result: 'cbr', decimals: 1 }],
  instructions: 'Enter proving ring readings only. Penetrations are fixed. Leave a reading blank if not taken.',
};

export const PROCTOR_HEAVY: ObservationTemplate = {
  code: 'PROCTOR-HEAVY', version: 1, material: 'Soil', simplified: true,
  name: 'Water content – dry density relation (heavy compaction)',
  method: 'IS 2720 (Part 8) : 1983 (RA 2020)',
  headerFields: [
    { key: 'mould_mass', label: 'Mass of empty mould', type: 'number', unit: 'g', required: true },
    { key: 'mould_vol', label: 'Volume of mould', type: 'number', unit: 'cc', required: true },
  ],
  constants: [], derived: [],
  grids: [{
    key: 'trials', label: 'Compaction trials', rows: 5,
    columns: [
      { key: 'mass_ms', label: 'Mould + compacted soil', unit: 'g', input: true },
      { key: 'w', label: 'Water content', unit: '%', input: true, decimals: 1 },
      { key: 'wet', label: 'Wet density', unit: 'g/cc', formula: 'IF(OR(mass_ms="",mould_vol=""),"",(mass_ms-mould_mass)/mould_vol)', decimals: 3 },
      { key: 'dry', label: 'Dry density', unit: 'g/cc', formula: 'IF(OR(wet="",w=""),"",wet/(1+w/100))', decimals: 3 },
    ],
  }],
  results: [
    { key: 'mdd', label: 'Maximum dry density (MDD)', formula: 'IF(COUNT(trials.dry)=0,"",MAX(trials.dry))', unit: 'g/cc', decimals: 3 },
    { key: 'omc', label: 'Optimum moisture content (OMC)', formula: 'IFERROR(LOOKUPX(mdd, trials.dry, trials.w),"")', unit: '%', decimals: 1 },
  ],
  checks: [{ when: 'AND(mdd<>"",mdd=INDEX(trials.dry,COUNT(trials.dry)))', level: 'warning', message: 'Highest dry density is at the last trial: the peak may not be reached. Add a wetter trial.' }],
  chart: { grid: 'trials', x: 'w', y: 'dry', title: 'Compaction curve', xLabel: 'Water content (%)', yLabel: 'Dry density (g/cc)' },
  reportRows: [
    { group: 'Modified Proctor', name: 'MDD', unit: 'g/cc', result: 'mdd', decimals: 3 },
    { group: 'Modified Proctor', name: 'OMC', unit: '%', result: 'omc', decimals: 1 },
  ],
  instructions: 'Simplified sheet: MDD and OMC are taken from the highest measured point. Replace with the lab’s curve-fitting sheet when converted.',
};

const sieves = ['4.75 mm', '2.36 mm', '1.18 mm', '600 µm', '425 µm', '300 µm', '150 µm', '75 µm'];
export const GRADATION_SOIL: ObservationTemplate = {
  code: 'GRADATION-SOIL', version: 1, material: 'Soil', simplified: true,
  name: 'Grain size analysis of soil (sieve)',
  method: 'IS 2720 (Part 4) : 1985 (RA 2020)',
  headerFields: [
    { key: 'total', label: 'Total dry mass of sample', type: 'number', unit: 'g', required: true },
    { key: 'pan', label: 'Mass passing 75 µm (wash + pan)', type: 'number', unit: 'g', required: true },
  ],
  constants: [], derived: [],
  grids: [{
    key: 'sieves', label: 'Sieve analysis', fixedRows: sieves.map((s) => ({ sieve: s })),
    columns: [
      { key: 'sieve', label: 'IS sieve' },
      { key: 'ret', label: 'Mass retained', unit: 'g', input: true },
      { key: 'pct', label: 'Retained', unit: '%', formula: 'IF(OR(ret="",total=""),"",ret/total*100)', decimals: 1 },
    ],
  }],
  results: [
    { key: 'gravel', label: 'Gravel', formula: 'IF(total="","",ROUND(INDEX(sieves.ret,1)/total*100,0))', unit: '%', decimals: 0 },
    { key: 'silt_clay', label: 'Silt & clay', formula: 'IF(OR(total="",pan=""),"",ROUND(pan/total*100,0))', unit: '%', decimals: 0 },
    { key: 'sand', label: 'Sand', formula: 'IF(OR(gravel="",silt_clay=""),"",100-gravel-silt_clay)', unit: '%', decimals: 0 },
  ],
  checks: [{ when: 'IFERROR(ABS(SUM(sieves.ret)+pan-total)>total*0.01,FALSE)', level: 'warning', message: 'Sum of retained masses and pan differs from total mass by more than 1%.' }],
  reportRows: [
    { group: 'Gradation analysis of soil', name: 'Gravel', unit: '%', result: 'gravel', decimals: 0 },
    { group: 'Gradation analysis of soil', name: 'Sand', unit: '%', result: 'sand', decimals: 0 },
    { group: 'Gradation analysis of soil', name: 'Silt & Clay', unit: '%', result: 'silt_clay', decimals: 0 },
  ],
};

export const ATTERBERG: ObservationTemplate = {
  code: 'ATTERBERG', version: 1, material: 'Soil', simplified: true,
  name: 'Liquid limit and plastic limit of soil',
  method: 'IS 2720 (Part 5) : 1985 (RA 2020)',
  headerFields: [
    { key: 'll', label: 'Liquid limit (from flow curve)', type: 'number', unit: '%', required: true },
    { key: 'pl', label: 'Plastic limit', type: 'number', unit: '%', required: true },
  ],
  constants: [], derived: [], grids: [],
  results: [
    { key: 'll_r', label: 'Liquid limit (LL)', formula: 'll', unit: '%', decimals: 0 },
    { key: 'pl_r', label: 'Plastic limit (PL)', formula: 'pl', unit: '%', decimals: 0 },
    { key: 'pi', label: 'Plasticity index (PI)', formula: 'IF(OR(ll="",pl=""),"",ll-pl)', unit: '', decimals: 0 },
  ],
  checks: [{ when: 'AND(ll<>"",pl<>"",pl>ll)', level: 'error', message: 'Plastic limit is greater than liquid limit: check the entries (report as non-plastic if applicable).' }],
  reportRows: [
    { name: 'Liquid limit (LL)', unit: '%', result: 'll_r', decimals: 0 },
    { name: 'Plastic limit (PL)', unit: '%', result: 'pl_r', decimals: 0 },
    { name: 'Plasticity index (PI)', unit: '--', result: 'pi', decimals: 0 },
  ],
};

export const FREE_SWELL: ObservationTemplate = {
  code: 'FSI', version: 1, material: 'Soil',
  name: 'Free swell index of soil',
  method: 'IS 2720 (Part 40) : 1977 (RA 2021)',
  headerFields: [
    { key: 'vd', label: 'Volume of soil in distilled water (Vd)', type: 'number', unit: 'ml', required: true },
    { key: 'vk', label: 'Volume of soil in kerosene (Vk)', type: 'number', unit: 'ml', required: true },
  ],
  constants: [], derived: [], grids: [],
  results: [{ key: 'fsi', label: 'Free swell index', formula: 'IF(OR(vd="",vk=""),"",ROUND((vd-vk)/vk*100,0))', unit: '%', decimals: 0 }],
  checks: [],
  reportRows: [{ name: 'Free Swell Index of soil', unit: '%', result: 'fsi', decimals: 0 }],
};

export const CUBE_COMPRESSION: ObservationTemplate = {
  code: 'CUBE-COMP', version: 1, material: 'Concrete',
  name: 'Compressive strength of concrete cubes',
  method: 'IS 516 (Part 1/Sec 1) : 2021',
  equipment: [{ key: 'ctm', label: 'Compression testing machine', category: 'Compression testing machine' }],
  headerFields: [
    { key: 'grade', label: 'Grade of concrete', type: 'select', options: ['M15', 'M20', 'M25', 'M30', 'M35', 'M40', 'M45', 'M50'] },
    { key: 'casting_date', label: 'Date of casting', type: 'date' },
    { key: 'age', label: 'Age at test', type: 'number', unit: 'days' },
  ],
  constants: [], derived: [],
  grids: [{
    key: 'cubes', label: 'Specimens', rows: 3,
    columns: [
      { key: 'id', label: 'Cube ID', input: true },
      { key: 'l', label: 'Length', unit: 'mm', input: true },
      { key: 'b', label: 'Breadth', unit: 'mm', input: true },
      { key: 'mass', label: 'Mass', unit: 'kg', input: true, decimals: 3 },
      { key: 'load', label: 'Failure load', unit: 'kN', input: true },
      { key: 'area', label: 'Area', unit: 'mm²', formula: 'IF(OR(l="",b=""),"",l*b)', decimals: 0 },
      { key: 'fc', label: 'Compressive strength', unit: 'N/mm²', formula: 'IF(OR(load="",area=""),"",load*1000/area)', decimals: 2 },
    ],
  }],
  results: [{ key: 'avg', label: 'Average compressive strength', formula: 'IF(COUNT(cubes.fc)=0,"",AVERAGE(cubes.fc))', unit: 'N/mm²', decimals: 2 }],
  checks: [{
    // individual variation: any specimen deviating more than 15% from the average
    when: 'IFERROR(OR(ABS(INDEX(cubes.fc,1)-avg)>avg*0.15,ABS(INDEX(cubes.fc,2)-avg)>avg*0.15,ABS(INDEX(cubes.fc,3)-avg)>avg*0.15),FALSE)',
    level: 'warning', message: 'A specimen deviates more than 15% from the average: check the acceptance criteria before reporting.',
  }],
  reportRows: [{ name: 'Compressive strength (average)', unit: 'N/mm²', result: 'avg', decimals: 2 }],
};

/** First-release (v1) templates, kept so tests already recorded on them still evaluate and report. */
export const V1_TEMPLATES: ObservationTemplate[] = [CBR_LAB, PROCTOR_HEAVY, GRADATION_SOIL, ATTERBERG, FREE_SWELL, CUBE_COMPRESSION];
