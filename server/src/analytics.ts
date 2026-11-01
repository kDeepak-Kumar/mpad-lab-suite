import { Router } from 'express';
import { z } from 'zod';
import { runReport, withTime, REPORT_OBJECTS, DATE_PRESETS, type ReportSpec, type LineInput } from '@suite/shared';
import { db, parseJson, today } from './db';
import { allow, h, HttpError, type AuthUser } from './auth';
import { getCompany, paidAgainst } from './services';

export const analytics = Router();

/** Flatten business data into report rows (small-company volumes fit comfortably in memory). */
export async function loadRows(cid: number, object: string): Promise<Record<string, any>[]> {
  const clients = new Map((await db('clients').where({ company_id: cid }).select('id', 'name', 'payment_terms_days')).map((c) => [c.id, c]));
  const sites = new Map((await db('sites').where({ company_id: cid }).select('id', 'name')).map((s) => [s.id, s.name]));
  const cname = (id: number) => clients.get(id)?.name ?? '';
  const td = today();
  const daysSince = (d: string) => Math.floor((Date.parse(td) - Date.parse(d)) / 86400000);
  if (object === 'invoices' || object === 'invoice_lines' || object === 'outstanding') {
    const docs = await db('documents').where({ company_id: cid, kind: 'invoice' }).whereIn('status', ['issued', 'paid', 'partly_paid']);
    const paid = await paidAgainst(cid);
    if (object === 'invoice_lines') {
      const cats = new Map((await db('catalog').where({ company_id: cid }).select('id', 'material', 'report_name', 'billing_name')).map((c) => [c.id, c]));
      return docs.flatMap((d) => {
        const t = parseJson<{ lines?: (LineInput & { net?: number; amount?: number })[] }>(d.totals, {});
        return (t?.lines ?? parseJson<{ lines?: LineInput[] }>(d.data, {}).lines ?? []).map((l: any) => withTime({
          date: d.date, client: cname(d.client_id), site: sites.get(d.site_id) ?? '', accreditation: d.accreditation ?? '',
          test: (l.catalogId && (cats.get(l.catalogId)?.report_name || cats.get(l.catalogId)?.billing_name)) || l.description, material: (l.catalogId && cats.get(l.catalogId)?.material) || '',
          qty: Number(l.qty ?? 1), amount: Number(l.net ?? l.amount ?? (l.qty ?? 1) * l.rate),
        }, d.date));
      });
    }
    const rows = docs.map((d) => {
      const t = parseJson<Record<string, number>>(d.totals, {});
      const received = paid.get(d.id) ?? 0, total = Number(d.total);
      const balance = Math.round((total - received) * 100) / 100, days = daysSince(d.date);
      return withTime({
        date: d.date, number: d.number, client: cname(d.client_id), site: sites.get(d.site_id) ?? '', accreditation: d.accreditation ?? '', status: d.status,
        total, taxable: Number(t?.taxable ?? 0), gst: Number((t?.cgst ?? 0) + (t?.sgst ?? 0) + (t?.igst ?? 0)), received, balance, days,
        ageing: days <= 30 ? '0–30 days' : days <= 60 ? '31–60 days' : days <= 90 ? '61–90 days' : '90+ days',
      }, d.date);
    });
    return object === 'outstanding' ? rows.filter((r) => r.balance > 0.5) : rows;
  }
  if (object === 'quotes') {
    const docs = await db('documents').where({ company_id: cid, kind: 'quote' }).whereNot('status', 'cancelled');
    return docs.map((d) => withTime({ date: d.date, client: cname(d.client_id), site: sites.get(d.site_id) ?? '', status: d.status, accreditation: d.accreditation ?? '', total: Number(d.total) }, d.date));
  }
  if (object === 'samples') {
    const s = await db('samples').where({ company_id: cid });
    const counts = new Map((await db('tests').where({ company_id: cid }).select('sample_id').count({ n: 'id' }).groupBy('sample_id') as { sample_id: number; n: number }[]).map((x) => [x.sample_id, Number(x.n)]));
    return s.map((x) => withTime({ date: x.received_date, client: cname(x.client_id), site: sites.get(x.site_id) ?? '', material: x.material, accreditation: x.accreditation ?? '', status: x.status, tests: counts.get(x.id) ?? 0 }, x.received_date));
  }
  if (object === 'tests') {
    const t = await db('tests as t').join('samples as s', 's.id', 't.sample_id').leftJoin('catalog as k', 'k.id', 't.catalog_id').leftJoin('users as u', 'u.id', 't.entered_by')
      .where('t.company_id', cid).select('t.status', 't.completed_at', 't.due_date', 's.received_date', 's.client_id', 's.material', 's.accreditation', 'k.report_name', 'k.billing_name', 'k.rate', 'u.name as tech');
    return t.map((x) => {
      const date = x.completed_at || x.due_date;
      return withTime({ date, test: x.report_name || x.billing_name, material: x.material, client: cname(x.client_id), status: x.status, technician: x.tech ?? '', accreditation: x.accreditation ?? '',
        tat: x.completed_at && x.received_date ? Math.max(0, Math.round((Date.parse(x.completed_at) - Date.parse(x.received_date)) / 86400000)) : null, value: Number(x.rate ?? 0) }, date);
    });
  }
  if (object === 'payments') {
    const p = await db('payments').where({ company_id: cid });
    return p.map((x) => withTime({ date: x.date, client: cname(x.client_id), mode: x.mode, amount: Number(x.amount), tds: Number(x.tds) }, x.date));
  }
  throw new HttpError(400, `Unknown report object ${object}`);
}

const filterSchema = z.object({ field: z.string(), op: z.enum(['eq', 'neq', 'in', 'contains', 'gt', 'gte', 'lt', 'lte']), value: z.any() });
export const specSchema = z.object({
  title: z.string().optional(), object: z.string(),
  dateRange: z.object({ preset: z.string().optional(), from: z.string().optional(), to: z.string().optional() }).optional(),
  filters: z.array(filterSchema).optional(), groupBy: z.array(z.string()).max(2).optional(),
  measure: z.object({ agg: z.enum(['count', 'sum', 'avg', 'min', 'max']), field: z.string().optional() }),
  sort: z.enum(['value_desc', 'value_asc', 'label']).optional(), limit: z.number().optional(),
  chart: z.enum(['bar', 'hbar', 'line', 'pie', 'table', 'number']).optional(), forecast: z.number().max(12).optional(),
});

export async function run(cid: number, spec: ReportSpec) {
  const obj = REPORT_OBJECTS.find((o) => o.key === spec.object);
  if (!obj) throw new HttpError(400, 'Unknown report object');
  if (spec.measure.agg !== 'count' && !obj.fields.some((f) => f.key === spec.measure.field && f.measure)) throw new HttpError(400, `Cannot ${spec.measure.agg} ${spec.measure.field}`);
  return runReport(await loadRows(cid, spec.object), spec, today());
}

analytics.post('/analytics/run', allow('viewAnalytics'), h(async (req) => run(req.user.company_id, specSchema.parse(req.body) as ReportSpec)));

analytics.get('/analytics/insights', allow('viewAnalytics'), h(async (req) => {
  const cid = req.user.company_id, td = today();
  const inv = await loadRows(cid, 'invoices');
  const sum = (rows: Record<string, any>[], f: string) => rows.reduce((a, r) => a + Number(r[f] ?? 0), 0);
  const month = td.slice(0, 7);
  const lastMonthKey = (() => { const [y, m] = month.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; })();
  const thisMonth = sum(inv.filter((r) => r.month === month), 'total');
  const lastMonth = sum(inv.filter((r) => r.month === lastMonthKey), 'total');
  const trend = runReport(inv, { object: 'invoices', measure: { agg: 'sum', field: 'total' }, groupBy: ['month'], dateRange: { preset: 'last_12_months' }, forecast: 1 }, td);
  const forecastNext = trend.rows.find((r) => r.forecast)?.value ?? null;
  const quotes = await loadRows(cid, 'quotes');
  const pipeline = quotes.filter((q) => q.status === 'sent');
  const decided = quotes.filter((q) => ['accepted', 'rejected', 'expired'].includes(q.status));
  const conversion = decided.length ? Math.round((quotes.filter((q) => q.status === 'accepted').length / decided.length) * 100) : null;
  const out = await loadRows(cid, 'outstanding');
  const clients = new Map((await db('clients').where({ company_id: cid }).select('name', 'payment_terms_days')).map((c) => [c.name, Number(c.payment_terms_days ?? 30)]));
  const overdue = out.filter((r) => r.days > (clients.get(r.client) ?? 30));
  // unbilled: value of accepted/reported tests on work orders beyond what has been invoiced
  const wos = await db('work_orders').where({ company_id: cid }).select('id', 'client_id');
  let unbilled = 0; const unbilledByClient = new Map<string, number>();
  const cn = new Map((await db('clients').where({ company_id: cid }).select('id', 'name')).map((c) => [c.id, c.name]));
  for (const w of wos) {
    const tested = await db('tests as t').join('samples as s', 's.id', 't.sample_id').join('catalog as k', 'k.id', 't.catalog_id').where('s.work_order_id', w.id).whereIn('t.status', ['accepted', 'reported']).sum({ v: 'k.rate' }).first();
    const billed = (await db('documents').where({ company_id: cid, kind: 'invoice', work_order_id: w.id }).whereNot('status', 'cancelled')).reduce((a, d) => a + Number(parseJson<any>(d.totals, {})?.taxable ?? 0), 0);
    const gap = Math.max(0, Number(tested?.v ?? 0) - billed);
    if (gap > 0) { unbilled += gap; unbilledByClient.set(cn.get(w.client_id) ?? '', (unbilledByClient.get(cn.get(w.client_id) ?? '') ?? 0) + gap); }
  }
  const tests = await loadRows(cid, 'tests');
  const dueNext7 = tests.filter((t) => ['pending', 'in_progress', 'returned'].includes(t.status) && t.date && t.date >= td && t.date <= new Date(Date.parse(td) + 7 * 864e5).toISOString().slice(0, 10)).length;
  const overdueTests = tests.filter((t) => ['pending', 'in_progress', 'returned'].includes(t.status) && t.date && t.date < td).length;
  const tats = tests.filter((t) => t.tat !== null && t.tat !== undefined && t.date >= new Date(Date.parse(td) - 90 * 864e5).toISOString().slice(0, 10)).map((t) => t.tat as number);
  // clients whose revenue dropped: last 90 days vs the 90 days before
  const d90 = new Date(Date.parse(td) - 90 * 864e5).toISOString().slice(0, 10), d180 = new Date(Date.parse(td) - 180 * 864e5).toISOString().slice(0, 10);
  const byClient = (from: string, to: string) => { const m = new Map<string, number>(); for (const r of inv) if (r.date >= from && r.date < to) m.set(r.client, (m.get(r.client) ?? 0) + r.total); return m; };
  const recent = byClient(d90, '9999'), before = byClient(d180, d90);
  const attention: { kind: string; text: string; level: 'info' | 'warning' | 'danger' }[] = [];
  for (const [c, v] of before) { const now2 = recent.get(c) ?? 0; if (v > 0 && now2 < v * 0.6) attention.push({ kind: 'Revenue drop', text: `${c}: ₹${Math.round(now2).toLocaleString('en-IN')} in the last 90 days vs ₹${Math.round(v).toLocaleString('en-IN')} before`, level: 'warning' }); }
  for (const r of overdue.sort((a, b) => b.balance - a.balance).slice(0, 5)) attention.push({ kind: 'Overdue', text: `${r.client}: invoice ${r.number} ₹${Math.round(r.balance).toLocaleString('en-IN')} for ${r.days} days`, level: 'danger' });
  for (const [c, v] of [...unbilledByClient].sort((a, b) => b[1] - a[1]).slice(0, 3)) attention.push({ kind: 'Unbilled', text: `${c}: tested work worth ₹${Math.round(v).toLocaleString('en-IN')} not invoiced yet`, level: 'warning' });
  if (overdueTests) attention.push({ kind: 'Tests late', text: `${overdueTests} test(s) are past their due date`, level: 'danger' });
  return {
    thisMonth, lastMonth, change: lastMonth ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null, forecastNext,
    pipeline: { count: pipeline.length, value: sum(pipeline, 'total') }, conversion,
    outstanding: sum(out, 'balance'), overdue: sum(overdue, 'balance'), unbilled: Math.round(unbilled),
    dueNext7, overdueTests, avgTat: tats.length ? Math.round((tats.reduce((a, b) => a + b, 0) / tats.length) * 10) / 10 : null,
    attention,
  };
}));

// ---------------- AI assistant ----------------
type AiSettings = { enabled?: boolean; provider?: string; baseUrl?: string; model?: string; apiKey?: string };

export async function chat(ai: AiSettings, system: string, user: string): Promise<string> {
  if (!ai?.enabled || !ai.model) throw new Error('AI is not configured');
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 45000);
  try {
    if (ai.provider === 'anthropic') {
      const r = await fetch(`${(ai.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': ai.apiKey ?? '', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: ai.model, max_tokens: 1500, system, messages: [{ role: 'user', content: user }] }),
      });
      const j: any = await r.json();
      if (!r.ok) throw new Error(j?.error?.message || `AI request failed (${r.status})`);
      return j.content?.map((c: any) => c.text ?? '').join('') ?? '';
    }
    const r = await fetch(`${(ai.baseUrl || '').replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', ...(ai.apiKey ? { authorization: `Bearer ${ai.apiKey}` } : {}) },
      body: JSON.stringify({ model: ai.model, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || (Array.isArray(j) ? j[0]?.error?.message : '') || `AI request failed (${r.status})`);
    return j.choices?.[0]?.message?.content ?? '';
  } finally { clearTimeout(timer); }
}
const extractJson = (s: string) => { const a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a < 0 || b < a) throw new Error('No JSON in AI reply'); return JSON.parse(s.slice(a, b + 1)); };

const STOP = new Set(['private', 'limited', 'pvt', 'ltd', 'the', 'and', 'company', 'co', 'llp', 'inc', 'india', 'projects', 'project', 'developers', 'constructions', 'construction', 'infra', 'infrastructure', 'group', 'builders', 'client', 'site', 'from', 'for', 'with']);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Offline question → report parser: works with no AI provider configured. */
export async function heuristicSpec(cid: number, question: string): Promise<{ spec: ReportSpec; explanation: string }> {
  const q = ' ' + norm(question) + ' ';
  const has = (...w: string[]) => w.some((x) => q.includes(` ${x} `) || q.includes(` ${x}`));
  let object = 'invoices'; let measure: ReportSpec['measure'] = { agg: 'sum', field: 'total' };
  if (has('outstanding', 'receivable', 'owe', 'owes', 'dues', 'due amount', 'balance')) { object = 'outstanding'; measure = { agg: 'sum', field: 'balance' }; }
  else if (has('received', 'collected', 'collection', 'payments', 'payment')) { object = 'payments'; measure = { agg: 'sum', field: 'amount' }; }
  else if (has('quote', 'quotes', 'quotation', 'quotations', 'pipeline')) { object = 'quotes'; measure = has('value', 'worth', 'amount') ? { agg: 'sum', field: 'total' } : { agg: 'count' }; }
  else if (has('sample', 'samples')) { object = 'samples'; measure = { agg: 'count' }; }
  else if (has('turnaround', 'tat')) { object = 'tests'; measure = { agg: 'avg', field: 'tat' }; }
  else if (has('test', 'tests', 'tested', 'tested most', 'most requested', 'requested')) { object = 'tests'; measure = has('value', 'revenue', 'worth') ? { agg: 'sum', field: 'value' } : { agg: 'count' }; }
  if (object !== 'tests' && object !== 'samples' && has('how many', 'number of', 'count')) measure = { agg: 'count' };

  const filters: ReportSpec['filters'] = [];
  const notes: string[] = [];
  // client / site match
  const clients = await db('clients').where({ company_id: cid }).select('name', 'short_code');
  let best: { name: string; score: number } | null = null;
  for (const c of clients) {
    const n = norm(c.name); const code = (c.short_code ?? '').toLowerCase();
    let score = q.includes(` ${n} `) ? 100 : 0;
    if (code && q.includes(` ${code} `)) score = Math.max(score, 80);
    const toks = n.split(' ').filter((t) => t.length >= 3 && !STOP.has(t));
    const hits = toks.filter((t) => q.includes(` ${t} `)).length;
    if (hits) score = Math.max(score, (hits / toks.length) * 70 + hits * 5);
    if (score >= 40 && (!best || score > best.score)) best = { name: c.name, score };
  }
  if (best) { filters.push({ field: 'client', op: 'eq', value: best.name }); notes.push(`client ${best.name}`); }
  else {
    const m = question.match(/(?:from|for|of|by)\s+([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*)*)/);
    if (m && !/^(NABL|Non|This|Last|Next|Client|Test|Month)/.test(m[1])) { filters.push({ field: 'client', op: 'contains', value: m[1].replace(/\s+client$/i, '') }); notes.push(`client name containing "${m[1]}"`); }
  }
  // material / test names
  const cats = await db('catalog').where({ company_id: cid }).select('report_name', 'material');
  const materials = [...new Set(cats.map((c) => c.material).filter(Boolean))] as string[];
  const mat = materials.find((m) => q.includes(` ${m.toLowerCase()} `));
  const testName = cats.map((c) => c.report_name).filter((n) => n && n.length >= 3).find((n) => q.includes(` ${norm(n)} `));
  if ((mat || testName) && object === 'invoices') { object = 'invoice_lines'; measure = { agg: 'sum', field: 'amount' }; }
  if (mat && ['invoice_lines', 'samples', 'tests'].includes(object)) { filters.push({ field: 'material', op: 'eq', value: mat }); notes.push(`material ${mat}`); }
  if (testName && ['invoice_lines', 'tests'].includes(object)) { filters.push({ field: 'test', op: 'contains', value: testName }); notes.push(`test ${testName}`); }
  const accGroup = has('nabl vs', 'vs non', 'nabl and non', 'by type', 'report type', 'nabl versus');
  if (accGroup) { /* grouped below */ }
  else if (has('non nabl', 'nonnabl')) { filters.push({ field: 'accreditation', op: 'eq', value: 'Non-NABL' }); notes.push('Non-NABL'); }
  else if (has('nabl')) { filters.push({ field: 'accreditation', op: 'eq', value: 'NABL' }); notes.push('NABL'); }

  // dates
  let preset: string | undefined; let from: string | undefined; let to: string | undefined;
  const nm = q.match(/ last (\d+) (day|days|week|weeks|month|months) /);
  if (nm) { const n = Number(nm[1]) * (nm[2].startsWith('week') ? 7 : nm[2].startsWith('month') ? 30 : 1); to = today(); from = new Date(Date.now() - (n - 1) * 864e5).toISOString().slice(0, 10); }
  else if (has('today')) preset = 'today';
  else if (has('this week')) preset = 'this_week';
  else if (has('next week', 'next 7 days')) preset = 'next_7';
  else if (has('last week')) preset = 'last_7';
  else if (has('this month')) preset = 'this_month';
  else if (has('last month', 'previous month')) preset = 'last_month';
  else if (has('this quarter')) preset = 'this_quarter';
  else if (has('this financial year', 'this fy', 'this year')) preset = 'this_fy';
  else if (has('last financial year', 'last fy', 'last year', 'previous year')) preset = 'last_fy';
  else {
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const idx = months.findIndex((m) => q.includes(` ${m} `) || q.includes(` ${m.slice(0, 3)} `));
    if (idx >= 0) {
      const t = today(); let y = Number(t.slice(0, 4)); if (idx + 1 > Number(t.slice(5, 7))) y -= 1;
      from = `${y}-${String(idx + 1).padStart(2, '0')}-01`; to = new Date(Date.UTC(y, idx + 1, 0)).toISOString().slice(0, 10);
    }
  }
  // grouping
  let groupBy: string[] | undefined; let chart: ReportSpec['chart'] = 'number'; let forecast: number | undefined;
  const g = (field: string, c: ReportSpec['chart']) => { groupBy = [field]; chart = c; };
  if (has('forecast', 'predict', 'projection', 'project', 'next month')) { g('month', 'line'); forecast = 3; if (!preset && !from) preset = 'last_12_months'; }
  else if (has('by month', 'monthly', 'month wise', 'monthwise', 'per month', 'trend', 'each month')) { g('month', 'line'); if (!preset && !from) preset = 'last_12_months'; }
  else if (has('weekly', 'by week', 'per week', 'week wise')) g('week', 'line');
  else if (has('by client', 'per client', 'client wise', 'clientwise', 'which client', 'top client', 'top clients', 'clients')) g('client', 'hbar');
  else if (has('by test', 'per test', 'test wise', 'which test', 'most tested', 'most requested', 'top tests', 'type of test', 'types of test')) { g('test', 'hbar'); if (object === 'invoices') { object = 'invoice_lines'; measure = { agg: 'sum', field: 'amount' }; } if (object === 'samples') { object = 'tests'; } }
  else if (has('by material', 'material wise', 'which material', 'type of sample', 'types of sample', 'sample type', 'most samples')) g(object === 'invoices' ? 'material' : 'material', 'bar');
  else if (accGroup) g('accreditation', 'pie');
  else if (has('by site', 'per site', 'site wise')) g('site', 'hbar');
  else if (has('by status', 'status wise')) g('status', 'pie');
  else if (has('by technician', 'per technician', 'technician wise', 'workload')) g('technician', 'bar');
  else if (has('ageing', 'aging')) g('ageing', 'bar');
  if (groupBy?.[0] === 'material' && object === 'invoices') { object = 'invoice_lines'; measure = { agg: 'sum', field: 'amount' }; }
  const top = q.match(/ top (\d+) /);
  const spec: ReportSpec = {
    object, measure, filters, groupBy, chart, forecast, sort: 'value_desc', limit: top ? Number(top[1]) : groupBy && ['client', 'test', 'site'].includes(groupBy[0]) ? 15 : undefined,
    dateRange: preset ? { preset: preset as never } : from ? { from, to } : undefined,
  };
  return { spec, explanation: `Built-in assistant: ${REPORT_OBJECTS.find((o) => o.key === object)?.label.toLowerCase()}${notes.length ? ` for ${notes.join(', ')}` : ''}${groupBy ? ` grouped by ${groupBy[0]}` : ''}.` };
}

async function aiSpec(cid: number, ai: AiSettings, question: string) {
  const clients = (await db('clients').where({ company_id: cid }).select('name').limit(300)).map((c) => c.name);
  const sites = (await db('sites').where({ company_id: cid }).select('name').limit(200)).map((c) => c.name);
  const tests = (await db('catalog').where({ company_id: cid }).select('report_name', 'material')).map((c) => `${c.report_name} (${c.material})`);
  const system = `You turn business questions for a testing-laboratory management app into a JSON report spec. Reply with ONLY a JSON object: {"spec": ReportSpec, "explanation": "one short sentence"}.
ReportSpec = { "title": string, "object": one of ${JSON.stringify(REPORT_OBJECTS.map((o) => o.key))}, "dateRange"?: {"preset": one of ${JSON.stringify(DATE_PRESETS.map((d) => d.value))}} or {"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}, "filters"?: [{"field","op":"eq|neq|in|contains|gt|gte|lt|lte","value"}], "groupBy"?: [field] (max 2), "measure": {"agg":"count|sum|avg|min|max","field"?: measure field}, "sort"?: "value_desc|value_asc|label", "limit"?: number, "chart": "bar|hbar|line|pie|table|number", "forecast"?: number of future periods (only with a time groupBy) }
Objects and fields: ${REPORT_OBJECTS.map((o) => `${o.key}: ${o.fields.map((f) => `${f.key}${f.measure ? '(measure)' : ''}`).join(', ')}`).join(' | ')}
Revenue means invoices sum total. Use "contains" for name filters unless the exact name is in the lists. Time grouping fields: month, week, day, quarter, fy. Today is ${today()}. Indian financial year runs April–March.
Known clients: ${clients.join('; ')}
Known sites: ${sites.join('; ')}
Tests: ${tests.join('; ')}`;
  const text = await chat(ai, system, question);
  const j = extractJson(text);
  return { spec: specSchema.parse(j.spec ?? j) as ReportSpec, explanation: String(j.explanation ?? '') };
}

analytics.post('/ai/ask', allow('viewAnalytics'), h(async (req) => {
  const { question } = z.object({ question: z.string().min(3) }).parse(req.body);
  const company = await getCompany(req.user.company_id);
  const ai = company.ai as AiSettings | undefined;
  let source = 'builtin'; let res: { spec: ReportSpec; explanation: string } | null = null; let aiError: string | undefined;
  if (ai?.enabled) {
    try { res = await aiSpec(req.user.company_id, ai, question); source = ai.model ?? 'ai'; } catch (e) { aiError = (e as Error).message; }
  }
  if (!res) res = await heuristicSpec(req.user.company_id, question);
  const result = await run(req.user.company_id, res.spec);
  return { ...result, explanation: res.explanation, source, aiError };
}));

analytics.post('/ai/test', allow('manageSettings'), h(async (req) => {
  const company = await getCompany(req.user.company_id);
  const ai = { ...(company.ai as AiSettings), ...(req.body ?? {}), apiKey: req.body?.apiKey || (company.ai as AiSettings)?.apiKey, enabled: true };
  const t0 = Date.now();
  const reply = await chat(ai, 'Reply with the single word OK.', 'Say OK');
  return { ok: true, reply: reply.slice(0, 60), ms: Date.now() - t0 };
}));

/** Small AI helpers used inside forms. Each has a non-AI fallback in the UI. */
analytics.post('/ai/assist', h(async (req) => {
  const { task, input } = z.object({ task: z.enum(['remark', 'quote_lines', 'email']), input: z.any() }).parse(req.body);
  const company = await getCompany(req.user.company_id);
  const ai = company.ai as AiSettings | undefined;
  if (!ai?.enabled) throw new HttpError(400, 'Turn on the AI assistant in Settings → Company & branding → AI assistant');
  if (task === 'remark') {
    const text = await chat(ai, 'You are a senior civil-engineering testing laboratory technical manager. Write a one or two sentence factual remark/conclusion for a test report based only on the results and any specification given. Do not invent limits that are not given; if no specification is given, state results are for information. Reply with the remark text only.', JSON.stringify(input).slice(0, 6000));
    return { text: text.trim() };
  }
  if (task === 'email') {
    const text = await chat(ai, `Write a short, polite business email body for ${company.name}. Plain text only, no subject line.`, JSON.stringify(input).slice(0, 4000));
    return { text: text.trim() };
  }
  const cats = await db('catalog').where({ company_id: req.user.company_id, active: true }).select('id', 'billing_name', 'report_name', 'material', 'unit', 'rate');
  const text = await chat(ai, `Extract the tests/services a client is asking for from their enquiry and map each to the rate card. Reply ONLY with JSON {"lines":[{"catalogId": number|null, "description": string, "qty": number}], "notes": string}. Rate card: ${JSON.stringify(cats)}`, String(input).slice(0, 6000));
  return extractJson(text);
}));

export { type AuthUser };
