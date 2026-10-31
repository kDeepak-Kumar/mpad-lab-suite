import { Router } from 'express';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { computeTotals, formatDate, stateName, type LineInput } from '@suite/shared';
import { db, insert, now, parseJson, row, today, toJson } from '../db';
import { allow, can, h, HttpError } from '../auth';
import { audit, clientSnapshot, getCompany, getDocTemplate, ledger, nextNumber, paidAgainst, refreshInvoiceStatus, sha256 } from '../services';
import { createWorkOrder } from './lab';

export const finance = Router();

const JSON_COLS = ['data', 'overrides', 'totals'];
const permFor = (kind: string) => (kind === 'quote' ? 'quotes' : kind === 'invoice' ? 'invoices' : 'reportPrepare') as 'quotes' | 'invoices' | 'reportPrepare';

async function loadDoc(cid: number, id: number) {
  const d = row(await db('documents').where({ id, company_id: cid }).first(), JSON_COLS);
  if (!d) throw new HttpError(404, 'Document not found');
  return d as Record<string, unknown> & { id: number; kind: string; status: string; data: Record<string, unknown>; client_id: number };
}

async function totalsFor(cid: number, data: Record<string, unknown>) {
  const company = await getCompany(cid);
  const lines = (data.lines ?? []) as LineInput[];
  const mode = data.mode ?? 'estimate';
  const t = computeTotals(lines.map((l) => ({ ...l, qty: mode === 'rate' ? 0 : l.qty })), {
    supplierState: company.stateCode ?? '', placeOfSupply: String(data.placeOfSupply ?? company.stateCode ?? ''),
    defaultGst: company.defaults?.gstRate ?? 18, overallDiscount: Number(data.overallDiscount ?? 0),
  });
  return t;
}

// ---------- list / get ----------
finance.get('/documents', h(async (req) => {
  const cid = req.user.company_id;
  const q = db('documents as d').leftJoin('clients as c', 'c.id', 'd.client_id').leftJoin('sites as s', 's.id', 'd.site_id')
    .where('d.company_id', cid).select('d.id', 'd.kind', 'd.number', 'd.status', 'd.date', 'd.total', 'd.client_id', 'd.site_id', 'd.work_order_id', 'd.revision', 'd.issued_at', 'c.name as client_name', 's.name as site_name');
  if (req.query.kind) q.andWhere('d.kind', String(req.query.kind));
  if (req.query.status) q.whereIn('d.status', String(req.query.status).split(','));
  if (req.query.client_id) q.andWhere('d.client_id', Number(req.query.client_id));
  if (req.query.q) q.andWhere((w) => w.whereLike('d.number', `%${req.query.q}%`).orWhereLike('c.name', `%${req.query.q}%`));
  const rows = await q.orderBy('d.id', 'desc').limit(500);
  const paid = await paidAgainst(cid);
  return rows.map((r) => ({ ...r, total: Number(r.total), paid: r.kind === 'invoice' ? paid.get(r.id) ?? 0 : undefined }));
}));
finance.get('/documents/:id', h(async (req) => {
  const cid = req.user.company_id;
  const d = await loadDoc(cid, Number(req.params.id));
  const [company, tpl] = await Promise.all([getCompany(cid), getDocTemplate(cid, d.kind, d.template_id as number)]);
  const issuer = d.issued_by ? await db('users').where({ id: d.issued_by }).first('id', 'name', 'designation', 'qualifications', 'signature') : null;
  const paid = d.kind === 'invoice' ? (await paidAgainst(cid)).get(d.id) ?? 0 : undefined;
  const history = await db('audit_log').where({ company_id: cid, entity: 'document', entity_id: d.id }).orderBy('id', 'desc');
  const users = new Map((await db('users').where({ company_id: cid }).select('id', 'name')).map((u) => [u.id, u.name]));
  const revisions = await db('documents').where({ company_id: cid }).andWhere((w) => w.where('parent_id', d.id).orWhere('id', d.parent_id ?? -1)).select('id', 'number', 'status', 'revision');
  return { ...d, company, template: tpl, issuer, paid, revisions, history: history.map((x) => ({ ...row(x, ['detail']), user: users.get(x.user_id) })) };
}));

// ---------- create / update ----------
const docSchema = z.object({
  kind: z.enum(['quote', 'invoice']), client_id: z.number(), site_id: z.number().nullable().optional(), contact_id: z.number().nullable().optional(),
  work_order_id: z.number().nullable().optional(), date: z.string().optional(), data: z.record(z.any()).default({}), template_id: z.number().nullable().optional(),
});
export async function createDocument(user: { company_id: number; id: number }, body: z.infer<typeof docSchema>) {
  const cid = user.company_id;
  const company = await getCompany(cid);
  const snap = await clientSnapshot(cid, body.client_id, body.site_id, body.contact_id);
  const date = body.date || today();
  const placeOfSupply = body.data.placeOfSupply || snap.client.stateCode || company.stateCode;
  const defaults = company.defaults ?? {};
  const data: Record<string, unknown> = {
    mode: body.kind === 'quote' ? 'rate' : 'estimate', lines: [], customerRef: '', notes: '', overallDiscount: 0,
    copyLabel: body.kind === 'invoice' ? 'ORIGINAL COPY' : undefined, sac: defaults.sac ?? '998346', validityDays: defaults.validityDays ?? 30,
    ...body.data, ...snap, placeOfSupply, placeOfSupplyName: stateName(placeOfSupply),
  };
  if (body.kind === 'quote' && !body.data.notes) data.notes = defaults.quoteNotes ?? '';
  const tpl = await getDocTemplate(cid, body.kind, body.template_id);
  const totals = await totalsFor(cid, data);
  return db.transaction(async (trx) => {
    const number = body.kind === 'quote' ? (await nextNumber(trx, cid, 'quote', { date, client: snap.client.shortCode })).number : null;
    const id = await insert(trx, 'documents', {
      company_id: cid, kind: body.kind, number, status: 'draft', client_id: body.client_id, site_id: body.site_id ?? null, work_order_id: body.work_order_id ?? null,
      date, data: toJson(data), overrides: toJson({}), template_id: tpl?.id ?? null, totals: toJson(totals), total: totals.total, created_by: user.id, created_at: now(), updated_at: now(),
    });
    await audit(trx, user as never, 'document', id, `${body.kind} created`, { number });
    return { id, number };
  });
}
finance.post('/documents', h(async (req) => {
  const body = docSchema.parse(req.body);
  if (!can(req.user, permFor(body.kind))) throw new HttpError(403, 'Your role does not allow this action');
  return createDocument(req.user, body);
}));
finance.put('/documents/:id', h(async (req) => {
  const cid = req.user.company_id;
  const d = await loadDoc(cid, Number(req.params.id));
  if (!can(req.user, permFor(d.kind))) throw new HttpError(403, 'Your role does not allow this action');
  const body = z.object({
    data: z.record(z.any()).optional(), overrides: z.record(z.any()).optional(), template_id: z.number().nullable().optional(),
    client_id: z.number().optional(), site_id: z.number().nullable().optional(), contact_id: z.number().nullable().optional(), date: z.string().optional(),
  }).parse(req.body);
  const locked = ['issued', 'paid', 'partly_paid', 'cancelled'].includes(d.status) || (d.kind === 'quote' && d.status !== 'draft') || (d.kind === 'report' && d.status === 'verified');
  if (locked && (body.data || body.client_id || body.date)) throw new HttpError(409, d.kind === 'quote' ? 'This quotation was already sent. Create a revision to change it.' : 'Issued documents cannot be changed. Use an amendment or credit note.');
  if (locked && body.overrides) throw new HttpError(409, 'Layout of an issued document is frozen');
  let data = { ...d.data, ...(body.data ?? {}) };
  if (body.client_id || body.site_id !== undefined || body.contact_id !== undefined) {
    const snap = await clientSnapshot(cid, body.client_id ?? d.client_id, body.site_id !== undefined ? body.site_id : (d.site_id as number), body.contact_id !== undefined ? body.contact_id : ((d.data.contact as { id?: number })?.id ?? null));
    data = { ...data, ...snap };
  }
  if (data.placeOfSupply) data.placeOfSupplyName = stateName(String(data.placeOfSupply));
  const patch: Record<string, unknown> = { data: toJson(data), updated_at: now() };
  if (d.kind !== 'report') { const t = await totalsFor(cid, data); patch.totals = toJson(t); patch.total = t.total; }
  if (body.overrides) patch.overrides = toJson(body.overrides);
  if (body.template_id !== undefined) patch.template_id = body.template_id;
  if (body.client_id) patch.client_id = body.client_id;
  if (body.site_id !== undefined) patch.site_id = body.site_id;
  if (body.date) patch.date = body.date;
  await db('documents').where({ id: d.id }).update(patch);
  if (body.overrides && Object.keys(body.overrides).length) await audit(db, req.user, 'document', d.id, 'layout edited');
  return { ok: true };
}));
finance.delete('/documents/:id', h(async (req) => {
  const d = await loadDoc(req.user.company_id, Number(req.params.id));
  if (d.status !== 'draft' || (d.kind === 'quote' && d.number)) {
    if (d.status !== 'draft') throw new HttpError(409, 'Only drafts can be deleted');
  }
  if (d.kind === 'report') await db('tests').where({ report_id: d.id }).update({ report_id: null });
  await db('documents').where({ id: d.id }).update({ status: 'cancelled' });
  await audit(db, req.user, 'document', d.id, 'cancelled draft');
  return { ok: true };
}));

// ---------- quote lifecycle ----------
finance.post('/documents/:id/status', allow('quotes'), h(async (req) => {
  const d = await loadDoc(req.user.company_id, Number(req.params.id));
  const { status } = z.object({ status: z.enum(['sent', 'accepted', 'rejected', 'expired']) }).parse(req.body);
  if (d.kind !== 'quote') throw new HttpError(400, 'Only quotations have this status');
  await db('documents').where({ id: d.id }).update({ status, ...(status === 'sent' && !d.hash ? { hash: sha256(d.data), issued_at: now(), issued_by: req.user.id } : {}) });
  await audit(db, req.user, 'document', d.id, `quotation marked ${status}`);
  return { ok: true };
}));
finance.post('/documents/:id/revise', allow('quotes'), h(async (req) => {
  const d = await loadDoc(req.user.company_id, Number(req.params.id));
  if (d.kind !== 'quote') throw new HttpError(400, 'Only quotations can be revised here');
  const rootId = (d.parent_id as number) || d.id;
  const root = await loadDoc(req.user.company_id, rootId);
  const rev = Number((await db('documents').where({ parent_id: rootId }).max({ r: 'revision' }).first())?.r ?? 0) + 1;
  const id = await insert(db, 'documents', {
    company_id: d.company_id, kind: 'quote', number: `${root.number}-R${rev}`, status: 'draft', client_id: d.client_id, site_id: d.site_id, parent_id: rootId, revision: rev,
    date: today(), data: toJson(d.data), overrides: toJson(d.overrides ?? {}), template_id: d.template_id, totals: toJson(d.totals), total: d.total, created_by: req.user.id, created_at: now(), updated_at: now(),
  });
  if (d.status === 'sent') await db('documents').where({ id: d.id }).update({ status: 'expired' });
  await audit(db, req.user, 'document', id, 'quotation revision created', { from: d.number });
  return { id };
}));
finance.post('/documents/:id/to-workorder', allow('samples'), h(async (req) => {
  const d = await loadDoc(req.user.company_id, Number(req.params.id));
  if (d.kind !== 'quote') throw new HttpError(400, 'Only quotations can become work orders');
  const existing = await db('work_orders').where({ quote_id: d.id }).first();
  if (existing) return { id: existing.id, number: existing.number };
  if (d.status !== 'accepted') await db('documents').where({ id: d.id }).update({ status: 'accepted' });
  const wo = await createWorkOrder(req.user, { client_id: d.client_id, site_id: d.site_id as number, quote_id: d.id, customer_ref: String(d.data.customerRef ?? ''), date: today() });
  await db('documents').where({ id: d.id }).update({ work_order_id: wo.id });
  await audit(db, req.user, 'document', d.id, 'converted to work order', wo);
  return wo;
}));

// ---------- invoices ----------
/** Invoice from a work order: bills the tests carried out (or quoted lines when nothing is tested yet). */
finance.post('/workorders/:id/invoice', allow('invoices'), h(async (req) => {
  const cid = req.user.company_id;
  const wo = await db('work_orders').where({ id: Number(req.params.id), company_id: cid }).first();
  if (!wo) throw new HttpError(404, 'Work order not found');
  const tests = await db('tests as t').join('samples as s', 's.id', 't.sample_id').join('catalog as k', 'k.id', 't.catalog_id')
    .where('s.work_order_id', wo.id).whereIn('t.status', ['accepted', 'reported']).select('k.id as catalog_id', 'k.billing_name', 'k.rate', 'k.unit', 'k.sac', 'k.gst_rate');
  const billed = await db('documents').where({ company_id: cid, kind: 'invoice', work_order_id: wo.id }).whereNot('status', 'cancelled');
  const already = new Map<number, number>();
  for (const b of billed) for (const l of (parseJson<{ lines?: LineInput[] }>(b.data, {}).lines ?? [])) if (l.catalogId) already.set(l.catalogId, (already.get(l.catalogId) ?? 0) + Number(l.qty ?? 0));
  const byCat = new Map<number, LineInput>();
  for (const t of tests) {
    const l = byCat.get(t.catalog_id) ?? { description: t.billing_name, rate: Number(t.rate), qty: 0, unit: t.unit, sac: t.sac, gstRate: Number(t.gst_rate), catalogId: t.catalog_id };
    l.qty = (l.qty ?? 0) + 1; byCat.set(t.catalog_id, l);
  }
  let lines = [...byCat.values()].map((l) => ({ ...l, qty: (l.qty ?? 0) - (already.get(l.catalogId!) ?? 0) })).filter((l) => (l.qty ?? 0) > 0);
  if (!lines.length && wo.quote_id && !billed.length) {
    const q = await loadDoc(cid, wo.quote_id);
    lines = ((q.data.lines ?? []) as LineInput[]).map((l) => ({ ...l, qty: l.qty || 1 }));
  }
  if (!lines.length) throw new HttpError(400, 'Nothing left to bill on this work order (all accepted tests are already invoiced).');
  return createDocument(req.user, { kind: 'invoice', client_id: wo.client_id, site_id: wo.site_id, work_order_id: wo.id, data: { lines, customerRef: wo.customer_ref ?? '' } });
}));
finance.post('/documents/:id/to-invoice', allow('invoices'), h(async (req) => {
  const d = await loadDoc(req.user.company_id, Number(req.params.id));
  if (d.kind !== 'quote') throw new HttpError(400, 'Only quotations can be converted');
  const lines = ((d.data.lines ?? []) as LineInput[]).map((l) => ({ ...l, qty: l.qty || 1 }));
  return createDocument(req.user, { kind: 'invoice', client_id: d.client_id, site_id: d.site_id as number, work_order_id: d.work_order_id as number, contact_id: (d.data.contact as { id?: number })?.id ?? null, data: { lines, customerRef: d.data.customerRef } });
}));

// ---------- issue (invoice, report) ----------
finance.post('/documents/:id/issue', h(async (req) => {
  const cid = req.user.company_id;
  const d = await loadDoc(cid, Number(req.params.id));
  if (d.kind === 'invoice' && !can(req.user, 'invoices')) throw new HttpError(403, 'Your role does not allow issuing invoices');
  if (d.kind === 'report' && !can(req.user, 'reportIssue')) throw new HttpError(403, 'Only an authorised signatory can sign and issue reports');
  if (d.kind === 'invoice' && d.status !== 'draft') throw new HttpError(409, 'Invoice already issued');
  if (d.kind === 'report' && d.status !== 'verified') throw new HttpError(409, 'Verify the report before signing and issuing it');
  if (d.kind === 'invoice' && !((d.data.lines as unknown[]) ?? []).length) throw new HttpError(400, 'Add at least one line');
  return db.transaction(async (trx) => {
    const date = today();
    const client = await trx('clients').where({ id: d.client_id }).first();
    const { number } = await nextNumber(trx, cid, d.kind, { date, client: client?.short_code, material: String(d.data.material ?? '') });
    const data = { ...d.data, issueText: formatDate(date), dateText: formatDate(date) };
    const hash = sha256({ data, overrides: d.overrides, template: d.template_id });
    await trx('documents').where({ id: d.id }).update({ number, date, status: 'issued', data: toJson(data), issued_at: now(), issued_by: req.user.id, hash, updated_at: now() });
    if (d.kind === 'report') {
      await trx('tests').whereIn('id', (d.data.testIds as number[]) ?? []).update({ status: 'reported', report_id: d.id });
      await trx('samples').whereIn('id', (d.data.sampleIds as number[]) ?? []).update({ status: 'reported' });
      if (d.parent_id) await trx('documents').where({ id: d.parent_id }).update({ status: 'cancelled' });
    }
    await audit(trx, req.user, 'document', d.id, `${d.kind} signed and issued`, { number, hash: hash.slice(0, 12) });
    return { number };
  });
}));
finance.post('/documents/:id/amend', allow('reportIssue'), h(async (req) => {
  const d = await loadDoc(req.user.company_id, Number(req.params.id));
  const { reason } = z.object({ reason: z.string().min(3, 'Give a reason for the amendment') }).parse(req.body);
  if (d.kind !== 'report' || d.status !== 'issued') throw new HttpError(400, 'Only issued reports can be amended');
  const rev = Number(d.revision ?? 0) + 1;
  const id = await insert(db, 'documents', {
    company_id: d.company_id, kind: 'report', status: 'draft', client_id: d.client_id, site_id: d.site_id, work_order_id: d.work_order_id, parent_id: d.id, revision: rev,
    date: today(), data: toJson({ ...d.data, amendment: { of: d.number, revision: rev, reason } }), overrides: toJson(d.overrides ?? {}), template_id: d.template_id, totals: toJson(null),
    created_by: req.user.id, created_at: now(), updated_at: now(),
  });
  await audit(db, req.user, 'document', d.id, 'amendment started', { reason, draft: id });
  return { id };
}));

// ---------- email ----------
finance.post('/documents/:id/email', h(async (req) => {
  const cid = req.user.company_id;
  const d = await loadDoc(cid, Number(req.params.id));
  const body = z.object({ to: z.string().min(3), cc: z.string().optional(), subject: z.string().min(1), body: z.string(), pdfBase64: z.string().optional(), filename: z.string().optional() }).parse(req.body);
  const company = await getCompany(cid);
  const smtp = company.smtp ?? {};
  if (!smtp.host || !smtp.user || !process.env.SMTP_PASSWORD) throw new HttpError(400, 'Email is not set up yet. Add SMTP details in Settings and SMTP_PASSWORD in the hosting environment.');
  const transport = nodemailer.createTransport({ host: smtp.host, port: Number(smtp.port ?? 465), secure: smtp.secure ?? true, auth: { user: smtp.user, pass: process.env.SMTP_PASSWORD } });
  await transport.sendMail({
    from: smtp.from || `${company.name} <${smtp.user}>`, to: body.to, cc: body.cc || undefined, subject: body.subject, text: body.body,
    attachments: body.pdfBase64 ? [{ filename: body.filename || `${d.number || d.kind}.pdf`, content: Buffer.from(body.pdfBase64, 'base64'), contentType: 'application/pdf' }] : [],
  });
  if (d.kind === 'quote' && d.status === 'draft') await db('documents').where({ id: d.id }).update({ status: 'sent', issued_at: now(), issued_by: req.user.id, hash: sha256(d.data) });
  await audit(db, req.user, 'document', d.id, 'emailed', { to: body.to, cc: body.cc, subject: body.subject });
  return { ok: true };
}));

// ---------- payments & ledger ----------
finance.get('/payments', h(async (req) => db('payments as p').leftJoin('clients as c', 'c.id', 'p.client_id').where('p.company_id', req.user.company_id)
  .modify((b) => { if (req.query.client_id) b.andWhere('p.client_id', Number(req.query.client_id)); })
  .orderBy('p.id', 'desc').select('p.*', 'c.name as client_name').then((r: Record<string, unknown>[]) => r.map((x) => row(x, ['allocations'])))));
finance.get('/invoices/outstanding', h(async (req) => {
  const cid = req.user.company_id;
  const q = db('documents as d').leftJoin('clients as c', 'c.id', 'd.client_id').where({ 'd.company_id': cid, 'd.kind': 'invoice' }).whereIn('d.status', ['issued', 'partly_paid']);
  if (req.query.client_id) q.andWhere('d.client_id', Number(req.query.client_id));
  const rows = await q.select('d.id', 'd.number', 'd.date', 'd.total', 'd.client_id', 'c.name as client_name', 'c.payment_terms_days').orderBy('d.date');
  const paid = await paidAgainst(cid);
  const t = Date.now();
  return rows.map((r) => {
    const received = paid.get(r.id) ?? 0, total = Number(r.total);
    const days = Math.floor((t - new Date(r.date + 'T00:00:00').getTime()) / 86400000);
    return { ...r, total, received, balance: Math.round((total - received) * 100) / 100, days, overdue: days > Number(r.payment_terms_days ?? 30) };
  });
}));
finance.post('/payments', allow('payments'), h(async (req) => {
  const cid = req.user.company_id;
  const p = z.object({
    client_id: z.number(), date: z.string(), amount: z.number().positive(), tds: z.number().min(0).default(0), mode: z.string(), reference: z.string().optional().nullable(),
    notes: z.string().optional().nullable(), allocations: z.array(z.object({ invoiceId: z.number(), amount: z.number().positive() })).default([]),
  }).parse(req.body);
  const alloc = p.allocations.reduce((s, a) => s + a.amount, 0);
  if (alloc - (p.amount + p.tds) > 0.5) throw new HttpError(400, 'Allocated amount is more than the payment plus TDS');
  return db.transaction(async (trx) => {
    const { number } = await nextNumber(trx, cid, 'receipt', { date: p.date });
    const id = await insert(trx, 'payments', { ...p, allocations: toJson(p.allocations), number, company_id: cid, created_by: req.user.id, created_at: now() });
    await audit(trx, req.user, 'payment', id, 'payment recorded', { number, amount: p.amount, tds: p.tds });
    for (const a of p.allocations) await audit(trx, req.user, 'document', a.invoiceId, 'payment received', { receipt: number, amount: a.amount });
    await refreshInvoiceStatus(trx, cid, p.allocations.map((a) => a.invoiceId));
    return { id, number };
  });
}));
finance.get('/ledger', h(async (req) => {
  const cid = req.user.company_id;
  const clients = await db('clients').where({ company_id: cid }).select('id', 'name', 'opening_balance', 'payment_terms_days');
  const invs = await db('documents').where({ company_id: cid, kind: 'invoice' }).whereIn('status', ['issued', 'paid', 'partly_paid']).select('id', 'client_id', 'date', 'total');
  const pays = await db('payments').where({ company_id: cid }).select('client_id', 'amount', 'tds');
  const paid = await paidAgainst(cid);
  const t = Date.now();
  return clients.map((c) => {
    const ci = invs.filter((i) => i.client_id === c.id);
    const invoiced = ci.reduce((s, i) => s + Number(i.total), 0);
    const received = pays.filter((p) => p.client_id === c.id).reduce((s, p) => s + Number(p.amount) + Number(p.tds), 0);
    const ageing = { d0_30: 0, d31_60: 0, d61_90: 0, d90: 0 };
    for (const i of ci) {
      const due = Number(i.total) - (paid.get(i.id) ?? 0); if (due <= 0.5) continue;
      const days = Math.floor((t - new Date(i.date + 'T00:00:00').getTime()) / 86400000);
      if (days <= 30) ageing.d0_30 += due; else if (days <= 60) ageing.d31_60 += due; else if (days <= 90) ageing.d61_90 += due; else ageing.d90 += due;
    }
    return { id: c.id, name: c.name, opening: Number(c.opening_balance || 0), invoiced, received, balance: Math.round((Number(c.opening_balance || 0) + invoiced - received) * 100) / 100, ageing };
  }).filter((c) => c.invoiced || c.received || c.opening);
}));
finance.get('/ledger/:clientId', h(async (req) => ledger(req.user.company_id, Number(req.params.clientId))));

// ---------- registers ----------
type Col = { key: string; label: string; type?: 'money' | 'date' };
finance.get('/registers/:name', h(async (req) => {
  const cid = req.user.company_id;
  const from = String(req.query.from ?? '0000-00-00'), to = String(req.query.to ?? '9999-12-31');
  const name = req.params.name;
  let columns: Col[] = []; let rows: Record<string, unknown>[] = [];
  if (name === 'quotations' || name === 'invoices' || name === 'reports') {
    const kind = name === 'quotations' ? 'quote' : name.slice(0, -1);
    const docs = await db('documents as d').leftJoin('clients as c', 'c.id', 'd.client_id').leftJoin('sites as s', 's.id', 'd.site_id').leftJoin('users as u', 'u.id', 'd.issued_by')
      .where({ 'd.company_id': cid, 'd.kind': kind }).whereNot('d.status', 'cancelled').whereBetween('d.date', [from, to]).orderBy('d.date', 'desc')
      .select('d.*', 'c.name as client_name', 'c.gstin', 's.name as site_name', 'u.name as issuer');
    const paid = await paidAgainst(cid);
    rows = docs.map((d) => {
      const t = parseJson<Record<string, number>>(d.totals, {}); const data = parseJson<Record<string, unknown>>(d.data, {});
      return { number: d.number ?? '(draft)', date: d.date, client: d.client_name, gstin: d.gstin, site: d.site_name, status: d.status, total: Number(d.total), taxable: t?.taxable, cgst: t?.cgst, sgst: t?.sgst, igst: t?.igst,
        pos: data.placeOfSupplyName, received: paid.get(d.id) ?? 0, ulr: data.ulr, samples: data.jobCodeText, signatory: d.issuer, id: d.id };
    });
    columns = name === 'invoices'
      ? [{ key: 'number', label: 'Invoice no.' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'client', label: 'Client' }, { key: 'gstin', label: 'GSTIN' }, { key: 'pos', label: 'Place of supply' },
        { key: 'taxable', label: 'Taxable', type: 'money' }, { key: 'cgst', label: 'CGST', type: 'money' }, { key: 'sgst', label: 'SGST', type: 'money' }, { key: 'igst', label: 'IGST', type: 'money' }, { key: 'total', label: 'Total', type: 'money' }, { key: 'received', label: 'Received', type: 'money' }, { key: 'status', label: 'Status' }]
      : name === 'reports'
        ? [{ key: 'number', label: 'Report no.' }, { key: 'date', label: 'Issue date', type: 'date' }, { key: 'client', label: 'Client' }, { key: 'samples', label: 'Job code(s)' }, { key: 'ulr', label: 'ULR' }, { key: 'signatory', label: 'Signed by' }, { key: 'status', label: 'Status' }]
        : [{ key: 'number', label: 'Quotation no.' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'client', label: 'Client' }, { key: 'site', label: 'Site / project' }, { key: 'total', label: 'Value', type: 'money' }, { key: 'status', label: 'Status' }];
  } else if (name === 'samples') {
    const s = await db('samples as s').leftJoin('clients as c', 'c.id', 's.client_id').leftJoin('sites as st', 'st.id', 's.site_id').where('s.company_id', cid).whereBetween('s.received_date', [from, to]).orderBy('s.id', 'desc')
      .select('s.*', 'c.name as client_name', 'st.name as site_name');
    const tests = s.length ? await db('tests as t').leftJoin('catalog as k', 'k.id', 't.catalog_id').whereIn('t.sample_id', s.map((x) => x.id)).select('t.sample_id', 'k.report_name', 'k.billing_name') : [];
    rows = s.map((x) => ({ id: x.id, code: x.code, ulr: x.ulr, received: x.received_date, client: x.client_name, site: x.site_name, material: x.material, description: x.description, quantity: x.quantity, condition: x.condition,
      tests: tests.filter((t) => t.sample_id === x.id).map((t) => t.report_name || t.billing_name).join(', '), status: x.status }));
    columns = [{ key: 'code', label: 'Job code' }, { key: 'ulr', label: 'ULR' }, { key: 'received', label: 'Received', type: 'date' }, { key: 'client', label: 'Client' }, { key: 'site', label: 'Site' }, { key: 'material', label: 'Material' },
      { key: 'description', label: 'Description' }, { key: 'quantity', label: 'Qty' }, { key: 'condition', label: 'Condition' }, { key: 'tests', label: 'Tests' }, { key: 'status', label: 'Status' }];
  } else if (name === 'tests') {
    const t = await db('tests as t').join('samples as s', 's.id', 't.sample_id').leftJoin('clients as c', 'c.id', 's.client_id').leftJoin('catalog as k', 'k.id', 't.catalog_id')
      .leftJoin('users as u', 'u.id', 't.entered_by').leftJoin('users as r', 'r.id', 't.reviewed_by').where('t.company_id', cid).orderBy('t.id', 'desc')
      .select('t.*', 's.code', 'c.name as client_name', 'k.report_name', 'k.billing_name', 'u.name as tested_by', 'r.name as reviewer');
    rows = t.map((x) => ({ id: x.id, code: x.code, test: x.report_name || x.billing_name, client: x.client_name, due: x.due_date, started: x.started_at, completed: x.completed_at, tested_by: x.tested_by, reviewer: x.reviewer, status: x.status }));
    columns = [{ key: 'code', label: 'Job code' }, { key: 'test', label: 'Test' }, { key: 'client', label: 'Client' }, { key: 'due', label: 'Due', type: 'date' }, { key: 'started', label: 'Started', type: 'date' }, { key: 'completed', label: 'Completed', type: 'date' }, { key: 'tested_by', label: 'Tested by' }, { key: 'reviewer', label: 'Checked by' }, { key: 'status', label: 'Status' }];
  } else if (name === 'receipts') {
    const p = await db('payments as p').leftJoin('clients as c', 'c.id', 'p.client_id').where('p.company_id', cid).whereBetween('p.date', [from, to]).orderBy('p.date', 'desc').select('p.*', 'c.name as client_name');
    rows = p.map((x) => ({ id: x.id, number: x.number, date: x.date, client: x.client_name, amount: Number(x.amount), tds: Number(x.tds), mode: x.mode, reference: x.reference }));
    columns = [{ key: 'number', label: 'Receipt no.' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'client', label: 'Client' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'tds', label: 'TDS', type: 'money' }, { key: 'mode', label: 'Mode' }, { key: 'reference', label: 'Reference' }];
  } else if (name === 'equipment') {
    const e = await db('equipment').where({ company_id: cid }).orderBy('due_date');
    const td = today();
    rows = e.map((x) => ({ id: x.id, name: x.name, category: x.category, id_no: x.id_no, cert: x.cert_no, cal: x.cal_date, due: x.due_date, status: !x.due_date ? 'No date' : x.due_date < td ? 'EXPIRED' : 'Valid' }));
    columns = [{ key: 'name', label: 'Equipment' }, { key: 'category', label: 'Category' }, { key: 'id_no', label: 'ID no.' }, { key: 'cert', label: 'Certificate' }, { key: 'cal', label: 'Calibrated', type: 'date' }, { key: 'due', label: 'Due', type: 'date' }, { key: 'status', label: 'Status' }];
  } else throw new HttpError(404, 'Unknown register');
  return { columns, rows };
}));

// ---------- dashboard ----------
finance.get('/dashboard', h(async (req) => {
  const cid = req.user.company_id, td = today();
  const monthStart = td.slice(0, 8) + '01';
  const [tests, reports, quotes, invoices, eq, outstanding] = await Promise.all([
    db('tests as t').join('samples as s', 's.id', 't.sample_id').leftJoin('catalog as k', 'k.id', 't.catalog_id').leftJoin('clients as c', 'c.id', 's.client_id')
      .where('t.company_id', cid).whereIn('t.status', ['pending', 'in_progress', 'returned', 'submitted', 'accepted'])
      .select('t.id', 't.status', 't.due_date', 't.assigned_to', 't.report_id', 's.code', 'k.report_name', 'k.billing_name', 'c.name as client_name'),
    db('documents').where({ company_id: cid, kind: 'report' }).whereIn('status', ['draft', 'review', 'verified']).select('id', 'status', 'data'),
    db('documents as d').leftJoin('clients as c', 'c.id', 'd.client_id').where({ 'd.company_id': cid, 'd.kind': 'quote', 'd.status': 'sent' }).select('d.id', 'd.number', 'd.date', 'c.name as client_name', 'd.issued_at'),
    db('documents').where({ company_id: cid, kind: 'invoice' }).whereIn('status', ['issued', 'paid', 'partly_paid']).andWhere('date', '>=', monthStart).select('total'),
    db('equipment').where({ company_id: cid, active: true }).whereNotNull('due_date').select('id', 'name', 'due_date'),
    db('documents').where({ company_id: cid, kind: 'invoice' }).whereIn('status', ['issued', 'partly_paid']).select('id', 'total', 'date', 'number', 'client_id'),
  ]);
  const paid = await paidAgainst(cid);
  const due = outstanding.map((o) => ({ ...o, balance: Number(o.total) - (paid.get(o.id) ?? 0) }));
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const reminders: { kind: string; text: string; link: string; level: 'info' | 'warning' | 'danger' }[] = [];
  for (const t of tests.filter((t) => ['pending', 'in_progress', 'returned'].includes(t.status) && t.due_date && t.due_date <= td))
    reminders.push({ kind: 'Test due', text: `${t.report_name || t.billing_name} – ${t.code} (${t.client_name}) due ${formatDate(t.due_date)}`, link: `/tests/${t.id}`, level: t.due_date < td ? 'danger' : 'warning' });
  for (const t of tests.filter((t) => t.status === 'returned')) reminders.push({ kind: 'Returned', text: `${t.report_name || t.billing_name} – ${t.code} needs correction`, link: `/tests/${t.id}`, level: 'warning' });
  for (const q of quotes) {
    const days = Math.floor((Date.now() - new Date(q.date + 'T00:00:00').getTime()) / 86400000);
    if (days >= 7) reminders.push({ kind: 'Quote follow-up', text: `${q.number} to ${q.client_name} sent ${days} days ago`, link: `/documents/${q.id}`, level: 'info' });
  }
  for (const e of eq.filter((e) => e.due_date <= in30)) reminders.push({ kind: 'Calibration', text: `${e.name} calibration ${e.due_date < td ? 'expired' : 'due'} ${formatDate(e.due_date)}`, link: '/equipment', level: e.due_date < td ? 'danger' : 'warning' });
  for (const o of due) {
    const days = Math.floor((Date.now() - new Date(o.date + 'T00:00:00').getTime()) / 86400000);
    if (days > 30 && o.balance > 0.5) reminders.push({ kind: 'Payment overdue', text: `Invoice ${o.number}: ₹${Math.round(o.balance).toLocaleString('en-IN')} outstanding for ${days} days`, link: `/documents/${o.id}`, level: 'danger' });
  }
  return {
    counts: {
      testsToDo: tests.filter((t) => ['pending', 'in_progress', 'returned'].includes(t.status)).length,
      myTests: tests.filter((t) => ['pending', 'in_progress', 'returned'].includes(t.status) && t.assigned_to === req.user.id).length,
      toReview: tests.filter((t) => t.status === 'submitted').length,
      toReport: tests.filter((t) => t.status === 'accepted' && !t.report_id).length,
      reportsDraft: reports.filter((r) => r.status === 'draft').length,
      reportsToVerify: reports.filter((r) => r.status === 'review').length,
      reportsToIssue: reports.filter((r) => r.status === 'verified').length,
      quotesAwaiting: quotes.length,
      revenueMonth: invoices.reduce((s, i) => s + Number(i.total), 0),
      outstanding: Math.round(due.reduce((s, o) => s + o.balance, 0)),
    },
    reminders,
  };
}));
