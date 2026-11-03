import nodemailer from 'nodemailer';
import { formatDate, isEmailList } from '@suite/shared';
import { db, now } from './db';
import { getCompany, type CompanyProfile } from './services';
import { human, storageInfo, WARN_PCT } from './storage';

/**
 * Email alerts for SLA breaches (tests past their due date and not yet reported)
 * and calibration due / expired. Runs once a day per company after the chosen hour
 * (India time). Every item is logged in alert_log, so an item is mailed once when it
 * first appears and then again only as part of the weekly reminder (if enabled).
 */
export interface AlertSettings {
  enabled?: boolean; to?: string; sla?: boolean; calibration?: boolean; leadDays?: number; hour?: number; weeklyRepeat?: boolean;
}
export interface AlertItem { kind: 'sla' | 'cal' | 'disk'; ref: string; text: string; isNew?: boolean }

const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000);
const istToday = () => istNow().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export async function collectAlerts(cid: number, s: AlertSettings, td = istToday()): Promise<AlertItem[]> {
  const items: AlertItem[] = [];
  if (s.sla !== false) {
    const tests = await db('tests as t').join('samples as s', 's.id', 't.sample_id').join('catalog as k', 'k.id', 't.catalog_id').leftJoin('clients as c', 'c.id', 's.client_id')
      .where('t.company_id', cid).whereIn('t.status', ['pending', 'in_progress', 'returned', 'submitted', 'reviewed']).whereNotNull('t.due_date').andWhere('t.due_date', '<', td)
      .select('t.id', 't.status', 't.due_date', 's.code', 'k.report_name', 'k.billing_name', 'c.name as client_name').orderBy('t.due_date');
    for (const t of tests) {
      const late = Math.round((Date.parse(td) - Date.parse(t.due_date)) / 86400000);
      items.push({ kind: 'sla', ref: `test:${t.id}:${t.due_date}`, text: `${t.code} · ${t.report_name || t.billing_name} (${t.client_name ?? '-'}) was due ${formatDate(t.due_date)}, ${late} day${late === 1 ? '' : 's'} late · status ${String(t.status).replace('_', ' ')}` });
    }
  }
  if (s.calibration !== false) {
    const lead = Number(s.leadDays ?? 15);
    const eq = await db('equipment').where({ company_id: cid, active: true }).whereNotNull('due_date').andWhere('due_date', '<=', addDays(td, lead)).orderBy('due_date');
    for (const e of eq) {
      const expired = e.due_date < td;
      items.push({ kind: 'cal', ref: `eq:${e.id}:${e.due_date}:${expired ? 'expired' : 'due'}`, text: `${e.name}${e.id_no ? ` (${e.id_no})` : ''} calibration ${expired ? 'EXPIRED on' : 'due on'} ${formatDate(e.due_date)}${e.cert_no ? ` · cert ${e.cert_no}` : ''}` });
    }
  }
  try {
    const st = await storageInfo();
    if (st.warn && st.disk) items.push({ kind: 'disk', ref: `disk:${Math.floor(st.disk.usedPct / 5) * 5}`, text: `Server disk is ${st.disk.usedPct}% full (${human(st.disk.freeBytes)} free; database ${human(st.dbBytes)}). Above ${WARN_PCT}%: remove old backups or upgrade the plan before it fills up.` });
  } catch { /* storage check is best-effort */ }
  if (items.length) {
    const seen = new Set((await db('alert_log').where({ company_id: cid }).whereIn('ref', items.map((i) => i.ref)).select('ref')).map((r: { ref: string }) => r.ref));
    for (const i of items) i.isNew = !seen.has(i.ref);
  }
  return items;
}

export function alertEmail(company: CompanyProfile, items: AlertItem[], td = istToday()) {
  const sla = items.filter((i) => i.kind === 'sla'); const cal = items.filter((i) => i.kind === 'cal');
  const line = (i: AlertItem) => `${i.isNew ? '[NEW] ' : ''}${i.text}`;
  const parts = [`Daily alerts for ${company.name} – ${formatDate(td)}`, ''];
  if (sla.length) parts.push(`TESTS PAST DUE DATE (${sla.length})`, ...sla.map(line), '');
  if (cal.length) parts.push(`CALIBRATION DUE / EXPIRED (${cal.length})`, ...cal.map(line), '');
  const disk = items.filter((i) => i.kind === 'disk');
  if (disk.length) parts.push('SERVER STORAGE', ...disk.map(line), '');
  parts.push('Open the Suite to act on these. You can change who gets this email in Settings → Company → Email & alerts.');
  const subject = `${company.name}: ${[sla.length && `${sla.length} test${sla.length > 1 ? 's' : ''} overdue`, cal.length && `${cal.length} calibration${cal.length > 1 ? 's' : ''} due/expired`, items.some((i) => i.kind === 'disk') && 'server disk almost full'].filter(Boolean).join(', ')}`;
  return { subject, text: parts.join('\n') };
}

export async function mailer(company: CompanyProfile) {
  const smtp = company.smtp ?? {};
  if (!smtp.host || !smtp.user || !process.env.SMTP_PASSWORD) throw new Error('Email is not set up yet. Add SMTP details in Settings and SMTP_PASSWORD in the hosting environment.');
  const transport = nodemailer.createTransport({ host: smtp.host, port: Number(smtp.port ?? 465), secure: smtp.secure ?? true, auth: { user: smtp.user, pass: process.env.SMTP_PASSWORD } });
  return (msg: { to: string; subject: string; text: string }) => transport.sendMail({ from: smtp.from || `${company.name} <${smtp.user}>`, ...msg });
}

/** Send the digest for one company. force = send even if nothing is new (used by "Send now"). */
export async function runAlerts(cid: number, opts: { force?: boolean } = {}) {
  const company = await getCompany(cid);
  const s = (company.alerts ?? {}) as AlertSettings;
  if (!s.to || !isEmailList(s.to)) throw new Error('Add at least one valid recipient email for alerts');
  const td = istToday();
  const items = await collectAlerts(cid, s, td);
  const fresh = items.filter((i) => i.isNew);
  const weekly = s.weeklyRepeat !== false && istNow().getUTCDay() === 1; // Mondays: full reminder list
  if (!items.length || (!fresh.length && !weekly && !opts.force)) return { sent: false, items: items.length, fresh: 0 };
  const send = await mailer(company);
  const mail = alertEmail(company, items, td);
  await send({ to: s.to, ...mail });
  for (const i of fresh) await db('alert_log').insert({ company_id: cid, kind: i.kind, ref: i.ref, sent_on: td, created_at: now() }).onConflict(['company_id', 'kind', 'ref', 'sent_on']).ignore();
  await db('alert_log').insert({ company_id: cid, kind: 'digest', ref: 'daily', sent_on: td, created_at: now() }).onConflict(['company_id', 'kind', 'ref', 'sent_on']).ignore();
  return { sent: true, items: items.length, fresh: fresh.length };
}

/** Checks every 15 minutes; each company is processed at most once a day. */
export function startAlertScheduler() {
  const tick = async () => {
    try {
      const td = istToday(); const hour = istNow().getUTCHours();
      for (const c of await db('companies').select('id')) {
        const company = await getCompany(c.id);
        const s = (company.alerts ?? {}) as AlertSettings;
        if (!s.enabled || !s.to || hour < Number(s.hour ?? 9)) continue;
        const done = await db('alert_log').where({ company_id: c.id, kind: 'digest', ref: 'daily', sent_on: td }).first();
        if (done) continue;
        try { await runAlerts(c.id); } catch (e) { console.warn(`Alerts for company ${c.id}:`, (e as Error).message); }
        await db('alert_log').insert({ company_id: c.id, kind: 'digest', ref: 'daily', sent_on: td, created_at: now() }).onConflict(['company_id', 'kind', 'ref', 'sent_on']).ignore();
      }
    } catch (e) { console.warn('Alert scheduler:', (e as Error).message); }
  };
  setTimeout(tick, 30_000);
  return setInterval(tick, 15 * 60_000).unref();
}
