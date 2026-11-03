import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { db, now } from './db';

/**
 * Two-step verification (TOTP, RFC 6238 – works with Google Authenticator, Microsoft Authenticator,
 * Authy …), backup codes, device recognition for "new sign-in" alerts, and a login rate limiter.
 */

// ---------- TOTP ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string) {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export function hotp(secret: Buffer, counter: number, digits = 6) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(c).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}
export const totp = (secretB32: string, t = Date.now(), step = 30) => hotp(base32Decode(secretB32), Math.floor(t / 1000 / step));
/** Accepts the current code and one step either side (clock drift). */
export function verifyTotp(secretB32: string, code: string, t = Date.now()) {
  const c = String(code).replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const key = base32Decode(secretB32), n = Math.floor(t / 1000 / 30);
  return [-1, 0, 1].some((d) => crypto.timingSafeEqual(Buffer.from(hotp(key, n + d)), Buffer.from(c)));
}
export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));
export const otpauthUrl = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// ---------- secrets at rest (AES-256-GCM, key derived from JWT_SECRET) ----------
const key = () => crypto.createHash('sha256').update(`${process.env.JWT_SECRET || 'dev-only-secret-change-me'}|totp`).digest();
export function seal(text: string) {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}
export function unseal(blob: string) {
  const [v, iv, tag, enc] = String(blob).split(':');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}

// ---------- backup codes ----------
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export function newBackupCodes(n = 8) {
  const codes = Array.from({ length: n }, () => { const r = crypto.randomBytes(5).toString('hex'); return `${r.slice(0, 5)}-${r.slice(5)}`; });
  return { codes, stored: JSON.stringify(codes.map((c) => sha(c))) };
}
/** Returns the remaining hashes if the code matched (each code works once), else null. */
export function useBackupCode(stored: string | null, code: string): string | null {
  const list: string[] = stored ? JSON.parse(stored) : [];
  const h = sha(String(code).trim().toLowerCase());
  if (!list.includes(h)) return null;
  return JSON.stringify(list.filter((x) => x !== h));
}
export const backupCodesLeft = (stored: string | null) => (stored ? (JSON.parse(stored) as string[]).length : 0);

// ---------- devices ----------
export const DEVICE_COOKIE = 'suite_did';
export function deviceId(req: Request, res: Response) {
  let id = req.cookies?.[DEVICE_COOKIE];
  if (!id || !/^[a-f0-9]{32}$/.test(id)) {
    id = crypto.randomBytes(16).toString('hex');
    res.cookie(DEVICE_COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 400 * 24 * 3600 * 1000 });
  }
  return { id, hash: sha(id) };
}
export function describeAgent(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'unknown device';
  return `${browser} on ${os}`;
}
export const clientIp = (req: Request) => String(req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');

/** Records the device; returns whether it is new for this user and whether 2FA may be skipped (remembered). */
export async function touchDevice(userId: number, req: Request, res: Response, opts: { remember?: boolean } = {}) {
  const { hash } = deviceId(req, res);
  const ua = String(req.headers['user-agent'] ?? '').slice(0, 300);
  const existing = await db('user_devices').where({ user_id: userId, device_hash: hash }).first();
  const hadAny = Boolean(await db('user_devices').where({ user_id: userId }).first());
  const trusted_until = opts.remember ? new Date(Date.now() + 30 * 86400000).toISOString() : undefined;
  if (existing) await db('user_devices').where({ id: existing.id }).update({ last_seen: now(), ip: clientIp(req), user_agent: ua, ...(trusted_until ? { trusted_until } : {}) });
  else await db('user_devices').insert({ user_id: userId, device_hash: hash, user_agent: ua, ip: clientIp(req), first_seen: now(), last_seen: now(), trusted_until: trusted_until ?? null });
  return { isNew: !existing && hadAny, label: describeAgent(ua), ip: clientIp(req) };
}
export async function deviceTrusted(userId: number, req: Request) {
  const id = req.cookies?.[DEVICE_COOKIE];
  if (!id) return false;
  const d = await db('user_devices').where({ user_id: userId, device_hash: sha(id) }).first();
  return Boolean(d?.trusted_until && d.trusted_until > new Date().toISOString());
}
export const currentDeviceHash = (req: Request) => (req.cookies?.[DEVICE_COOKIE] ? sha(req.cookies[DEVICE_COOKIE]) : null);

// ---------- login rate limit (per IP + email) ----------
const attempts = new Map<string, { n: number; first: number }>();
const WINDOW = 15 * 60 * 1000, MAX = 8;
export function loginBlocked(req: Request, email: string) {
  const k = `${clientIp(req)}|${email}`; const a = attempts.get(k);
  if (!a) return 0;
  if (Date.now() - a.first > WINDOW) { attempts.delete(k); return 0; }
  return a.n >= MAX ? Math.ceil((WINDOW - (Date.now() - a.first)) / 60000) : 0;
}
export function loginFailed(req: Request, email: string) {
  const k = `${clientIp(req)}|${email}`; const a = attempts.get(k);
  if (!a || Date.now() - a.first > WINDOW) attempts.set(k, { n: 1, first: Date.now() }); else a.n++;
  if (attempts.size > 5000) for (const [kk, v] of attempts) if (Date.now() - v.first > WINDOW) attempts.delete(kk);
}
export const loginOk = (req: Request, email: string) => attempts.delete(`${clientIp(req)}|${email}`);
