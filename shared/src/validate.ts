import { validateGstin } from './money';
import type { FieldDef } from './meta';

/** Plain-language checks shared by the forms (as you type) and the server (on save). */
export const isEmail = (v: string) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(v.trim());
export const isEmailList = (v: string) => v.split(/[,;]/).map((x) => x.trim()).filter(Boolean).every(isEmail);
export const isPhone = (v: string) => { const d = v.replace(/[\s()+\-./]/g, ''); return /^\d{8,15}$/.test(d) && !/[^\d\s()+\-./]/.test(v.replace(/\s*(ext|x)\.?\s*\d+$/i, '')); };
export const isPan = (v: string) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.trim().toUpperCase());
export const isPincode = (v: string) => /^[1-9][0-9]{5}$/.test(v.trim());
export const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(`${v}T00:00:00Z`).getTime()) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Problem with one field value, or null when it is fine (empty values are only checked for "required"). */
export function fieldIssue(f: Pick<FieldDef, 'key' | 'label' | 'type' | 'required'>, v: unknown): string | null {
  const empty = v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
  if (empty) return null;
  const s = typeof v === 'string' ? v.trim() : String(v);
  if (s.length > 2000 && f.type !== 'textarea') return `${f.label} is too long`;
  switch (f.type) {
    case 'email': return isEmailList(s) ? null : `${f.label}: enter a valid email address`;
    case 'phone': return isPhone(s) ? null : `${f.label}: enter a valid phone number (8–15 digits)`;
    case 'number': case 'currency': return typeof v === 'number' || (s !== '' && !isNaN(Number(s))) ? null : `${f.label} must be a number`;
    case 'integer': return Number.isInteger(Number(s)) ? null : `${f.label} must be a whole number`;
    case 'date': return isIsoDate(s) ? null : `${f.label}: enter a valid date`;
  }
  if (f.key === 'gstin') { const g = validateGstin(s); return g.ok ? null : `GSTIN: ${g.message}`; }
  if (f.key === 'pan') return isPan(s) ? null : 'PAN must be 5 letters, 4 digits and a letter (e.g. AAECS1234K)';
  if (f.key === 'pincode' || f.key === 'pin') return isPincode(s) ? null : 'PIN code must be 6 digits';
  return null;
}
