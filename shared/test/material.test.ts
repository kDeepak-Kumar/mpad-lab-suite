import { describe, expect, it } from 'vitest';
import { materialMatches } from '../src/meta';

describe('materialMatches', () => {
  it('matches broad sample materials to specific rate-card materials', () => {
    expect(materialMatches('Aggregate', 'Coarse aggregate')).toBe(true);
    expect(materialMatches('Aggregate', 'Fine aggregate')).toBe(true);
    expect(materialMatches('Sand', 'Fine aggregate')).toBe(true);
    expect(materialMatches('Concrete', 'Concrete')).toBe(true);
    expect(materialMatches('Brick / Block', 'Brick')).toBe(true);
  });
  it('keeps other materials apart', () => {
    expect(materialMatches('Aggregate', 'Cement')).toBe(false);
    expect(materialMatches('Soil', 'Concrete')).toBe(false);
    expect(materialMatches('Sand', 'Coarse aggregate')).toBe(false);
    expect(materialMatches('Steel', 'Water')).toBe(false);
  });
});
