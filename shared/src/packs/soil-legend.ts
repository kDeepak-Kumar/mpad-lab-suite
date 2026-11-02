/**
 * Strata legend for borehole logs and the site profile. Each soil type has a fill colour and a hatch
 * pattern so logs stay readable in black-and-white print. Add or rename types here (or in a template's
 * strata drop-down) – unknown names are drawn with the neutral pattern.
 */
export type SoilPattern = 'cross' | 'dash' | 'dots' | 'circles' | 'brick' | 'hatch' | 'wave' | 'solid' | 'dotdash' | 'v';

export interface SoilType { name: string; color: string; pattern: SoilPattern; group: string }

export const SOIL_LEGEND: SoilType[] = [
  { name: 'Filled-up soil', color: '#e8d9a8', pattern: 'cross', group: 'Made ground' },
  { name: 'Top soil', color: '#c9b48a', pattern: 'v', group: 'Made ground' },
  { name: 'Black cotton soil', color: '#7c7c7c', pattern: 'dash', group: 'Cohesive' },
  { name: 'Clay (CH)', color: '#a7b6c8', pattern: 'dash', group: 'Cohesive' },
  { name: 'Clay (CI)', color: '#b7c4d3', pattern: 'dash', group: 'Cohesive' },
  { name: 'Clay (CL)', color: '#c7d2de', pattern: 'dash', group: 'Cohesive' },
  { name: 'Cohesive soil', color: '#b0bccb', pattern: 'dash', group: 'Cohesive' },
  { name: 'Silt', color: '#d8d0c0', pattern: 'dotdash', group: 'Cohesive' },
  { name: 'Silty sand', color: '#e9dfb7', pattern: 'dotdash', group: 'Granular' },
  { name: 'Clayey sand', color: '#e3d8b5', pattern: 'dotdash', group: 'Granular' },
  { name: 'Sand', color: '#f3e5a8', pattern: 'dots', group: 'Granular' },
  { name: 'Gravelly soil (murrum)', color: '#e9c79a', pattern: 'circles', group: 'Granular' },
  { name: 'Gravel', color: '#e2b98a', pattern: 'circles', group: 'Granular' },
  { name: 'Soft disintegrated rock (SDR)', color: '#f6c99b', pattern: 'hatch', group: 'Rock' },
  { name: 'Weathered rock', color: '#d9a679', pattern: 'hatch', group: 'Rock' },
  { name: 'Hard rock', color: '#b98a6a', pattern: 'brick', group: 'Rock' },
  { name: 'Boulders', color: '#c8a582', pattern: 'circles', group: 'Rock' },
  { name: 'Concrete', color: '#cfcfcf', pattern: 'solid', group: 'Other' },
];

export const SOIL_NAMES = SOIL_LEGEND.map((s) => s.name);

export const soilStyle = (name: string): SoilType =>
  SOIL_LEGEND.find((s) => s.name.toLowerCase() === name.toLowerCase())
  ?? SOIL_LEGEND.find((s) => name.toLowerCase().includes(s.name.toLowerCase().split(' (')[0]))
  ?? { name, color: '#e5e7eb', pattern: 'dots', group: 'Other' };
