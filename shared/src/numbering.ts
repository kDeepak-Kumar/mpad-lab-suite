/**
 * Document numbering. Formats use tokens:
 *   {SEQ} or {SEQ:4} running number (zero-padded), {FY} 26-27, {FYFULL} 2026-27,
 *   {YYYY} {YY} {MM} {DD} from the document date, {CLIENT} client short code, {MAT} material.
 * Examples: quote "MPAD/{SEQ:3}/{FY}" → MPAD/076/26-27; invoice "{SEQ}/{FY}" → 183/26-27;
 *           job code "MPAD/{CLIENT}/{SEQ:4}/{MM}/{YYYY}" → MPAD/XDPL/0116/10/2026.
 */

/** Indian financial year (April–March) for a date: 2026-10-10 → { start: 2026, short: "26-27" }. */
export function financialYear(d: Date | string) {
  const dt = typeof d === 'string' ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')) : d;
  const y = dt.getFullYear(), m = dt.getMonth() + 1;
  const start = m >= 4 ? y : y - 1;
  return { start, short: `${String(start).slice(2)}-${String(start + 1).slice(2)}`, full: `${start}-${String(start + 1).slice(2)}` };
}

/** Which counter a format uses: per financial year, per calendar year, or never resetting. */
export function counterScope(format: string, date: string): string {
  if (/\{FY|\{FYFULL\}/.test(format)) return `FY${financialYear(date).start}`;
  if (/\{YYYY\}|\{YY\}/.test(format)) return `Y${date.slice(0, 4)}`;
  return 'ALL';
}

export function formatNumber(format: string, seq: number, ctx: { date: string; client?: string; material?: string }): string {
  const [yyyy, mm, dd] = ctx.date.slice(0, 10).split('-');
  const fy = financialYear(ctx.date);
  return format
    .replace(/\{SEQ(?::(\d+))?\}/g, (_, w) => String(seq).padStart(w ? Number(w) : 1, '0'))
    .replace(/\{FYFULL\}/g, fy.full)
    .replace(/\{FY\}/g, fy.short)
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{YY\}/g, yyyy.slice(2))
    .replace(/\{MM\}/g, mm)
    .replace(/\{DD\}/g, dd)
    .replace(/\{CLIENT\}/g, (ctx.client || 'GEN').toUpperCase())
    .replace(/\{MAT\}/g, ctx.material || '');
}

export const DEFAULT_NUMBERING: Record<string, string> = {
  quote: 'Q/{SEQ:3}/{FY}',
  invoice: '{SEQ}/{FY}',
  workorder: 'WO/{SEQ:4}/{FY}',
  sample: 'LAB/{CLIENT}/{SEQ:4}/{MM}/{YYYY}',
  ulr: 'TC00000{YY}{SEQ:8}F',
  report: 'TR/{SEQ:4}/{FY}',
  receipt: 'RCPT/{SEQ:4}/{FY}',
};

/** Replace {{path.to.value}} placeholders from a context object. Unknown paths become empty. */
export function fillPlaceholders(text: string, ctx: Record<string, unknown>): string {
  return (text || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const v = path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), ctx);
    return v === undefined || v === null ? '' : String(v);
  });
}

export function formatDate(d?: string | null): string {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}-${m}-${y}`;
}
