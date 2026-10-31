// UI smoke test: visits every screen, drives the observation → review → report → sign flow in the browser.
//   node scripts/ui-check.mjs http://localhost:4000 ./screenshots
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
const base = process.argv[2] || 'http://localhost:4000';
const out = process.argv[3] || './screenshots';
fs.mkdirSync(out, { recursive: true });
const PASS = 'Demo@12345';
const problems = [];
const browser = await chromium.launch();

async function session(user) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`[${user}] page error: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) problems.push(`[${user}] console: ${m.text()}`); });
  await page.goto(`${base}/login`);
  await page.getByLabel('Email').fill(`${user}@demo.lab`);
  await page.getByLabel('Password').fill(PASS);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(`${base}/`);
  return page;
}
const api = async (page, path, body, method) => page.evaluate(async ([p, b, m]) => { const r = await fetch('/api' + p, { method: m || (b ? 'POST' : 'GET'), headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }); return r.json(); }, [path, body, method]);
const shot = async (page, name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}.png`, fullPage: false }); };

// ---- 1. every screen as owner
const owner = await session('owner');
const docs = await api(owner, '/documents');
const tests = await api(owner, '/tests');
const rep = docs.find((d) => d.kind === 'report'); const inv = docs.find((d) => d.kind === 'invoice'); const quote = docs.find((d) => d.kind === 'quote');
const pages = [['dashboard', '/'], ['clients', '/clients'], ['client-detail', '/clients/2'], ['quotes', '/quotes'], ['quote', `/documents/${quote.id}`], ['workorders', '/workorders'], ['workorder', '/workorders/1'],
  ['samples', '/samples'], ['tests', '/tests?tab=all'], ['test-cbr', `/tests/${tests.find((t) => t.template_code === 'CBR-LAB').id}`], ['reports', '/reports'], ['report', `/documents/${rep.id}`],
  ['invoices', '/invoices'], ['invoice', `/documents/${inv.id}`], ['payments', '/payments'], ['ledger', '/ledger'], ['statement', '/ledger/2'], ['registers', '/registers'],
  ['settings-company', '/settings/company'], ['rate-card', '/settings/catalog'], ['equipment', '/equipment'], ['templates', '/settings/templates'], ['template-designer', '/settings/templates/1'], ['users', '/settings/users'], ['prepare-report', '/reports/prepare'], ['new-quote', '/quotes/new?client=1']];
for (const [name, path] of pages) { await owner.goto(base + path); await owner.waitForLoadState('networkidle'); await shot(owner, name); }
console.log(`visited ${pages.length} screens`);

// ---- 2. build a quote in the UI
await owner.goto(`${base}/quotes/new?client=1`);
await owner.getByRole('button', { name: 'Create draft' }).click();
await owner.waitForURL(/documents\/\d+/);
await owner.getByPlaceholder('Add a test or service from the rate card…').click();
await owner.getByRole('option', { name: /plate load test on soil/i }).click();
await owner.getByPlaceholder('Add a test or service from the rate card…').click();
await owner.getByRole('option', { name: /Transportation/i }).click();
await owner.waitForTimeout(2200); // autosave
await shot(owner, 'quote-built-in-ui');
const qText = await owner.locator('.doc-page').innerText();
if (!qText.includes('Reaction load should be provided')) problems.push('quote: test condition not added to notes');
const plt = (await api(owner, '/catalog')).find((c) => /plate load test on soil/i.test(c.billing_name));
if (!qText.includes(Number(plt.rate).toLocaleString('en-IN'))) problems.push('quote: plate load rate missing');

// ---- 3. observation sheet in the UI (technician)
const fd = await session('frontdesk');
const cat = await api(fd, '/catalog');
const users = await api(owner, '/users');
const s = await api(fd, '/samples', { client_id: 1, site_id: 1, material: 'Soil', received_date: new Date().toLocaleDateString('en-CA'), quantity: '30 kg', condition: 'Good', source: 'Sample supplied by the customer', tests: [{ catalog_id: cat.find((c) => c.code === 'SOIL-CBR').id, assigned_to: users.find((u) => u.role === 'technician').id }] });
const tech = await session('tech');
const myTests = await api(tech, '/tests?mine=1&status=pending');
const tid = myTests.find((t) => t.sample_id === s.id).id;
await tech.goto(`${base}/tests/${tid}`);
await tech.getByRole('textbox', { name: 'Test condition' }).click(); await tech.getByRole('option', { name: 'Soaked', exact: true }).click();
await tech.getByRole('textbox', { name: 'Proving ring' }).click(); await tech.getByRole('option', { name: /PR-01/ }).click();
const prr = [0, 21.6, 28.6, 35.7, 39.5, 43.2, 45.8, 47.1, 49.3, 52.6, 55.1, 57.9];
const inputs = tech.locator('table.grid-input input');
for (let i = 0; i < prr.length; i++) await inputs.nth(i).fill(String(prr[i]));
await tech.waitForTimeout(400);
const sheet = await tech.locator('.print-root').innerText();
if (!/Reported CBR value:\s*16\.0/.test(sheet)) problems.push('observation: live CBR is not 16.0');
await shot(tech, 'observation-cbr-entered');
await tech.getByRole('button', { name: 'Submit for review' }).click();
await tech.waitForTimeout(1200);
await shot(tech, 'observation-submitted');

// ---- 4. reviewer accepts, prepares report
const rv = await session('reviewer');
await rv.goto(`${base}/tests/${tid}`);
await rv.getByRole('button', { name: 'Accept' }).click();
await rv.waitForTimeout(800);
await rv.goto(`${base}/reports/prepare`);
await rv.getByText(s.code).click();
await rv.getByRole('button', { name: /Create report draft/ }).click();
await rv.waitForURL(/documents\/\d+/);
await rv.getByLabel('Remarks / conclusion').fill('CBR value is suitable for subgrade as per project specification.');
await rv.waitForTimeout(2000);
await rv.getByRole('button', { name: 'Send for verification' }).click();
await rv.waitForTimeout(1000);
const reportUrl = rv.url();

// ---- 5. signatory verifies, signs and issues
const sg = await session('signatory');
await sg.goto(reportUrl);
await sg.getByRole('button', { name: 'Verify' }).click();
await sg.waitForTimeout(800);
sg.once('dialog', (d) => d.accept());
await sg.getByRole('button', { name: 'Sign & issue' }).click();
await sg.waitForTimeout(1500);
const rText = await sg.locator('.doc-page').innerText();
if (!rText.includes('16.0')) problems.push('report: CBR 16.0 missing');
if (!rText.includes('Clause 7.3')) problems.push('report: CBR note missing');
if (rText.includes('DRAFT')) problems.push('report: still shows DRAFT watermark after issue');
await shot(sg, 'report-issued');
await sg.screenshot({ path: `${out}/report-issued-full.png`, fullPage: true });

await browser.close();
if (problems.length) { console.log('PROBLEMS:\n' + problems.join('\n')); process.exit(1); }
console.log('UI CHECK PASSED');
