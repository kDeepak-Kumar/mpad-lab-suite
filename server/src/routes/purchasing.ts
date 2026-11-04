import { Router } from 'express';
import { z } from 'zod';
import { db, insert, now, parseJson, toJson, today } from '../db';
import { allow, can, h, HttpError, requireAuth, type AuthUser } from '../auth';
import { normalizeObservation, evaluateObservation, type ObservationInput } from '@suite/shared';
import { audit, getObsTemplate } from '../services';

/**
 * Vendors (external labs, suppliers, calibration agencies), outsourced tests (sample sent to another lab,
 * evidence, their report) and purchase bills with payments – which feed GST purchases / ITC.
 */
export const purchasing = Router();
purchasing.use(['/vendors', '/outsourcing', '/purchases'], requireAuth);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date');
const optDate = isoDate.nullable().optional().or(z.literal('').transform(() => null));
const r2 = (n: number) => Math.round(n * 100) / 100;
const canSee = (u: AuthUser, ...perms: string[]) => perms.some((p) => can(u, p));

// ---------- vendors ----------
const vendorSchema = z.object({
  name: z.string().trim().min(2).max(200), kind: z.enum(['lab', 'supplier', 'calibration', 'other']).default('lab'),
  gstin: z.string().trim().toUpperCase().max(20).optional().nullable(), state_code: z.string().max(4).optional().nullable(), pan: z.string().max(20).optional().nullable(),
  nabl_cert: z.string().max(60).optional().nullable(), nabl_valid_till: optDate, services: z.string().max(2000).optional().nullable(),
  contact: z.string().max(120).optional().nullable(), phone: z.string().max(40).optional().nullable(), email: z.string().max(190).optional().nullable(),
  address: z.string().max(1000).optional().nullable(), bank: z.record(z.string()).optional().nullable(), active: z.boolean().optional(),
});
purchasing.get('/vendors', h(async (req) => {
  if (!canSee(req.user, 'managePurchases', 'manageOutsourcing', 'catalog.read')) throw new HttpError(403, 'Your role cannot see vendors');
  const rows = await db('vendors').where({ company_id: req.user.company_id }).orderBy('name');
  const spend = await db('purchases').where({ company_id: req.user.company_id }).select('vendor_id').sum({ total: 'total' }).groupBy('vendor_id');
  const m = new Map((spend as any[]).map((s) => [s.vendor_id, Number(s.total)]));
  return rows.map((v) => ({ ...v, bank: parseJson(v.bank, {}), spend: m.get(v.id) ?? 0 }));
}));
purchasing.post('/vendors', h(async (req) => {
  if (!canSee(req.user, 'managePurchases', 'manageOutsourcing')) throw new HttpError(403, 'Your role cannot add vendors');
  const b = vendorSchema.parse(req.body);
  const id = await insert(db, 'vendors', { ...b, bank: toJson(b.bank ?? {}), company_id: req.user.company_id, active: b.active ?? true, created_at: now() });
  await audit(db, req.user, 'vendor', id, 'created', { name: b.name });
  return { id };
}));
purchasing.put('/vendors/:id', h(async (req) => {
  if (!canSee(req.user, 'managePurchases', 'manageOutsourcing')) throw new HttpError(403, 'Your role cannot edit vendors');
  const b = vendorSchema.partial().parse(req.body);
  const n = await db('vendors').where({ id: Number(req.params.id), company_id: req.user.company_id }).update({ ...b, ...(b.bank ? { bank: toJson(b.bank) } : {}) });
  if (!n) throw new HttpError(404, 'Vendor not found');
  return { ok: true };
}));

// ---------- outsourced tests ----------
const JOB_STATUS = ['to_send', 'sent', 'received', 'entered', 'cancelled'] as const;
async function jobRows(cid: number, where: (q: any) => void) {
  const q = db('outsource_jobs as j').leftJoin('vendors as v', 'v.id', 'j.vendor_id').leftJoin('samples as s', 's.id', 'j.sample_id').leftJoin('clients as c', 'c.id', 's.client_id')
    .where('j.company_id', cid).select('j.*', 'v.name as vendor_name', 'v.nabl_cert as vendor_nabl', 's.code as sample_code', 's.material', 's.received_date', 'c.name as client_name');
  where(q);
  const rows = (await q.orderBy('j.id', 'desc').limit(1000)).map((r: any) => ({ ...r, test_ids: parseJson<number[]>(r.test_ids, []) }));
  const ids = [...new Set(rows.flatMap((r: any) => r.test_ids))];
  const tests = ids.length ? await db('tests as t').leftJoin('catalog as k', 'k.id', 't.catalog_id').whereIn('t.id', ids).select('t.id', 't.status', 't.template_code', 't.report_id', 'k.report_name', 'k.billing_name') : [];
  const files = rows.length ? await db('files').where({ company_id: cid, entity: 'outsource' }).whereIn('entity_id', rows.map((r: any) => r.id)).select('id', 'entity_id', 'name', 'kind', 'size', 'archived_at', 'created_at') : [];
  const bills = rows.length ? await db('purchases').where({ company_id: cid }).whereIn('job_id', rows.map((r: any) => r.id)).select('id', 'job_id', 'bill_no', 'total', 'status') : [];
  return rows.map((r: any) => ({ ...r, tests: tests.filter((t) => r.test_ids.includes(t.id)), files: files.filter((f) => f.entity_id === r.id), bills: bills.filter((b) => b.job_id === r.id) }));
}
purchasing.get('/outsourcing', h(async (req) => {
  if (!canSee(req.user, 'manageOutsourcing', 'sample.read', 'managePurchases')) throw new HttpError(403, 'Your role cannot see outsourced tests');
  return jobRows(req.user.company_id, (q) => {
    if (req.query.status) q.whereIn('j.status', String(req.query.status).split(','));
    if (req.query.sample_id) q.andWhere('j.sample_id', Number(req.query.sample_id));
  });
}));
purchasing.get('/outsourcing/:id', h(async (req) => {
  const [j] = await jobRows(req.user.company_id, (q) => q.andWhere('j.id', Number(req.params.id)));
  if (!j) throw new HttpError(404, 'Outsourced job not found');
  return j;
}));
purchasing.post('/outsourcing', allow('manageOutsourcing'), h(async (req) => {
  const cid = req.user.company_id;
  const b = z.object({ sample_id: z.number(), test_ids: z.array(z.number()).min(1, 'Choose at least one test'), vendor_id: z.number().nullable().optional(), expected_date: optDate, notes: z.string().max(2000).optional().nullable() }).parse(req.body);
  const s = await db('samples').where({ id: b.sample_id, company_id: cid }).first('id');
  if (!s) throw new HttpError(404, 'Sample not found');
  const own = await db('tests').where({ sample_id: b.sample_id, company_id: cid }).whereIn('id', b.test_ids).pluck('id');
  if (own.length !== b.test_ids.length) throw new HttpError(400, 'Some tests do not belong to this sample');
  const id = await insert(db, 'outsource_jobs', { ...b, test_ids: toJson(b.test_ids), company_id: cid, status: 'to_send', created_by: req.user.id, created_at: now(), updated_at: now() });
  await audit(db, req.user, 'sample', b.sample_id, 'tests outsourced', { job: id, tests: b.test_ids.length });
  return { id };
}));
purchasing.put('/outsourcing/:id', allow('manageOutsourcing'), h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id);
  const ex = await db('outsource_jobs').where({ id, company_id: cid }).first();
  if (!ex) throw new HttpError(404, 'Outsourced job not found');
  const b = z.object({
    status: z.enum(JOB_STATUS).optional(), vendor_id: z.number().nullable().optional(), sent_date: optDate, expected_date: optDate, received_date: optDate,
    vendor_report_no: z.string().max(80).nullable().optional(), vendor_report_date: optDate, notes: z.string().max(2000).nullable().optional(),
  }).parse(req.body);
  if (b.status === 'sent' && !(b.vendor_id ?? ex.vendor_id)) throw new HttpError(400, 'Choose the laboratory the sample was sent to');
  if (b.status === 'sent' && !(b.sent_date ?? ex.sent_date)) b.sent_date = new Date().toISOString().slice(0, 10);
  if (b.status === 'received' && !(b.received_date ?? ex.received_date)) b.received_date = new Date().toISOString().slice(0, 10);
  await db('outsource_jobs').where({ id }).update({ ...b, updated_at: now() });
  if (b.status && b.status !== ex.status) await audit(db, req.user, 'sample', ex.sample_id, `outsourced job ${b.status.replace('_', ' ')}`, { job: id });
  return { ok: true };
}));

// ---------- purchases (vendor bills) ----------
const CATEGORIES = ['subcontract', 'equipment', 'consumables', 'calibration', 'other'] as const;
const billSchema = z.object({
  vendor_id: z.number({ invalid_type_error: 'Choose the vendor' }), category: z.enum(CATEGORIES), bill_no: z.string().trim().min(1, 'Enter the bill number').max(80), bill_date: isoDate,
  sac: z.string().max(12).optional().nullable(), rate: z.number().min(0).max(28).default(18), taxable: z.number().min(0),
  interstate: z.boolean().optional(), cgst: z.number().min(0).optional(), sgst: z.number().min(0).optional(), igst: z.number().min(0).optional(),
  tds: z.number().min(0).default(0), itc_eligible: z.boolean().default(true), job_id: z.number().nullable().optional(), equipment_id: z.number().nullable().optional(), notes: z.string().max(2000).optional().nullable(),
});
function taxes(b: z.infer<typeof billSchema>) {
  const tax = r2(b.taxable * b.rate / 100);
  const cgst = b.cgst ?? (b.interstate ? 0 : r2(tax / 2)), sgst = b.sgst ?? (b.interstate ? 0 : r2(tax - r2(tax / 2))), igst = b.igst ?? (b.interstate ? tax : 0);
  return { cgst, sgst, igst, total: r2(b.taxable + cgst + sgst + igst) };
}
async function refreshStatus(id: number) {
  const p = await db('purchases').where({ id }).first('total', 'tds');
  const paid = Number((await db('purchase_payments').where({ purchase_id: id }).sum({ s: 'amount' }).first())?.s ?? 0);
  const due = r2(Number(p.total) - Number(p.tds ?? 0) - paid);
  await db('purchases').where({ id }).update({ status: due <= 0.5 ? 'paid' : paid > 0 ? 'partly_paid' : 'unpaid' });
}
purchasing.get('/purchases', allow('managePurchases'), h(async (req) => {
  const cid = req.user.company_id;
  const q = db('purchases as p').leftJoin('vendors as v', 'v.id', 'p.vendor_id').leftJoin('equipment as e', 'e.id', 'p.equipment_id').where('p.company_id', cid)
    .select('p.*', 'v.name as vendor_name', 'v.gstin as vendor_gstin', 'e.name as equipment_name');
  if (req.query.vendor_id) q.andWhere('p.vendor_id', Number(req.query.vendor_id));
  if (req.query.job_id) q.andWhere('p.job_id', Number(req.query.job_id));
  const rows = await q.orderBy('p.bill_date', 'desc').limit(3000);
  const pays = await db('purchase_payments').where({ company_id: cid }).select('purchase_id').sum({ s: 'amount' }).groupBy('purchase_id');
  const m = new Map((pays as any[]).map((x) => [x.purchase_id, Number(x.s)]));
  const files = await db('files').where({ company_id: cid, entity: 'purchase' }).select('entity_id').count({ n: 'id' }).groupBy('entity_id');
  const fm = new Map((files as any[]).map((x) => [x.entity_id, Number(x.n)]));
  return rows.map((r) => { const paid = m.get(r.id) ?? 0; return { ...r, total: Number(r.total), taxable: Number(r.taxable), tds: Number(r.tds), paid, balance: r2(Number(r.total) - Number(r.tds) - paid), files: fm.get(r.id) ?? 0 }; });
}));
purchasing.get('/purchases/:id', allow('managePurchases'), h(async (req) => {
  const p = await db('purchases').where({ id: Number(req.params.id), company_id: req.user.company_id }).first();
  if (!p) throw new HttpError(404, 'Bill not found');
  const payments = await db('purchase_payments').where({ purchase_id: p.id }).orderBy('date');
  return { ...p, payments };
}));
purchasing.post('/purchases', allow('managePurchases'), h(async (req) => {
  const cid = req.user.company_id;
  const b = billSchema.parse(req.body);
  if (!(await db('vendors').where({ id: b.vendor_id, company_id: cid }).first('id'))) throw new HttpError(400, 'Vendor not found');
  const dup = await db('purchases').where({ company_id: cid, vendor_id: b.vendor_id, bill_no: b.bill_no }).first('id');
  if (dup) throw new HttpError(409, `Bill ${b.bill_no} from this vendor is already recorded`);
  const { interstate: _i, ...rest } = b;
  const id = await insert(db, 'purchases', { ...rest, ...taxes(b), company_id: cid, status: 'unpaid', created_by: req.user.id, created_at: now() });
  await audit(db, req.user, 'purchase', id, 'bill recorded', { bill: b.bill_no, category: b.category });
  return { id };
}));
purchasing.put('/purchases/:id', allow('managePurchases'), h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id);
  if (!(await db('purchases').where({ id, company_id: cid }).first('id'))) throw new HttpError(404, 'Bill not found');
  const b = billSchema.parse(req.body);
  const { interstate: _i, ...rest } = b;
  await db('purchases').where({ id }).update({ ...rest, ...taxes(b) });
  await refreshStatus(id);
  return { ok: true };
}));
purchasing.delete('/purchases/:id', allow('managePurchases'), h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id);
  if (await db('purchase_payments').where({ purchase_id: id, company_id: cid }).first('id')) throw new HttpError(409, 'Delete the payments of this bill first');
  await db('files').where({ company_id: cid, entity: 'purchase', entity_id: id }).delete();
  await db('purchases').where({ id, company_id: cid }).delete();
  await audit(db, req.user, 'purchase', id, 'bill deleted');
  return { ok: true };
}));
purchasing.post('/purchases/:id/payments', allow('managePurchases'), h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id);
  const p = await db('purchases').where({ id, company_id: cid }).first();
  if (!p) throw new HttpError(404, 'Bill not found');
  const b = z.object({ date: isoDate, amount: z.number().positive(), mode: z.string().max(30).default('Bank transfer'), ref: z.string().max(120).optional().nullable() }).parse(req.body);
  await insert(db, 'purchase_payments', { ...b, company_id: cid, purchase_id: id, created_by: req.user.id, created_at: now() });
  await refreshStatus(id);
  await audit(db, req.user, 'purchase', id, 'payment made', b);
  return { ok: true };
}));
purchasing.delete('/purchases/:id/payments/:pid', allow('managePurchases'), h(async (req) => {
  await db('purchase_payments').where({ id: Number(req.params.pid), purchase_id: Number(req.params.id), company_id: req.user.company_id }).delete();
  await refreshStatus(Number(req.params.id));
  return { ok: true };
}));

/**
 * Results from the vendor's report → the test's observation sheet. Optionally switch the test to another template
 * (if the wrong sheet was picked) and submit it for review straight away. The external lab is recorded on the sheet
 * so the report identifies these results as sub-contracted.
 */
purchasing.post('/outsourcing/:id/import', allow('manageOutsourcing'), h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id);
  const job = await db('outsource_jobs as j').leftJoin('vendors as v', 'v.id', 'j.vendor_id').where({ 'j.id': id, 'j.company_id': cid }).first('j.*', 'v.name as vendor_name', 'v.nabl_cert');
  if (!job) throw new HttpError(404, 'Outsourced job not found');
  const b = z.object({
    test_id: z.number(), template_code: z.string().max(60).optional(), values: z.record(z.union([z.string(), z.number(), z.null()])),
    report_no: z.string().max(80).optional().nullable(), report_date: optDate, submit: z.boolean().default(false),
  }).parse(req.body);
  if (!parseJson<number[]>(job.test_ids, []).includes(b.test_id)) throw new HttpError(400, 'This test is not part of the outsourced job');
  const t = await db('tests').where({ id: b.test_id, company_id: cid }).first();
  if (!['pending', 'in_progress', 'returned'].includes(t.status)) throw new HttpError(409, 'This test is already submitted or reviewed. Ask the reviewer to return it to change values.');
  let code = t.template_code, version = t.template_version;
  if (b.template_code && b.template_code !== t.template_code) {
    const nt = await getObsTemplate(cid, b.template_code);
    code = nt.code; version = nt.version;
    await audit(db, req.user, 'test', t.id, 'observation template changed', { from: t.template_code, to: code });
  }
  const tpl = await getObsTemplate(cid, code, version);
  const header: Record<string, unknown> = { ...(parseJson<any>(t.observation, {})?.header ?? {}) };
  for (const [k, v] of Object.entries(b.values)) {
    const f = tpl.headerFields.find((x) => x.key === k);
    if (!f) continue;
    header[k] = v === null || v === '' ? null : f.type === 'number' ? Number(String(v).replace(/[^\d.\-eE]/g, '')) : String(v);
  }
  const norm = normalizeObservation(tpl, { header, grids: {} } as ObservationInput);
  if (norm.issues.length) throw new HttpError(400, `Please correct: ${norm.issues.slice(0, 3).join('; ')}`);
  const obs = { ...norm.input, external: { vendor: job.vendor_name ?? '', nabl: job.nabl_cert ?? '', reportNo: b.report_no ?? job.vendor_report_no ?? '', reportDate: b.report_date ?? job.vendor_report_date ?? '', jobId: id } };
  const res = evaluateObservation(tpl, obs);
  await db('tests').where({ id: t.id }).update({
    template_code: code, template_version: version, observation: toJson(obs), results: toJson(res.results), checks: toJson(res.checks),
    status: b.submit ? 'submitted' : 'in_progress', entered_by: req.user.id, started_at: t.started_at ?? today(), completed_at: today(), ...(b.submit ? { submitted_at: now() } : {}),
  });
  await audit(db, req.user, 'test', t.id, 'results imported from external laboratory report', { vendor: job.vendor_name, report: b.report_no ?? job.vendor_report_no, values: Object.keys(b.values).length });
  await db('outsource_jobs').where({ id }).update({ vendor_report_no: b.report_no ?? job.vendor_report_no, vendor_report_date: b.report_date ?? job.vendor_report_date, received_date: job.received_date ?? today(), updated_at: now() });
  const left = await db('tests').whereIn('id', parseJson<number[]>(job.test_ids, [])).whereIn('status', ['pending']).count({ n: 'id' }).first();
  if (!Number(left?.n ?? 0)) await db('outsource_jobs').where({ id }).update({ status: 'entered' });
  if (b.submit) await db('samples').where({ id: t.sample_id }).update({ status: 'in_test' });
  return { results: res.results, checks: res.checks };
}));
