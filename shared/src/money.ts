/** GST, totals, Indian number formatting and amount in words. */

export interface LineInput {
  description: string;
  rate: number;
  qty: number | null;      // null for rate-only quotations
  unit?: string;           // e.g. "Per sample", "Per point"
  gstRate?: number;        // default from document
  discountPct?: number;
  sac?: string;
  remarks?: string;
  catalogId?: number | null;
}

export interface TaxLine { rate: number; taxable: number; cgst: number; sgst: number; igst: number }
export interface Totals {
  lines: (LineInput & { amount: number; net: number })[];
  subtotal: number;          // sum of qty × rate
  discount: number;          // line discounts + overall discount
  taxable: number;
  interState: boolean;
  cgst: number; sgst: number; igst: number;
  taxSummary: TaxLine[];
  roundOff: number;
  total: number;
}

export const r2 = (x: number) => Math.round((x + Number.EPSILON * Math.sign(x)) * 100) / 100;

export function computeTotals(
  lines: LineInput[],
  opts: { supplierState: string; placeOfSupply: string; defaultGst?: number; overallDiscount?: number; roundToRupee?: boolean },
): Totals {
  const interState = !!opts.placeOfSupply && opts.supplierState !== opts.placeOfSupply;
  const out = lines.map((l) => {
    const amount = r2((l.qty ?? 0) * (l.rate || 0));
    const net = r2(amount * (1 - (l.discountPct ?? 0) / 100));
    return { ...l, amount, net };
  });
  const subtotal = r2(out.reduce((s, l) => s + l.amount, 0));
  const lineNet = r2(out.reduce((s, l) => s + l.net, 0));
  const overall = r2(opts.overallDiscount ?? 0);
  const taxable = r2(lineNet - overall);
  // spread the overall discount across lines proportionally for the tax summary
  const factor = lineNet > 0 ? taxable / lineNet : 0;
  const byRate = new Map<number, number>();
  for (const l of out) {
    const rate = l.gstRate ?? opts.defaultGst ?? 18;
    byRate.set(rate, (byRate.get(rate) ?? 0) + l.net * factor);
  }
  const taxSummary: TaxLine[] = [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, base]) => {
    const tb = r2(base);
    const tax = r2((tb * rate) / 100);
    return interState
      ? { rate, taxable: tb, cgst: 0, sgst: 0, igst: tax }
      : { rate, taxable: tb, cgst: r2(tax / 2), sgst: r2(tax - r2(tax / 2)), igst: 0 };
  });
  const cgst = r2(taxSummary.reduce((s, t) => s + t.cgst, 0));
  const sgst = r2(taxSummary.reduce((s, t) => s + t.sgst, 0));
  const igst = r2(taxSummary.reduce((s, t) => s + t.igst, 0));
  const gross = r2(taxable + cgst + sgst + igst);
  const total = opts.roundToRupee === false ? gross : Math.round(gross);
  return { lines: out, subtotal, discount: r2(subtotal - taxable), taxable, interState, cgst, sgst, igst, taxSummary, roundOff: r2(total - gross), total };
}

/** 1234567.5 → "12,34,567.50" (Indian grouping). */
export function inr(x: number, decimals = 0): string {
  return x.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`);

/** Indian words: 7493 → "Seven Thousand Four Hundred and Ninety Three". */
export function numberToWordsIndian(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  const hundred = Math.floor(n / 100); const rest = n % 100;
  if (crore) parts.push(`${numberToWordsIndian(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(`${parts.length ? 'and ' : ''}${two(rest)}`);
  return parts.join(' ');
}

export function amountInWords(amount: number): string {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  return `Rupees ${numberToWordsIndian(rupees)}${paise ? ` and ${two(paise)} Paise` : ''} Only`;
}

export const INDIAN_STATES: { code: string; name: string }[] = [
  ['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'],
  ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'],
  ['18', 'Assam'], ['19', 'West Bengal'], ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'], ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'],
  ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'], ['35', 'Andaman and Nicobar Islands'],
  ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'],
].map(([code, name]) => ({ code, name }));

export const stateName = (code?: string | null) => INDIAN_STATES.find((s) => s.code === code)?.name ?? '';

/** GSTIN: 2-digit state + 10-char PAN + entity + Z + checksum. Validates format and checksum. */
export function validateGstin(g: string): { ok: boolean; state?: string; message?: string } {
  const s = (g || '').trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s)) return { ok: false, message: 'GSTIN format is not valid' };
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = chars.indexOf(s[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  const check = chars[(36 - (sum % 36)) % 36];
  if (check !== s[14]) return { ok: false, message: 'GSTIN checksum does not match' };
  return { ok: true, state: s.slice(0, 2) };
}
