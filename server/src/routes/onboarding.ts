import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { db, now } from '../db';
import { allow, h, hashPassword, HttpError, isAdmin, requireAuth, setSession } from '../auth';
import { audit, getCompany } from '../services';
import { mailer } from '../alerts';
import { emailHtml } from '../email';
import { clientIp, loginOk, touchDevice } from '../security';

/**
 * New-user invitations (verify email → set own password) and password reset ("Forgot password").
 * Links carry a random one-time token; only its SHA-256 is stored. Invites last 7 days, resets 1 hour.
 */
export const onboarding = Router();

const HOURS = { invite: 24 * 7, reset: 1 } as const;
type Purpose = keyof typeof HOURS;
const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const appUrl = (req: Request) => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

/** Password rule used for every new password. */
export const passwordRule = z.string().min(8, 'Use at least 8 characters').max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Use letters and at least one number');

async function newToken(userId: number, purpose: Purpose, by?: number | null) {
  const raw = crypto.randomBytes(24).toString('base64url');
  await db('user_tokens').where({ user_id: userId, purpose }).whereNull('used_at').update({ used_at: now() }); // older links stop working
  await db('user_tokens').insert({ user_id: userId, purpose, token_hash: hashToken(raw), expires_at: new Date(Date.now() + HOURS[purpose] * 3600_000).toISOString(), created_by: by ?? null, created_at: now() });
  return raw;
}

/** Creates a link and emails it. When email is not set up, the link is returned so an admin can send it (e.g. on WhatsApp). */
export async function sendAccessLink(req: Request, user: { id: number; name: string; email: string; company_id: number }, purpose: Purpose, by?: number | null) {
  const company = await getCompany(user.company_id);
  const url = `${appUrl(req)}/${purpose === 'invite' ? 'welcome' : 'reset'}/${await newToken(user.id, purpose, by)}`;
  const text = purpose === 'invite'
    ? `Hi ${user.name},\n\nYou have been added to ${company.name}'s lab application.\n\nOpen the link below to confirm your email address and set your password:\n${url}\n\nThe link works once and expires in 7 days.\n\nSign-in email: ${user.email}`
    : `Hi ${user.name},\n\nWe received a request to reset the password of your ${company.name} account.\n\nOpen this link to choose a new password:\n${url}\n\nThe link works once and expires in 1 hour. If you didn't ask for this, ignore this email – your password stays the same.`;
  try {
    const send = await mailer(company);
    await send({ to: user.email, subject: purpose === 'invite' ? `Your ${company.name} account – set your password` : `Reset your ${company.name} password`, text, html: emailHtml(company, text, { footer: false }) });
    return { url, emailed: true as const };
  } catch (e) {
    return { url, emailed: false as const, emailError: (e as Error).message };
  }
}

async function findToken(raw: string) {
  const t = await db('user_tokens').where({ token_hash: hashToken(String(raw)) }).first();
  if (!t || t.used_at || new Date(t.expires_at).getTime() < Date.now()) return null;
  const u = await db('users').where({ id: t.user_id, active: true }).first();
  return u ? { t, u } : null;
}
const EXPIRED = 'This link has expired or was already used. Ask your administrator for a new invitation, or use “Forgot password” on the sign-in page.';

// ---------- public ----------
onboarding.get('/public/token/:token', h(async (req) => {
  const f = await findToken(req.params.token);
  if (!f) throw new HttpError(410, EXPIRED);
  const c = await getCompany(f.u.company_id);
  return { purpose: f.t.purpose, name: f.u.name, email: f.u.email, company: c.name, logo: c.logo ?? null };
}));

onboarding.post('/public/token/:token', h(async (req, res) => {
  const { password } = z.object({ password: passwordRule }).parse(req.body);
  const f = await findToken(req.params.token);
  if (!f) throw new HttpError(410, EXPIRED);
  const { t, u } = f;
  const tv = Number(u.token_version ?? 0) + 1; // signs out every other session
  await db.transaction(async (trx) => {
    await trx('user_tokens').where({ id: t.id }).update({ used_at: now() });
    await trx('users').where({ id: u.id }).update({ password_hash: await hashPassword(password), password_set: true, email_verified_at: u.email_verified_at ?? now(), token_version: tv });
  });
  await audit(db, u, 'user', u.id, t.purpose === 'invite' ? 'accepted invitation and set password' : 'reset password by email link', { ip: clientIp(req) });
  loginOk(req, String(u.email));
  if (t.purpose === 'reset') void notifyChanged(u);
  // Straight in, unless two-step verification has to be passed first.
  if (u.totp_enabled) return { ok: true, signedIn: false, email: u.email };
  await touchDevice(u.id, req, res);
  setSession(res, { ...u, token_version: tv });
  return { ok: true, signedIn: true, email: u.email };
}));

async function notifyChanged(u: { name: string; email: string; company_id: number }) {
  try {
    const company = await getCompany(u.company_id);
    const text = `Hi ${u.name},\n\nThe password of your ${company.name} account was just changed using a reset link, and all other sessions were signed out.\n\nIf this wasn't you, contact your administrator straight away.`;
    await (await mailer(company))({ to: u.email, subject: `Your ${company.name} password was changed`, text, html: emailHtml(company, text, { footer: false }) });
  } catch { /* email not set up */ }
}

const forgotHits = new Map<string, number[]>();
onboarding.post('/public/forgot', h(async (req) => {
  const { email } = z.object({ email: z.string().email('Enter a valid email address') }).parse(req.body);
  const key = clientIp(req), t = Date.now();
  const hits = (forgotHits.get(key) ?? []).filter((x) => t - x < 15 * 60_000);
  if (hits.length >= 5) throw new HttpError(429, 'Too many requests. Try again in 15 minutes.');
  forgotHits.set(key, [...hits, t]);
  const generic = { ok: true, message: 'If this email belongs to an active account, a reset link is on its way. It expires in 1 hour – check spam too.' };
  const u = await db('users').where({ email: email.toLowerCase(), active: true }).first();
  if (!u) return generic; // never reveal whether an account exists
  const r = await sendAccessLink(req, u, u.password_set === false || u.password_set === 0 ? 'invite' : 'reset');
  await audit(db, u, 'user', u.id, 'password reset requested', { ip: key, emailed: r.emailed });
  return generic;
}));

// ---------- administrators ----------
/** Send (or re-send) the invitation, or a reset link for someone who forgot their password. Returns the link too. */
onboarding.post('/users/:id/access-link', requireAuth, allow('users'), h(async (req) => {
  const u = await db('users').where({ id: Number(req.params.id), company_id: req.user.company_id }).first();
  if (!u) throw new HttpError(404, 'User not found');
  if (!u.active) throw new HttpError(400, 'Activate the user first');
  if (u.role === 'admin' && !isAdmin(req.user) && u.id !== req.user.id) throw new HttpError(403, 'Only a System Administrator can do this for another System Administrator');
  const purpose: Purpose = u.password_set === false || u.password_set === 0 ? 'invite' : 'reset';
  const r = await sendAccessLink(req, u, purpose, req.user.id);
  await audit(db, req.user, 'user', u.id, purpose === 'invite' ? 'invitation sent' : 'password reset link sent', { emailed: r.emailed });
  return { purpose, ...r };
}));
