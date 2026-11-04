import type { ObservationTemplate } from '../observation';
import { V1_TEMPLATES } from './civil-lab-v1';
import { NDT_TEMPLATES } from './ndt';
import { AGGREGATE_TEMPLATES } from './aggregate';
import { CEMENT_TEMPLATES } from './cement';
import { STEEL_TEMPLATES } from './steel';
import { CONCRETE_TEMPLATES } from './concrete';
import { SOIL_TEMPLATES } from './soil';
import { SOIL_FIELD_TEMPLATES } from './soil-field';
import { WATER_TEMPLATES } from './water';

export * from './civil-lab-v1';

/**
 * Civil testing laboratory pack. Older versions stay in the list so existing tests keep
 * their template; new tests always use the highest version of a code.
 */
export const CIVIL_LAB_TEMPLATES: ObservationTemplate[] = [
  ...V1_TEMPLATES, ...SOIL_TEMPLATES, ...SOIL_FIELD_TEMPLATES, ...AGGREGATE_TEMPLATES, ...CEMENT_TEMPLATES, ...STEEL_TEMPLATES, ...CONCRETE_TEMPLATES, ...NDT_TEMPLATES, ...WATER_TEMPLATES,
];

/** Latest version of every template code. */
export const LATEST_TEMPLATES: ObservationTemplate[] = Object.values(
  CIVIL_LAB_TEMPLATES.reduce<Record<string, ObservationTemplate>>((m, t) => { if (!m[t.code] || m[t.code].version < t.version) m[t.code] = t; return m; }, {}),
);

export const TEMPLATE_CATEGORIES = ['Soil', 'Soil field tests', 'Coarse aggregate', 'Fine aggregate', 'Cement', 'Steel', 'Concrete', 'NDT', 'Water'];
