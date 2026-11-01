import type { Knex } from 'knex';
import {
  BUILTIN_ROLES, DEFAULT_PICKLISTS, objectDef, fieldAccess, validateGstin,
  type FieldDef, type Layout, type Picklist, type RoleDef,
} from '@suite/shared';
import { db, insert, now, parseJson, toJson } from './db';
import { hashPassword } from './auth-hash';

export type MetaKind = 'picklist' | 'field' | 'layout' | 'role' | 'listview' | 'report' | 'dashboard';

export interface CompanyMeta {
  picklists: Picklist[]; fields: (FieldDef & { object: string })[]; layouts: Layout[]; roles: RoleDef[];
  listviews: { key: string; owner_id: number | null; data: any }[]; reports: { key: string; owner_id: number | null; data: any }[]; dashboards: { key: string; owner_id: number | null; data: any }[];
}

const cache = new Map<number, { at: number; meta: CompanyMeta }>();
export const invalidateMeta = (cid: number) => cache.delete(cid);

export async function getMeta(cid: number, k: Knex = db): Promise<CompanyMeta> {
  const c = cache.get(cid);
  if (c && Date.now() - c.at < 60_000) return c.meta;
  const rows = await k('meta').where({ company_id: cid });
  const by = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => ({ key: r.key as string, owner_id: r.owner_id as number | null, data: parseJson<any>(r.data, {}) }));
  const picklists = DEFAULT_PICKLISTS.map((p) => by('picklist').find((x) => x.key === p.key)?.data ?? p);
  for (const x of by('picklist')) if (!picklists.some((p) => p.key === x.key)) picklists.push(x.data);
  const roles = BUILTIN_ROLES.map((r) => { const saved = by('role').find((x) => x.key === r.key)?.data; return saved ? { ...r, ...saved, key: r.key, system: true, admin: r.admin } : r; });
  for (const x of by('role')) if (!roles.some((r) => r.key === x.key)) roles.push(x.data);
  const meta: CompanyMeta = {
    picklists, roles,
    fields: by('field').map((x) => x.data),
    layouts: by('layout').map((x) => x.data),
    listviews: by('listview'), reports: by('report'), dashboards: by('dashboard'),
  };
  cache.set(cid, { at: Date.now(), meta });
  return meta;
}

export async function getRole(cid: number, key: string): Promise<RoleDef> {
  const m = await getMeta(cid);
  return m.roles.find((r) => r.key === key) ?? BUILTIN_ROLES.find((r) => r.key === 'technician')!;
}

export async function saveMeta(cid: number, kind: MetaKind, key: string, data: unknown, ownerId: number | null = null) {
  const existing = await db('meta').where({ company_id: cid, kind, key }).first();
  if (existing) await db('meta').where({ id: existing.id }).update({ data: toJson(data), owner_id: ownerId ?? existing.owner_id, updated_at: now() });
  else await insert(db, 'meta', { company_id: cid, kind, key, data: toJson(data), owner_id: ownerId, updated_at: now() });
  invalidateMeta(cid);
}
export async function deleteMeta(cid: number, kind: MetaKind, key: string) {
  await db('meta').where({ company_id: cid, kind, key }).delete();
  invalidateMeta(cid);
}

/** All fields of an object: standard + admin-created custom fields. */
export async function objectFields(cid: number, object: string): Promise<FieldDef[]> {
  const m = await getMeta(cid);
  return [...(objectDef(object)?.fields ?? []), ...m.fields.filter((f) => f.object === object).map((f) => ({ ...f, custom: true }))];
}

/** Remove fields the user's role must not see (field-level security). */
export function stripHidden<T extends Record<string, any>>(role: RoleDef, object: string, rec: T): T {
  if (role.admin || !rec) return rec;
  const out: Record<string, any> = { ...rec };
  for (const [k, v] of Object.entries(role.fields)) {
    if (v !== 'hidden' || !k.startsWith(object + '.')) continue;
    const f = k.slice(object.length + 1);
    delete out[f];
    if (out.custom) { out.custom = { ...out.custom }; delete out.custom[f]; }
  }
  return out as T;
}

/** Validate and clean a write: blocks hidden/read-only fields, checks required and types of custom fields. */
export async function cleanWrite(cid: number, role: RoleDef, object: string, patch: Record<string, any>, opts: { creating: boolean }) {
  const fields = await objectFields(cid, object);
  const out: Record<string, any> = { ...patch };
  const custom: Record<string, unknown> = { ...(patch.custom ?? {}) };
  for (const f of fields) {
    const access = fieldAccess(role, object, f.key);
    const present = f.custom ? f.key in custom : f.key in out;
    if (present && access !== 'edit') { if (f.custom) delete custom[f.key]; else delete out[f.key]; continue; }
    if (f.custom && present) {
      const v = custom[f.key];
      if (v !== null && v !== '' && v !== undefined) {
        if ((f.type === 'number' || f.type === 'integer' || f.type === 'currency') && isNaN(Number(v))) throw new Error(`${f.label} must be a number`);
        if (f.type === 'integer') custom[f.key] = Math.round(Number(v));
      }
    }
    if (opts.creating && f.required && f.custom && (custom[f.key] === undefined || custom[f.key] === '' || custom[f.key] === null) && !role.admin) throw new Error(`${f.label} is required`);
  }
  if (out.gstin) { const g = validateGstin(out.gstin); if (!g.ok) throw new Error(g.message); }
  if ('custom' in patch || Object.keys(custom).length) out.custom = custom;
  return out;
}

/** Merge a cleaned `custom` object into a JSON data column value. */
export function mergeCustom(existingData: unknown, custom?: Record<string, unknown>) {
  const d = parseJson<Record<string, any>>(existingData, {}) ?? {};
  if (!custom) return d;
  return { ...d, custom: { ...(d.custom ?? {}), ...custom } };
}

/** Seed defaults for companies and make sure a System Administrator exists. */
export async function ensurePlatform(k: Knex = db) {
  const companies = await k('companies').select('id');
  for (const c of companies) {
    const admin = await k('users').where({ company_id: c.id, role: 'admin' }).first();
    if (admin) continue;
    const demo = await k('users').where({ company_id: c.id, email: 'owner@demo.lab' }).first();
    if (demo) {
      await insert(k, 'users', { company_id: c.id, name: 'System Admin', email: 'admin@demo.lab', password_hash: demo.password_hash, role: 'admin', designation: 'System Administrator', created_at: now() });
      console.log('System Administrator created: admin@demo.lab (same password as owner@demo.lab)');
    } else if (process.env.ADMIN_EMAIL) {
      const exists = await k('users').where({ email: process.env.ADMIN_EMAIL.toLowerCase() }).first();
      if (exists) await k('users').where({ id: exists.id }).update({ role: 'admin' });
      else await insert(k, 'users', { company_id: c.id, name: process.env.ADMIN_NAME || 'System Admin', email: process.env.ADMIN_EMAIL.toLowerCase(), password_hash: await hashPassword(process.env.ADMIN_PASSWORD || 'ChangeMe@123'), role: 'admin', created_at: now() });
    } else {
      const owner = await k('users').where({ company_id: c.id, role: 'owner' }).orderBy('id').first();
      if (owner) await k('users').where({ id: owner.id }).update({ role: 'admin' });
    }
  }
}
