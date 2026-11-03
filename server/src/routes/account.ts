import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db, now } from '../db';
import { allow, checkPassword, clearPolicyCache, companyRequires2fa, h, hashPassword, HttpError, isAdmin, requireAuth, setSession } from '../auth';
import { audit, getCompany } from '../services';
import { mailer } from '../alerts';
import { emailHtml } from '../email';
import {
  backupCodesLeft, currentDeviceHash, describeAgent, deviceTrusted, loginBlocked, loginFailed, loginOk, newBackupCodes, newTotpSecret,
  otpauthUrl, seal, touchDevice, unseal, useBackupCode, verifyTotp,
} from '../security';

/** Sign-in (with two-step verification), new-device alerts and the user's own security settings. */
export const account = Router();

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'), password: z.string().min(1, 'Enter your password'),
  code: z.string().optional(), remember: z.boolean().optional(),
});

account.post('/auth/login', h(async (req, res) => {
  const { email, password, code, remember } = loginSchema.parse(req.body);
  const em = email.toLowerCase();
  const wait = loginBlocked(req, em);
  if (wait) throw new HttpError(429, `Too many attempts. Try again in ${wait} minute${wait > 1 ? 's' : ''}.`);
  const u = await db('users').where({ email: em, active: true }).first();
  if (!u || !(await checkPassword(password, u.password_hash))) { loginFailed(req, em); throw new HttpError(401, 'Email or password is incorrect'); }

  if (u.totp_enabled && !(await deviceTrusted(u.id, req))) {
    if (!code) return { twoFactor: true };
    const c = code.trim();
    let ok = false;
    if (/^\d{6}$/.test(c.replace(/\s/g, ''))) ok = Boolean(u.totp_secret) && verifyTotp(unseal(u.totp_secret), c);
    else {
      const left = useBackupCode(u.backup_codes, c);
      if (left !== null) { ok = true; await db('users').where({ id: u.id }).update({ backup_codes: left }); await audit(db, u, 'user', u.id, 'signed in with a backup code', { left: backupCodesLeft(left) }); }
    }
    if (!ok) { loginFailed(req, em); throw new HttpError(401, 'That code is not correct. Use the 6-digit code from your authenticator app, or a backup code.'); }
  }
  loginOk(req, em);
  const dev = await touchDevice(u.id, req, res, { remember: Boolean(remember && u.totp_enabled) });
  setSession(res, u);
  if (dev.isNew) void newDeviceAlert(u, dev, req);
  return { id: u.id, name: u.name, role: u.role };
}));

async function newDeviceAlert(u: { id: number; company_id: number; name: string; email: string }, dev: { label: string; ip: string }, _req: Request) {
  const when = new Date().toLocaleString('en-IN', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  await audit(db, u as never, 'user', u.id, 'new device sign-in', { device: dev.label, ip: dev.ip });
  try {
    const company = await getCompany(u.company_id);
    const send = await mailer(company);
    const text = `Hi ${u.name},\n\nYour ${company.name} account was just used to sign in on a new device.\n\nDevice: ${dev.label}\nIP address: ${dev.ip}\nTime: ${when}\n\nIf this was you, you can ignore this email.\nIf it wasn't you, sign in now, change your password and use "Sign out of all other devices" under My account → Security. Turning on two-step verification stops anyone who only knows your password.`;
    await send({ to: u.email, subject: `New sign-in to your ${company.name} account`, text, html: emailHtml(company, text, { footer: false }) });
  } catch { /* email not set up: the alert still shows in the app */ }
}

account.post('/auth/logout', h(async (_req, res) => { res.clearCookie('suite_sid'); return { ok: true }; }));

/** Public: name, logo and tagline for the sign-in page (no secrets). */
account.get('/public/branding', h(async () => {
  const first = await db('companies').orderBy('id').first('id');
  if (!first) return {};
  const c = await getCompany(first.id);
  return {
    name: c.name, tagline: c.tagline ?? '', logo: c.logo ?? null, accreditation: c.accreditation?.certNo ? { body: c.accreditation.body || 'NABL', certNo: c.accreditation.certNo } : null,
    accreditationLogo: c.accreditationLogo ?? null, website: c.website ?? '', phone: c.phone ?? '', email: c.email ?? '', address: c.address ?? '',
    highlights: ((c as any).login?.highlights as string[] | undefined) ?? null, accent: (c as any).login?.accent ?? null,
  };
}));

// ---------- signed-in user's own security ----------
account.use('/account', requireAuth);

account.get('/account/security', h(async (req) => {
  const u = await db('users').where({ id: req.user.id }).first();
  const cur = currentDeviceHash(req);
  const devices = await db('user_devices').where({ user_id: req.user.id }).orderBy('last_seen', 'desc');
  return {
    totpEnabled: Boolean(u.totp_enabled), backupCodesLeft: backupCodesLeft(u.backup_codes), required: await companyRequires2fa(req.user.company_id),
    devices: devices.map((d) => ({ id: d.id, label: describeAgent(d.user_agent), ip: d.ip, firstSeen: d.first_seen, lastSeen: d.last_seen, current: d.device_hash === cur, remembered: Boolean(d.trusted_until && d.trusted_until > new Date().toISOString()) })),
  };
}));

account.post('/account/2fa/setup', h(async (req) => {
  const company = await getCompany(req.user.company_id);
  const secret = newTotpSecret();
  await db('users').where({ id: req.user.id }).update({ totp_pending: seal(secret) });
  return { secret: secret.replace(/(.{4})/g, '$1 ').trim(), otpauth: otpauthUrl(secret, req.user.email, company.name) };
}));

account.post('/account/2fa/enable', h(async (req) => {
  const { code } = z.object({ code: z.string() }).parse(req.body);
  const u = await db('users').where({ id: req.user.id }).first();
  if (!u.totp_pending) throw new HttpError(400, 'Start the setup again');
  const secret = unseal(u.totp_pending);
  if (!verifyTotp(secret, code)) throw new HttpError(400, 'That code is not correct. Check the time on your phone is automatic and try the newest code.');
  const { codes, stored } = newBackupCodes();
  await db('users').where({ id: req.user.id }).update({ totp_secret: seal(secret), totp_pending: null, totp_enabled: true, backup_codes: stored });
  await audit(db, req.user, 'user', req.user.id, 'two-step verification turned on');
  return { backupCodes: codes };
}));

const pw = z.object({ password: z.string().min(1, 'Enter your password') });
async function confirmPassword(req: Request, password: string) {
  const u = await db('users').where({ id: req.user.id }).first();
  if (!(await checkPassword(password, u.password_hash))) throw new HttpError(400, 'Password is incorrect');
  return u;
}

account.post('/account/2fa/disable', h(async (req) => {
  const { password } = pw.parse(req.body);
  await confirmPassword(req, password);
  if (await companyRequires2fa(req.user.company_id)) throw new HttpError(400, 'Your company requires two-step verification, so it cannot be turned off. You can set it up again on a new phone instead.');
  await db('users').where({ id: req.user.id }).update({ totp_secret: null, totp_pending: null, totp_enabled: false, backup_codes: null });
  await db('user_devices').where({ user_id: req.user.id }).update({ trusted_until: null });
  await audit(db, req.user, 'user', req.user.id, 'two-step verification turned off');
  return { ok: true };
}));

account.post('/account/2fa/backup-codes', h(async (req) => {
  const { password } = pw.parse(req.body);
  const u = await confirmPassword(req, password);
  if (!u.totp_enabled) throw new HttpError(400, 'Turn on two-step verification first');
  const { codes, stored } = newBackupCodes();
  await db('users').where({ id: req.user.id }).update({ backup_codes: stored });
  await audit(db, req.user, 'user', req.user.id, 'new backup codes generated');
  return { backupCodes: codes };
}));

account.post('/account/password', h(async (req, res: Response) => {
  const { current, next } = z.object({ current: z.string().min(1, 'Enter your current password'), next: z.string().min(8, 'New password must be at least 8 characters') }).parse(req.body);
  const u = await confirmPassword(req, current);
  if (current === next) throw new HttpError(400, 'Choose a password different from the current one');
  const tv = Number(u.token_version ?? 0) + 1;
  await db('users').where({ id: req.user.id }).update({ password_hash: await hashPassword(next), token_version: tv });
  setSession(res, { id: u.id, token_version: tv });
  await audit(db, req.user, 'user', req.user.id, 'password changed (other devices signed out)');
  return { ok: true };
}));

account.post('/account/signout-others', h(async (req, res) => {
  const u = await db('users').where({ id: req.user.id }).first();
  const tv = Number(u.token_version ?? 0) + 1;
  await db('users').where({ id: u.id }).update({ token_version: tv });
  const cur = currentDeviceHash(req);
  await db('user_devices').where({ user_id: u.id }).whereNot('device_hash', cur ?? '').update({ trusted_until: null });
  setSession(res, { id: u.id, token_version: tv });
  await audit(db, req.user, 'user', u.id, 'signed out of all other devices');
  return { ok: true };
}));

account.delete('/account/devices/:id', h(async (req) => {
  await db('user_devices').where({ id: Number(req.params.id), user_id: req.user.id }).delete();
  return { ok: true };
}));

/** Admin: reset a user's two-step verification (lost phone). */
account.post('/account/admin/reset-2fa/:id', allow('users'), h(async (req) => {
  const id = Number(req.params.id);
  const t = await db('users').where({ id, company_id: req.user.company_id }).first();
  if (!t) throw new HttpError(404, 'User not found');
  if (t.role === 'admin' && !isAdmin(req.user)) throw new HttpError(403, 'Only a System Administrator can reset another System Administrator');
  await db('users').where({ id }).update({ totp_secret: null, totp_pending: null, totp_enabled: false, backup_codes: null, token_version: Number(t.token_version ?? 0) + 1 });
  await db('user_devices').where({ user_id: id }).update({ trusted_until: null });
  await audit(db, req.user, 'user', id, 'two-step verification reset by admin');
  return { ok: true };
}));

account.post('/account/admin/policy', allow('settings'), h(async (req) => {
  const { require2fa } = z.object({ require2fa: z.boolean() }).parse(req.body);
  const row = await db('companies').where({ id: req.user.company_id }).first();
  const data = JSON.parse(row.data ?? '{}');
  if (require2fa) {
    const me = await db('users').where({ id: req.user.id }).first();
    if (!me.totp_enabled) throw new HttpError(400, 'Turn on two-step verification for your own account first, so you are not locked out.');
  }
  data.security = { ...(data.security ?? {}), require2fa };
  await db('companies').where({ id: req.user.company_id }).update({ data: JSON.stringify(data) });
  clearPolicyCache();
  await audit(db, req.user, 'company', req.user.company_id, `two-step verification ${require2fa ? 'required' : 'optional'} for all users`);
  return { ok: true, at: now() };
}));
