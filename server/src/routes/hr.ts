import { Router } from 'express';
import { z } from 'zod';
import { isIsoDate } from '@suite/shared';
import { db, insert, now, row, today, toJson } from '../db';
import { can, h, HttpError, requireAuth, type AuthUser } from '../auth';
import { audit } from '../services';

/**
 * Employees (profile, photo, qualifications, ID documents) and the daily attendance register.
 * ID numbers (Aadhaar etc.) are shown masked; revealing the full number is audited. ID document files live in
 * the files table (entity "employee") and are visible only to HR managers and the employee themself.
 */
export const hr = Router();
hr.use(['/employees', '/attendance'], requireAuth);

const manage = (u: AuthUser) => can(u, 'manageEmployees');
const marker = (u: AuthUser) => can(u, 'manageEmployees') || can(u, 'markAttendance');
const need = (ok: boolean, msg = 'Only HR / administrators can do this') => { if (!ok) throw new HttpError(403, msg); };
const opt = (n: number) => z.string().trim().max(n).optional().nullable().transform((v) => (v ? v : null));
const date = z.string().refine(isIsoDate, 'Enter a valid date').optional().nullable().or(z.literal('').transform(() => null));
export const STATUSES = ['P', 'A', 'HD', 'L', 'WO', 'H', 'OD'] as const;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM').optional().nullable().or(z.literal('').transform(() => null));

const empSchema = z.object({
  name: z.string().trim().min(1, 'Enter the name').max(120), code: opt(30), user_id: z.number().int().optional().nullable(), designation: opt(120), department: opt(80),
  qualifications: opt(2000), experience: opt(120), date_of_joining: date, date_of_birth: date, phone: opt(40), email: opt(190).refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Enter a valid email'),
  address: opt(1000), emergency_contact: opt(200), blood_group: opt(8), photo: z.string().max(400_000, 'Photo is too large').optional().nullable(),
  id_type: opt(30), id_number: opt(40), pan: opt(12).refine((v) => !v || /^[A-Z]{5}\d{4}[A-Z]$/.test(v.toUpperCase()), 'PAN looks wrong (e.g. ABCDE1234F)'),
  status: z.enum(['active', 'left']).default('active'), left_on: date, notes: opt(2000),
}).superRefine((v, ctx) => {
  if (v.id_number && /aadhaar/i.test(v.id_type ?? '') && !/^\d{12}$/.test(v.id_number.replace(/\s/g, ''))) ctx.addIssue({ code: 'custom', path: ['id_number'], message: 'Aadhaar number has 12 digits' });
});
const mask = (n?: string | null) => (n ? `${'X'.repeat(Math.max(0, n.replace(/\s/g, '').length - 4)).replace(/(.{4})/g, '$1 ')}${n.replace(/\s/g, '').slice(-4)}`.trim() : null);
const view = (e: Record<string, any>, full = false) => ({ ...e, id_number: full ? e.id_number : mask(e.id_number), has_id_number: Boolean(e.id_number) });

async function mine(u: AuthUser) { return db('employees').where({ company_id: u.company_id, user_id: u.id }).first('id'); }

hr.get('/employees', h(async (req) => {
  const u = req.user;
  if (!manage(u) && !marker(u)) { const m = await mine(u); return m ? [view(await db('employees').where({ id: m.id }).first())] : []; }
  const rows = await db('employees as e').leftJoin('users as u', 'u.id', 'e.user_id').where('e.company_id', u.company_id).orderBy('e.name')
    .select('e.id', 'e.code', 'e.name', 'e.user_id', 'e.designation', 'e.department', 'e.phone', 'e.email', 'e.date_of_joining', 'e.status', 'e.photo', 'e.created_at', 'e.updated_at', 'u.email as login');
  const docs = await db('files').where({ company_id: u.company_id, entity: 'employee' }).select('entity_id').count({ n: 'id' }).groupBy('entity_id');
  const dc = new Map((docs as { entity_id: number; n: number }[]).map((d) => [d.entity_id, Number(d.n)]));
  return rows.map((r) => ({ ...r, documents: manage(u) ? dc.get(r.id) ?? 0 : undefined }));
}));

hr.get('/employees/me', h(async (req) => {
  const m = await mine(req.user);
  return m ? view(row(await db('employees').where({ id: m.id }).first(), ['data'])!) : null;
}));

hr.get('/employees/:id', h(async (req) => {
  const e = row(await db('employees').where({ id: Number(req.params.id), company_id: req.user.company_id }).first(), ['data']);
  if (!e) throw new HttpError(404, 'Employee not found');
  need(manage(req.user) || marker(req.user) || e.user_id === req.user.id, 'You can only see your own profile');
  const user = e.user_id ? await db('users').where({ id: e.user_id }).first('id', 'name', 'email', 'role') : null;
  const base = manage(req.user) || e.user_id === req.user.id ? view(e) : { id: e.id, name: e.name, code: e.code, designation: e.designation, department: e.department, photo: e.photo, status: e.status };
  return { ...base, user, canManage: manage(req.user) };
}));

/** Full ID number, for HR only; every reveal is recorded. */
hr.post('/employees/:id/reveal-id', h(async (req) => {
  need(manage(req.user));
  const e = await db('employees').where({ id: Number(req.params.id), company_id: req.user.company_id }).first('id', 'id_type', 'id_number');
  if (!e) throw new HttpError(404, 'Employee not found');
  await audit(db, req.user, 'employee', e.id, 'ID number viewed', { type: e.id_type });
  return { id_number: e.id_number };
}));

hr.post('/employees', h(async (req) => {
  need(manage(req.user));
  const b = empSchema.parse(req.body);
  await checkUnique(req.user.company_id, b);
  const id = await insert(db, 'employees', { ...b, pan: b.pan?.toUpperCase() ?? null, id_number: b.id_number?.replace(/\s/g, '') ?? null, company_id: req.user.company_id, created_at: now(), updated_at: now() });
  await audit(db, req.user, 'employee', id, 'created', { name: b.name });
  return { id };
}));

hr.put('/employees/:id', h(async (req) => {
  need(manage(req.user));
  const id = Number(req.params.id);
  const ex = await db('employees').where({ id, company_id: req.user.company_id }).first();
  if (!ex) throw new HttpError(404, 'Employee not found');
  const raw = { ...req.body };
  if (typeof raw.id_number === 'string' && raw.id_number.includes('X')) raw.id_number = ex.id_number; // masked value sent back unchanged
  const b = empSchema.parse(raw);
  await checkUnique(req.user.company_id, b, id);
  await db('employees').where({ id }).update({ ...b, pan: b.pan?.toUpperCase() ?? null, id_number: b.id_number?.replace(/\s/g, '') ?? null, updated_at: now() });
  const changed = Object.keys(b).filter((k) => k !== 'photo' && String((b as any)[k] ?? '') !== String(ex[k] ?? ''));
  await audit(db, req.user, 'employee', id, 'updated', { fields: changed.map((k) => (k === 'id_number' ? 'id_number (changed)' : k)) });
  return { ok: true };
}));

async function checkUnique(cid: number, b: { code?: string | null; user_id?: number | null }, self?: number) {
  if (b.code && (await db('employees').where({ company_id: cid, code: b.code }).whereNot('id', self ?? 0).first('id'))) throw new HttpError(409, `Employee code ${b.code} is already used`);
  if (b.user_id) {
    if (!(await db('users').where({ id: b.user_id, company_id: cid }).first('id'))) throw new HttpError(400, 'Login user not found');
    if (await db('employees').where({ company_id: cid, user_id: b.user_id }).whereNot('id', self ?? 0).first('id')) throw new HttpError(409, 'That login is already linked to another employee');
  }
}

/** One profile per app user that has none yet (name, designation, qualifications, phone, email copied). */
hr.post('/employees/from-users', h(async (req) => {
  need(manage(req.user));
  const cid = req.user.company_id;
  const linked = new Set((await db('employees').where({ company_id: cid }).whereNotNull('user_id').select('user_id')).map((r) => r.user_id));
  const users = (await db('users').where({ company_id: cid }).select('id', 'name', 'email', 'designation', 'qualifications', 'phone', 'active')).filter((u) => !linked.has(u.id) && u.active !== 0 && u.active !== false);
  for (const u of users) await insert(db, 'employees', { company_id: cid, name: u.name, user_id: u.id, email: u.email, designation: u.designation ?? null, qualifications: u.qualifications ?? null, phone: u.phone ?? null, status: 'active', created_at: now(), updated_at: now() });
  if (users.length) await audit(db, req.user, 'employee', 0, 'profiles created from users', { count: users.length });
  return { created: users.length };
}));

// ---------- attendance ----------
const ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

hr.get('/attendance', h(async (req) => {
  const u = req.user, cid = u.company_id;
  const q = z.object({ date: z.string().refine(isIsoDate).optional(), month: ym.optional(), employee: z.coerce.number().int().optional() }).parse(req.query);
  let empIds: number[] | null = null;
  if (!marker(u)) { const m = await mine(u); if (!m) return { employees: [], records: [] }; empIds = [m.id]; }
  const emp = db('employees').where({ company_id: cid }).select('id', 'code', 'name', 'designation', 'department', 'status', 'date_of_joining', 'left_on').orderBy('name');
  if (empIds) emp.whereIn('id', empIds); else if (q.employee) emp.where('id', q.employee);
  const employees = await emp;
  const rec = db('attendance').where({ company_id: cid }).whereIn('employee_id', employees.map((e) => e.id));
  if (q.date) rec.andWhere('date', q.date); else rec.andWhere('date', 'like', `${q.month ?? today().slice(0, 7)}-%`);
  return { employees, records: await rec.select('id', 'employee_id', 'date', 'status', 'in_time', 'out_time', 'note', 'source', 'updated_at') };
}));

const entry = z.object({ employee_id: z.number().int(), date: z.string().refine(isIsoDate, 'Enter a valid date'), status: z.enum(STATUSES), in_time: time, out_time: time, note: z.string().max(300).optional().nullable() });

async function upsert(u: AuthUser, rows: z.infer<typeof entry>[], source: string) {
  const cid = u.company_id;
  const ids = new Set((await db('employees').where({ company_id: cid }).select('id')).map((e) => e.id));
  const bad = rows.find((r) => !ids.has(r.employee_id));
  if (bad) throw new HttpError(400, 'Unknown employee in the register');
  if (rows.some((r) => r.date > today())) throw new HttpError(400, 'Attendance cannot be marked for a future date');
  let created = 0, updated = 0;
  for (const r of rows) {
    const ex = await db('attendance').where({ company_id: cid, employee_id: r.employee_id, date: r.date }).first('id');
    const data = { status: r.status, in_time: r.in_time ?? null, out_time: r.out_time ?? null, note: r.note ?? null, source, marked_by: u.id, updated_at: now() };
    if (ex) { await db('attendance').where({ id: ex.id }).update(data); updated++; }
    else { await db('attendance').insert({ ...data, company_id: cid, employee_id: r.employee_id, date: r.date, created_at: now() }); created++; }
  }
  return { created, updated };
}

hr.put('/attendance', h(async (req) => {
  need(marker(req.user), 'Your role cannot mark attendance');
  const { rows } = z.object({ rows: z.array(entry).min(1).max(2000) }).parse(req.body);
  const r = await upsert(req.user, rows, 'manual');
  await audit(db, req.user, 'attendance', 0, 'attendance marked', { dates: [...new Set(rows.map((x) => x.date))].slice(0, 31), ...r });
  return r;
}));

/** Upload from a spreadsheet or biometric export: employee code (or name), date, status and/or in/out times. Checked first (dryRun). */
hr.post('/attendance/import', h(async (req) => {
  need(marker(req.user), 'Your role cannot mark attendance');
  const { rows, dryRun } = z.object({ rows: z.array(z.record(z.any())).max(10000, 'Import at most 10,000 rows at a time'), dryRun: z.boolean().default(true) }).parse(req.body);
  const emps = await db('employees').where({ company_id: req.user.company_id }).select('id', 'code', 'name');
  const byCode = new Map(emps.filter((e) => e.code).map((e) => [String(e.code).trim().toLowerCase(), e]));
  const byName = new Map(emps.map((e) => [String(e.name).trim().toLowerCase(), e]));
  const pick = (r: Record<string, any>, ...keys: string[]) => { for (const [k, v] of Object.entries(r)) if (keys.some((x) => k.toLowerCase().replace(/[^a-z]/g, '').includes(x))) return v === null || v === undefined ? '' : String(v).trim(); return ''; };
  const ok: z.infer<typeof entry>[] = []; const errors: { row: number; error: string }[] = [];
  rows.forEach((r, i) => {
    const code = pick(r, 'employeecode', 'empcode', 'code', 'employeeid', 'empid'), name = pick(r, 'employeename', 'name');
    const e = (code && byCode.get(code.toLowerCase())) || (name && byName.get(name.toLowerCase()));
    if (!e) { if (code || name) errors.push({ row: i + 2, error: `No employee with code/name “${code || name}”` }); return; }
    const d = parseDate(pick(r, 'date', 'day'));
    if (!d) { errors.push({ row: i + 2, error: 'Date missing or not understood (use DD-MM-YYYY)' }); return; }
    const inT = parseTime(pick(r, 'intime', 'in', 'checkin', 'punchin', 'firstin')), outT = parseTime(pick(r, 'outtime', 'out', 'checkout', 'punchout', 'lastout'));
    let st = pick(r, 'status', 'attendance').toUpperCase();
    st = ({ PRESENT: 'P', ABSENT: 'A', 'HALF DAY': 'HD', HALFDAY: 'HD', LEAVE: 'L', 'WEEKLY OFF': 'WO', WEEKOFF: 'WO', OFF: 'WO', HOLIDAY: 'H', 'ON DUTY': 'OD' } as Record<string, string>)[st] ?? st;
    if (!st) st = inT ? 'P' : 'A';
    if (!(STATUSES as readonly string[]).includes(st)) { errors.push({ row: i + 2, error: `Status “${st}” – use P, A, HD, L, WO, H or OD` }); return; }
    if (d > today()) { errors.push({ row: i + 2, error: 'Date is in the future' }); return; }
    ok.push({ employee_id: e.id, date: d, status: st as never, in_time: inT, out_time: outT, note: pick(r, 'note', 'remark') || null });
  });
  if (dryRun || errors.length) return { valid: ok.length, errors: errors.slice(0, 200), errorCount: errors.length, sample: ok.slice(0, 5) };
  const r = await upsert(req.user, ok, 'upload');
  await audit(db, req.user, 'attendance', 0, 'attendance imported', { rows: ok.length, ...r });
  return { ...r, valid: ok.length, errors: [] };
}));

function parseDate(s: string): string | null {
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000); return d.toISOString().slice(0, 10); } // Excel serial
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/); if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  const t = Date.parse(s); return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}
function iso(y: number, mo: number, d: number) { const x = new Date(Date.UTC(y, mo - 1, d)); return x.getUTCMonth() === mo - 1 && x.getUTCDate() === d ? x.toISOString().slice(0, 10) : null; }
function parseTime(s: string): string | null {
  if (!s) return null;
  if (/^0?\.\d+$/.test(s)) { const mins = Math.round(Number(s) * 1440); return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`; } // Excel time
  const m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i); if (!m) return null;
  let hh = +m[1]; if (m[3]?.toLowerCase() === 'pm' && hh < 12) hh += 12; if (m[3]?.toLowerCase() === 'am' && hh === 12) hh = 0;
  return hh < 24 ? `${String(hh).padStart(2, '0')}:${m[2]}` : null;
}
export const _t = { parseDate, parseTime, mask, toJson };
