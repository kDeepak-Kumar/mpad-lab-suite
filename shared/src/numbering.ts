/**
 * Document numbering. Formats use tokens:
 *   {SEQ} or {SEQ:4} running number (zero-padded), {FY} 26-27, {FYFULL} 2026-27,
 *   {YYYY} {YY} {MM} {DD} from the document date, {CLIENT} client short code, {MAT} material,
 *   {MATCODE} 3-letter material code (CEM, CON, STL…), {Y1} last digit of the year, {ML} month letter (A = Jan … L = Dec),
 *   {FP} F (all tests within the NABL scope) or P (partly) – for the ULR.
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

/** 3-letter material codes for report numbers. */
export const MATERIAL_CODES: Record<string, string> = { soil: 'SOL', concrete: 'CON', cement: 'CEM', steel: 'STL', aggregate: 'AGG', sand: 'SND', 'brick / block': 'BRK', water: 'WTR', bitumen: 'BIT', gsb: 'GSB', rock: 'RCK', ggbs: 'GGB', service: 'SRV' };
export const materialCode = (m?: string) => (m ? MATERIAL_CODES[m.toLowerCase()] ?? m.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() : 'GEN');
/** Consecutive codes shortened to a range: 6J0136, 6J0137 … 6J0142 → "6J0136 – 0142". */
export function codeRange(codes: string[]): string {
  const out: string[] = [];
  let i = 0;
  const parse = (c: string) => { const m = /^(.*?)(\d+)(\D*)$/.exec(c); return m ? { pre: m[1], n: Number(m[2]), w: m[2].length, post: m[3] } : null; };
  while (i < codes.length) {
    const a = parse(codes[i]);
    let j = i;
    while (a && j + 1 < codes.length) { const b = parse(codes[j + 1]); if (!b || b.pre !== a.pre || b.post !== a.post || b.n !== a.n + (j + 1 - i)) break; j++; }
    out.push(j > i && a ? `${codes[i]} – ${String(a.n + (j - i)).padStart(a.w, '0')}${a.post}` : codes[i]);
    i = j + 1;
  }
  return out.join(', ');
}

/**
 * NABL accreditation certificate number as used inside the ULR: "NABLT0726TS18813 (In lieu of TC-10775)" → "NABLT0726TS18813",
 * "TC-5064" → "TC5064". Without a certificate number the old placeholder TC00000 is kept.
 */
export function certCode(certNo?: string | null): string {
  const c = String(certNo ?? '').replace(/\(.*?\)/g, '').replace(/[\s\-/]/g, '').toUpperCase();
  return c || 'TC00000';
}

export function formatNumber(format: string, seq: number, ctx: { date: string; client?: string; material?: string; fp?: 'F' | 'P'; cert?: string | null; loc?: string | null }): string {
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
    .replace(/\{MATCODE\}/g, materialCode(ctx.material))
    .replace(/\{MAT\}/g, ctx.material || '')
    .replace(/\{Y1\}/g, yyyy.slice(3))
    .replace(/\{ML\}/g, 'ABCDEFGHIJKL'[Number(mm) - 1] ?? '')
    .replace(/\{FP\}/g, ctx.fp ?? 'F')
    .replace(/\{CERT\}/g, certCode(ctx.cert))
    .replace(/\{LOC\}/g, /^\d$/.test(String(ctx.loc ?? '')) ? String(ctx.loc) : '0');
}

export const DEFAULT_NUMBERING: Record<string, string> = {
  quote: 'Q/{SEQ:3}/{FY}',
  invoice: '{SEQ}/{FY}',
  workorder: 'WO/{SEQ:4}/{FY}',
  sample: 'LAB/{CLIENT}/{SEQ:4}/{MM}/{YYYY}',
  quick: 'QR/{SEQ:4}/{FY}',
  ulr: '{CERT}{YY}{LOC}{SEQ:8}{FP}',
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

/**
 * NABL ULR scope letter: F when every test on the report is within the accredited scope, P when only some are.
 * Tests outside the scope cannot appear on a report carrying the NABL symbol without this marker.
 */
export const ulrScope = (inScope: boolean[]): 'F' | 'P' => (inScope.length && inScope.every(Boolean) ? 'F' : 'P');
/** The 8-digit running number of a ULR (the digits before the final F/P), or 0. */
export const ulrSeq = (ulr?: string | null): number => Number(/(\d{8})[FP]$/.exec(String(ulr ?? '').trim())?.[1] ?? 0);
