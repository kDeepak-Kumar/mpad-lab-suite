import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import type { Role } from '@suite/shared';
import { db } from './db';

export interface AuthUser { id: number; company_id: number; name: string; email: string; role: Role }
declare module 'express-serve-static-core' { interface Request { user: AuthUser } }

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('WARNING: JWT_SECRET is not set. Set it in the hosting environment variables.');
}
const COOKIE = 'suite_sid';

export const hashPassword = (p: string) => bcrypt.hash(p, 10);
export const checkPassword = (p: string, h: string) => bcrypt.compare(p, h);

export function setSession(res: Response, u: AuthUser) {
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
    req.user = u as AuthUser;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please sign in again' });
  }
}

/** Who may do what. The owner can do everything. */
export const PERMS: Record<string, Role[]> = {
  settings: ['owner'],
  users: ['owner'],
  clients: ['owner', 'frontdesk', 'accountant'],
  catalog: ['owner'],
  equipment: ['owner', 'reviewer'],
  templates: ['owner', 'reviewer'],
  quotes: ['owner', 'frontdesk'],
  samples: ['owner', 'frontdesk', 'technician'],
  observe: ['owner', 'technician', 'reviewer'],
  review: ['owner', 'reviewer', 'signatory'],
  reportPrepare: ['owner', 'reviewer', 'signatory'],
  reportIssue: ['owner', 'signatory'],
  invoices: ['owner', 'accountant', 'frontdesk'],
  payments: ['owner', 'accountant'],
};

export const can = (u: AuthUser, perm: keyof typeof PERMS) => u.role === 'owner' || PERMS[perm].includes(u.role);

export const allow = (perm: keyof typeof PERMS): RequestHandler => (req, res, next) =>
  can(req.user, perm) ? next() : res.status(403).json({ error: 'Your role does not allow this action' });

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

/** Wrap async route handlers so errors become JSON responses. */
export const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res) => {
  fn(req, res).then((out) => { if (!res.headersSent) res.json(out ?? { ok: true }); }).catch((e: unknown) => {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    res.status(status).json({ error: e instanceof Error ? e.message : 'Unexpected error' });
  });
};
