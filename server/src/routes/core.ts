import { storageInfo } from '../storage';
import { collectAlerts, runAlerts, type AlertSettings } from '../alerts';
import { Router } from 'express';
import { z } from 'zod';
import { DEFAULT_TEMPLATES, isIsoDate, type DocKind } from '@suite/shared';
import { db, insert, now, parseJson, row, toJson } from '../db';
import { allow, can, checkPassword, clearSession, h, hashPassword, HttpError, isAdmin, requireAuth, setSession } from '../auth';
import { audit, getCompany, ledger } from '../services';
import { cleanWrite, deleteMeta, getMeta, mergeCustom, saveMeta, stripHidden, type MetaKind } from '../meta';

export const core = Router();

// ---------- auth ----------
core.use(requireAuth);

core.get('/auth/me', h(async (req) => {
  const company = await getCompany(req.user.company_id);
  const { roleDef, ...user } = req.user;
  const u = await db('users').where({ id: req.user.id }).first('totp_enabled');
  return { user, role: roleDef, company: { id: company.id, name: company.name, stateCode: company.stateCode, logo: company.logo }, security: { totpEnabled: Boolean(u?.totp_enabled), required: Boolean((company as any).security?.require2fa) } };
}));

// ---------- email alerts (SLA / calibration) ----------
core.get('/alerts/preview', allow('settings'), h(async (req) => {
  const company = await getCompany(req.user.company_id);
  return collectAlerts(req.user.company_id, (company.alerts ?? {}) as AlertSettings);
}));
core.get('/system/storage', allow('settings'), h(async () => storageInfo()));
core.post('/alerts/run', allow('settings'), h(async (req) => {
  try { return await runAlerts(req.user.company_id, { force: true }); } catch (e) { throw new HttpError(400, (e as Error).message); }
}));

// ---------- company settings ----------
const maskCompany = (c: Record<string, any>) => ({ ...c, ai: c.ai ? { ...c.ai, apiKey: undefined, hasKey: Boolean(c.ai.apiKey) } : undefined });
core.get('/company', h(async (req) => maskCompany(await getCompany(req.user.company_id))));
core.put('/company', allow('settings'), h(async (req) => {
  const cur = await getCompany(req.user.company_id);
  const body = { ...req.body };
  if (body.ai) body.ai = { ...body.ai, apiKey: body.ai.apiKey ? body.ai.apiKey : cur.ai && (cur.ai as any).apiKey, hasKey: undefined };
  const { id: _i, name, ...data } = { ...cur, ...body };
  await db('companies').where({ id: req.user.company_id }).update({ name, data: toJson(data) });
  await audit(db, req.user, 'company', req.user.company_id, 'updated settings');
  return maskCompany(await getCompany(req.user.company_id));
}));

// ---------- metadata (picklists, custom fields, layouts, roles, list views, reports, dashboards) ----------
core.get('/meta', h(async (req) => {
  const m = await getMeta(req.user.company_id);
  const mine = (x: { owner_id: number | null }) => x.owner_id === null || x.owner_id === req.user.id;
  return { ...m, listviews: m.listviews.filter(mine), reports: m.reports.filter(mine), dashboards: m.dashboards.filter(mine) };
}));
const PERSONAL: MetaKind[] = ['listview', 'report', 'dashboard'];
core.put('/meta/:kind/:key', h(async (req) => {
  const kind = req.params.kind as MetaKind;
  if (!['picklist', 'field', 'layout', 'role', 'listview', 'report', 'dashboard'].includes(kind)) throw new HttpError(400, 'Unknown metadata type');
  const shared = Boolean(req.body?.shared);
  if (!PERSONAL.includes(kind) || shared) if (!can(req.user, 'manageCustomization')) throw new HttpError(403, 'Only administrators can change this');
  if (kind === 'role' && req.params.key === 'admin') throw new HttpError(400, 'The System Administrator role cannot be changed');
  if (kind === 'field' && !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(req.params.key)) throw new HttpError(400, 'Field key must look like object.field_name (lowercase)');
  const { shared: _s, ...data } = req.body ?? {};
  await saveMeta(req.user.company_id, kind, req.params.key, data, PERSONAL.includes(kind) && !shared ? req.user.id : null);
  await audit(db, req.user, 'meta', 0, `${kind} ${req.params.key} saved`);
  return { ok: true };
}));
core.delete('/meta/:kind/:key', h(async (req) => {
  const kind = req.params.kind as MetaKind;
  const row0 = await db('meta').where({ company_id: req.user.company_id, kind, key: req.params.key }).first();
  if (!row0) return { ok: true };
  if (!(row0.owner_id === req.user.id) && !can(req.user, 'manageCustomization')) throw new HttpError(403, 'Only administrators can delete this');
  if (kind === 'role' && await db('users').where({ company_id: req.user.company_id, role: req.params.key }).first()) throw new HttpError(409, 'Some users still have this role. Move them to another role first.');
  await deleteMeta(req.user.company_id, kind, req.params.key);
  await audit(db, req.user, 'meta', 0, `${kind} ${req.params.key} deleted`);
  return { ok: true };
}));

// ---------- users ----------
core.get('/users', h(async (req) => db('users').where({ company_id: req.user.company_id })
  .select('id', 'name', 'email', 'role', 'designation', 'qualifications', 'phone', 'active', 'signature', 'totp_enabled')));
const userSchema = z.object({
  name: z.string().min(1), email: z.string().email(), role: z.string(), designation: z.string().optional().nullable(),
  qualifications: z.string().optional().nullable(), phone: z.string().optional().nullable(), signature: z.string().optional().nullable(),
  active: z.boolean().optional(), password: z.string().min(8, 'Password must be at least 8 characters').optional(),
});
async function checkRoleAssign(req: Express.Request & { user: any }, role?: string) {
  if (!role) return;
  const m = await getMeta(req.user.company_id);
  if (!m.roles.some((r) => r.key === role)) throw new HttpError(400, 'Unknown role');
  if (role === 'admin' && !isAdmin(req.user)) throw new HttpError(403, 'Only a System Administrator can create another System Administrator');
}
core.post('/users', allow('users'), h(async (req) => {
  const { password, ...u } = userSchema.parse(req.body);
  await checkRoleAssign(req as never, u.role);
  if (!password) throw new HttpError(400, 'Set an initial password (6+ characters)');
  const id = await insert(db, 'users', { ...u, email: u.email.toLowerCase(), company_id: req.user.company_id, password_hash: await hashPassword(password), created_at: now() });
  await audit(db, req.user, 'user', id, 'created', { email: u.email, role: u.role });
  return { id };
}));
core.put('/users/:id', h(async (req) => {
  const id = Number(req.params.id);
  const manager = can(req.user, 'manageUsers');
  if (!manager && req.user.id !== id) throw new HttpError(403, 'You can only edit your own profile');
  const { password, ...u } = userSchema.partial().parse(req.body);
  if (!manager) { delete u.role; delete u.active; }
  const target = await db('users').where({ id, company_id: req.user.company_id }).first();
  if (target?.role === 'admin' && !isAdmin(req.user)) throw new HttpError(403, 'Only a System Administrator can change another System Administrator');
  await checkRoleAssign(req as never, u.role);
  const patch: Record<string, unknown> = { ...u };
  if (u.email) patch.email = u.email.toLowerCase();
  if (password) patch.password_hash = await hashPassword(password);
  await db('users').where({ id, company_id: req.user.company_id }).update(patch);
  await audit(db, req.user, 'user', id, 'updated', { fields: Object.keys(patch).filter((k) => k !== 'password_hash' && k !== 'signature') });
  return { ok: true };
}));

// ---------- clients, sites, contacts (with custom fields and field-level security) ----------
const withCustom = (r: Record<string, any>, jsonCols: string[] = ['data']) => { const out = row(r, jsonCols) as Record<string, any>; return { ...out, custom: (out.data ?? {}).custom ?? {} }; };
const custom = z.record(z.any()).optional();
const isoDateOpt = z.string().refine((v) => v === '' || isIsoDate(v), 'must be a valid date').optional().nullable().transform((v) => v || null);
const clientSchema = z.object({
  name: z.string().min(1), short_code: z.string().max(20).optional().nullable(), type: z.string().optional().nullable(),
  gstin: z.string().optional().nullable(), state_code: z.string().optional().nullable(), pan: z.string().optional().nullable(),
  address: z.string().optional().nullable(), email: z.string().optional().nullable(), phone: z.string().optional().nullable(),
  payment_terms_days: z.coerce.number().int().min(0).max(365).optional().nullable(), opening_balance: z.coerce.number().optional().nullable(), notes: z.string().optional().nullable(),
  discount_pct: z.coerce.number().min(0, 'Discount cannot be negative').max(100, 'Discount cannot exceed 100%').optional().nullable(), custom,
});
function normaliseClient(c: Record<string, any>) {
  const out = { ...c };
  if (out.gstin) { out.gstin = String(out.gstin).trim().toUpperCase(); out.state_code = out.gstin.slice(0, 2); out.pan = out.pan || out.gstin.slice(2, 12); }
  if (out.gstin === '') out.gstin = null;
  if (out.short_code) out.short_code = String(out.short_code).toUpperCase();
  return out;
}
const split = (c: Record<string, any>) => { const { custom: cu, ...rest } = c; return { rest, cu: cu as Record<string, unknown> | undefined }; };

core.get('/clients', allow('client.read'), h(async (req) => {
  const q = String(req.query.q ?? '').trim();
  const rows = await db('clients').where({ company_id: req.user.company_id })
    .modify((b) => { if (q) b.andWhere((w) => w.whereLike('name', `%${q}%`).orWhereLike('gstin', `%${q}%`).orWhereLike('short_code', `%${q}%`)); })
    .orderBy('name').limit(5000);
  const sites = await db('sites').where({ company_id: req.user.company_id }).select('client_id').count({ n: 'id' }).groupBy('client_id');
  const sc = new Map((sites as { client_id: number; n: number }[]).map((s) => [s.client_id, Number(s.n)]));
  return rows.map((r: Record<string, any>) => stripHidden(req.user.roleDef, 'client', { ...withCustom(r), sites: sc.get(r.id) ?? 0 }));
}));
core.post('/clients', allow('client.create'), h(async (req) => {
  const c = normaliseClient(await cleanWrite(req.user.company_id, req.user.roleDef, 'client', clientSchema.parse(req.body), { creating: true }));
  const dup = await db('clients').where({ company_id: req.user.company_id }).andWhere((w) => {
    w.whereRaw('LOWER(name) = ?', [String(c.name).toLowerCase()]); if (c.gstin) w.orWhere('gstin', c.gstin);
  }).first();
  if (dup && !req.query.force) throw new HttpError(409, `A client "${dup.name}" with the same name or GSTIN already exists`);
  const { rest, cu } = split(c);
  const id = await insert(db, 'clients', { ...rest, data: toJson(mergeCustom(null, cu)), company_id: req.user.company_id, created_at: now() });
  await audit(db, req.user, 'client', id, 'created', { name: c.name });
  return { id };
}));
core.get('/clients/:id', allow('client.read'), h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id), role = req.user.roleDef;
  const raw = await db('clients').where({ id, company_id: cid }).first();
  if (!raw) throw new HttpError(404, 'Client not found');
  const c = stripHidden(role, 'client', withCustom(raw));
  const [sites, contacts, docs, workOrders, samples, led] = await Promise.all([
    db('sites').where({ client_id: id, company_id: cid }).orderBy('name'),
    db('contacts').where({ client_id: id, company_id: cid }).orderBy('name'),
    db('documents').where({ client_id: id, company_id: cid }).orderBy('id', 'desc').select('id', 'kind', 'number', 'status', 'date', 'total', 'site_id', 'accreditation'),
    db('work_orders').where({ client_id: id, company_id: cid }).orderBy('id', 'desc'),
    db('samples').where({ client_id: id, company_id: cid }).orderBy('id', 'desc').select('id', 'code', 'material', 'received_date', 'status', 'site_id', 'accreditation'),
    ledger(cid, id),
  ]);
  const timeline = await db('audit_log').where({ company_id: cid }).andWhere((w) => {
    w.where({ entity: 'client', entity_id: id })
      .orWhere((x) => x.where('entity', 'document').whereIn('entity_id', docs.map((d) => d.id)))
      .orWhere((x) => x.where('entity', 'sample').whereIn('entity_id', samples.map((s) => s.id)));
  }).orderBy('id', 'desc').limit(50);
  const users = new Map((await db('users').where({ company_id: cid }).select('id', 'name')).map((u) => [u.id, u.name]));
  return { ...c, sites: sites.map((x) => stripHidden(role, 'site', withCustom(x))), contacts: contacts.map((x) => stripHidden(role, 'contact', withCustom(x, ['data', 'receives']))),
    documents: docs.map((d) => ({ ...d, total: Number(d.total) })), workOrders, samples, ledger: led,
    timeline: timeline.map((t) => ({ ...row(t, ['detail']), user: users.get(t.user_id) })) };
}));
core.put('/clients/:id', allow('client.edit'), h(async (req) => {
  const id = Number(req.params.id);
  const ex = await db('clients').where({ id, company_id: req.user.company_id }).first();
  if (!ex) throw new HttpError(404, 'Client not found');
  const c = normaliseClient(await cleanWrite(req.user.company_id, req.user.roleDef, 'client', clientSchema.partial().parse(req.body), { creating: false }));
  const { rest, cu } = split(c);
  await db('clients').where({ id }).update({ ...rest, data: toJson(mergeCustom(ex.data, cu)) });
  await audit(db, req.user, 'client', id, 'updated', { fields: Object.keys(rest) });
  return { ok: true };
}));
core.delete('/clients/:id', allow('client.delete'), h(async (req) => {
  const id = Number(req.params.id), cid = req.user.company_id;
  const used = await db('documents').where({ client_id: id, company_id: cid }).first() || await db('samples').where({ client_id: id, company_id: cid }).first();
  if (used) throw new HttpError(409, 'This client has quotations, samples or invoices and cannot be deleted');
  await db('contacts').where({ client_id: id, company_id: cid }).delete();
  await db('sites').where({ client_id: id, company_id: cid }).delete();
  await db('clients').where({ id, company_id: cid }).delete();
  await audit(db, req.user, 'client', id, 'deleted');
  return { ok: true };
}));

const siteSchema = z.object({ name: z.string().trim().min(1, 'Site name is required'), address: z.string().optional().nullable(), project: z.string().optional().nullable(), po_number: z.string().optional().nullable(), state_code: z.string().optional().nullable(),
  discount_pct: z.coerce.number().min(0, 'Discount cannot be negative').max(100, 'Discount cannot exceed 100%').optional().nullable(), custom });
core.post('/clients/:id/sites', allow('client.edit'), h(async (req) => {
  const { rest, cu } = split(await cleanWrite(req.user.company_id, req.user.roleDef, 'site', siteSchema.parse(req.body), { creating: true }));
  const id = await insert(db, 'sites', { ...rest, data: toJson(mergeCustom(null, cu)), client_id: Number(req.params.id), company_id: req.user.company_id, created_at: now() });
  await audit(db, req.user, 'client', Number(req.params.id), 'site added', { site: rest.name });
  return { id };
}));
core.put('/sites/:id', allow('client.edit'), h(async (req) => {
  const ex = await db('sites').where({ id: Number(req.params.id), company_id: req.user.company_id }).first();
  if (!ex) throw new HttpError(404, 'Site not found');
  const { rest, cu } = split(await cleanWrite(req.user.company_id, req.user.roleDef, 'site', siteSchema.partial().parse(req.body), { creating: false }));
  await db('sites').where({ id: ex.id }).update({ ...rest, data: toJson(mergeCustom(ex.data, cu)) });
  return { ok: true };
}));
core.delete('/sites/:id', allow('client.delete'), h(async (req) => {
  const id = Number(req.params.id), cid = req.user.company_id;
  if (await db('samples').where({ site_id: id, company_id: cid }).first() || await db('documents').where({ site_id: id, company_id: cid }).first()) throw new HttpError(409, 'This site is used on samples or documents');
  await db('sites').where({ id, company_id: cid }).delete();
  return { ok: true };
}));
const contactSchema = z.object({ name: z.string().min(1), role: z.string().optional().nullable(), phone: z.string().optional().nullable(), email: z.string().optional().nullable(), site_id: z.coerce.number().optional().nullable(), receives: z.array(z.string()).optional(), custom });
core.post('/clients/:id/contacts', allow('client.edit'), h(async (req) => {
  const { rest, cu } = split(await cleanWrite(req.user.company_id, req.user.roleDef, 'contact', contactSchema.parse(req.body), { creating: true }));
  const id = await insert(db, 'contacts', { ...rest, site_id: rest.site_id || null, receives: toJson(rest.receives ?? []), data: toJson(mergeCustom(null, cu)), client_id: Number(req.params.id), company_id: req.user.company_id, created_at: now() });
  return { id };
}));
core.put('/contacts/:id', allow('client.edit'), h(async (req) => {
  const ex = await db('contacts').where({ id: Number(req.params.id), company_id: req.user.company_id }).first();
  if (!ex) throw new HttpError(404, 'Contact not found');
  const { rest, cu } = split(await cleanWrite(req.user.company_id, req.user.roleDef, 'contact', contactSchema.partial().parse(req.body), { creating: false }));
  await db('contacts').where({ id: ex.id }).update({ ...rest, ...(rest.receives ? { receives: toJson(rest.receives) } : {}), ...('site_id' in rest ? { site_id: rest.site_id || null } : {}), data: toJson(mergeCustom(ex.data, cu)) });
  return { ok: true };
}));
core.delete('/contacts/:id', allow('client.edit'), h(async (req) => {
  await db('contacts').where({ id: Number(req.params.id), company_id: req.user.company_id }).delete();
  return { ok: true };
}));

// ---------- rate card / test catalog ----------
const catSchema = z.object({
  code: z.string().optional().nullable(), material: z.string().optional().nullable(), billing_name: z.string().min(1),
  report_name: z.string().optional().nullable(), method: z.string().optional().nullable(), nabl: z.boolean().optional(),
  unit: z.string().optional().nullable(), rate: z.coerce.number().min(0, 'Rate cannot be negative').optional(), sac: z.string().optional().nullable(), gst_rate: z.coerce.number().min(0).max(28, 'GST rate must be between 0 and 28 %').optional(),
  conditions: z.string().optional().nullable(), report_notes: z.string().optional().nullable(), obs_template_code: z.string().optional().nullable(),
  tat_days: z.coerce.number().int('Turnaround must be whole days').min(0).max(365).optional().nullable(), active: z.boolean().optional(), custom,
});
core.get('/catalog', h(async (req) => (await db('catalog').where({ company_id: req.user.company_id }).orderBy(['material', 'billing_name']))
  .map((r: Record<string, any>) => stripHidden(req.user.roleDef, 'catalog', withCustom(r)))));
core.post('/catalog', allow('catalog.create'), h(async (req) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  const ids: number[] = [];
  for (const it of items) {
    const { rest, cu } = split(await cleanWrite(req.user.company_id, req.user.roleDef, 'catalog', catSchema.parse(it), { creating: true }));
    ids.push(await insert(db, 'catalog', { ...rest, data: toJson(mergeCustom(null, cu)), company_id: req.user.company_id, created_at: now() }));
  }
  await audit(db, req.user, 'catalog', ids[0], items.length > 1 ? `imported ${items.length} items` : 'created');
  return { ids };
}));
core.put('/catalog/:id', allow('catalog.edit'), h(async (req) => {
  const before = await db('catalog').where({ id: Number(req.params.id), company_id: req.user.company_id }).first();
  if (!before) throw new HttpError(404, 'Item not found');
  const { rest, cu } = split(await cleanWrite(req.user.company_id, req.user.roleDef, 'catalog', catSchema.partial().parse(req.body), { creating: false }));
  await db('catalog').where({ id: before.id }).update({ ...rest, data: toJson(mergeCustom(before.data, cu)) });
  if (rest.rate !== undefined && Number(before.rate) !== rest.rate) await audit(db, req.user, 'catalog', before.id, 'rate changed', { from: Number(before.rate), to: rest.rate });
  return { ok: true };
}));
core.delete('/catalog/:id', allow('catalog.delete'), h(async (req) => {
  const id = Number(req.params.id), cid = req.user.company_id;
  if (await db('tests').where({ catalog_id: id, company_id: cid }).first()) { await db('catalog').where({ id, company_id: cid }).update({ active: false }); return { ok: true, deactivated: true }; }
  await db('catalog').where({ id, company_id: cid }).delete();
  return { ok: true };
}));

// ---------- equipment ----------
const eqBase = z.object({
  name: z.string().min(1), category: z.string().optional().nullable(), id_no: z.string().optional().nullable(), make: z.string().optional().nullable(),
  data: z.record(z.any()).optional(), cert_no: z.string().optional().nullable(), cal_date: isoDateOpt, due_date: isoDateOpt, active: z.boolean().optional(), custom,
});
const eqCheck = (v: { cal_date?: string | null; due_date?: string | null; data?: Record<string, unknown> }, ctx: z.RefinementCtx) => {
  if (v.cal_date && v.due_date && v.due_date < v.cal_date) ctx.addIssue({ code: 'custom', path: ['due_date'], message: 'Calibration due date cannot be before the calibration date' });
  for (const [k, x] of Object.entries(v.data ?? {})) if (k !== 'custom' && x !== null && x !== undefined && x !== '' && (typeof x !== 'number' || !Number.isFinite(x)) && typeof x !== 'string') ctx.addIssue({ code: 'custom', path: ['data', k], message: 'Calibration value must be a number' });
};
const eqSchema = eqBase.superRefine(eqCheck);
const eqPatch = eqBase.partial().superRefine(eqCheck);
core.get('/equipment', h(async (req) => (await db('equipment').where({ company_id: req.user.company_id }).orderBy('name')).map((r: Record<string, any>) => withCustom(r))));
core.post('/equipment', allow('equipment.create'), h(async (req) => {
  const { rest, cu } = split(await cleanWrite(req.user.company_id, req.user.roleDef, 'equipment', eqSchema.parse(req.body), { creating: true }));
  const id = await insert(db, 'equipment', { ...rest, data: toJson({ ...(rest.data ?? {}), custom: cu ?? {} }), company_id: req.user.company_id, created_at: now() });
  await audit(db, req.user, 'equipment', id, 'created', { name: rest.name });
  return { id };
}));
core.put('/equipment/:id', allow('equipment.edit'), h(async (req) => {
  const ex = await db('equipment').where({ id: Number(req.params.id), company_id: req.user.company_id }).first();
  if (!ex) throw new HttpError(404, 'Equipment not found');
  const { rest, cu } = split(await cleanWrite(req.user.company_id, req.user.roleDef, 'equipment', eqPatch.parse(req.body), { creating: false }));
  const merged = mergeCustom(ex.data, cu);
  await db('equipment').where({ id: ex.id }).update({ ...rest, data: toJson({ ...merged, ...(rest.data ?? {}), custom: merged.custom ?? {} }) });
  await audit(db, req.user, 'equipment', ex.id, 'updated', rest);
  return { ok: true };
}));
core.delete('/equipment/:id', allow('equipment.delete'), h(async (req) => {
  await db('equipment').where({ id: Number(req.params.id), company_id: req.user.company_id }).update({ active: false });
  return { ok: true };
}));

// ---------- templates ----------
core.get('/obs-templates', h(async (req) => {
  const rows = await db('obs_templates').where({ company_id: req.user.company_id }).orderBy(['code', { column: 'version', order: 'desc' }]);
  const latest = new Map<string, Record<string, unknown>>();
  for (const r of rows) if (!latest.has(r.code)) latest.set(r.code, { id: r.id, code: r.code, version: r.version, ...parseJson<Record<string, unknown>>(r.definition, {}) });
  return [...latest.values()];
}));
core.put('/obs-templates/:code', allow('templates'), h(async (req) => {
  const cid = req.user.company_id, code = req.params.code;
  const last = await db('obs_templates').where({ company_id: cid, code }).max({ v: 'version' }).first();
  const version = Number(last?.v ?? 0) + 1;
  const def = { ...req.body, code, version };
  const id = await insert(db, 'obs_templates', { company_id: cid, code, version, definition: toJson(def), active: true, created_at: now() });
  await audit(db, req.user, 'template', id, `observation template ${code} v${version} published`);
  return { id, version };
}));
core.get('/doc-templates', h(async (req) => (await db('doc_templates').where({ company_id: req.user.company_id })
  .modify((b) => { if (req.query.kind) b.andWhere({ kind: String(req.query.kind) }); })
  .orderBy([{ column: 'kind' }, { column: 'version', order: 'desc' }])).map((r: Record<string, unknown>) => row(r, ['definition']))));
core.post('/doc-templates', allow('templates'), h(async (req) => {
  const { kind, definition, name, makeDefault, baseId } = req.body as { kind: DocKind; definition: unknown; name?: string; makeDefault?: boolean; baseId?: number };
  const cid = req.user.company_id;
  const last = await db('doc_templates').where({ company_id: cid, kind }).max({ v: 'version' }).first();
  const version = Number(last?.v ?? 0) + 1;
  const def = definition ?? DEFAULT_TEMPLATES[kind];
  if (makeDefault) await db('doc_templates').where({ company_id: cid, kind }).update({ is_default: false });
  const id = await insert(db, 'doc_templates', { company_id: cid, kind, version, name: name || (def as { name?: string }).name, definition: toJson(def), is_default: !!makeDefault, created_at: now() });
  await audit(db, req.user, 'template', id, `${kind} template v${version} saved${baseId ? ` from #${baseId}` : ''}`);
  return { id, version };
}));
core.post('/doc-templates/:id/default', allow('templates'), h(async (req) => {
  const t = await db('doc_templates').where({ id: Number(req.params.id), company_id: req.user.company_id }).first();
  if (!t) throw new HttpError(404, 'Template not found');
  await db('doc_templates').where({ company_id: req.user.company_id, kind: t.kind }).update({ is_default: false });
  await db('doc_templates').where({ id: t.id }).update({ is_default: true });
  return { ok: true };
}));

// ---------- audit ----------
core.get('/audit', h(async (req) => {
  const q = db('audit_log').where({ company_id: req.user.company_id });
  if (req.query.entity) q.andWhere({ entity: String(req.query.entity) });
  if (req.query.id) q.andWhere({ entity_id: Number(req.query.id) });
  const users = new Map((await db('users').where({ company_id: req.user.company_id }).select('id', 'name')).map((u) => [u.id, u.name]));
  return (await q.orderBy('id', 'desc').limit(Number(req.query.limit ?? 200))).map((r) => ({ ...row(r, ['detail']), user: users.get(r.user_id) }));
}));
