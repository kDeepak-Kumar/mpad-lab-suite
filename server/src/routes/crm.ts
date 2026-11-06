import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { formatDate } from '@suite/shared';
import { db, insert, now, parseJson, row, today } from '../db';
import { h, HttpError, isAdmin, requireAuth, zBool } from '../auth';
import { moveToBin } from '../recycle';
import { audit, getCompany, getDocTemplate, sha256 } from '../services';

/**
 * CRM follow-ups (calls, visits, emails, tasks) linked to clients and documents,
 * and public verification of issued test reports by QR code.
 */

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
/** Verification token for an issued report: id + HMAC over id and content hash, so it cannot be guessed or reused after an amendment. */
export const verifyToken = (id: number, hash: string) => `${id}-${crypto.createHmac('sha256', SECRET).update(`report:${id}:${hash}`).digest('base64url').slice(0, 16)}`;

/** Share link for a document sent on WhatsApp: id + HMAC, so links cannot be guessed. */
export const shareToken = (id: number, createdAt: string) => `${id}-${crypto.createHmac('sha256', SECRET).update(`share:${id}:${createdAt}`).digest('base64url').slice(0, 18)}`;
/** Documents that may be opened by link: quotations (not drafts once cancelled), issued invoices and issued reports. */
export const shareable = (d: { kind: string; status: string; number?: string | null }) =>
  Boolean(d.number) && (d.kind === 'quote' ? d.status !== 'cancelled' : d.kind === 'invoice' ? ['issued', 'partly_paid', 'paid'].includes(d.status) : d.kind === 'report' ? ['issued', 'cancelled'].includes(d.status) : false);
/** Settings that never leave the server on a public page. */
const PRIVATE_KEYS = ['ai', 'smtp', 'alerts', 'security', 'numbering', 'whatsapp', 'emailFooter', 'signatories', 'loginHighlights'];

// ---------- public (no sign-in) ----------
export const publicApi = Router();
publicApi.get('/public/doc/:token', h(async (req) => {
  const id = Number(String(req.params.token).split('-')[0]);
  const raw = Number.isFinite(id) ? await db('documents').where({ id }).first() : null;
  if (!raw || shareToken(raw.id, String(raw.created_at)) !== req.params.token || !shareable(raw)) throw new HttpError(404, 'This link is not valid any more. Please ask the laboratory for a fresh link.');
  const d = row(raw, ['data', 'overrides', 'totals']) as Record<string, any>;
  const full = await getCompany(d.company_id);
  const company: Record<string, unknown> = { ...full };
  for (const k of PRIVATE_KEYS) delete company[k];
  const tpl = await getDocTemplate(d.company_id, d.kind, d.template_id);
  const snap = d.data.signatory;
  const issuer = snap?.name ? snap : d.issued_by ? await db('users').where({ id: d.issued_by }).first('name', 'designation', 'qualifications', 'signature') : null;
  // Note the first opening per day, so the team sees in History and Follow-ups that the client looked at it.
  const day = today();
  const seen = await db('audit_log').where({ company_id: d.company_id, entity: 'document', entity_id: d.id, action: 'opened from shared link' }).andWhere('at', '>=', day).first('id');
  if (!seen) await db('audit_log').insert({ company_id: d.company_id, user_id: null, entity: 'document', entity_id: d.id, action: 'opened from shared link', detail: JSON.stringify({ ip: req.ip }), at: now() });
  const replaced = d.status === 'cancelled' ? await db('documents').where({ parent_id: d.id }).whereNot('status', 'cancelled').first('number') : null;
  return {
    kind: d.kind, number: d.number, status: d.status, date: d.date, data: d.data, overrides: d.overrides ?? {}, totals: d.totals, company, issuer,
    template: tpl?.definition ?? null, verify: d.kind === 'report' && d.hash ? verifyToken(d.id, d.hash) : null, replacedBy: replaced?.number ?? null,
  };
}));
publicApi.get('/public/verify/:token', h(async (req) => {
  const [idPart] = String(req.params.token).split('-');
  const id = Number(idPart);
  const d = Number.isFinite(id) ? await db('documents').where({ id, kind: 'report' }).first() : null;
  if (!d || !d.hash || verifyToken(d.id, d.hash) !== req.params.token) throw new HttpError(404, 'No issued report matches this code. The report may be altered or not issued by this laboratory.');
  const data = parseJson<Record<string, any>>(d.data, {});
  const company = await getCompany(d.company_id);
  const client = await db('clients').where({ id: d.client_id }).first('name');
  const replaced = d.status === 'cancelled' ? await db('documents').where({ parent_id: d.id }).whereNot('status', 'cancelled').first('number') : null;
  return {
    lab: company.name, accreditation: company.accreditation?.certNo ?? null,
    number: d.number, issued: formatDate(d.date), status: d.status === 'issued' ? 'Valid' : d.status === 'cancelled' ? 'Withdrawn (amended)' : d.status,
    replacedBy: replaced?.number ?? null, client: data.client?.name || client?.name || '', ulr: data.ulr ?? '', jobCode: data.jobCodeText ?? '',
    tests: [...new Set(((data.rows ?? []) as { group?: string; name: string }[]).map((r) => r.group || r.name))],
  };
}));

// ---------- follow-ups ----------
export const crm = Router();
crm.use(requireAuth);
const TYPES = ['Call', 'Visit', 'Email', 'WhatsApp', 'Meeting', 'Task', 'Note'] as const;

crm.get('/activities', h(async (req) => {
  const cid = req.user.company_id;
  const q = db('activities as a').leftJoin('clients as c', 'c.id', 'a.client_id').leftJoin('users as u', 'u.id', 'a.assigned_to').leftJoin('users as b', 'b.id', 'a.created_by')
    .where('a.company_id', cid).select('a.*', 'c.name as client_name', 'u.name as assignee', 'b.name as created_by_name');
  if (req.query.client_id) q.andWhere('a.client_id', Number(req.query.client_id));
  if (req.query.link_kind && req.query.link_id) q.andWhere({ 'a.link_kind': String(req.query.link_kind), 'a.link_id': Number(req.query.link_id) });
  if (req.query.mine === '1') q.andWhere('a.assigned_to', req.user.id);
  if (req.query.open === '1') q.whereNull('a.done_at');
  return q.orderByRaw('CASE WHEN a.done_at IS NULL THEN 0 ELSE 1 END').orderBy([{ column: 'a.due_date', order: 'asc' }, { column: 'a.id', order: 'desc' }]).limit(500);
}));

const actSchema = z.object({
  type: z.enum(TYPES), subject: z.string().min(2).max(300), notes: z.string().max(5000).optional().nullable(),
  client_id: z.number().nullable().optional(), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  assigned_to: z.number().nullable().optional(), link_kind: z.string().max(20).nullable().optional(), link_id: z.number().nullable().optional(),
  done: zBool.optional(), outcome: z.string().max(300).nullable().optional(),
});
crm.post('/activities', h(async (req) => {
  const cid = req.user.company_id;
  const b = actSchema.parse(req.body);
  if (b.client_id && !(await db('clients').where({ id: b.client_id, company_id: cid }).first())) throw new HttpError(400, 'Client not found');
  const { done, ...rest } = b;
  const id = await insert(db, 'activities', { ...rest, company_id: cid, assigned_to: b.assigned_to ?? req.user.id, created_by: req.user.id, done_at: done || b.type === 'Note' ? now() : null, created_at: now() });
  await audit(db, req.user, 'activity', id, `${b.type.toLowerCase()} logged`, { subject: b.subject });
  return { id };
}));
crm.put('/activities/:id', h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id);
  const a = await db('activities').where({ id, company_id: cid }).first();
  if (!a) throw new HttpError(404, 'Follow-up not found');
  const b = actSchema.partial().parse(req.body);
  const { done, ...rest } = b;
  await db('activities').where({ id }).update({ ...rest, ...(done === undefined ? {} : { done_at: done ? now() : null }) });
  return { ok: true };
}));
crm.delete('/activities/:id', h(async (req) => {
  const a = await db('activities').where({ id: Number(req.params.id), company_id: req.user.company_id }).first('id', 'created_by');
  if (!a || (a.created_by !== req.user.id && !isAdmin(req.user))) throw new HttpError(403, 'Only the person who created a follow-up can delete it');
  await moveToBin(req.user, 'activity', a.id);
  return { ok: true };
}));

// ---------- WhatsApp ----------
/** Records a WhatsApp message as a completed CRM activity (and marks a draft quotation as sent). */
crm.post('/whatsapp/log', h(async (req) => {
  const cid = req.user.company_id;
  const b = z.object({
    client_id: z.number().nullable().optional(), phone: z.string().max(40).optional().nullable(), contact: z.string().max(120).optional().nullable(),
    template: z.string().max(40), message: z.string().max(4000), link_kind: z.string().max(20).nullable().optional(), link_id: z.number().nullable().optional(),
    subject: z.string().max(300).optional(),
  }).parse(req.body);
  if (b.client_id && !(await db('clients').where({ id: b.client_id, company_id: cid }).first())) throw new HttpError(400, 'Client not found');
  let doc: Record<string, any> | undefined;
  if (b.link_kind && b.link_id && ['quote', 'invoice', 'report'].includes(b.link_kind)) {
    doc = await db('documents').where({ id: b.link_id, company_id: cid }).first();
    if (!doc) throw new HttpError(404, 'Document not found');
  }
  const subject = b.subject || `WhatsApp: ${b.template}${doc?.number ? ` – ${doc.number}` : ''}${b.contact ? ` to ${b.contact}` : ''}`;
  const id = await insert(db, 'activities', {
    company_id: cid, client_id: b.client_id ?? doc?.client_id ?? null, type: 'WhatsApp', subject: subject.slice(0, 300), notes: `${b.phone ? `To +${b.phone}\n\n` : ''}${b.message}`.slice(0, 5000),
    assigned_to: req.user.id, created_by: req.user.id, link_kind: b.link_kind ?? null, link_id: b.link_id ?? null, done_at: now(), created_at: now(), outcome: 'Sent',
  });
  if (doc) {
    if (doc.kind === 'quote' && doc.status === 'draft') {
      await db('documents').where({ id: doc.id }).update({ status: 'sent', issued_at: now(), issued_by: req.user.id, hash: sha256(parseJson(doc.data, {})) });
      await scheduleQuoteFollowUp(cid, req.user.id, { id: doc.id, number: doc.number, client_id: doc.client_id });
    }
    await audit(db, req.user, 'document', doc.id, 'shared on WhatsApp', { to: b.phone ? `+${b.phone}` : 'chosen in WhatsApp', template: b.template });
  }
  return { id };
}));

/** Automatic follow-up when a quotation is sent: call the client after the given days. */
export async function scheduleQuoteFollowUp(cid: number, userId: number, quote: { id: number; number: string | null; client_id: number }, days = 3) {
  const exists = await db('activities').where({ company_id: cid, link_kind: 'quote', link_id: quote.id }).first();
  if (exists) return;
  const due = new Date(Date.now() + days * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  await insert(db, 'activities', { company_id: cid, client_id: quote.client_id, type: 'Call', subject: `Follow up on quotation ${quote.number ?? ''}`.trim(), due_date: due, assigned_to: userId, created_by: userId, link_kind: 'quote', link_id: quote.id, created_at: now() });
}

export const followUpsDue = (cid: number, userId: number) =>
  db('activities as a').leftJoin('clients as c', 'c.id', 'a.client_id').where({ 'a.company_id': cid, 'a.assigned_to': userId }).whereNull('a.done_at').whereNotNull('a.due_date').andWhere('a.due_date', '<=', today())
    .select('a.id', 'a.type', 'a.subject', 'a.due_date', 'c.name as client_name');
