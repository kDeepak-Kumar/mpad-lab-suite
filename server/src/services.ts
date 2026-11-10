import crypto from 'node:crypto';
import type { Knex } from 'knex';
import {
  counterScope, formatNumber, formatDate, DEFAULT_NUMBERING, type ObservationTemplate, evaluateObservation,
  formatValue, stateName, type ObservationInput, reportSpec, reportTableRows, chartSeries, allCharts, fillRefs, reportTexts, reportInfoRows, boreLogData, evaluate, isError, partShown, type BoreLogData, snapTest, type TestSnap, type ExtraValue, type ReportCustomer,
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
  return { seq, number: formatNumber(format, seq, { ...ctx, cert: company.accreditation?.certNo }) };
}

/** Format a number with an existing sequence (e.g. ULR shares the sample's running number). */
export async function formatWithSeq(cid: number, kind: string, seq: number, ctx: { date: string; client?: string; material?: string }, k: Knex = db) {
  const company = await getCompany(cid, k);
  return formatNumber(company.numbering?.[kind] || DEFAULT_NUMBERING[kind], seq, { ...ctx, cert: company.accreditation?.certNo });
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
    /** Default discount: the site's if set, otherwise the client's. */
    defaultDiscountPct: site?.discount_pct !== null && site?.discount_pct !== undefined ? Number(site.discount_pct) : c.discount_pct !== null && c.discount_pct !== undefined ? Number(c.discount_pct) : 0,
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
  type Series = { label: string; dashed?: boolean; markers?: boolean; points: [number, number][] };
  const charts: { title: string; xLabel: string; yLabel: string; sample: string; xLog?: boolean; yLog?: boolean; yReverse?: boolean; xTop?: boolean; xMin?: number; xMax?: number; yMin?: number; yMax?: number; fit?: string; note?: string; points: [number, number][]; series: Series[] }[] = [];
  const tables: { title: string; sample: string; columns: string[]; rows: string[][] }[] = [];
  type Table = { title: string; sample: string; columns: string[]; rows: string[][] };
  const details: { title: string; sample: string; info: [string, string][]; texts: { title?: string; text: string }[]; tables: Table[]; charts: typeof charts }[] = [];
  const borelogs: (BoreLogData & { sample: string })[] = [];
  const intros: { code: string; title: string; texts: { title?: string; text: string }[] }[] = [];
  const notes: string[] = [];
  const nabl: boolean[] = [];
  const snaps: TestSnap[] = [];
  // results already issued on an earlier report (e.g. 7-day cubes repeated on the 28-day report)
  const repIds = [...new Set(tests.map((t) => t.report_id).filter(Boolean))] as number[];
  const issuedOn = new Map((repIds.length ? await db('documents').whereIn('id', repIds).whereIn('status', ['issued']).select('id', 'number') : []).map((r) => [r.id as number, r.number as string]));
  const sorted = tests.sort((a, b) => (a.catalog_id as number) - (b.catalog_id as number) || (a.id as number) - (b.id as number));
  const perKey = new Map<string, number>();
  for (const t of sorted) { const k = `${t.template_code}|${t.sample_id}`; perKey.set(k, (perKey.get(k) ?? 0) + 1); }
  for (const t of sorted) {
    const tpl = await getObsTemplate(cid, t.template_code as string, t.template_version as number);
    const cat = catById.get(t.catalog_id);
    nabl.push(Boolean(cat?.nabl));
    if (cat?.report_notes) for (const n of String(cat.report_notes).split('\n').map((s) => s.trim()).filter(Boolean)) if (!notes.includes(n)) notes.push(n);
    const sIdx = sampleIds.indexOf(t.sample_id as number);
    const sampleLabel = samples[sIdx]?.sample_label || samples[sIdx]?.code || '';
    const results = (t.results ?? {}) as Record<string, unknown>;
    const obsIn = (t.observation ?? { header: {}, grids: {} }) as ObservationInput;
    const res = evaluateObservation(tpl, obsIn);
    const shown = (key: string) => partShown(tpl, obsIn.show, key);
    const lv = tpl.reportLabel ? evaluate(tpl.reportLabel, (n) => res.scalars[n] ?? res.results[n]) : '';
    const label = lv && !isError(lv) ? formatValue(lv) : '';
    const multi = (perKey.get(`${t.template_code}|${t.sample_id}`) ?? 1) > 1;
    const suffix = sampleIds.length > 1 ? ` – ${sampleLabel}` : '';
    // Results from an external (sub-contracted) laboratory are identified on the report – ISO/IEC 17025 clause 7.8.2.1 (p).
    const ext = (obsIn as { external?: { vendor?: string; nabl?: string; reportNo?: string; reportDate?: string } }).external;
    if (ext?.vendor) {
      const n = `* ${cat?.report_name || tpl.name}: tested by external laboratory ${ext.vendor}${ext.nabl ? ` (NABL accreditation ${ext.nabl})` : ''}${ext.reportNo ? `, their test report no. ${ext.reportNo}` : ''}${ext.reportDate ? ` dated ${formatDate(ext.reportDate)}` : ''}.`;
      if (!notes.includes(n)) notes.push(n);
    }
    for (const rr of tpl.reportRows.filter((x) => shown(`row:${x.group ?? ''}|${x.name}|${x.unit}`))) {
      // direct-entry sheets (water, chemical): a parameter left blank was not tested – leave it off the report
      if (!tpl.grids.length && formatValue(results[rr.result] as never, rr.decimals) === '') continue;
      const group = multi && label ? label : rr.group;
      const key = `${tpl.code}|${multi ? label : ''}|${rr.group ?? ''}|${rr.name}|${rr.unit}`;
      let r = rows.find((x) => x.key === key);
      if (!r) { r = { key, group, name: ext?.vendor ? `${rr.name} *` : rr.name, unit: rr.unit, method: cat?.method || tpl.method, spec: '', values: sampleIds.map(() => '') }; rows.push(r); }
      r.values[sIdx] = formatValue(results[rr.result] as never, rr.decimals);
      if (!r.spec) r.spec = reportSpec(rr, res);
    }
    const dTables: Table[] = [];
    for (const rt of (tpl.reportTables ?? []).filter((x) => shown(`table:${x.title}`))) {
      const body = reportTableRows(tpl, rt, res);
      if (body.length) dTables.push({ title: rt.title, sample: sampleIds.length > 1 ? sampleLabel : '', columns: rt.columns.map((c) => c.label), rows: body });
    }
    if (tpl.reportIntro?.length && !intros.some((x) => x.code === tpl.code)) intros.push({ code: tpl.code, title: cat?.report_name || tpl.name, texts: reportTexts(tpl, res, 'intro') });
    const info = shown('info') ? reportInfoRows(tpl, res) : [], texts = shown('text') ? reportTexts(tpl, res) : [];
    const dCharts: typeof charts = [];
    for (const ch of allCharts(tpl).filter((c) => shown(`chart:${c.title}`))) {
      const series = chartSeries(tpl, res, ch);
      if ((series[0]?.points.length ?? 0) > 1) {
        const { grid: _g, x: _x, y: _y, series: _s, report: _r, note, title, ...opts } = ch;
        const c = { ...opts, title: `${title}${label ? ` – ${label}` : ''}${suffix}`, sample: samples[sIdx]?.code, note: note ? fillRefs(note, res) : undefined, points: series[0].points, series };
        dCharts.push(c); charts.push(c);
      }
    }
    if (info.length || texts.length || dTables.length || dCharts.length) details.push({ title: label || cat?.report_name || tpl.name, sample: sampleIds.length > 1 ? sampleLabel : '', info, texts, tables: dTables, charts: dCharts });
    const bl = boreLogData(tpl, res);
    if (bl && bl.strata.length) borelogs.push({ ...bl, title: bl.title || label, sample: sampleLabel });
    snaps.push(snapTest(t as never, tpl, res, obsIn, { name: cat?.report_name || tpl.name, method: cat?.method || tpl.method, sample: sIdx, sampleCode: samples[sIdx]?.code ?? '', sampleLabel: samples[sIdx]?.sample_label || (sampleIds.length > 1 ? `Sample-${String(sIdx + 1).padStart(2, '0')}` : ''), shown }));
    if (t.report_id && issuedOn.has(t.report_id as number)) snaps[snaps.length - 1].previous = issuedOn.get(t.report_id as number) || 'earlier report';
  }
  const { customer, extra } = await reportCustomer(cid, samples);
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
    tables, charts, details, borelogs, intros, notes, remarks: '',
    quantity: [...new Set(samples.map((x) => x.quantity).filter(Boolean))].join('; '),
    receivedTime: s0?.received_time || '',
    customerRefDate: s0?.customer_ref_date ? formatDate(s0.customer_ref_date) : '',
    packing: s0?.packing || '',
    testLocation: s0?.test_location || 'Laboratory (permanent facility)',
    envText: envText(sorted, snaps),
    tests: snaps, customer, extra,
  };
}

/** Environmental conditions during testing: from the test record, else the observation sheet (temp / rh). */
function envText(tests: Record<string, any>[], snaps: TestSnap[]): string {
  const parts: string[] = [];
  tests.forEach((t, i) => {
    const s = snaps[i];
    const temp = t.env_temp || s?.header.temp, rh = t.env_rh || s?.header.rh;
    if (!temp && !rh) return;
    const v = [temp && `${temp} °C`, rh && `${rh} % RH`].filter(Boolean).join(', ');
    if (!parts.includes(v)) parts.push(v);
  });
  return parts.join('; ');
}

/** Client-specific additional information fields (defined on the client, values captured on each sample). */
export interface ExtraFieldDef { key: string; label: string; type?: 'text' | 'number' | 'date' | 'select'; options?: string[]; onReport?: boolean }
export const extraFieldDefs = (client: { data?: unknown } | null | undefined): ExtraFieldDef[] =>
  (parseJson<{ extraFields?: ExtraFieldDef[] }>(client?.data as string, {}).extraFields ?? []).filter((f) => f?.key && f.label);

/** Customer block of a report from the client master, the site (project) and the samples (customer reference). */
export async function reportCustomer(cid: number, samples: Record<string, any>[]): Promise<{ customer: ReportCustomer; extra: ExtraValue[] }> {
  const s0 = samples[0];
  const client = s0 ? await db('clients').where({ id: s0.client_id, company_id: cid }).first() : null;
  const site = s0?.site_id ? await db('sites').where({ id: s0.site_id, company_id: cid }).first() : null;
  const contacts = client ? await db('contacts').where({ company_id: cid, client_id: client.id }).orderBy('id') : [];
  const contact = contacts.find((c) => site && c.site_id === site.id) ?? contacts[0] ?? null;
  const refs = [...new Set(samples.map((x) => x.customer_ref).filter(Boolean))];
  const customer: ReportCustomer = {
    name: client?.name ?? '', address: client?.address ?? '', gstin: client?.gstin ?? '',
    project: site ? (site.project || site.name) : '', customerRef: refs.join(', '),
    contact: contact ? { name: contact.name, phone: contact.phone || client?.phone || '', email: contact.email || client?.email || '' } : (client?.phone || client?.email ? { phone: client.phone, email: client.email } : null),
  };
  const defs = extraFieldDefs(client);
  const extra: ExtraValue[] = [];
  samples.forEach((smp, i) => {
    const vals = parseJson<{ extra?: Record<string, unknown> }>(smp.data, {}).extra ?? {};
    for (const f of defs) {
      if (f.onReport === false) continue;
      let v = vals[f.key];
      if (v === undefined || v === null || v === '') continue;
      if (f.type === 'date') v = formatDate(String(v));
      extra.push({ key: f.key, label: f.label, value: String(v), sample: samples.length > 1 ? (smp.sample_label || smp.code) : '' });
    }
  });
  return { customer, extra };
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
