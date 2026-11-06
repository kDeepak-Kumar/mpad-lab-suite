import { Router } from 'express';
import { z } from 'zod';
import { db, parseJson, today } from './db';
import { can, h, isAdmin, requireAuth, type AuthUser } from './auth';
import { getCompany, paidAgainst } from './services';
import { restrictDocuments, restrictList } from './sharing';
import { aiSpec, chat, heuristicSpec, run } from './analytics';
import { searchHelp } from './help';
import type { ReportSpec } from '@suite/shared';

/**
 * App-wide assistant. The model never touches the database: it only picks from a fixed set of read-only lookups
 * (each checked against the user's permissions and record sharing), then writes an answer from their results.
 * Without an AI provider the same lookups run from keyword rules, so the assistant always works.
 */
export const assistant = Router();
assistant.use('/assistant', requireAuth);

type Item = { label: string; sub?: string; link?: string };
type Result = { tool: string; title: string; items: Item[]; note?: string; table?: { label: string; value: number }[]; total?: number };
type Call = { tool: string; args?: Record<string, unknown> };
type AiSettings = { enabled?: boolean; provider?: string; baseUrl?: string; model?: string; apiKey?: string };

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const dmy = (d?: string | null) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '');
const like = (s: unknown) => `%${String(s ?? '').trim().replace(/[%_]/g, '')}%`;
const KIND_LABEL: Record<string, string> = { quote: 'Quotation', invoice: 'Invoice', report: 'Test report' };

const TOOLS: Record<string, { desc: string; perm?: string; run: (u: AuthUser, a: Record<string, any>) => Promise<Result> }> = {
  find_clients: {
    desc: 'find_clients {q}: clients by name, GSTIN, phone or email', perm: 'client.read',
    run: async (u, a) => {
      const q = db('clients as c').where('c.company_id', u.company_id).andWhere((w) => w.whereNull('c.type').orWhereNot('c.type', 'system')).andWhere((w) => w.where('c.name', 'like', like(a.q)).orWhere('c.gstin', 'like', like(a.q)).orWhere('c.phone', 'like', like(a.q)).orWhere('c.email', 'like', like(a.q))).select('c.id', 'c.name', 'c.gstin', 'c.phone').limit(8);
      await restrictList(u, 'client', q, 'c.id', 'c.owner_id');
      return { tool: 'find_clients', title: 'Clients', items: (await q).map((c) => ({ label: c.name, sub: [c.gstin, c.phone].filter(Boolean).join(' · '), link: `/clients/${c.id}` })) };
    },
  },
  client_summary: {
    desc: 'client_summary {name}: one client\'s contact, outstanding balance, latest invoices, quotations and samples', perm: 'client.read',
    run: async (u, a) => {
      const q = db('clients as c').where('c.company_id', u.company_id).andWhere((w) => w.whereNull('c.type').orWhereNot('c.type', 'system')).andWhere('c.name', 'like', like(a.name)).select('c.*').limit(1);
      await restrictList(u, 'client', q, 'c.id', 'c.owner_id');
      const c = (await q)[0];
      if (!c) return { tool: 'client_summary', title: 'Client', items: [], note: `No client matching “${a.name}” that you can see.` };
      const items: Item[] = [{ label: c.name, sub: [c.phone, c.email, c.gstin].filter(Boolean).join(' · '), link: `/clients/${c.id}` }];
      let note = '';
      if (can(u, 'invoice.read')) {
        const iq = db('documents as d').where({ 'd.company_id': u.company_id, 'd.client_id': c.id, 'd.kind': 'invoice' }).whereNot('d.status', 'cancelled').whereNot('d.status', 'draft').select('d.id', 'd.number', 'd.date', 'd.total', 'd.status').orderBy('d.date', 'desc');
        await restrictDocuments(u, iq);
        const inv = await iq; const paid = await paidAgainst(u.company_id);
        const bal = inv.reduce((s, i) => s + Math.max(0, Number(i.total) - (paid.get(i.id) ?? 0)), 0);
        note += `Outstanding ${inr(bal)} across ${inv.filter((i) => Number(i.total) - (paid.get(i.id) ?? 0) > 0.5).length} invoice(s); invoiced ${inr(inv.reduce((s, i) => s + Number(i.total), 0))} in total. `;
        for (const i of inv.slice(0, 4)) items.push({ label: `Invoice ${i.number}`, sub: `${dmy(i.date)} · ${inr(Number(i.total))} · ${i.status}`, link: `/documents/${i.id}` });
        if (can(u, 'payment.read')) items.push({ label: 'Statement of account (ledger)', link: `/ledger?client=${c.id}` });
      }
      if (can(u, 'sample.read')) {
        const s = await db('samples').where({ company_id: u.company_id, client_id: c.id }).orderBy('id', 'desc').limit(3).select('id', 'code', 'material', 'status', 'received_date');
        const n = await db('samples').where({ company_id: u.company_id, client_id: c.id }).count({ n: 'id' }).first();
        note += `${Number(n?.n ?? 0)} sample(s) received.`;
        for (const x of s) items.push({ label: `Sample ${x.code}`, sub: `${x.material} · ${dmy(x.received_date)} · ${x.status}`, link: `/samples?open=${x.id}` });
      }
      return { tool: 'client_summary', title: `Client: ${c.name}`, items, note: note.trim() };
    },
  },
  find_samples: {
    desc: 'find_samples {q?, status?}: samples by job code, ULR, client or material (status: registered|in_testing|completed|reported)', perm: 'sample.read',
    run: async (u, a) => {
      const q = db('samples as s').leftJoin('clients as c', 'c.id', 's.client_id').where('s.company_id', u.company_id).orderBy('s.id', 'desc').limit(10)
        .select('s.id', 's.code', 's.ulr', 's.material', 's.status', 's.received_date', 'c.name as client');
      if (a.q) q.andWhere((w) => w.where('s.code', 'like', like(a.q)).orWhere('s.ulr', 'like', like(a.q)).orWhere('c.name', 'like', like(a.q)).orWhere('s.material', 'like', like(a.q)));
      if (a.status) q.andWhere('s.status', String(a.status));
      return { tool: 'find_samples', title: 'Samples', items: (await q).map((s) => ({ label: `${s.code}`, sub: `${s.client ?? ''} · ${s.material} · ${dmy(s.received_date)} · ${s.status}`, link: `/samples?open=${s.id}` })) };
    },
  },
  find_documents: {
    desc: 'find_documents {kind: quote|invoice|report, q?, status?}: quotations, invoices or test reports by number or client (status e.g. draft|sent|accepted|issued|paid|partly_paid)',
    run: async (u, a) => {
      const kind = ['quote', 'invoice', 'report'].includes(String(a.kind)) ? String(a.kind) : 'invoice';
      if (!can(u, `${kind}.read`)) return { tool: 'find_documents', title: `${KIND_LABEL[kind]}s`, items: [], note: `Your role cannot see ${KIND_LABEL[kind].toLowerCase()}s.` };
      const q = db('documents as d').leftJoin('clients as c', 'c.id', 'd.client_id').where({ 'd.company_id': u.company_id, 'd.kind': kind }).whereNot('d.status', 'cancelled').orderBy('d.id', 'desc').limit(10)
        .select('d.id', 'd.number', 'd.date', 'd.total', 'd.status', 'c.name as client');
      if (a.q) q.andWhere((w) => w.where('d.number', 'like', like(a.q)).orWhere('c.name', 'like', like(a.q)));
      if (a.status) q.andWhere('d.status', String(a.status));
      await restrictDocuments(u, q);
      return { tool: 'find_documents', title: `${KIND_LABEL[kind]}s`, items: (await q).map((d) => ({ label: `${KIND_LABEL[kind]} ${d.number ?? `draft #${d.id}`}`, sub: `${d.client ?? ''} · ${dmy(d.date)}${kind !== 'report' ? ` · ${inr(Number(d.total))}` : ''} · ${d.status}`, link: `/documents/${d.id}` })) };
    },
  },
  find_equipment: {
    desc: 'find_equipment {q?, dueWithinDays?}: equipment and calibration status; dueWithinDays lists calibrations due/expired', perm: 'equipment.read',
    run: async (u, a) => {
      const q = db('equipment').where({ company_id: u.company_id }).whereNot('active', false).orderBy('due_date').limit(12).select('id', 'name', 'id_no', 'due_date', 'cert_no');
      if (a.q) q.andWhere((w) => w.where('name', 'like', like(a.q)).orWhere('id_no', 'like', like(a.q)));
      if (a.dueWithinDays !== undefined) q.whereNotNull('due_date').andWhere('due_date', '<=', new Date(Date.now() + Number(a.dueWithinDays) * 86400000).toISOString().slice(0, 10));
      const td = today(); const rows = await q;
      return { tool: 'find_equipment', title: 'Equipment', note: rows.length ? undefined : a.dueWithinDays !== undefined ? `No calibrations due in the next ${a.dueWithinDays} days.` : 'No matching equipment.', items: rows.map((e) => ({ label: `${e.name}${e.id_no ? ` (${e.id_no})` : ''}`, sub: e.due_date ? `calibration ${e.due_date < td ? 'EXPIRED' : 'due'} ${dmy(e.due_date)}` : 'no calibration date', link: '/equipment' })) };
    },
  },
  pending_work: {
    desc: 'pending_work {}: the user\'s open work – tests to do, to review, to report, reports to sign, quotes awaiting reply',
    run: async (u) => {
      const t = await db('tests').where({ company_id: u.company_id }).whereIn('status', ['pending', 'in_progress', 'returned', 'submitted', 'accepted']).select('status', 'assigned_to', 'report_id');
      const r = await db('documents').where({ company_id: u.company_id, kind: 'report' }).whereIn('status', ['review', 'verified']).count({ n: 'id' }).first();
      const items: Item[] = [];
      if (can(u, 'enterObservations')) items.push({ label: `Tests to do: ${t.filter((x) => ['pending', 'in_progress', 'returned'].includes(x.status) && (u.role !== 'technician' || x.assigned_to === u.id)).length}`, link: '/tests?tab=mine' });
      if (can(u, 'reviewTests')) items.push({ label: `Observations to review: ${t.filter((x) => x.status === 'submitted').length}`, link: '/tests?tab=review' });
      if (can(u, 'prepareReports')) items.push({ label: `Accepted, not yet reported: ${t.filter((x) => x.status === 'accepted' && !x.report_id).length}`, link: '/reports/prepare' });
      if (can(u, 'signReports')) items.push({ label: `Reports to verify / sign: ${Number(r?.n ?? 0)}`, link: '/reports' });
      if (can(u, 'quote.read')) { const q = await db('documents').where({ company_id: u.company_id, kind: 'quote', status: 'sent' }).count({ n: 'id' }).first(); items.push({ label: `Quotations awaiting reply: ${Number(q?.n ?? 0)}`, link: '/quotes' }); }
      return { tool: 'pending_work', title: 'Your open work', items };
    },
  },
  business_report: {
    desc: 'business_report {question}: totals, trends, rankings and comparisons (revenue, collections, outstanding, samples, tests, quotations) – e.g. "revenue by client this year"', perm: 'viewAnalytics',
    run: async (u, a) => {
      const company = await getCompany(u.company_id); const ai = company.ai as AiSettings | undefined;
      // the model only fills a report spec; it is validated and run by the report engine (no free-form queries)
      let spec: ReportSpec | null = null;
      if (ai?.enabled && can(u, 'useAI')) { try { spec = (await aiSpec(u.company_id, ai, String(a.question ?? ''))).spec; } catch { spec = null; } }
      if (!spec) spec = (await heuristicSpec(u.company_id, String(a.question ?? ''))).spec;
      const res = await run(u.company_id, spec);
      const rows = res.rows.filter((r) => !r.forecast).slice(0, 12).map((r) => ({ label: [r.label, r.label2].filter(Boolean).join(' · '), value: Math.round(r.value * 100) / 100 }));
      const money = ['total', 'amount', 'balance', 'taxable', 'tds', 'rate'].includes(String(spec.measure.field ?? ''));
      return { tool: 'business_report', title: `${res.title} (${dmy(res.range.from)} to ${dmy(res.range.to)})`, items: [{ label: 'Open this report in Analytics to change filters or add it to a dashboard', link: `/analytics?ask=${encodeURIComponent(String(a.question ?? ''))}` }],
        table: rows, total: res.total, note: `${money ? `Total ${inr(res.total)}` : `Total ${res.total.toLocaleString('en-IN')}`} (${res.measureLabel}${money ? ', amounts in ₹' : ''}).` };
    },
  },
  app_help: {
    desc: 'app_help {topic}: step-by-step help for using this app (how to create, where to find, settings)',
    run: async (u, a) => {
      const arts = searchHelp(String(a.topic ?? ''), (p) => !p || (p === '__admin' ? isAdmin(u) : can(u, p)));
      return { tool: 'app_help', title: 'How to', items: arts.map((x) => ({ label: x.title, sub: x.steps.join(' '), link: x.link })) };
    },
  },
};

const NOUN: Record<string, string> = { find_clients: 'Clients', client_summary: 'Client details', find_samples: 'Samples', find_equipment: 'Equipment', business_report: 'Business reports and figures' };

/** Keyword rules: used when no AI provider is configured, or when the AI plan fails. */
async function planWithoutAi(u: AuthUser, q: string): Promise<Call[]> {
  const s = ` ${q.toLowerCase()} `;
  const has = (...w: string[]) => w.some((x) => s.includes(x));
  const calls: Call[] = [];
  if (has('how do', 'how to', 'how can', 'where do', 'where can', 'where is', 'help', 'steps', 'setup', 'set up', 'configure')) calls.push({ tool: 'app_help', args: { topic: q } });
  const code = q.match(/[A-Z]{2,}[\/-][A-Z0-9\/-]{3,}/i)?.[0];
  if (has('pending', 'my work', 'my tasks', 'to do', 'todo', 'queue', 'waiting')) calls.push({ tool: 'pending_work' });
  if (has('calibration', 'equipment', 'instrument')) calls.push({ tool: 'find_equipment', args: has('due', 'expire', 'overdue') ? { dueWithinDays: 30 } : { q: '' } });
  const clientQ = db('clients as c').where('c.company_id', u.company_id).andWhere((w) => w.whereNull('c.type').orWhereNot('c.type', 'system')).select('c.id', 'c.name');
  if (!can(u, 'client.read')) clientQ.whereRaw('1 = 0');
  await restrictList(u, 'client', clientQ, 'c.id', 'c.owner_id');
  const STOP = new Set(['private', 'limited', 'pvt', 'ltd', 'the', 'and', 'company', 'india', 'projects', 'developers', 'construction', 'constructions', 'infra', 'group', 'builders']);
  const client = (await clientQ).find((c) => String(c.name).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w)).some((w) => s.includes(` ${w}`)));
  const analytic = has('how much', 'total', 'revenue', 'trend', 'by month', 'monthly', 'compare', 'top ', 'most ', 'average', 'this year', 'last year', 'this month', 'last month', 'forecast');
  if (analytic) calls.push({ tool: 'business_report', args: { question: q } });
  else if (client) calls.push({ tool: 'client_summary', args: { name: client.name } });
  if (code) calls.push({ tool: has('invoice') ? 'find_documents' : 'find_samples', args: has('invoice') ? { kind: 'invoice', q: code } : { q: code } });
  else if (!analytic && has('invoice', 'bill')) calls.push({ tool: 'find_documents', args: { kind: 'invoice', q: client?.name ?? '', status: has('unpaid', 'outstanding', 'due') ? 'issued' : undefined } });
  else if (!analytic && has('quote', 'quotation')) calls.push({ tool: 'find_documents', args: { kind: 'quote', q: client?.name ?? '' } });
  else if (!analytic && has('report', 'certificate')) calls.push({ tool: 'find_documents', args: { kind: 'report', q: client?.name ?? '' } });
  else if (!analytic && has('sample', 'job')) calls.push({ tool: 'find_samples', args: { q: client?.name ?? '' } });
  if (!calls.length) {
    const words = q.replace(/[^a-z0-9\/ -]+/gi, ' ').split(/\s+/).filter((w) => w.length > 2).sort((a, b) => b.length - a.length)[0] ?? q;
    calls.push({ tool: 'app_help', args: { topic: q } }, { tool: 'find_clients', args: { q: words } }, { tool: 'find_samples', args: { q: words } });
  }
  return calls.slice(0, 4);
}

async function planWithAi(ai: AiSettings, u: AuthUser, history: { role: string; content: string }[], page?: string): Promise<Call[]> {
  const allowed = Object.entries(TOOLS).filter(([, t]) => !t.perm || can(u, t.perm));
  const system = `You route questions in a civil-engineering testing laboratory app to read-only lookups. Today is ${today()}. The user is ${u.name} (${u.roleDef.label}) on page ${page ?? '/'}.
Available lookups (use ONLY these, at most 3):
${allowed.map(([, t]) => `- ${t.desc}`).join('\n')}
Reply ONLY with JSON {"calls":[{"tool": name, "args": {...}}]}. Use app_help for "how do I" questions. Use business_report for any total/trend/ranking question. Use [] only for greetings.`;
  const text = await chat(ai, system, history.slice(-6).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n'), { maxTokens: 400, timeoutMs: 25000 });
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  const j = JSON.parse(text.slice(a, b + 1));
  return (Array.isArray(j.calls) ? j.calls : []).filter((c: Call) => c && TOOLS[c.tool]).slice(0, 3);
}

function plainAnswer(results: Result[]): string {
  if (!results.some((r) => r.items.length || r.table?.length || r.note)) return 'I could not find anything for that. Try a client name, a sample code, an invoice number, or ask “how do I …”.';
  return results.map((r) => {
    const lines = [`**${r.title}**`];
    if (r.note) lines.push(r.note);
    if (r.table?.length) { lines.push('', '| | Value |', '|---|---:|', ...r.table.map((t) => `| ${t.label || '—'} | ${r.note?.includes('₹') ? inr(t.value) : t.value.toLocaleString('en-IN')} |`)); lines.push(''); }
    if (r.tool === 'app_help') for (const i of r.items) lines.push(`- ${i.link ? `[${i.label}](${i.link})` : `**${i.label}**`}: ${i.sub}`);
    else for (const i of r.items) lines.push(`- ${i.link ? `[${i.label}](${i.link})` : i.label}${i.sub ? ` — ${i.sub}` : ''}`);
    if (!r.items.length && !r.table?.length && !r.note) lines.push('Nothing found.');
    return lines.join('\n');
  }).join('\n\n');
}

assistant.post('/assistant/chat', h(async (req) => {
  const b = z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).min(1).max(30), page: z.string().max(200).optional() }).parse(req.body);
  const question = b.messages[b.messages.length - 1].content.trim();
  const company = await getCompany(req.user.company_id);
  const ai = company.ai as AiSettings | undefined;
  const useAi = Boolean(ai?.enabled && ai.model && can(req.user, 'useAI'));
  if (/^(hi|hello|hey|namaste|good (morning|afternoon|evening)|thanks|thank you)\b[\s!.]*$/i.test(question)) {
    return { answer: `Hello ${req.user.name.split(' ')[0]}! I can find clients, samples, quotations, invoices, reports and equipment, show what is pending for you, answer questions like “revenue by client this year”, and explain how to do things in the app. What do you need?`, results: [], mode: useAi ? 'ai' : 'builtin' };
  }
  let calls: Call[] = []; let aiError: string | undefined;
  if (useAi) { try { calls = await planWithAi(ai!, req.user, b.messages, b.page); } catch (e) { aiError = (e as Error).message; calls = await planWithoutAi(req.user, question); } }
  else calls = await planWithoutAi(req.user, question);
  const results: Result[] = [];
  for (const c of calls) {
    const t = TOOLS[c.tool];
    if (t.perm && !can(req.user, t.perm)) { results.push({ tool: c.tool, title: NOUN[c.tool] ?? 'Not available', items: [], note: `Your role does not have access to ${(NOUN[c.tool] ?? 'this').toLowerCase()}. Ask an administrator if you need it.` }); continue; }
    try { results.push(await t.run(req.user, (c.args ?? {}) as Record<string, any>)); } catch (e) { results.push({ tool: c.tool, title: c.tool, items: [], note: `Could not look this up (${(e as Error).message}).` }); }
  }
  let answer = plainAnswer(results);
  if (useAi && !aiError) {
    const links = new Set(results.flatMap((r) => r.items.map((i) => i.link).filter(Boolean)));
    try {
      const system = `You are the assistant inside ${company.name}'s laboratory management app. Answer the user's last message in clear, short markdown (bold, bullet lists and tables allowed). Use ONLY the facts in LOOKUP RESULTS; never invent numbers, names or records. When you mention a record, link it with markdown using exactly one of these app links: ${[...links].slice(0, 60).join(' ')}. If the results are empty, say what you could not find and suggest what to try. Amounts are Indian rupees (₹, Indian digit grouping).`;
      const out = await chat(ai!, system, `CONVERSATION:\n${b.messages.slice(-6).map((m) => `${m.role}: ${m.content}`).join('\n')}\n\nLOOKUP RESULTS:\n${JSON.stringify(results).slice(0, 12000)}`, { maxTokens: 900, timeoutMs: 40000 });
      // keep only links the lookups produced (plus external https links) – the model cannot send users anywhere else
      answer = out.trim().replace(/\]\(([^)]+)\)/g, (m, url) => (links.has(url) || /^https:\/\//.test(url) ? m : ']()')).replace(/\[([^\]]+)\]\(\)/g, '$1') || answer;
    } catch (e) { aiError = (e as Error).message; }
  }
  return { answer, results, mode: useAi && !aiError ? 'ai' : 'builtin', aiError };
}));

export const _internal = { planWithoutAi, parseJson };
