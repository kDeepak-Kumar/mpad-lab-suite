import { Router } from 'express';
import { z } from 'zod';
import { evaluateObservation, type ObservationInput } from '@suite/shared';
import { db, insert, now, parseJson, row, today, toJson } from '../db';
import { allow, can, h, HttpError, type AuthUser } from '../auth';
import { audit, buildReportData, getCompany, getObsTemplate, nextNumber, formatWithSeq } from '../services';

export const lab = Router();

const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// ---------- work orders ----------
lab.get('/workorders', h(async (req) => {
  const cid = req.user.company_id;
  const wos = await db('work_orders as w').leftJoin('clients as c', 'c.id', 'w.client_id').leftJoin('sites as s', 's.id', 'w.site_id')
    .where('w.company_id', cid).orderBy('w.id', 'desc').select('w.*', 'c.name as client_name', 's.name as site_name');
  const counts = await db('samples').where({ company_id: cid }).select('work_order_id').count({ n: 'id' }).groupBy('work_order_id');
  const m = new Map((counts as { work_order_id: number; n: number }[]).map((c) => [c.work_order_id, Number(c.n)]));
  return wos.map((w) => ({ ...w, samples: m.get(w.id) ?? 0 }));
}));
const woSchema = z.object({ client_id: z.number(), site_id: z.number().nullable().optional(), quote_id: z.number().nullable().optional(), customer_ref: z.string().optional().nullable(), date: z.string().optional(), notes: z.string().optional().nullable() });
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
lab.post('/workorders', allow('samples'), h(async (req) => createWorkOrder(req.user, woSchema.parse(req.body))));
lab.get('/workorders/:id', h(async (req) => {
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
const sampleSchema = z.object({
  work_order_id: z.number().nullable().optional(), client_id: z.number(), site_id: z.number().nullable().optional(),
  material: z.string().min(1), description: z.string().optional().nullable(), quantity: z.string().optional().nullable(),
  condition: z.string().optional().nullable(), source: z.string().optional().nullable(), received_date: z.string(),
  customer_ref: z.string().optional().nullable(), specification: z.string().optional().nullable(), sample_label: z.string().optional().nullable(),
  tests: z.array(z.object({ catalog_id: z.number(), assigned_to: z.number().nullable().optional(), due_date: z.string().optional().nullable() })).min(1, 'Add at least one test'),
});
lab.get('/samples', h(async (req) => {
  const cid = req.user.company_id;
  const q = String(req.query.q ?? '').trim();
  const rows = await db('samples as s').leftJoin('clients as c', 'c.id', 's.client_id').leftJoin('sites as st', 'st.id', 's.site_id')
    .where('s.company_id', cid).modify((b) => { if (q) b.andWhere((w) => w.whereLike('s.code', `%${q}%`).orWhereLike('c.name', `%${q}%`).orWhereLike('s.ulr', `%${q}%`)); })
    .orderBy('s.id', 'desc').limit(500).select('s.*', 'c.name as client_name', 'st.name as site_name') as Record<string, any>[];
  const tests = rows.length ? await db('tests as t').leftJoin('catalog as k', 'k.id', 't.catalog_id').whereIn('t.sample_id', rows.map((r) => r.id)).select('t.sample_id', 't.status', 'k.report_name', 'k.billing_name') : [];
  return rows.map((r) => ({ ...r, tests: tests.filter((t) => t.sample_id === r.id) }));
}));
lab.post('/samples', allow('samples'), h(async (req) => {
  const cid = req.user.company_id;
  const s = sampleSchema.parse(req.body);
  const client = await db('clients').where({ id: s.client_id, company_id: cid }).first();
  if (!client) throw new HttpError(404, 'Client not found');
  const cats = await db('catalog').whereIn('id', s.tests.map((t) => t.catalog_id)).andWhere({ company_id: cid });
  const missing = cats.filter((c) => !c.obs_template_code);
  if (missing.length) throw new HttpError(400, `No observation sheet linked to: ${missing.map((m) => m.billing_name).join(', ')}. Link one in Rate card.`);
  return db.transaction(async (trx) => {
    const ctx = { date: s.received_date, client: client.short_code || client.name.replace(/[^A-Za-z]/g, '').slice(0, 4), material: s.material };
    const { seq, number: code } = await nextNumber(trx, cid, 'sample', ctx);
    const ulr = cats.some((c) => c.nabl) ? await formatWithSeq(cid, 'ulr', seq, ctx, trx) : null;
    const { tests, ...sample } = s;
    const id = await insert(trx, 'samples', { ...sample, seq, code, ulr, company_id: cid, status: 'registered', created_at: now() });
    for (const t of tests) {
      const cat = cats.find((c) => c.id === t.catalog_id)!;
      const tpl = await getObsTemplate(cid, cat.obs_template_code, null, trx);
      await insert(trx, 'tests', {
        company_id: cid, sample_id: id, catalog_id: cat.id, template_code: tpl.code, template_version: tpl.version, status: 'pending',
        assigned_to: t.assigned_to ?? null, due_date: t.due_date || addDays(s.received_date, Number(cat.tat_days ?? 3)), created_at: now(),
      });
    }
    await audit(trx, req.user, 'sample', id, 'registered', { code, ulr, tests: tests.length });
    return { id, code, ulr };
  });
}));
lab.get('/samples/:id', h(async (req) => {
  const cid = req.user.company_id;
  const s = await db('samples').where({ id: Number(req.params.id), company_id: cid }).first();
  if (!s) throw new HttpError(404, 'Sample not found');
  const tests = await db('tests as t').leftJoin('catalog as k', 'k.id', 't.catalog_id').leftJoin('users as u', 'u.id', 't.assigned_to')
    .where('t.sample_id', s.id).select('t.id', 't.status', 't.due_date', 't.report_id', 't.template_code', 'k.billing_name', 'k.report_name', 'k.method', 'u.name as assignee');
  const client = await db('clients').where({ id: s.client_id }).first('id', 'name');
  return { ...row(s, ['data']), client, tests };
}));
lab.put('/samples/:id', allow('samples'), h(async (req) => {
  const patch = sampleSchema.omit({ tests: true }).partial().parse(req.body);
  await db('samples').where({ id: Number(req.params.id), company_id: req.user.company_id }).update(patch);
  await audit(db, req.user, 'sample', Number(req.params.id), 'updated', patch);
  return { ok: true };
}));

// ---------- tests & observation sheets ----------
lab.get('/tests', h(async (req) => {
  const cid = req.user.company_id;
  const q = db('tests as t').join('samples as s', 's.id', 't.sample_id').leftJoin('clients as c', 'c.id', 's.client_id')
    .leftJoin('catalog as k', 'k.id', 't.catalog_id').leftJoin('users as u', 'u.id', 't.assigned_to')
    .where('t.company_id', cid)
    .select('t.id', 't.status', 't.due_date', 't.sample_id', 't.report_id', 't.started_at', 't.completed_at', 't.submitted_at', 't.reviewed_at', 't.review_note', 't.template_code',
      's.code as sample_code', 's.material', 's.received_date', 's.client_id', 'c.name as client_name', 'k.report_name', 'k.billing_name', 'k.nabl', 'u.name as assignee', 't.assigned_to');
  if (req.query.status) q.whereIn('t.status', String(req.query.status).split(','));
  if (req.query.mine) q.andWhere('t.assigned_to', req.user.id);
  if (req.query.client_id) q.andWhere('s.client_id', Number(req.query.client_id));
  return q.orderBy([{ column: 't.due_date' }, { column: 't.id' }]).limit(500);
}));
lab.get('/tests/:id', h(async (req) => {
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
  return { ...t, sample, client, site, catalog: row(catalog, []), template, equipment, users,
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
  if (!['pending', 'in_progress', 'returned'].includes(t.status as string)) throw new HttpError(409, 'This observation sheet is locked. Ask the reviewer to return it for correction.');
  const body = z.object({ observation: z.any(), started_at: z.string().nullable().optional(), completed_at: z.string().nullable().optional(), reason: z.string().optional() }).parse(req.body);
  const tpl = await getObsTemplate(cid, t.template_code as string, t.template_version as number);
  const obs = body.observation as ObservationInput;
  // refresh equipment calibration data from the register (never trust the client copy)
  for (const slot of tpl.equipment ?? []) {
    const sel = obs.equipment?.[slot.key];
    if (sel?.id) {
      const e = row(await db('equipment').where({ id: sel.id, company_id: cid }).first(), ['data']);
      if (!e) throw new HttpError(400, 'Selected equipment not found');
      const d = body.completed_at || body.started_at || today();
      if (e.due_date && (e.due_date as string) < d) throw new HttpError(400, `${e.name} calibration expired on ${e.due_date}. Choose calibrated equipment.`);
      obs.equipment![slot.key] = { id: e.id as number, name: e.name as string, data: { ...(e.data as Record<string, number>), certNo: e.cert_no as string, dueDate: e.due_date as string } };
    }
  }
  const res = evaluateObservation(tpl, obs);
  const changes = diffObservation(t.observation as ObservationInput | null, obs);
  await db('tests').where({ id }).update({
    observation: toJson(obs), results: toJson(res.results), checks: toJson(res.checks), status: t.status === 'pending' ? 'in_progress' : t.status,
    started_at: body.started_at ?? t.started_at ?? today(), completed_at: body.completed_at ?? null, entered_by: req.user.id,
  });
  if (t.status === 'returned' && changes.length) await audit(db, req.user, 'test', id, 'correction', { changes, reason: body.reason ?? '' });
  else if (changes.length || !t.observation) await audit(db, req.user, 'test', id, t.observation ? 'observation edited' : 'observation started', { changes: changes.length });
  return { results: res.results, checks: res.checks };
}));
lab.post('/tests/:id/submit', allow('observe'), h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id);
  const t = row(await db('tests').where({ id, company_id: cid }).first(), ['observation', 'checks']);
  if (!t) throw new HttpError(404, 'Test not found');
  if (!['in_progress', 'returned'].includes(t.status as string)) throw new HttpError(409, 'Save the observation sheet before submitting');
  const tpl = await getObsTemplate(cid, t.template_code as string, t.template_version as number);
  const obs = t.observation as ObservationInput;
  const missing = tpl.headerFields.filter((f) => f.required && (obs?.header?.[f.key] === null || obs?.header?.[f.key] === undefined || obs?.header?.[f.key] === ''));
  if (missing.length) throw new HttpError(400, `Fill in: ${missing.map((m) => m.label).join(', ')}`);
  const errs = ((t.checks ?? []) as { level: string; message: string }[]).filter((c) => c.level === 'error');
  if (errs.length) throw new HttpError(400, errs.map((e) => e.message).join(' '));
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
  if (t.status !== 'submitted') throw new HttpError(409, 'Only submitted observation sheets can be reviewed');
  const company = await getCompany(cid);
  if (t.entered_by === req.user.id && !(company as { defaults?: { allowSelfReview?: boolean } }).defaults?.allowSelfReview)
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
lab.post('/reports', allow('reportPrepare'), h(async (req) => {
  const cid = req.user.company_id;
  const { testIds } = z.object({ testIds: z.array(z.number()).min(1) }).parse(req.body);
  const used = await db('tests').whereIn('id', testIds).whereNotNull('report_id').first();
  if (used) {
    const rep = await db('documents').where({ id: used.report_id }).first();
    if (rep && rep.status !== 'cancelled') throw new HttpError(409, `A test is already on report draft #${rep.id}${rep.number ? ' (' + rep.number + ')' : ''}`);
  }
  const data = await buildReportData(cid, testIds);
  const s = await db('samples').where({ id: data.sampleIds[0] }).first();
  const tpl = await db('doc_templates').where({ company_id: cid, kind: 'report' }).orderBy([{ column: 'is_default', order: 'desc' }, { column: 'version', order: 'desc' }]).first();
  const client = await db('clients').where({ id: s.client_id }).first();
  const id = await insert(db, 'documents', {
    company_id: cid, kind: 'report', status: 'draft', client_id: s.client_id, site_id: s.site_id, work_order_id: s.work_order_id, date: today(),
    data: toJson({ ...data, client: { name: client.name, address: client.address, gstin: client.gstin } }), overrides: toJson({}), template_id: tpl?.id, totals: toJson(null), created_by: req.user.id, created_at: now(), updated_at: now(),
  });
  await db('tests').whereIn('id', testIds).update({ report_id: id });
  await audit(db, req.user, 'document', id, 'report drafted', { tests: testIds });
  return { id };
}));
lab.post('/reports/:id/refresh', allow('reportPrepare'), h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id);
  const d = row(await db('documents').where({ id, company_id: cid, kind: 'report' }).first(), ['data']);
  if (!d) throw new HttpError(404, 'Report not found');
  if (!['draft'].includes(d.status as string)) throw new HttpError(409, 'Only draft reports can be refreshed');
  const old = d.data as Record<string, unknown>;
  const data = await buildReportData(cid, old.testIds as number[]);
  await db('documents').where({ id }).update({ data: toJson({ ...data, client: old.client, remarks: old.remarks, notes: old.notes }), updated_at: now() });
  return { ok: true };
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
  if (!m.from.includes(d.status as string)) throw new HttpError(409, `Report is ${d.status}; cannot ${action}`);
  if (action === 'sendback' && !note) throw new HttpError(400, 'Add a note for the reviewer');
  const data = { ...(d.data as object), workflowNote: action === 'sendback' ? note : null };
  await db('documents').where({ id }).update({ status: m.to, data: toJson(data), updated_at: now() });
  await audit(db, req.user, 'document', id, `report ${m.label}`, { note });
  return { ok: true };
}));
lab.get('/reports/pending-tests', h(async (req) => {
  // accepted tests not yet on a live report, grouped by sample
  const cid = req.user.company_id;
  return db('tests as t').join('samples as s', 's.id', 't.sample_id').leftJoin('clients as c', 'c.id', 's.client_id').leftJoin('catalog as k', 'k.id', 't.catalog_id')
    .leftJoin('documents as d', 'd.id', 't.report_id')
    .where('t.company_id', cid).andWhere('t.status', 'accepted').andWhere((w) => w.whereNull('t.report_id').orWhere('d.status', 'cancelled'))
    .select('t.id', 't.sample_id', 's.code as sample_code', 's.client_id', 'c.name as client_name', 's.material', 'k.report_name', 'k.billing_name', 't.completed_at')
    .orderBy('s.id');
}));

export { parseJson };
