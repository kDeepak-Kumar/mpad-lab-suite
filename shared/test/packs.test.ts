import { describe, expect, it } from 'vitest';
import { CIVIL_LAB_TEMPLATES, evaluateObservation, exampleInput, pickValue, renderSampleCalc, emptyInput, isError, references, type ObservationTemplate } from '../src';

const all = CIVIL_LAB_TEMPLATES as ObservationTemplate[];

function formulaNames(t: ObservationTemplate): string[] {
  const out: string[] = [];
  for (const d of t.derived) out.push(d.formula);
  for (const g of t.grids) for (const c of g.columns) if (c.formula) out.push(c.formula);
  for (const r of t.results) out.push(r.formula);
  for (const c of t.checks) out.push(c.when);
  for (const r of t.reportRows) if (r.specFormula) out.push(r.specFormula);
  return out;
}

describe('template pack', () => {
  it('has unique code+version', () => {
    const keys = all.map((t) => `${t.code}@${t.version}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  for (const t of all) {
    describe(`${t.code} v${t.version}`, () => {
      it('only references known names', () => {
        const known = new Set<string>([
          ...t.headerFields.map((f) => f.key), ...t.constants.map((c) => c.key), ...t.derived.map((d) => d.key), ...t.results.map((r) => r.key),
          ...t.grids.flatMap((g) => g.columns.flatMap((c) => [c.key, `${g.key}.${c.key}`])),
          ...Object.entries(t.tables ?? {}).flatMap(([n, cols]) => Object.keys(cols).map((c) => `${n}.${c}`)), '_row',
        ]);
        for (const f of formulaNames(t)) for (const n of references(f)) expect(known.has(n), `${t.code}: unknown name "${n}" in ${f}`).toBe(true);
        for (const rr of t.reportRows) expect(known.has(rr.result), `${t.code}: report row ${rr.name}`).toBe(true);
        for (const rt of t.reportTables ?? []) for (const c of rt.columns) expect(t.grids.find((g) => g.key === rt.grid)?.columns.some((x) => x.key === c.key), `${t.code}: table column ${c.key}`).toBe(true);
        if (t.chart) { const g = t.grids.find((x) => x.key === t.chart!.grid); expect(g).toBeTruthy(); for (const k of [t.chart.x, t.chart.y, ...(t.chart.series ?? []).map((s) => s.y)]) expect(g!.columns.some((c) => c.key === k), `${t.code} chart ${k}`).toBe(true); }
      });

      it('evaluates an empty sheet without formula errors', () => {
        const res = evaluateObservation(t, emptyInput(t));
        const bad = Object.entries(res.results).filter(([, v]) => isError(v) && !['#N/A', '#DIV/0!'].includes(v.error) );
        expect(bad).toEqual([]);
        for (const [g, rows] of Object.entries(res.grids)) rows.forEach((r, i) => Object.entries(r).forEach(([k, v]) => {
          if (isError(v)) expect(['#N/A', '#DIV/0!'], `${t.code} ${g}[${i}].${k} = ${v.error}`).toContain(v.error);
        }));
      });

      if (t.example) {
        it('worked example gives the documented results', () => {
          const res = evaluateObservation(t, exampleInput(t));
          for (const [ref, want] of Object.entries(t.example!.expect)) {
            const got = pickValue(res, ref);
            if (typeof want === 'number') {
              expect(typeof got, `${t.code} ${ref} = ${JSON.stringify(got)}`).toBe('number');
              expect(Math.abs((got as number) - want), `${t.code} ${ref}: got ${got}, want ${want}`).toBeLessThanOrEqual(Math.max(0.011, Math.abs(want) * 0.002));
            } else expect(got, `${t.code} ${ref}`).toBe(want);
          }
          for (const [g, rows] of Object.entries(res.grids)) rows.forEach((r, i) => Object.entries(r).forEach(([k, v]) => {
            if (isError(v)) expect(['#N/A', '#DIV/0!'], `${t.code} ${g}[${i}].${k} = ${v.error}`).toContain(v.error);
          }));
          expect(res.errors).toEqual([]);
          const text = renderSampleCalc(t).join('\n');
          expect(text).not.toMatch(/#(NAME|SYNTAX|VALUE|REF)/);
        });
      }
    });
  }
});
