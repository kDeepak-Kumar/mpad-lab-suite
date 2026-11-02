/**
 * Calibration values each equipment category carries. Observation sheets read them through
 * constants such as `fromEquipment: 'ring.factor'`; testers can still override a value on the sheet.
 */
export interface EquipmentField { key: string; label: string; unit?: string; note?: string }

export const EQUIPMENT_FIELDS: Record<string, EquipmentField[]> = {
  'Proving ring': [{ key: 'factor', label: 'Calibration factor', unit: 'kN/div', note: 'From the calibration certificate' }],
  'Compression testing machine': [{ key: 'correction', label: 'Correction factor (multiply reading)', unit: '', note: '1.000 when the certificate shows no correction' }],
  'Universal testing machine': [{ key: 'correction', label: 'Correction factor (multiply reading)', unit: '' }],
  'Flexure testing machine': [{ key: 'correction', label: 'Correction factor (multiply reading)', unit: '' }],
  'Rebound hammer': [
    { key: 'anvil_avg', label: 'Average rebound on test anvil', unit: '' },
    { key: 'anvil_nominal', label: 'Nominal anvil rebound (manufacturer)', unit: '', note: 'Typically 80 for type N hammers' },
  ],
  'Ultrasonic pulse velocity tester': [{ key: 'ref_time', label: 'Transit time of calibration rod', unit: 'µs' }],
  'Blaine air permeability apparatus': [
    { key: 'bed_volume', label: 'Bulk volume of cement bed (V)', unit: 'cm³', note: 'By mercury displacement' },
    { key: 'ref_area', label: 'Specific surface of reference cement (Ss)', unit: 'm²/kg' },
    { key: 'ref_time', label: 'Mean flow time of reference cement (Ts)', unit: 's' },
    { key: 'ref_density', label: 'Density of reference cement (ρs)', unit: 'g/cm³' },
    { key: 'ref_porosity', label: 'Porosity of reference bed (εs)', unit: '' },
  ],
  'Sand pouring cylinder': [
    { key: 'cone_mass', label: 'Mass of sand in cone (W2)', unit: 'g' },
    { key: 'sand_density', label: 'Bulk density of calibrated sand (γs)', unit: 'g/cm³' },
  ],
  'Core cutter': [{ key: 'volume', label: 'Internal volume of core cutter', unit: 'cm³' }, { key: 'mass', label: 'Mass of core cutter', unit: 'g' }],
  'Compaction mould': [{ key: 'volume', label: 'Volume of mould', unit: 'cm³' }, { key: 'mass', label: 'Mass of mould with base plate', unit: 'g' }],
  'Cylindrical measure': [{ key: 'volume', label: 'Volume of measure', unit: 'litre' }, { key: 'mass', label: 'Mass of empty measure', unit: 'kg' }],
  'Dial gauge': [{ key: 'lc', label: 'Least count', unit: 'mm/div' }],
  'Vicat apparatus': [],
  'Le Chatelier apparatus': [],
  'Los Angeles abrasion machine': [],
  'Impact testing machine': [],
  'Balance': [{ key: 'readability', label: 'Readability', unit: 'g' }],
  'Oven': [],
  'Sieve set': [],
  'Direct shear apparatus': [{ key: 'factor', label: 'Proving ring factor', unit: 'kN/div' }],
  'Casagrande apparatus': [],
  'Cover meter': [],
  'Other': [],
};

export const EQUIPMENT_CATEGORIES = Object.keys(EQUIPMENT_FIELDS);
