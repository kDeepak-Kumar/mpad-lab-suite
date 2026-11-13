import { Router } from 'express';
import { z } from 'zod';
import { evaluateObservation, normalizeObservation, type ObservationInput } from '@suite/shared';
import { db, insert, now, parseJson, row, today, toJson } from '../db';
import { allow, can, h, HttpError, isAdmin, type AuthUser, zBool } from '../auth';
import { cleanWrite, mergeCustom } from '../meta';
import { buildLayout } from '@suite/shared';
import { audit, buildReportData, extraFieldDefs, getCompany, getObsTemplate, nextNumber, formatWithSeq } from '../services';
import { isIsoDate } from '@suite/shared';
const isoDate = z.string().refine(isIsoDate, 'Enter a valid date (YYYY-MM-DD)');

export const lab = Router();

const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// ---------- work orders ----------
lab.get('/workorders', allow('workorder.read'), h(async (req) => {
  const cid = req.user.company_id;
  const wos = await db('work_orders as w').leftJoin('clients as c', 'c.id', 'w.client_id').leftJoin('sites as s', 's.id', 'w.site_id')
    .where('w.company_id', cid).orderBy('w.id', 'desc').select('w.*', 'c.name as client_name', 's.name as site_name');
  const counts = await db('samples').where({ company_id: cid }).select('work_order_id').count({ n: 'id' }).groupBy('work_order_id');
  const m = new Map((counts as { work_order_id: number; n: number }[]).map((c) => [c.work_order_id, Number(c.n)]));
  return wos.map((w) => ({ ...w, samples: m.get(w.id) ?? 0 }));
}));
const woSchema = z.object({ client_id: z.number(), site_id: z.number().nullable().optional(), quote_id: z.number().nullable().optional(), customer_ref: z.string().optional().nullable(), date: isoDate.optional(), notes: z.string().optional().nullable() });
export async function createWorkOrder(user: AuthUser, body: z.infer<typeof woSchema>) {
  const cid = user.company_id;
  return db.transaction(async (trx) => {
    const date = body.date || today();
    const { number } = await nextNumber(trx, cid, 'workorder', { date });
    const id = await insert(trx, 'work_orders', { ...body, date, number, company_id: cid, status: 'open', created_at: now() });
    await audit(trx, user, 'workorder', id, 'created', { number });
    return { id, number };
  });
}
lab.post('/workorders', allow('workorder.create'), h(async (req) => createWorkOrder(req.user, woSchema.parse(req.body))));
lab.get('/workorders/:id', allow('workorder.read'), h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id);
  const wo = await db('work_orders').where({ id, company_id: cid }).first();
  if (!wo) throw new HttpError(404, 'Work order not found');
  const [client, site, quote, samples, docs] = await Promise.all([
    db('clients').where({ id: wo.client_id }).first('id', 'name', 'short_code'),
    wo.site_id ? db('sites').where({ id: wo.site_id }).first() : null,
    wo.quote_id ? db('documents').where({ id: wo.quote_id }).first('id', 'number', 'status', 'data') : null,
    db('samples').where({ work_order_id: id, company_id: cid }).orderBy('id'),
    db('documents').where({ work_order_id: id, company_id: cid }).orderBy('id', 'desc').select('id', 'kind', 'number', 'status', 'date', 'total'),
  ]);
  const tests = samples.length ? await db('tests as t').leftJoin('catalog as k', 'k.id', 't.catalog_id').whereIn('t.sample_id', samples.map((s) => s.id))
    .select('t.id', 't.sample_id', 't.status', 't.due_date', 't.report_id', 'k.billing_name', 'k.report_name', 'k.rate', 'k.unit') : [];
  return { ...wo, client, site, quote: quote ? row(quote, ['data']) : null, samples: samples.map((s) => ({ ...s, tests: tests.filter((t) => t.sample_id === s.id) })), documents: docs };
}));

// ---------- samples (sample register) ----------
/** Store additional-information values on the sample (empty values removed). */
function withExtra(d: Record<string, any>, extra?: Record<string, unknown> | null) {
  if (!extra) return d;
  const next: Record<string, unknown> = { ...(d.extra ?? {}) };
  for (const [k, v] of Object.entries(extra)) { if (!/^[a-z0-9_]{1,40}$/.test(k)) continue; if (v === null || v === '') delete next[k]; else next[k] = typeof v === 'string' ? v.trim() : v; }
  return { ...d, extra: next };
}
const sampleSchema = z.object({
  work_order_id: z.number().nullable().optional(), client_id: z.number(), site_id: z.number().nullable().optional(),
  accreditation: z.string().optional().nullable(), custom: z.record(z.any()).optional(),
  material: z.string().min(1), description: z.string().optional().nullable(), quantity: z.string().optional().nullable(),
  condition: z.string().optional().nullable(), source: z.string().optional().nullable(), received_date: isoDate,
  customer_ref: z.string().optional().nullable(), specification: z.string().optional().nullable(), sample_label: z.string().optional().nullable(),
  received_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time received must be HH:MM').optional().nullable().or(z.literal('')),
  customer_ref_date: isoDate.optional().nullable().or(z.literal('')), packing: z.string().max(80).optional().nullable(), test_location: z.string().max(80).optional().nullable(),
  retention_days: z.number().int().min(0).max(3650).nullable().optional(),
  /** Client-specific additional information (supplier, vehicle no., invoice no. …) – fields defined on the client. */
  extra: z.record(z.union([z.string().max(300), z.number(), z.null()])).optional(),
  tests: z.array(z.object({ catalog_id: z.number(), assigned_to: z.number().nullable().optional(), due_date: isoDate.optional().nullable().or(z.literal('')) })).min(1, 'Add at least one test'),
});
lab.get('/samples', allow('sample.read'), h(async (req) => {
  const cid = req.user.company_id;
  const q = String(req.query.q ?? '').trim();
  const rows = await db('samples as s').leftJoin('clients as c', 'c.id', 's.client_id').leftJoin('sites as st', 'st.id', 's.site_id')
    .where('s.company_id', cid).andWhere((w) => (req.query.quick === '1' ? w.where('s.quick', true) : w.whereNull('s.quick').orWhere('s.quick', false))).modify((b) => { if (q) b.andWhere((w) => w.where('s.code', 'like', `%${q}%`).orWhere('c.name', 'like', `%${q}%`).orWhere('s.ulr', 'like', `%${q}%`)); })
    .orderBy('s.id', 'desc').limit(500).select('s.*', 'c.name as client_name', 'st.name as site_name') as Record<string, any>[];
  const tests = rows.length ? await db('tests as t').leftJoin('catalog as k', 'k.id', 't.catalog_id').whereIn('t.sample_id', rows.map((r) => r.id)).select('t.sample_id', 't.status', 'k.report_name', 'k.billing_name') : [];
  return rows.map((r) => ({ ...r, tests: tests.filter((t) => t.sample_id === r.id) }));
}));
lab.post('/samples', allow('samples'), h(async (req) => {
  const cid = req.user.company_id;
  const s = (await cleanWrite(cid, req.user.roleDef, 'sample', sampleSchema.parse(req.body), { creating: true })) as z.infer<typeof sampleSchema>;
  const client = await db('clients').where({ id: s.client_id, company_id: cid }).first();
  if (!client) throw new HttpError(404, 'Client not found');
  const cats = await db('catalog').whereIn('id', s.tests.map((t) => t.catalog_id)).andWhere({ company_id: cid });
  const missing = cats.filter((c) => !c.obs_template_code);
  if (missing.length) throw new HttpError(400, `No observation sheet linked to: ${missing.map((m) => m.billing_name).join(', ')}. Link one in Rate card.`);
  const accreditation = s.accreditation || (cats.some((c) => c.nabl) ? 'NABL' : 'Non-NABL');
  const outOfScope = cats.filter((c) => !c.nabl);
  if (accreditation === 'NABL' && outOfScope.length && !isAdmin(req.user))
    throw new HttpError(400, `Not in NABL scope: ${outOfScope.map((c) => c.report_name || c.billing_name).join(', ')}. Register those as a separate Non-NABL sample.`);
  const keep = s.retention_days ?? await defaultRetention(cid, s.material); // read before the transaction (SQLite has one connection)
  return db.transaction(async (trx) => {
    const ctx = { date: s.received_date, client: client.short_code || client.name.replace(/[^A-Za-z]/g, '').slice(0, 4), material: s.material };
    const { seq, number: code } = await nextNumber(trx, cid, 'sample', ctx);
    const ulr = null; // NABL: one ULR per test report, assigned when the report is signed and issued
    const { tests, custom, extra, ...sample } = s;
    const id = await insert(trx, 'samples', { ...sample, retention_days: keep, dispose_after: addDays(s.received_date, keep), accreditation, data: toJson(withExtra(mergeCustom(null, custom), extra)), seq, code, ulr, company_id: cid, status: 'registered', created_at: now() });
    const outsourced = new Map<number | null, number[]>();
    for (const t of tests) {
      const cat = cats.find((c) => c.id === t.catalog_id)!;
      const tpl = await getObsTemplate(cid, cat.obs_template_code, null, trx);
      const testId = await insert(trx, 'tests', {
        company_id: cid, sample_id: id, catalog_id: cat.id, template_code: tpl.code, template_version: tpl.version, status: 'pending',
        assigned_to: t.assigned_to ?? null, due_date: t.due_date || addDays(s.received_date, Number(cat.tat_days ?? 3)), created_at: now(),
      });
      if (cat.performed_by === 'vendor') outsourced.set(cat.vendor_id ?? null, [...(outsourced.get(cat.vendor_id ?? null) ?? []), testId]);
    }
    // Tests done by an external lab: one "to send" job per vendor, so nobody forgets to dispatch the sample.
    for (const [vendor, ids] of outsourced) await insert(trx, 'outsource_jobs', { company_id: cid, sample_id: id, vendor_id: vendor, test_ids: toJson(ids), status: 'to_send', created_by: req.user.id, created_at: now(), updated_at: now() });
    await audit(trx, req.user, 'sample', id, 'registered', { code, ulr, accreditation, tests: tests.length });
    return { id, code, ulr, accreditation };
  });
}));
lab.get('/samples/:id', allow('sample.read'), h(async (req) => {
  const cid = req.user.company_id;
  const s = await db('samples').where({ id: Number(req.params.id), company_id: cid }).first();
  if (!s) throw new HttpError(404, 'Sample not found');
  const tests = await db('tests as t').leftJoin('catalog as k', 'k.id', 't.catalog_id').leftJoin('users as u', 'u.id', 't.assigned_to')
    .where('t.sample_id', s.id).select('t.id', 't.status', 't.due_date', 't.report_id', 't.template_code', 'k.billing_name', 'k.report_name', 'k.method', 'u.name as assignee');
  const client = await db('clients').where({ id: s.client_id }).first('id', 'name', 'data');
  const r0 = row(s, ['data']) as Record<string, any>;
  return { ...r0, custom: r0.data?.custom ?? {}, extra: r0.data?.extra ?? {}, extraFields: extraFieldDefs(client), client: client ? { id: client.id, name: client.name } : null, tests };
}));
/** Days a sample is retained after receipt: Settings → Defaults (per material, else general), else 30. */
async function defaultRetention(cid: number, material: string) {
  const d = ((await getCompany(cid)).defaults ?? {}) as Record<string, any>;
  return Number(d.retentionByMaterial?.[material] ?? d.retentionDays ?? 30);
}
lab.post('/samples/:id/disposal', allow('samples'), h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id);
  const ex = await db('samples').where({ id, company_id: cid }).first('id');
  if (!ex) throw new HttpError(404, 'Sample not found');
  const b = z.object({ date: isoDate, method: z.string().min(2).max(60), note: z.string().max(500).optional().nullable() }).parse(req.body);
  await db('samples').where({ id }).update({ disposed_at: b.date, disposal_method: b.method, disposal_note: b.note ?? null, disposed_by: req.user.id });
  await audit(db, req.user, 'sample', id, 'disposal recorded', b);
  return { ok: true };
}));
lab.delete('/samples/:id/disposal', allow('samples'), h(async (req) => {
  await db('samples').where({ id: Number(req.params.id), company_id: req.user.company_id }).update({ disposed_at: null, disposal_method: null, disposal_note: null, disposed_by: null });
  await audit(db, req.user, 'sample', Number(req.params.id), 'disposal undone');
  return { ok: true };
}));
lab.put('/samples/:id', allow('samples'), h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id);
  const ex = await db('samples').where({ id, company_id: cid }).first();
  if (!ex) throw new HttpError(404, 'Sample not found');
  if (ex.status === 'reported' && !isAdmin(req.user)) throw new HttpError(409, 'This sample is already reported');
  const { custom, extra, ...patch } = (await cleanWrite(cid, req.user.roleDef, 'sample', sampleSchema.omit({ tests: true }).partial().parse(req.body), { creating: false })) as Record<string, any>;
  if (patch.retention_days !== undefined || patch.received_date) {
    const keep = patch.retention_days ?? ex.retention_days ?? await defaultRetention(cid, ex.material);
    patch.retention_days = keep; patch.dispose_after = addDays(patch.received_date ?? ex.received_date, keep);
  }
  if (patch.accreditation === 'Non-NABL') patch.ulr = null;
  await db('samples').where({ id }).update({ ...patch, data: toJson(withExtra(mergeCustom(ex.data, custom), extra)) });
  await audit(db, req.user, 'sample', id, 'updated', patch);
  return { ok: true };
}));

// ---------- tests & observation sheets ----------
lab.get('/tests', allow('test.read'), h(async (req) => {
  const cid = req.user.company_id;
  const q = db('tests as t').join('samples as s', 's.id', 't.sample_id').leftJoin('clients as c', 'c.id', 's.client_id')
    .leftJoin('catalog as k', 'k.id', 't.catalog_id').leftJoin('users as u', 'u.id', 't.assigned_to')
    .where('t.company_id', cid)
    .select('t.id', 't.status', 't.due_date', 't.sample_id', 't.report_id', 't.started_at', 't.completed_at', 't.submitted_at', 't.reviewed_at', 't.review_note', 't.template_code',
      's.code as sample_code', 's.material', 's.accreditation', 's.received_date', 's.client_id', 'c.name as client_name', 'k.report_name', 'k.billing_name', 'k.nabl', 'u.name as assignee', 't.assigned_to');
  if (req.query.status) q.whereIn('t.status', String(req.query.status).split(','));
  if (req.query.mine) q.andWhere('t.assigned_to', req.user.id);
  if (req.query.client_id) q.andWhere('s.client_id', Number(req.query.client_id));
  return q.orderBy([{ column: 't.due_date' }, { column: 't.id' }]).limit(500);
}));
lab.get('/tests/:id', allow('test.read'), h(async (req) => {
  const cid = req.user.company_id;
  const t = row(await db('tests').where({ id: Number(req.params.id), company_id: cid }).first(), ['observation', 'results', 'checks']);
  if (!t) throw new HttpError(404, 'Test not found');
  const sample = await db('samples').where({ id: t.sample_id }).first();
  const [client, site, catalog, template, users] = await Promise.all([
    db('clients').where({ id: sample.client_id }).first('id', 'name', 'address'),
    sample.site_id ? db('sites').where({ id: sample.site_id }).first('id', 'name') : null,
    t.catalog_id ? db('catalog').where({ id: t.catalog_id }).first() : null,
    getObsTemplate(cid, t.template_code as string, t.template_version as number),
    db('users').where({ company_id: cid }).select('id', 'name', 'role'),
  ]);
  const cats = (template.equipment ?? []).map((e) => e.category);
  const equipment = cats.length ? (await db('equipment').where({ company_id: cid, active: true }).whereIn('category', cats)).map((e) => row(e, ['data'])) : [];
  const history = await db('audit_log').where({ company_id: cid, entity: 'test', entity_id: t.id }).orderBy('id', 'desc');
  const names = new Map(users.map((u) => [u.id, u.name]));
  const qc = sample.quick ? parseJson<{ quickCustomer?: Record<string, string> }>(sample.data, {}).quickCustomer ?? null : null; // quick report: customer as typed
  return { ...t, sample, client: qc ? { id: null, name: `${qc.name} (quick report)`, address: qc.address ?? '' } : client, site, catalog: row(catalog, []), template, equipment, users,
    enteredBy: names.get(t.entered_by as number), reviewedBy: names.get(t.reviewed_by as number),
    history: history.map((x) => ({ ...row(x, ['detail']), user: names.get(x.user_id) })) };
}));

function diffObservation(a: ObservationInput | null, b: ObservationInput) {
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  if (!a) return changes;
  for (const [k, v] of Object.entries(b.header ?? {})) if ((a.header?.[k] ?? null) !== (v ?? null)) changes.push({ field: k, from: a.header?.[k] ?? null, to: v ?? null });
  for (const [g, rows] of Object.entries(b.grids ?? {})) rows.forEach((r, i) => {
    for (const [c, v] of Object.entries(r)) {
      const old = a.grids?.[g]?.[i]?.[c] ?? null;
      if (old !== (v ?? null) && !(old === '' && v === null)) changes.push({ field: `${g} row ${i + 1} ${c}`, from: old, to: v ?? null });
    }
  });
  const eqA = JSON.stringify(Object.fromEntries(Object.entries(a.equipment ?? {}).map(([k, v]) => [k, v?.id ?? null])));
  const eqB = JSON.stringify(Object.fromEntries(Object.entries(b.equipment ?? {}).map(([k, v]) => [k, v?.id ?? null])));
  if (eqA !== eqB) changes.push({ field: 'equipment', from: eqA, to: eqB });
  return changes;
}

lab.put('/tests/:id/observation', allow('observe'), h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id);
  const t = row(await db('tests').where({ id, company_id: cid }).first(), ['observation']);
  if (!t) throw new HttpError(404, 'Test not found');
  const admin = isAdmin(req.user);
  if (!['pending', 'in_progress', 'returned'].includes(t.status as string) && !(admin && t.status !== 'reported'))
    throw new HttpError(409, 'This observation sheet is locked. Ask the reviewer to return it for correction.');
  const body = z.object({ observation: z.any(), started_at: z.string().nullable().optional(), completed_at: z.string().nullable().optional(), reason: z.string().optional(),
    env_temp: z.string().max(12).nullable().optional(), env_rh: z.string().max(12).nullable().optional() }).parse(req.body);
  const tpl = await getObsTemplate(cid, t.template_code as string, t.template_version as number);
  if (!body.observation || typeof body.observation !== 'object') throw new HttpError(400, 'Observation data is missing');
  const raw = body.observation as ObservationInput;
  const norm = normalizeObservation(tpl, { ...raw, header: raw.header ?? {}, grids: raw.grids ?? {} });
  if (norm.issues.length) throw new HttpError(400, `Please correct: ${norm.issues.slice(0, 3).join('; ')}${norm.issues.length > 3 ? ` (+${norm.issues.length - 3} more)` : ''}`);
  // keep the external-lab marker when the sheet is edited by hand later
  const prevExt = (t.observation as { external?: unknown } | null)?.external;
  const obs: ObservationInput & { external?: unknown } = prevExt ? { ...norm.input, external: prevExt } : norm.input;
  // refresh equipment calibration data from the register (never trust the client copy)
  for (const slot of tpl.equipment ?? []) {
    const sel = obs.equipment?.[slot.key];
    if (sel?.id) {
      const e = row(await db('equipment').where({ id: sel.id, company_id: cid }).first(), ['data']);
      if (!e) throw new HttpError(400, 'Selected equipment not found');
      const d = body.completed_at || body.started_at || today();
      if (e.due_date && (e.due_date as string) < d && !admin) throw new HttpError(400, `${e.name} calibration expired on ${e.due_date}. Choose calibrated equipment.`);
      obs.equipment![slot.key] = { id: e.id as number, name: e.name as string, data: { ...(e.data as Record<string, number>), certNo: e.cert_no as string, dueDate: e.due_date as string } };
    }
  }
  const res = evaluateObservation(tpl, obs);
  const changes = diffObservation(t.observation as ObservationInput | null, obs);
  await db('tests').where({ id }).update({
    observation: toJson(obs), results: toJson(res.results), checks: toJson(res.checks), status: t.status === 'pending' ? 'in_progress' : t.status,
    started_at: body.started_at ?? t.started_at ?? today(), completed_at: body.completed_at ?? null, ...(body.env_temp !== undefined ? { env_temp: body.env_temp || null } : {}), ...(body.env_rh !== undefined ? { env_rh: body.env_rh || null } : {}), entered_by: t.entered_by && admin && t.status !== 'pending' ? t.entered_by : req.user.id,
  });
  if ((t.status === 'returned' || (admin && !['pending', 'in_progress'].includes(t.status as string))) && changes.length) await audit(db, req.user, 'test', id, 'correction', { changes, reason: body.reason ?? '' });
  else if (changes.length || !t.observation) await audit(db, req.user, 'test', id, t.observation ? 'observation edited' : 'observation started', { changes: changes.length });
  return { results: res.results, checks: res.checks };
}));
/** What this test shows on the report (template default unless switched here). Allowed until the report is issued. */
lab.put('/tests/:id/report-options', h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id);
  const t = row(await db('tests').where({ id, company_id: cid }).first(), ['observation']);
  if (!t) throw new HttpError(404, 'Test not found');
  if (t.status === 'reported') throw new HttpError(409, 'The report is already issued. Amend the report to change what it shows.');
  if (!(can(req.user, 'enterObservations') || can(req.user, 'reviewTests') || can(req.user, 'reportPrepare'))) throw new HttpError(403, 'Your role cannot change report options');
  const { show } = z.object({ show: z.record(zBool) }).parse(req.body);
  const obs = { header: {}, grids: {}, ...((t.observation as ObservationInput | null) ?? {}), show };
  await db('tests').where({ id }).update({ observation: toJson(obs) });
  await audit(db, req.user, 'test', id, 'report options changed', { show });
  return { ok: true };
}));
lab.post('/tests/:id/submit', allow('observe'), h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id);
  const t = row(await db('tests').where({ id, company_id: cid }).first(), ['observation', 'checks']);
  if (!t) throw new HttpError(404, 'Test not found');
  const admin = isAdmin(req.user);
  if (!['in_progress', 'returned'].includes(t.status as string)) throw new HttpError(409, 'Save the observation sheet before submitting');
  const tpl = await getObsTemplate(cid, t.template_code as string, t.template_version as number);
  const obs = t.observation as ObservationInput;
  const missing = tpl.headerFields.filter((f) => f.required && f.default === undefined && (obs?.header?.[f.key] === null || obs?.header?.[f.key] === undefined || obs?.header?.[f.key] === ''));
  if (missing.length && !admin) throw new HttpError(400, `Fill in: ${missing.map((m) => m.label).join(', ')}`);
  const errs = ((t.checks ?? []) as { level: string; message: string }[]).filter((c) => c.level === 'error');
  if (errs.length && !admin) throw new HttpError(400, errs.map((e) => e.message).join(' '));
  if (admin && (missing.length || errs.length)) await audit(db, req.user, 'test', id, 'submitted by System Admin with checks bypassed', { missing: missing.map((m) => m.label), errors: errs.map((e) => e.message) });
  await db('tests').where({ id }).update({ status: 'submitted', submitted_at: now(), completed_at: t.completed_at ?? today() });
  await db('samples').where({ id: t.sample_id }).update({ status: 'in_test' });
  await audit(db, req.user, 'test', id, 'submitted for review');
  return { ok: true };
}));
lab.post('/tests/:id/review', allow('review'), h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id);
  const { action, note } = z.object({ action: z.enum(['accept', 'return']), note: z.string().optional() }).parse(req.body);
  const t = await db('tests').where({ id, company_id: cid }).first();
  if (!t) throw new HttpError(404, 'Test not found');
  const admin = isAdmin(req.user);
  if (t.status !== 'submitted' && !(admin && ['in_progress', 'returned', 'pending'].includes(t.status))) throw new HttpError(409, 'Only submitted observation sheets can be reviewed');
  if (admin && !t.observation) throw new HttpError(400, 'Enter observations first');
  const company = await getCompany(cid);
  if (!admin && t.entered_by === req.user.id && !(company as { defaults?: { allowSelfReview?: boolean } }).defaults?.allowSelfReview)
    throw new HttpError(403, 'The person who entered the observations cannot review them');
  if (action === 'return' && !note) throw new HttpError(400, 'Add a note saying what needs correcting');
  await db('tests').where({ id }).update({ status: action === 'accept' ? 'accepted' : 'returned', reviewed_by: req.user.id, reviewed_at: now(), review_note: note ?? null });
  await audit(db, req.user, 'test', id, action === 'accept' ? 'accepted' : 'returned for correction', { note });
  return { ok: true };
}));
lab.post('/tests/:id/assign', allow('samples'), h(async (req) => {
  const { user_id } = z.object({ user_id: z.number().nullable() }).parse(req.body);
  await db('tests').where({ id: Number(req.params.id), company_id: req.user.company_id }).update({ assigned_to: user_id });
  await audit(db, req.user, 'test', Number(req.params.id), 'assigned', { user_id });
  return { ok: true };
}));

// ---------- reports ----------
/** Create one report draft from accepted tests (results already issued on another report may be repeated on it). */
async function draftReport(req: { user: AuthUser }, testIds: number[]) {
  const cid = req.user.company_id;
  const data = await buildReportData(cid, testIds);
  const smp = await db('samples').whereIn('id', data.sampleIds);
  const types = [...new Set(smp.map((x) => x.accreditation || 'Non-NABL'))];
  if (types.length > 1 && !isAdmin(req.user)) throw new HttpError(400, 'NABL and Non-NABL samples cannot share one report. Prepare them as separate reports.');
  const accreditation = types.length === 1 ? types[0] : 'Non-NABL';
  const s = smp.find((x) => x.id === data.sampleIds[0]);
  const tpl = await db('doc_templates').where({ company_id: cid, kind: 'report' }).orderBy([{ column: 'is_default', order: 'desc' }, { column: 'version', order: 'desc' }]).first();
  const client = await db('clients').where({ id: s.client_id }).first();
  const full = { ...data, accreditation, client: { name: client.name, address: client.address, gstin: client.gstin }, options: { includeContact: false, includeExtra: true, extraStyle: 'line' as const } };
  const layout = buildLayout({ data: full });
  const id = await insert(db, 'documents', {
    company_id: cid, kind: 'report', status: 'draft', client_id: s.client_id, site_id: s.site_id, work_order_id: s.work_order_id, date: today(), accreditation,
    data: toJson({ ...full, layout }), overrides: toJson({}), template_id: tpl?.id, totals: toJson(null), created_by: req.user.id, created_at: now(), updated_at: now(),
  });
  // tests issued on an earlier report keep pointing at it: that report is never changed
  await db('tests').whereIn('id', testIds).andWhere((w) => w.whereNull('report_id').orWhereIn('report_id', db('documents').select('id').where({ status: 'cancelled' }))).update({ report_id: id });
  await db('tests').whereIn('id', testIds).whereIn('report_id', db('documents').select('id').whereIn('status', ['draft', 'review', 'verified']).whereNot({ id })).update({ report_id: id });
  await audit(db, req.user, 'document', id, 'report drafted', { tests: testIds, format: layout.format });
  return id;
}
lab.post('/reports', allow('reportPrepare'), h(async (req) => {
  const cid = req.user.company_id;
  const { testIds, split } = z.object({ testIds: z.array(z.number()).min(1), split: z.enum(['none', 'each', 'sample']).default('none') }).parse(req.body);
  const tests = await db('tests').whereIn('id', testIds).andWhere({ company_id: cid });
  if (tests.length !== new Set(testIds).size) throw new HttpError(404, 'Test not found');
  const reps = await db('documents').whereIn('id', tests.map((t) => t.report_id).filter(Boolean));
  for (const t of tests) {
    const rep = reps.find((r) => r.id === t.report_id);
    if (rep && ['draft', 'review', 'verified'].includes(rep.status)) throw new HttpError(409, `A test is already on report draft #${rep.id}${rep.number ? ' (' + rep.number + ')' : ''}`);
  }
  // every report needs at least one result that was not issued before
  const fresh = (ids: number[]) => ids.some((i) => { const t = tests.find((x) => x.id === i); const rep = reps.find((r) => r.id === t?.report_id); return !rep || rep.status === 'cancelled'; });
  let groups: number[][] = [testIds];
  if (split === 'each') groups = testIds.filter((i) => fresh([i])).map((i) => [i, ...(testIds.filter((j) => !fresh([j]) && tests.find((x) => x.id === j)?.sample_id === tests.find((x) => x.id === i)?.sample_id))]);
  if (split === 'sample') groups = [...new Set(tests.map((t) => t.sample_id))].map((sid) => tests.filter((t) => t.sample_id === sid).map((t) => t.id));
  groups = groups.filter((g) => g.length && fresh(g));
  if (!groups.length) throw new HttpError(400, 'Select at least one result that has not been issued yet');
  const ids: number[] = [];
  for (const g of groups) ids.push(await draftReport(req, g));
  return { id: ids[0], ids };
}));
lab.post('/reports/:id/refresh', allow('reportPrepare'), h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id);
  const d = row(await db('documents').where({ id, company_id: cid, kind: 'report' }).first(), ['data']);
  if (!d) throw new HttpError(404, 'Report not found');
  if (!['draft'].includes(d.status as string)) throw new HttpError(409, 'Only draft reports can be refreshed');
  const old = d.data as Record<string, unknown>;
  const data = await buildReportData(cid, old.testIds as number[]);
  const keep = Object.fromEntries(Object.entries(old).filter(([k]) => ['client', 'remarks', 'notes', 'accreditation', 'unlocked', 'custom', 'specification', 'condition', 'source', 'customerRef', 'samples', 'hideCharts', 'options', 'sealPos', 'signatoryId'].includes(k) || (old.unlocked as any)?.[k]));
  const next: Record<string, unknown> = { ...data, ...keep };
  const prev = old.layout as { edited?: boolean } | undefined;
  // a layout edited by hand is kept (the user can rebuild it from the format); otherwise it follows the new results
  next.layout = prev?.edited ? prev : buildLayout({ data: next as never });
  await db('documents').where({ id }).update({ data: toJson(next), updated_at: now() });
  return { ok: true, layoutKept: Boolean(prev?.edited) };
}));
lab.post('/reports/:id/workflow', h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id);
  const { action, note } = z.object({ action: z.enum(['submit', 'sendback', 'verify']), note: z.string().optional() }).parse(req.body);
  const d = row(await db('documents').where({ id, company_id: cid, kind: 'report' }).first(), ['data']);
  if (!d) throw new HttpError(404, 'Report not found');
  const map: Record<string, { from: string[]; to: string; perm: 'reportPrepare' | 'reportIssue'; label: string }> = {
    submit: { from: ['draft'], to: 'review', perm: 'reportPrepare', label: 'sent for verification' },
    sendback: { from: ['review', 'verified'], to: 'draft', perm: 'reportIssue', label: 'sent back' },
    verify: { from: ['review'], to: 'verified', perm: 'reportIssue', label: 'verified' },
  };
  const m = map[action];
  if (!can(req.user, m.perm)) throw new HttpError(403, 'Your role does not allow this action');
  const from = isAdmin(req.user) && action === 'verify' ? ['draft', 'review'] : m.from;
  if (!from.includes(d.status as string)) throw new HttpError(409, `Report is ${d.status}; cannot ${action}`);
  if (action === 'sendback' && !note) throw new HttpError(400, 'Add a note for the reviewer');
  const data = { ...(d.data as object), workflowNote: action === 'sendback' ? note : null };
  await db('documents').where({ id }).update({ status: m.to, data: toJson(data), updated_at: now() });
  await audit(db, req.user, 'document', id, `report ${m.label}`, { note });
  return { ok: true };
}));
lab.get('/reports/pending-tests', h(async (req) => {
  // accepted tests not yet on a live report, grouped by sample
  const cid = req.user.company_id;
  if (req.query.withReported) {
    // also results already issued on a report, for samples that still have results waiting (e.g. 3 / 7-day cubes for the 28-day report)
    const pending = await db('tests as t').leftJoin('documents as d', 'd.id', 't.report_id').where('t.company_id', cid).andWhere('t.status', 'accepted')
      .andWhere((w) => w.whereNull('t.report_id').orWhere('d.status', 'cancelled')).distinct('t.sample_id');
    const sids = pending.map((r) => r.sample_id);
    if (!sids.length) return [];
    return db('tests as t').join('samples as s', 's.id', 't.sample_id').leftJoin('clients as c', 'c.id', 's.client_id').leftJoin('catalog as k', 'k.id', 't.catalog_id')
      .leftJoin('documents as d', 'd.id', 't.report_id')
      .where('t.company_id', cid).whereIn('t.sample_id', sids).whereIn('t.status', ['accepted', 'reported'])
      .andWhere((w) => w.whereNull('t.report_id').orWhereIn('d.status', ['cancelled', 'issued']))
      .select('t.id', 't.sample_id', 's.code as sample_code', 's.client_id', 'c.name as client_name', 's.material', 's.accreditation', 'k.report_name', 'k.billing_name', 't.completed_at', 't.template_code', 't.observation',
        db.raw("CASE WHEN d.status = 'issued' THEN d.number ELSE NULL END as reported_in"))
      .orderBy('s.id').then((rows) => rows.map(({ observation, ...r }) => ({ ...r, age: ageOf(observation) })));
  }
  return db('tests as t').join('samples as s', 's.id', 't.sample_id').leftJoin('clients as c', 'c.id', 's.client_id').leftJoin('catalog as k', 'k.id', 't.catalog_id')
    .leftJoin('documents as d', 'd.id', 't.report_id')
    .where('t.company_id', cid).andWhere('t.status', 'accepted').andWhere((w) => w.whereNull('t.report_id').orWhere('d.status', 'cancelled'))
    .andWhere((w) => w.whereNull('s.quick').orWhere('s.quick', false))
    .select('t.id', 't.sample_id', 's.code as sample_code', 's.client_id', 'c.name as client_name', 's.material', 's.accreditation', 'k.report_name', 'k.billing_name', 't.completed_at', 't.template_code', 't.observation')
    .orderBy('s.id').then((rows) => rows.map(({ observation, ...r }) => ({ ...r, age: ageOf(observation) })));
}));
/** Accepted tests that are already on a report draft (so Prepare report can point to the draft instead of looking empty). */
lab.get('/reports/on-drafts', h(async (req) => {
  return db('tests as t').join('samples as s', 's.id', 't.sample_id').leftJoin('clients as c', 'c.id', 's.client_id').leftJoin('catalog as k', 'k.id', 't.catalog_id')
    .join('documents as d', 'd.id', 't.report_id')
    .where('t.company_id', req.user.company_id).andWhere('t.status', 'accepted').whereIn('d.status', ['draft', 'review', 'verified'])
    .andWhere((w) => w.whereNull('s.quick').orWhere('s.quick', false))
    .select('t.id', 's.code as sample_code', 'c.name as client_name', 'k.report_name', 'k.billing_name', 'd.id as report_id', 'd.status as report_status')
    .orderBy('d.id', 'desc').limit(200);
}));
/** Age at test (days) of cube / cement strength sets, so a report can be prepared per age. */
function ageOf(obs: unknown): string | null {
  const o = parseJson<{ header?: Record<string, unknown> }>(obs as string, {});
  const a = o.header?.age;
  return a === undefined || a === null || a === '' ? null : String(a);
}

export { parseJson };
