import type { ObservationTemplate } from '../observation';

/**
 * Cement: IS 4031 test methods; requirements from IS 269 : 2015 (OPC 33/43/53),
 * IS 1489 (Part 1) : 2015 (PPC) and IS 455 : 2015 (PSC).
 */

const TYPES = ['OPC 33', 'OPC 43', 'OPC 53', 'PPC', 'PSC'];
const CEM = {
  type: TYPES,
  spec: ['IS 269 : 2015', 'IS 269 : 2015', 'IS 269 : 2015', 'IS 1489 (Part 1) : 2015', 'IS 455 : 2015'],
  blaine: [225, 225, 225, 300, 225],
  s3: [16, 23, 27, 16, 16], s7: [22, 33, 37, 22, 22], s28: [33, 43, 53, 33, 33], s28max: [48, 58, '', '', ''],
};
const typeField = { key: 'ctype', label: 'Type / grade of cement', type: 'select' as const, options: TYPES, required: true, default: 'OPC 53' };
const look = (col: string) => `IFERROR(LOOKUPX(ctype,cem.type,cem.${col}),"")`;
const doc = (n: number) => ({ docNo: `OBS/CEM/0${n}`, issueNo: '01', issueDate: '', amendmentNo: '0' });
const env = [{ key: 'temp', label: 'Room temperature', type: 'number' as const, unit: '°C', help: '27 ± 2 °C' }, { key: 'rh', label: 'Relative humidity', type: 'number' as const, unit: '%', help: 'Not less than 65%' }];

export const CEM_CONSISTENCY: ObservationTemplate = {
  code: 'CEM-NC', version: 1, material: 'Cement', category: 'Cement',
  name: 'Standard consistency of cement',
  method: 'IS 4031 (Part 4) : 1988 (RA 2019)',
  docControl: doc(1),
  equipment: [{ key: 'vicat', label: 'Vicat apparatus', category: 'Vicat apparatus' }],
  headerFields: [typeField, ...env],
  constants: [{ key: 'mass', label: 'Mass of cement', unit: 'g', value: 400 }],
  derived: [],
  grids: [{
    key: 't', label: 'Trials (plunger penetration measured from the bottom of the mould)', rows: 5,
    columns: [
      { key: 'water', label: 'Water added', unit: 'ml', input: true },
      { key: 'read', label: 'Plunger reading from bottom', unit: 'mm', input: true },
      { key: 'pct', label: 'Water', unit: '%', formula: 'IF(water="","",water/mass*100)', decimals: 2 },
      { key: 'okp', label: 'Within 5–7 mm', unit: '%', formula: 'IF(OR(read="",pct=""),"",IF(AND(read>=5,read<=7),pct,""))', decimals: 2 },
    ],
  }],
  results: [{ key: 'p', label: 'Standard consistency (P)', formula: 'IF(COUNT(t.okp)=0,"",ROUND(AVERAGE(t.okp)*4,0)/4)', unit: '%', decimals: 2 }],
  checks: [{ when: 'AND(COUNT(t.pct)>0,COUNT(t.okp)=0)', level: 'warning', message: 'No trial gave a plunger reading of 5–7 mm from the bottom yet: adjust the water and repeat.' }],
  reportRows: [{ name: 'Standard consistency', unit: '%', result: 'p', decimals: 2, spec: '--' }],
  references: ['IS 4031 (Part 4) : 1988 – consistency is the water content at which the Vicat plunger penetrates to 5–7 mm from the bottom of the mould.'],
  procedure: [
    'Condition the room at 27 ± 2 °C and at least 65% relative humidity.',
    'Weigh 400 g of cement, add a measured quantity of potable water and gauge for 3 to 5 minutes (time from adding water to filling the mould).',
    'Fill the Vicat mould resting on a non-porous plate, smooth the surface level with the top and shake slightly to expel air.',
    'Lower the 10 mm plunger gently to touch the surface and release it quickly. Note the reading from the bottom of the mould.',
    'Repeat with fresh paste and different water contents until the plunger stops 5 to 7 mm from the bottom.',
    'Standard consistency P = water ÷ mass of cement × 100 for that trial.',
  ],
  sampleCalc: ['Trial 3: {t.water#3:0} ml water, plunger stopped {t.read#3:0} mm from the bottom (within 5–7 mm).', 'P = {t.water#3:0} ÷ {mass:0} × 100 = {t.pct#3:2} % → standard consistency {p:2} %.'],
  example: { input: { header: { ctype: 'OPC 53' }, grids: { t: [{ water: 104, read: 15 }, { water: 112, read: 9 }, { water: 118, read: 6 }] } }, expect: { 't.pct#3': 29.5, p: 29.5 } },
};

export const CEM_SETTING: ObservationTemplate = {
  code: 'CEM-SET', version: 1, material: 'Cement', category: 'Cement',
  name: 'Initial and final setting time of cement',
  method: 'IS 4031 (Part 5) : 1988 (RA 2019)',
  docControl: doc(2),
  equipment: [{ key: 'vicat', label: 'Vicat apparatus', category: 'Vicat apparatus' }],
  headerFields: [
    typeField,
    { key: 'p', label: 'Standard consistency (P)', type: 'number', unit: '%', required: true },
    { key: 't0', label: 'Time water added', type: 'text', help: '24-hour clock, e.g. 10:05' },
    { key: 'ti', label: 'Time needle stops 5 ± 0.5 mm from bottom', type: 'text' },
    { key: 'tf', label: 'Time annular collar fails to mark', type: 'text' },
    ...env,
  ],
  constants: [{ key: 'mass', label: 'Mass of cement', unit: 'g', value: 400 }, { key: 'imin', label: 'Initial setting – minimum', unit: 'min', value: 30 }, { key: 'fmax', label: 'Final setting – maximum', unit: 'min', value: 600 }],
  derived: [{ key: 'water', label: 'Water to add (0.85 P)', formula: 'IF(p="","",0.85*p/100*mass)', unit: 'ml', decimals: 1 }],
  grids: [{
    key: 'obs', label: 'Penetration record (optional)', rows: 8,
    columns: [
      { key: 'time', label: 'Time', input: true, text: true },
      { key: 'read', label: 'Needle reading from bottom', unit: 'mm', input: true },
      { key: 'elapsed', label: 'Elapsed', unit: 'min', formula: 'IF(OR(time="",t0=""),"",IFERROR(MOD(MINUTES(time)-MINUTES(t0),1440),""))', decimals: 0 },
    ],
  }],
  results: [
    { key: 'ist', label: 'Initial setting time', formula: 'IF(OR(t0="",ti=""),"",IFERROR(MOD(MINUTES(ti)-MINUTES(t0),1440),""))', unit: 'min', decimals: 0 },
    { key: 'fst', label: 'Final setting time', formula: 'IF(OR(t0="",tf=""),"",IFERROR(MOD(MINUTES(tf)-MINUTES(t0),1440),""))', unit: 'min', decimals: 0 },
  ],
  checks: [
    { when: 'AND(t0<>"",ISERROR(MINUTES(t0)))', level: 'error', message: 'Enter times as HH:MM (24-hour), e.g. 10:05.' },
    { when: 'AND(ist<>"",ist<imin)', level: 'warning', message: 'Initial setting time is less than the specified minimum.' },
    { when: 'AND(fst<>"",fst>fmax)', level: 'warning', message: 'Final setting time is more than the specified maximum.' },
    { when: 'AND(ist<>"",fst<>"",fst<=ist)', level: 'error', message: 'Final setting time must be later than the initial setting time.' },
  ],
  reportRows: [
    { group: 'Setting time', name: 'Initial', unit: 'min', result: 'ist', decimals: 0, specFormula: '"Min "&FIXED(imin,0)' },
    { group: 'Setting time', name: 'Final', unit: 'min', result: 'fst', decimals: 0, specFormula: '"Max "&FIXED(fmax,0)' },
  ],
  references: ['IS 4031 (Part 5) : 1988.', 'IS 269 / IS 1489 / IS 455 : initial not less than 30 minutes, final not more than 600 minutes.'],
  procedure: [
    'Gauge 400 g of cement with 0.85 P water (P = standard consistency). Start the stop-watch when water is added; this is time zero.',
    'Fill the Vicat mould, level it and keep the test block at 27 ± 2 °C and at least 90% humidity between readings.',
    'Initial setting: lower the 1 mm square needle gently and release. Repeat at intervals (on fresh spots) until the needle stops 5 ± 0.5 mm from the bottom. Record that time.',
    'Final setting: replace the needle with the annular attachment. Final setting is when the needle makes an impression but the collar fails to mark the surface.',
    'Setting times are the minutes from time zero to each event.',
  ],
  sampleCalc: ['P = {p:1} % → water = 0.85 × {p:1} ÷ 100 × 400 = {water:1} ml.', 'Water added at {t0}; needle stopped 5 mm from bottom at {ti} → initial setting = {ist:0} minutes.', 'Collar stopped marking at {tf} → final setting = {fst:0} minutes.'],
  example: { input: { header: { ctype: 'OPC 53', p: 29.5, t0: '10:00', ti: '11:45', tf: '15:30' }, grids: { obs: [] } }, expect: { water: 100.3, ist: 105, fst: 330 } },
};

export const CEM_BLAINE: ObservationTemplate = {
  code: 'CEM-BLAINE', version: 1, material: 'Cement', category: 'Cement',
  name: 'Fineness of cement by Blaine air permeability',
  method: 'IS 4031 (Part 2) : 1999 (RA 2018)',
  docControl: doc(3),
  equipment: [{ key: 'bl', label: 'Blaine apparatus', category: 'Blaine air permeability apparatus' }],
  headerFields: [typeField, { key: 'rho', label: 'Density of cement (ρ)', type: 'number', unit: 'g/cm³', default: 3.15 }, { key: 'e', label: 'Porosity of bed (e)', type: 'number', default: 0.5 }, ...env],
  constants: [
    { key: 'v', label: 'Bulk volume of bed (V)', unit: 'cm³', fromEquipment: 'bl.bed_volume', note: 'Calibration certificate' },
    { key: 'ss', label: 'Specific surface of reference cement (Ss)', unit: 'm²/kg', fromEquipment: 'bl.ref_area' },
    { key: 'ts', label: 'Flow time of reference cement (Ts)', unit: 's', fromEquipment: 'bl.ref_time' },
    { key: 'rhos', label: 'Density of reference cement (ρs)', unit: 'g/cm³', fromEquipment: 'bl.ref_density', value: 3.15 },
    { key: 'es', label: 'Porosity of reference bed (εs)', fromEquipment: 'bl.ref_porosity', value: 0.5 },
  ],
  tables: { cem: CEM },
  derived: [
    { key: 'm', label: 'Mass of cement for the bed (ρ V (1 − e))', formula: 'IF(OR(v="",rho="",e=""),"",rho*v*(1-e))', unit: 'g', decimals: 3 },
    { key: 'k', label: 'Apparatus constant', formula: 'IF(OR(ss="",ts=""),"",ss*rhos*(1-es)/(SQRT(es^3)*SQRT(ts)))', decimals: 3 },
  ],
  grids: [{
    key: 't', label: 'Flow time (two beds of the same sample)', rows: 2,
    columns: [
      { key: 'time', label: 'Flow time (T)', unit: 's', input: true },
      { key: 's', label: 'Specific surface', unit: 'm²/kg', formula: 'IF(OR(time="",k=""),"",k*SQRT(e^3)*SQRT(time)/(rho*(1-e)))', decimals: 0 },
    ],
  }],
  results: [{ key: 's', label: 'Specific surface', formula: 'IF(COUNT(t.s)=0,"",ROUND(AVERAGE(t.s),0))', unit: 'm²/kg', decimals: 0 }],
  checks: [
    { when: 'OR(ss="",ts="")', level: 'error', message: 'Select a calibrated Blaine apparatus (reference cement area and flow time).' },
    { when: `AND(s<>"",${look('blaine')}<>"",s<${look('blaine')})`, level: 'warning', message: 'Specific surface is less than the specified minimum.' },
  ],
  reportRows: [{ name: 'Fineness (specific surface, Blaine)', unit: 'm²/kg', result: 's', decimals: 0, specFormula: `"Min "&${look('blaine')}` }],
  references: ['IS 4031 (Part 2) : 1999.', 'Minimum 225 m²/kg (OPC, PSC) and 300 m²/kg (PPC).'],
  procedure: [
    'Calibrate the apparatus: bed volume V by mercury displacement, and flow time Ts of the reference cement of known surface Ss (on the certificate).',
    'Weigh cement equal to ρ V (1 − e) to give a bed of porosity 0.500, place it on the perforated disc over a filter paper and compress it with the plunger.',
    'Attach the cell to the manometer, evacuate air until the liquid reaches the top mark, close the valve.',
    'Time the fall of the liquid from the second to the third mark (T, seconds). Make two beds and take the mean.',
    'S = Ss × (ρs (1 − εs) √e³ √T) ÷ (ρ (1 − e) √εs³ √Ts). With the same density and porosity this reduces to S = Ss √(T ÷ Ts).',
  ],
  sampleCalc: ['Bed mass = {rho:2} × {v:3} × (1 − {e:3}) = {m:3} g.', 'Reference: Ss = {ss:0} m²/kg, Ts = {ts:1} s. Test: T = {t.time#1:1} s → S = {ss:0} × √({t.time#1:1} ÷ {ts:1}) = {t.s#1:0} m²/kg.'],
  example: { input: { header: { ctype: 'OPC 53', rho: 3.15, e: 0.5 }, constants: { v: 1.85, ss: 300, ts: 58 }, grids: { t: [{ time: 55.2 }, { time: 55.2 }] } }, expect: { m: 2.914, 't.s#1': 292.7, s: 293 } },
};

export const CEM_SIEVE: ObservationTemplate = {
  code: 'CEM-SIEVE', version: 1, material: 'Cement', category: 'Cement',
  name: 'Fineness of cement by dry sieving (90 µm)',
  method: 'IS 4031 (Part 1) : 1996 (RA 2021)',
  docControl: doc(4),
  headerFields: [typeField],
  constants: [{ key: 'lim', label: 'Residue limit (if specified by the client)', unit: '%', value: 10 }],
  derived: [],
  grids: [{ key: 't', label: 'Trials', rows: 2, columns: [
    { key: 'w1', label: 'Mass of cement (W1)', unit: 'g', input: true },
    { key: 'w2', label: 'Residue on 90 µm (W2)', unit: 'g', input: true },
    { key: 'r', label: 'Residue', unit: '%', formula: 'IF(OR(w1="",w2=""),"",w2/w1*100)', decimals: 1 },
  ] }],
  results: [{ key: 'r', label: 'Residue on 90 µm sieve', formula: 'IF(COUNT(t.r)=0,"",AVERAGE(t.r))', unit: '%', decimals: 1 }],
  checks: [{ when: 'AND(COUNT(t.r)=2,ABS(INDEX(t.r,1)-INDEX(t.r,2))>1)', level: 'warning', message: 'The two residues differ by more than 1%: sieve a third sample and report the mean of three.' }],
  reportRows: [{ name: 'Fineness – residue on 90 µm sieve', unit: '%', result: 'r', decimals: 1, specFormula: '"Max "&FIXED(lim,0)' }],
  references: ['IS 4031 (Part 1) : 1996. The 90 µm residue is not a requirement of IS 269 : 2015; use it when the client or project specifies it.'],
  procedure: ['Break down air-set lumps and weigh 10 g of cement (W1) onto the 90 µm sieve with the pan fitted.', 'Sieve with a swirling, planetary motion for 15 minutes, brushing the underside of the sieve; continue until no more passes.', 'Weigh the residue (W2). Residue % = W2 ÷ W1 × 100. Repeat and report the mean.'],
  sampleCalc: ['Residue = {t.w2#1:2} ÷ {t.w1#1:0} × 100 = {t.r#1:1} %.'],
  example: { input: { header: {}, grids: { t: [{ w1: 10, w2: 0.32 }, { w1: 10, w2: 0.34 }] } }, expect: { 't.r#1': 3.2, r: 3.3 } },
};

export const CEM_SOUNDNESS: ObservationTemplate = {
  code: 'CEM-SOUND', version: 1, material: 'Cement', category: 'Cement',
  name: 'Soundness of cement (Le Chatelier and autoclave)',
  method: 'IS 4031 (Part 3) : 1988 (RA 2019)',
  docControl: doc(5),
  equipment: [{ key: 'lc', label: 'Le Chatelier apparatus', category: 'Le Chatelier apparatus' }],
  headerFields: [typeField, { key: 'p', label: 'Standard consistency (P)', type: 'number', unit: '%' }],
  constants: [{ key: 'gl', label: 'Effective gauge length (autoclave bar)', unit: 'mm', value: 250 }, { key: 'lim_lc', label: 'Le Chatelier limit', unit: 'mm', value: 10 }, { key: 'lim_ac', label: 'Autoclave limit', unit: '%', value: 0.8 }],
  derived: [{ key: 'water', label: 'Water for 100 g cement (0.78 P)', formula: 'IF(p="","",0.78*p)', unit: 'ml', decimals: 1 }],
  grids: [
    { key: 'lc', label: 'Le Chatelier moulds', rows: 2, columns: [
      { key: 'l1', label: 'Distance between pointers before boiling', unit: 'mm', input: true },
      { key: 'l2', label: 'Distance after boiling and cooling', unit: 'mm', input: true },
      { key: 'x', label: 'Expansion', unit: 'mm', formula: 'IF(OR(l1="",l2=""),"",l2-l1)', decimals: 1 },
    ] },
    { key: 'ac', label: 'Autoclave bars (optional)', rows: 2, columns: [
      { key: 'r1', label: 'Length reading before', unit: 'mm', input: true },
      { key: 'r2', label: 'Length reading after autoclaving', unit: 'mm', input: true },
      { key: 'x', label: 'Expansion', unit: '%', formula: 'IF(OR(r1="",r2=""),"",(r2-r1)/gl*100)', decimals: 3 },
    ] },
  ],
  results: [
    { key: 'lce', label: 'Le Chatelier expansion', formula: 'IF(COUNT(lc.x)=0,"",MROUND(AVERAGE(lc.x),0.5))', unit: 'mm', decimals: 1 },
    { key: 'ace', label: 'Autoclave expansion', formula: 'IF(COUNT(ac.x)=0,"",AVERAGE(ac.x))', unit: '%', decimals: 2 },
  ],
  checks: [{ when: 'AND(lce<>"",lce>lim_lc)', level: 'warning', message: 'Le Chatelier expansion exceeds the limit.' }, { when: 'AND(ace<>"",ace>lim_ac)', level: 'warning', message: 'Autoclave expansion exceeds the limit.' }],
  reportRows: [
    { group: 'Soundness', name: 'Le Chatelier expansion', unit: 'mm', result: 'lce', decimals: 1, specFormula: '"Max "&FIXED(lim_lc,0)' },
    { group: 'Soundness', name: 'Autoclave expansion', unit: '%', result: 'ace', decimals: 2, specFormula: '"Max "&FIXED(lim_ac,1)' },
  ],
  references: ['IS 4031 (Part 3) : 1988.', 'Le Chatelier expansion not more than 10 mm; autoclave expansion not more than 0.8%.'],
  procedure: [
    'Gauge 100 g of cement with 0.78 P water. Fill the lightly oiled Le Chatelier mould placed on a glass plate, cover with another plate and a small weight.',
    'Immerse in water at 27 ± 2 °C for 24 hours. Measure the distance between the indicator points (L1).',
    'Bring the water to boiling in 25–30 minutes and keep it boiling for 3 hours. Cool and measure the distance again (L2).',
    'Expansion = L2 − L1; report the mean of two moulds to the nearest 0.5 mm.',
    'Autoclave (when required): cast 25 × 25 × 282 mm bars, cure 24 hours, read the length, autoclave at 2.1 MPa for 3 hours, cool and read again. Expansion % = change ÷ effective gauge length × 100.',
  ],
  sampleCalc: ['Mould 1: {lc.l2#1:1} − {lc.l1#1:1} = {lc.x#1:1} mm; mould 2: {lc.l2#2:1} − {lc.l1#2:1} = {lc.x#2:1} mm → mean rounded to 0.5 mm = {lce:1} mm.', 'Autoclave: ({ac.r2#1:3} − {ac.r1#1:3}) ÷ {gl:0} × 100 = {ac.x#1:3} %.'],
  example: { input: { header: { p: 29.5 }, grids: { lc: [{ l1: 12, l2: 13.5 }, { l1: 11.5, l2: 12.5 }], ac: [{ r1: 2.105, r2: 2.48 }] } }, expect: { lce: 1.5, 'ac.x#1': 0.15 } },
};

const ages = (age: number) => `IF(AND(age=${age},fc<>""),fc,"")`;
export const CEM_STRENGTH: ObservationTemplate = {
  code: 'CEM-CS', version: 1, material: 'Cement', category: 'Cement',
  name: 'Compressive strength of cement (mortar cubes)',
  method: 'IS 4031 (Part 6) : 1988 (RA 2019)',
  docControl: doc(6),
  equipment: [{ key: 'ctm', label: 'Compression testing machine', category: 'Compression testing machine' }],
  headerFields: [typeField, { key: 'p', label: 'Standard consistency (P)', type: 'number', unit: '%' }, { key: 'cast', label: 'Date of casting', type: 'date' }, ...env],
  constants: [
    { key: 'area', label: 'Area of cube face (70.6 mm)', unit: 'mm²', value: 5000 },
    { key: 'ctm_cf', label: 'CTM correction factor', fromEquipment: 'ctm.correction', value: 1 },
  ],
  tables: { cem: CEM },
  derived: [
    { key: 'water', label: 'Water per cube (P/4 + 3)% of 800 g', formula: 'IF(p="","",(p/4+3)/100*800)', unit: 'g', decimals: 1 },
    { key: 'r3', label: '3-day requirement', formula: look('s3'), unit: 'N/mm²', decimals: 0 },
    { key: 'r7', label: '7-day requirement', formula: look('s7'), unit: 'N/mm²', decimals: 0 },
    { key: 'r28', label: '28-day requirement', formula: look('s28'), unit: 'N/mm²', decimals: 0 },
    { key: 'r28max', label: '28-day maximum', formula: look('s28max'), unit: 'N/mm²', decimals: 0 },
  ],
  grids: [{
    key: 'c', label: 'Cubes (three per age)', fixedRows: [3, 3, 3, 7, 7, 7, 28, 28, 28].map((a) => ({ age: a })),
    columns: [
      { key: 'age', label: 'Age', unit: 'days' },
      { key: 'id', label: 'Cube ID', input: true, text: true },
      { key: 'load', label: 'Load at failure', unit: 'kN', input: true },
      { key: 'fc', label: 'Compressive strength', unit: 'N/mm²', formula: 'IF(load="","",load*ctm_cf*1000/area)', decimals: 1 },
      { key: 'c3', label: '3 d', formula: ages(3), decimals: 1 }, { key: 'c7', label: '7 d', formula: ages(7), decimals: 1 }, { key: 'c28', label: '28 d', formula: ages(28), decimals: 1 },
    ],
  }],
  results: [
    { key: 's3', label: 'Compressive strength at 3 days', formula: 'IFERROR(AVERAGE(c.c3),"")', unit: 'N/mm²', decimals: 1 },
    { key: 's7', label: 'Compressive strength at 7 days', formula: 'IFERROR(AVERAGE(c.c7),"")', unit: 'N/mm²', decimals: 1 },
    { key: 's28', label: 'Compressive strength at 28 days', formula: 'IFERROR(AVERAGE(c.c28),"")', unit: 'N/mm²', decimals: 1 },
  ],
  checks: [
    { when: 'AND(s3<>"",r3<>"",s3<r3)', level: 'warning', message: '3-day strength is below the requirement.' },
    { when: 'AND(s7<>"",r7<>"",s7<r7)', level: 'warning', message: '7-day strength is below the requirement.' },
    { when: 'AND(s28<>"",r28<>"",s28<r28)', level: 'warning', message: '28-day strength is below the requirement.' },
    { when: 'AND(s28<>"",r28max<>"",s28>r28max)', level: 'warning', message: '28-day strength is above the maximum allowed for this grade.' },
  ],
  reportRows: [
    { group: 'Compressive strength', name: '3 days (72 ± 1 h)', unit: 'N/mm²', result: 's3', decimals: 1, specFormula: 'IF(r3="","","Min "&r3)' },
    { group: 'Compressive strength', name: '7 days (168 ± 2 h)', unit: 'N/mm²', result: 's7', decimals: 1, specFormula: 'IF(r7="","","Min "&r7)' },
    { group: 'Compressive strength', name: '28 days (672 ± 4 h)', unit: 'N/mm²', result: 's28', decimals: 1, specFormula: 'IF(r28="","","Min "&r28&IF(r28max="",""," and max "&r28max))' },
  ],
  references: ['IS 4031 (Part 6) : 1988 with standard sand to IS 650.', 'IS 269 : 2015 – OPC 33: 16/22/33–48, OPC 43: 23/33/43–58, OPC 53: 27/37/53 N/mm² min at 3/7/28 days; PPC (IS 1489-1) and PSC (IS 455): 16/22/33.'],
  procedure: [
    'For each cube mix 200 g cement and 600 g standard sand (IS 650) dry for one minute, then add water (P/4 + 3)% of the combined mass.',
    'Mix for 3 to 4 minutes to a uniform colour. Place the mortar in the 70.6 mm cube mould on the vibration machine and vibrate for 2 minutes at 12 000 ± 400 vibrations per minute.',
    'Keep the moulds at 27 ± 2 °C and 90% humidity for 24 hours, then demould and cure in clean water at 27 ± 2 °C.',
    'Test three cubes at each age (3, 7, 28 days) on their sides, loading at 35 N/mm² per minute until failure.',
    'Strength = load ÷ face area (5000 mm²). Report the mean of three cubes at each age.',
  ],
  sampleCalc: ['Water per cube = ({p:1} ÷ 4 + 3) % × 800 g = {water:1} g.', '7-day cubes: {c.load#4:0}, {c.load#5:0}, {c.load#6:0} kN ÷ 5000 mm² → {c.fc#4:1}, {c.fc#5:1}, {c.fc#6:1} N/mm²; mean = {s7:1} N/mm² (requirement {r7:0} min for {ctype}).'],
  example: { input: { header: { ctype: 'OPC 43', p: 29.5 }, grids: { c: [{ load: 118 }, { load: 124 }, { load: 121 }, { load: 172 }, { load: 176 }, { load: 168 }, { load: 278 }, { load: 286 }, { load: 281 }] } }, expect: { water: 83, s3: 24.2, s7: 34.4, s28: 56.33 } },
};

export const CEM_SG: ObservationTemplate = {
  code: 'CEM-SG', version: 1, material: 'Cement', category: 'Cement',
  name: 'Density (specific gravity) of cement',
  method: 'IS 4031 (Part 11) : 1988 (RA 2019)',
  docControl: doc(7),
  headerFields: [typeField],
  constants: [], derived: [],
  grids: [{ key: 't', label: 'Le Chatelier flask with kerosene', rows: 2, columns: [
    { key: 'w', label: 'Mass of cement', unit: 'g', input: true },
    { key: 'v1', label: 'Initial reading', unit: 'ml', input: true },
    { key: 'v2', label: 'Final reading', unit: 'ml', input: true },
    { key: 'd', label: 'Density', unit: 'g/cm³', formula: 'IF(OR(w="",v1="",v2=""),"",w/(v2-v1))', decimals: 2 },
  ] }],
  results: [{ key: 'd', label: 'Density of cement', formula: 'IF(COUNT(t.d)=0,"",AVERAGE(t.d))', unit: 'g/cm³', decimals: 2 }],
  checks: [{ when: 'AND(COUNT(t.d)=2,ABS(INDEX(t.d,1)-INDEX(t.d,2))>0.03)', level: 'warning', message: 'The two results differ by more than 0.03 g/cm³: repeat.' }],
  reportRows: [{ name: 'Density (specific gravity)', unit: 'g/cm³', result: 'd', decimals: 2, spec: '--' }],
  references: ['IS 4031 (Part 11) : 1988.'],
  procedure: ['Fill the Le Chatelier flask with kerosene to a point between 0 and 1 ml, keep it in a water bath at 27 °C and record the reading (V1).', 'Add about 64 g of cement in small amounts without splashing; roll the flask to remove air.', 'Return the flask to the bath and record the final reading (V2). Density = mass ÷ (V2 − V1).'],
  sampleCalc: ['{t.w#1:0} g ÷ ({t.v2#1:1} − {t.v1#1:1}) ml = {t.d#1:2} g/cm³.'],
  example: { input: { header: {}, grids: { t: [{ w: 64, v1: 0.5, v2: 20.8 }] } }, expect: { 't.d#1': 3.153 } },
};

export const CEMENT_TEMPLATES: ObservationTemplate[] = [CEM_CONSISTENCY, CEM_SETTING, CEM_BLAINE, CEM_SIEVE, CEM_SOUNDNESS, CEM_STRENGTH, CEM_SG];
