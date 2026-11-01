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

export function setSession(res: Response, u: { id: number }) {
  const token = jwt.sign({ uid: u.id }, SECRET, { expiresIn: '12h' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 12 * 3600 * 1000 });
}
export const clearSession = (res: Response) => res.clearCookie(COOKIE);

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) return res.status(401).json({ error: 'Please sign in' });
    const { uid } = jwt.verify(token, SECRET) as { uid: number };
    const u = await db('users').where({ id: uid, active: true }).first('id', 'company_id', 'name', 'email', 'role');
    if (!u) return res.status(401).json({ error: 'Please sign in' });
    req.user = { ...u, roleDef: await getRole(u.company_id, u.role) } as AuthUser;
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

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

/** Wrap async route handlers so errors become JSON responses. */
export const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res) => {
  fn(req, res).then((out) => { if (!res.headersSent) res.json(out ?? { ok: true }); }).catch((e: unknown) => {
    const status = e instanceof HttpError ? e.status : (e as { name?: string })?.name === 'ZodError' ? 400 : e instanceof Error && /required|must be|not valid|checksum/.test(e.message) ? 400 : 500;
    if (status === 500) console.error(e);
    const msg = (e as { name?: string })?.name === 'ZodError' ? 'Some fields are missing or invalid: ' + (e as any).issues.map((i: any) => i.path.join('.') + ' ' + i.message).join('; ') : e instanceof Error ? e.message : 'Unexpected error';
    res.status(status).json({ error: msg });
  });
};
