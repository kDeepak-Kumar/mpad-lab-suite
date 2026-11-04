import { z } from 'zod';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { roleAllows, type RoleDef } from '@suite/shared';
import { db } from './db';
import { getRole } from './meta';
export { hashPassword, checkPassword } from './auth-hash';

export interface AuthUser { id: number; company_id: number; name: string; email: string; role: string; roleDef: RoleDef }
declare module 'express-serve-static-core' { interface Request { user: AuthUser } }

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('WARNING: JWT_SECRET is not set. Set it in the hosting environment variables.');
}
const COOKIE = 'suite_sid';

const policyCache = new Map<number, { v: boolean; at: number }>();
export async function companyRequires2fa(cid: number) {
  const c = policyCache.get(cid);
  if (c && Date.now() - c.at < 30000) return c.v;
  const row = await db('companies').where({ id: cid }).first('data');
  let v = false; try { v = Boolean(JSON.parse(row?.data ?? '{}')?.security?.require2fa); } catch { /* ignore */ }
  policyCache.set(cid, { v, at: Date.now() });
  return v;
}
export const clearPolicyCache = () => policyCache.clear();

export function setSession(res: Response, u: { id: number; token_version?: number | null }) {
  const token = jwt.sign({ uid: u.id, tv: Number(u.token_version ?? 0) }, SECRET, { expiresIn: '12h' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 12 * 3600 * 1000 });
}
export const clearSession = (res: Response) => res.clearCookie(COOKIE);

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) return res.status(401).json({ error: 'Please sign in' });
    const { uid, tv } = jwt.verify(token, SECRET) as { uid: number; tv?: number };
    const u = await db('users').where({ id: uid, active: true }).first('id', 'company_id', 'name', 'email', 'role', 'token_version', 'totp_enabled');
    if (!u) return res.status(401).json({ error: 'Please sign in' });
    // "Sign out of all other devices" bumps token_version, which ends every older session
    if (Number(tv ?? 0) !== Number(u.token_version ?? 0)) return res.status(401).json({ error: 'You were signed out. Please sign in again.' });
    const { token_version: _tv, totp_enabled, ...rest } = u;
    req.user = { ...rest, roleDef: await getRole(u.company_id, u.role) } as AuthUser;
    // Company policy: two-step verification required → only account/security routes until it is set up
    if (!totp_enabled && !/^\/(auth|account)\//.test(req.path) && await companyRequires2fa(u.company_id)) {
      return res.status(403).json({ error: 'Set up two-step verification to continue (company policy).', code: 'SETUP_2FA' });
    }
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please sign in again' });
  }
}

/** Older permission names used across routes, mapped onto role actions / object operations. */
const LEGACY: Record<string, string> = {
  settings: 'manageSettings', users: 'manageUsers', clients: 'client.edit', catalog: 'catalog.edit', equipment: 'equipment.edit',
  templates: 'manageTemplates', quotes: 'quote.edit', samples: 'sample.create', observe: 'enterObservations', review: 'reviewTests',
  reportPrepare: 'prepareReports', reportIssue: 'signReports', invoices: 'invoice.edit', payments: 'recordPayments', customize: 'manageCustomization',
};
export const can = (u: AuthUser, perm: string) => roleAllows(u.roleDef, LEGACY[perm] ?? perm);
/** System Administrator: full control, skips workflow validations (always audited). */
export const isAdmin = (u: AuthUser) => Boolean(u.roleDef?.admin);

export const allow = (perm: string): RequestHandler => (req, res, next) =>
  can(req.user, perm) ? next() : res.status(403).json({ error: 'Your role does not allow this action' });

/**
 * Yes/no field that also accepts what the database returns (SQLite stores booleans as 1/0) and "true"/"false",
 * so editing a loaded record and saving it back never fails with "should be boolean".
 */
export const zBool = z.preprocess((v) => (v === 1 || v === '1' || v === 'true' ? true : v === 0 || v === '0' || v === 'false' ? false : v), z.boolean({ invalid_type_error: 'must be yes or no' }));

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

/** Wrap async route handlers so errors become JSON responses. */
export const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res) => {
  fn(req, res).then((out) => { if (!res.headersSent) res.json(out ?? { ok: true }); }).catch((e: unknown) => {
    const status = e instanceof HttpError ? e.status : (e as { name?: string })?.name === 'ZodError' ? 400 : e instanceof Error && /required|must be|not valid|checksum/.test(e.message) ? 400 : 500;
    if (status === 500) console.error(e);
    const msg = (e as { name?: string })?.name === 'ZodError' ? zodMessage(e) : e instanceof Error ? e.message : 'Unexpected error';
    res.status(status).json({ error: msg });
  });
};

/** Turn zod issues into short sentences a lab user can act on, e.g. "Received date: Enter a valid date". */
export function zodMessage(e: unknown) {
  const label = (p: (string | number)[]) => p.filter((x) => typeof x === 'string').map((x) => String(x).replace(/_id$/, '').replace(/_pct$/, ' %').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')).join(' › ').replace(/^./, (c) => c.toUpperCase());
  const row = (p: (string | number)[]) => { const n = p.find((x) => typeof x === 'number'); return typeof n === 'number' ? ` (row ${n + 1})` : ''; };
  const text = (i: any) => {
    if (i.code === 'invalid_type' && i.received === 'undefined') return 'is required';
    if (i.code === 'invalid_type') return `should be ${i.expected === 'number' ? 'a number' : i.expected === 'string' ? 'text' : i.expected}`;
    if (i.code === 'too_small' && i.type === 'string' && i.minimum === 1) return 'is required';
    if (i.code === 'too_small' && i.type === 'number') return i.message.startsWith('Number must') ? `must be at least ${i.minimum}` : i.message;
    if (i.code === 'too_big' && i.type === 'number') return i.message.startsWith('Number must') ? `must be at most ${i.maximum}` : i.message;
    return i.message === 'Invalid email' ? 'is not a valid email address' : i.message;
  };
  const issues = ((e as any).issues ?? []) as any[];
  return 'Please check: ' + issues.slice(0, 6).map((i) => `${label(i.path) || 'Value'}${row(i.path)}: ${text(i)}`).join('; ') + (issues.length > 6 ? ` (+${issues.length - 6} more)` : '');
}
