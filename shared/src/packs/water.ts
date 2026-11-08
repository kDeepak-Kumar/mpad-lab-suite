import type { ObservationTemplate } from '../observation';

/**
 * Water and cement chemical tests. Usually done by an external (sub-contracted) laboratory:
 * the sheet is a direct-entry table – values are typed or imported from the vendor's report.
 * Requirements are editable in the template editor; verify them against the current edition of each standard.
 */
interface Param { key: string; group?: string; name: string; unit: string; method: string; spec: string; decimals?: number; text?: boolean; options?: string[] }

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
    reportRows: o.params.map((p) => ({ group: p.group, name: p.name, unit: p.unit, result: `r_${p.key}`, decimals: p.text ? undefined : p.decimals ?? 2, spec: p.spec })),
    references: o.refs,
    procedure: ['Enter each result as reported (by this laboratory or the external laboratory). Leave a parameter blank if it was not tested – blank rows are left off the report.'],
    sampleCalc: [],
    example: {
      input: { header: Object.fromEntries(o.params.filter((p) => !p.text).slice(0, 2).map((p, i) => [p.key, 7 + i])), grids: {} },
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


/** Chemical analysis of TMT bars (per diameter), limits of IS 1786 : 2008 Table 1 with product-analysis tolerance. */
const STEEL_GRADES = ['Fe 415', 'Fe 415D', 'Fe 500', 'Fe 500D', 'Fe 550', 'Fe 550D', 'Fe 600'];
const STEEL_CHEM_BASE = entrySheet({
  code: 'STEEL-CHEM', name: 'Chemical analysis of TMT bars', material: 'Steel', category: 'Steel', doc: 'OBS/ST/02',
  method: 'IS: 8811-1998 (RA 2018)',
  extraHeader: [
    { key: 'grade', label: 'Grade', type: 'select', options: STEEL_GRADES, required: true, default: 'Fe 500D' },
    { key: 'dia', label: 'Nominal diameter', type: 'select', options: ['8', '10', '12', '16', '20', '25', '28', '32', '36', '40'], unit: 'mm', required: true },
    { key: 'brand', label: 'Make / brand', type: 'text' },
  ],
  params: [
    { key: 'c', name: 'Carbon (C)', unit: '%', method: 'IS 8811', spec: 'As per grade', decimals: 3 },
    { key: 'p', name: 'Phosphorus (P)', unit: '%', method: 'IS 8811', spec: 'As per grade', decimals: 3 },
    { key: 's', name: 'Sulphur (S)', unit: '%', method: 'IS 8811', spec: 'As per grade', decimals: 3 },
  ],
  refs: ['IS 1786 : 2008 (RA 2018) Table 1 – chemical composition; product analysis tolerance as per clause 6.1. IS 8811 : 1998 – spectrometric analysis of steel.'],
});
export const STEEL_CHEMICAL: ObservationTemplate = {
  ...STEEL_CHEM_BASE,
  tables: { lim: { g: STEEL_GRADES, c: [0.30, 0.25, 0.32, 0.27, 0.32, 0.27, 0.32], s: [0.060, 0.045, 0.060, 0.045, 0.060, 0.045, 0.045], p: [0.060, 0.045, 0.060, 0.045, 0.060, 0.045, 0.045], ps: [0.110, 0.085, 0.115, 0.085, 0.110, 0.085, 0.085] } },
  results: [
    ...STEEL_CHEM_BASE.results,
    { key: 'r_ps', label: 'P + S', formula: 'IF(OR(p="",s=""),"",p+s)', unit: '%', decimals: 3 },
    { key: 'verdict', label: 'Conformity', formula: 'IF(OR(c="",p="",s=""),"",IF(AND(c<=LOOKUPX(grade,lim.g,lim.c),p<=LOOKUPX(grade,lim.g,lim.p),s<=LOOKUPX(grade,lim.g,lim.s),p+s<=LOOKUPX(grade,lim.g,lim.ps)),"Conforms","Does not conform"))' },
  ],
  reportRows: [...STEEL_CHEM_BASE.reportRows, { name: 'Sulphur + Phosphorus (P + S)', unit: '%', result: 'r_ps', decimals: 3, spec: 'As per grade' }],
  example: { input: { header: { grade: 'Fe 550D', dia: '12', brand: 'Jindal panther', c: 0.201, p: 0.024, s: 0.025 }, grids: {} }, expect: { r_c: 0.201, r_ps: 0.049, verdict: 'Conforms' } },
};

/** Ground granulated blast furnace slag: IS 16714 : 2018 requirements. */
export const GGBS_PHYSICAL = entrySheet({
  code: 'GGBS-PHY', name: 'Physical properties of GGBS', material: 'GGBS', category: 'GGBS', doc: 'OBS/GGBS/01',
  method: 'IS: 1727-1967 (Reaf-2018); IS: 4031(P-2,4,6)-1999 (Reaf-2018)',
  params: [
    { key: 'sg', name: 'Specific gravity', unit: '--', method: 'IS 1727', spec: '--', decimals: 2 },
    { key: 'fine', name: 'Fineness (m²/kg) – by Blaine’s Permeability method', unit: 'm²/kg', method: 'IS 4031 (Part 2)', spec: 'Min 320', decimals: 0 },
    { key: 'sai7', group: 'Slag Activity Index (%)', name: '7 days', unit: '%', method: 'IS 16714 Annex', spec: 'Min. 60 %', decimals: 2 },
    { key: 'sai28', group: 'Slag Activity Index (%)', name: '28 days', unit: '%', method: 'IS 16714 Annex', spec: 'Min. 75 %', decimals: 2 },
  ],
  refs: ['IS 16714 : 2018 Ground granulated blast furnace slag for use in cement, mortar and concrete – specification (Table 1 physical requirements).'],
});
export const GGBS_CHEMICAL = entrySheet({
  code: 'GGBS-CHEM', name: 'Chemical properties of GGBS', material: 'GGBS', category: 'GGBS', doc: 'OBS/GGBS/02',
  method: 'IS: 4032-1985 (Reaff-2019); IS: 16714-2018',
  params: [
    { key: 'mno', name: 'Manganese oxide MnO', unit: '%', method: 'IS 4032', spec: '5.5 Max' },
    { key: 'mgo', name: 'Magnesium Oxide (MgO)', unit: '%', method: 'IS 4032', spec: '17.0 Max' },
    { key: 'sul', name: 'Sulphide Sulphur (S)', unit: '%', method: 'IS 4032', spec: '2.0 Max' },
    { key: 'so3', name: 'Sulphate (SO₃)', unit: '%', method: 'IS 4032', spec: '3.0 Max' },
    { key: 'ir', name: 'Insoluble Residue', unit: '%', method: 'IS 4032', spec: '3.0 Max' },
    { key: 'cl', name: 'Chlorides (Cl)', unit: '%', method: 'IS 4032', spec: '0.1 Max', decimals: 3 },
    { key: 'loi', name: 'Loss on Ignition', unit: '%', method: 'IS 4032', spec: '3.0 Max' },
    { key: 'b1', name: '(CaO + MgO + 1/3 Al₂O₃) / (SiO₂ + 2/3 Al₂O₃)', unit: '--', method: 'IS 16714', spec: '1.0 Min' },
    { key: 'b2', name: '(CaO + MgO + Al₂O₃) / SiO₂', unit: '--', method: 'IS 16714', spec: '1.0 Min' },
  ],
  refs: ['IS 16714 : 2018 Table 2 – chemical requirements of GGBS.'],
});

export const WATER_TEMPLATES: ObservationTemplate[] = [WATER_CONSTRUCTION, WATER_DRINKING, CEMENT_CHEMICAL, STEEL_CHEMICAL, GGBS_PHYSICAL, GGBS_CHEMICAL];
