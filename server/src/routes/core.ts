import { Router } from 'express';
import { z } from 'zod';
import { validateGstin, DEFAULT_TEMPLATES, type DocKind } from '@suite/shared';
import { db, insert, now, parseJson, row, toJson } from '../db';
import { allow, checkPassword, clearSession, h, hashPassword, HttpError, requireAuth, setSession } from '../auth';
import { audit, getCompany, ledger } from '../services';

export const core = Router();

// ---------- auth ----------
core.post('/auth/login', h(async (req, res) => {
  const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const u = await db('users').where({ email: email.toLowerCase(), active: true }).first();
  if (!u || !(await checkPassword(password, u.password_hash))) throw new HttpError(401, 'Email or password is incorrect');
  setSession(res, u);
  return { id: u.id, name: u.name, role: u.role };
}));
core.post('/auth/logout', h(async (_req, res) => { clearSession(res); return { ok: true }; }));

core.use(requireAuth);

core.get('/auth/me', h(async (req) => {
  const company = await getCompany(req.user.company_id);
  return { user: req.user, company: { id: company.id, name: company.name, stateCode: company.stateCode, logo: company.logo } };
}));

// ---------- company settings ----------
core.get('/company', h(async (req) => getCompany(req.user.company_id)));
core.put('/company', allow('settings'), h(async (req) => {
  const cur = await getCompany(req.user.company_id);
  const { id: _i, name, ...data } = { ...cur, ...req.body };
  await db('companies').where({ id: req.user.company_id }).update({ name, data: toJson(data) });
  await audit(db, req.user, 'company', req.user.company_id, 'updated settings');
  return getCompany(req.user.company_id);
}));

// ---------- users ----------
core.get('/users', h(async (req) => db('users').where({ company_id: req.user.company_id })
  .select('id', 'name', 'email', 'role', 'designation', 'qualifications', 'phone', 'active', 'signature')));
const userSchema = z.object({
  name: z.string().min(1), email: z.string().email(), role: z.string(), designation: z.string().optional().nullable(),
  qualifications: z.string().optional().nullable(), phone: z.string().optional().nullable(), signature: z.string().optional().nullable(),
  active: z.boolean().optional(), password: z.string().min(6).optional(),
});
core.post('/users', allow('users'), h(async (req) => {
  const { password, ...u } = userSchema.parse(req.body);
  if (!password) throw new HttpError(400, 'Set an initial password (6+ characters)');
  const id = await insert(db, 'users', { ...u, email: u.email.toLowerCase(), company_id: req.user.company_id, password_hash: await hashPassword(password), created_at: now() });
  await audit(db, req.user, 'user', id, 'created', { email: u.email, role: u.role });
  return { id };
}));
core.put('/users/:id', h(async (req) => {
  const id = Number(req.params.id);
  if (req.user.role !== 'owner' && req.user.id !== id) throw new HttpError(403, 'You can only edit your own profile');
  const { password, ...u } = userSchema.partial().parse(req.body);
  if (req.user.role !== 'owner') delete u.role;
  const patch: Record<string, unknown> = { ...u };
  if (u.email) patch.email = u.email.toLowerCase();
  if (password) patch.password_hash = await hashPassword(password);
  await db('users').where({ id, company_id: req.user.company_id }).update(patch);
  await audit(db, req.user, 'user', id, 'updated', { fields: Object.keys(patch).filter((k) => k !== 'password_hash' && k !== 'signature') });
  return { ok: true };
}));

// ---------- clients, sites, contacts ----------
const clientSchema = z.object({
  name: z.string().min(1), short_code: z.string().max(20).optional().nullable(), type: z.string().optional(),
  gstin: z.string().optional().nullable(), state_code: z.string().optional().nullable(), pan: z.string().optional().nullable(),
  address: z.string().optional().nullable(), email: z.string().optional().nullable(), phone: z.string().optional().nullable(),
  payment_terms_days: z.number().optional().nullable(), opening_balance: z.number().optional().nullable(), notes: z.string().optional().nullable(),
});
function cleanClient(c: z.infer<typeof clientSchema>) {
  const out = { ...c };
  if (out.gstin) {
    out.gstin = out.gstin.trim().toUpperCase();
    const v = validateGstin(out.gstin);
    if (!v.ok) throw new HttpError(400, v.message!);
    out.state_code = v.state;
    out.pan = out.pan || out.gstin.slice(2, 12);
  }
  if (out.short_code) out.short_code = out.short_code.toUpperCase();
  return out;
}

core.get('/clients', h(async (req) => {
  const q = String(req.query.q ?? '').trim();
  const rows = await db('clients').where({ company_id: req.user.company_id })
    .modify((b) => { if (q) b.andWhere((w) => w.whereLike('name', `%${q}%`).orWhereLike('gstin', `%${q}%`).orWhereLike('short_code', `%${q}%`)); })
    .orderBy('name').limit(500);
  const sites = await db('sites').where({ company_id: req.user.company_id }).select('client_id').count({ n: 'id' }).groupBy('client_id');
  const sc = new Map((sites as { client_id: number; n: number }[]).map((s) => [s.client_id, Number(s.n)]));
  return rows.map((r: Record<string, unknown>) => ({ ...row(r, ['data']), sites: sc.get(r.id as number) ?? 0 }));
}));
core.post('/clients', allow('clients'), h(async (req) => {
  const c = cleanClient(clientSchema.parse(req.body));
  const dup = await db('clients').where({ company_id: req.user.company_id }).andWhere((w) => {
    w.whereRaw('LOWER(name) = ?', [c.name.toLowerCase()]); if (c.gstin) w.orWhere('gstin', c.gstin);
  }).first();
  if (dup && !req.query.force) throw new HttpError(409, `A client "${dup.name}" with the same name or GSTIN already exists`);
  const id = await insert(db, 'clients', { ...c, company_id: req.user.company_id, created_at: now() });
  await audit(db, req.user, 'client', id, 'created', { name: c.name });
  return { id };
}));
core.get('/clients/:id', h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id);
  const c = row(await db('clients').where({ id, company_id: cid }).first(), ['data']);
  if (!c) throw new HttpError(404, 'Client not found');
  const [sites, contacts, docs, workOrders, samples, led] = await Promise.all([
    db('sites').where({ client_id: id, company_id: cid }).orderBy('name'),
    db('contacts').where({ client_id: id, company_id: cid }).orderBy('name'),
    db('documents').where({ client_id: id, company_id: cid }).orderBy('id', 'desc').select('id', 'kind', 'number', 'status', 'date', 'total', 'site_id'),
    db('work_orders').where({ client_id: id, company_id: cid }).orderBy('id', 'desc'),
    db('samples').where({ client_id: id, company_id: cid }).orderBy('id', 'desc').select('id', 'code', 'material', 'received_date', 'status', 'site_id'),
    ledger(cid, id),
  ]);
  const timeline = await db('audit_log').where({ company_id: cid }).andWhere((w) => {
    w.where({ entity: 'client', entity_id: id })
      .orWhere((x) => x.where('entity', 'document').whereIn('entity_id', docs.map((d) => d.id)))
      .orWhere((x) => x.where('entity', 'sample').whereIn('entity_id', samples.map((s) => s.id)));
  }).orderBy('id', 'desc').limit(50);
  const users = new Map((await db('users').where({ company_id: cid }).select('id', 'name')).map((u) => [u.id, u.name]));
  return { ...c, sites, contacts: contacts.map((x) => row(x, ['receives'])), documents: docs.map((d) => ({ ...d, total: Number(d.total) })), workOrders, samples, ledger: led,
    timeline: timeline.map((t) => ({ ...row(t, ['detail']), user: users.get(t.user_id) })) };
}));
core.put('/clients/:id', allow('clients'), h(async (req) => {
  const c = cleanClient(clientSchema.partial().extend({ name: z.string().min(1) }).parse(req.body) as z.infer<typeof clientSchema>);
  await db('clients').where({ id: Number(req.params.id), company_id: req.user.company_id }).update(c);
  await audit(db, req.user, 'client', Number(req.params.id), 'updated');
  return { ok: true };
}));

const siteSchema = z.object({ name: z.string().min(1), address: z.string().optional().nullable(), project: z.string().optional().nullable(), po_number: z.string().optional().nullable(), state_code: z.string().optional().nullable() });
core.post('/clients/:id/sites', allow('clients'), h(async (req) => {
  const s = siteSchema.parse(req.body);
  const id = await insert(db, 'sites', { ...s, client_id: Number(req.params.id), company_id: req.user.company_id, created_at: now() });
  await audit(db, req.user, 'client', Number(req.params.id), 'site added', { site: s.name });
  return { id };
}));
core.put('/sites/:id', allow('clients'), h(async (req) => {
  await db('sites').where({ id: Number(req.params.id), company_id: req.user.company_id }).update(siteSchema.partial().parse(req.body));
  return { ok: true };
}));
const contactSchema = z.object({ name: z.string().min(1), role: z.string().optional().nullable(), phone: z.string().optional().nullable(), email: z.string().optional().nullable(), site_id: z.number().optional().nullable(), receives: z.array(z.string()).optional() });
core.post('/clients/:id/contacts', allow('clients'), h(async (req) => {
  const c = contactSchema.parse(req.body);
  const id = await insert(db, 'contacts', { ...c, receives: toJson(c.receives ?? []), client_id: Number(req.params.id), company_id: req.user.company_id, created_at: now() });
  return { id };
}));
core.put('/contacts/:id', allow('clients'), h(async (req) => {
  const c = contactSchema.partial().parse(req.body);
  await db('contacts').where({ id: Number(req.params.id), company_id: req.user.company_id }).update({ ...c, ...(c.receives ? { receives: toJson(c.receives) } : {}) });
  return { ok: true };
}));

// ---------- rate card / test catalog ----------
const catSchema = z.object({
  code: z.string().optional().nullable(), material: z.string().optional().nullable(), billing_name: z.string().min(1),
  report_name: z.string().optional().nullable(), method: z.string().optional().nullable(), nabl: z.boolean().optional(),
  unit: z.string().optional().nullable(), rate: z.number().optional(), sac: z.string().optional().nullable(), gst_rate: z.number().optional(),
  conditions: z.string().optional().nullable(), report_notes: z.string().optional().nullable(), obs_template_code: z.string().optional().nullable(),
  tat_days: z.number().optional().nullable(), active: z.boolean().optional(),
});
core.get('/catalog', h(async (req) => (await db('catalog').where({ company_id: req.user.company_id }).orderBy(['material', 'billing_name'])).map((r) => row(r, []))));
core.post('/catalog', allow('catalog'), h(async (req) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  const ids: number[] = [];
  for (const it of items) ids.push(await insert(db, 'catalog', { ...catSchema.parse(it), company_id: req.user.company_id, created_at: now() }));
  await audit(db, req.user, 'catalog', ids[0], items.length > 1 ? `imported ${items.length} items` : 'created');
  return { ids };
}));
core.put('/catalog/:id', allow('catalog'), h(async (req) => {
  const before = await db('catalog').where({ id: Number(req.params.id), company_id: req.user.company_id }).first();
  const patch = catSchema.partial().parse(req.body);
  await db('catalog').where({ id: Number(req.params.id), company_id: req.user.company_id }).update(patch);
  if (patch.rate !== undefined && before && Number(before.rate) !== patch.rate) await audit(db, req.user, 'catalog', Number(req.params.id), 'rate changed', { from: Number(before.rate), to: patch.rate });
  return { ok: true };
}));

// ---------- equipment ----------
const eqSchema = z.object({
  name: z.string().min(1), category: z.string().optional().nullable(), id_no: z.string().optional().nullable(), make: z.string().optional().nullable(),
  data: z.record(z.any()).optional(), cert_no: z.string().optional().nullable(), cal_date: z.string().optional().nullable(), due_date: z.string().optional().nullable(), active: z.boolean().optional(),
});
core.get('/equipment', h(async (req) => (await db('equipment').where({ company_id: req.user.company_id }).orderBy('name')).map((r) => row(r, ['data']))));
core.post('/equipment', allow('equipment'), h(async (req) => {
  const e = eqSchema.parse(req.body);
  const id = await insert(db, 'equipment', { ...e, data: toJson(e.data ?? {}), company_id: req.user.company_id, created_at: now() });
  await audit(db, req.user, 'equipment', id, 'created', { name: e.name });
  return { id };
}));
core.put('/equipment/:id', allow('equipment'), h(async (req) => {
  const e = eqSchema.partial().parse(req.body);
  await db('equipment').where({ id: Number(req.params.id), company_id: req.user.company_id }).update({ ...e, ...(e.data ? { data: toJson(e.data) } : {}) });
  await audit(db, req.user, 'equipment', Number(req.params.id), 'updated', e);
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
