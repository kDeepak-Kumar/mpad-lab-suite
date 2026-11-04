import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { db, now } from './db';
import { getCompany } from './services';

/**
 * Retention: after N months (Settings → Defaults, default 12) the contents of vendor reports, dispatch evidence and
 * bill copies move out of the database into gzip files under ARCHIVE_DIR (next to the database). The record stays,
 * downloads keep working, and the server backup includes the archive folder.
 */
export const archiveDir = () => process.env.ARCHIVE_DIR || path.join(path.dirname(path.resolve(process.env.DATABASE_FILE || path.join(process.cwd(), 'data', 'suite.sqlite'))), 'archive');
const ENTITIES = ['outsource', 'purchase'];

export async function readArchived(rel: string) {
  const file = path.join(archiveDir(), rel);
  if (!file.startsWith(archiveDir())) throw new Error('Bad archive path');
  return zlib.gunzipSync(await fs.promises.readFile(file));
}

export async function archiveOldFiles(cid: number) {
  const months = Number(((await getCompany(cid)).defaults as any)?.retainMonths ?? 12);
  if (!months) return { archived: 0 };
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months);
  const old = await db('files').where({ company_id: cid }).whereIn('entity', ENTITIES).whereNull('archived_at').andWhere('created_at', '<', cutoff.toISOString()).select('id', 'entity', 'entity_id', 'name', 'created_at').limit(500);
  let archived = 0;
  for (const f of old) {
    const row = await db('files').where({ id: f.id }).first('data');
    if (!row?.data) continue;
    const year = String(f.created_at).slice(0, 4);
    const rel = path.join(String(cid), year, f.entity, `${f.id}-${String(f.name).replace(/[^\w.-]+/g, '_')}.gz`);
    const abs = path.join(archiveDir(), rel);
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, zlib.gzipSync(Buffer.from(String(row.data), 'base64'), { level: 9 }));
    await db('files').where({ id: f.id }).update({ data: '', archive_path: rel, archived_at: now() });
    archived++;
  }
  return { archived };
}

/** Runs once a day. */
export function startArchiveScheduler() {
  const run = async () => { for (const c of await db('companies').select('id')) await archiveOldFiles(c.id).catch((e) => console.error('archive', e.message)); };
  setTimeout(run, 60_000).unref();
  setInterval(run, 24 * 3600_000).unref();
}
