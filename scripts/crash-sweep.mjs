// Crash sweep: opens every screen, record, template and settings section, makes and saves changes,
// and reports any page error, error screen or blank page.
//   node scripts/crash-sweep.mjs http://localhost:4000
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://localhost:4000';
const PASS = 'Demo@12345';
const problems = [];
let steps = 0;
const browser = await chromium.launch();
process.on('SIGTERM', () => { console.log(`STOPPED after ${steps} checks`); if (problems.length) console.log('PROBLEMS SO FAR:\n' + [...new Set(problems)].join('\n')); process.exit(1); });

async function session(user) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => problems.push(`[${user}] ${p.url().replace(base, '')} :: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && /TypeError|ReferenceError|Cannot read|is not a function|Minified React/.test(m.text())) problems.push(`[${user}] ${p.url().replace(base, '')} :: console ${m.text().slice(0, 200)}`); });
  await p.goto(`${base}/login`); await p.getByLabel('Email').fill(`${user}@demo.lab`); await p.getByLabel('Password').fill(PASS);
  await p.getByRole('button', { name: 'Sign in' }).click(); await p.waitForURL(`${base}/`);
  return p;
}
const api = (p, path, body, method) => p.evaluate(async ([pa, b, m]) => { const r = await fetch('/api' + pa, { method: m || (b ? 'POST' : 'GET'), headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => null); }, [path, body, method]);
async function check(p, label) {
  steps++;
  await p.waitForTimeout(450);
  const crashed = await p.getByText('This screen ran into a problem').count();
  const root = (await p.locator('#root').innerText().catch(() => '')).trim();
  if (crashed) problems.push(`${label} :: error screen – ${(await p.locator('code').first().innerText().catch(() => '')).slice(0, 160)}`);
  else if (root.length < 20) problems.push(`${label} :: blank page`);
}
async function visit(p, path, label = path) { await p.goto(base + path, { waitUntil: 'domcontentloaded' }); await p.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {}); await check(p, label); if (steps % 25 === 0) console.log(`… ${steps} checks, ${problems.length} problems (${label})`); }
async function clickThen(p, locator, label, after) { try { if (await locator.count()) { await locator.first().click({ timeout: 3000 }); await p.waitForTimeout(700); await check(p, label); if (after) await after(); } } catch (e) { problems.push(`${label} :: could not click (${e.message.split('\n')[0]})`); } }
const esc = async (p) => { await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(250); };

// ---------- owner: everything ----------
const o = await session('owner');
const ROUTES = ['/', '/analytics', '/clients', '/quotes', '/quotes/new', '/invoices', '/invoices/new', '/reports', '/reports/prepare', '/workorders', '/samples', '/samples?new=1', '/tests',
  '/followups', '/payments', '/payments?new=1', '/ledger', '/gst', '/registers', '/outsourcing', '/purchases', '/purchases?tab=vendors', '/contract-review', '/equipment',
  '/settings/catalog', '/settings/templates', '/settings/users', '/setup', '/setup?tab=picklists', '/setup?tab=roles', '/setup?tab=sharing', '/account'];
for (const r of ROUTES) await visit(o, r);
for (const sec of ['profile', 'branding', 'letterheads', 'docs', 'bank', 'numbering', 'defaults', 'terms', 'signatories', 'email', 'whatsapp', 'security', 'ai']) await visit(o, `/settings/company?section=${sec}`);
for (const t of ['Saved reports', 'Report builder']) { await visit(o, '/analytics'); await clickThen(o, o.getByRole('tab', { name: t }), `/analytics tab ${t}`); }

// every record
const docs = await api(o, '/documents');
for (const kind of ['quote', 'invoice', 'report']) for (const d of docs.filter((x) => x.kind === kind).slice(0, 3)) {
  await visit(o, `/documents/${d.id}`, `${kind} ${d.number ?? d.id}`);
  for (const tab of ['Layout', 'History']) await clickThen(o, o.getByRole('tab', { name: tab }), `${kind} ${d.id} tab ${tab}`);
  for (const [menu, item] of [['Share', 'Email…'], ['Share', 'WhatsApp…'], ['More actions', 'Sharing & access…'], ['More actions', 'Duplicate…']]) {
    const m = o.getByRole('button', { name: menu, exact: true });
    if (await m.count()) { await esc(o); await m.first().click().catch(() => {}); await o.waitForTimeout(400); await clickThen(o, o.getByRole('menuitem', { name: item, exact: true }), `${kind} ${d.id} ${item}`, () => esc(o)); await esc(o); }
  }
}
const clients = await api(o, '/clients');
for (const c of clients.slice(0, 3)) {
  await visit(o, `/clients/${c.id}`, `client ${c.name}`);
  for (const tab of ['Quotations', 'Samples & reports', 'Invoices', 'Ledger', 'Follow-ups', 'Timeline']) await clickThen(o, o.getByRole('tab', { name: new RegExp(`^${tab}`) }), `client ${c.id} tab ${tab}`);
  await visit(o, `/ledger/${c.id}`, `ledger ${c.name}`);
}
for (const w of (await api(o, '/workorders')).slice(0, 2)) await visit(o, `/workorders/${w.id}`, `work order ${w.id}`);
for (const s of (await api(o, '/samples')).slice(0, 3)) await visit(o, `/samples?open=${s.id}`, `sample ${s.code}`);
for (const t of (await api(o, '/tests')).slice(0, 6)) await visit(o, `/tests/${t.id}`, `test ${t.id}`);
for (const j of (await api(o, '/outsourcing')).slice(0, 2)) await visit(o, `/outsourcing?open=${j.id}`, `outsourced job ${j.id}`);
await visit(o, '/equipment'); await clickThen(o, o.locator('tbody tr'), 'equipment record', () => esc(o));
await visit(o, '/equipment'); await clickThen(o, o.getByRole('button', { name: 'Import' }), 'equipment import', () => esc(o));
await visit(o, '/clients'); await clickThen(o, o.getByRole('button', { name: 'Import' }), 'client import', () => esc(o));
await visit(o, '/settings/catalog'); await clickThen(o, o.locator('tbody tr'), 'rate card item', () => esc(o));
await visit(o, '/settings/users'); await clickThen(o, o.locator('tbody tr'), 'user', () => esc(o));
await visit(o, '/purchases'); await clickThen(o, o.getByRole('button', { name: 'New bill' }), 'new bill', () => esc(o));
await visit(o, '/purchases?tab=vendors'); await clickThen(o, o.getByRole('button', { name: 'New vendor' }), 'new vendor', () => esc(o));

// every document layout and observation sheet (designer)
for (const t of await api(o, '/doc-templates')) await visit(o, `/settings/templates/${t.id}`, `doc template ${t.kind} ${t.name}`);
const obs = await api(o, '/obs-templates');
for (const t of obs) await visit(o, `/settings/templates/obs/${encodeURIComponent(t.code)}`, `observation template ${t.code}`);

// list view: change fields, save as new view, update it, switch to Kanban, delete
for (const path of ['/clients', '/quotes', '/invoices', '/samples', '/equipment', '/settings/catalog', '/purchases', '/outsourcing']) {
  await visit(o, path);
  try {
    await o.getByLabel('List options').click(); await o.getByRole('menuitem', { name: /Select fields/ }).click(); await o.waitForTimeout(300);
    await o.locator('.lv-field.on button').first().click(); await o.getByRole('button', { name: 'Apply' }).click(); await check(o, `${path} fields changed`);
    await o.getByLabel('List options').click(); await o.getByRole('menuitem', { name: /Save as a new view/ }).click(); await o.getByLabel('List name').fill(`Sweep ${path} ${Date.now() % 100000}`); await o.getByRole('button', { name: 'Save', exact: true }).click();
    await o.waitForTimeout(900); await check(o, `${path} view saved`);
    const kan = o.locator('.lv-tools .mantine-SegmentedControl-root label').nth(1);
    if (await kan.count()) { await kan.click(); await check(o, `${path} kanban`); await o.getByRole('button', { name: 'Save…' }).click().catch(() => {}); await o.getByRole('button', { name: /^Update “/ }).click().catch(() => {}); await o.waitForTimeout(800); await check(o, `${path} kanban saved`); }
    await o.reload(); await check(o, `${path} reload with saved view`);
    o.once('dialog', (d) => d.accept());
    await o.getByLabel('List views').click(); await o.getByRole('menuitem', { name: 'Delete view' }).click();
    await o.waitForTimeout(900); await check(o, `${path} view deleted`);
    // tick two rows: the bulk bar appears and clears
    const boxes = o.locator('.lv-table tbody input[type=checkbox]');
    if (await boxes.count()) { await boxes.first().check(); await check(o, `${path} row selected`); await o.getByLabel('Clear selection').click(); }
  } catch (e) { problems.push(`${path} list view flow :: ${e.message.split('\n')[0]}`); }
}

// settings: change and save in each section
const stamp = String(Date.now()).slice(-5);
for (const [sec, act] of [['profile', async () => o.getByLabel('Tagline').fill(`Quality you can build on ${stamp}`)], ['whatsapp', async () => o.locator('textarea').first().type(' ')], ['terms', async () => o.getByRole('button', { name: 'Add a terms set' }).click()], ['defaults', async () => o.getByLabel('Default SAC').fill(`99${stamp}`)]]) {
  await visit(o, `/settings/company?section=${sec}`);
  try {
    await act(); await o.waitForTimeout(300);
    await o.getByRole('button', { name: 'Save changes' }).first().click({ timeout: 8000 });
    await o.getByText('Settings saved').first().waitFor({ timeout: 8000 }); await check(o, `company ${sec} saved`);
  } catch (e) { problems.push(`company ${sec} save :: ${e.message.split('\n')[0]}`); }
}
await api(o, '/company', { defaults: { ...((await api(o, '/company')).defaults ?? {}), sac: '998346' } }, 'PUT');
// setup: save a layout and a picklist
await visit(o, '/setup'); await clickThen(o, o.getByRole('button', { name: 'Save layout' }), 'setup layout saved');
await visit(o, '/setup?tab=picklists'); await clickThen(o, o.getByRole('button', { name: 'Save picklist' }), 'setup picklist saved');
await visit(o, '/setup?tab=sharing'); await clickThen(o, o.getByRole('button', { name: 'Save sharing defaults' }), 'sharing defaults saved');

// ---------- other roles: their screens ----------
for (const u of ['frontdesk', 'tech', 'reviewer', 'signatory', 'accounts']) {
  const p = await session(u);
  const me = await api(p, '/auth/me');
  for (const r of ['/', ...ROUTES.filter((x) => x !== '/')]) {
    const tab = { '/clients': 'clients', '/quotes': 'quotes', '/invoices': 'invoices', '/samples': 'samples', '/tests': 'tests', '/reports': 'reports', '/outsourcing': 'outsourcing', '/purchases': 'purchases', '/gst': 'gst', '/ledger': 'ledger', '/equipment': 'equipment', '/analytics': 'analytics' }[r];
    if (tab && !(me.role.admin || me.role.tabs.includes(tab))) continue;
    if (!tab && r !== '/' && r !== '/account') continue;
    await visit(p, r, `[${u}] ${r}`);
  }
  await p.context().close();
}

console.log(`${steps} checks`);
if (problems.length) { console.log('PROBLEMS:\n' + [...new Set(problems)].join('\n')); process.exitCode = 1; } else console.log('CRASH SWEEP PASSED');
await browser.close();
