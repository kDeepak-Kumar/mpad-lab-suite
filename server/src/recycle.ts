import { Router } from 'express';
import { z } from 'zod';
import type { Knex } from 'knex';
import { db, now, parseJson, toJson, TRACKED_TABLES } from './db';
import { h, HttpError, isAdmin, requireAuth, type AuthUser } from './auth';
import { audit, getCompany, paidAgainst, refreshInvoiceStatus } from './services';

/**
 * Recycle Bin. Deleting moves the record – together with its dependent records – into one snapshot and removes it from
 * the live tables, so no screen or query has to know about "deleted" rows. Restore puts every row back with the same
 * id and number. After the retention period (30 or 60 days) the snapshot is purged for good.
 */
type Rows = Record<string, Record<string, unknown>[]>;
interface Plan { label: string; rows: Rows; patches: { table: string; id: number; before: Record<string, unknown>; after: Record<string, unknown> }[]; summary: string[]; blocked?: string }

const n = (r: unknown[], what: string) => (r.length ? [`${r.length} ${what}${r.length === 1 ? '' : 's'}`] : []);
const files = (cid: number, entity: string, ids: number[]) => (ids.length ? db('files').where({ company_id: cid, entity }).whereIn('entity_id', ids) : Promise.resolve([]));

async function plan(cid: number, object: string, id: number): Promise<Plan> {
  const one = async (table: string, extra: Record<string, unknown> = {}) => {
    const r = await db(table).where({ id, company_id: cid, ...extra }).first();
    if (!r) throw new HttpError(404, 'Record not found (it may already be in the Recycle Bin)');
    return r;
  };
  switch (object) {
    case 'sample': {
      const s = await one('samples');
      const tests = await db('tests').where({ sample_id: id, company_id: cid });
      const reportIds = [...new Set(tests.map((t) => t.report_id).filter(Boolean))];
      const reports = reportIds.length ? await db('documents').whereIn('id', reportIds).whereNot('status', 'cancelled').select('number', 'status') : [];
      const jobs = await db('outsource_jobs').where({ sample_id: id, company_id: cid });
      const f = [...(await files(cid, 'outsource', jobs.map((j) => j.id))), ...(await files(cid, 'sample', [id]))];
      return { label: `Sample ${s.code}`, rows: { samples: [s], tests, outsource_jobs: jobs, files: f }, patches: [], summary: [...n(tests, 'test / observation sheet'), ...n(jobs, 'outsourced job'), ...n(f, 'attached file')],
        blocked: reports.length ? `Its results are on report ${reports.map((r) => r.number ?? 'draft').join(', ')}. Delete that report first.` : undefined };
    }
    case 'test': {
      const t = await one('tests');
      const s = await db('samples').where({ id: t.sample_id }).first('code');
      const rep = t.report_id ? await db('documents').where({ id: t.report_id }).whereNot('status', 'cancelled').first('number') : null;
      return { label: `Observation sheet – sample ${s?.code ?? t.sample_id} (${t.template_code})`, rows: { tests: [t] }, patches: [], summary: [],
        blocked: rep ? `It is on report ${rep.number ?? 'draft'}. Delete that report first.` : undefined };
    }
    case 'quote': case 'invoice': case 'report': {
      const d = await one('documents', { kind: object });
      const patches: Plan['patches'] = [];
      if (object === 'report') for (const t of await db('tests').where({ report_id: id, company_id: cid }).select('id', 'report_id', 'status')) patches.push({ table: 'tests', id: t.id, before: { report_id: t.report_id, status: t.status }, after: { report_id: null, status: t.status === 'reported' ? 'accepted' : t.status } });
      const paid = object === 'invoice' ? (await paidAgainst(cid)).get(id) ?? 0 : 0;
      const f = await files(cid, 'document', [id]);
      const shares = await db('record_shares').where({ company_id: cid, object, record_id: id });
      const acts = await db('activities').where({ company_id: cid, link_kind: object, link_id: id });
      const label = `${{ quote: 'Quotation', invoice: 'Invoice', report: 'Test report' }[object]} ${d.number ?? `draft #${d.id}`}`;
      return { label, rows: { documents: [d], files: f, record_shares: shares, activities: acts }, patches, summary: [...(patches.length ? [`${patches.length} test(s) go back to "ready for report"`] : []), ...n(f, 'attached file'), ...n(acts, 'follow-up')],
        blocked: paid > 0 ? `Payments of ₹${paid.toLocaleString('en-IN')} are recorded against it. Delete those payments first.` : undefined };
    }
    case 'client': {
      const c = await one('clients');
      const docs = await db('documents').where({ client_id: id, company_id: cid }).count({ n: 'id' }).first();
      const smp = await db('samples').where({ client_id: id, company_id: cid }).count({ n: 'id' }).first();
      const contacts = await db('contacts').where({ client_id: id, company_id: cid }); const sites = await db('sites').where({ client_id: id, company_id: cid });
      const acts = await db('activities').where({ client_id: id, company_id: cid }); const shares = await db('record_shares').where({ company_id: cid, object: 'client', record_id: id });
      const blocked = Number(docs?.n) || Number(smp?.n) ? `It has ${Number(docs?.n) || 0} quotation/invoice/report(s) and ${Number(smp?.n) || 0} sample(s). Delete or move those first.` : undefined;
      return { label: `Client ${c.name}`, rows: { clients: [c], contacts, sites, activities: acts, record_shares: shares }, patches: [], summary: [...n(contacts, 'contact'), ...n(sites, 'site'), ...n(acts, 'follow-up')], blocked };
    }
    case 'workorder': {
      const w = await one('work_orders');
      const patches = (await db('samples').where({ work_order_id: id, company_id: cid }).select('id')).map((s) => ({ table: 'samples', id: s.id, before: { work_order_id: id }, after: { work_order_id: null } }));
      return { label: `Work order ${w.number}`, rows: { work_orders: [w] }, patches, summary: patches.length ? [`${patches.length} sample(s) stay, unlinked from it`] : [] };
    }
    case 'payment': {
      const p = await one('payments');
      return { label: `Payment ${p.number ?? p.id} – ₹${Number(p.amount).toLocaleString('en-IN')}`, rows: { payments: [p] }, patches: [], summary: ['Invoices it paid become due again'] };
    }
    case 'equipment': {
      const e = await one('equipment'); const f = await files(cid, 'equipment', [id]);
      return { label: `Equipment ${e.name}${e.id_no ? ` (${e.id_no})` : ''}`, rows: { equipment: [e], files: f }, patches: [], summary: n(f, 'certificate') };
    }
    case 'vendor': {
      const v = await one('vendors');
      const used = await db('purchases').where({ vendor_id: id, company_id: cid }).first('id') || await db('outsource_jobs').where({ vendor_id: id, company_id: cid }).first('id');
      return { label: `Vendor ${v.name}`, rows: { vendors: [v] }, patches: [], summary: [], blocked: used ? 'It has bills or outsourced jobs. Mark it inactive instead, or delete those first.' : undefined };
    }
    case 'purchase': {
      const p = await one('purchases'); const pays = await db('purchase_payments').where({ purchase_id: id, company_id: cid }); const f = await files(cid, 'purchase', [id]);
      return { label: `Vendor bill ${p.bill_no}`, rows: { purchases: [p], purchase_payments: pays, files: f }, patches: [], summary: [...n(pays, 'payment'), ...n(f, 'bill copy')] };
    }
    case 'outsource': {
      const j = await one('outsource_jobs'); const f = await files(cid, 'outsource', [id]);
      return { label: `Outsourced job #${j.id}`, rows: { outsource_jobs: [j], files: f }, patches: [], summary: n(f, 'file') };
    }
    case 'activity': {
      const a = await one('activities');
      return { label: `Follow-up: ${a.subject ?? a.type}`, rows: { activities: [a] }, patches: [], summary: [] };
    }
    case 'employee': {
      const e = await one('employees'); const att = await db('attendance').where({ employee_id: id, company_id: cid }); const f = await files(cid, 'employee', [id]);
      return { label: `Employee ${e.name}`, rows: { employees: [e], attendance: att, files: f }, patches: [], summary: [...n(att, 'attendance entry'), ...n(f, 'document')] };
    }
    case 'catalog': {
      const c = await one('catalog');
      const used = await db('tests').where({ catalog_id: id, company_id: cid }).first('id');
      return { label: `Rate card: ${c.billing_name}`, rows: { catalog: [c] }, patches: [], summary: [], blocked: used ? 'Samples use this test. Mark it inactive instead.' : undefined };
    }
    default: throw new HttpError(400, 'This kind of record cannot be deleted here');
  }
}
export const RECYCLE_OBJECTS = ['sample', 'test', 'quote', 'invoice', 'report', 'client', 'workorder', 'payment', 'equipment', 'vendor', 'purchase', 'outsource', 'activity', 'catalog', 'employee'];

async function retentionDays(cid: number) { return Number(((await getCompany(cid)).defaults as any)?.recycleDays ?? 30) === 60 ? 60 : 30; }

/** Move a record (and its dependants) to the Recycle Bin. Used by the admin delete and by module delete buttons. */
export async function moveToBin(user: AuthUser, object: string, id: number, reason?: string | null) {
  const cid = user.company_id;
  const p = await plan(cid, object, id);
  if (p.blocked) throw new HttpError(409, `Cannot delete ${p.label}: ${p.blocked}`);
  const days = await retentionDays(cid);
  const purge = new Date(Date.now() + days * 86400000).toISOString();
  const invoices = object === 'payment' ? parseJson<{ invoiceId: number }[]>(p.rows.payments[0].allocations, []).map((a) => a.invoiceId) : [];
  const binId = await db.transaction(async (trx) => {
    for (const x of p.patches) await trx(x.table).where({ id: x.id }).update(x.after);
    // children first, the main record last
    for (const table of Object.keys(p.rows).reverse()) { const ids = p.rows[table].map((r) => r.id as number); if (ids.length) await trx(table).whereIn('id', ids).delete(); }
    const [bid] = await trx('recycle_bin').insert({ company_id: cid, object, record_id: id, label: p.label, summary: p.summary.join('; '), snapshot: JSON.stringify({ rows: p.rows, patches: p.patches }),
      deleted_by: user.id, deleted_at: now(), purge_after: purge, reason: reason ?? null });
    return Number(bid);
  });
  if (invoices.length) await refreshInvoiceStatus(db, cid, invoices);
  await audit(db, user, object === 'quote' || object === 'invoice' || object === 'report' ? 'document' : object, id, 'moved to Recycle Bin', { label: p.label, reason, keepDays: days, bin: binId });
  return { binId, label: p.label, purgeAfter: purge };
}

async function restore(user: AuthUser, binId: number) {
  const cid = user.company_id;
  const b = await db('recycle_bin').where({ id: binId, company_id: cid }).whereNull('restored_at').whereNull('purged_at').first();
  if (!b) throw new HttpError(404, 'Not in the Recycle Bin (already restored or permanently deleted)');
  const snap = JSON.parse(b.snapshot) as { rows: Rows; patches: Plan['patches'] };
  for (const [table, rows] of Object.entries(snap.rows)) for (const r of rows) if (await db(table).where({ id: r.id }).first('id')) throw new HttpError(409, `Cannot restore: a ${table} record with the same id exists again.`);
  if (b.object === 'test' || b.object === 'outsource') {
    const sid = (snap.rows.tests?.[0] ?? snap.rows.outsource_jobs?.[0])?.sample_id;
    if (sid && !(await db('samples').where({ id: sid }).first('id'))) throw new HttpError(409, 'Its sample is in the Recycle Bin – restore the sample first.');
  }
  await db.transaction(async (trx) => {
    for (const [table, rows] of Object.entries(snap.rows)) for (const r of rows) await trx(table).insert(r); // main record first (insertion order)
    for (const x of snap.patches) await trx(x.table).where({ id: x.id }).update(x.before);
    await trx('recycle_bin').where({ id: binId }).update({ restored_at: now(), restored_by: user.id });
  });
  if (b.object === 'payment') await refreshInvoiceStatus(db, cid, parseJson<{ invoiceId: number }[]>(snap.rows.payments[0].allocations, []).map((a) => a.invoiceId));
  await audit(db, user, ['quote', 'invoice', 'report'].includes(b.object) ? 'document' : b.object, b.record_id, 'restored from Recycle Bin', { label: b.label });
  return { ok: true, object: b.object, id: b.record_id };
}

/** Permanently removes snapshots past their retention date (runs daily). */
export async function purgeExpired() {
  const due = await db('recycle_bin').whereNull('restored_at').whereNull('purged_at').andWhere('purge_after', '<', now()).select('id', 'company_id', 'object', 'record_id', 'label');
  for (const b of due) {
    await db('recycle_bin').where({ id: b.id }).update({ snapshot: '', purged_at: now() });
    await db('audit_log').insert({ company_id: b.company_id, user_id: null, entity: b.object, entity_id: b.record_id, action: 'permanently deleted (retention ended)', detail: JSON.stringify({ label: b.label }), at: now() });
  }
  return due.length;
}
export function startRecyclePurge() { const run = () => purgeExpired().catch((e) => console.error('recycle purge', e.message)); setTimeout(run, 90_000).unref(); setInterval(run, 6 * 3600_000).unref(); }

// ---------- routes ----------
export const recycle = Router();
recycle.use(['/recycle', '/record-info'], requireAuth);
const adminOnly = (u: AuthUser) => { if (!isAdmin(u)) throw new HttpError(403, 'Only System Administrators can do this'); };

/** What deleting would take with it, or why it is blocked. */
recycle.get('/recycle/preview/:object/:id', h(async (req) => {
  adminOnly(req.user);
  const p = await plan(req.user.company_id, req.params.object, Number(req.params.id));
  return { label: p.label, includes: p.summary, blocked: p.blocked ?? null, keepDays: await retentionDays(req.user.company_id) };
}));
recycle.delete('/recycle/bin/:binId', h(async (req) => {
  adminOnly(req.user);
  const b = await db('recycle_bin').where({ id: Number(req.params.binId), company_id: req.user.company_id }).whereNull('restored_at').whereNull('purged_at').first('id', 'object', 'record_id', 'label');
  if (!b) throw new HttpError(404, 'Not in the Recycle Bin');
  await db('recycle_bin').where({ id: b.id }).update({ snapshot: '', purged_at: now() });
  await audit(db, req.user, b.object, b.record_id, 'permanently deleted from Recycle Bin', { label: b.label });
  return { ok: true };
}));
recycle.delete('/recycle/:object/:id', h(async (req) => {
  adminOnly(req.user);
  const { reason } = z.object({ reason: z.string().max(500).optional().nullable() }).parse(req.body ?? {});
  return moveToBin(req.user, req.params.object, Number(req.params.id), reason);
}));
recycle.get('/recycle', h(async (req) => {
  adminOnly(req.user);
  const rows = await db('recycle_bin as b').leftJoin('users as u', 'u.id', 'b.deleted_by').leftJoin('users as r', 'r.id', 'b.restored_by').where('b.company_id', req.user.company_id)
    .select('b.id', 'b.object', 'b.record_id', 'b.label', 'b.summary', 'b.deleted_at', 'b.purge_after', 'b.reason', 'b.restored_at', 'b.purged_at', 'u.name as deleted_by_name', 'r.name as restored_by_name')
    .orderBy('b.id', 'desc').limit(1000);
  return { rows, keepDays: await retentionDays(req.user.company_id) };
}));
recycle.post('/recycle/:binId/restore', h(async (req) => { adminOnly(req.user); return restore(req.user, Number(req.params.binId)); }));
recycle.put('/recycle/settings', h(async (req) => {
  adminOnly(req.user);
  const { days } = z.object({ days: z.union([z.literal(30), z.literal(60)]) }).parse(req.body);
  const row = await db('companies').where({ id: req.user.company_id }).first('data');
  const data = parseJson<Record<string, any>>(row?.data, {});
  data.defaults = { ...(data.defaults ?? {}), recycleDays: days };
  await db('companies').where({ id: req.user.company_id }).update({ data: toJson(data) });
  await audit(db, req.user, 'company', req.user.company_id, `Recycle Bin keeps deleted records ${days} days`);
  return { ok: true };
}));

// ---------- created / last-modified ----------
const TABLE: Record<string, { table: string; entity: string }> = {
  client: { table: 'clients', entity: 'client' }, quote: { table: 'documents', entity: 'document' }, invoice: { table: 'documents', entity: 'document' }, report: { table: 'documents', entity: 'document' },
  document: { table: 'documents', entity: 'document' }, sample: { table: 'samples', entity: 'sample' }, test: { table: 'tests', entity: 'test' }, workorder: { table: 'work_orders', entity: 'workorder' },
  payment: { table: 'payments', entity: 'payment' }, equipment: { table: 'equipment', entity: 'equipment' }, vendor: { table: 'vendors', entity: 'vendor' }, purchase: { table: 'purchases', entity: 'purchase' },
  outsource: { table: 'outsource_jobs', entity: 'outsource' }, catalog: { table: 'catalog', entity: 'catalog' }, activity: { table: 'activities', entity: 'activity' }, user: { table: 'users', entity: 'user' }, employee: { table: 'employees', entity: 'employee' },
};
/** Created / last modified (with who, from the audit trail). */
recycle.get('/record-info/:object/:id', h(async (req) => {
  const m = TABLE[req.params.object]; if (!m) throw new HttpError(400, 'Unknown record type');
  const id = Number(req.params.id);
  const r = await db(m.table).where({ id, company_id: req.user.company_id }).first('created_at', 'updated_at');
  if (!r) throw new HttpError(404, 'Record not found');
  const trail = (q: Knex.QueryBuilder) => q.leftJoin('users as u', 'u.id', 'a.user_id').where({ 'a.company_id': req.user.company_id, 'a.entity': m.entity, 'a.entity_id': id }).first('a.at', 'a.action', 'u.name');
  const first = await trail(db('audit_log as a').orderBy('a.id', 'asc'));
  const last = await trail(db('audit_log as a').orderBy('a.id', 'desc'));
  return { created_at: r.created_at, updated_at: r.updated_at ?? r.created_at, created_by: first?.name ?? null, modified_by: last?.name ?? null, last_action: last?.action ?? null, canEdit: isAdmin(req.user) };
}));
/** System Administrators only: correct the record's dates (e.g. when entering old paper records). Audited. */
recycle.put('/record-info/:object/:id', h(async (req) => {
  adminOnly(req.user);
  const m = TABLE[req.params.object]; if (!m || !TRACKED_TABLES.includes(m.table)) throw new HttpError(400, 'Unknown record type');
  const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Enter a valid date and time');
  const b = z.object({ created_at: iso.optional(), updated_at: iso.optional() }).refine((x) => x.created_at || x.updated_at, 'Nothing to change').parse(req.body);
  const id = Number(req.params.id);
  const r = await db(m.table).where({ id, company_id: req.user.company_id }).first('created_at', 'updated_at');
  if (!r) throw new HttpError(404, 'Record not found');
  const patch = { ...(b.created_at ? { created_at: new Date(b.created_at).toISOString() } : {}), updated_at: b.updated_at ? new Date(b.updated_at).toISOString() : r.updated_at };
  if (patch.created_at && patch.updated_at && patch.updated_at < patch.created_at) throw new HttpError(400, 'Last modified cannot be before created');
  await db(m.table).where({ id }).update(patch);
  await audit(db, req.user, m.entity, id, 'record dates changed by administrator', { from: { created_at: r.created_at, updated_at: r.updated_at }, to: patch });
  return { ok: true };
}));
