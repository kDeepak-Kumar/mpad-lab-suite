import type { CompanyProfile } from './services';

/**
 * Branded email: the message text plus a footer built from Settings → Company (phone, email,
 * website, address, map link, WhatsApp and a "leave us a review" link). Sent as HTML with a plain-text twin.
 */
export interface EmailFooterSettings {
  enabled?: boolean; reviewUrl?: string; mapsUrl?: string; whatsapp?: string; extra?: string; showLogo?: boolean;
  /** Where to show the review link: always, or only on reports and invoices (after work is done). */
  reviewOn?: 'all' | 'after-service' | 'never';
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const url = (s?: string) => (!s ? '' : /^https?:\/\//i.test(s) ? s : `https://${s}`);
const linkify = (s: string) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:inherit">$1</a>');

export function footerParts(c: CompanyProfile, opts: { kind?: string } = {}) {
  const f = ((c as any).emailFooter ?? {}) as EmailFooterSettings;
  if (f.enabled === false) return null;
  const reviewOn = f.reviewOn ?? 'after-service';
  const showReview = Boolean(f.reviewUrl) && (reviewOn === 'all' || (reviewOn === 'after-service' && ['report', 'invoice', 'receipt'].includes(opts.kind ?? '')));
  const wa = (f.whatsapp ?? '').replace(/\D/g, '');
  return {
    name: c.name, tagline: c.tagline ?? '', address: (c.address ?? '').replace(/\s*\n\s*/g, ', '),
    phone: c.phone ?? '', email: c.email ?? '', website: c.website ?? '', mapsUrl: url(f.mapsUrl), whatsapp: wa ? `https://wa.me/${wa.length === 10 ? `91${wa}` : wa}` : '',
    reviewUrl: showReview ? url(f.reviewUrl) : '', extra: f.extra ?? '', accreditation: c.accreditation?.certNo ? `${c.accreditation.body || 'NABL'} accredited · ${c.accreditation.certNo}` : '',
    logo: f.showLogo !== false && typeof c.logo === 'string' && c.logo.startsWith('data:image') ? c.logo : null,
  };
}

export function footerText(c: CompanyProfile, opts: { kind?: string } = {}) {
  const p = footerParts(c, opts);
  if (!p) return '';
  return [
    '--', p.name, p.accreditation, p.address,
    [p.phone && `Phone: ${p.phone}`, p.email && `Email: ${p.email}`].filter(Boolean).join(' | '),
    p.website && `Website: ${p.website}`, p.mapsUrl && `Location: ${p.mapsUrl}`, p.whatsapp && `WhatsApp: ${p.whatsapp}`,
    p.reviewUrl && `Happy with our service? Please leave us a Google review: ${p.reviewUrl}`, p.extra,
  ].filter(Boolean).join('\n');
}

/** HTML email (inline styles only, works in Gmail/Outlook). Logo is attached inline as cid:logo. */
export function emailHtml(c: CompanyProfile, body: string, opts: { kind?: string; footer?: boolean } = {}) {
  const accent = (c as any).login?.accent || '#1f3a68';
  const p = opts.footer === false ? null : footerParts(c, opts);
  const paras = body.trim().split(/\n{2,}/).map((x) => `<p style="margin:0 0 12px">${linkify(x).replace(/\n/g, '<br>')}</p>`).join('');
  const link = (href: string, label: string) => `<a href="${esc(href)}" style="color:${accent};text-decoration:none;font-weight:600">${label}</a>`;
  const foot = p ? `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;border-top:3px solid ${accent};padding-top:12px;width:100%;font-size:13px;color:#444;line-height:1.5">
    <tr>
      ${p.logo ? '<td style="width:64px;vertical-align:top;padding:12px 12px 0 0"><img src="cid:logo" alt="" width="56" style="display:block;width:56px;height:auto"></td>' : ''}
      <td style="vertical-align:top;padding-top:10px">
        <div style="font-size:15px;font-weight:700;color:#111">${esc(p.name)}</div>
        ${p.accreditation ? `<div style="color:${accent};font-size:12px;font-weight:600">${esc(p.accreditation)}</div>` : ''}
        ${p.address ? `<div>${esc(p.address)}</div>` : ''}
        <div>${[p.phone && `Phone: <a href="tel:${esc(p.phone.split(/[,/]/)[0].replace(/[^\d+]/g, ''))}" style="color:#444">${esc(p.phone)}</a>`, p.email && `Email: <a href="mailto:${esc(p.email)}" style="color:#444">${esc(p.email)}</a>`].filter(Boolean).join(' &nbsp;|&nbsp; ')}</div>
        <div style="margin-top:6px">${[p.website && link(url(p.website), esc(p.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))), p.mapsUrl && link(p.mapsUrl, 'Find us on Google Maps'), p.whatsapp && link(p.whatsapp, 'WhatsApp us')].filter(Boolean).join(' &nbsp;·&nbsp; ')}</div>
        ${p.reviewUrl ? `<div style="margin-top:10px"><a href="${esc(p.reviewUrl)}" style="display:inline-block;background:${accent};color:#fff;padding:7px 14px;border-radius:6px;text-decoration:none;font-weight:600">★ Rate us on Google</a> <span style="color:#666;font-size:12px">&nbsp;Your feedback helps us improve.</span></div>` : ''}
        ${p.extra ? `<div style="margin-top:6px;color:#666;font-size:12px">${linkify(p.extra)}</div>` : ''}
      </td>
    </tr>
  </table>` : '';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f7fb"><div style="max-width:640px;margin:0 auto;background:#fff;padding:24px 26px;font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222;line-height:1.55">${paras}${foot}</div></body></html>`;
}

/** Inline logo attachment for the HTML footer (cid:logo). */
export function logoAttachment(c: CompanyProfile) {
  const p = footerParts(c);
  if (!p?.logo) return [];
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(p.logo);
  if (!m) return [];
  return [{ filename: 'logo.png', content: Buffer.from(m[2], 'base64'), contentType: m[1], cid: 'logo' }];
}
