import type { ObservationTemplate } from '../observation';

/** Hardened concrete specimens: IS 516 (Part 1/Sec 1) : 2021, acceptance per IS 456 : 2000 cl. 15–16. */

const GRADES = ['M10', 'M15', 'M20', 'M25', 'M30', 'M35', 'M40', 'M45', 'M50', 'M55', 'M60'];
const fck = 'IFERROR(IF(grade="","",RIGHT(grade,LEN(grade)-1)*1),"")';

export const CUBE_COMPRESSION_V2: ObservationTemplate = {
  code: 'CUBE-COMP', version: 2, material: 'Concrete', category: 'Concrete',
  name: 'Compressive strength of concrete cubes',
  method: 'IS 516 (Part 1/Sec 1) : 2021',
  docControl: { docNo: 'OBS/CON/01', issueNo: '01', issueDate: '', amendmentNo: '0' },
  equipment: [{ key: 'ctm', label: 'Compression testing machine', category: 'Compression testing machine' }],
  headerFields: [
    { key: 'grade', label: 'Grade of concrete', type: 'select', options: GRADES, required: true },
    { key: 'casting_date', label: 'Date of casting', type: 'date' },
    { key: 'age', label: 'Age at test', type: 'number', unit: 'days', required: true, default: 28 },
    { key: 'element', label: 'Structural element / pour', type: 'text' },
    { key: 'size', label: 'Cube size', type: 'select', options: ['150 mm', '100 mm'], default: '150 mm' },
  ],
  constants: [{ key: 'ctm_cf', label: 'CTM correction factor', fromEquipment: 'ctm.correction', value: 1 }],
  derived: [{ key: 'fck', label: 'Characteristic strength (fck)', formula: fck, unit: 'N/mm²', decimals: 0 }],
  grids: [{
    key: 'cubes', label: 'Specimens', rows: 3,
    columns: [
      { key: 'id', label: 'Cube ID', input: true, text: true },
      { key: 'l', label: 'Length', unit: 'mm', input: true },
      { key: 'b', label: 'Breadth', unit: 'mm', input: true },
      { key: 'h', label: 'Height', unit: 'mm', input: true },
      { key: 'mass', label: 'Mass', unit: 'kg', input: true },
      { key: 'load', label: 'Failure load', unit: 'kN', input: true },
      { key: 'area', label: 'Area', unit: 'mm²', formula: 'IF(OR(l="",b=""),"",l*b)', decimals: 0 },
      { key: 'dens', label: 'Density', unit: 'kg/m³', formula: 'IF(OR(mass="",area="",h=""),"",mass/(area*h)*1E9)', decimals: 0 },
      { key: 'fc', label: 'Compressive strength', unit: 'N/mm²', formula: 'IF(OR(load="",area=""),"",load*ctm_cf*1000/area)', decimals: 2 },
      { key: 'failure', label: 'Type of failure', input: true, options: ['Satisfactory', 'Unsatisfactory'] },
    ],
  }],
  results: [
    { key: 'avg', label: 'Average compressive strength', formula: 'IF(COUNT(cubes.fc)=0,"",AVERAGE(cubes.fc))', unit: 'N/mm²', decimals: 2 },
    { key: 'dev', label: 'Largest deviation from average', formula: 'IF(avg="","",MAX(ABS(MAX(cubes.fc)-avg),ABS(MIN(cubes.fc)-avg))/avg*100)', unit: '%', decimals: 1 },
    { key: 'pct', label: 'Strength as % of fck', formula: 'IF(OR(avg="",fck=""),"",avg/fck*100)', unit: '%', decimals: 0 },
    { key: 'dens', label: 'Average density', formula: 'IF(COUNT(cubes.dens)=0,"",AVERAGE(cubes.dens))', unit: 'kg/m³', decimals: 0 },
  ],
  checks: [
    { when: 'AND(dev<>"",dev>15)', level: 'warning', message: 'An individual result varies more than ±15% from the average: as per IS 456 cl. 15.4 the sample result is invalid.' },
    { when: 'COUNTIF(cubes.failure,"Unsatisfactory")>0', level: 'warning', message: 'Unsatisfactory failure pattern recorded: mention it in the report remarks.' },
  ],
  reportRows: [{ name: 'Compressive strength (average)', unit: 'N/mm²', result: 'avg', decimals: 2, specFormula: 'IF(fck="","--","fck = "&fck&" N/mm² ("&grade&", "&age&" days)")' }],
  reportTables: [{ title: 'Individual cube results', grid: 'cubes', skipBlank: 'fc', columns: [{ key: 'id', label: 'Cube ID' }, { key: 'mass', label: 'Mass (kg)', decimals: 3 }, { key: 'dens', label: 'Density (kg/m³)', decimals: 0 }, { key: 'load', label: 'Load (kN)', decimals: 1 }, { key: 'fc', label: 'Strength (N/mm²)', decimals: 2 }] }],
  references: [
    'IS 516 (Part 1/Sec 1) : 2021 – compressive strength of concrete cubes, loading at 14 N/mm² per minute.',
    'IS 456 : 2000 cl. 15.4 – the average of three specimens is the test result; individual variation must not exceed ±15% of the average. Acceptance per Table 11 is judged on groups of results.',
  ],
  procedure: [
    'Take the cubes out of the curing tank at the required age, wipe off surface water and grit, and test them in the damp condition.',
    'Measure the dimensions to 0.2 mm and weigh each cube.',
    'Place the cube with the cast faces at the sides (not top and bottom), centred on the lower platen. Do not use packing.',
    'Apply load without shock at 14 N/mm² per minute (about 315 kN/min for 150 mm cubes) until failure; record the maximum load and the failure pattern.',
    'Strength = load ÷ area of the loaded face. The average of three cubes is the result; check that no cube varies more than ±15% from the average.',
  ],
  sampleCalc: [
    'Cube {cubes.id#1}: {cubes.l#1:0} × {cubes.b#1:0} = {cubes.area#1:0} mm²; load {cubes.load#1:0} kN → {cubes.load#1:0} × 1000 ÷ {cubes.area#1:0} = {cubes.fc#1:2} N/mm².',
    'Density = {cubes.mass#1:3} kg ÷ ({cubes.l#1:0} × {cubes.b#1:0} × {cubes.h#1:0} mm³) = {cubes.dens#1:0} kg/m³.',
    'Average of three = {avg:2} N/mm²; largest deviation {dev:1} % (≤ 15 % OK); {pct:0} % of fck for {grade}.',
  ],
  example: {
    input: { header: { grade: 'M25', age: 28 }, grids: { cubes: [
      { id: 'C1', l: 150, b: 150, h: 150, mass: 8.45, load: 640, failure: 'Satisfactory' },
      { id: 'C2', l: 150, b: 150, h: 150, mass: 8.52, load: 655, failure: 'Satisfactory' },
      { id: 'C3', l: 150, b: 150, h: 150, mass: 8.40, load: 620, failure: 'Satisfactory' },
    ] } },
    expect: { 'cubes.fc#1': 28.44, avg: 28.37, 'cubes.dens#1': 2503.7, pct: 113.5 },
  },
};

export const FLEXURE: ObservationTemplate = {
  code: 'CON-FLEX', version: 1, material: 'Concrete', category: 'Concrete',
  name: 'Flexural strength of concrete beams',
  method: 'IS 516 (Part 1/Sec 1) : 2021',
  docControl: { docNo: 'OBS/CON/02', issueNo: '01', issueDate: '', amendmentNo: '0' },
  equipment: [{ key: 'ftm', label: 'Flexure testing machine', category: 'Flexure testing machine' }],
  headerFields: [{ key: 'grade', label: 'Grade of concrete', type: 'select', options: GRADES }, { key: 'age', label: 'Age at test', type: 'number', unit: 'days', default: 28 }],
  constants: [{ key: 'cf', label: 'Machine correction factor', fromEquipment: 'ftm.correction', value: 1 }],
  derived: [{ key: 'fck', label: 'fck', formula: fck, unit: 'N/mm²', decimals: 0 }, { key: 'fcr', label: 'IS 456 flexural strength 0.7 √fck', formula: 'IF(fck="","",0.7*SQRT(fck))', unit: 'N/mm²', decimals: 2 }],
  grids: [{
    key: 'bm', label: 'Beams (two-point loading)', rows: 3,
    columns: [
      { key: 'id', label: 'Beam ID', input: true, text: true },
      { key: 'b', label: 'Width (b)', unit: 'mm', input: true },
      { key: 'd', label: 'Depth (d)', unit: 'mm', input: true },
      { key: 'span', label: 'Span (l)', unit: 'mm', input: true },
      { key: 'p', label: 'Maximum load (P)', unit: 'kN', input: true },
      { key: 'a', label: 'Fracture distance from nearer support (a)', unit: 'mm', input: true },
      { key: 'lim', label: 'Limit for a', unit: 'mm', formula: 'IF(d="","",IF(d>=150,200,133))', decimals: 0 },
      { key: 'fb', label: 'Flexural strength', unit: 'N/mm²', formula: 'IF(OR(p="",b="",d="",span="",a=""),"",IF(a>lim,p*cf*1000*span/(b*d^2),IF(a>lim-30*d/150,3*p*cf*1000*a/(b*d^2),"Discard")))', decimals: 2 },
    ],
  }],
  results: [{ key: 'avg', label: 'Average flexural strength', formula: 'IF(COUNT(bm.fb)=0,"",AVERAGE(bm.fb))', unit: 'N/mm²', decimals: 2 }],
  checks: [{ when: 'COUNTIF(bm.fb,"Discard")>0', level: 'warning', message: 'Fracture too close to the support: discard that beam as per IS 516.' }],
  reportRows: [{ name: 'Flexural strength (average)', unit: 'N/mm²', result: 'avg', decimals: 2, specFormula: 'IF(fcr="","--","0.7 √fck = "&FIXED(fcr,2)&" (IS 456)")' }],
  reportTables: [{ title: 'Individual beam results', grid: 'bm', skipBlank: 'p', columns: [{ key: 'id', label: 'Beam' }, { key: 'p', label: 'Load (kN)', decimals: 1 }, { key: 'a', label: 'a (mm)', decimals: 0 }, { key: 'fb', label: 'Flexural strength (N/mm²)', decimals: 2 }] }],
  references: ['IS 516 (Part 1/Sec 1) : 2021 – flexural strength with third-point loading; fb = P l ÷ (b d²) when a > 200 mm (150 mm beams) or 133 mm (100 mm beams); fb = 3 P a ÷ (b d²) when a is slightly less (by up to 30 mm / 20 mm).'],
  procedure: ['Test beams wet, immediately after removal from curing water.', 'Set the beam on the rollers with the cast face to the side, span 600 mm (150 mm beams) or 400 mm (100 mm beams), with two loading points at the third points.', 'Load without shock at 0.07 N/mm² per second (about 400 kg/min for 150 mm beams) until failure; record the maximum load.', 'Measure a, the distance of the fracture line from the nearer support, along the tension face, and apply the formula that suits a.'],
  sampleCalc: ['Beam {bm.id#1}: P = {bm.p#1:1} kN, l = {bm.span#1:0} mm, b = d = {bm.b#1:0} mm, a = {bm.a#1:0} mm (> 200 mm).', 'fb = P l ÷ (b d²) = {bm.p#1:1} × 1000 × {bm.span#1:0} ÷ ({bm.b#1:0} × {bm.d#1:0}²) = {bm.fb#1:2} N/mm².'],
  example: { input: { header: { grade: 'M30' }, grids: { bm: [{ id: 'B1', b: 150, d: 150, span: 600, p: 26.5, a: 260 }] } }, expect: { 'bm.fb#1': 4.71 } },
};

export const SPLIT_TENSILE: ObservationTemplate = {
  code: 'CON-SPLIT', version: 1, material: 'Concrete', category: 'Concrete',
  name: 'Splitting tensile strength of concrete cylinders',
  method: 'IS 516 (Part 1/Sec 1) : 2021',
  docControl: { docNo: 'OBS/CON/03', issueNo: '01', issueDate: '', amendmentNo: '0' },
  equipment: [{ key: 'ctm', label: 'Compression testing machine', category: 'Compression testing machine' }],
  headerFields: [{ key: 'grade', label: 'Grade of concrete', type: 'select', options: GRADES }, { key: 'age', label: 'Age at test', type: 'number', unit: 'days', default: 28 }],
  constants: [{ key: 'cf', label: 'CTM correction factor', fromEquipment: 'ctm.correction', value: 1 }],
  derived: [],
  grids: [{ key: 'cy', label: 'Cylinders', rows: 3, columns: [
    { key: 'id', label: 'ID', input: true, text: true },
    { key: 'd', label: 'Diameter', unit: 'mm', input: true },
    { key: 'l', label: 'Length', unit: 'mm', input: true },
    { key: 'p', label: 'Maximum load', unit: 'kN', input: true },
    { key: 'fct', label: 'Splitting tensile strength', unit: 'N/mm²', formula: 'IF(OR(p="",d="",l=""),"",2*p*cf*1000/(PI()*l*d))', decimals: 2 },
  ] }],
  results: [{ key: 'avg', label: 'Average splitting tensile strength', formula: 'IF(COUNT(cy.fct)=0,"",AVERAGE(cy.fct))', unit: 'N/mm²', decimals: 2 }],
  checks: [],
  reportRows: [{ name: 'Splitting tensile strength (average)', unit: 'N/mm²', result: 'avg', decimals: 2, spec: '--' }],
  references: ['IS 516 (Part 1/Sec 1) : 2021 – fct = 2P ÷ (π l d).'],
  procedure: ['Mark diametral lines on both ends of the cylinder so that they lie in the same axial plane.', 'Place packing strips of plywood along the top and bottom lines and centre the cylinder in the machine.', 'Load continuously at 1.2 to 2.4 N/mm² per minute until failure; record the maximum load.', 'Splitting tensile strength = 2P ÷ (π l d).'],
  sampleCalc: ['fct = 2 × {cy.p#1:0} × 1000 ÷ (π × {cy.l#1:0} × {cy.d#1:0}) = {cy.fct#1:2} N/mm².'],
  example: { input: { header: {}, grids: { cy: [{ id: 'S1', d: 150, l: 300, p: 235 }] } }, expect: { 'cy.fct#1': 3.32 } },
};

export const CONCRETE_TEMPLATES: ObservationTemplate[] = [CUBE_COMPRESSION_V2, FLEXURE, SPLIT_TENSILE];
