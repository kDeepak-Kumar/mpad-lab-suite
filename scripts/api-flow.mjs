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
expect(s.code && s.ulr, `sample ${s.code} registered with ULR ${s.ulr}`);

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
console.log('\nALL CHECKS PASSED');
