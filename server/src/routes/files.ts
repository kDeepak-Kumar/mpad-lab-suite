import { Router } from 'express';
import { z } from 'zod';
import { db, insert, now } from '../db';
import { can, h, HttpError, requireAuth } from '../auth';
import { audit } from '../services';
import { readArchived } from '../archive';

/** Attachments (calibration certificates for now) stored in the database, so backups include them. */
export const files = Router();
files.use(requireAuth);

const ENTITIES: Record<string, { table: string | null; read: string; write: string; self?: string; sensitive?: boolean }> = {
  equipment: { table: 'equipment', read: 'equipment.read', write: 'equipment.edit' },
  /** Company documents (brochure, accreditation certificate…): entity_id is always 0. Anyone signed in can read and attach them. */
  company: { table: null, read: '', write: 'manageSettings' },
  /** Outsourced test: dispatch evidence and the external lab's report. */
  outsource: { table: 'outsource_jobs', read: 'sample.read', write: 'manageOutsourcing' },
  /** Vendor bill copy. */
  purchase: { table: 'purchases', read: 'managePurchases', write: 'managePurchases' },
  /** Employee ID documents (Aadhaar, PAN, certificates): HR and the employee themself only; every view is recorded. */
  employee: { table: 'employees', read: 'manageEmployees', write: 'manageEmployees', self: 'user_id', sensitive: true },
};
/** May this user read files of that record? (role permission, or their own employee record) */
async function mayRead(u: { id: number; company_id: number } & Parameters<typeof can>[0], entity: string, id: number) {
  const e = ENTITIES[entity];
  if (!e) return false;
  if (!e.read || can(u, e.read)) return true;
  if (e.self && e.table) { const r = await db(e.table).where({ id, company_id: u.company_id }).first(e.self); return Boolean(r && r[e.self] === u.id); }
  return false;
}
const MAX_BYTES = 10 * 1024 * 1024;
const MIME = /^(application\/pdf|image\/(png|jpe?g|webp)|application\/vnd\.openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document))$/;

async function owned(cid: number, entity: string, id: number) {
  const e = ENTITIES[entity];
  if (!e) throw new HttpError(400, 'Attachments are not available for this record');
  if (e.table === null) { if (id !== 0) throw new HttpError(400, 'Company documents use entity_id 0'); return e; }
  if (!(await db(e.table).where({ id, company_id: cid }).first())) throw new HttpError(404, 'Record not found');
  return e;
}

files.get('/files', h(async (req) => {
  const entity = String(req.query.entity ?? ''), id = Number(req.query.entity_id);
  await owned(req.user.company_id, entity, id);
  if (!(await mayRead(req.user, entity, id))) throw new HttpError(403, 'Your role cannot see these files');
  return db('files as f').leftJoin('users as u', 'u.id', 'f.uploaded_by').where({ 'f.company_id': req.user.company_id, 'f.entity': entity, 'f.entity_id': id })
    .select('f.id', 'f.name', 'f.mime', 'f.size', 'f.note', 'f.kind', 'f.archived_at', 'f.created_at', 'u.name as uploaded_by_name').orderBy('f.id', 'desc');
}));

files.post('/files', h(async (req) => {
  const b = z.object({ entity: z.string(), entity_id: z.number().int().min(0), name: z.string().trim().min(1).max(200), mime: z.string(), data: z.string().min(1), note: z.string().max(300).optional().nullable(), kind: z.string().max(30).optional().nullable() }).parse(req.body);
  const e = await owned(req.user.company_id, b.entity, b.entity_id);
  if (!can(req.user, e.write)) throw new HttpError(403, 'Your role cannot upload files here');
  if (!MIME.test(b.mime)) throw new HttpError(400, 'Upload a PDF, image (PNG/JPG) or Word/Excel file');
  const base64 = b.data.replace(/^data:[^;]+;base64,/, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) throw new HttpError(400, 'File content is not valid');
  const size = Math.floor((base64.replace(/\s/g, '').length * 3) / 4);
  if (size > MAX_BYTES) throw new HttpError(400, 'File is larger than 10 MB');
  const name = b.name.replace(/[\\/:*?"<>|]+/g, '_');
  const id = await insert(db, 'files', { company_id: req.user.company_id, entity: b.entity, entity_id: b.entity_id, name, mime: b.mime, size, data: base64, note: b.note ?? null, kind: b.kind ?? null, uploaded_by: req.user.id, created_at: now() });
  await audit(db, req.user, b.entity, b.entity_id, 'file attached', { name, size });
  return { id };
}));

files.get('/files/:id/download', async (req, res) => {
  try {
    const f = await db('files').where({ id: Number(req.params.id), company_id: req.user.company_id }).first();
    if (!f) { res.status(404).json({ error: 'File not found' }); return; }
    const e = ENTITIES[f.entity];
    if (!e || !(await mayRead(req.user, f.entity, f.entity_id))) { res.status(403).json({ error: 'Not allowed' }); return; }
    if (e.sensitive) await audit(db, req.user, f.entity, f.entity_id, 'document viewed', { name: f.name });
    const buf = f.archive_path ? await readArchived(f.archive_path) : Buffer.from(String(f.data), 'base64');
    res.setHeader('Content-Type', f.mime || 'application/octet-stream');
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(f.name)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(buf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

files.delete('/files/:id', h(async (req) => {
  const f = await db('files').where({ id: Number(req.params.id), company_id: req.user.company_id }).first();
  if (!f) throw new HttpError(404, 'File not found');
  const e = ENTITIES[f.entity];
  if (!e || !can(req.user, e.write)) throw new HttpError(403, 'Your role cannot delete this file');
  await db('files').where({ id: f.id }).delete();
  await audit(db, req.user, f.entity, f.entity_id, 'file removed', { name: f.name });
  return { ok: true };
}));
