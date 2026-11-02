// Template pack check: for every material group, registers a sample, enters each test's worked example
// through the API as a technician would, accepts it, prepares the report and saves screenshots of
// the observation sheets and the report so their layout can be reviewed.
//   node scripts/pack-check.mjs http://localhost:4000 ./screenshots/pack
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://localhost:4000';
const out = process.argv[3] || './screenshots/pack';
fs.mkdirSync(out, { recursive: true });
const problems = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
await page.goto(`${base}/login`);
await page.getByLabel('Email').fill('admin@demo.lab');
await page.getByLabel('Password').fill(process.env.DEMO_PASSWORD || 'Demo@12345');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL(`${base}/`);
const api = async (path, body, method) => {
  const r = await page.evaluate(async ([p, b, m]) => { const r = await fetch('/api' + p, { method: m || (b ? 'POST' : 'GET'), headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }); return { ok: r.ok, j: await r.json() }; }, [path, body, method]);
  if (!r.ok) throw new Error(`${method || (body ? 'POST' : 'GET')} ${path}: ${r.j.error}`);
  return r.j;
};

const catalog = await api('/catalog');
const equipment = await api('/equipment');
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const groups = {
  soil: ['Soil', ['SOIL-MC', 'SOIL-SG', 'SOIL-GR', 'SOIL-AL', 'SOIL-SL', 'SOIL-MP', 'SOIL-FSI', 'SOIL-UCS', 'SOIL-DST', 'FLD-CC', 'FLD-SR']],
  coarse: ['Coarse aggregate', ['CA-SIEVE', 'CA-FLAKY', 'CA-AIV', 'CA-ACV', 'CA-LAA', 'CA-SG', 'CA-BD', 'CA-SOUND', 'CA-10FINES', 'CA-DEL']],
  fine: ['Fine aggregate', ['FA-SIEVE', 'FA-SG', 'FA-BD', 'FA-BULKING', 'FA-DEL', 'FA-SOUND']],
  cement: ['Cement', ['CEM-NC', 'CEM-SET', 'CEM-BLAINE', 'CEM-SIEVE', 'CEM-SOUND', 'CEM-CS', 'CEM-SG']],
  steel: ['Steel', ['STEEL-TMT']],
  concrete: ['Concrete', ['CON-CUBE', 'CON-FLEX', 'CON-SPLIT']],
  ndt: ['Concrete', ['NDT-RH', 'NDT-UPV', 'NDT-CORE', 'NDT-COVER']],
  plate: ['Soil', ['FLD-PLT', 'FLD-PLT']],
  boreholes: ['Soil', ['FLD-BH', 'FLD-BH', 'FLD-SPT', 'SBC-SPT', 'SBC-SHEAR']],
  piles: ['Pile / pier', ['PILE-UP', 'PILE-LAT']],
};
const today = new Date().toLocaleDateString('en-CA');
for (const [name, [material, codes]] of Object.entries(groups).filter(([n]) => !only || only.includes(n))) {
  const cats = codes.map((c) => catalog.find((x) => x.code === c)).filter(Boolean);
  if (cats.length !== codes.length) problems.push(`${name}: catalog items missing (${codes.filter((c) => !catalog.some((x) => x.code === c)).join(', ')})`);
  const s = await api('/samples', { client_id: 1, site_id: 1, accreditation: 'NABL', material, received_date: today, quantity: '1 lot', condition: 'Good', source: 'Sample supplied by the customer', tests: cats.map((c) => ({ catalog_id: c.id })) });
  const tests = (await api('/tests?status=pending')).filter((t) => t.sample_id === s.id);
  // typing check: decimals typed key by key must stay as typed in every sheet (cells, inputs and constants)
  for (const t of tests) {
    await page.goto(`${base}/tests/${t.id}`); await page.waitForLoadState('networkidle');
    const cell = page.locator('table.grid-input input[inputmode="decimal"]').first();
    if (await cell.count()) {
      await cell.click(); await cell.fill(''); await cell.pressSequentially('12.05');
      const v = await cell.inputValue();
      if (v !== '12.05') problems.push(`${t.template_code}: typed 12.05 in a reading cell, got "${v}"`);
      await cell.fill(''); await cell.pressSequentially('3,5');
      if (await cell.evaluate((el) => el.classList.contains('bad'))) problems.push(`${t.template_code}: decimal comma 3,5 flagged as invalid`);
      await cell.fill(''); await cell.pressSequentially('abc');
      if (!(await cell.evaluate((el) => el.classList.contains('bad')))) problems.push(`${t.template_code}: text "abc" in a number cell was not flagged`);
      await cell.fill('');
    }
    const konst = page.locator('.mantine-Paper-root:has-text("Constants") input[inputmode="decimal"]').first();
    if (await konst.count()) { await konst.click(); await konst.pressSequentially('0.25'); const v = await konst.inputValue(); if (v !== '0.25') problems.push(`${t.template_code}: typed 0.25 in a constant, got "${v}"`); await konst.fill(''); }
  }
  const seen = {};
  for (const t of tests) {
    const full = await api(`/tests/${t.id}`);
    const tpl = full.template;
    const ex = tpl.example?.input ?? { header: {}, grids: {} };
    const grids = {};
    for (const g of tpl.grids) {
      const baseRows = g.fixedRows ?? Array.from({ length: g.rows ?? 5 }, () => ({}));
      const rows = ex.grids?.[g.key] ?? [];
      grids[g.key] = Array.from({ length: Math.max(baseRows.length, rows.length) }, (_, i) => ({ ...(baseRows[i] ?? {}), ...(rows[i] ?? {}) }));
    }
    const eq = {};
    if (!Object.keys(ex.constants ?? {}).length) for (const slot of tpl.equipment ?? []) { const e = equipment.find((x) => x.category === slot.category); if (e) eq[slot.key] = { id: e.id }; }
    const occ = (seen[tpl.code] = (seen[tpl.code] ?? 0) + 1);
    const hdr = { ...(ex.header ?? {}) };
    if (occ > 1) { if ('test_no' in hdr) hdr.test_no = String(occ); if ('bh' in hdr) hdr.bh = `BH-${occ}`; if ('location' in hdr) hdr.location = `${hdr.location} (${occ})`;
      for (const rows of Object.values(grids)) for (const r of rows) for (const k of ['dg1', 'dg2', 'p2', 'p3']) if (typeof r[k] === 'number' && r[k] > 0) r[k] = Math.round(r[k] * (k.startsWith('dg') ? 1.25 : 1.2));
      if (grids.st) grids.st = [{ from: 0, to: 2, soil: 'Filled-up soil', desc: 'brown' }, { from: 2, to: 5, soil: 'Black cotton soil', desc: 'stiff' }, { from: 5, to: 8, soil: 'Gravelly soil (murrum)', desc: 'dense' }, { from: 8, to: 12, soil: 'Weathered rock', desc: 'grey' }]; }
    const obs = { header: hdr, constants: { ...(ex.constants ?? {}) }, equipment: eq, grids };
    const res = await api(`/tests/${t.id}/observation`, { observation: obs, started_at: today, completed_at: today }, 'PUT');
    for (const [ref, want] of Object.entries(tpl.example?.expect ?? {})) {
      if (occ > 1 || ref.includes('#') || !tpl.results.some((r) => r.key === ref)) continue;
      const got = res.results[ref];
      const okv = typeof want === 'number' ? typeof got === 'number' && Math.abs(got - want) <= Math.max(0.011, Math.abs(want) * 0.002) : got === want;
      if (!okv) problems.push(`${tpl.code}: ${ref} = ${JSON.stringify(got)} (expected ${want})`);
    }
    await api(`/tests/${t.id}/submit`, {});
    await api(`/tests/${t.id}/review`, { action: 'accept' });
    await page.goto(`${base}/tests/${t.id}`); await page.waitForLoadState('networkidle'); await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/sheet-${tpl.code}.png`, fullPage: true });
  }
  const rep = await api('/reports', { testIds: tests.map((t) => t.id) });
  await page.goto(`${base}/documents/${rep.id}`); await page.waitForLoadState('networkidle'); await page.waitForTimeout(800);
  await page.locator('.doc-page').screenshot({ path: `${out}/report-${name}.png` });
  const text = await page.locator('.doc-page').innerText();
  if (/#(NAME|VALUE|REF|SYNTAX|DIV)/.test(text)) problems.push(`${name} report shows a formula error`);
  console.log(`  ✓ ${name}: ${tests.length} tests, report draft #${rep.id}`);
}
await browser.close();
if (problems.length) { console.log('\nPROBLEMS:\n' + problems.join('\n')); process.exit(1); }
console.log('\nPACK CHECK PASSED');
