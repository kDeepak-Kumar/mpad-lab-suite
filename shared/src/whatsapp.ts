/**
 * WhatsApp click-to-chat helpers and message templates.
 * Messages open in WhatsApp (app or web) with the text filled in; the user presses Send.
 * No WhatsApp Business API account, approval or per-message fee is needed.
 */

export type WaContext = 'quote' | 'invoice' | 'report' | 'reminder' | 'sample' | 'client';

export interface WaTemplate { key: string; label: string; for: WaContext[]; text: string }

export const WA_PLACEHOLDERS: { key: string; label: string }[] = [
  { key: 'contact', label: 'Contact person' }, { key: 'client', label: 'Client name' }, { key: 'site', label: 'Site / project' },
  { key: 'number', label: 'Document number' }, { key: 'date', label: 'Document date' }, { key: 'amount', label: 'Amount' },
  { key: 'balance', label: 'Balance due' }, { key: 'due_date', label: 'Due date' }, { key: 'link', label: 'Secure view / download link' },
  { key: 'tests', label: 'Tests' }, { key: 'sample_code', label: 'Sample job code' }, { key: 'upi', label: 'UPI ID' }, { key: 'bank', label: 'Bank details' },
  { key: 'sender', label: 'Your name' }, { key: 'company', label: 'Company name' }, { key: 'phone', label: 'Company phone' }, { key: 'website', label: 'Website' },
];

export const WA_TEMPLATES: WaTemplate[] = [
  {
    key: 'quote', label: 'Send quotation', for: ['quote'],
    text: `Dear {{contact}},

Greetings from *{{company}}*.

Please find our quotation *{{number}}* for {{site}}.
Quotation value: *₹{{amount}}*

View / download: {{link}}

Kindly confirm or share the work order to schedule the testing. Happy to clarify anything.

Regards,
{{sender}}
{{company}} · {{phone}}`,
  },
  {
    key: 'followup', label: 'Quotation follow-up', for: ['quote'],
    text: `Dear {{contact}},

This is a gentle follow-up on our quotation *{{number}}* dated {{date}} for {{site}}.

{{link}}

Please let us know if you would like to go ahead or need any changes. We can schedule sample collection at your convenience.

Regards,
{{sender}}
{{company}}`,
  },
  {
    key: 'invoice', label: 'Send invoice with payment details', for: ['invoice'],
    text: `Dear {{contact}},

Please find tax invoice *{{number}}* dated {{date}} for {{site}}.
Amount: *₹{{amount}}*

View / download: {{link}}

*Payment details*
{{bank}}
UPI: {{upi}}

Kindly share the payment reference once done. Thank you for your business.

Regards,
{{sender}}
{{company}} · {{phone}}`,
  },
  {
    key: 'reminder', label: 'Payment reminder', for: ['invoice', 'reminder'],
    text: `Dear {{contact}},

A friendly reminder that *₹{{balance}}* is pending against invoice {{number}} (due {{due_date}}).

{{link}}

*Payment details*
{{bank}}
UPI: {{upi}}

If already paid, please share the reference and ignore this message. Thank you.

Regards,
{{sender}}
{{company}} · {{phone}}`,
  },
  {
    key: 'report', label: 'Test report ready', for: ['report'],
    text: `Dear {{contact}},

Your test report *{{number}}* is ready.
Tests: {{tests}}

View / download: {{link}}

The report can be verified by scanning the QR code on it. Please contact us for any clarification.

Regards,
{{sender}}
{{company}} · {{phone}}`,
  },
  {
    key: 'sample', label: 'Sample received', for: ['sample'],
    text: `Dear {{contact}},

We have received your sample at *{{company}}*.
Job code: *{{sample_code}}*
Received on: {{date}}
Tests: {{tests}}

We will share the report once testing is complete.

Regards,
{{sender}}
{{company}} · {{phone}}`,
  },
  {
    key: 'general', label: 'General message', for: ['quote', 'invoice', 'report', 'reminder', 'sample', 'client'],
    text: `Dear {{contact}},

Greetings from *{{company}}*.



Regards,
{{sender}}
{{company}} · {{phone}}
{{website}}`,
  },
];

/** Company templates override the built-in text by key. */
export function waTemplates(custom?: Record<string, string> | null): WaTemplate[] {
  return WA_TEMPLATES.map((t) => (custom?.[t.key]?.trim() ? { ...t, text: custom[t.key] } : t));
}

/**
 * Fill {{placeholders}}. A line whose placeholders are all empty is dropped
 * (e.g. "UPI: {{upi}}" when no UPI ID is set) so messages never show blanks.
 */
export function fillWa(text: string, vars: Record<string, string | number | null | undefined>): string {
  const val = (k: string) => { const v = vars[k]; return v === null || v === undefined ? '' : String(v).trim(); };
  const lines = text.split('\n').flatMap((line) => {
    const keys = [...line.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
    if (keys.length && keys.every((k) => !val(k))) {
      const rest = line.replace(/\{\{\s*\w+\s*\}\}/g, '').trim();
      // Drop label-only lines ("UPI: {{upi}}", "{{bank}}"); keep sentences that merely mention an empty value.
      if (!rest || rest.endsWith(':') || rest.replace(/[\s:·,–-]+/g, '').length <= 12) return [];
    }
    return [line.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => val(k))
      .replace(/\*\s*\*|_\s*_/g, '').replace(/ {2,}/g, ' ').replace(/\s*\((?:due|dated|on)?\s*\)/g, '').replace(/ (for|on|dated) ?([.,])/g, '$2').replace(/\s+·\s*$/g, '').replace(/[ \t]+$/g, '')];
  });
  // A bold heading ("*Payment details*") with nothing under it is removed too.
  const out = lines.filter((l, i) => !(/^\*[^*]+\*$/.test(l.trim()) && !(lines[i + 1] ?? '').trim()));
  return out.join('\n').replace(/\n{3,}(?=\S)/g, '\n\n').trim();
}

/** Indian-friendly normalisation for wa.me: digits only, country code added to 10-digit numbers. Returns null if not a phone number. */
export function waNumber(raw: string | null | undefined, countryCode = '91'): string | null {
  if (!raw) return null;
  const first = String(raw).split(/[,/;]| or /i)[0];
  let d = first.replace(/[^\d+]/g, '');
  const plus = d.startsWith('+');
  d = d.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (!plus && d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!plus && d.length === 10) d = countryCode.replace(/\D/g, '') + d;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/** https://wa.me link; without a number WhatsApp asks whom to send it to. */
export function waLink(phone: string | null, text: string): string {
  return `https://wa.me/${phone ?? ''}?text=${encodeURIComponent(text)}`;
}

export const WA_GREEN = '#25D366';
