import { Router } from 'express';
import { z } from 'zod';
import { mailer } from '../alerts';
import { emailHtml, footerText } from '../email';
import { cleanLayout, refreshRoles, computeTotals, formatDate, isEmailList, setLayoutUlr, stateName, ulrScope, type LineInput } from '@suite/shared';
import { db, insert, now, parseJson, row, today, toJson } from '../db';
import { allow, can, h, HttpError, isAdmin } from '../auth';
import { cleanWrite } from '../meta';
import { audit, clientSnapshot, getCompany, getDocTemplate, ledger, nextNumber, paidAgainst, refreshInvoiceStatus, sha256 } from '../services';
import { guardDocument, recordAccess, restrictDocuments, isShareObject } from '../sharing';
import { followUpsDue, scheduleQuoteFollowUp, shareable, shareToken, verifyToken } from './crm';
import { createWorkOrder } from './lab';
import { isIsoDate } from '@suite/shared';
const isoDate = z.string().refine(isIsoDate, 'Enter a valid date (YYYY-MM-DD)');

export const finance = Router();
/** Private quotations / invoices: owner, shared users and View all roles only (see sharing.ts). */
finance.use('/documents/:id', guardDocument);

const JSON_COLS = ['data', 'overrides', 'totals'];
const permFor = (kind: string) => (kind === 'quote' ? 'quotes' : kind === 'invoice' ? 'invoices' : 'reportPrepare') as 'quotes' | 'invoices' | 'reportPrepare';

async function loadDoc(cid: number, id: number) {
  const d = row(await db('documents').where({ id, company_id: cid }).first(), JSON_COLS);
  if (!d) throw new HttpError(404, 'Document not found');
  return d as Record<string, unknown> & { id: number; kind: string; status: string; data: Record<string, unknown>; client_id: number };
}

/** Who can sign: profiles from Settings → Company → Signatories, plus users who uploaded a signature. */
export interface Signatory { id: string; name: string; designation?: string; qualifications?: string; signature?: string | null; userId?: number | null; kinds?: string[] }
async function signatoryOptions(cid: number): Promise<Signatory[]> {
  const company = await getCompany(cid);
  const profiles = (((company as any).signatories ?? []) as Signatory[]).filter((x) => x?.id && x.name);
  const linked = new Set(profiles.map((x) => x.userId).filter(Boolean));
  const users = await db('users').where({ company_id: cid, active: true }).whereNotNull('signature').select('id', 'name', 'designation', 'qualifications', 'signature');
  return [...profiles, ...users.filter((u) => u.signature && !linked.has(u.id)).map((u) => ({ id: `u${u.id}`, name: u.name, designation: u.designation, qualifications: u.qualifications, signature: u.signature, userId: u.id }))];
}
function mayUseSignatory(u: Parameters<typeof isAdmin>[0], kind: string, s: Signatory) {
  if (isAdmin(u) || u.role === 'owner') return true;
  if (s.userId) return s.userId === u.id;
  return kind !== 'report'; // company signatory profiles without a login: quotes/invoices only
}

/** Lines and discounts must be sensible numbers before totals are worked out. */
function checkDocData(data: Record<string, unknown> | undefined) {
  if (!data) return;
  const lines = (data.lines ?? []) as LineInput[];
  if (!Array.isArray(lines)) throw new HttpError(400, 'Lines are not valid');
  lines.forEach((l, i) => {
    if (!String(l.description ?? '').trim()) throw new HttpError(400, `Line ${i + 1}: description is required`);
    if (!Number.isFinite(Number(l.rate)) || Number(l.rate) < 0) throw new HttpError(400, `Line ${i + 1}: rate must be a number of 0 or more`);
    if (l.qty !== null && l.qty !== undefined && (!Number.isFinite(Number(l.qty)) || Number(l.qty) < 0)) throw new HttpError(400, `Line ${i + 1}: quantity must be 0 or more`);
    if (l.discountPct !== undefined && l.discountPct !== null && (Number(l.discountPct) < 0 || Number(l.discountPct) > 100)) throw new HttpError(400, `Line ${i + 1}: discount must be between 0 and 100%`);
    if (l.gstRate !== undefined && l.gstRate !== null && (Number(l.gstRate) < 0 || Number(l.gstRate) > 28)) throw new HttpError(400, `Line ${i + 1}: GST rate must be between 0 and 28%`);
  });
  if (data.discountPct !== undefined && data.discountPct !== null && (Number(data.discountPct) < 0 || Number(data.discountPct) > 100 || isNaN(Number(data.discountPct)))) throw new HttpError(400, 'Discount must be between 0 and 100%');
  if (data.overallDiscount !== undefined && data.overallDiscount !== null && (Number(data.overallDiscount) < 0 || isNaN(Number(data.overallDiscount)))) throw new HttpError(400, 'Discount amount cannot be negative');
}

async function totalsFor(cid: number, data: Record<string, unknown>) {
  const company = await getCompany(cid);
  const lines = (data.lines ?? []) as LineInput[];
  const showQty = data.showQty ?? data.mode !== 'rate';
  const includeGst = data.includeGst ?? true;
  const t = computeTotals(lines.map((l) => ({ ...l, qty: showQty ? (l.qty ?? 1) : 0, gstRate: includeGst ? l.gstRate : 0 })), {
    supplierState: company.stateCode ?? '', placeOfSupply: String(data.placeOfSupply ?? company.stateCode ?? ''),
    defaultGst: includeGst ? company.defaults?.gstRate ?? 18 : 0, overallDiscount: Number(data.overallDiscount ?? 0), discountPct: Number(data.discountPct ?? 0),
  });
  return t;
}

// ---------- list / get ----------
const KINDS = ['quote', 'invoice', 'report'];
finance.get('/documents', h(async (req) => {
  const cid = req.user.company_id;
  const readable = KINDS.filter((k) => can(req.user, `${k}.read`));
  const q = db('documents as d').leftJoin('clients as c', 'c.id', 'd.client_id').leftJoin('sites as s', 's.id', 'd.site_id')
    .where('d.company_id', cid).select('d.id', 'd.kind', 'd.number', 'd.status', 'd.date', 'd.total', 'd.client_id', 'd.site_id', 'd.work_order_id', 'd.revision', 'd.issued_at', 'd.accreditation', 'c.name as client_name', 's.name as site_name');
  q.whereIn('d.kind', readable);
  await restrictDocuments(req.user, q);
  q.leftJoin('users as o', 'o.id', 'd.owner_id').select('d.owner_id', 'o.name as owner_name');
  if (req.query.kind) q.andWhere('d.kind', String(req.query.kind));
  if (req.query.status) q.whereIn('d.status', String(req.query.status).split(','));
  if (req.query.client_id) q.andWhere('d.client_id', Number(req.query.client_id));
  if (req.query.q) q.andWhere((w) => w.where('d.number', 'like', `%${req.query.q}%`).orWhere('c.name', 'like', `%${req.query.q}%`));
  const rows = await q.orderBy('d.id', 'desc').limit(5000);
  const paid = await paidAgainst(cid);
  return rows.map((r) => ({ ...r, total: Number(r.total), paid: r.kind === 'invoice' ? paid.get(r.id) ?? 0 : undefined }));
}));
finance.get('/documents/:id', h(async (req) => {
  const cid = req.user.company_id;
  const d = await loadDoc(cid, Number(req.params.id));
  if (!can(req.user, `${d.kind}.read`)) throw new HttpError(403, 'Your role cannot open this document');
  const [company, tpl] = await Promise.all([getCompany(cid), getDocTemplate(cid, d.kind, d.template_id as number)]);
  const snap = d.data.signatory as Signatory | undefined;
  let issuer: Record<string, unknown> | null = snap?.name ? { ...snap } : d.issued_by ? await db('users').where({ id: d.issued_by }).first('id', 'name', 'designation', 'qualifications', 'signature') : null;
  if (!['issued', 'paid', 'partly_paid', 'cancelled'].includes(d.status) && d.data.signatoryId) {
    const pick = (await signatoryOptions(cid)).find((x) => x.id === d.data.signatoryId);
    issuer = pick ? { name: pick.name, designation: pick.designation, qualifications: pick.qualifications, preview: true } : null;
  }
  const paid = d.kind === 'invoice' ? (await paidAgainst(cid)).get(d.id) ?? 0 : undefined;
  const history = await db('audit_log').where({ company_id: cid, entity: 'document', entity_id: d.id }).orderBy('id', 'desc');
  const users = new Map((await db('users').where({ company_id: cid }).select('id', 'name')).map((u) => [u.id, u.name]));
  const revisions = await db('documents').where({ company_id: cid }).andWhere((w) => w.where('parent_id', d.id).orWhere('id', d.parent_id ?? -1)).select('id', 'number', 'status', 'revision');
  const verify = d.kind === 'report' && d.hash && ['issued', 'cancelled'].includes(d.status as string) ? verifyToken(d.id as number, d.hash as string) : null;
  const share = shareable(d as never) ? shareToken(d.id, String(d.created_at)) : null;
  const access = isShareObject(d.kind) ? await recordAccess(req.user, d.kind, d as never) : 'edit';
  const owner_name = d.owner_id ? (await db('users').where({ id: d.owner_id as number }).first('name'))?.name ?? null : null;
  return { ...d, company, template: tpl, issuer, paid, revisions, verify, share, access, owner_name, history: history.map((x) => ({ ...row(x, ['detail']), user: users.get(x.user_id) })) };
}));

// ---------- create / update ----------
const docSchema = z.object({
  kind: z.enum(['quote', 'invoice']), client_id: z.number(), site_id: z.number().nullable().optional(), contact_id: z.number().nullable().optional(),
  work_order_id: z.number().nullable().optional(), date: isoDate.optional(), data: z.record(z.any()).default({}), template_id: z.number().nullable().optional(),
});
export async function createDocument(user: { company_id: number; id: number }, body: z.infer<typeof docSchema>) {
  checkDocData(body.data);
  const cid = user.company_id;
  const company = await getCompany(cid);
  const snap = await clientSnapshot(cid, body.client_id, body.site_id, body.contact_id);
  const date = body.date || today();
  const placeOfSupply = body.data.placeOfSupply || snap.client.stateCode || company.stateCode;
  const defaults = company.defaults ?? {};
  const data: Record<string, unknown> = {
    showQty: body.data.showQty ?? (body.data.mode ? body.data.mode !== 'rate' : body.kind !== 'quote'), includeGst: body.data.includeGst ?? (body.data.mode ? body.data.mode !== 'rate' : body.kind !== 'quote'), lines: [], customerRef: '', notes: '', overallDiscount: 0,
    copyLabel: body.kind === 'invoice' ? 'ORIGINAL COPY' : undefined, sac: defaults.sac ?? '998346', validityDays: defaults.validityDays ?? 30,
    ...body.data, ...snap, placeOfSupply, placeOfSupplyName: stateName(placeOfSupply),
  };
  if (body.data.discountPct === undefined) data.discountPct = snap.defaultDiscountPct;
  if (body.kind === 'quote' && !body.data.notes) data.notes = defaults.quoteNotes ?? '';
  const tpl = await getDocTemplate(cid, body.kind, body.template_id);
  const totals = await totalsFor(cid, data);
  return db.transaction(async (trx) => {
    const number = body.kind === 'quote' ? (await nextNumber(trx, cid, 'quote', { date, client: snap.client.shortCode })).number : null;
    const id = await insert(trx, 'documents', {
      company_id: cid, kind: body.kind, number, status: 'draft', accreditation: (data.accreditation as string) ?? null, client_id: body.client_id, site_id: body.site_id ?? null, work_order_id: body.work_order_id ?? null,
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
    client_id: z.number().optional(), site_id: z.number().nullable().optional(), contact_id: z.number().nullable().optional(), date: isoDate.optional(),
    number: z.string().nullable().optional(),
  }).parse(req.body);
  const admin = isAdmin(req.user);
  const issued = ['issued', 'paid', 'partly_paid', 'cancelled'].includes(d.status);
  const locked = issued || (!admin && ((d.kind === 'quote' && d.status !== 'draft') || (d.kind === 'report' && d.status === 'verified')));
  if (locked && (body.data || body.client_id || body.date || body.number !== undefined)) throw new HttpError(409, issued ? (admin ? 'Unlock the issued document first (System Admin).' : 'Issued documents cannot be changed. Use an amendment or credit note.') : 'This quotation was already sent. Create a revision to change it.');
  if (locked && body.overrides) throw new HttpError(409, 'Layout of an issued document is frozen');
  checkDocData(body.data);
  if (body.data && 'layout' in body.data) {
    // report layout edited in the browser: only simple formatting is kept (no scripts, links or images)
    if (d.kind !== 'report') delete body.data.layout;
    else if (body.data.layout !== null) {
      const clean = cleanLayout(body.data.layout);
      if (!clean) throw new HttpError(400, 'The report layout is not valid');
      body.data.layout = clean;
      const before = JSON.stringify((d.data as any).layout?.sections ?? null);
      if (before !== JSON.stringify(clean.sections)) {
        // one history line per editing session, not one per autosave
        const last = await db('audit_log').where({ company_id: req.user.company_id, entity: 'document', entity_id: d.id }).orderBy('id', 'desc').first();
        if (!(last?.action === 'report layout edited' && last.user_id === req.user.id && Date.now() - new Date(last.at).getTime() < 15 * 60_000)) await audit(db, req.user, 'document', d.id, 'report layout edited', { sections: clean.sections.length });
      }
    }
  }
  if (body.data && d.kind === 'report') for (const k of ['tests', 'customer', 'extra', 'testIds', 'sampleIds'] as const) delete body.data[k]; // from the lab records only
  let data = { ...d.data, ...(body.data ?? {}) };
  if (body.data?.custom) data.custom = (await cleanWrite(cid, req.user.roleDef, d.kind, { custom: body.data.custom }, { creating: false })).custom;
  if (body.client_id || body.site_id !== undefined || body.contact_id !== undefined) {
    const snap = await clientSnapshot(cid, body.client_id ?? d.client_id, body.site_id !== undefined ? body.site_id : (d.site_id as number), body.contact_id !== undefined ? body.contact_id : ((d.data.contact as { id?: number })?.id ?? null));
    // keep values the user unlocked and typed by hand
    const unlocked = (data.unlocked ?? {}) as Record<string, boolean>;
    const merged: Record<string, any> = { ...data, ...snap };
    for (const part of ['client', 'site', 'contact'] as const) {
      const before = (data as any)[part] ?? {};
      for (const k of Object.keys(before)) if (unlocked[`${part}.${k}`]) merged[part] = { ...(merged[part] ?? {}), [k]: before[k] };
    }
    if (!(data.unlocked as Record<string, boolean> | undefined)?.discountPct) merged.discountPct = snap.defaultDiscountPct;
    data = merged;
  }
  // remarks / notes changed through the API: the report body follows (a layout sent with the change wins)
  if (d.kind === 'report' && body.data && !('layout' in body.data) && (data as any).layout?.sections) {
    const roles = (['remarks', 'notes'] as const).filter((k) => k in body.data!);
    if (roles.length) (data as any).layout = refreshRoles((data as any).layout, { data: data as never }, [...roles]);
  }
  if (data.placeOfSupply && !(data.unlocked as any)?.placeOfSupplyName) data.placeOfSupplyName = stateName(String(data.placeOfSupply));
  const patch: Record<string, unknown> = { data: toJson(data), updated_at: now(), accreditation: (data.accreditation as string) ?? null };
  if (d.kind !== 'report') { const t = await totalsFor(cid, data); patch.totals = toJson(t); patch.total = t.total; }
  if (body.overrides) patch.overrides = toJson(body.overrides);
  if (body.template_id !== undefined) patch.template_id = body.template_id;
  if (body.client_id) patch.client_id = body.client_id;
  if (body.site_id !== undefined) patch.site_id = body.site_id;
  if (body.date) patch.date = body.date;
  if (body.number !== undefined && body.number !== d.number) {
    const n = (body.number ?? '').trim() || null;
    if (n) {
      const clash = await db('documents').where({ company_id: cid, kind: d.kind, number: n }).whereNot({ id: d.id }).whereNot({ status: 'cancelled' }).first();
      if (clash) throw new HttpError(409, `${n} is already used by another ${d.kind}`);
    }
    patch.number = n;
    await audit(db, req.user, 'document', d.id, 'number changed manually', { from: d.number, to: n });
  }
  await db('documents').where({ id: d.id }).update(patch);
  if (body.overrides && Object.keys(body.overrides).length) await audit(db, req.user, 'document', d.id, 'layout edited');
  return { ok: true };
}));
finance.post('/documents/:id/unlock', h(async (req) => {
  if (!isAdmin(req.user)) throw new HttpError(403, 'Only the System Administrator can unlock an issued document');
  const d = await loadDoc(req.user.company_id, Number(req.params.id));
  const { reason } = z.object({ reason: z.string().min(3, 'Give a reason') }).parse(req.body);
  await db('documents').where({ id: d.id }).update({ status: 'draft', hash: null, updated_at: now() });
  await audit(db, req.user, 'document', d.id, 'unlocked for editing by System Admin', { reason, previousStatus: d.status, number: d.number });
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
  if (status === 'sent' && d.kind === 'quote') await scheduleQuoteFollowUp(req.user.company_id, req.user.id, { id: d.id as number, number: d.number as string | null, client_id: d.client_id as number });
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
  const accs = [...new Set((await db('samples').where({ work_order_id: wo.id })).map((x) => x.accreditation).filter(Boolean))];
  return createDocument(req.user, { kind: 'invoice', client_id: wo.client_id, site_id: wo.site_id, work_order_id: wo.id, data: { lines, customerRef: wo.customer_ref ?? '', accreditation: accs.length === 1 ? accs[0] : null } });
}));
/** Copy a quotation or invoice into a new draft (same client, lines, discounts and notes; fresh dates and numbers). */
finance.post('/documents/:id/duplicate', h(async (req) => {
  const d = await loadDoc(req.user.company_id, Number(req.params.id));
  if (!['quote', 'invoice'].includes(d.kind)) throw new HttpError(400, 'Only quotations and invoices can be duplicated');
  if (!can(req.user, `${d.kind}.create`)) throw new HttpError(403, 'Your role cannot create this document');
  const b = z.object({ client_id: z.number().optional(), site_id: z.number().nullable().optional() }).parse(req.body ?? {});
  const keep = ['lines', 'mode', 'showQty', 'includeGst', 'notes', 'accreditation', 'overallDiscount', 'discountPct', 'customerRef', 'validityDays'];
  const data = Object.fromEntries(Object.entries(d.data).filter(([k]) => keep.includes(k)));
  const sameClient = !b.client_id || b.client_id === d.client_id;
  if (!sameClient) { delete data.discountPct; delete data.customerRef; }
  const contact = sameClient ? ((d.data.contact as { id?: number })?.id ?? null) : null;
  const r = await createDocument(req.user, { kind: d.kind as 'quote', client_id: b.client_id ?? d.client_id, site_id: sameClient ? (b.site_id !== undefined ? b.site_id : (d.site_id as number | null)) : b.site_id ?? null, contact_id: contact, data } as never);
  await audit(db, req.user, 'document', r.id, `${d.kind} duplicated`, { from: d.number ?? d.id });
  return r;
}));
finance.post('/documents/:id/to-invoice', allow('invoices'), h(async (req) => {
  const d = await loadDoc(req.user.company_id, Number(req.params.id));
  if (d.kind !== 'quote') throw new HttpError(400, 'Only quotations can be converted');
  const lines = ((d.data.lines ?? []) as LineInput[]).map((l) => ({ ...l, qty: l.qty || 1 }));
  return createDocument(req.user, { kind: 'invoice', client_id: d.client_id, site_id: d.site_id as number, work_order_id: d.work_order_id as number, contact_id: (d.data.contact as { id?: number })?.id ?? null, data: { lines, customerRef: d.data.customerRef, accreditation: d.data.accreditation, discountPct: d.data.discountPct, overallDiscount: d.data.overallDiscount } });
}));

// ---------- signatory choice and seal position (allowed until the document is issued) ----------
finance.get('/signatories', h(async (req) => (await signatoryOptions(req.user.company_id)).map(({ signature, ...x }) => ({ ...x, hasSignature: Boolean(signature), allowed: { report: mayUseSignatory(req.user, 'report', { ...x, signature }), other: mayUseSignatory(req.user, 'invoice', { ...x, signature }) } }))));
finance.put('/documents/:id/placement', h(async (req) => {
  const d = await loadDoc(req.user.company_id, Number(req.params.id));
  if (['issued', 'paid', 'partly_paid', 'cancelled'].includes(d.status)) throw new HttpError(409, 'This document is issued and locked');
  const ok = d.kind === 'report' ? can(req.user, 'signReports') || can(req.user, 'prepareReports') : can(req.user, `${d.kind}.edit`);
  if (!ok) throw new HttpError(403, 'Your role cannot change this document');
  const b = z.object({
    sealPos: z.object({ x: z.number().min(0).max(300), y: z.number().min(0).max(3000), w: z.number().min(15).max(80) }).nullable().optional(),
    signatoryId: z.string().max(40).nullable().optional(),
  }).parse(req.body);
  if (b.signatoryId && !(await signatoryOptions(req.user.company_id)).some((x) => x.id === b.signatoryId)) throw new HttpError(400, 'Unknown signatory');
  const data = { ...d.data } as Record<string, unknown>;
  if (b.sealPos !== undefined) data.sealPos = b.sealPos;
  if (b.signatoryId !== undefined) data.signatoryId = b.signatoryId;
  await db('documents').where({ id: d.id }).update({ data: toJson(data), updated_at: now() });
  return { ok: true };
}));

// ---------- issue (invoice, report) ----------
finance.post('/documents/:id/issue', h(async (req) => {
  const cid = req.user.company_id;
  const d = await loadDoc(cid, Number(req.params.id));
  const admin = isAdmin(req.user);
  if (d.kind === 'invoice' && !can(req.user, 'issueInvoices')) throw new HttpError(403, 'Your role does not allow issuing invoices');
  if (d.kind === 'report' && !can(req.user, 'signReports')) throw new HttpError(403, 'Only an authorised signatory can sign and issue reports');
  if (d.kind === 'invoice' && d.status !== 'draft') throw new HttpError(409, 'Invoice already issued');
  if (d.kind === 'report' && d.status !== 'verified' && !(admin && ['draft', 'review'].includes(d.status))) throw new HttpError(409, 'Verify the report before signing and issuing it');
  if (d.kind === 'invoice' && !((d.data.lines as unknown[]) ?? []).length) throw new HttpError(400, 'Add at least one line');
  let signatory: Signatory | undefined;
  if (d.data.signatoryId) {
    signatory = (await signatoryOptions(cid)).find((x) => x.id === d.data.signatoryId);
    if (!signatory) throw new HttpError(400, 'The selected signatory no longer exists. Choose who signs, then try again.');
    if (!mayUseSignatory(req.user, d.kind, signatory)) throw new HttpError(403, `Only ${signatory.name} (or the System Administrator / Owner) can sign with this signature. Choose yourself as the signatory.`);
  } else {
    const me = await db('users').where({ id: req.user.id }).first('id', 'name', 'designation', 'qualifications', 'signature');
    signatory = { id: `u${me.id}`, name: me.name, designation: me.designation, qualifications: me.qualifications, signature: me.signature, userId: me.id };
  }
  return db.transaction(async (trx) => {
    const unlocked = (d.data.unlocked ?? {}) as Record<string, boolean>;
    const date = unlocked.date ? String(d.date) : today();
    const client = await trx('clients').where({ id: d.client_id }).first();
    const number = d.number ? String(d.number) : (await nextNumber(trx, cid, d.kind, { date, client: client?.short_code, material: String(d.data.material ?? '') })).number;
    // NABL (NABL 133): one ULR per test report, given when it is issued. F = every test on it is within the
    // accredited scope, P = only some are. An amended report keeps the ULR of the report it replaces.
    let ulr: string | undefined;
    if (d.kind === 'report' && (d.accreditation ?? d.data.accreditation) === 'NABL') {
      const parent = d.parent_id ? await trx('documents').where({ id: d.parent_id, company_id: cid }).first('data') : null;
      ulr = String(parseJson<Record<string, unknown>>(parent?.data, {}).ulr ?? '') || undefined;
      if (!ulr) {
        const tids = (d.data.testIds as number[]) ?? [];
        const scope = tids.length ? (await trx('tests as t').leftJoin('catalog as c', 'c.id', 't.catalog_id').whereIn('t.id', tids).select('c.nabl')).map((r: { nabl: unknown }) => Boolean(r.nabl)) : [];
        ulr = (await nextNumber(trx, cid, 'ulr', { date, client: client?.short_code, fp: ulrScope(scope) })).number;
      }
    }
    const data = { ...d.data, ...(ulr ? { ulr, layout: setLayoutUlr(d.data.layout as never, ulr) } : {}), signatory: { name: signatory!.name, designation: signatory!.designation ?? '', qualifications: signatory!.qualifications ?? '', signature: signatory!.signature ?? null },
      issueText: unlocked.issueText ? d.data.issueText : formatDate(date), dateText: unlocked.dateText ? d.data.dateText : formatDate(date) };
    const hash = sha256({ data, overrides: d.overrides, template: d.template_id });
    await trx('documents').where({ id: d.id }).update({ number, date, status: 'issued', data: toJson(data), issued_at: now(), issued_by: req.user.id, hash, updated_at: now() });
    if (d.kind === 'report') {
      const tids = (d.data.testIds as number[]) ?? [];
      await trx('tests').whereIn('id', tids).update({ status: 'reported' });
      // results repeated from an earlier issued report keep their link to it (that report stays as issued)
      const keep = (await trx('tests as t').join('documents as o', 'o.id', 't.report_id').whereIn('t.id', tids).where('o.status', 'issued').whereNot('o.id', d.id)
        .modify((q) => { if (d.parent_id) q.whereNot('o.id', d.parent_id as number); }).select('t.id')).map((r: { id: number }) => r.id);
      await trx('tests').whereIn('id', tids.filter((x) => !keep.includes(x))).update({ report_id: d.id });
      // a sample is reported once all its tests are (28-day cubes may still be waiting)
      for (const sid of (d.data.sampleIds as number[]) ?? []) {
        const open = await trx('tests').where({ sample_id: sid }).whereNot('status', 'reported').first('id');
        if (!open) await trx('samples').where({ id: sid }).update({ status: 'reported' });
      }
      if (d.parent_id) await trx('documents').where({ id: d.parent_id }).update({ status: 'cancelled' });
    }
    await audit(trx, req.user, 'document', d.id, `${d.kind} signed and issued`, { number, ulr, hash: hash.slice(0, 12), signatory: signatory!.name });
    return { number, ulr };
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
  const body = z.object({
    to: z.string().min(3), cc: z.string().optional(), subject: z.string().min(1), body: z.string(), pdfBase64: z.string().optional(), filename: z.string().optional(),
    attachFileIds: z.array(z.number().int()).max(5).optional(),
  }).parse(req.body);
  if (!isEmailList(body.to)) throw new HttpError(400, 'To: enter valid email addresses separated by commas');
  if (body.cc && !isEmailList(body.cc)) throw new HttpError(400, 'Cc: enter valid email addresses separated by commas');
  const company = await getCompany(cid);
  let send;
  try { send = await mailer(company); } catch (e) { throw new HttpError(400, (e as Error).message); }
  const extra = body.attachFileIds?.length
    ? await db('files').where({ company_id: cid, entity: 'company' }).whereIn('id', body.attachFileIds).select('name', 'mime', 'data') : [];
  await send({
    to: body.to, cc: body.cc, subject: body.subject,
    text: `${body.body.trim()}\n\n${footerText(company, { kind: d.kind as string })}`.trim(),
    html: emailHtml(company, body.body, { kind: d.kind as string }),
    attachments: [
      ...(body.pdfBase64 ? [{ filename: body.filename || `${d.number || d.kind}.pdf`, content: Buffer.from(body.pdfBase64, 'base64'), contentType: 'application/pdf' }] : []),
      ...extra.map((f) => ({ filename: f.name, content: Buffer.from(String(f.data), 'base64'), contentType: f.mime })),
    ],
  });
  if (d.kind === 'quote' && d.status === 'draft') await db('documents').where({ id: d.id }).update({ status: 'sent', issued_at: now(), issued_by: req.user.id, hash: sha256(d.data) });
  await audit(db, req.user, 'document', d.id, 'emailed', { to: body.to, cc: body.cc, subject: body.subject, attachments: extra.map((f) => f.name) });
  return { ok: true };
}));
/** Preview of the branded footer that is added under every document email. */
finance.get('/email/footer', h(async (req) => {
  const company = await getCompany(req.user.company_id);
  return { text: footerText(company, { kind: String(req.query.kind ?? '') }), html: emailHtml(company, String(req.query.body ?? ''), { kind: String(req.query.kind ?? '') }) };
}));

// ---------- payments & ledger ----------
finance.get('/payments', allow('payment.read'), h(async (req) => db('payments as p').leftJoin('clients as c', 'c.id', 'p.client_id').where('p.company_id', req.user.company_id)
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
finance.post('/payments', allow('recordPayments'), h(async (req) => {
  const cid = req.user.company_id;
  const p = z.object({
    client_id: z.number(), date: isoDate, amount: z.number().positive('Amount must be more than zero'), tds: z.number().min(0, 'TDS cannot be negative').default(0), mode: z.string().min(1, 'Choose a payment mode'), reference: z.string().optional().nullable(),
    notes: z.string().optional().nullable(), allocations: z.array(z.object({ invoiceId: z.number(), amount: z.number().positive() })).default([]),
  }).parse(req.body);
  if (p.tds > p.amount) throw new HttpError(400, 'TDS cannot be more than the amount received');
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
        pos: data.placeOfSupplyName, received: paid.get(d.id) ?? 0, accreditation: d.accreditation, ulr: data.ulr, samples: data.jobCodeText, signatory: d.issuer, id: d.id };
    });
    columns = name === 'invoices'
      ? [{ key: 'number', label: 'Invoice no.' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'client', label: 'Client' }, { key: 'accreditation', label: 'Type' }, { key: 'gstin', label: 'GSTIN' }, { key: 'pos', label: 'Place of supply' },
        { key: 'taxable', label: 'Taxable', type: 'money' }, { key: 'cgst', label: 'CGST', type: 'money' }, { key: 'sgst', label: 'SGST', type: 'money' }, { key: 'igst', label: 'IGST', type: 'money' }, { key: 'total', label: 'Total', type: 'money' }, { key: 'received', label: 'Received', type: 'money' }, { key: 'status', label: 'Status' }]
      : name === 'reports'
        ? [{ key: 'number', label: 'Report no.' }, { key: 'date', label: 'Issue date', type: 'date' }, { key: 'accreditation', label: 'Type' }, { key: 'client', label: 'Client' }, { key: 'samples', label: 'Job code(s)' }, { key: 'ulr', label: 'ULR' }, { key: 'signatory', label: 'Signed by' }, { key: 'status', label: 'Status' }]
        : [{ key: 'number', label: 'Quotation no.' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'accreditation', label: 'Type' }, { key: 'client', label: 'Client' }, { key: 'site', label: 'Site / project' }, { key: 'total', label: 'Value', type: 'money' }, { key: 'status', label: 'Status' }];
  } else if (name === 'samples') {
    const s = await db('samples as s').leftJoin('clients as c', 'c.id', 's.client_id').leftJoin('sites as st', 'st.id', 's.site_id').where('s.company_id', cid).whereBetween('s.received_date', [from, to]).orderBy('s.id', 'desc')
      .select('s.*', 'c.name as client_name', 'st.name as site_name');
    const tests = s.length ? await db('tests as t').leftJoin('catalog as k', 'k.id', 't.catalog_id').whereIn('t.sample_id', s.map((x) => x.id)).select('t.sample_id', 'k.report_name', 'k.billing_name') : [];
    rows = s.map((x) => ({ id: x.id, code: x.code, ulr: x.ulr, accreditation: x.accreditation, received: x.received_date, client: x.client_name, site: x.site_name, material: x.material, description: x.description, quantity: x.quantity, condition: x.condition,
      tests: tests.filter((t) => t.sample_id === x.id).map((t) => t.report_name || t.billing_name).join(', '), status: x.status }));
    columns = [{ key: 'code', label: 'Job code' }, { key: 'accreditation', label: 'Type' }, { key: 'ulr', label: 'ULR' }, { key: 'received', label: 'Received', type: 'date' }, { key: 'client', label: 'Client' }, { key: 'site', label: 'Site' }, { key: 'material', label: 'Material' },
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
/** Notifications: mark one or more as read. A notification comes back if its situation changes (e.g. a new due date). */
finance.post('/notifications/read', h(async (req) => {
  const { refs } = z.object({ refs: z.array(z.string().max(120)).max(500) }).parse(req.body);
  for (const ref of refs) await db('notification_reads').insert({ user_id: req.user.id, ref, read_at: now() }).onConflict(['user_id', 'ref']).ignore();
  return { ok: true };
}));
finance.post('/notifications/unread', h(async (req) => {
  const { refs } = z.object({ refs: z.array(z.string().max(120)).max(500) }).parse(req.body);
  await db('notification_reads').where({ user_id: req.user.id }).whereIn('ref', refs).delete();
  return { ok: true };
}));

/** Invoice analytics: month-on-month, FY vs last FY, top customers, paid vs unpaid, ageing. Filters: fy, client, accreditation. */
finance.get('/invoices/analytics', allow('invoice.read'), h(async (req) => {
  const cid = req.user.company_id, td = today();
  const curFy = Number(td.slice(5, 7)) >= 4 ? Number(td.slice(0, 4)) : Number(td.slice(0, 4)) - 1;
  const q = z.object({ fy: z.coerce.number().int().min(2000).max(2100).optional(), client: z.coerce.number().int().optional(), accreditation: z.string().max(30).optional() }).parse(req.query);
  const fy = q.fy ?? curFy;
  const fyOf = (d: string) => (Number(d.slice(5, 7)) >= 4 ? Number(d.slice(0, 4)) : Number(d.slice(0, 4)) - 1);
  const iq = db('documents as d').leftJoin('clients as c', 'c.id', 'd.client_id').where({ 'd.company_id': cid, 'd.kind': 'invoice' }).whereIn('d.status', ['issued', 'paid', 'partly_paid'])
    .select('d.id', 'd.date', 'd.total', 'd.number', 'd.client_id', 'd.status', 'd.accreditation', 'c.name as client_name');
  if (q.client) iq.andWhere('d.client_id', q.client);
  if (q.accreditation) iq.andWhere('d.accreditation', q.accreditation);
  await restrictDocuments(req.user, iq);
  const inv: { id: number; date: string; total: number; number: string; client_id: number; status: string; accreditation: string | null; client_name: string | null }[] = await iq;
  const pays = await db('payments').where({ company_id: cid }).select('date', 'amount', 'tds', 'allocations', 'client_id');
  const paid = await paidAgainst(cid);
  const ids = new Set(inv.map((i) => i.id));
  const byId = new Map(inv.map((i) => [i.id, i]));
  // collections allocated to the invoices in scope (respects the client / accreditation filters)
  const coll: { date: string; amount: number; days: number }[] = [];
  for (const p of pays) for (const a of parseJson<{ invoiceId: number; amount: number }[]>(p.allocations, [])) if (ids.has(a.invoiceId)) {
    const i = byId.get(a.invoiceId)!; coll.push({ date: p.date, amount: Number(a.amount), days: Math.max(0, Math.round((Date.parse(p.date) - Date.parse(i.date)) / 86400000)) });
  }
  const FYM = Array.from({ length: 12 }, (_, k) => { const m = ((k + 3) % 12) + 1; return { m, label: new Date(Date.UTC(2000, m - 1, 1)).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }) }; });
  const ym = (y: number, m: number) => `${m >= 4 ? y : y + 1}-${String(m).padStart(2, '0')}`;
  const sumIn = (rows: { date: string }[], val: (r: any) => number, pred: (d: string) => boolean) => Math.round(rows.filter((r) => pred(r.date)).reduce((s, r) => s + val(r), 0));
  const T = (r: any) => Number(r.total), A = (r: any) => Number(r.amount);
  const monthly = FYM.map(({ m, label }) => ({ label, current: sumIn(inv, T, (d) => d.startsWith(ym(fy, m))), previous: sumIn(inv, T, (d) => d.startsWith(ym(fy - 1, m))), collected: sumIn(coll, A, (d) => d.startsWith(ym(fy, m))) }));
  const years = Array.from({ length: 5 }, (_, k) => fy - 4 + k).map((y) => ({ label: `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`, invoiced: sumIn(inv, T, (d) => fyOf(d) === y), collected: sumIn(coll, A, (d) => fyOf(d) === y) }));
  const inFy = inv.filter((i) => fyOf(i.date) === fy);
  // same period last year: up to the same date last year (or the whole year when looking at a past FY)
  const lyCut = `${Number(td.slice(0, 4)) - 1}-${td.slice(5)}`;
  const lastFyToDate = Math.round(inv.filter((i) => fyOf(i.date) === fy - 1 && (fy !== curFy || i.date <= lyCut)).reduce((s, i) => s + T(i), 0));
  const thisM = td.slice(0, 7), lastMDate = new Date(Date.UTC(Number(td.slice(0, 4)), Number(td.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const bal = (i: { id: number; total: number }) => Math.max(0, Number(i.total) - (paid.get(i.id) ?? 0));
  const status = { paid: { count: 0, amount: 0 }, partly: { count: 0, amount: 0, due: 0 }, unpaid: { count: 0, amount: 0 } };
  for (const i of inFy) { const b = bal(i); if (b <= 0.5) { status.paid.count++; status.paid.amount += T(i); } else if (b < T(i) - 0.5) { status.partly.count++; status.partly.amount += T(i); status.partly.due += b; } else { status.unpaid.count++; status.unpaid.amount += T(i); } }
  const top = new Map<string, { name: string; client_id: number; total: number; due: number; count: number }>();
  for (const i of inFy) { const k = String(i.client_id); const t = top.get(k) ?? { name: i.client_name ?? '—', client_id: i.client_id, total: 0, due: 0, count: 0 }; t.total += T(i); t.due += bal(i); t.count++; top.set(k, t); }
  const fyTotal = inFy.reduce((s, i) => s + T(i), 0);
  const open = inv.filter((i) => bal(i) > 0.5);
  const age = (d: string) => Math.floor((Date.now() - Date.parse(d + 'T00:00:00')) / 86400000);
  const fyColl = coll.filter((c) => fyOf(c.date) === fy);
  return {
    fy, currentFy: curFy, filters: q,
    kpis: {
      thisMonth: sumIn(inv, T, (d) => d.startsWith(thisM)), lastMonth: sumIn(inv, T, (d) => d.startsWith(lastMDate)),
      fyToDate: Math.round(fyTotal), lastFyToDate, collectedFy: Math.round(fyColl.reduce((s, c) => s + c.amount, 0)),
      outstanding: Math.round(open.reduce((s, i) => s + bal(i), 0)), overdue: Math.round(open.filter((i) => age(i.date) > 30).reduce((s, i) => s + bal(i), 0)),
      invoices: inFy.length, avgInvoice: inFy.length ? Math.round(fyTotal / inFy.length) : 0,
      avgDaysToPay: fyColl.length ? Math.round(fyColl.reduce((s, c) => s + c.days * c.amount, 0) / Math.max(1, fyColl.reduce((s, c) => s + c.amount, 0))) : null,
    },
    monthly, years,
    status: { paid: { ...status.paid, amount: Math.round(status.paid.amount) }, partly: { count: status.partly.count, amount: Math.round(status.partly.amount), due: Math.round(status.partly.due) }, unpaid: { ...status.unpaid, amount: Math.round(status.unpaid.amount) } },
    topClients: [...top.values()].sort((a, b) => b.total - a.total).slice(0, 10).map((t) => ({ ...t, total: Math.round(t.total), due: Math.round(t.due), share: fyTotal ? Math.round((t.total / fyTotal) * 1000) / 10 : 0 })),
    accreditation: ['NABL', 'Non-NABL'].map((k) => ({ label: k, amount: Math.round(inFy.filter((i) => (i.accreditation ?? 'Non-NABL') === k).reduce((s, i) => s + T(i), 0)) })),
    ageing: [['0–30 days', 0, 30], ['31–60 days', 31, 60], ['61–90 days', 61, 90], ['Over 90 days', 91, 1e9]].map(([label, a, b]) => ({ label: String(label), amount: Math.round(open.filter((i) => age(i.date) >= Number(a) && age(i.date) <= Number(b)).reduce((s, i) => s + bal(i), 0)) })),
    clients: [...new Map(inv.map((i) => [i.client_id, i.client_name ?? '—'])).entries()].map(([id, name]) => ({ value: String(id), label: name })).sort((a, b) => a.label.localeCompare(b.label)),
  };
}));

/** Home dashboard charts and KPIs: money for those who may see invoices, lab workload for those who may see samples. */
/**
 * Read-only turnaround figures for Home: of the tests whose report was issued in the last 30 days, how many
 * were issued on or before the test's due date; and the sample that has waited longest for its report.
 */
async function turnaround(cid: number) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const done = await db('tests as t').join('documents as d', 'd.id', 't.report_id')
    .where({ 't.company_id': cid, 'd.status': 'issued' }).andWhere('d.issued_at', '>=', since).whereNotNull('t.due_date').select('t.due_date', 'd.issued_at');
  const onTime = done.filter((r: { due_date: string; issued_at: string }) => String(r.issued_at).slice(0, 10) <= String(r.due_date).slice(0, 10)).length;
  const oldest = await db('samples').where({ company_id: cid }).whereNotIn('status', ['reported', 'cancelled']).whereNull('disposed_at')
    .orderBy('received_date', 'asc').first('code', 'received_date', 'material');
  const days = oldest?.received_date ? Math.max(0, Math.floor((Date.now() - new Date(String(oldest.received_date) + 'T00:00:00').getTime()) / 86400000)) : null;
  return {
    onTime: done.length ? { pct: Math.round((100 * onTime) / done.length), of: done.length } : null,
    oldest: oldest && days !== null ? { code: oldest.code as string, material: (oldest.material as string) ?? '', days } : null,
  };
}

finance.get('/dashboard/insights', h(async (req) => {
  const cid = req.user.company_id, td = today();
  const ym = (d: string) => d.slice(0, 7);
  const months: string[] = [];
  { const d = new Date(td + 'T00:00:00Z'); d.setUTCDate(1); for (let i = 11; i >= 0; i--) { const x = new Date(d); x.setUTCMonth(d.getUTCMonth() - i); months.push(x.toISOString().slice(0, 7)); } }
  const thisM = months[11], lastM = months[10], from = months[0] + '-01';
  const out: Record<string, unknown> = { months };
  if (can(req.user, 'invoice.read')) {
    const iq = db('documents as d').leftJoin('clients as c', 'c.id', 'd.client_id').where({ 'd.company_id': cid, 'd.kind': 'invoice' }).whereIn('d.status', ['issued', 'paid', 'partly_paid'])
      .select('d.id', 'd.date', 'd.total', 'd.number', 'd.client_id', 'c.name as client_name');
    await restrictDocuments(req.user, iq);
    const inv: { id: number; date: string; total: number; number: string; client_id: number; client_name: string | null }[] = await iq;
    const pays = can(req.user, 'payment.read') ? await db('payments').where({ company_id: cid }).andWhere('date', '>=', from).select('date', 'amount', 'tds') : [];
    const paid = await paidAgainst(cid);
    const byM = (rows: { date: string }[], val: (r: any) => number) => months.map((m) => Math.round(rows.filter((r) => ym(r.date) === m).reduce((a, r) => a + val(r), 0)));
    const invoiced = byM(inv, (r) => Number(r.total)), collected = byM(pays, (r) => Number(r.amount) + Number(r.tds || 0));
    const open = inv.map((i) => ({ ...i, balance: Number(i.total) - (paid.get(i.id) ?? 0) })).filter((i) => i.balance > 0.5);
    const age = (d: string) => Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000);
    const top = new Map<string, number>();
    for (const i of inv.filter((i) => i.date >= from)) top.set(i.client_name ?? '—', (top.get(i.client_name ?? '—') ?? 0) + Number(i.total));
    const total12 = invoiced.reduce((a, b) => a + b, 0);
    out.money = {
      invoiced, collected, invoicedThis: invoiced[11], invoicedLast: invoiced[10], collectedThis: collected[11], collectedLast: collected[10],
      outstanding: Math.round(open.reduce((a, i) => a + i.balance, 0)),
      overdue: Math.round(open.filter((i) => age(i.date) > 30).reduce((a, i) => a + i.balance, 0)),
      aging: [['0–30 days', 0, 30], ['31–60', 31, 60], ['61–90', 61, 90], ['90+', 91, 1e9]].map(([label, a, b]) => ({ label, amount: Math.round(open.filter((i) => age(i.date) >= (a as number) && age(i.date) <= (b as number)).reduce((s, i) => s + i.balance, 0)) })),
      topClients: [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, total]) => ({ name, total: Math.round(total), share: total12 ? Math.round((total / total12) * 1000) / 10 : 0 })),
    };
  }
  if (can(req.user, 'sample.read')) {
    const smp = await db('samples').where({ company_id: cid }).andWhere('received_date', '>=', from).select('received_date', 'material');
    const days: string[] = []; for (let i = 13; i >= 0; i--) days.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
    const tests = await db('tests').where({ company_id: cid }).whereNot('status', 'cancelled').select('status', 'created_at');
    const status: Record<string, number> = {};
    for (const t of tests) status[t.status] = (status[t.status] ?? 0) + 1;
    const mat = new Map<string, number>();
    const since90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    for (const s of smp.filter((s) => s.received_date >= since90)) mat.set(s.material || 'Other', (mat.get(s.material || 'Other') ?? 0) + 1);
    out.lab = {
      samplesThis: smp.filter((s) => ym(s.received_date) === thisM).length, samplesLast: smp.filter((s) => ym(s.received_date) === lastM).length,
      samplesByMonth: months.map((m) => smp.filter((s) => ym(s.received_date) === m).length),
      intake: days.map((d) => ({ day: d, count: smp.filter((s) => s.received_date === d).length })),
      testsByStatus: status, materials: [...mat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count })),
      testsThis: tests.filter((t) => String(t.created_at ?? '').slice(0, 7) === thisM).length, testsLast: tests.filter((t) => String(t.created_at ?? '').slice(0, 7) === lastM).length,
      ...(await turnaround(cid)),
    };
  }
  return out;
}));

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
  const reminders: { kind: string; text: string; link: string; level: 'info' | 'warning' | 'danger'; ref?: string }[] = [];
  const disposals = await db('samples as s').leftJoin('clients as c', 'c.id', 's.client_id').where('s.company_id', cid).whereNull('s.disposed_at').whereNotNull('s.dispose_after')
    .andWhere('s.dispose_after', '<=', td).select('s.id', 's.code', 's.dispose_after', 'c.name as client_name').orderBy('s.dispose_after').limit(30);
  for (const d of disposals) reminders.push({ kind: 'Sample disposal', text: `${d.code} (${d.client_name}) – retention ended ${formatDate(d.dispose_after)}. Dispose or return, then record it.`, link: `/samples?open=${d.id}`, level: 'info', ref: `dispose:${d.id}` });
  for (const t of tests.filter((t) => ['pending', 'in_progress', 'returned'].includes(t.status) && t.due_date && t.due_date <= td))
    reminders.push({ kind: 'Test due', text: `${t.report_name || t.billing_name} – ${t.code} (${t.client_name}) due ${formatDate(t.due_date)}`, link: `/tests/${t.id}`, level: t.due_date < td ? 'danger' : 'warning', ref: `due:test:${t.id}:${t.due_date}:${t.due_date < td ? 'late' : 'today'}` });
  for (const t of tests.filter((t) => t.status === 'returned')) reminders.push({ kind: 'Returned', text: `${t.report_name || t.billing_name} – ${t.code} needs correction`, link: `/tests/${t.id}`, level: 'warning', ref: `returned:test:${t.id}` });
  for (const q of quotes) {
    const days = Math.floor((Date.now() - new Date(q.date + 'T00:00:00').getTime()) / 86400000);
    if (days >= 7) reminders.push({ kind: 'Quote follow-up', text: `${q.number} to ${q.client_name} sent ${days} days ago`, link: `/documents/${q.id}`, level: 'info', ref: `quote:${q.id}:${Math.floor(days / 7)}` });
  }
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  for (const a of await db('audit_log').where({ company_id: cid, entity: 'user', entity_id: req.user.id, action: 'new device sign-in' }).andWhere('at', '>=', since).orderBy('id', 'desc').limit(3)) {
    const det = parseJson<Record<string, string>>(a.detail, {});
    reminders.push({ kind: 'New sign-in', text: `Your account signed in on ${det.device ?? 'a new device'} (${det.ip ?? ''}) ${new Date(a.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}. Not you? Change your password.`, link: '/account', level: 'warning', ref: `signin:${a.id}` });
  }
  for (const f of await followUpsDue(cid, req.user.id)) reminders.push({ kind: `${f.type} due`, text: `${f.subject}${f.client_name ? ` – ${f.client_name}` : ''} (${formatDate(f.due_date)})`, link: '/followups', level: f.due_date < td ? 'danger' : 'warning', ref: `followup:${f.id}:${f.due_date}` });
  for (const e of eq.filter((e) => e.due_date <= in30)) reminders.push({ kind: 'Calibration', text: `${e.name} calibration ${e.due_date < td ? 'expired' : 'due'} ${formatDate(e.due_date)}`, link: '/equipment', level: e.due_date < td ? 'danger' : 'warning', ref: `cal:${e.id}:${e.due_date}:${e.due_date < td ? 'expired' : 'due'}` });
  for (const o of due) {
    const days = Math.floor((Date.now() - new Date(o.date + 'T00:00:00').getTime()) / 86400000);
    if (days > 30 && o.balance > 0.5) reminders.push({ kind: 'Payment overdue', text: `Invoice ${o.number}: ₹${Math.round(o.balance).toLocaleString('en-IN')} outstanding for ${days} days`, link: `/documents/${o.id}`, level: 'danger', ref: `overdue:${o.id}:${Math.floor(days / 15)}` });
  }
  const reads = new Set((await db('notification_reads').where({ user_id: req.user.id }).whereIn('ref', reminders.map((r) => r.ref ?? '')).select('ref')).map((r: { ref: string }) => r.ref));
  const marked = reminders.map((r) => ({ ...r, read: reads.has(r.ref ?? '') }));
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
    reminders: marked,
    unread: marked.filter((r) => !r.read).length,
  };
}));
