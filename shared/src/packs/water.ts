import type { ObservationTemplate } from '../observation';

/**
 * Water and cement chemical tests. Usually done by an external (sub-contracted) laboratory:
 * the sheet is a direct-entry table – values are typed or imported from the vendor's report.
 * Requirements are editable in the template editor; verify them against the current edition of each standard.
 */
interface Param { key: string; name: string; unit: string; method: string; spec: string; decimals?: number; text?: boolean; options?: string[] }

function entrySheet(o: { code: string; name: string; material: string; category: string; method: string; doc: string; params: Param[]; refs: string[]; extraHeader?: ObservationTemplate['headerFields'] }): ObservationTemplate {
  return {
    code: o.code, version: 1, material: o.material, category: o.category, name: o.name, method: o.method,
    docControl: { docNo: o.doc, issueNo: '01', issueDate: '', amendmentNo: '0' },
    equipment: [],
    headerFields: [
      ...(o.extraHeader ?? []),
      ...o.params.map((p) => (p.text
        ? { key: p.key, label: `${p.name}`, type: 'select' as const, options: p.options ?? [] }
        : { key: p.key, label: `${p.name}`, type: 'number' as const, unit: p.unit === '--' ? undefined : p.unit, help: p.method })),
    ],
    constants: [], derived: [], grids: [],
    results: o.params.map((p) => ({ key: `r_${p.key}`, label: p.name, formula: `IF(${p.key}="","",${p.key})`, unit: p.unit, ...(p.text ? {} : { decimals: p.decimals ?? 2 }) })),
    checks: [],
    reportRows: o.params.map((p) => ({ name: p.name, unit: p.unit, result: `r_${p.key}`, decimals: p.text ? undefined : p.decimals ?? 2, spec: p.spec })),
    references: o.refs,
    procedure: ['Enter each result as reported (by this laboratory or the external laboratory). Leave a parameter blank if it was not tested – blank rows are left off the report.'],
    sampleCalc: [],
    example: {
      input: { header: Object.fromEntries(o.params.filter((p) => !p.text).slice(0, 2).map((p, i) => [p.key, 7 + i])) },
      expect: Object.fromEntries(o.params.filter((p) => !p.text).slice(0, 2).map((p, i) => [`r_${p.key}`, 7 + i])),
    },
  };
}

export const WATER_CONSTRUCTION = entrySheet({
  code: 'WAT-456', name: 'Water for construction purposes (mixing and curing)', material: 'Water', category: 'Water', doc: 'OBS/WAT/01',
  method: 'IS 3025 (relevant parts); requirements as per IS 456 : 2000, clause 5.4',
  params: [
    { key: 'ph', name: 'pH value', unit: '--', method: 'IS 3025 (Part 11)', spec: 'Not less than 6', decimals: 2 },
    { key: 'acid', name: 'Volume of 0.02 N NaOH to neutralise 100 ml (acidity)', unit: 'ml', method: 'IS 3025 (Part 22)', spec: 'Max 5', decimals: 1 },
    { key: 'alk', name: 'Volume of 0.02 N H₂SO₄ to neutralise 100 ml (alkalinity)', unit: 'ml', method: 'IS 3025 (Part 23)', spec: 'Max 25', decimals: 1 },
    { key: 'org', name: 'Organic solids', unit: 'mg/l', method: 'IS 3025 (Part 18)', spec: 'Max 200', decimals: 0 },
    { key: 'inorg', name: 'Inorganic solids', unit: 'mg/l', method: 'IS 3025 (Part 18)', spec: 'Max 3000', decimals: 0 },
    { key: 'so3', name: 'Sulphates (as SO₃)', unit: 'mg/l', method: 'IS 3025 (Part 24)', spec: 'Max 400', decimals: 0 },
    { key: 'cl', name: 'Chlorides (as Cl)', unit: 'mg/l', method: 'IS 3025 (Part 32)', spec: 'Max 2000 (PCC) / 500 (RCC)', decimals: 0 },
    { key: 'ss', name: 'Suspended matter', unit: 'mg/l', method: 'IS 3025 (Part 17)', spec: 'Max 2000', decimals: 0 },
  ],
  refs: ['IS 456 : 2000, clause 5.4 – water for mixing and curing concrete; permissible limits for solids (Table) and neutralisation requirements.'],
});

export const WATER_DRINKING = entrySheet({
  code: 'WAT-10500', name: 'Drinking water – physical and chemical parameters', material: 'Water', category: 'Water', doc: 'OBS/WAT/02',
  method: 'IS 3025 (relevant parts); requirements as per IS 10500 : 2012 (acceptable limit / permissible limit in absence of alternate source)',
  params: [
    { key: 'colour', name: 'Colour', unit: 'Hazen', method: 'IS 3025 (Part 4)', spec: '5 (15)', decimals: 0 },
    { key: 'odour', name: 'Odour', unit: '--', method: 'IS 3025 (Part 5)', spec: 'Agreeable', text: true, options: ['Agreeable', 'Not agreeable'] },
    { key: 'turb', name: 'Turbidity', unit: 'NTU', method: 'IS 3025 (Part 10)', spec: '1 (5)', decimals: 1 },
    { key: 'ph', name: 'pH value', unit: '--', method: 'IS 3025 (Part 11)', spec: '6.5 – 8.5', decimals: 2 },
    { key: 'tds', name: 'Total dissolved solids', unit: 'mg/l', method: 'IS 3025 (Part 16)', spec: '500 (2000)', decimals: 0 },
    { key: 'th', name: 'Total hardness (as CaCO₃)', unit: 'mg/l', method: 'IS 3025 (Part 21)', spec: '200 (600)', decimals: 0 },
    { key: 'ca', name: 'Calcium (as Ca)', unit: 'mg/l', method: 'IS 3025 (Part 40)', spec: '75 (200)', decimals: 0 },
    { key: 'mg', name: 'Magnesium (as Mg)', unit: 'mg/l', method: 'IS 3025 (Part 46)', spec: '30 (100)', decimals: 0 },
    { key: 'ta', name: 'Total alkalinity (as CaCO₃)', unit: 'mg/l', method: 'IS 3025 (Part 23)', spec: '200 (600)', decimals: 0 },
    { key: 'cl', name: 'Chloride (as Cl)', unit: 'mg/l', method: 'IS 3025 (Part 32)', spec: '250 (1000)', decimals: 0 },
    { key: 'so4', name: 'Sulphate (as SO₄)', unit: 'mg/l', method: 'IS 3025 (Part 24)', spec: '200 (400)', decimals: 0 },
    { key: 'no3', name: 'Nitrate (as NO₃)', unit: 'mg/l', method: 'IS 3025 (Part 34)', spec: '45 (no relaxation)', decimals: 1 },
    { key: 'f', name: 'Fluoride (as F)', unit: 'mg/l', method: 'IS 3025 (Part 60)', spec: '1.0 (1.5)', decimals: 2 },
    { key: 'fe', name: 'Iron (as Fe)', unit: 'mg/l', method: 'IS 3025 (Part 53)', spec: '1.0 (no relaxation)', decimals: 2 },
  ],
  refs: ['IS 10500 : 2012 Drinking water – specification. Values in brackets are permissible limits in the absence of an alternate source.'],
});

export const CEMENT_CHEMICAL = entrySheet({
  code: 'CEM-CHEM', name: 'Chemical analysis of cement', material: 'Cement', category: 'Cement', doc: 'OBS/CEM/09',
  method: 'IS 4032 : 1985 (RA 2019); requirements as per the cement specification (IS 269 / IS 1489 / IS 455)',
  extraHeader: [{ key: 'ctype', label: 'Type / grade of cement', type: 'select', options: ['OPC 33', 'OPC 43', 'OPC 53', 'PPC', 'PSC'], default: 'OPC 53' }],
  params: [
    { key: 'loi', name: 'Loss on ignition', unit: '%', method: 'IS 4032', spec: 'As per specification' },
    { key: 'ir', name: 'Insoluble residue', unit: '%', method: 'IS 4032', spec: 'As per specification' },
    { key: 'mgo', name: 'Magnesia (MgO)', unit: '%', method: 'IS 4032', spec: 'Max 6.0' },
    { key: 'so3', name: 'Sulphuric anhydride (SO₃)', unit: '%', method: 'IS 4032', spec: 'As per specification' },
    { key: 'cl', name: 'Total chlorides', unit: '%', method: 'IS 4032', spec: 'Max 0.1 (0.05 for prestressed work)', decimals: 3 },
    { key: 'lsf', name: 'Lime saturation factor', unit: '--', method: 'IS 4032', spec: 'As per specification' },
    { key: 'af', name: 'Ratio of alumina to iron oxide', unit: '--', method: 'IS 4032', spec: 'Min 0.66' },
    { key: 'alk', name: 'Total alkalis (as Na₂O equivalent)', unit: '%', method: 'IS 4032', spec: 'Max 0.6 (when specified)' },
  ],
  refs: ['IS 4032 : 1985 Methods of chemical analysis of hydraulic cement. Check limits against the purchased cement’s specification and edit the requirement column in the template editor if needed.'],
});

export const WATER_TEMPLATES: ObservationTemplate[] = [WATER_CONSTRUCTION, WATER_DRINKING, CEMENT_CHEMICAL];
