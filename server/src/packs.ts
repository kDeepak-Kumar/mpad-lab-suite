import type { Knex } from 'knex';
import { CIVIL_LAB_TEMPLATES, EQUIPMENT_CATEGORIES } from '@suite/shared';
import { db, insert, now, parseJson, toJson } from './db';
import { invalidateMeta } from './meta';

export type CatalogSeed = { code: string; material: string; billing_name: string; report_name: string; method: string; nabl: boolean; unit: string; rate: number; obs_template_code: string | null; tat_days: number; conditions?: string; report_notes?: string };

const t = (code: string, material: string, billing_name: string, report_name: string, method: string, rate: number, obs: string | null, tat = 2, unit = 'Per sample', extra: Partial<CatalogSeed> = {}): CatalogSeed =>
  ({ code, material, billing_name, report_name, method, nabl: true, unit, rate, obs_template_code: obs, tat_days: tat, ...extra });

/**
 * Standard catalog for the civil laboratory pack. Rates are indicative only;
 * the lab edits them (and the NABL flag) in Settings → Catalog.
 */
export const PACK_CATALOG: CatalogSeed[] = [
  // Water and cement chemistry – usually sub-contracted (mark them Outsourced in the Rate card)
  t('WAT-456', 'Water', 'Water for construction – IS 456 parameters', 'Water for construction purposes', 'IS 3025 / IS 456 : 2000', 3000, 'WAT-456', 5, 'Per sample', { nabl: false }),
  t('WAT-10500', 'Water', 'Drinking water – physical & chemical (IS 10500)', 'Drinking water analysis', 'IS 3025 / IS 10500 : 2012', 4500, 'WAT-10500', 5, 'Per sample', { nabl: false }),
  t('CEM-CHEM', 'Cement', 'Chemical analysis of cement', 'Chemical analysis of cement', 'IS 4032 : 1985', 5000, 'CEM-CHEM', 7, 'Per sample', { nabl: false }),
  // Soil
  t('SOIL-MC', 'Soil', 'Natural moisture content of soil', 'Natural moisture content', 'IS 2720 (Part 2) : 1973 RA 2020', 300, 'SOIL-MC', 1),
  t('SOIL-SG', 'Soil', 'Specific gravity of soil', 'Specific gravity', 'IS 2720 (Part 3/Sec 1) : 1980 RA 2021', 600, 'SOIL-SG'),
  t('SOIL-GR', 'Soil', 'Gradation analysis of soil', 'Gradation analysis of soil', 'IS 2720 (Part 4) : 1985 RA 2020', 900, 'GRADATION-SOIL'),
  t('SOIL-AL', 'Soil', 'Atterberg limits of soil', 'Atterberg limits', 'IS 2720 (Part 5) : 1985 RA 2020', 1000, 'ATTERBERG'),
  t('SOIL-SL', 'Soil', 'Shrinkage limit of soil', 'Shrinkage limit', 'IS 2720 (Part 6) : 1972 RA 2021', 800, 'SOIL-SL', 3),
  t('SOIL-MP', 'Soil', 'Determining MDD and OMC of soil by heavy compaction method', 'Modified Proctor', 'IS 2720 (Part 8) : 1983 RA 2020', 3000, 'PROCTOR-HEAVY', 3),
  t('SOIL-CBR', 'Soil', 'California bearing ratio (CBR) of soil, soaked', 'CBR', 'IS 2720 (Part 16) : 1987 RA 2021', 2500, 'CBR-LAB', 6, 'Per sample', {
    report_notes: 'As per IS 2720 (Part 16) : 1987, Clause 7.3: generally the CBR value at 2.5 mm penetration will be greater than that at 5 mm penetration, and in such a case the former shall be taken as the CBR value for design purposes.' }),
  t('SOIL-FSI', 'Soil', 'Free swell index of soil', 'Free swell index', 'IS 2720 (Part 40) : 1977 RA 2021', 600, 'FSI'),
  t('SOIL-UCS', 'Soil', 'Unconfined compressive strength of soil', 'Unconfined compressive strength', 'IS 2720 (Part 10) : 1991 RA 2020', 1500, 'SOIL-UCS', 3),
  t('SOIL-DST', 'Soil', 'Direct shear test of soil (c and φ)', 'Direct shear test', 'IS 2720 (Part 13) : 1986 RA 2021', 3000, 'SOIL-DST', 4),
  t('FLD-CC', 'Soil', 'Field dry density by core cutter method', 'Field dry density (core cutter)', 'IS 2720 (Part 29) : 1975 RA 2020', 500, 'SOIL-FDD-CC', 1, 'Per location'),
  t('FLD-SR', 'Soil', 'Field dry density by sand replacement method', 'Field dry density (sand replacement)', 'IS 2720 (Part 28) : 1974 RA 2020', 700, 'SOIL-FDD-SR', 1, 'Per location'),
  // Soil field tests and foundations
  t('FLD-PLT', 'Soil', 'Conducting plate load test on soil as per IS 1888 : 1982', 'Plate load test', 'IS 1888 : 1982 RA 2021', 18000, 'PLT', 5, 'Per point', { conditions: 'Reaction load should be provided from customer end along with 2 helpers.' }),
  t('FLD-SPT', 'Soil', 'Standard penetration test in borehole', 'Standard penetration test', 'IS 2131 : 1981 RA 2021', 800, 'SPT', 3, 'Per borehole'),
  t('FLD-BH', 'Soil', 'Drilling of borehole with SPT, sampling and logging', 'Borehole log', 'IS 1892 : 2021', 15000, 'BH-LOG', 7, 'Per borehole'),
  t('SBC-SPT', 'Soil', 'Safe bearing capacity analysis from SPT data', 'Safe bearing capacity', 'IS 6403 : 1981 RA 2021', 2500, 'SBC-SPT', 3, 'Per report'),
  t('SBC-SHEAR', 'Soil', 'Safe bearing capacity analysis from shear parameters', 'Safe bearing capacity', 'IS 6403 : 1981 RA 2021', 2500, 'SBC-IS6403', 3, 'Per report'),
  t('PILE-UP', 'Pile / pier', 'Pull-out (uplift) load test on pile / pier', 'Pull-out load test', 'IS 2911 (Part 4) : 2013', 12000, 'PILE-UPLIFT', 3, 'Per test', { conditions: 'Reaction arrangement to be provided by the customer.' }),
  t('PILE-LAT', 'Pile / pier', 'Lateral load test on pile / pier', 'Lateral load test', 'IS 2911 (Part 4) : 2013', 12000, 'PILE-LATERAL', 3, 'Per test', { conditions: 'Reaction arrangement to be provided by the customer.' }),
  // Coarse aggregate
  t('CA-SIEVE', 'Coarse aggregate', 'Sieve analysis of coarse aggregate', 'Sieve analysis', 'IS 2386 (Part 1) : 1963 RA 2021', 800, 'CA-SIEVE'),
  t('CA-FLAKY', 'Coarse aggregate', 'Flakiness and elongation index of coarse aggregate', 'Flakiness and elongation index', 'IS 2386 (Part 1) : 1963 RA 2021', 900, 'CA-FLAKY'),
  t('CA-AIV', 'Coarse aggregate', 'Aggregate impact value', 'Aggregate impact value', 'IS 2386 (Part 4) : 1963 RA 2021', 700, 'CA-AIV'),
  t('CA-ACV', 'Coarse aggregate', 'Aggregate crushing value', 'Aggregate crushing value', 'IS 2386 (Part 4) : 1963 RA 2021', 900, 'CA-ACV'),
  t('CA-LAA', 'Coarse aggregate', 'Los Angeles abrasion value', 'Los Angeles abrasion value', 'IS 2386 (Part 4) : 1963 RA 2021', 1500, 'CA-LAA'),
  t('CA-SG', 'Coarse aggregate', 'Specific gravity and water absorption of coarse aggregate', 'Specific gravity and water absorption', 'IS 2386 (Part 3) : 1963 RA 2021', 700, 'CA-SG', 3),
  t('CA-BD', 'Coarse aggregate', 'Bulk density and voids of coarse aggregate', 'Bulk density', 'IS 2386 (Part 3) : 1963 RA 2021', 600, 'CA-BD'),
  t('CA-SOUND', 'Coarse aggregate', 'Soundness of coarse aggregate (5 cycles)', 'Soundness', 'IS 2386 (Part 5) : 1963 RA 2021', 3000, 'CA-SOUND', 8),
  t('CA-10FINES', 'Coarse aggregate', 'Ten per cent fines value', 'Ten per cent fines value', 'IS 2386 (Part 4) : 1963 RA 2021', 1500, 'CA-10FINES'),
  t('CA-DEL', 'Coarse aggregate', 'Material finer than 75 µm and clay lumps in coarse aggregate', 'Deleterious materials', 'IS 2386 (Part 1 & 2) : 1963 RA 2021', 700, 'CA-DEL'),
  // Fine aggregate
  t('FA-SIEVE', 'Fine aggregate', 'Sieve analysis, zone and fineness modulus of fine aggregate', 'Sieve analysis', 'IS 2386 (Part 1) : 1963 RA 2021', 700, 'FA-SIEVE'),
  t('FA-SG', 'Fine aggregate', 'Specific gravity and water absorption of fine aggregate', 'Specific gravity and water absorption', 'IS 2386 (Part 3) : 1963 RA 2021', 700, 'FA-SG', 3),
  t('FA-BD', 'Fine aggregate', 'Bulk density and voids of fine aggregate', 'Bulk density', 'IS 2386 (Part 3) : 1963 RA 2021', 600, 'FA-BD'),
  t('FA-BULKING', 'Fine aggregate', 'Bulking of sand', 'Bulking of sand', 'IS 2386 (Part 3) : 1963 RA 2021', 400, 'FA-BULKING', 1),
  t('FA-DEL', 'Fine aggregate', 'Material finer than 75 µm (silt content) and clay lumps in fine aggregate', 'Deleterious materials', 'IS 2386 (Part 1 & 2) : 1963 RA 2021', 700, 'FA-DEL'),
  t('FA-SOUND', 'Fine aggregate', 'Soundness of fine aggregate (5 cycles)', 'Soundness', 'IS 2386 (Part 5) : 1963 RA 2021', 3000, 'FA-SOUND', 8),
  // Cement
  t('CEM-NC', 'Cement', 'Standard consistency of cement', 'Standard consistency', 'IS 4031 (Part 4) : 1988 RA 2019', 500, 'CEM-NC', 1),
  t('CEM-SET', 'Cement', 'Initial and final setting time of cement', 'Setting time', 'IS 4031 (Part 5) : 1988 RA 2019', 900, 'CEM-SET', 1),
  t('CEM-BLAINE', 'Cement', 'Fineness of cement by Blaine air permeability', 'Fineness (Blaine)', 'IS 4031 (Part 2) : 1999 RA 2018', 1000, 'CEM-BLAINE'),
  t('CEM-SIEVE', 'Cement', 'Fineness of cement by dry sieving (90 µm)', 'Fineness (90 µm residue)', 'IS 4031 (Part 1) : 1996 RA 2021', 400, 'CEM-SIEVE', 1),
  t('CEM-SOUND', 'Cement', 'Soundness of cement (Le Chatelier / autoclave)', 'Soundness', 'IS 4031 (Part 3) : 1988 RA 2019', 900, 'CEM-SOUND', 3),
  t('CEM-CS', 'Cement', 'Compressive strength of cement at 3, 7 and 28 days', 'Compressive strength', 'IS 4031 (Part 6) : 1988 RA 2019', 2000, 'CEM-CS', 29),
  t('CEM-SG', 'Cement', 'Density (specific gravity) of cement', 'Specific gravity', 'IS 4031 (Part 11) : 1988 RA 2019', 600, 'CEM-SG', 1),
  // Steel
  t('STEEL-TMT', 'Steel', 'Physical properties of TMT bars (mass, 0.2% proof stress, TS, elongation, bend, rebend)', 'Physical properties of reinforcement steel', 'IS 1608 (Part 1) & IS 1786 : 2008', 1500, 'STEEL-TMT', 2, 'Per diameter'),
  // Concrete
  t('CON-CUBE', 'Concrete', 'Compressive strength of concrete cubes (set of 3)', 'Compressive strength of concrete cubes', 'IS 516 (Part 1/Sec 1) : 2021', 600, 'CUBE-COMP', 1, 'Per set'),
  t('CON-FLEX', 'Concrete', 'Flexural strength of concrete beams (set of 3)', 'Flexural strength', 'IS 516 (Part 1/Sec 1) : 2021', 1200, 'CON-FLEX', 1, 'Per set'),
  t('CON-SPLIT', 'Concrete', 'Splitting tensile strength of concrete cylinders (set of 3)', 'Splitting tensile strength', 'IS 516 (Part 1/Sec 1) : 2021', 1200, 'CON-SPLIT', 1, 'Per set'),
  // NDT
  t('NDT-RH', 'Concrete', 'Rebound hammer test on concrete members', 'Rebound hammer test', 'IS 516 (Part 5/Sec 4) : 2020', 500, 'NDT-RH', 2, 'Per location', { report_notes: 'Compressive strength estimated from rebound number is indicative only and should be correlated with core test results.' }),
  t('NDT-UPV', 'Concrete', 'Ultrasonic pulse velocity test on concrete members', 'Ultrasonic pulse velocity test', 'IS 516 (Part 5/Sec 1) : 2018', 800, 'NDT-UPV', 2, 'Per location'),
  t('NDT-CORE', 'Concrete', 'Compressive strength of concrete cores (testing only)', 'Compressive strength of concrete cores', 'IS 516 (Part 4) : 2018', 1500, 'NDT-CORE', 2, 'Per core'),
  t('NDT-COVER', 'Concrete', 'Cover to reinforcement by cover meter', 'Cover meter survey', 'IS 456 : 2000 / IS 516 (Part 5/Sec 3)', 400, 'NDT-COVER', 2, 'Per location', { nabl: false }),
];

export const OTHER_CATALOG: CatalogSeed[] = [
  { ...t('MISC-TRN', 'Service', 'Transportation charges', '', '', 7000, null, 0, 'Per visit'), nabl: false },
];

/**
 * Bring every company up to the current template pack: add template versions it does not have,
 * add catalog items for tests that nothing in its catalog uses yet, and extend the equipment categories.
 * Existing templates, catalog items and picklist values are never changed.
 */
export async function syncTemplatePack(k: Knex = db) {
  const companies = await k('companies').select('id');
  for (const c of companies) {
    const have = new Set((await k('obs_templates').where({ company_id: c.id }).select('code', 'version')).map((r) => `${r.code}@${r.version}`));
    let added = 0;
    for (const tpl of CIVIL_LAB_TEMPLATES) {
      if (have.has(`${tpl.code}@${tpl.version}`)) continue;
      await insert(k, 'obs_templates', { company_id: c.id, code: tpl.code, version: tpl.version, definition: toJson(tpl), active: true, created_at: now() });
      added++;
    }
    const cat = await k('catalog').where({ company_id: c.id }).select('code', 'obs_template_code');
    const codes = new Set(cat.map((r) => r.code));
    const used = new Set(cat.map((r) => r.obs_template_code).filter(Boolean));
    let items = 0;
    for (const item of PACK_CATALOG) {
      // link an existing item (same code, no sheet yet) to its new observation sheet
      if (codes.has(item.code) && item.obs_template_code && !used.has(item.obs_template_code)) {
        const n = await k('catalog').where({ company_id: c.id, code: item.code }).whereNull('obs_template_code').update({ obs_template_code: item.obs_template_code });
        if (n) { used.add(item.obs_template_code); items++; }
        continue;
      }
      if (codes.has(item.code) || (item.obs_template_code && used.has(item.obs_template_code))) continue;
      await insert(k, 'catalog', { ...item, company_id: c.id, sac: '998346', gst_rate: 18, active: true, created_at: now() });
      items++;
    }
    const saved = await k('meta').where({ company_id: c.id, kind: 'picklist', key: 'equipment_category' }).first();
    if (saved) {
      const data = parseJson<{ values: { value: string; active: boolean }[] }>(saved.data, { values: [] });
      const missing = EQUIPMENT_CATEGORIES.filter((v) => !data.values.some((x) => x.value === v));
      if (missing.length) {
        data.values.push(...missing.map((value) => ({ value, active: true })));
        await k('meta').where({ id: saved.id }).update({ data: toJson(data), updated_at: now() });
        invalidateMeta(c.id);
      }
    }
    if (added || items) console.log(`template pack: company ${c.id} – ${added} template versions and ${items} catalog items added`);
  }
}
