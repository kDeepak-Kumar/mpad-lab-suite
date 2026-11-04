import type { Knex } from 'knex';
import type { Request, Response, NextFunction } from 'express';
import { type Owd } from '@suite/shared';
import { db } from './db';
import { can, isAdmin, type AuthUser } from './auth';
import { getCompany } from './services';

/**
 * Record-level security (Salesforce-style):
 * organisation-wide default per object → owner → manual shares (user or role) → View all / Modify all on the role.
 * Object-level (CRUD) and field-level security still apply on top of this.
 */
export type ShareObject = 'client' | 'quote' | 'invoice';
export const isShareObject = (o: string): o is ShareObject => o === 'client' || o === 'quote' || o === 'invoice';

export async function owd(cid: number, object: ShareObject): Promise<Owd> {
  const c = await getCompany(cid);
  return (((c as any).sharing ?? {}) as Record<string, Owd>)[object] ?? 'edit';
}
const perm = (u: AuthUser, object: string, p: 'viewAll' | 'modifyAll') => isAdmin(u) || Boolean((u.roleDef?.objects?.[object] as any)?.[p]) || (p === 'viewAll' && Boolean((u.roleDef?.objects?.[object] as any)?.modifyAll));

const sharedIds = (u: AuthUser, object: ShareObject, access?: 'edit') =>
  db('record_shares').where({ company_id: u.company_id, object }).andWhere((w) => w.where('user_id', u.id).orWhere('role', u.role))
    .modify((b) => { if (access) b.andWhere('access', 'edit'); }).select('record_id');

/**
 * Adds "only records this user may see" to a list query, or nothing when the object is public / the role has View all.
 * idCol / ownerCol are the columns in the query (e.g. 'c.id', 'c.owner_id').
 */
export async function restrictList(u: AuthUser, object: ShareObject, q: Knex.QueryBuilder, idCol: string, ownerCol: string) {
  if (perm(u, object, 'viewAll') || (await owd(u.company_id, object)) !== 'private') return;
  q.andWhere((w) => w.where(ownerCol, u.id).orWhereIn(idCol, sharedIds(u, object)));
}

/** Documents list mixes kinds: restrict only the private ones. */
export async function restrictDocuments(u: AuthUser, q: Knex.QueryBuilder) {
  const priv: ShareObject[] = [];
  for (const k of ['quote', 'invoice'] as const) if (!perm(u, k, 'viewAll') && (await owd(u.company_id, k)) === 'private') priv.push(k);
  if (!priv.length) return;
  q.andWhere((w) => {
    w.whereNotIn('d.kind', priv);
    for (const k of priv) w.orWhere((x) => x.where('d.kind', k).andWhere((y) => y.where('d.owner_id', u.id).orWhereIn('d.id', sharedIds(u, k))));
  });
}

/** What this user may do with one record: 'edit', 'read' or 'none'. */
export async function recordAccess(u: AuthUser, object: ShareObject, rec: { id: number; owner_id?: number | null }): Promise<'edit' | 'read' | 'none'> {
  if (perm(u, object, 'modifyAll') || rec.owner_id === u.id) return 'edit';
  const share = await db('record_shares').where({ company_id: u.company_id, object, record_id: rec.id }).andWhere((w) => w.where('user_id', u.id).orWhere('role', u.role)).select('access');
  const d = await owd(u.company_id, object);
  if (d === 'edit' || share.some((s) => s.access === 'edit')) return 'edit';
  if (d === 'read' || share.length || perm(u, object, 'viewAll')) return 'read';
  return 'none';
}

/** Middleware for /documents/:id/* – reading needs read access, anything else edit access (quotes and invoices only). */
export function guardDocument(req: Request, res: Response, next: NextFunction) {
  (async () => {
    const d = await db('documents').where({ id: Number(req.params.id), company_id: req.user.company_id }).first('id', 'kind', 'owner_id');
    if (!d || !isShareObject(d.kind)) return next();
    const a = await recordAccess(req.user, d.kind, d);
    if (a === 'none') return res.status(404).json({ error: 'Document not found or not shared with you' });
    if (req.method !== 'GET' && a !== 'edit' && !req.path.endsWith('/duplicate')) return res.status(403).json({ error: 'This record is read-only for you. Ask its owner to share it with edit access.' });
    next();
  })().catch(next);
}

/** Who may change owner / sharing: the owner, System Administrators and roles with Modify all. */
export const canManageSharing = (u: AuthUser, object: ShareObject, rec: { owner_id?: number | null }) =>
  isAdmin(u) || perm(u, object, 'modifyAll') || rec.owner_id === u.id || can(u, 'manageUsers');

/** In-memory version for small lists already loaded (e.g. a client's documents). */
export async function docVisibility(u: AuthUser) {
  const hidden: Record<string, Set<number> | null> = {};
  for (const k of ['quote', 'invoice'] as const) {
    if (perm(u, k, 'viewAll') || (await owd(u.company_id, k)) !== 'private') { hidden[k] = null; continue; }
    hidden[k] = new Set((await sharedIds(u, k)).map((r: { record_id: number }) => r.record_id));
  }
  return (d: { id: number; kind: string; owner_id?: number | null }) => { const s = hidden[d.kind]; return !s || d.owner_id === u.id || s.has(d.id); };
}
