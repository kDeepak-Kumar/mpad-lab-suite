import { notifications } from '@mantine/notifications';
import { useCallback, useEffect, useState } from 'react';

export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; quiet?: boolean } = {}): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let j: any = null;
  try { j = await r.json(); } catch { /* empty */ }
  if (!r.ok) {
    const msg = j?.error || `Request failed (${r.status})`;
    if (r.status === 401 && !path.startsWith('/auth')) { window.location.href = '/login'; }
    if (!opts.quiet) notifications.show({ color: 'red', title: 'Could not complete', message: msg });
    throw new ApiError(r.status, msg);
  }
  return j as T;
}

export const ok = (message: string) => notifications.show({ color: 'teal', message });

/** Load data from the API with reload support. */
export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!path) { setLoading(false); return; }
    setLoading(true);
    try { setData(await api<T>(path)); } catch { /* shown */ } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, reload: load, setData };
}

export const money = (n?: number | null, d = 0) => (n === null || n === undefined || isNaN(Number(n)) ? '' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const dmy = (d?: string | null) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '');
export const localToday = () => new Date().toLocaleDateString('en-CA');

export function fileToDataUrl(file: File, maxPx = 600): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = fr.result as string;
    };
    fr.readAsDataURL(file);
  });
}

/** Download rows as a CSV file that opens in Excel. */
export function downloadCsv(filename: string, columns: { key: string; label: string }[], rows: Record<string, unknown>[]) {
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Parse a simple CSV (as saved from Excel) into objects keyed by the header row. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let cur: string[] = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; continue; }
    if (c === '"') q = true; else if (c === ',') { cur.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; cur.push(f); rows.push(cur); cur = []; f = ''; } else f += c;
  }
  if (f || cur.length) { cur.push(f); rows.push(cur); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim() !== ''));
  if (!head) return [];
  const keys = head.map((h) => h.replace(/^﻿/, '').trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}
