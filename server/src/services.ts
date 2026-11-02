import crypto from 'node:crypto';
import type { Knex } from 'knex';
import {
  counterScope, formatNumber, formatDate, DEFAULT_NUMBERING, type ObservationTemplate, evaluateObservation,
  formatValue, stateName, type ObservationInput, reportSpec, reportTableRows, chartSeries,
} from '@suite/shared';
import { db, insert, now, parseJson, row, toJson } from './db';
import { HttpError, type AuthUser } from './auth';

export interface CompanyProfile {
  id: number; name: string; legalName?: string; tagline?: string; cin?: string; gstin?: string; pan?: string;
  stateCode?: string; address?: string; phone?: string; email?: string; website?: string; jurisdiction?: string;
  accreditation?: { body?: string; certNo?: string; validTill?: string };
  logo?: string; accreditationLogo?: string; seal?: string;
  bank?: { name?: string; branch?: string; ifsc?: string; bank?: string; account?: string; upi?: string };
  numbering?: Record<string, string>;
  defaults?: { gstRate?: number; sac?: string; validityDays?: number; quoteNotes?: string; reportNotes?: string; paymentTermsDays?: number; releaseOnPayment?: boolean };
  smtp?: { host?: string; port?: number; secure?: boolean; user?: string; from?: string };
  [k: string]: unknown;
}

export async function getCompany(cid: number, k: Knex = db): Promise<CompanyProfile> {
  const c = await k('companies').where({ id: cid }).first();
  if (!c) throw new HttpError(404, 'Company not found');
  return { ...parseJson<Record<string, unknown>>(c.data, {}), id: c.id, name: c.name } as CompanyProfile;
}

/** Gap-free running numbers per company, kind and period (financial year / calendar year). */
export async function nextNumber(trx: Knex, cid: number, kind: string, ctx: { date: string; client?: string; material?: string }) {
  const company = await getCompany(cid, trx);
  const format = company.numbering?.[kind] || DEFAULT_NUMBERING[kind] || `${kind.toUpperCase()}/{SEQ}`;
  const scope = counterScope(format, ctx.date);
  const cur = await trx('counters').where({ company_id: cid, kind, scope }).forUpdate().first();
  const seq = (cur?.value ?? 0) + 1;
  if (cur) await trx('counters').where({ company_id: cid, kind, scope }).update({ value: seq });
  else await trx('counters').insert({ company_id: cid, kind, scope, value: seq });
  return { seq, number: formatNumber(format, seq, ctx) };
}

/** Format a number with an existing sequence (e.g. ULR shares the sample's running number). */
export async function formatWithSeq(cid: number, kind: string, seq: number, ctx: { date: string; client?: string; material?: string }, k: Knex = db) {
  const company = await getCompany(cid, k);
  return formatNumber(company.numbering?.[kind] || DEFAULT_NUMBERING[kind], seq, ctx);
}

export async function audit(k: Knex, u: AuthUser, entity: string, id: number, action: string, detail?: unknown) {
  await k('audit_log').insert({ company_id: u.company_id, user_id: u.id, entity, entity_id: id, action, detail: toJson(detail ?? null), at: now() });
}

export const sha256 = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

export async function clientSnapshot(cid: number, clientId: number, siteId?: number | null, contactId?: number | null) {
  const c = await db('clients').where({ id: clientId, company_id: cid }).first();
  if (!c) throw new HttpError(404, 'Client not found');
  const site = siteId ? await db('sites').where({ id: siteId, company_id: cid }).first() : null;
  const contact = contactId ? await db('contacts').where({ id: contactId, company_id: cid }).first() : null;
  return {
    client: { id: c.id, name: c.name, address: c.address, gstin: c.gstin, stateCode: c.state_code, stateName: stateName(c.state_code), shortCode: c.short_code, email: c.email, phone: c.phone },
    site: site ? { id: site.id, name: site.name, address: site.address, project: site.project, po: site.po_number } : null,
    contact: contact ? { id: contact.id, name: contact.name, phone: contact.phone, email: contact.email } : null,
  };
}

export async function getObsTemplate(cid: number, code: string, version?: number | null, k: Knex = db): Promise<ObservationTemplate & { _id: number }> {
  const q = k('obs_templates').where({ company_id: cid, code });
  const r = version ? await q.andWhere({ version }).first() : await q.orderBy('version', 'desc').first();
  if (!r) throw new HttpError(404, `Observation template ${code} not found`);
  return { ...parseJson<ObservationTemplate>(r.definition, {} as ObservationTemplate), version: r.version, _id: r.id };
}

export async function getDocTemplate(cid: number, kind: string, id?: number | null) {
  const r = id ? await db('doc_templates').where({ id, company_id: cid }).first()
    : await db('doc_templates').where({ company_id: cid, kind }).orderBy([{ column: 'is_default', order: 'desc' }, { column: 'version', order: 'desc' }]).first();
  return row(r, ['definition']);
}

const rangeText = (dates: (string | null | undefined)[]) => {
  const d = dates.filter(Boolean).sort() as string[];
  if (!d.length) return '';
  return d[0] === d[d.length - 1] ? formatDate(d[0]) : `${formatDate(d[0])} to ${formatDate(d[d.length - 1])}`;
};

/** Build the data snapshot of a test report from accepted tests on one or more samples. */
export async function buildReportData(cid: number, testIds: number[]) {
  const tests = (await db('tests').whereIn('id', testIds).andWhere({ company_id: cid })).map((t) => row(t, ['observation', 'results', 'checks'])!);
  if (!tests.length) throw new HttpError(400, 'Select at least one accepted test');
  const bad = tests.find((t) => t.status !== 'accepted' && t.status !== 'reported');
  if (bad) throw new HttpError(400, 'Only tests accepted by a reviewer can go on a report');
  const sampleIds = [...new Set(tests.map((t) => t.sample_id as number))];
  const samples = await db('samples').whereIn('id', sampleIds).orderBy('id');
  const clientIds = new Set(samples.map((s) => s.client_id));
  if (clientIds.size > 1) throw new HttpError(400, 'All samples on one report must belong to the same client');
  const catalog = await db('catalog').whereIn('id', tests.map((t) => t.catalog_id).filter(Boolean));
  const catById = new Map(catalog.map((c) => [c.id, c]));

  const rows: { key: string; group?: string; name: string; unit: string; method: string; spec: string; values: string[] }[] = [];
  const charts: { title: string; xLabel: string; yLabel: string; sample: string; xLog?: boolean; fit?: string; points: [number, number][]; series: { label: string; dashed?: boolean; markers?: boolean; points: [number, number][] }[] }[] = [];
  const tables: { title: string; sample: string; columns: string[]; rows: string[][] }[] = [];
  const notes: string[] = [];
  const nabl: boolean[] = [];
  for (const t of tests.sort((a, b) => (a.catalog_id as number) - (b.catalog_id as number) || (a.id as number) - (b.id as number))) {
    const tpl = await getObsTemplate(cid, t.template_code as string, t.template_version as number);
    const cat = catById.get(t.catalog_id);
    nabl.push(Boolean(cat?.nabl));
    if (cat?.report_notes) for (const n of String(cat.report_notes).split('\n').map((s) => s.trim()).filter(Boolean)) if (!notes.includes(n)) notes.push(n);
    const sIdx = sampleIds.indexOf(t.sample_id as number);
    const sampleLabel = samples[sIdx]?.sample_label || samples[sIdx]?.code || '';
    const results = (t.results ?? {}) as Record<string, unknown>;
    const res = evaluateObservation(tpl, (t.observation ?? { header: {}, grids: {} }) as ObservationInput);
    for (const rr of tpl.reportRows) {
      const key = `${tpl.code}|${rr.group ?? ''}|${rr.name}`;
      let r = rows.find((x) => x.key === key);
      if (!r) { r = { key, group: rr.group, name: rr.name, unit: rr.unit, method: cat?.method || tpl.method, spec: '', values: sampleIds.map(() => '') }; rows.push(r); }
      r.values[sIdx] = formatValue(results[rr.result] as never, rr.decimals);
      if (!r.spec) r.spec = reportSpec(rr, res);
    }
    for (const rt of tpl.reportTables ?? []) {
      const body = reportTableRows(tpl, rt, res);
      if (body.length) tables.push({ title: rt.title, sample: sampleIds.length > 1 ? sampleLabel : '', columns: rt.columns.map((c) => c.label), rows: body });
    }
    if (tpl.chart) {
      const series = chartSeries(tpl, res);
      if ((series[0]?.points.length ?? 0) > 1)
        charts.push({ title: `${tpl.chart.title} – ${samples[sIdx]?.code ?? ''}`, xLabel: tpl.chart.xLabel, yLabel: tpl.chart.yLabel, sample: samples[sIdx]?.code, xLog: tpl.chart.xLog, fit: tpl.chart.fit, points: series[0].points, series });
    }
  }
  const company = await getCompany(cid);
  for (const n of (company.defaults?.reportNotes ?? '').split('\n').map((s) => s.trim()).filter(Boolean)) if (!notes.includes(n)) notes.push(n);
  const s0 = samples[0];
  const material = s0?.material ?? '';
  return {
    sampleIds, testIds: tests.map((t) => t.id),
    samples: samples.map((s, i) => ({ id: s.id, code: s.code, ulr: s.ulr, label: s.sample_label || `Sample-${String(i + 1).padStart(2, '0')}` })),
    jobCodeText: samples.map((s) => `${s.material ? s.material + ' : ' : ''}${s.code}`).join(', '),
    ulr: samples.map((s) => s.ulr).filter(Boolean).join(', '),
    receivedText: rangeText(samples.map((s) => s.received_date)),
    testDatesText: rangeText([...tests.map((t) => t.started_at), ...tests.map((t) => t.completed_at)]),
    specification: s0?.specification || material,
    condition: s0?.condition || '',
    source: s0?.source || '',
    customerRef: s0?.customer_ref || '',
    material, materialUpper: material.toUpperCase(),
    nablAll: nabl.length > 0 && nabl.every(Boolean),
    rows: rows.map(({ key: _k, ...r }) => r),
    tables, charts, notes, remarks: '',
  };
}

/** Client ledger: opening balance, issued invoices (debit), payments and TDS (credit), running balance. */
export async function ledger(cid: number, clientId: number) {
  const c = await db('clients').where({ id: clientId, company_id: cid }).first();
  if (!c) throw new HttpError(404, 'Client not found');
  const invoices = await db('documents').where({ company_id: cid, client_id: clientId, kind: 'invoice' }).whereIn('status', ['issued', 'paid', 'partly_paid']);
  const payments = await db('payments').where({ company_id: cid, client_id: clientId });
  type E = { date: string; type: string; ref: string; id: number; debit: number; credit: number; balance?: number };
  const entries: E[] = [];
  for (const i of invoices) entries.push({ date: i.date, type: 'Invoice', ref: i.number, id: i.id, debit: Number(i.total), credit: 0 });
  for (const p of payments) {
    entries.push({ date: p.date, type: `Payment (${p.mode || 'receipt'})`, ref: p.number, id: p.id, debit: 0, credit: Number(p.amount) });
    if (Number(p.tds) > 0) entries.push({ date: p.date, type: 'TDS deducted by client', ref: p.number, id: p.id, debit: 0, credit: Number(p.tds) });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || (a.debit ? -1 : 1));
  let bal = Number(c.opening_balance || 0);
  for (const e of entries) { bal = Math.round((bal + e.debit - e.credit) * 100) / 100; e.balance = bal; }
  return { client: { id: c.id, name: c.name }, opening: Number(c.opening_balance || 0), entries, balance: bal };
}

/** Amount received against an invoice (allocations from payments, incl. TDS). */
export async function paidAgainst(cid: number, k: Knex = db): Promise<Map<number, number>> {
  const pays = await k('payments').where({ company_id: cid });
  const m = new Map<number, number>();
  for (const p of pays) for (const a of parseJson<{ invoiceId: number; amount: number }[]>(p.allocations, [])) m.set(a.invoiceId, (m.get(a.invoiceId) ?? 0) + Number(a.amount));
  return m;
}

export async function refreshInvoiceStatus(k: Knex, cid: number, invoiceIds: number[]) {
  const paid = await paidAgainst(cid, k);
  for (const id of invoiceIds) {
    const inv = await k('documents').where({ id, company_id: cid, kind: 'invoice' }).first();
    if (!inv || inv.status === 'draft' || inv.status === 'cancelled') continue;
    const got = paid.get(id) ?? 0;
    const status = got >= Number(inv.total) - 0.5 ? 'paid' : got > 0 ? 'partly_paid' : 'issued';
    await k('documents').where({ id }).update({ status });
  }
}

export { insert };
