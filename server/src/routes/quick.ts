import { Router } from 'express';
import { z } from 'zod';
import { isIsoDate } from '@suite/shared';
import { db, insert, now, parseJson, row, today, toJson } from '../db';
import { can, h, HttpError, requireAuth } from '../auth';
import { audit, buildReportData, getObsTemplate, nextNumber } from '../services';

/**
 * Quick test reports: tests, observations and a signed report without registering a sample or a client first.
 * Technically a "quick" sample under a hidden system client, so the normal observation sheets, report layout,
 * signatures, seal, preview, download and QR verification are all reused. "Register later" moves it to a real
 * client with a proper job code; nothing is re-entered.
 */
export const quick = Router();
quick.use('/quick-reports', requireAuth);

const isoDate = z.string().refine(isIsoDate, 'Enter a valid date');
const need = (ok: boolean, msg = 'Your role cannot prepare test reports') => { if (!ok) throw new HttpError(403, msg); };

export async function systemClient(cid: number): Promise<number> {
  const c = await db('clients').where({ company_id: cid, type: 'system' }).first('id');
  if (c) return c.id;
  return insert(db, 'clients', { company_id: cid, name: 'Quick reports (customer not registered)', type: 'system', data: toJson({ system: true }), created_at: now() });
}

const customerSchema = z.object({
  name: z.string().trim().min(1, 'Enter the customer name').max(200), address: z.string().max(1000).optional().nullable(), contact: z.string().max(120).optional().nullable(),
  phone: z.string().max(40).optional().nullable(), email: z.string().max(190).optional().nullable(), gstin: z.string().max(20).optional().nullable(), project: z.string().max(300).optional().nullable(),
});

quick.get('/quick-reports', h(async (req) => {
  need(can(req.user, 'sample.read'), 'Your role cannot see samples');
  const cid = req.user.company_id;
  const rows = await db('samples as s').leftJoin('clients as c', 'c.id', 's.client_id').where('s.company_id', cid).andWhere((w) => w.where('s.quick', true).orWhere('s.data', 'like', '%"quickCode"%')).orderBy('s.id', 'desc').limit(500)
    .select('s.id', 's.code', 's.material', 's.description', 's.received_date', 's.status', 's.data', 's.created_at', 's.updated_at', 'c.type as client_type', 'c.name as client_name');
  const tests = rows.length ? await db('tests as t').leftJoin('catalog as k', 'k.id', 't.catalog_id').leftJoin('documents as d', 'd.id', 't.report_id').whereIn('t.sample_id', rows.map((r) => r.id))
    .select('t.id', 't.sample_id', 't.status', 't.report_id', 'k.report_name', 'k.billing_name', 'd.status as report_status', 'd.number as report_number') : [];
  return rows.map((r) => {
    const t = tests.filter((x) => x.sample_id === r.id);
    const rep = t.find((x) => x.report_id && x.report_status !== 'cancelled');
    return { ...r, data: undefined, customer: parseJson<Record<string, string>>(r.data, {}).quickCustomer ?? {}, tests: t, report: rep ? { id: rep.report_id, status: rep.report_status, number: rep.report_number } : null };
  });
}));

quick.get('/quick-reports/:id', h(async (req) => {
  need(can(req.user, 'sample.read'), 'Your role cannot see samples');
  const s = row(await db('samples').where({ id: Number(req.params.id), company_id: req.user.company_id }).first(), ['data']);
  if (!s) throw new HttpError(404, 'Quick report not found');
  const tests = await db('tests as t').leftJoin('catalog as k', 'k.id', 't.catalog_id').leftJoin('users as u', 'u.id', 't.assigned_to').leftJoin('documents as d', 'd.id', 't.report_id').where('t.sample_id', s.id)
    .select('t.id', 't.status', 't.report_id', 't.template_code', 'k.report_name', 'k.billing_name', 'k.method', 'u.name as assignee', 'd.status as report_status', 'd.number as report_number');
  const client = await db('clients').where({ id: s.client_id }).first('id', 'name', 'type');
  const rep = tests.find((x) => x.report_id && x.report_status !== 'cancelled');
  return { ...s, customer: (s.data as any)?.quickCustomer ?? {}, client, registered: client?.type !== 'system', tests, report: rep ? { id: rep.report_id, status: rep.report_status, number: rep.report_number } : null };
}));

/** Start a quick report: customer details as typed, sample details, tests from the rate card. */
quick.post('/quick-reports', h(async (req) => {
  need(can(req.user, 'enterObservations') || can(req.user, 'prepareReports'));
  const cid = req.user.company_id;
  const b = z.object({
    customer: customerSchema, material: z.string().trim().min(1, 'Choose the material').max(60), description: z.string().max(300).optional().nullable(), quantity: z.string().max(80).optional().nullable(),
    received_date: isoDate, source: z.string().max(200).optional().nullable(), customer_ref: z.string().max(200).optional().nullable(), specification: z.string().max(200).optional().nullable(),
    sample_label: z.string().max(80).optional().nullable(), tests: z.array(z.number().int()).min(1, 'Choose at least one test').max(40),
  }).parse(req.body);
  const cats = await db('catalog').whereIn('id', b.tests).andWhere({ company_id: cid });
  if (cats.length !== new Set(b.tests).size) throw new HttpError(400, 'A chosen test is not in the rate card');
  const missing = cats.filter((c) => !c.obs_template_code);
  if (missing.length) throw new HttpError(400, `No observation sheet linked to: ${missing.map((m) => m.billing_name).join(', ')}. Link one in Rate card.`);
  const client = await systemClient(cid);
  const tpls = await Promise.all(cats.map((c) => getObsTemplate(cid, c.obs_template_code))); // read before the transaction (SQLite)
  return db.transaction(async (trx) => {
    const { seq, number: code } = await nextNumber(trx, cid, 'quick', { date: b.received_date, material: b.material });
    const id = await insert(trx, 'samples', {
      company_id: cid, client_id: client, quick: true, seq, code, material: b.material, description: b.description ?? null, quantity: b.quantity ?? null, condition: null, source: b.source ?? null,
      received_date: b.received_date, customer_ref: b.customer_ref ?? null, specification: b.specification ?? null, sample_label: b.sample_label ?? null, accreditation: 'Non-NABL',
      data: toJson({ quickCustomer: b.customer }), status: 'registered', created_at: now(),
    });
    for (const [i, c] of cats.entries()) {
      await insert(trx, 'tests', { company_id: cid, sample_id: id, catalog_id: c.id, template_code: tpls[i].code, template_version: tpls[i].version, status: 'pending', assigned_to: req.user.id, due_date: b.received_date, created_at: now() });
    }
    await audit(trx, req.user, 'sample', id, 'quick report started', { code, customer: b.customer.name, tests: cats.length });
    return { id, code };
  });
}));

quick.put('/quick-reports/:id/customer', h(async (req) => {
  need(can(req.user, 'enterObservations') || can(req.user, 'prepareReports'));
  const s = row(await db('samples').where({ id: Number(req.params.id), company_id: req.user.company_id, quick: true }).first(), ['data']);
  if (!s) throw new HttpError(404, 'Quick report not found');
  const c = customerSchema.parse(req.body);
  await db('samples').where({ id: s.id }).update({ data: toJson({ ...(s.data as object ?? {}), quickCustomer: c }) });
  await audit(db, req.user, 'sample', s.id as number, 'quick report customer changed', { name: c.name });
  return { ok: true };
}));

/** Make the report from the entered observations. Submitted sheets are accepted by the person preparing the report (recorded). */
quick.post('/quick-reports/:id/report', h(async (req) => {
  need(can(req.user, 'prepareReports'));
  const cid = req.user.company_id;
  const s = row(await db('samples').where({ id: Number(req.params.id), company_id: cid, quick: true }).first(), ['data']);
  if (!s) throw new HttpError(404, 'Quick report not found');
  const tests = await db('tests').where({ sample_id: s.id });
  const live = await db('documents').whereIn('id', tests.map((t) => t.report_id).filter(Boolean)).whereNot('status', 'cancelled').first('id');
  if (live) return { id: live.id, existing: true };
  const notReady = tests.filter((t) => !['submitted', 'accepted', 'reported'].includes(t.status));
  if (notReady.length) throw new HttpError(400, `Enter and submit the observations first (${notReady.length} test${notReady.length === 1 ? '' : 's'} not submitted).`);
  for (const t of tests.filter((x) => x.status === 'submitted')) {
    await db('tests').where({ id: t.id }).update({ status: 'accepted', reviewed_by: req.user.id, reviewed_at: now(), review_note: 'Accepted while preparing a quick report' });
    await audit(db, req.user, 'test', t.id, 'accepted for quick report');
  }
  const data = await buildReportData(cid, tests.map((t) => t.id));
  const cu = ((s.data as any)?.quickCustomer ?? {}) as Record<string, string>;
  const tpl = await db('doc_templates').where({ company_id: cid, kind: 'report' }).orderBy([{ column: 'is_default', order: 'desc' }, { column: 'version', order: 'desc' }]).first();
  const id = await insert(db, 'documents', {
    company_id: cid, kind: 'report', status: 'draft', client_id: s.client_id, date: today(), accreditation: 'Non-NABL',
    data: toJson({ ...data, accreditation: 'Non-NABL', quick: true, client: { name: cu.name, address: [cu.address, cu.project ? `Project: ${cu.project}` : ''].filter(Boolean).join('\n'), gstin: cu.gstin ?? null } }),
    overrides: toJson({}), template_id: tpl?.id, totals: toJson(null), created_by: req.user.id, created_at: now(), updated_at: now(),
  });
  await db('tests').whereIn('id', tests.map((t) => t.id)).update({ report_id: id });
  await audit(db, req.user, 'document', id, 'quick report drafted', { sample: s.code });
  return { id };
}));

/** Register later: attach the quick report to a real client (existing or just created), with a proper job code. */
quick.post('/quick-reports/:id/register', h(async (req) => {
  need(can(req.user, 'sample.create'), 'Your role cannot register samples');
  const cid = req.user.company_id;
  const b = z.object({ client_id: z.number().int(), site_id: z.number().int().optional().nullable(), work_order_id: z.number().int().optional().nullable() }).parse(req.body);
  const s = row(await db('samples').where({ id: Number(req.params.id), company_id: cid, quick: true }).first(), ['data']);
  if (!s) throw new HttpError(404, 'Quick report not found or already registered');
  const client = await db('clients').where({ id: b.client_id, company_id: cid }).first();
  if (!client || client.type === 'system') throw new HttpError(404, 'Client not found');
  if (b.site_id && !(await db('sites').where({ id: b.site_id, client_id: client.id }).first('id'))) throw new HttpError(400, 'That site belongs to another client');
  if (b.work_order_id && !(await db('work_orders').where({ id: b.work_order_id, client_id: client.id }).first('id'))) throw new HttpError(400, 'That work order belongs to another client');
  const reports = await db('documents').whereIn('id', (await db('tests').where({ sample_id: s.id }).whereNotNull('report_id').select('report_id')).map((t) => t.report_id)).select('id', 'status', 'data');
  const res = await db.transaction(async (trx) => {
    const ctx = { date: s.received_date as string, client: client.short_code || client.name.replace(/[^A-Za-z]/g, '').slice(0, 4), material: s.material as string };
    const { seq, number: code } = await nextNumber(trx, cid, 'sample', ctx);
    await trx('samples').where({ id: s.id }).update({ client_id: client.id, site_id: b.site_id ?? null, work_order_id: b.work_order_id ?? null, quick: false, seq, code,
      data: toJson({ ...(s.data as object ?? {}), quickCode: s.code, registeredFromQuick: now() }) });
    for (const r of reports) {
      const d = parseJson<Record<string, any>>(r.data, {});
      // drafts take the client's registered details; issued reports keep what was printed and signed
      const patch: Record<string, unknown> = { client_id: client.id, site_id: b.site_id ?? null, work_order_id: b.work_order_id ?? null };
      if (['draft', 'review'].includes(r.status)) patch.data = toJson({ ...d, quick: false, client: { name: client.name, address: client.address, gstin: client.gstin } });
      await trx('documents').where({ id: r.id }).update(patch);
    }
    return { code };
  });
  await audit(db, req.user, 'sample', s.id as number, 'registered from quick report', { from: s.code, to: res.code, client: client.name });
  return { ok: true, id: s.id, code: res.code };
}));
