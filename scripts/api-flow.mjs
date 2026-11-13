// End-to-end API smoke test of the whole workflow. Run against a fresh demo database:
//   node scripts/api-flow.mjs http://localhost:4000
const base = process.argv[2] || 'http://localhost:4000';
const PASS = process.env.DEMO_PASSWORD || 'Demo@12345';
const sessions = {};
async function as(user) {
  if (sessions[user]) return sessions[user];
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${user}@demo.lab`, password: PASS }) });
  if (!r.ok) throw new Error(`login ${user}: ${await r.text()}`);
  sessions[user] = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return sessions[user];
}
async function api(user, method, path, body) {
  const r = await fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json', cookie: await as(user) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${user} ${method} ${path}: ${j.error}`);
  return j;
}
const expect = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('  ✓', msg); };

const clients = await api('owner', 'GET', '/clients');
const client = clients.find((c) => c.state_code === '27');
const detail = await api('owner', 'GET', `/clients/${client.id}`);
const catalog = await api('owner', 'GET', '/catalog');
const byCode = (c) => catalog.find((x) => x.code === c);
const users = await api('owner', 'GET', '/users');
const tech = users.find((u) => u.role === 'technician');

console.log('1. Quotation');
const lines = ['SOIL-MP', 'SOIL-GR', 'SOIL-AL', 'SOIL-FSI', 'SOIL-CBR'].map((c) => { const k = byCode(c); return { description: k.billing_name, rate: k.rate, qty: 1, unit: k.unit, remarks: k.nabl ? 'NABL' : 'Non-NABL', catalogId: k.id }; });
const q = await api('frontdesk', 'POST', '/documents', { kind: 'quote', client_id: client.id, site_id: detail.sites[0].id, contact_id: detail.contacts[0].id, data: { mode: 'estimate', lines, customerRef: 'Verbal' } });
const qd = await api('frontdesk', 'GET', `/documents/${q.id}`);
expect(qd.number && qd.totals.igst > 0 && qd.totals.cgst === 0, `quote ${qd.number} uses IGST for out-of-state client (total ₹${qd.totals.total})`);
await api('frontdesk', 'POST', `/documents/${q.id}/status`, { status: 'sent' });
let failed = false; try { await api('frontdesk', 'PUT', `/documents/${q.id}`, { data: { notes: 'x' } }); } catch { failed = true; }
expect(failed, 'sent quotation is locked (revision required)');

console.log('2. Work order and sample register');
const wo = await api('frontdesk', 'POST', `/documents/${q.id}/to-workorder`);
expect(wo.number, `work order ${wo.number} created from accepted quote`);
const s = await api('frontdesk', 'POST', '/samples', { work_order_id: wo.id, client_id: client.id, site_id: detail.sites[0].id, material: 'Soil', description: 'Soil sample from borrow area', quantity: '30 kg', condition: 'Satisfactory', source: 'Sample supplied by the customer', received_date: new Date().toISOString().slice(0, 10), customer_ref: 'Verbal', tests: lines.map((l) => ({ catalog_id: l.catalogId, assigned_to: tech.id })) });
expect(s.code && !s.ulr, `sample ${s.code} registered (the ULR comes with the issued report, not the sample)`);

console.log('3. Observation sheets (technician)');
const queue = await api('tech', 'GET', '/tests?mine=1&status=pending');
const tests = queue.filter((t) => t.sample_id === s.id);
expect(tests.length === 5, '5 tests in technician queue');
const eq = (await api('owner', 'GET', '/equipment')).find((e) => e.category === 'Proving ring');
const today = new Date().toISOString().slice(0, 10);
for (const t of tests) {
  const full = await api('tech', 'GET', `/tests/${t.id}`);
  const code = full.template.code;
  // every pack template carries a worked example; enter it the way a technician would
  const ex = full.template.example?.input ?? { header: {}, grids: {} };
  const grids = {};
  for (const g of full.template.grids) {
    const base = g.fixedRows ?? Array.from({ length: g.rows ?? 5 }, () => ({}));
    const rows = ex.grids?.[g.key] ?? [];
    grids[g.key] = Array.from({ length: Math.max(base.length, rows.length) }, (_, i) => ({ ...(base[i] ?? {}), ...(rows[i] ?? {}) }));
  }
  const obs = { header: { ...(ex.header ?? {}) }, constants: { ...(ex.constants ?? {}) }, grids, equipment: {} };
  if (code === 'CBR-LAB') obs.equipment = { ring: { id: eq.id } };
  const res = await api('tech', 'PUT', `/tests/${t.id}/observation`, { observation: obs, started_at: today, completed_at: today });
  if (code === 'CBR-LAB') expect(Math.abs(res.results.cbr - 16.01) < 0.01, `CBR computed ${res.results.cbr.toFixed(2)}% (expected 16.0)`);
  await api('tech', 'POST', `/tests/${t.id}/submit`);
}
failed = false; try { await api('tech', 'POST', `/tests/${tests[0].id}/review`, { action: 'accept' }); } catch { failed = true; }
expect(failed, 'technician cannot review own observations');

console.log('4. Review (return one, correct, accept)');
await api('reviewer', 'POST', `/tests/${tests[0].id}/review`, { action: 'return', note: 'Check the 5th trial reading' });
const back = await api('tech', 'GET', `/tests/${tests[0].id}`);
await api('tech', 'PUT', `/tests/${tests[0].id}/observation`, { observation: back.observation, started_at: today, completed_at: today, reason: 'Re-checked, no change' });
await api('tech', 'POST', `/tests/${tests[0].id}/submit`);
for (const t of tests) await api('reviewer', 'POST', `/tests/${t.id}/review`, { action: 'accept' });
expect(true, 'all 5 observation sheets accepted');

console.log('5. Report: prepare → verify → sign & issue');
const rep = await api('reviewer', 'POST', '/reports', { testIds: tests.map((t) => t.id) });
const rd = await api('reviewer', 'GET', `/documents/${rep.id}`);
expect(rd.data.rows.length >= 9, `report draft has ${rd.data.rows.length} result rows`);
const dTables = rd.data.details.flatMap((x) => x.tables);
expect(dTables.length >= 1 && rd.data.charts?.some((c) => c.series?.length >= 1), `report carries ${dTables.length} observation table(s) and ${rd.data.charts.length} graph(s)`);
expect(rd.data.rows.some((r) => r.name === 'Soil classification (IS 1498)' && r.values[0] === 'CI'), 'Atterberg limits classify the soil as CI');
await api('reviewer', 'PUT', `/documents/${rep.id}`, { data: { remarks: 'The soil can be used for backfilling purpose.' } });
await api('reviewer', 'POST', `/reports/${rep.id}/workflow`, { action: 'submit' });
await api('signatory', 'POST', `/reports/${rep.id}/workflow`, { action: 'sendback', note: 'Add remark on CBR' });
await api('reviewer', 'POST', `/reports/${rep.id}/workflow`, { action: 'submit' });
await api('signatory', 'POST', `/reports/${rep.id}/workflow`, { action: 'verify' });
const issued = await api('signatory', 'POST', `/documents/${rep.id}/issue`);
expect(issued.number, `report ${issued.number} issued`);
{
  const rd = await api('signatory', 'GET', `/documents/${rep.id}`);
  const nabl = (rd.accreditation ?? rd.data.accreditation) === 'NABL';
  const yy = String(new Date().getFullYear()).slice(2);
  if (nabl) {
    expect(/^[A-Z0-9]+\d{2}\d\d{8}[FP]$/.test(issued.ulr ?? '') && issued.ulr.includes(yy + '0') && rd.data.ulr === issued.ulr, `NABL report gets one ULR on issue: ${issued.ulr}`);
    const band = rd.data.layout?.sections?.find((x) => x.role === 'idband');
    expect(!band || band.rows[0].some((c) => c.h.includes('{{ulr}}') || c.h.includes(issued.ulr)), 'ULR shows in the report identification band');
  } else expect(!issued.ulr, 'Non-NABL report carries no ULR');
}

console.log('6. Invoice from work order, payment, ledger');
const inv = await api('accounts', 'POST', `/workorders/${wo.id}/invoice`);
const invIssued = await api('accounts', 'POST', `/documents/${inv.id}/issue`);
const invD = await api('accounts', 'GET', `/documents/${inv.id}`);
expect(invD.total === qd.totals.total, `invoice ${invIssued.number} total ₹${invD.total} matches quote`);
failed = false; try { await api('accounts', 'POST', `/workorders/${wo.id}/invoice`); } catch { failed = true; }
expect(failed, 'tests cannot be billed twice');
const tds = Math.round(invD.totals.taxable * 0.02);
await api('accounts', 'POST', '/payments', { client_id: client.id, date: today, amount: invD.total - tds, tds, mode: 'Bank transfer', reference: 'NEFT123', allocations: [{ invoiceId: inv.id, amount: invD.total }] });
const led = await api('accounts', 'GET', `/ledger/${client.id}`);
expect(Math.abs(led.balance) < 0.01, `ledger balance is ₹${led.balance} after payment with TDS ₹${tds}`);
const paidInv = await api('accounts', 'GET', `/documents/${inv.id}`);
expect(paidInv.status === 'paid', 'invoice marked paid');

console.log('7. Registers and dashboard');
for (const r of ['quotations', 'samples', 'tests', 'reports', 'invoices', 'receipts', 'equipment']) {
  const reg = await api('owner', 'GET', `/registers/${r}`);
  expect(reg.rows.length > 0, `${r} register has ${reg.rows.length} row(s)`);
}
const dash = await api('owner', 'GET', '/dashboard');
expect(typeof dash.counts.revenueMonth === 'number', `dashboard revenue this month ₹${dash.counts.revenueMonth}`);
console.log('8. CRM follow-ups and report verification');
const fu = await api('frontdesk', 'GET', `/activities?client_id=${client.id}`);
expect(fu.some((a) => a.link_kind === 'quote' && a.link_id === q.id && !a.done_at), 'sending the quotation scheduled a follow-up call');
const act = await api('frontdesk', 'POST', '/activities', { type: 'Visit', subject: 'Site visit for NDT scope', client_id: client.id, due_date: today });
await api('frontdesk', 'PUT', `/activities/${act.id}`, { done: true, outcome: 'Scope agreed' });
expect((await api('frontdesk', 'GET', '/activities?open=1')).every((a) => a.id !== act.id), 'completed follow-up leaves the open list');
const repDoc = await api('owner', 'GET', `/documents/${rep.id}`);
const pub = await fetch(`${base}/api/public/verify/${repDoc.verify}`).then((r) => r.json());
expect(pub.status === 'Valid' && pub.number === issued.number, `QR verification shows report ${pub.number} as ${pub.status} without signing in`);
const bad = await fetch(`${base}/api/public/verify/${rep.id}-AAAAAAAAAAAAAAAA`);
expect(bad.status === 404, 'a forged verification code is rejected');
console.log('9. Discounts, validation, certificates, alerts');
const fail = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
await api('owner', 'PUT', `/clients/${client.id}`, { discount_pct: 10 });
const dq = await api('frontdesk', 'POST', '/documents', { kind: 'quote', client_id: client.id, site_id: null, data: { mode: 'estimate', lines: [{ description: 'Test', rate: 1000, qty: 2, unit: 'No.' }] } });
const dqd = await api('frontdesk', 'GET', `/documents/${dq.id}`);
expect(dqd.totals.discountPct === 10 && Math.abs(dqd.totals.taxable - 1800) < 0.01, `client discount 10 % applied on quotation (taxable ₹${dqd.totals.taxable})`);
await api('owner', 'PUT', `/clients/${client.id}`, { discount_pct: 0 });
let m = await fail(() => api('owner', 'PUT', `/clients/${client.id}`, { discount_pct: 140 }));
expect(m, `discount above 100 % rejected (${m})`);
m = await fail(() => api('owner', 'PUT', `/clients/${client.id}`, { email: 'not-an-email' }));
expect(m && /email/i.test(m), `bad client email rejected (${m})`);
m = await fail(() => api('accounts', 'POST', '/payments', { client_id: client.id, date: '2026-02-30', amount: 100, tds: 0, mode: 'Cash', allocations: [] }));
expect(m && /date/i.test(m), `impossible payment date rejected (${m})`);
m = await fail(() => api('accounts', 'POST', '/payments', { client_id: client.id, date: today, amount: 100, tds: 200, mode: 'Cash', allocations: [] }));
expect(m && /TDS/.test(m), `TDS larger than amount rejected`);
m = await fail(() => api('owner', 'PUT', `/equipment/${eq.id}`, { cal_date: '2026-05-01', due_date: '2026-01-01' }));
expect(m && /due date/i.test(m), 'calibration due date before calibration date rejected');
const pdf = Buffer.from('%PDF-1.4\n% test certificate\n').toString('base64');
const f = await api('owner', 'POST', '/files', { entity: 'equipment', entity_id: eq.id, name: 'cert.pdf', mime: 'application/pdf', data: pdf });
const files = await api('owner', 'GET', `/files?entity=equipment&entity_id=${eq.id}`);
const dl = await fetch(`${base}/api/files/${f.id}/download`, { headers: { cookie: await as('owner') } });
expect(files.length === 1 && dl.ok && (await dl.text()).startsWith('%PDF'), 'calibration certificate uploads, lists and downloads');
m = await fail(() => api('owner', 'POST', '/files', { entity: 'equipment', entity_id: eq.id, name: 'x.exe', mime: 'application/x-msdownload', data: pdf }));
expect(m, 'non-certificate file type rejected');
await api('owner', 'DELETE', `/files/${f.id}`);
await api('owner', 'PUT', `/equipment/${eq.id}`, { cal_date: '2025-01-01', due_date: '2025-12-31' });
const prev = await api('owner', 'GET', '/alerts/preview');
expect(prev.some((i) => i.kind === 'cal' && /EXPIRED/.test(i.text) && i.isNew), `alert preview lists expired calibration (${prev.length} item(s))`);
await api('owner', 'PUT', `/equipment/${eq.id}`, { cal_date: eq.cal_date, due_date: eq.due_date });
m = await fail(() => api('owner', 'POST', '/alerts/run'));
expect(m, `“Send now” explains what is missing (${m})`);
console.log('10. Two-step verification, device alerts, signatories, seal, email footer');
const { createHmac } = await import('node:crypto');
const b32 = (s) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, v = 0; const out = []; for (const ch of s.replace(/\s/g, '')) { v = (v << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const totpNow = (secret, off = 0) => { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + off)); const h = createHmac('sha1', b32(secret)).update(c).digest(); const o = h[19] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0'); };
const raw = async (path, body, cookie) => { const r = await fetch(`${base}/api${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { r, j: await r.json().catch(() => ({})), cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') }; };
const brand = await raw('/public/branding');
expect(brand.r.ok && brand.j.name, `sign-in page branding is public (${brand.j.name})`);
const setup = await api('signatory', 'POST', '/account/2fa/setup');
let en = null; for (const off of [0, -1, 1]) { try { en = await api('signatory', 'POST', '/account/2fa/enable', { code: totpNow(setup.secret, off) }); break; } catch { /* clock edge */ } }
expect(en?.backupCodes?.length === 8, 'two-step verification turns on with an authenticator code and gives 8 backup codes');
let L = await raw('/auth/login', { email: 'signatory@demo.lab', password: PASS });
expect(L.j.twoFactor === true && !/suite_sid/.test(L.cookie), 'password alone no longer signs in: a code is asked for');
L = await raw('/auth/login', { email: 'signatory@demo.lab', password: PASS, code: '000000' });
expect(L.r.status === 401, 'wrong 6-digit code is rejected');
L = await raw('/auth/login', { email: 'signatory@demo.lab', password: PASS, code: totpNow(setup.secret) });
expect(L.r.ok && /suite_sid/.test(L.cookie), 'correct code signs in');
const L2 = await raw('/auth/login', { email: 'signatory@demo.lab', password: PASS, code: en.backupCodes[0] });
const L3 = await raw('/auth/login', { email: 'signatory@demo.lab', password: PASS, code: en.backupCodes[0] });
expect(L2.r.ok && L3.r.status === 401, 'a backup code works once only');
const sec = await (await fetch(`${base}/api/account/security`, { headers: { cookie: L2.cookie } })).json();
expect(sec.devices.length >= 2 && sec.backupCodesLeft === 7, `devices are listed (${sec.devices.length}) and backup codes counted`);
const audits = await api('owner', 'GET', '/audit?entity=user&limit=50').catch(() => []);
const bell = (await (await fetch(`${base}/api/dashboard`, { headers: { cookie: L2.cookie } })).json()).reminders ?? [];
expect(bell.some((x) => x.kind === 'New sign-in'), 'sign-in from a new device shows up in the notification bell');
await fetch(`${base}/api/account/signout-others`, { method: 'POST', headers: { cookie: L2.cookie } });
const old = await fetch(`${base}/api/auth/me`, { headers: { cookie: L.cookie } });
expect(old.status === 401, '“Sign out other devices” ends older sessions');
let blocked = 0; for (let i = 0; i < 9; i++) { const x = await raw('/auth/login', { email: 'nobody@demo.lab', password: 'wrong' }); if (x.r.status === 429) blocked++; }
expect(blocked > 0, 'repeated wrong passwords are slowed down (rate limit)');
// signatories and seal
await api('owner', 'PUT', '/company', { signatories: [{ id: 'sdir', name: 'Test Director', designation: 'Director', qualifications: 'B.E (Civil)', signature: 'data:image/png;base64,iVBORw0KGgo=', userId: null }], seal: 'data:image/png;base64,iVBORw0KGgo=' });
const opts = await api('frontdesk', 'GET', '/signatories');
expect(opts.some((o) => o.id === 'sdir' && o.allowed.other && !o.allowed.report), 'signatory list: company profile usable for quotes/invoices, not reports by others');
const sq = await api('frontdesk', 'POST', '/documents', { kind: 'quote', client_id: client.id, data: { mode: 'estimate', lines: [{ description: 'Test', rate: 500, qty: 1, unit: 'No.' }] } });
await api('frontdesk', 'PUT', `/documents/${sq.id}/placement`, { signatoryId: 'sdir', sealPos: { x: 140, y: 230, w: 30 } });
const sqd = await api('frontdesk', 'GET', `/documents/${sq.id}`);
expect(sqd.issuer?.name === 'Test Director' && sqd.issuer.preview && sqd.data.sealPos?.x === 140, 'chosen signatory fills in on the draft and the seal position is saved');
const inv2 = await api('accounts', 'POST', '/documents', { kind: 'invoice', client_id: client.id, data: { lines: [{ description: 'Test', rate: 500, qty: 1, unit: 'No.' }] } });
await api('accounts', 'PUT', `/documents/${inv2.id}/placement`, { signatoryId: 'sdir' });
await api('accounts', 'POST', `/documents/${inv2.id}/issue`);
const inv2d = await api('accounts', 'GET', `/documents/${inv2.id}`);
expect(inv2d.issuer?.name === 'Test Director' && inv2d.issuer.signature && inv2d.data.signatory?.designation === 'Director', 'on issue the signature and details are frozen into the document');
m = await fail(() => api('accounts', 'PUT', `/documents/${inv2.id}/placement`, { sealPos: { x: 1, y: 1, w: 30 } }));
expect(m, 'seal cannot be moved after issue');
const pdfb = Buffer.from('%PDF-1.4 brochure').toString('base64');
const brochure = await api('owner', 'POST', '/files', { entity: 'company', entity_id: 0, name: 'Company brochure.pdf', mime: 'application/pdf', data: pdfb });
const cdocs = await api('frontdesk', 'GET', '/files?entity=company&entity_id=0');
expect(cdocs.some((f) => f.id === brochure.id), 'brochure stored under company documents and visible to staff who send emails');
await api('owner', 'PUT', '/company', { website: 'https://example-lab.test', emailFooter: { reviewUrl: 'https://g.page/r/example/review', mapsUrl: 'https://maps.example/x', whatsapp: '9000000000' } });
const foot = await api('frontdesk', 'GET', '/email/footer?kind=report&body=Hello');
expect(/Rate us on Google/.test(foot.html) && /Google review/.test(foot.text) && /wa\.me\/919000000000/.test(foot.html), 'email footer carries contacts, website, map, WhatsApp and review link');
const fq = await api('frontdesk', 'GET', '/email/footer?kind=quote&body=Hello');
expect(!/Rate us/.test(fq.html), 'review link is left out of quotation emails (after-service only)');
console.log('11. Bulk client import');
const impRows = [
  { 'Client name*': 'Example Infra Projects Pvt Ltd' },
  { 'Client name*': 'Import Test Co', GSTIN: '36AABCK1234A1ZA', 'Site name': 'Site A', 'Contact name': 'Ravi', 'Contact email': 'ravi@import.test' },
  { 'Client name*': 'import test co', 'Site name': 'Site B', 'Contact name': 'Ravi' },
  { 'Client name*': 'No State Co' },
  { 'Client name*': 'Bad Mail Co', State: 'Telangana', Email: 'nope' },
];
const dryI = await api('frontdesk', 'POST', '/clients/import', { rows: impRows, dryRun: true });
expect(dryI.summary.newClients === 1 && dryI.summary.sites === 2 && dryI.summary.contacts === 1 && dryI.summary.errors === 2, `import check: ${JSON.stringify(dryI.summary)} (example row skipped, duplicates counted once)`);
expect(!(await api('frontdesk', 'GET', '/clients')).some((c) => c.name === 'Import Test Co'), 'the check writes nothing');
const realI = await api('frontdesk', 'POST', '/clients/import', { rows: impRows, dryRun: false });
const ic = (await api('frontdesk', 'GET', '/clients')).find((c) => c.name === 'Import Test Co');
const icd = await api('frontdesk', 'GET', `/clients/${ic.id}`);
expect(realI.summary.newClients === 1 && ic.state_code === '36' && icd.sites.length === 2 && icd.contacts.length === 1, 'import creates the client with state from GSTIN, 2 sites and 1 contact');
const again = await api('frontdesk', 'POST', '/clients/import', { rows: impRows, dryRun: false });
expect(again.summary.newClients === 0 && again.summary.sites === 0, 'importing the same file again changes nothing');
console.log('12. GST returns, notifications, duplicate, backup');
const period = today.slice(0, 7);
let G = await api('accounts', 'GET', `/gst/${period}`);
const issuedInv = (await api('accounts', 'GET', '/documents?kind=invoice')).filter((d) => ['issued', 'paid', 'partly_paid'].includes(d.status) && d.date.startsWith(period));
expect(G.sales.filter((r) => !r.excluded).map((r) => r.doc_no).filter((v, i, a) => a.indexOf(v) === i).length === issuedInv.length, `GST register picked up all ${issuedInv.length} issued invoice(s) of ${period} automatically`);
const sumTax = G.sales.filter((r) => !r.excluded).reduce((a, r) => a + r.cgst + r.sgst + r.igst, 0);
const invTax = (await Promise.all(issuedInv.map((d) => api('accounts', 'GET', `/documents/${d.id}`)))).reduce((a, d) => a + d.totals.cgst + d.totals.sgst + d.totals.igst, 0);
expect(Math.abs(sumTax - invTax) < 0.05, `output GST ₹${sumTax.toFixed(2)} matches the invoices`);
const first = G.sales[0];
await api('accounts', 'PUT', `/gst/rows/${first.id}`, { note: 'checked', taxable: first.taxable + 100 });
await api('accounts', 'POST', `/gst/${period}/rows`, { kind: 'purchase', doc_no: 'PB-1', doc_date: `${period}-02`, party: 'Calibration Co', gstin: '36AABCK1234A1ZA', rate: 18, taxable: 10000, cgst: 900, sgst: 900, igst: 0 });
G = await api('accounts', 'GET', `/gst/${period}`);
const firstAfter = G.sales.find((r) => r.id === first.id);
expect(firstAfter.edited && Math.abs(firstAfter.taxable - first.taxable - 100) < 0.01 && Math.abs(firstAfter.total - (firstAfter.taxable + firstAfter.cgst + firstAfter.sgst + firstAfter.igst)) < 0.01, 'edited row is kept on refresh and its total recalculated');
expect(G.summary.itc.cgst === 900 && G.summary.net.cgst === Math.round((G.summary.outward.cgst - 900) * 100) / 100, 'purchase bill gives input tax credit in the summary');
await api('accounts', 'PUT', `/gst/${period}/status`, { status: 'sent' });
m = await fail(() => api('accounts', 'POST', `/gst/${period}/rows`, { kind: 'sales', doc_no: 'X', doc_date: `${period}-03`, party: 'X', rate: 18, taxable: 1 }));
expect(m && /Reopen/.test(m), 'month marked “sent to CA” is locked');
await api('accounts', 'PUT', `/gst/${period}/status`, { status: 'open' });
m = await fail(() => api('technician' === 'x' ? 'x' : 'frontdesk', 'GET', `/gst/${period}`));
expect(m, 'front desk cannot open GST returns');
await api('owner', 'POST', '/activities', { type: 'Call', subject: 'Notification test call', client_id: client.id, due_date: today });
const dash1 = await api('owner', 'GET', '/dashboard');
const ref = dash1.reminders.find((r) => r.ref)?.ref;
expect(ref, 'notifications carry a stable reference');
if (ref) { await api('owner', 'POST', '/notifications/read', { refs: [ref] }); const dash2 = await api('owner', 'GET', '/dashboard'); expect(dash2.unread === dash1.unread - 1 && dash2.reminders.find((r) => r.ref === ref).read, 'notification marked as read lowers the unread count'); }
const dq2 = await api('frontdesk', 'POST', `/documents/${q.id}/duplicate`, {});
const dqd2 = await api('frontdesk', 'GET', `/documents/${dq2.id}`);
expect(dqd2.status === 'draft' && dqd2.number !== qd.number && dqd2.data.lines.length === qd.data.lines.length, `quotation duplicated as new draft ${dqd2.number}`);
const bk = await fetch(`${base}/api/system/backup`, { headers: { cookie: await as('owner') } });
const bkBuf = Buffer.from(await bk.arrayBuffer());
if (bk.status === 400 && /MySQL/.test(bkBuf.toString())) expect(true, 'full backup: MySQL server points to the hosting panel backup');
else expect(bk.ok && bkBuf[0] === 0x1f && bkBuf[1] === 0x8b && bkBuf.length > 5000, `full backup downloads (${Math.round(bkBuf.length / 1024)} KB gzip)`);
const sigUser = (await api('owner', 'GET', '/users')).find((u) => u.email === 'signatory@demo.lab');
await api('owner', 'POST', `/account/admin/reset-2fa/${sigUser.id}`);
expect(!(await raw('/auth/login', { email: 'signatory@demo.lab', password: PASS })).j.twoFactor, 'admin can reset a user\'s two-step verification (lost phone)');
await api('owner', 'PUT', '/company', { signatories: [], seal: null });
console.log('13. WhatsApp sharing');
const repShared = await api('owner', 'GET', `/documents/${rep.id}`);
expect(Boolean(repShared.share), 'issued report has a share token');
const sharedRes = await fetch(`${base}/api/public/doc/${repShared.share}`);
const pubJ = await sharedRes.json();
expect(sharedRes.ok && pubJ.number === repShared.number && pubJ.kind === 'report' && pubJ.verify, 'shared link opens the issued report without signing in');
expect(!('ai' in pubJ.company) && !('smtp' in pubJ.company) && !('whatsapp' in pubJ.company) && !('signatories' in pubJ.company), 'shared page does not expose private settings');
const tampered = await fetch(`${base}/api/public/doc/${rep.id}-xxxxxxxxxxxxxxxxxx`);
expect(tampered.status === 404, 'tampered share link is refused');
const draftInv = await api('accounts', 'POST', '/documents', { kind: 'invoice', client_id: client.id, data: { lines: [{ description: 'x', rate: 100, qty: 1 }] } });
expect(!(await api('accounts', 'GET', `/documents/${draftInv.id}`)).share, 'draft invoice has no share link');
await api('accounts', 'DELETE', `/documents/${draftInv.id}`);
const wq = await api('frontdesk', 'POST', `/documents/${q.id}/duplicate`, {});
await api('frontdesk', 'POST', '/whatsapp/log', { client_id: client.id, phone: '919876543210', contact: 'Test', template: 'Send quotation', message: 'Dear Test, quotation link', link_kind: 'quote', link_id: wq.id });
const wqd = await api('frontdesk', 'GET', `/documents/${wq.id}`);
expect(wqd.status === 'sent' && wqd.history.some((h) => h.action === 'shared on WhatsApp'), 'quotation sent on WhatsApp is marked sent and logged in history');
const acts = await api('frontdesk', 'GET', `/activities?client_id=${client.id}`);
expect(acts.some((a) => a.type === 'WhatsApp' && a.done_at && a.link_id === wq.id), 'WhatsApp message saved as a completed CRM activity');
await fetch(`${base}/api/public/doc/${wqd.share}`);
expect((await api('frontdesk', 'GET', `/documents/${wq.id}`)).history.some((h) => h.action === 'opened from shared link'), 'client opening the link is recorded in history');
console.log('14. User invitations and forgot password');
const newU = await api('owner', 'POST', '/users', { name: 'New Tech', email: 'newtech@demo.lab', role: 'technician', phone: '9876543210' });
expect(newU.invite && /\/welcome\//.test(newU.invite.url) && newU.invite.emailed === false, 'user created without password gets an invitation link (email not set up → link returned for the admin)');
const dup = await fail(() => api('owner', 'POST', '/users', { name: 'Dup', email: 'NewTech@demo.lab', role: 'technician' }));
expect(dup && /already exists/.test(dup), 'duplicate email is refused');
let li = await raw('/auth/login', { email: 'newtech@demo.lab', password: 'whatever1' });
expect(li.r.status === 401 && /not activated/.test(li.j.error), 'invited user cannot sign in before setting a password');
const invTok = newU.invite.url.split('/welcome/')[1];
const tinfo = await raw(`/public/token/${invTok}`);
expect(tinfo.j.purpose === 'invite' && tinfo.j.email === 'newtech@demo.lab', 'invitation link shows who it is for');
const weak = await raw(`/public/token/${invTok}`, { password: 'password' });
expect(weak.r.status === 400, 'weak password (no number) is refused');
const setp = await raw(`/public/token/${invTok}`, { password: 'Lab2026secure' });
expect(setp.j.signedIn && setp.cookie.includes('suite_sid'), 'setting the password confirms the email and signs the user in');
const meNew = await fetch(`${base}/api/auth/me`, { headers: { cookie: setp.cookie } }).then((r) => r.json());
expect(meNew.user?.email === 'newtech@demo.lab', 'new user is signed in');
expect((await raw(`/public/token/${invTok}`)).r.status === 410, 'invitation link works only once');
const listed = (await api('owner', 'GET', '/users')).find((u) => u.email === 'newtech@demo.lab');
expect(listed.password_set && listed.email_verified_at, 'user shows as active with confirmed email');
const fg1 = await raw('/public/forgot', { email: 'nobody-here@demo.lab' });
const fg2 = await raw('/public/forgot', { email: 'newtech@demo.lab' });
expect(fg1.r.ok && fg2.r.ok && fg1.j.message === fg2.j.message, 'forgot password answers the same whether or not the account exists');
const rl = await api('owner', 'POST', `/users/${listed.id}/access-link`);
expect(rl.purpose === 'reset' && /\/reset\//.test(rl.url), 'admin can create a password reset link');
const rTok = rl.url.split('/reset/')[1];
const rs = await raw(`/public/token/${rTok}`, { password: 'Changed2026x' });
expect(rs.j.ok, 'password reset through the link');
expect((await fetch(`${base}/api/auth/me`, { headers: { cookie: setp.cookie } })).status === 401, 'reset signs out the old session');
expect((await raw('/auth/login', { email: 'newtech@demo.lab', password: 'Lab2026secure' })).r.status === 401 && (await raw('/auth/login', { email: 'newtech@demo.lab', password: 'Changed2026x' })).r.ok, 'old password stops working, new one works');
console.log('15. Sharing & visibility, favourites');
await api('owner', 'POST', '/users', { name: 'Sales Two', email: 'sales2@demo.lab', role: 'frontdesk', password: 'Sales2026x' });
sessions.sales2 = (await raw('/auth/login', { email: 'sales2@demo.lab', password: 'Sales2026x' })).cookie;
const as2 = async (method, path, body) => { const r = await fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json', cookie: sessions.sales2 }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
const pq = await api('frontdesk', 'POST', '/documents', { kind: 'quote', client_id: client.id, data: { lines: [{ description: 'Private test', rate: 500, qty: 1 }] } });
expect((await as2('GET', `/documents/${pq.id}`)).status === 200, 'public read/write default: colleague sees the quotation');
await api('owner', 'PUT', '/sharing/defaults', { client: 'private', quote: 'private', invoice: 'edit' });
expect((await as2('GET', `/documents/${pq.id}`)).status === 404, 'private default: colleague cannot open a quotation they do not own');
expect(!(await as2('GET', '/documents?kind=quote')).j.some((d) => d.id === pq.id), 'private quotation is not in the colleague\'s list');
expect((await api('accounts', 'GET', '/documents?kind=quote')).some((d) => d.id === pq.id), 'Accountant role with View all still sees it');
const sales2 = (await api('owner', 'GET', '/users')).find((u) => u.email === 'sales2@demo.lab');
await api('frontdesk', 'POST', `/sharing/quote/${pq.id}`, { user_id: sales2.id, access: 'read' });
expect((await as2('GET', `/documents/${pq.id}`)).j.access === 'read', 'shared view-only: colleague can open it read-only');
expect((await as2('PUT', `/documents/${pq.id}`, { data: { notes: 'x' } })).status === 403, 'view-only share cannot edit');
await api('frontdesk', 'POST', `/sharing/quote/${pq.id}`, { user_id: sales2.id, access: 'edit' });
expect((await as2('PUT', `/documents/${pq.id}`, { data: { notes: 'edited by colleague' } })).status === 200, 'edit share allows editing');
expect((await as2('POST', `/sharing/quote/${pq.id}`, { user_id: sales2.id, access: 'edit' })).status === 403, 'only the owner or an admin can change sharing');
const pc = await api('frontdesk', 'POST', '/clients?force=1', { name: 'Private Client Pvt Ltd', state_code: '36' });
expect((await as2('GET', `/clients/${pc.id}`)).status === 404 && !(await as2('GET', '/clients')).j.some((c) => c.id === pc.id), 'private clients are hidden from colleagues');
await api('frontdesk', 'POST', `/sharing/client/${pc.id}`, { role: 'frontdesk', access: 'read' });
expect((await as2('GET', `/clients/${pc.id}`)).j.access === 'read', 'client shared with a whole role (view only)');
await api('owner', 'PUT', `/sharing/client/${pc.id}/owner`, { owner_id: sales2.id });
expect((await as2('GET', `/clients/${pc.id}`)).j.access === 'edit', 'new owner can edit after owner change');
await api('owner', 'PUT', '/sharing/defaults', { client: 'edit', quote: 'edit', invoice: 'edit' });
const fav = await api('owner', 'POST', '/favorites', { kind: 'client', ref: `/clients/${client.id}`, label: client.name, sub: 'Client' });
await api('owner', 'POST', '/favorites', { kind: 'page', ref: '/invoices', label: 'Invoices' });
let favs = await api('owner', 'GET', '/favorites');
expect(favs.length === 2 && favs[0].id === fav.id, 'favourites saved in order');
await api('owner', 'PUT', '/favorites/order', { ids: favs.map((f) => f.id).reverse() });
favs = await api('owner', 'GET', '/favorites');
expect(favs[0].ref === '/invoices', 'favourites can be reordered');
expect((await api('frontdesk', 'GET', '/favorites')).length === 0, 'favourites are personal');
const r1 = await api('owner', 'POST', '/analytics/run', { object: 'quotes', measure: { agg: 'count' }, groupBy: ['status'], chart: 'funnel' });
expect(r1.spec.chart === 'funnel', 'reports accept the new chart types');
console.log('16. Outsourced tests, vendor bills, GST, sample disposal');
const lab2 = await api('owner', 'POST', '/vendors', { name: 'Green Earth Analytical Labs', kind: 'lab', gstin: '36AAACG1234A1Z5', state_code: '36', nabl_cert: 'TC-9999', nabl_valid_till: '2030-01-01', services: 'Water, cement chemical' });
const cat2 = await api('owner', 'GET', '/catalog');
const wat = cat2.find((c) => c.code === 'WAT-456');
expect(wat && wat.obs_template_code === 'WAT-456', 'water test (IS 456) is in the rate card with its sheet');
await api('owner', 'PUT', `/catalog/${wat.id}`, { performed_by: 'vendor', vendor_id: lab2.id });
const ws = await api('frontdesk', 'POST', '/samples', { client_id: client.id, material: 'Water', accreditation: 'Non-NABL', received_date: today, quantity: '2 l', condition: 'Satisfactory', source: 'Sample supplied by the customer', tests: [{ catalog_id: wat.id }] });
let jobs2 = await api('frontdesk', 'GET', `/outsourcing?sample_id=${ws.id}`);
expect(jobs2.length === 1 && jobs2[0].status === 'to_send' && jobs2[0].vendor_id === lab2.id, 'registering an outsourced test creates a "to send" job for the vendor');
const sd = await api('frontdesk', 'GET', `/samples/${ws.id}`);
expect(sd.retention_days > 0 && sd.dispose_after, `sample retention set (${sd.retention_days} days, keep till ${sd.dispose_after})`);
const job2 = jobs2[0];
await api('frontdesk', 'PUT', `/outsourcing/${job2.id}`, { status: 'sent' });
await api('frontdesk', 'POST', '/files', { entity: 'outsource', entity_id: job2.id, name: 'challan.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 test').toString('base64'), kind: 'evidence' });
const wt = job2.test_ids[0];
await api('frontdesk', 'POST', `/outsourcing/${job2.id}/import`, { test_id: wt, values: { ph: '7.42', acid: 1.2, alk: 8.6, org: 42, inorg: 612, so3: 88, cl: 146, ss: 18 }, report_no: 'GEAL/W/1182', report_date: today, submit: true });
const wtest = await api('reviewer', 'GET', `/tests/${wt}`);
expect(wtest.status === 'submitted' && Number(wtest.results.r_ph) === 7.42 && wtest.observation.external.vendor === 'Green Earth Analytical Labs', 'vendor results fill the observation sheet and go for review, marked as external');
expect((await api('frontdesk', 'GET', `/outsourcing/${job2.id}`)).status === 'entered', 'job moves to "results entered"');
await api('reviewer', 'POST', `/tests/${wt}/review`, { action: 'accept' });
const wrep = await api('reviewer', 'POST', '/reports', { testIds: [wt] });
const wrd = await api('reviewer', 'GET', `/documents/${wrep.id}`);
const wrows = wrd.data.details.flatMap((d) => d.rows ?? []).concat(wrd.data.rows ?? []);
const allText = JSON.stringify(wrd.data);
expect(/tested by external laboratory Green Earth Analytical Labs \(NABL accreditation TC-9999\), their test report no\. GEAL\/W\/1182/.test(allText), 'report note identifies the external laboratory and its report');
expect(/pH value \*/.test(allText) && !/Fluoride/.test(allText), 'outsourced rows carry * and untested parameters are left off');
const bill = await api('accounts', 'POST', '/purchases', { vendor_id: lab2.id, category: 'subcontract', bill_no: 'GEAL/INV/77', bill_date: today, sac: '998346', rate: 18, taxable: 2000, tds: 40, job_id: job2.id });
const dupBill = await fail(() => api('accounts', 'POST', '/purchases', { vendor_id: lab2.id, category: 'subcontract', bill_no: 'GEAL/INV/77', bill_date: today, rate: 18, taxable: 1 }));
expect(dupBill && /already recorded/.test(dupBill), 'the same vendor bill cannot be entered twice');
let bl = (await api('accounts', 'GET', '/purchases')).find((b) => b.id === bill.id);
expect(bl.total === 2360 && Number(bl.cgst) === 180 && bl.balance === 2320, 'bill: CGST+SGST split, total ₹2360, balance after TDS ₹2320');
await api('accounts', 'POST', `/purchases/${bill.id}/payments`, { date: today, amount: 2320, mode: 'Bank transfer', ref: 'UTR123' });
bl = (await api('accounts', 'GET', '/purchases')).find((b) => b.id === bill.id);
expect(bl.status === 'paid', 'bill marked paid after payment');
const gp = today.slice(0, 7);
await api('accounts', 'POST', `/gst/${gp}/sync`);
const G2 = await api('accounts', 'GET', `/gst/${gp}`);
expect(G2.purchases.some((r) => r.source === 'bill' && r.doc_no === 'GEAL/INV/77' && Number(r.cgst) === 180), 'vendor bill appears in GST purchases (input tax credit)');
await api('accounts', 'POST', '/purchases', { vendor_id: lab2.id, category: 'calibration', bill_no: 'CAL-5', bill_date: today, rate: 18, taxable: 1000 });
expect((await api('owner', 'GET', '/vendors')).find((v) => v.id === lab2.id).spend === 3540, 'vendor spend totals all bills');
await api('frontdesk', 'POST', `/samples/${ws.id}/disposal`, { date: today, method: 'Returned to customer' });
expect((await api('frontdesk', 'GET', `/samples/${ws.id}`)).disposed_at === today, 'sample disposal recorded');
console.log('18. Equipment import');
const eqRows = [
  { 'Equipment name*': 'Example – Proving ring 50 kN', Category: 'Proving ring' },
  { 'Equipment name*': 'Proving ring 50 kN', Category: 'proving ring', 'Equipment ID': 'IMP/PR/01', 'Certificate no.': 'CAL/1', 'Calibrated on': '15-06-2026', 'Calibration due': '14-06-2027', 'Calibration factor': '0.0521' },
  { 'Equipment name*': 'CTM 2000 kN', Category: 'Compression testing machine', 'Equipment ID': 'IMP/CTM/01', 'Calibrated on': '2026-06-20', 'Calibration due': '2027-06-19', 'Correction factor': '1.002' },
  { 'Equipment name*': 'Bad dates', 'Equipment ID': 'IMP/X/1', 'Calibrated on': '20-06-2026', 'Calibration due': '19-06-2025' },
  { 'Equipment name*': 'Odd thing', Category: 'Spectrometer', 'Equipment ID': 'IMP/SP/1', 'Calibration factor': 'abc' },
];
let ei = await api('owner', 'POST', '/equipment/import', { rows: eqRows, dryRun: true });
expect(ei.summary.added === 2 && ei.summary.errors === 2 && ei.results[0].status === 'skipped', `equipment import check: 2 new, 2 errors, example row skipped`);
expect(/before the calibration date/.test(ei.results[3].message) && /not a number/.test(ei.results[4].message), 'import explains bad dates and non-numeric values');
await api('owner', 'POST', '/equipment/import', { rows: eqRows, dryRun: false });
let eqs = await api('owner', 'GET', '/equipment');
const pr = eqs.find((e) => e.id_no === 'IMP/PR/01');
expect(pr && pr.category === 'Proving ring' && pr.cal_date === '2026-06-15' && pr.due_date === '2027-06-14' && Number(pr.data.factor) === 0.0521, 'imported equipment has category, DD-MM-YYYY dates and calibration factor');
await api('owner', 'POST', '/equipment/import', { rows: [{ 'Equipment name*': 'Proving ring 50 kN', 'Equipment ID': 'IMP/PR/01', 'Certificate no.': 'CAL/2', 'Calibrated on': '15-06-2027', 'Calibration due': '14-06-2028', 'Calibration factor': '0.0519' }], dryRun: false });
eqs = await api('owner', 'GET', '/equipment');
const pr2 = eqs.filter((e) => e.id_no === 'IMP/PR/01');
expect(pr2.length === 1 && pr2[0].cert_no === 'CAL/2' && pr2[0].due_date === '2028-06-14' && Number(pr2[0].data.factor) === 0.0519 && pr2[0].category === 'Proving ring', 're-import with the same Equipment ID updates calibration (no duplicate)');
console.log('19. Saving records exactly as loaded (yes/no stored as 1/0)');
const uRow = (await api('owner', 'GET', '/users')).find((u) => u.email === 'frontdesk@demo.lab');
await api('owner', 'PUT', `/users/${uRow.id}`, { ...uRow, active: 1, phone: '9876543210' });
expect((await api('owner', 'GET', '/users')).find((u) => u.id === uRow.id).phone === '9876543210', 'user edited with active = 1 (as loaded) saves the phone number');
const cRow = (await api('owner', 'GET', '/catalog'))[0];
await api('owner', 'PUT', `/catalog/${cRow.id}`, { ...cRow, nabl: cRow.nabl ? 1 : 0, active: 1 });
const eRow = (await api('owner', 'GET', '/equipment'))[0];
const { id: _e, company_id: _c, created_at: _ca, updated_at: _u, custom: _cu, ...eBody } = eRow;
await api('owner', 'PUT', `/equipment/${eRow.id}`, { ...eBody, active: 1 });
const vRow = (await api('owner', 'GET', '/vendors'))[0];
await api('owner', 'PUT', `/vendors/${vRow.id}`, { name: vRow.name, active: 0 });
expect((await api('owner', 'GET', '/vendors')).find((v) => v.id === vRow.id).active == 0, 'rate card, equipment and vendor accept 1/0 for yes/no');
await api('owner', 'PUT', `/vendors/${vRow.id}`, { name: vRow.name, active: 'true' });
console.log('20. Record dates and Recycle Bin');
{
  const fail2 = async (f) => { try { await f(); return null; } catch (e) { return e.message; } };
  const c0 = (await api('owner', 'GET', `/clients/${client.id}`));
  await new Promise((r) => setTimeout(r, 20));
  await api('owner', 'PUT', `/clients/${client.id}`, { name: c0.name, gstin: c0.gstin, state_code: c0.state_code, address: c0.address, notes: 'touched ' + Date.now() });
  const info = await api('owner', 'GET', `/record-info/client/${client.id}`);
  expect(info.created_at && info.updated_at && info.updated_at > info.created_at, 'every record shows created and last-modified dates; editing moves last-modified');
  expect(/System Administrators/.test(await fail2(() => api('frontdesk', 'PUT', `/record-info/sample/${s.id}`, { created_at: '2025-01-01T10:00:00Z' }))), 'only System Administrators can change record dates');
  await api('admin', 'PUT', `/record-info/sample/${s.id}`, { created_at: '2025-01-01T10:00:00Z' });
  const si = await api('admin', 'GET', `/record-info/sample/${s.id}`);
  expect(si.created_at === '2025-01-01T10:00:00.000Z' && /administrator/.test(si.last_action), 'admin date correction is saved and audited');

  expect(/administrators/i.test(await fail2(() => api('frontdesk', 'DELETE', `/recycle/sample/${s.id}`, {}))), 'non-admins cannot delete records');
  const ps = await api('admin', 'GET', `/recycle/preview/sample/${s.id}`);
  expect(ps.blocked && /report/.test(ps.blocked), 'a sample whose results are on a report cannot be deleted before the report');
  expect(/Payments/.test((await api('admin', 'GET', `/recycle/preview/invoice/${inv.id}`)).blocked ?? ''), 'an invoice with payments cannot be deleted before the payments');
  const pay = (await api('accounts', 'GET', '/payments')).find((p) => String(p.allocations ?? '').includes(String(inv.id)) || (p.client_id === client.id && p.reference === 'NEFT123'));
  const st0 = (await api('owner', 'GET', `/documents/${inv.id}`)).status;
  const bp = await api('admin', 'DELETE', `/recycle/payment/${pay.id}`, { reason: 'entered twice' });
  expect((await api('owner', 'GET', `/documents/${inv.id}`)).status === 'issued', 'deleting a payment makes its invoice due again');
  await api('admin', 'POST', `/recycle/${bp.binId}/restore`);
  expect((await api('owner', 'GET', `/documents/${inv.id}`)).status === st0, 'restoring the payment puts the invoice back to ' + st0);

  const br = await api('admin', 'DELETE', `/recycle/report/${rep.id}`, {});
  expect(await fail2(() => api('owner', 'GET', `/documents/${rep.id}`)), 'deleted report disappears from the app');
  const bs = await api('admin', 'DELETE', `/recycle/sample/${s.id}`, {});
  await api('admin', 'POST', `/recycle/${bs.binId}/restore`);
  await api('admin', 'POST', `/recycle/${br.binId}/restore`);
  const rd = await api('owner', 'GET', `/documents/${rep.id}`);
  const back = await api('owner', 'GET', `/samples/${s.id}`);
  expect(rd.number && back.tests.every((t) => t.report_id === rep.id), 'sample and report restored with the same numbers and links');
  const bin = await api('admin', 'GET', '/recycle');
  expect(bin.rows.filter((r) => r.restored_at).length >= 3 && bin.rows[0].deleted_by_name, 'Recycle Bin lists deleted and restored records with who did it');
  const eq = (await api('owner', 'GET', '/equipment'))[0];
  const be = await api('admin', 'DELETE', `/recycle/equipment/${eq.id}`, {});
  await api('admin', 'DELETE', `/recycle/bin/${be.binId}`);
  expect(await fail2(() => api('admin', 'POST', `/recycle/${be.binId}/restore`)), 'permanently deleted records cannot be restored');
  await api('admin', 'PUT', '/recycle/settings', { days: 60 });
  expect((await api('admin', 'GET', '/recycle')).keepDays === 60, 'retention can be set to 60 days');
}
console.log('21. Home dashboard insights');
{
  const o = await api('owner', 'GET', '/dashboard/insights'), t = await api('tech', 'GET', '/dashboard/insights');
  expect(o.months.length === 12 && o.money.invoiced.length === 12 && o.money.topClients.length > 0 && o.lab.intake.length === 14, 'owner sees 12-month money trend, top clients and sample intake');
  expect(!t.money && t.lab, 'technician sees lab figures but no money');
}
console.log('22. Assistant, invoice analytics, AI diagnostics');
{
  const ask = (u, q) => api(u, 'POST', '/assistant/chat', { messages: [{ role: 'user', content: q }] });
  let a = await ask('owner', 'how do I record a payment with TDS?');
  expect(a.mode === 'builtin' && /\[Record a payment received \(with TDS\)\]\(\/payments\?new=1\)/.test(a.answer), 'assistant answers how-to questions with a link, without any AI provider');
  a = await ask('owner', `what does ${client.name.split(' ')[0]} owe us?`);
  expect(a.results[0].tool === 'client_summary' && /Outstanding ₹/.test(a.answer) && a.answer.includes(`/clients/${client.id}`), 'assistant summarises a client with outstanding amount and record links');
  a = await ask('tech', 'revenue by client this year');
  expect(/does not have access/.test(a.answer) && !/₹/.test(a.answer), 'assistant respects role permissions (technician gets no money figures)');
  const ia = await api('owner', 'GET', '/invoices/analytics');
  expect(ia.monthly.length === 12 && ia.years.length === 5 && ia.kpis.fyToDate > 0 && ia.topClients[0].share > 0, 'invoice analytics: 12 FY months, 5 years, KPIs, customer contribution');
  const ia2 = await api('owner', 'GET', `/invoices/analytics?client=${client.id}&accreditation=NABL`);
  expect(ia2.topClients.every((t) => t.client_id === client.id), 'invoice analytics filters by customer and NABL / Non-NABL');
  let m = await fail(() => api('tech', 'GET', '/invoices/analytics'));
  expect(m, 'invoice analytics needs invoice access');
  const bad = await api('owner', 'POST', '/ai/test', { provider: 'openai', baseUrl: 'http://127.0.0.1:9', model: 'x', apiKey: 'k' });
  expect(bad.ok === false && /could not reach the provider/.test(bad.problem) && bad.fix.length, 'AI connection test explains the problem and the fix');
  if (process.env.MOCK_AI) {
    await api('owner', 'PUT', '/company', { ai: { enabled: true, provider: 'openai', baseUrl: process.env.MOCK_AI, model: 'mock', apiKey: 'x' } });
    const ml = await api('owner', 'POST', '/ai/models', {});
    expect(ml.ok && ml.models.includes('mock-large'), 'List models reads the models the key can use');
    a = await ask('owner', 'which invoices does Deccan have');
    expect(a.mode === 'ai' && !a.results.some((r) => r.tool === 'run_sql') && !a.answer.includes('/evil') && /\]\(\/documents\/\d+\)/.test(a.answer), 'AI can only use the fixed lookups; links it invents are removed');
    const co = await api('owner', 'GET', '/company');
    expect(!JSON.stringify(co).includes('"apiKey":"x"'), 'API key is never sent back to the browser');
    await api('owner', 'PUT', '/company', { ai: { enabled: false } });
  }
  if (process.env.MOCK_GEMINI) { // server started with GEMINI_BASE pointing at the mock
    let t = await api('owner', 'POST', '/ai/test', { provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'bad-key' });
    expect(!t.ok && /rejected the API key/.test(t.problem) && t.steps.find((x) => x.key === 'reach').ok && t.steps.find((x) => x.key === 'key').ok === false && /API key not valid/.test(t.error.message), 'Gemini: wrong key – says the key was rejected and shows Google\'s message');
    t = await api('owner', 'POST', '/ai/test', { provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'good-key' });
    expect(!t.ok && /not available/.test(t.problem) && t.suggestions[0] === 'gemini-3.8-flash' && t.suggestions.includes('gemini-flash-latest') && t.steps.find((x) => x.key === 'key').ok, 'Gemini: retired model – key accepted, Google\'s recommended model offered first');
    t = await api('owner', 'POST', '/ai/test', { provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'models/gemini-flash-latest', apiKey: 'good-key' });
    expect(t.ok && t.reply === 'OK' && t.steps.every((x) => x.ok), 'Gemini: connected through Google\'s own API (old address and "models/" prefix accepted; thinking text ignored)');
    t = await api('owner', 'POST', '/ai/test', { provider: 'gemini', model: 'gemini-flash-latest', apiKey: 'busy-key' });
    expect(!t.ok && t.busy && /setup is correct/.test(t.problem) && t.steps.find((x) => x.key === 'key').ok && t.steps.find((x) => x.key === 'reply').ok === null, 'Gemini busy (503): test retries, then says the setup is correct and Google is busy');
    await api('owner', 'PUT', '/company', { ai: { enabled: true, provider: 'gemini', model: 'gemini-flash-latest', apiKey: 'busy-key' } });
    const ask = await api('owner', 'POST', '/ai/ask', { question: 'revenue by client' });
    expect(ask.explanation === 'lite', 'Gemini busy: live requests switch to the lighter Flash model and still answer');
    await api('owner', 'PUT', '/company', { ai: { enabled: false } });
    const ml = await api('owner', 'POST', '/ai/models', { provider: 'gemini', apiKey: 'good-key' });
    expect(ml.models[0] === 'gemini-flash-latest' && ml.models.includes('gemini-3.8-flash') && !ml.models.some((x) => /embedding/.test(x)) && ml.endpoint.endsWith('/v1beta/models'), 'Gemini: List models reads every page, keeps chat models, latest alias first');
  }
}
console.log('23. Quick test report without registration, register later');
{
  const mp = byCode('SOIL-MP');
  let m = await fail(() => api('accounts', 'POST', '/quick-reports', { customer: { name: 'Walk-in' }, material: 'Soil', received_date: today, tests: [mp.id] }));
  expect(m, 'roles without lab work cannot start a quick report');
  const qr = await api('reviewer', 'POST', '/quick-reports', { customer: { name: 'Ramesh Builders (walk-in)', address: 'Plot 4, Kukatpally', phone: '9000000000' }, material: 'Soil', received_date: today, description: 'Soil from footing', tests: [mp.id] });
  expect(/^QR\//.test(qr.code), `quick report ${qr.code} numbered separately, no sample registration needed`);
  expect(!(await api('owner', 'GET', '/samples')).some((x) => x.id === qr.id) && !(await api('owner', 'GET', '/clients')).some((c) => c.type === 'system'), 'quick reports stay out of the sample register and client list until registered');
  const qd = await api('reviewer', 'GET', `/quick-reports/${qr.id}`);
  const qt = qd.tests[0];
  const full = await api('reviewer', 'GET', `/tests/${qt.id}`);
  expect(full.client.name.includes('Ramesh Builders'), 'observation sheet shows the typed customer');
  m = await fail(() => api('reviewer', 'POST', `/quick-reports/${qr.id}/report`));
  expect(/submit the observations/.test(m), 'report waits until observations are submitted');
  const ex = full.template.example?.input ?? { header: {}, grids: {} };
  const grids = {}; for (const g of full.template.grids) { const base = g.fixedRows ?? Array.from({ length: g.rows ?? 5 }, () => ({})); const rows = ex.grids?.[g.key] ?? []; grids[g.key] = Array.from({ length: Math.max(base.length, rows.length) }, (_, i) => ({ ...(base[i] ?? {}), ...(rows[i] ?? {}) })); }
  await api('reviewer', 'PUT', `/tests/${qt.id}/observation`, { observation: { header: { ...(ex.header ?? {}) }, constants: { ...(ex.constants ?? {}) }, grids, equipment: {} }, started_at: today, completed_at: today });
  await api('reviewer', 'POST', `/tests/${qt.id}/submit`);
  const qrep = await api('reviewer', 'POST', `/quick-reports/${qr.id}/report`);
  const qdoc = await api('reviewer', 'GET', `/documents/${qrep.id}`);
  expect(qdoc.kind === 'report' && qdoc.data.client.name.includes('Ramesh Builders') && qdoc.data.rows.length > 0, 'quick report drafted with the typed customer and the results');
  expect((await api('reviewer', 'POST', `/quick-reports/${qr.id}/report`)).existing, 'creating the report twice opens the same draft');
  await api('reviewer', 'POST', `/reports/${qrep.id}/workflow`, { action: 'submit' });
  await api('owner', 'POST', `/reports/${qrep.id}/workflow`, { action: 'verify' });
  const qiss = await api('owner', 'POST', `/documents/${qrep.id}/issue`);
  expect(qiss.number && (await api('reviewer', 'GET', `/documents/${qrep.id}`)).status === 'issued', `quick report signed and issued as ${qiss.number} before any registration`);
  const reg = await api('frontdesk', 'POST', `/quick-reports/${qr.id}/register`, { client_id: client.id });
  const smp = await api('owner', 'GET', `/samples/${qr.id}`);
  const qdoc2 = await api('reviewer', 'GET', `/documents/${qrep.id}`);
  expect(smp.client.id === client.id && smp.code === reg.code && !/^QR/.test(reg.code) && qdoc2.client_id === client.id && qdoc2.data.client.name.includes('Ramesh Builders'), `registered later as sample ${reg.code}; the issued report is linked to the customer and keeps what was printed`);
  expect((await api('owner', 'GET', '/samples')).some((x) => x.id === qr.id), 'registered quick report now appears in the sample register');
  m = await fail(() => api('frontdesk', 'POST', `/quick-reports/${qr.id}/register`, { client_id: client.id }));
  expect(m, 'cannot register twice');
}
console.log('24. Employees, ID documents and attendance');
{
  let m = await fail(() => api('owner', 'POST', '/employees', { name: 'Test Person', id_type: 'Aadhaar', id_number: '1234' }));
  expect(/12 digits/.test(m), 'Aadhaar number is checked');
  const e1 = await api('owner', 'POST', '/employees', { name: 'Anil Kumar', code: 'E901', designation: 'Lab assistant', id_type: 'Aadhaar', id_number: '2345 6789 0123', pan: 'abcde1234f', date_of_joining: '2026-01-05', qualifications: 'Diploma Civil' });
  const g = await api('owner', 'GET', `/employees/${e1.id}`);
  expect(g.id_number === 'XXXX XXXX 0123' && g.pan === 'ABCDE1234F', 'ID number is shown masked; PAN normalised');
  const rv = await api('owner', 'POST', `/employees/${e1.id}/reveal-id`);
  expect(rv.id_number === '234567890123', 'HR can reveal the full number (recorded)');
  await api('owner', 'PUT', `/employees/${e1.id}`, { ...g, user: undefined, canManage: undefined, has_id_number: undefined, designation: 'Senior lab assistant' });
  expect((await api('owner', 'POST', `/employees/${e1.id}/reveal-id`)).id_number === '234567890123', 'saving the form with the masked number keeps the real one');
  m = await fail(() => api('frontdesk', 'POST', `/employees/${e1.id}/reveal-id`));
  expect(m, 'other roles cannot reveal ID numbers');
  const fu = await api('owner', 'POST', '/employees/from-users');
  expect(fu.created >= 5, `${fu.created} profiles created from app users`);
  const techMe = await api('tech', 'GET', '/employees/me');
  expect(techMe && /Ravi/.test(techMe.name), 'a user sees their own employee profile');
  expect((await api('tech', 'GET', '/employees')).length === 1, 'employees without HR rights see only themselves');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  await api('owner', 'POST', '/files', { entity: 'employee', entity_id: techMe.id, name: 'aadhaar.png', mime: 'image/png', data: png, kind: 'id' });
  expect((await api('tech', 'GET', `/files?entity=employee&entity_id=${techMe.id}`)).length === 1, 'employee can see their own ID document');
  m = await fail(() => api('frontdesk', 'GET', `/files?entity=employee&entity_id=${techMe.id}`));
  expect(m, "others cannot see an employee's ID documents");
  const d = today;
  await api('owner', 'PUT', '/attendance', { rows: [{ employee_id: e1.id, date: d, status: 'P', in_time: '09:05', out_time: '18:00' }, { employee_id: techMe.id, date: d, status: 'L', note: 'Casual leave' }] });
  const day = await api('owner', 'GET', `/attendance?date=${d}`);
  expect(day.records.length === 2 && day.records.find((r) => r.employee_id === e1.id).in_time === '09:05', 'daily register saved with in/out times');
  m = await fail(() => api('owner', 'PUT', '/attendance', { rows: [{ employee_id: e1.id, date: '2099-01-01', status: 'P' }] }));
  expect(/future/.test(m), 'future dates are refused');
  m = await fail(() => api('tech', 'PUT', '/attendance', { rows: [{ employee_id: techMe.id, date: d, status: 'P' }] }));
  expect(m, 'staff cannot mark their own attendance');
  const dd = `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
  const chk = await api('owner', 'POST', '/attendance/import', { rows: [{ 'Employee code': 'E901', Date: dd, 'In time': '9:30 AM', 'Out time': '6:15 PM' }, { 'Employee code': 'E999', Date: dd, Status: 'P' }, { 'Employee name': 'Anil Kumar', Date: 'yesterday?', Status: 'P' }], dryRun: true });
  expect(chk.valid === 1 && chk.errorCount === 2, 'upload is checked first: unknown employee and bad date reported');
  const imp = await api('owner', 'POST', '/attendance/import', { rows: [{ 'Emp Code': 'E901', Date: dd, 'Punch In': '9:30 AM', 'Punch Out': '6:15 PM' }], dryRun: false });
  const after = (await api('owner', 'GET', `/attendance?date=${d}`)).records.find((r) => r.employee_id === e1.id);
  expect(imp.updated === 1 && after.in_time === '09:30' && after.out_time === '18:15' && after.status === 'P', 'biometric-style upload updates the day (punch times → present)');
  const mon = await api('tech', 'GET', `/attendance?month=${d.slice(0, 7)}`);
  expect(mon.employees.length === 1 && mon.records.length === 1, 'staff see only their own monthly attendance');
}
console.log('25. Team chat');
{
  const usersAll = await api('owner', 'GET', '/users');
  const rev = usersAll.find((u) => u.role === 'reviewer'), own = usersAll.find((u) => u.role === 'owner');
  const p0 = await api('reviewer', 'GET', '/chat/poll');
  const sent = await api('owner', 'POST', '/chat/send', { to: rev.id, body: '**Urgent**: CBR for DCTL/0001 today\n\n| Test | Due |\n|---|---|\n| CBR | 5 pm |' });
  const p1 = await api('reviewer', 'GET', `/chat/poll?since=${p0.latestId}`);
  expect(p1.messages.some((m) => m.id === sent.id && m.from_name) && p1.unread >= 1 && p1.presence[own.id].online, 'new message reaches the colleague with unread count; sender shows online');
  const contacts = await api('reviewer', 'GET', '/chat/contacts');
  const oc = contacts.find((c) => c.id === own.id);
  expect(oc.unread === 1 && oc.last.body.startsWith('**Urgent**') && contacts[0].id === own.id, 'contact list shows unread and the latest message first');
  const conv = await api('reviewer', 'GET', `/chat/with/${own.id}`);
  expect(conv.messages.at(-1).body.includes('| CBR | 5 pm |'), 'rich text (bold, tables) is kept as written');
  const p2 = await api('reviewer', 'GET', `/chat/poll?since=${p1.latestId}`);
  expect(p2.unread === 0, 'opening the conversation marks it read');
  const back = await api('owner', 'GET', `/chat/with/${rev.id}`);
  expect(back.messages.find((m) => m.id === sent.id).read_at, 'sender sees the read tick');
  let m = await fail(() => api('owner', 'POST', '/chat/send', { to: 99999, body: 'x' }));
  expect(m, 'cannot message someone outside the company');
  m = await fail(() => api('owner', 'POST', '/chat/send', { to: rev.id, body: '   ' }));
  expect(m, 'empty messages are refused');
  const other = await api('tech', 'GET', `/chat/with/${own.id}`);
  expect(!other.messages.some((x) => x.id === sent.id), "people cannot read other people's conversations");
}
console.log('17. AI contract review');
if (process.env.MOCK_AI) {
  await api('owner', 'PUT', '/company', { ai: { enabled: true, provider: 'openai', baseUrl: process.env.MOCK_AI, model: 'mock', apiKey: 'x' } });
  const wq3 = await api('frontdesk', 'POST', '/documents', { kind: 'quote', client_id: client.id, data: { lines: [{ description: 'Water test', rate: 3200, qty: 1, catalogId: wat.id }] } });
  const cr = await api('frontdesk', 'POST', '/ai/contract-review', { text: 'CONTRACT. '.repeat(30) + ' Clause 14.2 Testing of water as per IS 456. BOQ 7 water testing Rs 2500 per sample.', fileName: 'contract.pdf', quote_id: wq3.id });
  expect(cr.summary.startsWith('Testing contract'), 'contract text reaches the AI and the summary comes back');
  const pw = cr.pricing.find((p) => p.catalogId === wat.id);
  expect(pw.ourRate === 3200 && pw.difference === -700 && pw.pct === -21.9 && /quotation/.test(pw.source), 'price difference vs the quotation computed exactly (₹2500 vs ₹3200 = −₹700, −21.9%)');
  expect(cr.requirements[1].catalogId === null && cr.unusualClauses[0].risk === 'high' && cr.deviations.length === 1, 'invented rate-card ids are dropped; risky clauses and deviations returned');
  await api('owner', 'PUT', '/company', { ai: { enabled: false } });
} else console.log('  (skipped – set MOCK_AI to run)');
console.log('26. Test-specific report formats, split reports, client fields, editable layout');
{
  const cube = byCode('CON-CUBE');
  expect(byCode('STEEL-CHEM') && byCode('GGBS-PHY') && byCode('GGBS-CHEM'), 'steel chemical and GGBS (physical / chemical) sheets are in the rate card');
  const fx = await api('owner', 'PUT', `/clients/${client.id}/extra-fields`, { fields: [{ label: 'Vehicle No', type: 'text', onReport: true }, { label: 'Invoice No', type: 'text', onReport: true }, { label: 'Internal note', type: 'text', onReport: false }] });
  expect(fx.fields.map((f) => f.key).join() === 'vehicle_no,invoice_no,internal_note', 'client-specific additional fields saved with keys');
  const site = detail.sites[0];
  const smp = await api('frontdesk', 'POST', '/samples', { client_id: client.id, site_id: site.id, material: 'Concrete', received_date: today, customer_ref: 'RPPL/QC/Oct/2026', customer_ref_date: '2026-10-29', received_time: '11:40', packing: 'Sealed bag', test_location: 'Laboratory (permanent facility)', specification: '150 x 150 x 150mm Size cube', condition: 'Satisfactory', source: 'Sample supplied by the customer', accreditation: cube.nabl ? 'NABL' : 'Non-NABL',
    extra: { vehicle_no: 'TS 08 UH 9299', invoice_no: '6676', internal_note: 'not printed' }, tests: [1, 2, 3].map(() => ({ catalog_id: cube.id, assigned_to: tech.id })) });
  const sv = await api('frontdesk', 'GET', `/samples/${smp.id}`);
  expect(sv.extra.vehicle_no === 'TS 08 UH 9299' && sv.extraFields.length === 3, 'additional information captured on the sample');
  const ts = sv.tests.sort((a, b) => a.id - b.id);
  const ages = [3, 7, 28];
  for (const [i, t] of ts.entries()) {
    const loads = [[400, 410, 420], [600, 610, 620], [879.8, 871.7, 842.4]][i];
    await api('tech', 'PUT', `/tests/${t.id}/observation`, { observation: { header: { grade: 'M30', age: ages[i], casting_date: today, element: 'Slab RCC, Tower-A' }, grids: { cubes: loads.map((load, k) => ({ id: `C${k + 1}`, l: 150, b: 150, h: 150, mass: 8.3, load })) }, constants: {}, equipment: {} }, started_at: today, completed_at: today, env_temp: '27', env_rh: '65' });
    await api('tech', 'POST', `/tests/${t.id}/submit`);
  }
  for (const t of ts.slice(0, 2)) await api('reviewer', 'POST', `/tests/${t.id}/review`, { action: 'accept' });
  const pend = await api('reviewer', 'GET', '/reports/pending-tests');
  expect(pend.filter((x) => x.sample_id === smp.id).map((x) => x.age).join() === '3,7', 'pending tests show the age of each cube set (28-day not accepted yet)');
  // Scenario A/B/C: separate 3-day and 7-day reports
  const two = await api('reviewer', 'POST', '/reports', { testIds: [ts[0].id, ts[1].id], split: 'each' });
  expect(two.ids.length === 2, 'one report per age (3-day and 7-day reports)');
  const r3 = await api('reviewer', 'GET', `/documents/${two.ids[0]}`);
  const L = r3.data.layout;
  const txt = (h) => String(h ?? '').replace(/<br>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
  const flat = (l) => l.sections.map((s) => s.type === 'table' ? s.rows.map((r) => r.map((c) => txt(c.h)).join('|')).join('\n') : txt(s.h ?? '')).join('\n');
  expect(L.format === 'cubes' && /TEST RESULTS – COMPRESSIVE STRENGTH OF CONCRETE CUBES/.test(flat(L)), 'cube report uses the cube format');
  const res3 = L.sections.find((x) => x.role === 'results');
  expect(res3.rows.length === 5 && txt(res3.rows[2][4].h) === '3' && res3.rows[2][8].rs === 3, '3-day report holds only the 3-day set (3 cubes, average merged)');
  expect(flat(L).includes(client.name) && flat(L).includes(`Project / site*|${site.project || site.name}`) && flat(L).includes('Customer reference*|RPPL/QC/Oct/2026, dated 29-10-2026') && flat(L).includes('Date & time of receipt|') && flat(L).includes(', 11:40') && flat(L).includes('Mode of packing|Sealed bag') && flat(L).includes('Test location|Laboratory (permanent facility)') && flat(L).includes('Environmental conditions|27 °C, 65 % RH'), 'customer block from the client master, project and customer reference');
  const band = L.sections[0];
  expect(band.role === 'idband' && band.rows[0].some((c) => /ULR No\./.test(c.h)) === (r3.accreditation === 'NABL') && band.rows[0].some((c) => /\{\{pageOf\}\}/.test(c.h)), 'identification band: report no., ULR only on NABL reports, issue date, page');
  expect(flat(L).includes('Additional details*|Vehicle No TS 08 UH 9299, Invoice No 6676') && !flat(L).includes('not printed'), 'additional information printed; fields marked "not on report" are left off');
  expect(!flat(L).includes(detail.contacts[0].name) || !r3.data.options.includeContact, 'contact details are off by default');
  // editing: sanitised, logged, protected fields ignored
  const edited = { ...L, edited: true, sections: [...L.sections, { id: 'x1', type: 'text', h: '<b>Note</b><script>alert(1)</script><img src=x onerror=alert(1)>' }] };
  await api('reviewer', 'PUT', `/documents/${two.ids[0]}`, { data: { layout: edited, tests: [], customer: { name: 'Hacked' } } });
  const r3b = await api('reviewer', 'GET', `/documents/${two.ids[0]}`);
  const last = r3b.data.layout.sections.at(-1);
  expect(last.h === '<b>Note</b>' && r3b.data.tests.length === 1 && r3b.data.customer.name === client.name, 'layout edits are sanitised; results snapshot and customer master copy cannot be overwritten');
  expect(r3b.history.some((h) => h.action === 'report layout edited'), 'layout edits are logged');
  const ref = await api('reviewer', 'POST', `/reports/${two.ids[0]}/refresh`);
  expect(ref.layoutKept, 'refreshing results keeps a layout edited by hand');
  await api('reviewer', 'PUT', `/documents/${two.ids[1]}`, { data: { remarks: 'Results meet the 7-day requirement.' } });
  const r7 = await api('reviewer', 'GET', `/documents/${two.ids[1]}`);
  expect(flat(r7.data.layout).includes('REMARKS\nResults meet the 7-day requirement.'), 'remarks typed in the details appear in the report body');
  await api('reviewer', 'POST', `/reports/${two.ids[1]}/workflow`, { action: 'submit' });
  await api('owner', 'POST', `/reports/${two.ids[1]}/workflow`, { action: 'verify' });
  const iss7 = await api('owner', 'POST', `/documents/${two.ids[1]}/issue`);
  const r7i = await api('owner', 'GET', `/documents/${two.ids[1]}`);
  const smpAfter = await api('frontdesk', 'GET', `/samples/${smp.id}`);
  expect(smpAfter.status !== 'reported', 'sample is not marked reported while its 28-day cubes are still pending');
  let m = await fail(() => api('reviewer', 'PUT', `/documents/${two.ids[1]}`, { data: { layout: r7i.data.layout } }));
  expect(m, 'an issued report cannot be edited');
  // Scenario D: 28-day report repeating the issued 7-day result
  await api('reviewer', 'POST', `/tests/${ts[2].id}/review`, { action: 'accept' });
  const withRep = await api('reviewer', 'GET', '/reports/pending-tests?withReported=1');
  const seven = withRep.find((x) => x.id === ts[1].id);
  expect(seven && seven.reported_in === iss7.number, 'issued results are offered for a later report, marked with the report they were issued in');
  m = await fail(() => api('reviewer', 'POST', '/reports', { testIds: [ts[1].id] }));
  expect(m, 'a report needs at least one result not issued before');
  const r28 = await api('reviewer', 'POST', '/reports', { testIds: [ts[2].id, ts[1].id] });
  const d28 = await api('reviewer', 'GET', `/documents/${r28.id}`);
  const res28 = d28.data.layout.sections.find((x) => x.role === 'results');
  expect(res28.rows.length === 8 && d28.data.tests.find((t) => t.id === ts[1].id).previous === iss7.number, '28-day report includes the earlier 7-day result (consolidated)');
  const r7again = await api('owner', 'GET', `/documents/${two.ids[1]}`);
  expect(r7again.status === 'issued' && r7again.hash === r7i.hash && JSON.stringify(r7again.data) === JSON.stringify(r7i.data), 'the issued 7-day report is unchanged');
  await api('reviewer', 'POST', `/reports/${r28.id}/workflow`, { action: 'submit' });
  await api('owner', 'POST', `/reports/${r28.id}/workflow`, { action: 'verify' });
  await api('owner', 'POST', `/documents/${r28.id}/issue`);
  const tl = await api('owner', 'GET', `/tests/${ts[1].id}`);
  expect(tl.report_id === two.ids[1], 'the 7-day test stays linked to the report it was first issued in');
  expect((await api('frontdesk', 'GET', `/samples/${smp.id}`)).status !== 'reported', 'still not reported while the 3-day report is a draft');
  await api('reviewer', 'POST', `/reports/${two.ids[0]}/workflow`, { action: 'submit' });
  await api('owner', 'POST', `/reports/${two.ids[0]}/workflow`, { action: 'verify' });
  await api('owner', 'POST', `/documents/${two.ids[0]}/issue`);
  const smpDone = await api('frontdesk', 'GET', `/samples/${smp.id}`);
  expect(smpDone.status === 'reported', 'sample is reported once every age is reported');
}

console.log('\nALL CHECKS PASSED');
