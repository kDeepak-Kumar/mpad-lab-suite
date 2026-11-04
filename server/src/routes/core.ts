import crypto from 'node:crypto';
import { storageInfo } from '../storage';
import { collectAlerts, runAlerts, type AlertSettings } from '../alerts';
import { Router } from 'express';
import { passwordRule, sendAccessLink } from './onboarding';
import { docVisibility, recordAccess, restrictList } from '../sharing';
import { z } from 'zod';
import { DEFAULT_TEMPLATES, EQUIPMENT_CATEGORIES, INDIAN_STATES, isIsoDate, type DocKind } from '@suite/shared';
import { db, insert, now, parseJson, row, toJson } from '../db';
import { allow, can, checkPassword, clearSession, h, hashPassword, HttpError, isAdmin, requireAuth, setSession, zBool } from '../auth';
import { audit, getCompany, ledger } from '../services';
import { cleanWrite, deleteMeta, getMeta, mergeCustom, saveMeta, stripHidden, type MetaKind } from '../meta';

export const core = Router();

// ---------- auth ----------
core.use(requireAuth);

core.get('/auth/me', h(async (req) => {
  const company = await getCompany(req.user.company_id);
  const { roleDef, ...user } = req.user;
  const u = await db('users').where({ id: req.user.id }).first('totp_enabled');
  return { user, role: roleDef, company: { id: company.id, name: company.name, stateCode: company.stateCode, logo: company.logo }, security: { totpEnabled: Boolean(u?.totp_enabled), required: Boolean((company as any).security?.require2fa), idleMinutes: Number((company as any).security?.idleMinutes ?? 10), idleWarnAfter: Number((company as any).security?.idleWarnAfter ?? 7) } };
}));

// ---------- email alerts (SLA / calibration) ----------
core.get('/alerts/preview', allow('settings'), h(async (req) => {
  const company = await getCompany(req.user.company_id);
  return collectAlerts(req.user.company_id, (company.alerts ?? {}) as AlertSettings);
}));
core.get('/system/storage', allow('settings'), h(async () => storageInfo()));
/** Full backup of everything (all records, settings, attachments) as one compressed file. Admins / owner only. */
core.get('/system/backup', allow('settings'), async (req, res) => {
  try {
    if (!isAdmin(req.user) && req.user.role !== 'owner') { res.status(403).json({ error: 'Only the System Administrator or Owner can download a full backup' }); return; }
    if ((process.env.DB_CLIENT || 'sqlite') !== 'sqlite') { res.status(400).json({ error: 'This server uses MySQL – download the backup from the hosting control panel (phpMyAdmin / Backup).' }); return; }
    const os = await import('node:os'); const fsP = await import('node:fs'); const zlib = await import('node:zlib'); const pathM = await import('node:path'); const crypto = await import('node:crypto');
    const tmp = pathM.join(os.tmpdir(), `suite-backup-${crypto.randomBytes(6).toString('hex')}.sqlite`);
    await db.raw(`VACUUM INTO '${tmp}'`);
    const stamp = new Date().toLocaleString('sv-SE', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).replace(/[: ]/g, '-').slice(0, 16);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="lab-suite-backup-${stamp}.sqlite.gz"`);
    await audit(db, req.user, 'company', req.user.company_id, 'full backup downloaded');
    const src = fsP.createReadStream(tmp);
    src.pipe(zlib.createGzip({ level: 6 })).pipe(res).on('finish', () => fsP.unlink(tmp, () => undefined));
    src.on('error', () => fsP.unlink(tmp, () => undefined));
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});
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
  await audit(db, req.user, 'company', req.user.company_id, 'updated settings', { fields: Object.keys(body) });
  return { ok: true };
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
  if (PERSONAL.includes(kind)) {
    const ex = await db('meta').where({ company_id: req.user.company_id, kind, key: req.params.key }).first('owner_id');
    if (ex && ex.owner_id !== req.user.id && !can(req.user, 'manageCustomization')) throw new HttpError(403, 'This view belongs to someone else. Save it under a new name.');
  }
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
  .select('id', 'name', 'email', 'role', 'designation', 'qualifications', 'phone', 'active', 'signature', 'totp_enabled', 'password_set', 'email_verified_at')));
const userSchema = z.object({
  name: z.string().min(1), email: z.string().email(), role: z.string(), designation: z.string().optional().nullable(),
  qualifications: z.string().optional().nullable(), phone: z.string().optional().nullable(), signature: z.string().optional().nullable(),
  active: zBool.optional(), password: passwordRule.optional(),
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
  const email = u.email.toLowerCase();
  if (await db('users').where({ email }).first('id')) throw new HttpError(400, 'A user with this email already exists');
  // Without a password the user is invited: they confirm their email and choose their own password from the link.
  const id = await insert(db, 'users', {
    ...u, email, company_id: req.user.company_id, created_at: now(),
    password_hash: await hashPassword(password ?? crypto.randomBytes(24).toString('base64url')), password_set: Boolean(password),
  });
  await audit(db, req.user, 'user', id, password ? 'created' : 'created and invited', { email, role: u.role });
  if (password) return { id };
  const invite = await sendAccessLink(req, { id, name: u.name, email, company_id: req.user.company_id }, 'invite', req.user.id);
  return { id, invite };
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
  if (password) { patch.password_hash = await hashPassword(password); patch.password_set = true; }
  if (u.email && target && u.email.toLowerCase() !== target.email) {
    if (await db('users').where({ email: u.email.toLowerCase() }).whereNot({ id }).first('id')) throw new HttpError(400, 'A user with this email already exists');
    patch.email_verified_at = null; // new address is not confirmed yet
  }
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
  const qb = db('clients as c').leftJoin('users as o', 'o.id', 'c.owner_id').where('c.company_id', req.user.company_id).select('c.*', 'o.name as owner_name')
    .modify((b) => { if (q) b.andWhere((w) => w.where('c.name', 'like', `%${q}%`).orWhere('c.gstin', 'like', `%${q}%`).orWhere('c.short_code', 'like', `%${q}%`)); });
  await restrictList(req.user, 'client', qb, 'c.id', 'c.owner_id');
  const rows = await qb.orderBy('c.name').limit(5000);
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
  const id = await insert(db, 'clients', { ...rest, data: toJson(mergeCustom(null, cu)), company_id: req.user.company_id, owner_id: req.user.id, created_at: now() });
  await audit(db, req.user, 'client', id, 'created', { name: c.name });
  return { id };
}));
/**
 * Bulk import from the Excel/CSV template. One row = a client, optionally with one site and one contact;
 * repeat the client name on more rows to add more sites/contacts. Existing clients (same name or GSTIN)
 * are not changed – only their new sites/contacts are added. dryRun=true checks everything and writes nothing.
 */
const IMPORT_COLS: Record<string, string> = {
  'client name': 'name', 'name': 'name', 'short code': 'short_code', 'type': 'type', 'gstin': 'gstin', 'pan': 'pan', 'state': 'state', 'state code': 'state',
  'billing address': 'address', 'address': 'address', 'email': 'email', 'phone': 'phone', 'payment terms (days)': 'payment_terms_days', 'payment terms': 'payment_terms_days',
  'discount %': 'discount_pct', 'discount': 'discount_pct', 'opening balance': 'opening_balance', 'notes': 'notes',
  'site name': 'site_name', 'site address': 'site_address', 'site project': 'site_project', 'project': 'site_project', 'site po / wo no.': 'site_po', 'site po': 'site_po',
  'contact name': 'contact_name', 'contact role': 'contact_role', 'contact phone': 'contact_phone', 'contact email': 'contact_email',
};
core.post('/clients/import', allow('client.create'), h(async (req) => {
  const { rows, dryRun } = z.object({ rows: z.array(z.record(z.any())).max(5000, 'Import at most 5,000 rows at a time'), dryRun: zBool.default(true) }).parse(req.body);
  const cid = req.user.company_id, role = req.user.roleDef;
  const states = INDIAN_STATES;
  const stateOf = (v: string) => { const t = v.trim().toLowerCase(); if (!t) return null; const s = states.find((x) => x.code === t.padStart(2, '0') || x.name.toLowerCase() === t); return s?.code ?? undefined; };
  const types = ['company', 'government', 'individual', 'walkin'];
  const existing = await db('clients').where({ company_id: cid }).select('id', 'name', 'gstin');
  const byName = new Map(existing.map((c) => [String(c.name).trim().toLowerCase(), c.id as number]));
  const byGstin = new Map(existing.filter((c) => c.gstin).map((c) => [String(c.gstin).toUpperCase(), c.id as number]));
  const created = new Map<string, number | 'new'>();
  const seen = new Set<string>(); // sites/contacts already counted in this import
  const exists = async (table: 'sites' | 'contacts', clientId: number | 'new', key: string, nm: string) => {
    const k = `${table}|${key}|${nm.toLowerCase()}`;
    if (seen.has(k)) return true;
    seen.add(k);
    return typeof clientId === 'number' && Boolean(await db(table).where({ client_id: clientId, company_id: cid }).whereRaw('LOWER(name) = ?', [nm.toLowerCase()]).first());
  };
  const results: { row: number; client: string; status: 'new client' | 'existing client' | 'error' | 'skipped'; added: string[]; message?: string }[] = [];
  let newClients = 0, sites = 0, contacts = 0, errors = 0;
  for (let i = 0; i < rows.length; i++) {
    const raw: Record<string, string> = {};
    for (const [k, v] of Object.entries(rows[i])) { const key = IMPORT_COLS[k.replace(/\*/g, '').trim().toLowerCase()]; if (key) raw[key] = String(v ?? '').trim(); }
    const rowNo = i + 2; // header is row 1 in Excel
    const name = raw.name ?? '';
    if (!name && !raw.site_name && !raw.contact_name) { results.push({ row: rowNo, client: '', status: 'skipped', added: [], message: 'Empty row' }); continue; }
    if (/^example\b/i.test(name)) { results.push({ row: rowNo, client: name, status: 'skipped', added: [], message: 'Example row' }); continue; }
    try {
      if (!name) throw new Error('Client name is required');
      const key = name.toLowerCase();
      const gst = raw.gstin ? raw.gstin.replace(/\s/g, '').toUpperCase() : '';
      let clientId: number | 'new' | undefined = created.get(key) ?? byName.get(key) ?? (gst ? byGstin.get(gst) : undefined);
      const added: string[] = [];
      let status: 'new client' | 'existing client' = 'existing client';
      if (clientId === undefined) {
        const st = raw.state ? stateOf(raw.state) : null;
        if (st === undefined) throw new Error(`State "${raw.state}" not recognised – use the 2-digit GST state code (e.g. 36) or the state name`);
        const type = (raw.type || 'company').toLowerCase().replace(/[^a-z]/g, '');
        if (!types.includes(type)) throw new Error(`Type must be one of: ${types.join(', ')}`);
        const body = clientSchema.parse({
          name, short_code: raw.short_code || null, type, gstin: gst || null, pan: raw.pan ? raw.pan.toUpperCase() : null, state_code: st, address: raw.address || null,
          email: raw.email || null, phone: raw.phone || null, notes: raw.notes || null,
          payment_terms_days: raw.payment_terms_days || undefined, discount_pct: raw.discount_pct ? raw.discount_pct.replace('%', '') : undefined, opening_balance: raw.opening_balance ? raw.opening_balance.replace(/[₹,\s]/g, '') : undefined,
        });
        const c = normaliseClient(await cleanWrite(cid, role, 'client', body, { creating: true }));
        if (!c.state_code) throw new Error('Give a GSTIN or a State so GST can be worked out');
        if (dryRun) clientId = 'new';
        else { const { rest } = split(c); clientId = await insert(db, 'clients', { ...rest, data: toJson({}), company_id: cid, owner_id: req.user.id, created_at: now() }); await audit(db, req.user, 'client', clientId, 'created (import)', { name }); }
        created.set(key, clientId); if (gst) byGstin.set(gst, clientId as number);
        status = 'new client'; newClients++;
      } else if (created.has(key) && !byName.has(key)) status = 'new client';
      if (raw.site_name) {
        const site = await cleanWrite(cid, role, 'site', siteSchema.parse({ name: raw.site_name, address: raw.site_address || null, project: raw.site_project || null, po_number: raw.site_po || null }), { creating: true });
        if (!(await exists('sites', clientId, key, raw.site_name))) {
          if (!dryRun && typeof clientId === 'number') { const { rest } = split(site); await insert(db, 'sites', { ...rest, data: toJson({}), client_id: clientId, company_id: cid, created_at: now() }); }
          added.push(`site “${raw.site_name}”`); sites++;
        }
      }
      if (raw.contact_name) {
        const ct = await cleanWrite(cid, role, 'contact', contactSchema.parse({ name: raw.contact_name, role: raw.contact_role || null, phone: raw.contact_phone || null, email: raw.contact_email || null }), { creating: true });
        if (!(await exists('contacts', clientId, key, raw.contact_name))) {
          if (!dryRun && typeof clientId === 'number') { const { rest } = split(ct); await insert(db, 'contacts', { ...rest, site_id: null, receives: toJson(['quote', 'report', 'invoice']), data: toJson({}), client_id: clientId, company_id: cid, created_at: now() }); }
          added.push(`contact ${raw.contact_name}`); contacts++;
        }
      }
      results.push({ row: rowNo, client: name, status, added });
    } catch (e) {
      errors++;
      const msg = (e as { name?: string }).name === 'ZodError' ? ((e as any).issues ?? []).map((x: any) => `${x.path.join(' ')}: ${x.message}`).join('; ') : (e as Error).message;
      results.push({ row: rowNo, client: name, status: 'error', added: [], message: msg });
    }
  }
  return { dryRun, summary: { rows: rows.length, newClients, sites, contacts, errors }, results };
}));
core.get('/clients/:id', allow('client.read'), h(async (req) => {
  const cid = req.user.company_id, id = Number(req.params.id), role = req.user.roleDef;
  const raw = await db('clients').where({ id, company_id: cid }).first();
  if (!raw) throw new HttpError(404, 'Client not found');
  const access = await recordAccess(req.user, 'client', raw);
  if (access === 'none') throw new HttpError(404, 'Client not found or not shared with you');
  const c = { ...stripHidden(role, 'client', withCustom(raw)), access, owner_name: raw.owner_id ? (await db('users').where({ id: raw.owner_id }).first('name'))?.name ?? null : null };
  const [sites, contacts, docs, workOrders, samples, led] = await Promise.all([
    db('sites').where({ client_id: id, company_id: cid }).orderBy('name'),
    db('contacts').where({ client_id: id, company_id: cid }).orderBy('name'),
    db('documents as d').where({ 'd.client_id': id, 'd.company_id': cid }).orderBy('d.id', 'desc').select('d.id', 'd.kind', 'd.number', 'd.status', 'd.date', 'd.total', 'd.site_id', 'd.accreditation', 'd.owner_id'),
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
    documents: docs.filter(await docVisibility(req.user)).map((d) => ({ ...d, total: Number(d.total) })), workOrders, samples, ledger: led,
    timeline: timeline.map((t) => ({ ...row(t, ['detail']), user: users.get(t.user_id) })) };
}));
core.put('/clients/:id', allow('client.edit'), h(async (req) => {
  const id = Number(req.params.id);
  const ex = await db('clients').where({ id, company_id: req.user.company_id }).first();
  if (!ex) throw new HttpError(404, 'Client not found');
  if ((await recordAccess(req.user, 'client', ex)) !== 'edit') throw new HttpError(403, 'This client is read-only for you. Ask its owner to share it with edit access.');
  const c = normaliseClient(await cleanWrite(req.user.company_id, req.user.roleDef, 'client', clientSchema.partial().parse(req.body), { creating: false }));
  const { rest, cu } = split(c);
  await db('clients').where({ id }).update({ ...rest, data: toJson(mergeCustom(ex.data, cu)) });
  await audit(db, req.user, 'client', id, 'updated', { fields: Object.keys(rest) });
  return { ok: true };
}));
core.delete('/clients/:id', allow('client.delete'), h(async (req) => {
  const id = Number(req.params.id), cid = req.user.company_id;
  const ex = await db('clients').where({ id, company_id: cid }).first('id', 'owner_id');
  if (ex && (await recordAccess(req.user, 'client', ex)) !== 'edit') throw new HttpError(403, 'You can only delete clients you own or can edit');
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
  report_name: z.string().optional().nullable(), method: z.string().optional().nullable(), nabl: zBool.optional(),
  unit: z.string().optional().nullable(), rate: z.coerce.number().min(0, 'Rate cannot be negative').optional(), sac: z.string().optional().nullable(), gst_rate: z.coerce.number().min(0).max(28, 'GST rate must be between 0 and 28 %').optional(),
  conditions: z.string().optional().nullable(), report_notes: z.string().optional().nullable(), obs_template_code: z.string().optional().nullable(),
  tat_days: z.coerce.number().int('Turnaround must be whole days').min(0).max(365).optional().nullable(), active: zBool.optional(), custom,
  performed_by: z.enum(['inhouse', 'vendor']).optional(), vendor_id: z.number().nullable().optional(),
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
  data: z.record(z.any()).optional(), cert_no: z.string().optional().nullable(), cal_date: isoDateOpt, due_date: isoDateOpt, active: zBool.optional(), custom,
});
const eqCheck = (v: { cal_date?: string | null; due_date?: string | null; data?: Record<string, unknown> }, ctx: z.RefinementCtx) => {
  if (v.cal_date && v.due_date && v.due_date < v.cal_date) ctx.addIssue({ code: 'custom', path: ['due_date'], message: 'Calibration due date cannot be before the calibration date' });
  for (const [k, x] of Object.entries(v.data ?? {})) if (k !== 'custom' && x !== null && x !== undefined && x !== '' && (typeof x !== 'number' || !Number.isFinite(x)) && typeof x !== 'string') ctx.addIssue({ code: 'custom', path: ['data', k], message: 'Calibration value must be a number' });
};
const eqSchema = eqBase.superRefine(eqCheck);
const eqPatch = eqBase.partial().superRefine(eqCheck);
/** Equipment import: header names → fields. Calibration-value columns go into data.<key>. */
const EQ_COLS: Record<string, string> = {
  'equipment name': 'name', 'name': 'name', 'equipment': 'name', 'category': 'category', 'equipment id': 'id_no', 'id': 'id_no', 'id no': 'id_no', 'id no.': 'id_no',
  'make / model': 'make', 'make': 'make', 'model': 'make', 'certificate no.': 'cert_no', 'certificate no': 'cert_no', 'certificate': 'cert_no', 'cert no': 'cert_no',
  'calibrated on': 'cal_date', 'calibration date': 'cal_date', 'calibration due': 'due_date', 'due date': 'due_date', 'next calibration': 'due_date', 'active': 'active',
};
const EQ_VALUE_COLS: Record<string, string> = {
  'calibration factor': 'factor', 'correction factor': 'correction', 'least count': 'lc', 'volume': 'volume', 'mass': 'mass', 'readability': 'readability',
  'capacity': 'capacity', 'ram area': 'ram_area', 'anvil average rebound': 'anvil_avg', 'anvil nominal rebound': 'anvil_nominal', 'reference transit time': 'ref_time',
  'mass of sand in cone': 'cone_mass', 'sand bulk density': 'sand_density',
};
/** 31-12-2026, 31/12/26, 2026-12-31, Excel serial 46387, or a JS date string → YYYY-MM-DD. */
function importDate(v: string): string | null | 'bad' {
  const s = v.trim(); if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{5}$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000); return d.toISOString().slice(0, 10); }
  const d = new Date(s); if (!Number.isNaN(d.getTime()) && /[a-z]/i.test(s)) return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return 'bad';
}
core.post('/equipment/import', allow('equipment.create'), h(async (req) => {
  const { rows, dryRun } = z.object({ rows: z.array(z.record(z.any())).max(3000, 'Import at most 3,000 rows at a time'), dryRun: zBool.default(true) }).parse(req.body);
  const cid = req.user.company_id;
  const existing = await db('equipment').where({ company_id: cid }).select('id', 'name', 'id_no', 'data');
  const byId = new Map(existing.filter((e) => e.id_no).map((e) => [String(e.id_no).trim().toLowerCase(), e]));
  const byName = new Map(existing.filter((e) => !e.id_no).map((e) => [String(e.name).trim().toLowerCase(), e]));
  const results: { row: number; name: string; status: string; message?: string }[] = [];
  const seen = new Set<string>();
  let added = 0, updated = 0, errors = 0;
  for (let i = 0; i < rows.length; i++) {
    const raw: Record<string, string> = {}; const vals: Record<string, number> = {};
    const bad: string[] = [];
    for (const [k, v] of Object.entries(rows[i])) {
      const h = k.replace(/\*/g, '').replace(/\(.*?\)/g, '').trim().toLowerCase();
      const key = EQ_COLS[h]; const vk = EQ_VALUE_COLS[h];
      const sv = String(v ?? '').trim();
      if (key) raw[key] = sv;
      else if (vk && sv !== '') { const n = Number(sv.replace(/,/g, '')); if (Number.isFinite(n)) vals[vk] = n; else bad.push(`${k} is not a number`); }
    }
    const row = i + 2, name = raw.name ?? '';
    if (!name && !raw.id_no) { results.push({ row, name: '', status: 'skipped', message: 'Empty row' }); continue; }
    if (/^example/i.test(name)) { results.push({ row, name, status: 'skipped', message: 'Example row' }); continue; }
    if (!name) bad.push('Equipment name is required');
    const cal = importDate(raw.cal_date ?? ''), due = importDate(raw.due_date ?? '');
    if (cal === 'bad') bad.push(`Calibrated on "${raw.cal_date}" is not a date (use DD-MM-YYYY)`);
    if (due === 'bad') bad.push(`Calibration due "${raw.due_date}" is not a date (use DD-MM-YYYY)`);
    if (cal && due && cal !== 'bad' && due !== 'bad' && due < cal) bad.push('Due date is before the calibration date');
    const known = raw.category ? EQUIPMENT_CATEGORIES.find((c) => c.toLowerCase() === raw.category.toLowerCase()) : undefined;
    const note = raw.category && !known ? `Category "${raw.category}" is not in the list – saved as Other` : undefined;
    const category = raw.category ? known ?? 'Other' : null; // blank: new equipment → Other, existing → unchanged
    const dupKey = (raw.id_no || name).toLowerCase();
    if (seen.has(dupKey)) bad.push(`Repeated in the file (${raw.id_no ? 'same Equipment ID' : 'same name'})`);
    seen.add(dupKey);
    if (bad.length) { errors++; results.push({ row, name, status: 'error', message: bad.join('; ') }); continue; }
    const match = raw.id_no ? byId.get(raw.id_no.toLowerCase()) : byName.get(name.toLowerCase());
    const rec: Record<string, unknown> = { name, category, id_no: raw.id_no || null, make: raw.make || null, cert_no: raw.cert_no || null, cal_date: cal || null, due_date: due || null,
      ...(raw.active ? { active: !/^(n|no|false|0|inactive)$/i.test(raw.active) } : {}) };
    if (match) {
      updated++; results.push({ row, name, status: 'update', message: note ?? 'Existing equipment – details and calibration updated' });
      if (!dryRun) {
        const data = { ...parseJson<Record<string, unknown>>(match.data, {}), ...vals };
        for (const k of Object.keys(rec)) if (rec[k] === null) delete rec[k]; // blank cells keep the current value
        await db('equipment').where({ id: match.id }).update({ ...rec, data: toJson(data) });
        await audit(db, req.user, 'equipment', match.id, 'updated (import)', { cert: rec.cert_no, due: rec.due_date });
      }
    } else {
      added++; results.push({ row, name, status: 'new', message: note });
      if (!dryRun) {
        const id = await insert(db, 'equipment', { ...rec, category: rec.category ?? 'Other', active: rec.active ?? true, data: toJson(vals), company_id: cid, created_at: now() });
        await audit(db, req.user, 'equipment', id, 'created (import)', { name });
      }
    }
  }
  return { results, summary: { added, updated, errors, rows: rows.length } };
}));
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
