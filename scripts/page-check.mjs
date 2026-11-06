// Report page-layout check: builds draft reports of growing length and verifies the A4 page plan and the PDF.
//   node scripts/page-check.mjs http://localhost:4211 [/tmp/out]
//   Optional: LH_HEADER=header.png LH_FOOTER=footer.png to test with uploaded letterhead images.
// Rules checked for every length:
//   1. one page whenever the content fits (or fits at ≥ 88 % size)
//   2. on several pages, no page starts with the signature and the last page carries more than the signature
//   3. every page except the last is reasonably filled (≥ 45 %), and the last page holds ≥ 15 % of a page
//   4. the downloaded PDF has exactly the planned number of A4 pages at 300 dpi
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.argv[2] ?? 'http://localhost:4211';
const OUT = process.argv[3] ?? '/tmp/page-check';
fs.mkdirSync(OUT, { recursive: true });
const sessions = {};
async function login(u) {
  if (sessions[u]) return sessions[u];
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${u}@demo.lab`, password: 'Demo@12345' }) });
  if (!r.ok) throw new Error(`login ${u}: ${r.status}`);
  return (sessions[u] = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '));
}
async function api(u, method, path, body) {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'content-type': 'application/json', cookie: await login(u) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path}: ${j.error ?? r.status}`);
  return j;
}
let failures = 0;
const check = (ok, msg) => { console.log(ok ? '  ✓' : '  ✗', msg); if (!ok) failures++; };
const today = new Date().toISOString().slice(0, 10);

// ---------- set up: letterhead + draft reports ----------
if (process.env.LH_HEADER) {
  const du = (f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
  const prof = { mode: 'image', headerImage: du(process.env.LH_HEADER), footerImage: process.env.LH_FOOTER ? du(process.env.LH_FOOTER) : null, edgeMm: 5 };
  await api('owner', 'PUT', '/company', { letterheads: { nabl: prof, standard: prof } });
  console.log('Using uploaded letterhead images');
}
const catalog = await api('owner', 'GET', '/catalog');
async function draftReport(codes) {
  const cats = codes.map((c) => catalog.find((x) => x.code === c)).filter(Boolean);
  const q = await api('reviewer', 'POST', '/quick-reports', { customer: { name: 'A R K BUILDERS', address: 'Plot 12, Kompally\nHyderabad' }, material: cats[0].material, received_date: today, tests: cats.map((c) => c.id), source: 'Sample supplied by the customer' });
  const qd = await api('reviewer', 'GET', `/quick-reports/${q.id}`);
  for (const t of qd.tests) {
    const full = await api('reviewer', 'GET', `/tests/${t.id}`);
    const ex = full.template.example?.input ?? { header: {}, grids: {} };
    const grids = {};
    for (const g of full.template.grids) { const base = g.fixedRows ?? Array.from({ length: g.rows ?? 5 }, () => ({})); const rows = ex.grids?.[g.key] ?? []; grids[g.key] = Array.from({ length: Math.max(base.length, rows.length) }, (_, i) => ({ ...(base[i] ?? {}), ...(rows[i] ?? {}) })); }
    await api('reviewer', 'PUT', `/tests/${t.id}/observation`, { observation: { header: { ...(ex.header ?? {}) }, constants: { ...(ex.constants ?? {}) }, grids, equipment: {} }, started_at: today, completed_at: today });
    await api('reviewer', 'POST', `/tests/${t.id}/submit`);
  }
  return (await api('reviewer', 'POST', `/quick-reports/${q.id}/report`)).id;
}
// tests whose example observations submit cleanly (some need calibrated equipment chosen first)
const withExample = catalog.filter((c) => c.obs_template_code && c.active !== false && c.active !== 0);
const usable = [];
const perMat = {};
for (const c of [...withExample].sort((a, b) => (b.code === 'SOIL-MP') - (a.code === 'SOIL-MP'))) {
  if ((perMat[c.material] ?? 0) >= 2) continue;
  try { await draftReport([c.code]); usable.push(c); perMat[c.material] = (perMat[c.material] ?? 0) + 1; } catch { /* needs equipment etc. */ }
}
const byMat = (m) => usable.filter((c) => c.material === m).map((c) => c.code);
const cases = [
  { name: 'short report', codes: usable.slice(0, 1).map((c) => c.code) },
  { name: 'concrete report', codes: byMat('Concrete').slice(0, 2) },
  { name: 'soil report with chart', codes: usable.some((c) => c.code === 'SOIL-MP') ? ['SOIL-MP'] : [] },
  { name: 'many tests', codes: usable.filter((c) => c.code !== 'SOIL-MP').slice(0, 6).map((c) => c.code) },
  { name: 'all usable tests', codes: usable.map((c) => c.code) },
  ...usable.filter((c) => c.code !== 'SOIL-MP').map((c) => ({ name: `single test ${c.code}`, codes: [c.code], lengths: [0, 2, 4, 6, 8, 10, 14] })),
].filter((c) => c.codes.length);
console.log('Test types used:', usable.map((c) => c.code).join(', '));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const bandIssues = [];
page.on('console', (m) => { const r = /\[export\] band \d+ (\d+)x(\d+) expected (\d+)x(\d+)/.exec(m.text()); if (r && (Math.abs(r[1] - r[3]) > 2 || Math.abs(r[2] - r[4]) > 2)) bandIssues.push(m.text()); });
await page.goto(`${BASE}/login`);
await page.getByLabel('Email').fill('owner@demo.lab'); await page.getByLabel('Password').fill('Demo@12345');
await page.getByRole('button', { name: 'Sign in' }).click(); await page.waitForURL(`${BASE}/`);

async function planFor(id) {
  await page.goto(`${BASE}/documents/${id}`);
  await page.waitForFunction(() => window.__docPlan && Date.now() - window.__docPlan.at < 5000, null, { timeout: 15000 });
  await page.waitForTimeout(900);
  return page.evaluate(() => window.__docPlan);
}
async function pdfPages(name) {
  await page.getByRole('button', { name: 'Export' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download PDF' }).click()]);
  const f = `${OUT}/${name}.pdf`; await dl.saveAs(f);
  const info = execFileSync('pdfinfo', [f]).toString();
  const imgs = execFileSync('pdfimages', ['-list', f]).toString();
  return { pages: Number(/Pages:\s+(\d+)/.exec(info)[1]), a4: /595\.\d+ x 841\.\d+/.test(info), dpi300: imgs.split('\n').slice(2).filter(Boolean).every((l) => / 2480 +3507 /.test(l)) };
}

for (const c of cases) {
  console.log(`\n${c.name} (${c.codes.join(', ')})`);
  const id = await draftReport(c.codes);
  const doc = await api('owner', 'GET', `/documents/${id}`);
  let lastPages = 0;
  for (const n of c.lengths ?? [0, 3, 6, 9, 12, 15, 18, 21, 24, 30, 36, 45, 60, 80]) {
    const remarks = Array.from({ length: n }, (_, i) => `Remark line ${i + 1}: observed values are within the limits specified in the relevant IS code.`).join('\n');
    await api('owner', 'PUT', `/documents/${id}`, { data: { ...doc.data, remarks } });
    const P = await planFor(id);
    const { plan, layout: L, signatureTop } = P;
    const pages = plan.slices.length;
    const content = L.contentEnd - L.headerBottom, one = plan.pageH - plan.headH - plan.footH;
    const tag = `${n} remark lines: ${pages} page(s)${plan.scale < 1 ? ` at ${Math.round(plan.scale * 100)} %` : ''}`;
    if (content * 0.88 <= one) check(pages === 1, `${tag} – fits on one page`);
    else {
      const avail = one - 16;
      const startsWithSig = signatureTop !== null && plan.slices.some(([a], i) => i > 0 && Math.abs(a - signatureTop) < 12);
      const lastOnlySig = signatureTop !== null && plan.slices[pages - 1][0] >= signatureTop - 10;
      const fills = plan.slices.map(([a, b]) => (b - a) / avail);
      check(pages >= 2 && !startsWithSig && !lastOnlySig, `${tag} – signature stays with content`);
      check(fills.slice(0, -1).every((f) => f >= 0.45) && fills[pages - 1] >= 0.15, `${tag} – pages filled ${fills.map((f) => `${Math.round(f * 100)}%`).join(' / ')}`);
    }
    if (pages !== lastPages || n === 0) { // PDF matches the plan whenever the page count changes
      const pdf = await pdfPages(`${c.name.replace(/\W+/g, '-')}-${n}`);
      check(pdf.pages === pages && pdf.a4 && pdf.dpi300, `${tag} – PDF has ${pdf.pages} A4 page(s) at 300 dpi`);
      lastPages = pages;
    }
  }
}
await browser.close();
check(!bandIssues.length, `export pictures drawn at full 300 dpi size${bandIssues.length ? `: ${bandIssues.slice(0, 2).join(' | ')}` : ''}`);
check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
console.log(failures ? `\nPAGE CHECK FAILED (${failures})` : '\nPAGE CHECK PASSED');
process.exit(failures ? 1 : 0);
