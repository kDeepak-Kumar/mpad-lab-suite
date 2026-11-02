import type { ObservationTemplate } from '../observation';

/**
 * Non-destructive testing of concrete.
 * Rebound hammer: IS 516 (Part 5/Sec 4) : 2020 (earlier IS 13311 Part 2).
 * Ultrasonic pulse velocity: IS 516 (Part 5/Sec 1) : 2018 (earlier IS 13311 Part 1).
 * Cores: IS 516 (Part 4) : 2018 with acceptance as per IS 456 : 2000 cl. 17.4.
 */

/**
 * Cube compressive strength (N/mm², concrete aged 14–56 days) against rebound number,
 * digitised from the Aimil (Schmidt type N) calibration chart supplied by the lab and rounded to 0.5 N/mm².
 * Position A = horizontal impact, B = vertically upward, C = vertically downward.
 * The lab should check these values against its own hammer's chart before NABL use.
 */
export const RH_CURVES = {
  a_r: [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55],
  a_s: [11.0, 12.5, 14.5, 16.0, 17.5, 19.0, 21.0, 22.5, 24.0, 26.0, 27.5, 29.0, 31.0, 32.5, 34.0, 36.0, 37.5, 39.0, 40.5, 42.5, 44.0, 45.5, 47.5, 49.0, 50.5, 52.0, 54.0, 55.5, 57.0, 58.5, 60.5, 62.0, 63.5, 65.0, 66.5],
  b_r: [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54],
  b_s: [14.0, 15.5, 17.0, 19.0, 20.5, 22.0, 23.5, 25.0, 27.0, 28.5, 30.0, 31.5, 33.0, 34.5, 36.0, 37.5, 39.0, 41.0, 42.5, 44.0, 45.5, 47.0, 48.5, 50.0, 52.0, 53.5, 55.0, 57.0, 58.5, 60.5, 62.0, 64.0, 65.5, 67.5, 69.5],
  c_r: [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55],
  c_s: [11.0, 12.5, 14.5, 16.0, 18.0, 19.5, 21.0, 23.0, 24.5, 26.0, 28.0, 29.5, 31.0, 32.5, 34.0, 36.0, 37.5, 39.0, 41.0, 42.5, 44.0, 46.0, 47.5, 49.5, 51.5, 53.0, 55.0, 57.0, 59.0, 61.0],
};

const DIRS = ['A - Horizontal', 'B - Vertically upward', 'C - Vertically downward'];
const R = Array.from({ length: 12 }, (_, i) => `r${i + 1}`);
const within = (r: string) => `AND(${r}<>"",ABS(${r}-med)<=dev)`;

export const REBOUND_HAMMER: ObservationTemplate = {
  code: 'NDT-RH', version: 1, material: 'Concrete', category: 'NDT',
  name: 'Rebound hammer test on hardened concrete',
  method: 'IS 516 (Part 5/Sec 4) : 2020',
  docControl: { docNo: 'OBS/NDT/01', issueNo: '01', issueDate: '', amendmentNo: '0' },
  equipment: [{ key: 'hammer', label: 'Rebound hammer', category: 'Rebound hammer' }],
  headerFields: [
    { key: 'structure', label: 'Structure / building', type: 'text' },
    { key: 'grade', label: 'Specified grade of concrete', type: 'select', options: ['M15', 'M20', 'M25', 'M30', 'M35', 'M40', 'M45', 'M50', 'Not known'] },
    { key: 'age', label: 'Approximate age of concrete', type: 'text' },
    { key: 'surface', label: 'Surface condition', type: 'select', options: ['Smooth, dry', 'Plastered (removed)', 'Rubbed with carborundum stone', 'Wet'] },
  ],
  constants: [
    { key: 'anvil', label: 'Average rebound on test anvil', fromEquipment: 'hammer.anvil_avg', note: 'Leave blank if not checked; no correction is then applied' },
    { key: 'anvil_nom', label: 'Nominal anvil rebound', fromEquipment: 'hammer.anvil_nominal', value: 80 },
    { key: 'dev', label: 'Reject readings differing from the median by more than', unit: 'units', value: 6 },
    { key: 'maxrej', label: 'Retest the location if rejected readings exceed', unit: '%', value: 20 },
  ],
  derived: [{ key: 'cf', label: 'Anvil correction factor', formula: 'IF(OR(anvil="",anvil_nom=""),1,anvil_nom/anvil)', decimals: 3 }],
  tables: { rh: RH_CURVES },
  grids: [{
    key: 'loc', label: 'Rebound numbers at each test location (10 to 12 impacts, at least 20 mm apart)', rows: 6,
    columns: [
      { key: 'member', label: 'Member / location', input: true, text: true, width: 18 },
      { key: 'dir', label: 'Direction', input: true, options: DIRS, width: 19 },
      ...R.map((r, i) => ({ key: r, label: `R${i + 1}`, input: true })),
      { key: 'n', label: 'Readings', formula: `IF(COUNT(${R.join(',')})=0,"",COUNT(${R.join(',')}))`, decimals: 0 },
      { key: 'med', label: 'Median', formula: `IF(n="","",MEDIAN(${R.join(',')}))`, decimals: 1 },
      { key: 'nv', label: 'Valid', formula: `IF(n="","",SUM(${R.map((r) => `IF(${within(r)},1,0)`).join(',')}))`, decimals: 0 },
      { key: 'avg', label: 'Mean of valid', formula: `IF(OR(n="",nv=0),"",SUM(${R.map((r) => `IF(${within(r)},${r},0)`).join(',')})/nv*cf)`, decimals: 1 },
      { key: 'rn', label: 'Rebound number', formula: 'IF(avg="","",ROUND(avg,0))', decimals: 0 },
      { key: 'raw', label: 'Strength from chart', unit: 'N/mm²', formula: 'IF(OR(rn="",dir=""),"",IFERROR(IF(LEFT(dir,1)="A",INTERP(rn,rh.a_r,rh.a_s),IF(LEFT(dir,1)="B",INTERP(rn,rh.b_r,rh.b_s),INTERP(rn,rh.c_r,rh.c_s))),""))', decimals: 2 },
      { key: 'fc', label: 'Estimated strength', unit: 'N/mm²', formula: 'IF(OR(rn="",dir=""),"",IF(raw="",IF(rn<30,"< 10","> 70"),MROUND(raw,0.5)))', decimals: 1 },
      { key: 'rej', label: 'Rejected', unit: '%', formula: 'IF(n="","",(n-nv)/n*100)', decimals: 0 },
    ],
  }],
  results: [
    { key: 'locations', label: 'Locations tested', formula: 'COUNT(loc.rn)', decimals: 0 },
    { key: 'rn_avg', label: 'Average rebound number', formula: 'IF(COUNT(loc.rn)=0,"",AVERAGE(loc.rn))', decimals: 0 },
    { key: 'fc_avg', label: 'Average estimated strength', formula: 'IF(COUNT(loc.fc)=0,"",MROUND(AVERAGE(loc.fc),0.5))', unit: 'N/mm²', decimals: 1 },
    { key: 'fc_min', label: 'Lowest estimated strength', formula: 'IF(COUNT(loc.fc)=0,"",MIN(loc.fc))', unit: 'N/mm²', decimals: 1 },
    { key: 'fc_max', label: 'Highest estimated strength', formula: 'IF(COUNT(loc.fc)=0,"",MAX(loc.fc))', unit: 'N/mm²', decimals: 1 },
  ],
  checks: [
    { when: 'COUNTIF(loc.rej,">"&maxrej)>0', level: 'warning', message: 'At one or more locations too many readings differ from the median by more than the limit: discard that set and retest nearby.' },
    { when: 'COUNTIF(loc.n,"<9")>0', level: 'warning', message: 'Fewer than 9 readings at a location: IS 516 (Part 5/Sec 4) needs at least 9 valid impacts per test area.' },
    { when: 'COUNTIF(loc.fc,"=< 10")+COUNTIF(loc.fc,"=> 70")>0', level: 'warning', message: 'A rebound number lies outside the calibration chart (10–70 N/mm²): report it as below/above the chart range.' },
    { when: 'AND(anvil<>"",ABS(cf-1)>0.05)', level: 'warning', message: 'Hammer reads more than 5% away from its anvil value: service or re-calibrate the hammer before use.' },
  ],
  reportRows: [
    { name: 'Average rebound number', unit: '--', result: 'rn_avg', decimals: 0 },
    { name: 'Average estimated compressive strength', unit: 'N/mm²', result: 'fc_avg', decimals: 1, specFormula: 'IF(OR(grade="",grade="Not known"),"--","Specified "&grade)' },
  ],
  reportTables: [{
    title: 'Rebound hammer test results', grid: 'loc', skipBlank: 'rn',
    columns: [{ key: 'member', label: 'Member / location' }, { key: 'dir', label: 'Direction of impact' }, { key: 'rn', label: 'Rebound number', decimals: 0 }, { key: 'fc', label: 'Estimated compressive strength (N/mm²)', decimals: 1 }],
  }],
  instructions: 'Enter 10–12 rebound readings per location and choose the direction of impact. Readings more than 6 units from the median are rejected automatically; strength is read from the hammer’s chart and rounded to 0.5 N/mm².',
  references: [
    'IS 516 (Part 5/Sec 4) : 2020 – Rebound hammer test (earlier IS 13311 Part 2 : 1992).',
    'Calibration chart: Aimil/Schmidt type N, cube strength for concrete aged 14–56 days. A = horizontal, B = vertically upward, C = vertically downward.',
    'The estimated strength is indicative only; confirm with cores (IS 516 Part 4) and combine with UPV where acceptance decisions are needed.',
  ],
  procedure: [
    'Check the hammer on the test anvil before and after the day’s work and record the average rebound; it should be close to the manufacturer’s value (≈ 80 for type N).',
    'Select test areas of about 300 × 300 mm, free of honeycombing, plaster, scaling and visible moisture. Grind the surface smooth with the abrasive stone if needed.',
    'Mark a grid so that impact points are at least 20 mm apart and at least 20 mm (preferably 50 mm) from edges and from visible reinforcement.',
    'Hold the hammer perpendicular to the surface. Note the direction of impact: horizontal (A), upward on soffits (B) or downward on slab tops (C).',
    'Press the plunger slowly until the hammer fires, then read and record the rebound number. Take 10 to 12 impacts per location, never on the same point twice.',
    'Reject readings that differ from the median by more than 6 units. If more than 20% of the readings are rejected, discard the whole set and retest nearby.',
    'Take the mean of the valid readings as the rebound number and read the cube strength from the hammer’s chart for that direction of impact.',
    'Report the rebound number and the estimated strength (rounded to 0.5 N/mm²) for every location, with the age and surface condition of the concrete.',
  ],
  sampleCalc: [
    'Location {loc.member#1}, direction A (horizontal). Readings: 32, 34, 30, 33, 35, 31, 33, 34, 32, 45.',
    'Median of the 10 readings = {loc.med#1:1}. The reading 45 differs from the median by 12 (> 6), so it is rejected; {loc.nv#1:0} readings remain.',
    'Mean of valid readings = (32+34+30+33+35+31+33+34+32) / 9 = {loc.avg#1:1} → rebound number R = {loc.rn#1:0}.',
    'From the chart, position A at R = {loc.rn#1:0} gives {loc.raw#1:1} N/mm². Rounded to the nearest 0.5: {loc.fc#1:1} N/mm².',
    'Location {loc.member#2} (soffit, direction B) has R = {loc.rn#2:0}, giving {loc.fc#2:1} N/mm²: the same rebound reads higher strength when the hammer points upward.',
  ],
  example: {
    input: {
      header: { structure: 'Block A', grade: 'M25' },
      grids: { loc: [
        { member: 'Column C1, ground floor', dir: 'A - Horizontal', r1: 32, r2: 34, r3: 30, r4: 33, r5: 35, r6: 31, r7: 33, r8: 34, r9: 32, r10: 45 },
        { member: 'Beam B2 soffit', dir: 'B - Vertically upward', r1: 30, r2: 31, r3: 29, r4: 32, r5: 30, r6: 31, r7: 30, r8: 29, r9: 31, r10: 30 },
      ] },
    },
    expect: { 'loc.med#1': 33, 'loc.nv#1': 9, 'loc.rn#1': 33, 'loc.fc#1': 31, 'loc.rn#2': 30, 'loc.fc#2': 30, rn_avg: 31.5, fc_avg: 30.5 },
  },
};

export const UPV: ObservationTemplate = {
  code: 'NDT-UPV', version: 1, material: 'Concrete', category: 'NDT',
  name: 'Ultrasonic pulse velocity test on concrete',
  method: 'IS 516 (Part 5/Sec 1) : 2018',
  docControl: { docNo: 'OBS/NDT/02', issueNo: '01', issueDate: '', amendmentNo: '0' },
  equipment: [{ key: 'upv', label: 'UPV tester', category: 'Ultrasonic pulse velocity tester' }],
  headerFields: [
    { key: 'structure', label: 'Structure / building', type: 'text' },
    { key: 'grade', label: 'Specified grade of concrete', type: 'select', options: ['M15', 'M20', 'M25', 'M30', 'M35', 'M40', 'M45', 'M50', 'Not known'] },
    { key: 'freq', label: 'Transducer frequency', type: 'number', unit: 'kHz', default: 54 },
    { key: 'couplant', label: 'Couplant', type: 'select', options: ['Grease', 'Petroleum jelly', 'Liquid soap', 'Kaolin paste'] },
  ],
  constants: [
    { key: 'g_exc', label: 'Excellent above', unit: 'km/s', value: 4.4, note: 'IS 516 (Part 5/Sec 1) Table 2, cross probing' },
    { key: 'g_good', label: 'Good from', unit: 'km/s', value: 3.75 },
    { key: 'g_doubt', label: 'Doubtful from', unit: 'km/s', value: 3.0 },
  ],
  derived: [],
  grids: [{
    key: 'pts', label: 'Pulse transit time at each location', rows: 8,
    columns: [
      { key: 'member', label: 'Member / location', input: true, text: true },
      { key: 'mode', label: 'Transmission', input: true, options: ['Direct', 'Semi-direct', 'Indirect'] },
      { key: 'l', label: 'Path length', unit: 'mm', input: true },
      { key: 't', label: 'Transit time', unit: 'µs', input: true },
      { key: 'v', label: 'Pulse velocity', unit: 'km/s', formula: 'IF(OR(l="",t=""),"",l/t)', decimals: 2 },
      { key: 'grade_q', label: 'Concrete quality', formula: 'IF(v="","",IF(v>g_exc,"Excellent",IF(v>=g_good,"Good",IF(v>=g_doubt,"Doubtful","Poor"))))' },
    ],
  }],
  results: [
    { key: 'v_avg', label: 'Average pulse velocity', formula: 'IF(COUNT(pts.v)=0,"",AVERAGE(pts.v))', unit: 'km/s', decimals: 2 },
    { key: 'v_min', label: 'Lowest pulse velocity', formula: 'IF(COUNT(pts.v)=0,"",MIN(pts.v))', unit: 'km/s', decimals: 2 },
    { key: 'quality', label: 'Overall quality (average)', formula: 'IF(v_avg="","",IF(v_avg>g_exc,"Excellent",IF(v_avg>=g_good,"Good",IF(v_avg>=g_doubt,"Doubtful","Poor"))))' },
  ],
  checks: [
    { when: 'COUNTIF(pts.mode,"Indirect")>0', level: 'warning', message: 'Indirect (surface) readings give lower velocities; do not grade them with the direct-transmission table without a correction.' },
    { when: 'COUNTIF(pts.grade_q,"Poor")+COUNTIF(pts.grade_q,"Doubtful")>0', level: 'warning', message: 'Some locations are Doubtful/Poor: consider cores or further investigation at those points.' },
  ],
  reportRows: [
    { name: 'Average pulse velocity', unit: 'km/s', result: 'v_avg', decimals: 2 },
    { name: 'Concrete quality grading', unit: '--', result: 'quality', spec: 'IS 516 (Part 5/Sec 1) grading' },
  ],
  reportTables: [{ title: 'Ultrasonic pulse velocity results', grid: 'pts', skipBlank: 'v', columns: [{ key: 'member', label: 'Member / location' }, { key: 'mode', label: 'Transmission' }, { key: 'l', label: 'Path length (mm)', decimals: 0 }, { key: 't', label: 'Transit time (µs)', decimals: 1 }, { key: 'v', label: 'Velocity (km/s)', decimals: 2 }, { key: 'grade_q', label: 'Quality' }] }],
  references: ['IS 516 (Part 5/Sec 1) : 2018 – Ultrasonic pulse velocity (earlier IS 13311 Part 1 : 1992).', 'Quality grading for direct (cross) probing: Excellent above 4.4, Good 3.75–4.4, Doubtful 3.0–3.75, Poor below 3.0 km/s. Grading limits can be edited above if the lab follows a different table.'],
  procedure: [
    'Switch on the instrument and set zero using the calibration rod supplied; the displayed time must match the value marked on the rod.',
    'Select test points on a grid; for columns and beams use direct transmission across opposite faces wherever possible.',
    'Clean the surface and apply a thin layer of couplant so that the transducers have full contact without air gaps.',
    'Measure the path length between transducer centres to the nearest 1 mm (member thickness for direct transmission).',
    'Press the transducers firmly and record the minimum stable transit time in microseconds. Repeat at each point.',
    'Keep the pulse path away from reinforcement running parallel to it, and note the mode of transmission used.',
    'Velocity (km/s) = path length (mm) ÷ transit time (µs). Grade each location from the velocity table.',
  ],
  sampleCalc: [
    'Column C1, direct transmission: path length {pts.l#1:0} mm, transit time {pts.t#1:1} µs.',
    'Velocity = {pts.l#1:0} ÷ {pts.t#1:1} = {pts.v#1:2} km/s → between 3.75 and 4.4, so the concrete quality is {pts.grade_q#1}.',
  ],
  example: { input: { header: {}, grids: { pts: [{ member: 'Column C1', mode: 'Direct', l: 300, t: 68.5 }] } }, expect: { 'pts.v#1': 4.38, 'pts.grade_q#1': 'Good', quality: 'Good' } },
};

export const CORE: ObservationTemplate = {
  code: 'NDT-CORE', version: 1, material: 'Concrete', category: 'NDT',
  name: 'Compressive strength of concrete cores',
  method: 'IS 516 (Part 4) : 2018',
  docControl: { docNo: 'OBS/NDT/03', issueNo: '01', issueDate: '', amendmentNo: '0' },
  equipment: [{ key: 'ctm', label: 'Compression testing machine', category: 'Compression testing machine' }],
  headerFields: [
    { key: 'grade', label: 'Specified grade of concrete', type: 'select', options: ['M15', 'M20', 'M25', 'M30', 'M35', 'M40', 'M45', 'M50'], required: true },
    { key: 'condition', label: 'Condition at test', type: 'select', options: ['Soaked 48 h (wet)', 'Air dry'] },
  ],
  constants: [{ key: 'ctm_cf', label: 'CTM correction factor', fromEquipment: 'ctm.correction', value: 1 }],
  derived: [{ key: 'fck', label: 'Characteristic strength', formula: 'IFERROR(IF(grade="","",RIGHT(grade,LEN(grade)-1)*1),"")', unit: 'N/mm²', decimals: 0 }],
  grids: [{
    key: 'cores', label: 'Cores', rows: 3,
    columns: [
      { key: 'id', label: 'Core ID / location', input: true, text: true },
      { key: 'd', label: 'Diameter', unit: 'mm', input: true },
      { key: 'l', label: 'Length after capping', unit: 'mm', input: true },
      { key: 'p', label: 'Failure load', unit: 'kN', input: true },
      { key: 'ld', label: 'L/D', formula: 'IF(OR(l="",d=""),"",l/d)', decimals: 2 },
      { key: 'f', label: 'L/D correction', formula: 'IF(ld="","",IF(ld>=2,1,0.11*ld+0.78))', decimals: 3 },
      { key: 'area', label: 'Area', unit: 'mm²', formula: 'IF(d="","",PI()*d^2/4)', decimals: 0 },
      { key: 'fcyl', label: 'Cylinder strength', unit: 'N/mm²', formula: 'IF(OR(p="",area=""),"",p*ctm_cf*1000/area)', decimals: 2 },
      { key: 'fcorr', label: 'Corrected (L/D = 2)', unit: 'N/mm²', formula: 'IF(fcyl="","",fcyl*f)', decimals: 2 },
      { key: 'fcube', label: 'Equivalent cube strength', unit: 'N/mm²', formula: 'IF(fcorr="","",fcorr*1.25)', decimals: 1 },
    ],
  }],
  results: [
    { key: 'avg', label: 'Average equivalent cube strength', formula: 'IF(COUNT(cores.fcube)=0,"",AVERAGE(cores.fcube))', unit: 'N/mm²', decimals: 1 },
    { key: 'minv', label: 'Lowest equivalent cube strength', formula: 'IF(COUNT(cores.fcube)=0,"",MIN(cores.fcube))', unit: 'N/mm²', decimals: 1 },
    { key: 'verdict', label: 'IS 456 cl. 17.4.3', formula: 'IF(OR(avg="",fck=""),"",IF(AND(avg>=0.85*fck,minv>=0.75*fck),"Acceptable","Not acceptable"))' },
  ],
  checks: [{ when: 'COUNTIF(cores.ld,"<1")>0', level: 'error', message: 'Core length/diameter ratio is below 1: the core is not valid for testing.' }],
  reportRows: [
    { name: 'Average equivalent cube strength', unit: 'N/mm²', result: 'avg', decimals: 1, specFormula: 'IF(fck="","","≥ "&FIXED(0.85*fck,2)&" (0.85 fck)")' },
    { name: 'Lowest individual equivalent cube strength', unit: 'N/mm²', result: 'minv', decimals: 1, specFormula: 'IF(fck="","","≥ "&FIXED(0.75*fck,2)&" (0.75 fck)")' },
  ],
  reportTables: [{ title: 'Core test results', grid: 'cores', skipBlank: 'p', columns: [{ key: 'id', label: 'Core' }, { key: 'd', label: 'Dia (mm)', decimals: 0 }, { key: 'ld', label: 'L/D', decimals: 2 }, { key: 'fcyl', label: 'Cylinder strength (N/mm²)', decimals: 2 }, { key: 'fcube', label: 'Equivalent cube strength (N/mm²)', decimals: 1 }] }],
  references: ['IS 516 (Part 4) : 2018 – Sampling, preparing and testing of concrete cores.', 'L/D correction F = 0.11 (L/D) + 0.78 for L/D between 1 and 2; equivalent cube strength = 1.25 × corrected cylinder strength.', 'IS 456 : 2000 cl. 17.4.3 – average of cores ≥ 0.85 fck and no individual core below 0.75 fck.'],
  procedure: [
    'Drill cores perpendicular to the surface with a diamond bit, avoiding reinforcement. Diameter should be at least 3 times the maximum aggregate size (preferably 100 or 150 mm).',
    'Trim the ends square and cap them so that the length after capping is between 1 and 2 times the diameter (2 preferred).',
    'Measure the diameter (mean of two perpendicular measurements) and the length after capping.',
    'Soak the cores in water for 48 hours at 27 ± 2 °C, unless the client asks for air-dry testing, and test them wet.',
    'Load at a uniform rate of about 14 N/mm² per minute until failure and record the maximum load.',
    'Cylinder strength = load ÷ area. Correct to L/D = 2 with F = 0.11 L/D + 0.78, and multiply by 1.25 for equivalent cube strength.',
  ],
  sampleCalc: [
    'Core {cores.id#1}: diameter {cores.d#1:0} mm, length {cores.l#1:0} mm → L/D = {cores.ld#1:2}, correction F = 0.11 × {cores.ld#1:2} + 0.78 = {cores.f#1:3}.',
    'Area = π × {cores.d#1:0}² ÷ 4 = {cores.area#1:0} mm². Cylinder strength = {cores.p#1:0} × 1000 ÷ {cores.area#1:0} = {cores.fcyl#1:2} N/mm².',
    'Corrected = {cores.fcyl#1:2} × {cores.f#1:3} = {cores.fcorr#1:2}; equivalent cube = 1.25 × {cores.fcorr#1:2} = {cores.fcube#1:1} N/mm².',
  ],
  example: { input: { header: { grade: 'M25' }, grids: { cores: [{ id: 'C1', d: 94, l: 150, p: 210 }] } }, expect: { 'cores.ld#1': 1.596, 'cores.fcube#1': 36.14, verdict: 'Acceptable' } },
};

export const COVER_METER: ObservationTemplate = {
  code: 'NDT-COVER', version: 1, material: 'Concrete', category: 'NDT',
  name: 'Concrete cover to reinforcement (cover meter)',
  method: 'IS 516 (Part 5/Sec 3) : 2021',
  equipment: [{ key: 'cm', label: 'Cover meter', category: 'Cover meter' }],
  headerFields: [{ key: 'structure', label: 'Structure / building', type: 'text' }],
  constants: [], derived: [],
  grids: [{
    key: 'pts', label: 'Cover readings', rows: 8,
    columns: [
      { key: 'member', label: 'Member / location', input: true, text: true },
      { key: 'req', label: 'Specified nominal cover', unit: 'mm', input: true },
      { key: 'dia', label: 'Bar diameter', unit: 'mm', input: true },
      { key: 'c1', label: 'Cover 1', unit: 'mm', input: true }, { key: 'c2', label: 'Cover 2', unit: 'mm', input: true }, { key: 'c3', label: 'Cover 3', unit: 'mm', input: true },
      { key: 'avg', label: 'Average cover', unit: 'mm', formula: 'IF(COUNT(c1,c2,c3)=0,"",AVERAGE(c1,c2,c3))', decimals: 0 },
      { key: 'ok', label: 'Meets specified', formula: 'IF(OR(avg="",req=""),"",IF(avg>=req-5,"Yes","No"))' },
    ],
  }],
  results: [{ key: 'avg_all', label: 'Average cover', formula: 'IF(COUNT(pts.avg)=0,"",AVERAGE(pts.avg))', unit: 'mm', decimals: 0 }],
  checks: [{ when: 'COUNTIF(pts.ok,"No")>0', level: 'warning', message: 'Cover is less than specified (allowing −5 mm tolerance as per IS 456 cl. 26.4.2) at some locations.' }],
  reportRows: [{ name: 'Average concrete cover', unit: 'mm', result: 'avg_all', decimals: 0 }],
  reportTables: [{ title: 'Cover meter results', grid: 'pts', skipBlank: 'avg', columns: [{ key: 'member', label: 'Member / location' }, { key: 'dia', label: 'Bar dia (mm)', decimals: 0 }, { key: 'req', label: 'Specified cover (mm)', decimals: 0 }, { key: 'avg', label: 'Measured cover (mm)', decimals: 0 }, { key: 'ok', label: 'Meets specified' }] }],
  procedure: ['Calibrate the cover meter on a known block before use and set the bar diameter.', 'Scan to locate the bars, mark their lines, then take readings midway between crossing bars.', 'Record three readings per location; average them and compare with the specified nominal cover (tolerance +10/−0 mm as per IS 456, −5 mm allowed here for measurement).'],
  references: ['IS 456 : 2000 cl. 26.4 – nominal cover and tolerances.'],
};

export const NDT_TEMPLATES = [REBOUND_HAMMER, UPV, CORE, COVER_METER];
