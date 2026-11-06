import { Router } from 'express';
import { z } from 'zod';
import { db, now } from '../db';
import { h, HttpError, requireAuth } from '../auth';

/**
 * Internal one-to-one chat between colleagues. Text only (markdown: bold, lists, tables) – files are shared over
 * WhatsApp and never stored here. Online = the app was open in the last minute (the chat window polls).
 */
export const chat = Router();
chat.use('/chat', requireAuth);
const ONLINE_MS = 70_000;

async function touch(u: { id: number }) {
  const t = now();
  await db('users').where({ id: u.id }).andWhere((w) => w.whereNull('last_seen_at').orWhere('last_seen_at', '<', new Date(Date.now() - 20_000).toISOString())).update({ last_seen_at: t });
}
const presence = (last?: string | null) => ({ online: Boolean(last && Date.now() - Date.parse(last) < ONLINE_MS), last_seen: last ?? null });

/** Colleagues with online status, last seen, unread count and the latest message. */
chat.get('/chat/contacts', h(async (req) => {
  const u = req.user, cid = u.company_id;
  await touch(u);
  const users = await db('users').where({ company_id: cid }).whereNot('id', u.id).andWhere((w) => w.where('active', true).orWhere('active', 1)).select('id', 'name', 'role', 'designation', 'phone', 'last_seen_at').orderBy('name');
  const unread = await db('chat_messages').where({ company_id: cid, to_user: u.id }).whereNull('read_at').select('from_user').count({ n: 'id' }).groupBy('from_user');
  const un = new Map((unread as { from_user: number; n: number }[]).map((r) => [r.from_user, Number(r.n)]));
  const last = await db('chat_messages').where('company_id', cid).andWhere((w) => w.where('from_user', u.id).orWhere('to_user', u.id)).orderBy('id', 'desc').limit(500).select('id', 'from_user', 'to_user', 'body', 'created_at');
  const lastBy = new Map<number, (typeof last)[number]>();
  for (const m of last) { const other = m.from_user === u.id ? m.to_user : m.from_user; if (!lastBy.has(other)) lastBy.set(other, m); }
  const photos = new Map((await db('employees').where({ company_id: cid }).whereNotNull('user_id').select('user_id', 'photo')).map((e) => [e.user_id, e.photo]));
  return users.map((x) => {
    const l = lastBy.get(x.id);
    return { id: x.id, name: x.name, designation: x.designation, role: x.role, hasPhone: Boolean(x.phone), photo: photos.get(x.id) ?? null, ...presence(x.last_seen_at), unread: un.get(x.id) ?? 0,
      last: l ? { body: String(l.body).slice(0, 120), at: l.created_at, mine: l.from_user === u.id } : null };
  }).sort((a, b) => (b.last?.at ?? '').localeCompare(a.last?.at ?? '') || a.name.localeCompare(b.name));
}));

async function colleague(cid: number, id: number) {
  const c = await db('users').where({ id, company_id: cid }).first('id', 'name', 'designation', 'phone', 'last_seen_at');
  if (!c) throw new HttpError(404, 'Colleague not found');
  return c;
}

/** Conversation with one colleague (latest 60, or older with ?before=id). Marks their messages as read. */
chat.get('/chat/with/:userId', h(async (req) => {
  const u = req.user, cid = u.company_id, other = Number(req.params.userId);
  const c = await colleague(cid, other);
  const before = Number(req.query.before) || 0;
  const q = db('chat_messages').where('company_id', cid).andWhere((w) => w.where({ from_user: u.id, to_user: other }).orWhere({ from_user: other, to_user: u.id }));
  if (before) q.andWhere('id', '<', before);
  const rows = (await q.orderBy('id', 'desc').limit(60).select('id', 'from_user', 'to_user', 'body', 'created_at', 'read_at')).reverse();
  await db('chat_messages').where({ company_id: cid, from_user: other, to_user: u.id }).whereNull('read_at').update({ read_at: now() });
  await touch(u);
  return { colleague: { id: c.id, name: c.name, designation: c.designation, phone: c.phone ?? null, ...presence(c.last_seen_at) }, messages: rows, more: rows.length === 60 };
}));

chat.post('/chat/send', h(async (req) => {
  const u = req.user, cid = u.company_id;
  const b = z.object({ to: z.number().int(), body: z.string().trim().min(1, 'Type a message').max(6000, 'Message is too long (6,000 characters)') }).parse(req.body);
  if (b.to === u.id) throw new HttpError(400, 'Choose a colleague');
  await colleague(cid, b.to);
  const [id] = await db('chat_messages').insert({ company_id: cid, from_user: u.id, to_user: b.to, body: b.body, created_at: now() });
  await touch(u);
  return { id: Number(id), created_at: now() };
}));

/** Light poll (every few seconds while the app is open): new messages since an id, unread total, colleagues' presence. */
chat.get('/chat/poll', h(async (req) => {
  const u = req.user, cid = u.company_id;
  await touch(u);
  const first = req.query.since === undefined || req.query.since === '';
  const since = Number(req.query.since) || 0;
  const incoming = !first ? await db('chat_messages as m').leftJoin('users as f', 'f.id', 'm.from_user').where({ 'm.company_id': cid, 'm.to_user': u.id }).andWhere('m.id', '>', since).orderBy('m.id').limit(100)
    .select('m.id', 'm.from_user', 'm.to_user', 'm.body', 'm.created_at', 'm.read_at', 'f.name as from_name') : [];
  const latest = await db('chat_messages').where('company_id', cid).andWhere((w) => w.where('to_user', u.id).orWhere('from_user', u.id)).max({ id: 'id' }).first();
  const unread = await db('chat_messages').where({ company_id: cid, to_user: u.id }).whereNull('read_at').count({ n: 'id' }).first();
  const seen = await db('users').where({ company_id: cid }).whereNot('id', u.id).select('id', 'last_seen_at');
  const read = !first ? await db('chat_messages').where({ company_id: cid, from_user: u.id }).whereNotNull('read_at').andWhere('read_at', '>', new Date(Date.now() - 30_000).toISOString()).select('id') : [];
  return { messages: incoming, latestId: Number(latest?.id ?? 0), unread: Number(unread?.n ?? 0), presence: Object.fromEntries(seen.map((s) => [s.id, presence(s.last_seen_at)])), readIds: read.map((r) => r.id) };
}));

chat.post('/chat/read/:userId', h(async (req) => {
  await db('chat_messages').where({ company_id: req.user.company_id, from_user: Number(req.params.userId), to_user: req.user.id }).whereNull('read_at').update({ read_at: now() });
  return { ok: true };
}));
