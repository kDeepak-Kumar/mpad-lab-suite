// End-to-end API smoke test of the whole workflow. Run against a fresh demo database:
//   node scripts/api-flow.mjs http://localhost:4000
const base = process.argv[2] || 'http://localhost:4000';
const PASS = process.env.DEMO_PASSWORD || 'Demo@12345';
const sessions = {};
async function as(user) {
  if (sessions[user]) return sessions[user];
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${user}@demo.lab`, password: PASS }) });
  if (!r.ok) throw new Error(`login ${user}: ${await r.text()}`);
  sessions[user] = r.headers.get('set-cookie').split(';')[0];
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
console.log('\nALL CHECKS PASSED');
