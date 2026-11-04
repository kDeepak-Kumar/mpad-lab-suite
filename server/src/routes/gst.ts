import { Router } from 'express';
import { z } from 'zod';
import { r2, stateName, validateGstin } from '@suite/shared';
import { db, insert, now, parseJson } from '../db';
import { allow, h, HttpError, requireAuth } from '../auth';
import { audit, getCompany } from '../services';

/**
 * GST returns workspace. Each month has a register of outward supplies (pulled from issued invoices, one
 * row per tax rate, plus manual rows) and inward supplies (purchase bills for input tax credit, entered
 * by hand). Rows can be edited; edits are kept when invoices are pulled again. "Sent to CA" locks the month.
 */
export const gst = Router();
gst.use('/gst', requireAuth, allow('manageGst'));

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const num = (v: unknown) => Number(v ?? 0) || 0;
const monthRange = (p: string) => { const [y, m] = p.split('-').map(Number); const end = new Date(Date.UTC(y, m, 0)).getUTCDate(); return [`${p}-01`, `${p}-${String(end).padStart(2, '0')}`] as const; };
const checkPeriod = (p: string) => { if (!PERIOD.test(p)) throw new HttpError(400, 'Month must look like 2026-11'); return p; };

async function periodRow(cid: number, period: string) {
  return (await db('gst_periods').where({ company_id: cid, period }).first()) ?? { period, status: 'open', note: '' };
}
async function assertOpen(cid: number, period: string) {
  const p = await periodRow(cid, period);
  if (p.status !== 'open') throw new HttpError(409, `${period} is marked “${p.status === 'sent' ? 'sent to CA' : 'filed'}”. Reopen the month to make changes.`);
}

/** Invoice → register rows (one per tax rate). */
function invoiceRows(cid: number, period: string, d: any, company: any) {
  const data = parseJson<Record<string, any>>(d.data, {});
  const totals = parseJson<Record<string, any>>(d.totals, {});
  const lines: any[] = data.lines ?? [];
  const sacByRate = new Map<number, string>();
  for (const l of lines) { const rate = l.gstRate ?? company.defaults?.gstRate ?? 18; if (!sacByRate.has(rate)) sacByRate.set(rate, l.sac || company.defaults?.sac || '998346'); }
  const summary: any[] = totals.taxSummary?.length ? totals.taxSummary : [{ rate: 0, taxable: num(totals.taxable), cgst: num(totals.cgst), sgst: num(totals.sgst), igst: num(totals.igst) }];
  const invValue = num(d.total ?? totals.total);
  return summary.map((t: any) => ({
    company_id: cid, period, kind: 'sales', source: 'invoice', document_id: d.id, doc_no: d.number, doc_date: d.date,
    party: data.client?.name ?? '', gstin: data.client?.gstin ?? '', pos: String(data.placeOfSupply ?? company.stateCode ?? ''), sac: sacByRate.get(t.rate) ?? '998346',
    rate: num(t.rate), taxable: r2(num(t.taxable)), cgst: r2(num(t.cgst)), sgst: r2(num(t.sgst)), igst: r2(num(t.igst)), cess: 0,
    total: summary.length === 1 ? invValue : r2(num(t.taxable) + num(t.cgst) + num(t.sgst) + num(t.igst)),
  }));
}

/** Pull issued invoices of the month into the register. New invoices are added; untouched rows are refreshed; edited or excluded rows are kept. */
async function sync(cid: number, period: string, userId: number) {
  const [from, to] = monthRange(period);
  const company = await getCompany(cid);
  const invoices = await db('documents').where({ company_id: cid, kind: 'invoice' }).whereIn('status', ['issued', 'partly_paid', 'paid', 'cancelled']).andWhere('date', '>=', from).andWhere('date', '<=', to);
  const existing = await db('gst_entries').where({ company_id: cid, period, kind: 'sales', source: 'invoice' });
  let added = 0, refreshed = 0, removed = 0;
  for (const d of invoices) {
    const mine = existing.filter((e) => e.document_id === d.id);
    if (d.status === 'cancelled') {
      for (const e of mine.filter((x) => !x.edited && !x.excluded)) { await db('gst_entries').where({ id: e.id }).update({ excluded: true, note: 'Invoice cancelled', updated_at: now() }); removed++; }
      continue;
    }
    if (mine.some((e) => e.edited || e.excluded)) continue;   // the user changed this invoice's rows – keep them as they are
    const rows = invoiceRows(cid, period, d, company);
    if (mine.length) await db('gst_entries').whereIn('id', mine.map((e) => e.id)).delete();
    for (const r of rows) await insert(db, 'gst_entries', { ...r, created_by: userId, created_at: now(), updated_at: now() });
    if (mine.length) refreshed++; else added++;
  }
  // Vendor bills (sub-contracted tests, equipment, consumables, calibration…) → purchases / input tax credit.
  const bills = await db('purchases as p').leftJoin('vendors as v', 'v.id', 'p.vendor_id').where('p.company_id', cid).andWhere('p.bill_date', '>=', from).andWhere('p.bill_date', '<=', to)
    .select('p.*', 'v.name as vendor_name', 'v.gstin as vendor_gstin', 'v.state_code as vendor_state');
  const prev = await db('gst_entries').where({ company_id: cid, period, kind: 'purchase', source: 'bill' });
  for (const b of bills) {
    const mine = prev.filter((e) => e.document_id === b.id);
    if (mine.some((e) => e.edited || e.excluded)) continue;
    const row = { company_id: cid, period, kind: 'purchase', source: 'bill', document_id: b.id, doc_no: b.bill_no, doc_date: b.bill_date, party: b.vendor_name ?? '', gstin: b.vendor_gstin ?? '',
      pos: String(company.stateCode ?? ''), sac: b.sac ?? '', rate: num(b.rate), taxable: r2(num(b.taxable)), cgst: r2(num(b.cgst)), sgst: r2(num(b.sgst)), igst: r2(num(b.igst)), cess: 0,
      total: r2(num(b.total)), itc_eligible: Boolean(b.itc_eligible), note: `Vendor bill (${b.category})` };
    if (mine.length) await db('gst_entries').whereIn('id', mine.map((e) => e.id)).delete();
    await insert(db, 'gst_entries', { ...row, created_by: userId, created_at: now(), updated_at: now() });
    if (mine.length) refreshed++; else added++;
  }
  const gone = prev.filter((e) => !e.edited && !bills.some((b) => b.id === e.document_id));
  if (gone.length) { await db('gst_entries').whereIn('id', gone.map((e) => e.id)).delete(); removed += gone.length; }
  return { added, refreshed, removed, invoices: invoices.length, bills: bills.length };
}

function summarise(sales: any[], purchases: any[], ownState: string) {
  const live = sales.filter((r) => !r.excluded);
  const sum = (rows: any[], f: string) => r2(rows.reduce((a, r) => a + num(r[f]), 0));
  const b2b = live.filter((r) => r.gstin), b2c = live.filter((r) => !r.gstin);
  const inter = live.filter((r) => r.pos && r.pos !== ownState);
  const itc = purchases.filter((r) => !r.excluded && r.itc_eligible);
  const out = { igst: sum(live, 'igst'), cgst: sum(live, 'cgst'), sgst: sum(live, 'sgst'), cess: sum(live, 'cess') };
  const inp = { igst: sum(itc, 'igst'), cgst: sum(itc, 'cgst'), sgst: sum(itc, 'sgst'), cess: sum(itc, 'cess') };
  const sac = new Map<string, any>();
  for (const r of live) {
    const k = `${r.sac}|${num(r.rate)}`;
    const s = sac.get(k) ?? { sac: r.sac, rate: num(r.rate), count: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, total: 0 };
    s.count++; for (const f of ['taxable', 'igst', 'cgst', 'sgst', 'cess']) s[f] = r2(s[f] + num(r[f])); s.total = r2(s.taxable + s.igst + s.cgst + s.sgst + s.cess);
    sac.set(k, s);
  }
  return {
    outward: { invoices: new Set(live.map((r) => r.document_id ?? `m${r.id}`)).size, taxable: sum(live, 'taxable'), ...out, total: r2(sum(live, 'taxable') + out.igst + out.cgst + out.sgst + out.cess),
      b2b: { count: new Set(b2b.map((r) => r.doc_no)).size, taxable: sum(b2b, 'taxable') }, b2c: { count: new Set(b2c.map((r) => r.doc_no)).size, taxable: sum(b2c, 'taxable') },
      interState: sum(inter, 'taxable'), intraState: r2(sum(live, 'taxable') - sum(inter, 'taxable')) },
    itc: { bills: itc.length, taxable: sum(itc, 'taxable'), ...inp, ineligible: r2(sum(purchases.filter((r) => !r.excluded && !r.itc_eligible), 'igst') + sum(purchases.filter((r) => !r.excluded && !r.itc_eligible), 'cgst') + sum(purchases.filter((r) => !r.excluded && !r.itc_eligible), 'sgst')) },
    net: { igst: r2(out.igst - inp.igst), cgst: r2(out.cgst - inp.cgst), sgst: r2(out.sgst - inp.sgst), cess: r2(out.cess - inp.cess) },
    sac: [...sac.values()].sort((a, b) => a.sac.localeCompare(b.sac) || a.rate - b.rate),
  };
}
const shape = (r: any) => ({ ...r, rate: num(r.rate), taxable: num(r.taxable), cgst: num(r.cgst), sgst: num(r.sgst), igst: num(r.igst), cess: num(r.cess), total: num(r.total), edited: Boolean(r.edited), excluded: Boolean(r.excluded), itc_eligible: Boolean(r.itc_eligible), posName: r.pos ? stateName(r.pos) : '' });

gst.get('/gst/periods', h(async (req) => {
  const cid = req.user.company_id;
  const rows: { period: string; kind: string; n: number; taxable: number; tax: number }[] = await db('gst_entries').where({ company_id: cid, excluded: false })
    .select('period', 'kind', db.raw('COUNT(*) as n'), db.raw('SUM(taxable) as taxable'), db.raw('SUM(cgst + sgst + igst) as tax')).groupBy('period', 'kind') as any;
  const status = new Map((await db('gst_periods').where({ company_id: cid })).map((p) => [p.period, p.status]));
  const months: string[] = []; const d = new Date();
  for (let i = 0; i < 15; i++) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); months.push(x.toISOString().slice(0, 7)); }
  for (const r of rows) if (!months.includes(r.period)) months.push(r.period);
  return months.sort().reverse().map((p) => ({
    period: p, status: status.get(p) ?? 'open',
    sales: rows.filter((r) => r.period === p && r.kind === 'sales').reduce((a, r) => ({ rows: a.rows + Number(r.n), taxable: a.taxable + num(r.taxable), tax: a.tax + num(r.tax) }), { rows: 0, taxable: 0, tax: 0 }),
    purchases: rows.filter((r) => r.period === p && r.kind === 'purchase').reduce((a, r) => ({ rows: a.rows + Number(r.n), tax: a.tax + num(r.tax) }), { rows: 0, tax: 0 }),
  }));
}));

gst.get('/gst/:period', h(async (req) => {
  const cid = req.user.company_id, period = checkPeriod(req.params.period);
  const p = await periodRow(cid, period);
  // open months pick up newly issued invoices automatically
  const pulled = p.status === 'open' ? await sync(cid, period, req.user.id) : null;
  const company = await getCompany(cid);
  const all = (await db('gst_entries').where({ company_id: cid, period }).orderBy([{ column: 'doc_date' }, { column: 'doc_no' }, { column: 'id' }])).map(shape);
  const sales = all.filter((r) => r.kind === 'sales'), purchases = all.filter((r) => r.kind === 'purchase');
  return { period, status: p.status, note: p.note ?? '', pulled, company: { name: company.name, gstin: company.gstin, stateCode: company.stateCode }, sales, purchases, summary: summarise(sales, purchases, String(company.stateCode ?? '')) };
}));

gst.post('/gst/:period/sync', h(async (req) => {
  const cid = req.user.company_id, period = checkPeriod(req.params.period);
  await assertOpen(cid, period);
  return sync(cid, period, req.user.id);
}));

const rowSchema = z.object({
  kind: z.enum(['sales', 'purchase']), doc_no: z.string().trim().min(1, 'Invoice / bill number is required').max(60),
  doc_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'), party: z.string().trim().min(1, 'Party name is required').max(200),
  gstin: z.string().trim().max(20).optional().nullable(), pos: z.string().trim().max(2).optional().nullable(), sac: z.string().trim().max(12).optional().nullable(),
  rate: z.coerce.number().min(0).max(28), taxable: z.coerce.number(), cgst: z.coerce.number().default(0), sgst: z.coerce.number().default(0), igst: z.coerce.number().default(0),
  cess: z.coerce.number().default(0), total: z.coerce.number().optional(), itc_eligible: z.boolean().optional(), note: z.string().max(300).optional().nullable(), excluded: z.boolean().optional(),
});
function cleanRow(b: z.infer<typeof rowSchema>) {
  const gstin = b.gstin ? b.gstin.replace(/\s/g, '').toUpperCase() : '';
  if (gstin) { const v = validateGstin(gstin); if (!v.ok) throw new HttpError(400, `GSTIN: ${v.message}`); }
  return { ...b, gstin, pos: b.pos || (gstin ? gstin.slice(0, 2) : null), total: b.total ?? r2(b.taxable + b.cgst + b.sgst + b.igst + b.cess) };
}

gst.post('/gst/:period/rows', h(async (req) => {
  const cid = req.user.company_id, period = checkPeriod(req.params.period);
  await assertOpen(cid, period);
  const b = cleanRow(rowSchema.parse(req.body));
  if (!b.doc_date.startsWith(period)) throw new HttpError(400, `The date must be in ${period} – or open that month instead`);
  const id = await insert(db, 'gst_entries', { ...b, company_id: cid, period, source: 'manual', edited: true, itc_eligible: b.itc_eligible ?? true, excluded: false, created_by: req.user.id, created_at: now(), updated_at: now() });
  await audit(db, req.user, 'gst', id, `${b.kind === 'sales' ? 'sales' : 'purchase'} row added`, { period, doc: b.doc_no });
  return { id };
}));

gst.put('/gst/rows/:id', h(async (req) => {
  const cid = req.user.company_id;
  const r = await db('gst_entries').where({ id: Number(req.params.id), company_id: cid }).first();
  if (!r) throw new HttpError(404, 'Row not found');
  await assertOpen(cid, r.period);
  const b = rowSchema.partial().parse(req.body);
  const patch: Record<string, unknown> = { ...b };
  if (b.gstin !== undefined) { const c = cleanRow({ ...shape(r), ...b } as any); patch.gstin = c.gstin; if (!b.pos) patch.pos = c.pos; }
  if (['taxable', 'cgst', 'sgst', 'igst', 'cess'].some((k) => k in b) && !('total' in b)) {
    const m = { ...shape(r), ...b }; patch.total = r2(num(m.taxable) + num(m.cgst) + num(m.sgst) + num(m.igst) + num(m.cess));
  }
  delete patch.kind;
  await db('gst_entries').where({ id: r.id }).update({ ...patch, edited: true, updated_at: now() });
  await audit(db, req.user, 'gst', r.id, 'row edited', { period: r.period, doc: r.doc_no, fields: Object.keys(b) });
  return { ok: true };
}));

gst.delete('/gst/rows/:id', h(async (req) => {
  const cid = req.user.company_id;
  const r = await db('gst_entries').where({ id: Number(req.params.id), company_id: cid }).first();
  if (!r) throw new HttpError(404, 'Row not found');
  await assertOpen(cid, r.period);
  // invoice rows are excluded (so pulling invoices again does not bring them back); manual rows are deleted
  if (r.source === 'invoice') await db('gst_entries').where({ id: r.id }).update({ excluded: true, edited: true, updated_at: now() });
  else await db('gst_entries').where({ id: r.id }).delete();
  await audit(db, req.user, 'gst', r.id, r.source === 'invoice' ? 'invoice row excluded' : 'row deleted', { period: r.period, doc: r.doc_no });
  return { ok: true };
}));

/** Undo edits on an invoice's rows: rebuild them from the invoice. */
gst.post('/gst/rows/:id/reset', h(async (req) => {
  const cid = req.user.company_id;
  const r = await db('gst_entries').where({ id: Number(req.params.id), company_id: cid }).first();
  if (!r || r.source !== 'invoice') throw new HttpError(400, 'Only rows that came from an invoice can be reset');
  await assertOpen(cid, r.period);
  await db('gst_entries').where({ company_id: cid, document_id: r.document_id, period: r.period }).delete();
  await sync(cid, r.period, req.user.id);
  return { ok: true };
}));

gst.put('/gst/:period/status', h(async (req) => {
  const cid = req.user.company_id, period = checkPeriod(req.params.period);
  const { status, note } = z.object({ status: z.enum(['open', 'sent', 'filed']), note: z.string().max(500).optional() }).parse(req.body);
  const ex = await db('gst_periods').where({ company_id: cid, period }).first();
  const row = { status, note: note ?? ex?.note ?? null, updated_by: req.user.id, updated_at: now() };
  if (ex) await db('gst_periods').where({ id: ex.id }).update(row); else await db('gst_periods').insert({ company_id: cid, period, ...row });
  await audit(db, req.user, 'gst', 0, `${period} marked ${status}`, { period, note });
  return { ok: true };
}));
