import fs from 'node:fs';
import path from 'node:path';
import { db } from './db';

/**
 * Disk and database usage, so the server never fills up unnoticed.
 * Shown in Settings → Company → Email & alerts, and added to the daily alert email
 * when the disk passes WARN_PCT (default 80 %).
 */
export const WARN_PCT = Number(process.env.DISK_WARN_PCT || 80);

export interface StorageInfo {
  dbBytes: number; filesBytes: number; filesCount: number;
  disk: { totalBytes: number; freeBytes: number; usedPct: number } | null;
  warn: boolean; dataDir: string;
}

const dataFile = () => process.env.DATABASE_FILE || path.resolve(process.cwd(), 'data', 'suite.sqlite');
const size = (f: string) => { try { return fs.statSync(f).size; } catch { return 0; } };

export async function storageInfo(): Promise<StorageInfo> {
  let dbBytes = 0;
  if ((process.env.DB_CLIENT || 'sqlite') === 'mysql') {
    const r = await db.raw('SELECT COALESCE(SUM(data_length + index_length), 0) AS b FROM information_schema.tables WHERE table_schema = DATABASE()');
    dbBytes = Number((r[0]?.[0] ?? r[0])?.b ?? 0);
  } else {
    const f = dataFile();
    dbBytes = size(f) + size(`${f}-wal`) + size(`${f}-shm`);
  }
  const fr = await db('files').sum({ s: 'size' }).count({ n: '*' }).first();
  const dataDir = path.dirname(dataFile());
  let disk: StorageInfo['disk'] = null;
  try {
    const s = fs.statfsSync(dataDir);
    // same arithmetic as `df`: used / (used + available to normal users)
    const used = (s.blocks - s.bfree) * s.bsize; const free = s.bavail * s.bsize;
    disk = { totalBytes: used + free, freeBytes: free, usedPct: used + free ? Math.round((used / (used + free)) * 1000) / 10 : 0 };
  } catch { /* statfs not available on this host */ }
  return { dbBytes, filesBytes: Number(fr?.s ?? 0), filesCount: Number(fr?.n ?? 0), disk, warn: Boolean(disk && disk.usedPct >= WARN_PCT), dataDir };
}

export const human = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
