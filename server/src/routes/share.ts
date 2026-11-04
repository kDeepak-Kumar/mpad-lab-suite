import { Router } from 'express';
import { z } from 'zod';
import { db, now } from '../db';
import { allow, h, HttpError, requireAuth } from '../auth';
import { audit, getCompany } from '../services';
import { canManageSharing, isShareObject, owd, recordAccess } from '../sharing';
import { parseJson, toJson } from '../db';

/** Owner, manual shares and organisation-wide defaults. */
export const share = Router();
share.use('/sharing', requireAuth);

const table = (o: string) => (o === 'client' ? 'clients' : 'documents');
async function load(cid: number, object: string, id: number) {
  if (!isShareObject(object)) throw new HttpError(400, 'Sharing is available for clients, quotations and invoices');
  const r = await db(table(object)).where({ id, company_id: cid }).modify((b) => { if (object !== 'client') b.andWhere('kind', object); }).first('id', 'owner_id');
  if (!r) throw new HttpError(404, 'Record not found');
  return r as { id: number; owner_id: number | null };
}

share.get('/sharing/defaults', h(async (req) => {
  const c = await getCompany(req.user.company_id);
  return { client: 'edit', quote: 'edit', invoice: 'edit', ...((c as any).sharing ?? {}) };
}));
share.put('/sharing/defaults', allow('manageCustomization'), h(async (req) => {
  const b = z.record(z.enum(['client', 'quote', 'invoice']), z.enum(['edit', 'read', 'private'])).parse(req.body);
  const row = await db('companies').where({ id: req.user.company_id }).first('data');
  const data = { ...parseJson<Record<string, unknown>>(row?.data, {}), sharing: b };
  await db('companies').where({ id: req.user.company_id }).update({ data: toJson(data) });
  await audit(db, req.user, 'company', req.user.company_id, 'changed sharing defaults', b);
  return b;
}));

share.get('/sharing/:object/:id', h(async (req) => {
  const { object } = req.params; const cid = req.user.company_id;
  const r = await load(cid, object, Number(req.params.id));
  const access = await recordAccess(req.user, object as never, r);
  if (access === 'none') throw new HttpError(404, 'Record not found');
  const users = await db('users').where({ company_id: cid, active: true }).select('id', 'name', 'role');
  const shares = await db('record_shares').where({ company_id: cid, object, record_id: r.id }).orderBy('id');
  const name = new Map(users.map((u) => [u.id, u.name]));
  return {
    owd: await owd(cid, object as never), access, canManage: canManageSharing(req.user, object as never, r),
    owner: r.owner_id ? { id: r.owner_id, name: name.get(r.owner_id) ?? 'Former user' } : null,
    shares: shares.map((s) => ({ id: s.id, user_id: s.user_id, role: s.role, access: s.access, name: s.user_id ? name.get(s.user_id) ?? 'Former user' : null })),
    users,
  };
}));
share.post('/sharing/:object/:id', h(async (req) => {
  const { object } = req.params; const cid = req.user.company_id;
  const r = await load(cid, object, Number(req.params.id));
  if (!canManageSharing(req.user, object as never, r)) throw new HttpError(403, 'Only the owner or an administrator can share this record');
  const b = z.object({ user_id: z.number().nullable().optional(), role: z.string().max(40).nullable().optional(), access: z.enum(['read', 'edit']) })
    .refine((x) => Boolean(x.user_id) !== Boolean(x.role), 'Choose a user or a role').parse(req.body);
  if (b.user_id && !(await db('users').where({ id: b.user_id, company_id: cid }).first('id'))) throw new HttpError(400, 'User not found');
  await db('record_shares').where({ company_id: cid, object, record_id: r.id }).andWhere(b.user_id ? { user_id: b.user_id } : { role: b.role }).delete();
  await db('record_shares').insert({ company_id: cid, object, record_id: r.id, user_id: b.user_id ?? null, role: b.role ?? null, access: b.access, created_by: req.user.id, created_at: now() });
  await audit(db, req.user, object === 'client' ? 'client' : 'document', r.id, 'shared', { with: b.user_id ? `user ${b.user_id}` : `role ${b.role}`, access: b.access });
  return { ok: true };
}));
share.delete('/sharing/:object/:id/:shareId', h(async (req) => {
  const { object } = req.params; const cid = req.user.company_id;
  const r = await load(cid, object, Number(req.params.id));
  if (!canManageSharing(req.user, object as never, r)) throw new HttpError(403, 'Only the owner or an administrator can change sharing');
  await db('record_shares').where({ id: Number(req.params.shareId), company_id: cid, record_id: r.id }).delete();
  return { ok: true };
}));
share.put('/sharing/:object/:id/owner', h(async (req) => {
  const { object } = req.params; const cid = req.user.company_id;
  const r = await load(cid, object, Number(req.params.id));
  if (!canManageSharing(req.user, object as never, r)) throw new HttpError(403, 'Only the owner or an administrator can change the owner');
  const { owner_id } = z.object({ owner_id: z.number() }).parse(req.body);
  const u = await db('users').where({ id: owner_id, company_id: cid, active: true }).first('id', 'name');
  if (!u) throw new HttpError(400, 'User not found');
  await db(table(object)).where({ id: r.id }).update({ owner_id });
  await audit(db, req.user, object === 'client' ? 'client' : 'document', r.id, 'owner changed', { to: u.name });
  return { ok: true };
}));

// ---------- favourites (per user: pages, records, list views, reports) ----------
share.use('/favorites', requireAuth);
share.get('/favorites', h(async (req) => db('favorites').where({ user_id: req.user.id }).orderBy([{ column: 'position' }, { column: 'id' }])));
share.post('/favorites', h(async (req) => {
  const b = z.object({ kind: z.enum(['page', 'client', 'document', 'listview', 'report', 'sample', 'workorder']), ref: z.string().min(1).max(200), label: z.string().min(1).max(200), sub: z.string().max(200).optional().nullable() }).parse(req.body);
  const n = await db('favorites').where({ user_id: req.user.id }).count({ n: 'id' }).first();
  if (Number(n?.n ?? 0) >= 40) throw new HttpError(400, 'You can keep up to 40 favourites. Remove some first.');
  const ex = await db('favorites').where({ user_id: req.user.id, kind: b.kind, ref: b.ref }).first('id');
  if (ex) { await db('favorites').where({ id: ex.id }).update({ label: b.label, sub: b.sub ?? null }); return { id: ex.id }; }
  const [id] = await db('favorites').insert({ ...b, sub: b.sub ?? null, user_id: req.user.id, position: Number(n?.n ?? 0), created_at: now() });
  return { id: Number(id) };
}));
share.delete('/favorites/:id', h(async (req) => { await db('favorites').where({ id: Number(req.params.id), user_id: req.user.id }).delete(); return { ok: true }; }));
share.put('/favorites/order', h(async (req) => {
  const { ids } = z.object({ ids: z.array(z.number()).max(100) }).parse(req.body);
  await db.transaction(async (trx) => { for (const [i, id] of ids.entries()) await trx('favorites').where({ id, user_id: req.user.id }).update({ position: i }); });
  return { ok: true };
}));
