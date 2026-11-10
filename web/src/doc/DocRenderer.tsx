import type { CSSProperties, ReactNode } from 'react';
import { amountInWords, fillPlaceholders, formatDate, inr, type Block, type Column, type DocTemplate, type ReportLayout } from '@suite/shared';
import { layoutBlocks, type LayoutEdit } from './LayoutView';
import qrcode from 'qrcode-generator';
import { LineChart } from './Chart';
import { BoreLog, SiteProfile, SoilLegend } from './BoreLog';

export interface RenderInput {
  template: DocTemplate;
  kind: string;
  data: Record<string, any>;
  company: Record<string, any>;
  number?: string | null;
  status?: string;
  totals?: any;
  issuer?: { name: string; designation?: string; qualifications?: string; signature?: string } | null;
  selected?: string | null;
  onSelect?: (id: string) => void;
  /** Public verification link of an issued report (printed as a QR code beside the signature). */
  verifyUrl?: string | null;
  /** When given, the seal can be dragged anywhere on the page (final stage, before issue). */
  onSealMove?: (pos: { x: number; y: number; w: number }) => void;
  /** Report body editing (word-processor style) – only for drafts. */
  layoutEdit?: LayoutEdit;
  /** Number of printed pages (from the page planner), for "Page 1 of N" in the report details. */
  pages?: number;
}
/** Template blocks whose content the report layout replaces. */
const IN_LAYOUT = (b: Block) => ['reportInfo', 'results', 'remarks', 'charts', 'notes'].includes(b.type) || b.id === 'tableTitle' || b.id === 'end';

const rateOnly = (kind: string, d: any) => kind === 'quote' && !(d.showQty ?? d.mode !== 'rate');

/** Rows of the totals block (subtotal, discount, GST, round-off, total), or null when the document shows rates only. */
function totalsRows(p: RenderInput, pr: Record<string, any>): [string, number][] | null {
  const tt = p.totals, d = p.data;
  if (!tt || rateOnly(p.kind, d)) return null;
  const gstIn = p.kind !== 'quote' || (d.includeGst ?? d.mode !== 'rate');
  const rate = tt.taxSummary?.length === 1 ? tt.taxSummary[0].rate : null;
  const rows: [string, number][] = [[pr.subtotal, tt.subtotal]];
  if (tt.discount > 0) rows.push([`${pr.discount}${tt.discountPct ? ` @ ${tt.discountPct}%` : ''}`, -tt.discount], ['Taxable value', tt.taxable]);
  if (gstIn) {
    if (tt.interState) rows.push([`${pr.igst}${rate !== null ? ` @ ${rate}%` : ''}`, tt.igst]);
    else rows.push([`${pr.cgst}${rate !== null ? ` @ ${rate / 2}%` : ''}`, tt.cgst], [`${pr.sgst}${rate !== null ? ` @ ${rate / 2}%` : ''}`, tt.sgst]);
  }
  if (tt.roundOff) rows.push([pr.roundOff, tt.roundOff]);
  rows.push([gstIn ? pr.total : 'Total (GST extra)', tt.total]);
  return rows;
}
const money = (v: number) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '' : inr(Number(v), Math.abs(Number(v) % 1) > 0.001 ? 2 : 0));
/** The totals block renders inside the items table (aligned under Amount) when both are visible. */
const totalsInline = (p: RenderInput) => {
  const tb = p.template.blocks.find((b) => b.type === 'totals' && b.visible);
  const ib = p.template.blocks.find((b) => b.type === 'items' && b.visible);
  if (!tb || !ib) return null;
  const cols = ((ib.props as any).columns as Column[]).filter((c) => c.visible);
  return cols.some((c) => c.key === 'amount') ? tb : null;
};
/** NABL documents use the NABL letterhead profile, others the standard one (Settings → Letterheads). */
const letterhead = (c: any, d: any) => {
  const key = d.accreditation === 'NABL' ? 'nabl' : d.accreditation === 'Non-NABL' ? 'standard' : null;
  if (!key) return null;
  return c.letterheads?.[key] ?? { mode: 'designed', showAccreditation: key === 'nabl' };
};
/** Distance of uploaded header / footer images from the paper edge (printers need a few mm). */
const edgeMm = (prof: any) => (Number.isFinite(Number(prof?.edgeMm)) ? Math.min(20, Math.max(0, Number(prof.edgeMm))) : 5);
const get = (o: any, path: string) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const nl = (s: string) => s.split('\n').map((line, i, arr) => <span key={i}>{line}{i < arr.length - 1 && <br />}</span>);

export function DocRenderer(p: RenderInput) {
  const t = p.template;
  const isDraft = p.kind === 'quote' ? p.status === 'draft' : !['issued', 'paid', 'partly_paid'].includes(p.status ?? '');
  const ctx = {
    company: { ...p.company, accreditationText: p.company.accreditation?.certNo },
    doc: { ...p.data, number: p.number }, template: { docControl: t.docControl ?? '' },
  };
  // uploaded letterhead images sit a few mm from the paper edge: the page's own top / bottom padding becomes that distance
  const lhProf = t.page.letterheadMode ? null : letterhead(p.company, p.data);
  const imgTop = lhProf?.mode === 'image' && lhProf.headerImage && t.blocks.some((b) => b.type === 'letterhead' && b.visible);
  const imgBottom = lhProf?.mode === 'image' && lhProf.footerImage && t.blocks.some((b) => b.type === 'footer' && b.visible);
  const m = t.page.marginMm, edge = edgeMm(lhProf);
  const page: CSSProperties = {
    width: t.page.orientation === 'landscape' ? '297mm' : '210mm', minHeight: t.page.orientation === 'landscape' ? '210mm' : '297mm',
    padding: `${imgTop ? Math.min(edge, m) : m}mm ${m}mm ${imgBottom ? Math.min(edge, m) : m}mm`, fontFamily: t.page.fontFamily, fontSize: `${t.page.fontSize}pt`, display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
  };
  const layout = p.kind === 'report' && Array.isArray(p.data.layout?.sections) ? (p.data.layout as ReportLayout) : null;
  let layoutDone = false;
  return (
    <div className="doc-page" style={{ ...page, position: 'relative' }} data-ident={p.kind === 'report' && p.number ? `Report No. ${p.number}` : undefined}>
      {isDraft && <div className="doc-watermark">DRAFT</div>}
      {p.data.sealPos && p.company.seal && <FreeSeal p={p} />}
      {t.blocks.filter((b) => b.visible).map((b) => {
        if (layout && IN_LAYOUT(b)) {
          if (layoutDone) return null;
          layoutDone = true;
          const rb = t.blocks.find((x) => x.type === 'results');
          return layoutBlocks(layout.sections, { number: p.number ?? '', issueText: p.data.issueText ?? '', pageOf: `Page 1 of ${p.pages ?? 1}` }, (what) => (what === 'charts' ? (!p.data.hideCharts && (p.data.charts ?? []).length ? <ChartList charts={p.data.charts} /> : null) : <ResultExtras p={p} pr={(rb?.props ?? {}) as Record<string, any>} />), p.layoutEdit);
        }
        const el = renderBlock(b, p, ctx);
        if (!el) return null;
        return (
          <div key={b.id} data-block={b.type} className={`doc-block${p.onSelect ? ' selectable' : ''}${p.selected === b.id ? ' selected' : ''}`}
            style={b.type === 'footer' ? { marginTop: 'auto' } : undefined} onClick={p.onSelect ? (e) => { e.stopPropagation(); p.onSelect!(b.id); } : undefined}>
            {el}
          </div>
        );
      })}
    </div>
  );
}

function renderBlock(b: Block, p: RenderInput, ctx: any): ReactNode {
  const pr = b.props as Record<string, any>;
  const c = p.company, d = p.data, accent = p.template.page.accent;
  const lh = p.template.page.letterheadMode;
  const fill = (s?: string) => fillPlaceholders(s ?? '', ctx);
  const field = (f: string) => (f === 'number' ? p.number ?? '(on issue)' : f === 'dateText' ? d.dateText || formatDate(d.date ?? null) || formatDate(new Date().toLocaleDateString('en-CA')) : get(d, f) ?? '');
  switch (b.type) {
    case 'letterhead': {
      if (lh) return <div style={{ height: '32mm' }} />;
      const prof = letterhead(c, d);
      // uploaded letterhead: placed from the paper edge (not inside the page margin), full printable width
      if (prof?.mode === 'image' && prof.headerImage) { const out = Math.max(0, p.template.page.marginMm - edgeMm(prof)); return <img src={prof.headerImage} alt="" className="doc-lh-img" style={{ width: `calc(100% + ${2 * out}mm)`, margin: `0 -${out}mm 3mm`, display: 'block', maxWidth: 'none' }} />; }
      const showAcc = prof ? prof.showAccreditation !== false && d.accreditation === 'NABL' : pr.showAccreditation;
      return (
        <div style={{ borderBottom: `2px solid ${accent}`, paddingBottom: 6, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {pr.showLogo && (c.logo
              ? <div style={{ textAlign: 'center', flex: 'none' }}><img src={c.logo} alt="" style={{ height: 70, maxWidth: 110, objectFit: 'contain', display: 'block', margin: '0 auto' }} />{c.shortName && <div style={{ fontWeight: 700, fontSize: '9pt', letterSpacing: 1, marginTop: 2 }}>{c.shortName}</div>}</div>
              : <div className="no-print" title="Upload the logo in Settings → Company & branding → Branding" style={{ width: 84, height: 70, flex: 'none', border: '1.5px dashed #b8c2d3', borderRadius: 6, display: 'grid', placeItems: 'center', color: '#8a96a8', fontSize: '8pt', textAlign: 'center', lineHeight: 1.2 }}>Company<br />logo</div>)}
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: '22pt', letterSpacing: 0.5, color: '#111' }}>{c.name}</div>
              {c.tagline && <div style={{ fontStyle: 'italic', textAlign: 'right', fontSize: '10pt' }}>{c.tagline}</div>}
            </div>
            {showAcc && (c.accreditationLogo || c.accreditation?.certNo) && (
              <div style={{ textAlign: 'center', fontSize: '8pt', fontWeight: 700 }}>
                {c.accreditationLogo && <img src={c.accreditationLogo} alt="" style={{ height: 62, display: 'block', margin: '0 auto' }} />}
                {c.accreditation?.certNo}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5pt', color: accent, marginTop: 4 }}>
            <span>{pr.showCIN && c.cin ? `CIN : ${c.cin}` : ''}</span><span>{pr.showGST && c.gstin ? `GST : ${c.gstin}` : ''}</span>
          </div>
        </div>
      );
    }
    case 'title':
      return (
        <div style={{ textAlign: 'center', margin: pr.small ? '4px 0 2px' : '4px 0 8px' }}>
          <div style={{ fontWeight: 700, fontSize: pr.small ? '10.5pt' : '12pt', textDecoration: pr.small ? 'underline' : undefined }}>{fill(pr.text)}</div>
          {pr.subtitle && <div style={{ fontSize: '9pt', textDecoration: pr.small ? 'underline' : undefined }}>{fill(pr.subtitle)}</div>}
        </div>
      );
    case 'party': {
      const rows = (pr.rows as { label: string; field: string; hidden?: boolean }[]).filter((r) => !r.hidden);
      const site = d.site, contact = d.contact;
      const left = (
        <div>
          {pr.toLabel && <div>{pr.toLabel}</div>}
          <div style={{ fontWeight: 700, paddingLeft: pr.toLabel ? 24 : 0 }}>{d.client?.name}</div>
          <div style={{ paddingLeft: pr.toLabel ? 24 : 0, whiteSpace: 'pre-line' }}>{d.client?.address}</div>
          {d.customerRef && p.kind === 'invoice' && <div style={{ marginTop: 6 }}>Customer Reference No: {d.customerRef}</div>}
          {pr.showGstin && d.client?.gstin && <div>GST No: {d.client.gstin}</div>}
        </div>
      );
      const right = (
        <table style={{ width: 'auto' }}><tbody>
          {rows.map((r, i) => { const v = field(r.field); return v ? <tr key={i}><td style={{ paddingRight: 6, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{r.label ? `${r.label}${r.label.endsWith(':') ? '' : ':'}` : ''}</td><td style={{ fontWeight: r.label ? 400 : 700 }}>{String(v)}</td></tr> : null; })}
        </tbody></table>
      );
      const project = site ? (site.project || site.name) : '';
      return (
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, border: pr.boxed ? '1px solid #333' : undefined, padding: pr.boxed ? 6 : 0 }}>
            <div style={{ flex: 1 }}>{left}</div>
            <div style={{ borderLeft: pr.boxed ? '1px solid #333' : undefined, paddingLeft: pr.boxed ? 8 : 0 }}>{right}</div>
          </div>
          {project && pr.projectLabel && <div style={{ fontWeight: 700, marginTop: 6 }}>{pr.projectLabel}: {project}{site?.po ? ` (PO: ${site.po})` : ''}</div>}
          {contact && p.kind === 'invoice' && <div style={{ fontSize: '9pt' }}>Kind attn: {contact.name}</div>}
        </div>
      );
    }
    case 'items': {
      const rateMode = rateOnly(p.kind, d);
      const cols = (pr.columns as Column[]).filter((col) => col.visible && !(rateMode && (col.key === 'amount' || col.key === 'unit')));
      const lines = (p.totals?.lines ?? d.lines ?? []) as any[];
      const cell = (col: Column, l: any, i: number) => {
        switch (col.key) {
          case 'sno': return `${i + 1}.`;
          case 'description': return l.description;
          case 'rate': return inr(Number(l.rate || 0));
          case 'qty': return rateMode ? (l.unit || '') : String(l.qty ?? '').padStart(2, '0');
          case 'unit': return l.unit;
          case 'amount': return inr(Number(l.amount ?? (l.qty ?? 0) * l.rate));
          case 'remarks': return l.remarks || '--';
          default: return l[col.key];
        }
      };
      const tb = totalsInline(p);
      const trows = tb ? totalsRows(p, tb.props as Record<string, any>) : null;
      const ai = cols.findIndex((c) => c.key === 'amount');
      return (
        <table className="bx doc-items" style={{ marginTop: 4 }}>
          <colgroup>{cols.map((col) => <col key={col.key} style={{ width: col.width ? `${col.width}%` : undefined }} />)}</colgroup>
          <thead><tr>{cols.map((col) => <th key={col.key} style={{ textAlign: 'center', fontWeight: 400 }}>{col.label}</th>)}</tr></thead>
          <tbody>{lines.map((l, i) => <tr key={i}>{cols.map((col) => <td key={col.key} style={{ textAlign: col.align ?? (col.key === 'amount' || col.key === 'rate' ? 'right' : 'left') }}>{cell(col, l, i)}</td>)}</tr>)}</tbody>
          {trows && ai > 0 && (
            <tfoot>
              {trows.map(([label, v], i) => {
                const last = i === trows.length - 1;
                return (
                  <tr key={i} className={last ? 'doc-grand-total' : undefined}>
                    <td colSpan={ai} style={{ textAlign: 'right', fontWeight: last ? 700 : 400, whiteSpace: 'nowrap' }}>{label}</td>
                    <td style={{ textAlign: 'right', fontWeight: last ? 700 : 400, whiteSpace: 'nowrap' }}>{money(v)}</td>
                    {ai < cols.length - 1 && <td colSpan={cols.length - 1 - ai} />}
                  </tr>
                );
              })}
            </tfoot>
          )}
        </table>
      );
    }
    case 'totals': {
      if (totalsInline(p)) return null;
      const rows = totalsRows(p, pr);
      if (!rows) return null;
      return (
        <table className="bx" style={{ width: '100%', borderTop: 0 }}><tbody>
          {rows.map(([l, v], i) => <tr key={i}><td style={{ textAlign: 'right', fontWeight: i === rows.length - 1 ? 700 : 400 }}>{l}</td><td style={{ width: '18%', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: i === rows.length - 1 ? 700 : 400 }}>{money(v)}</td></tr>)}
        </tbody></table>
      );
    }
    case 'amountWords':
      if (!p.totals || rateOnly(p.kind, d)) return null;
      return <div style={{ textAlign: 'center', border: '1px solid #333', borderTop: 0, padding: 4 }}><div>{pr.label}</div><div>( {amountInWords(p.totals.total)} )</div></div>;
    case 'notes': {
      // the list numbers the notes itself, so drop numbers typed in the text ("1. …", "2) …")
      const notes: string[] = (Array.isArray(d.notes) ? d.notes : String(d.notes ?? '').split('\n')).map((s: string) => String(s).trim().replace(/^\(?\d{1,2}[.)]\s+/, '')).filter(Boolean);
      if (!notes.length) return null;
      return (
        <div style={{ marginTop: 8, fontSize: p.kind === 'report' ? '8.5pt' : undefined }}>
          <span style={{ fontWeight: p.kind === 'report' ? 400 : 700 }}>{pr.title}</span>
          <ol style={{ margin: '2px 0 0 0', paddingLeft: 28 }}>{notes.map((n, i) => <li key={i}>{n}</li>)}</ol>
        </div>
      );
    }
    case 'text':
      return <div style={{ textAlign: pr.align ?? 'left', fontSize: pr.size ? `${pr.size}pt` : undefined, fontWeight: pr.bold ? 700 : undefined, margin: '4px 0' }}>{nl(fill(pr.text))}</div>;
    case 'signature':
      if (p.kind === 'report') return <ReportSignature pr={pr} p={p} fill={fill} />;
      return <Signature pr={pr} p={p} fill={fill} />;
    case 'bankSignature': {
      const bk = c.bank ?? {};
      return (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginTop: 4 }}>
          <table className="bx" style={{ width: '55%' }}><tbody>
            <tr><td colSpan={2} style={{ textAlign: 'center' }}>{pr.bankTitle}</td></tr>
            {[['Name', bk.name], ['Branch', bk.branch], ['RTGS/NEFT IFSC', bk.ifsc], ['Bank', bk.bank], ['Account No.', bk.account], ...(bk.upi ? [['UPI', bk.upi]] : [])].map(([k, v]) => <tr key={k}><td style={{ width: '40%' }}>{k}</td><td>{v}</td></tr>)}
          </tbody></table>
          <div style={{ flex: 1 }}><Signature pr={{ ...pr, align: 'right' }} p={p} fill={fill} /></div>
        </div>
      );
    }
    case 'footer': {
      if (lh) return <div style={{ height: '18mm' }} />;
      const prof = letterhead(c, d);
      if (prof?.mode === 'image' && prof.footerImage) { const out = Math.max(0, p.template.page.marginMm - edgeMm(prof)); return <img src={prof.footerImage} alt="" className="doc-lh-img" style={{ width: `calc(100% + ${2 * out}mm)`, margin: `3mm -${out}mm 0`, display: 'block', maxWidth: 'none' }} />; }
      return (
        <div style={{ borderTop: `1px solid ${accent}`, marginTop: 10, paddingTop: 4, textAlign: 'center', fontSize: '9pt', color: accent }}>
          <div>Contact : {c.phone} | Email: {c.email}{c.website ? `, Website: ${c.website}` : ''}</div>
          <div style={{ color: '#222' }}>{c.address}</div>
        </div>
      );
    }
    case 'reportInfo': {
      const rows = (pr.rows as { label: string; field: string; hidden?: boolean }[]).filter((r) => !r.hidden);
      return (
        <table className="bx" style={{ marginTop: 2 }}><tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {i === 0 && <td rowSpan={rows.length} style={{ width: '50%', verticalAlign: 'top', padding: 0 }}>
                <div style={{ textAlign: 'center', borderBottom: '1px solid #333', padding: 3 }}>{pr.customerTitle}</div>
                <div style={{ padding: '10px 8px' }}>
                  <div>{d.client?.name}</div><div style={{ whiteSpace: 'pre-line' }}>{d.client?.address}</div>
                  {d.customerRef && <div style={{ marginTop: 10 }}>Customer Reference No: {d.customerRef}</div>}
                  {d.amendment && <div style={{ marginTop: 10, fontWeight: 700 }}>Amendment {d.amendment.revision} of report {d.amendment.of}: {d.amendment.reason}</div>}
                </div>
              </td>}
              <td style={{ width: '22%' }}>{r.label}</td>
              <td style={{ textAlign: 'center' }}>{r.field === 'issueText' ? (d.issueText || '(on issue)') : r.field === 'reportNo' ? (p.number ?? '(on issue)') : String(get(d, r.field) ?? '')}</td>
            </tr>
          ))}
        </tbody></table>
      );
    }
    case 'results': {
      const rows = (d.rows ?? []) as { group?: string; name: string; unit: string; method: string; spec?: string; values: string[] }[];
      const samples = (d.samples ?? []) as { label: string }[];
      const tables = (d.tables ?? []) as { title: string; sample?: string; columns: string[]; rows: string[][] }[];
      const showSpec = pr.showSpec !== false && rows.some((r) => r.spec && r.spec !== '--');
      const grouped = rows.some((r) => r.group);
      const span = (i: number, key: 'group' | 'method') => {
        const v = rows[i][key]; if (!v) return 1;
        if (i > 0 && rows[i - 1][key] === v) return 0;
        let n = 1; while (i + n < rows.length && rows[i + n][key] === v) n++; return n;
      };
      return (
        <>
          <table className="bx doc-results" style={{ fontSize: '10pt' }}>
            <colgroup>
              <col style={{ width: '6%' }} />
              {grouped && <col style={{ width: '15%' }} />}<col />
              <col style={{ width: '8%' }} />
              <col style={{ width: showSpec ? '17%' : '22%' }} />
              {showSpec && <col style={{ width: '15%' }} />}
              {samples.map((_, i) => <col key={i} style={{ width: `${Math.max(8, 16 / Math.max(1, samples.length))}%` }} />)}
            </colgroup>
            <thead>
              <tr><th rowSpan={3}>{pr.sno}</th><th rowSpan={3} colSpan={grouped ? 2 : 1}>{pr.test}</th><th rowSpan={3}>{pr.units}</th><th rowSpan={3}>{pr.method}</th>{showSpec && <th rowSpan={3}>{pr.specLabel || 'Requirement as per IS'}</th>}<th colSpan={samples.length}>{pr.sampleHeader}</th></tr>
              <tr>{samples.map((s, i) => <th key={i}>{s.label}</th>)}</tr>
              <tr>{samples.map((_, i) => <th key={i}>{pr.resultsLabel}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const gs = span(i, 'group'), ms = span(i, 'method');
                return (
                  <tr key={i}>
                    <td style={{ textAlign: 'center' }}>{i + 1}</td>
                    {r.group ? <>{gs > 0 && <td rowSpan={gs} style={{ textAlign: 'center' }}>{r.group}</td>}<td style={{ textAlign: 'center' }}>{r.name}</td></> : <td colSpan={grouped ? 2 : 1}>{r.name}</td>}
                    <td style={{ textAlign: 'center' }}>{r.unit}</td>
                    {ms > 0 && <td rowSpan={ms} style={{ textAlign: 'center' }}>{r.method}</td>}
                    {showSpec && <td style={{ textAlign: 'center' }}>{r.spec || '--'}</td>}
                    {r.values.map((v, j) => <td key={j} style={{ textAlign: 'center' }}>{v || '--'}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ResultExtras p={p} pr={pr} />
        </>
      );
    }
    case 'remarks':
      if (!d.remarks) return null;
      // one element per line, so long remarks can continue on the next page between lines
      return <div style={{ border: '1px solid #333', borderTop: 0, padding: '3px 6px', fontWeight: 700 }}>{String(d.remarks).split('\n').map((line, i) => <div key={i} className="doc-line">{i === 0 ? `${pr.label ?? ''} ${line}` : line}</div>)}</div>;
    case 'charts':
      if (!(d.charts ?? []).length) return null;
      return d.hideCharts || (d.details ?? []).some((x: any) => x.charts?.length) ? null : <ChartList charts={d.charts} />;
    case 'receiptBody':
      return (
        <table className="bx" style={{ marginTop: 10 }}><tbody>
          {[['Receipt No.', p.number], ['Date', formatDate(d.date)], ['Received from', d.client?.name], ['Amount', `₹ ${inr(d.amount, 2)} (${amountInWords(d.amount)})`], ['TDS deducted', d.tds ? `₹ ${inr(d.tds, 2)}` : '--'], ['Mode', d.mode], ['Reference', d.reference], ['Against invoices', d.against]].map(([k, v]) => <tr key={String(k)}><td style={{ width: '30%' }}>{k}</td><td>{v}</td></tr>)}
        </tbody></table>
      );
    case 'statementBody':
      return (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', margin: '6px 0' }}><div><b>{d.client?.name}</b><div style={{ whiteSpace: 'pre-line' }}>{d.client?.address}</div></div><div>As on {formatDate(d.asOn)}</div></div>
          <table className="bx" style={{ fontSize: '9.5pt' }}>
            <thead><tr><th>Date</th><th>Particulars</th><th>Ref</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
            <tbody>
              <tr><td /><td>Opening balance</td><td /><td /><td /><td style={{ textAlign: 'right' }}>{inr(d.opening ?? 0, 2)}</td></tr>
              {(d.entries ?? []).map((e: any, i: number) => <tr key={i}><td>{formatDate(e.date)}</td><td>{e.type}</td><td>{e.ref}</td><td style={{ textAlign: 'right' }}>{e.debit ? inr(e.debit, 2) : ''}</td><td style={{ textAlign: 'right' }}>{e.credit ? inr(e.credit, 2) : ''}</td><td style={{ textAlign: 'right' }}>{inr(e.balance, 2)}</td></tr>)}
              <tr><td colSpan={5} style={{ textAlign: 'right', fontWeight: 700 }}>Balance due</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{inr(d.balance ?? 0, 2)}</td></tr>
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

/** Detailed tables, graphs, scope paragraphs and borehole logs generated by the observation sheets. */
function ResultExtras({ p, pr }: { p: RenderInput; pr: Record<string, any> }) {
  const d = p.data;
  const tables = (d.tables ?? []) as { title: string; sample?: string; columns: string[]; rows: string[][] }[];
  return (
    <>
          {(d.intros ?? []).map((it: any, k: number) => (
            <div key={'i' + k} style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 700, fontSize: '10pt', textTransform: 'uppercase' }}>{it.title} – scope and method</div>
              {it.texts.map((x: any, j: number) => <p key={j} style={{ margin: '3px 0', fontSize: '9.5pt', textAlign: 'justify' }}>{x.title && <b>{x.title}: </b>}{x.text}</p>)}
            </div>
          ))}
          {(() => { let fig = 0; return (d.details ?? []).map((dt: any, k: number) => (
            <div key={'d' + k} style={{ marginTop: 12 }}>
              {/* the heading is the band on top of the first table of the calculation (kept with it across pages) */}
              {dt.info.length === 0 && !(pr.showTables !== false && (dt.tables ?? []).length) && <table className="bx" style={{ fontSize: '9pt' }}><tbody><tr><td style={BAND}>{dt.title}{dt.sample ? ` – ${dt.sample}` : ''}</td></tr></tbody></table>}
              {dt.info.length > 0 && (
                <table className="bx" style={{ fontSize: '9pt', tableLayout: 'fixed', marginBottom: 6 }}>
                  <thead><tr><th colSpan={4} style={BAND}>{dt.title}{dt.sample ? ` – ${dt.sample}` : ''}</th></tr></thead>
                  <tbody>{Array.from({ length: Math.ceil(dt.info.length / 2) }, (_, r) => (
                    <tr key={r}>{[0, 1].map((c) => { const it = dt.info[r * 2 + c]; return it ? [<td key={c + 'l'} style={{ width: '22%', background: '#f6f7f9' }}>{it[0]}</td>, <td key={c + 'v'} style={{ width: '28%' }}>{it[1]}</td>] : <td key={c} colSpan={2} />; })}</tr>
                  ))}</tbody>
                </table>
              )}
              {pr.showTables !== false && (dt.tables ?? []).map((tb: any, j: number) => <DetailTable key={j} tb={tb} band={j === 0 && dt.info.length === 0 ? `${dt.title}${dt.sample ? ` – ${dt.sample}` : ''}` : undefined} />)}
              {!d.hideCharts && (dt.charts ?? []).map((ch: any, j: number) => { fig++; return <div key={'c' + j} style={{ textAlign: 'center', breakInside: 'avoid', margin: '8px 0' }}><LineChart points={ch.points} series={ch.series} xLog={ch.xLog} yLog={ch.yLog} yReverse={ch.yReverse} xTop={ch.xTop} xMin={ch.xMin} xMax={ch.xMax} yMin={ch.yMin} yMax={ch.yMax} fit={ch.fit} title={`Fig. ${fig}: ${ch.title}`} xLabel={ch.xLabel} yLabel={ch.yLabel} note={ch.note} width={620} height={380} /></div>; })}
              {dt.texts.map((x: any, j: number) => <p key={j} style={{ margin: '3px 0', fontSize: '9.5pt', textAlign: 'justify' }}>{x.title && <b>{x.title}: </b>}{x.text}</p>)}
            </div>
          )); })()}
          {pr.showTables !== false && tables.map((tb, k) => <DetailTable key={k} tb={tb} />)}
          {(d.borelogs ?? []).map((bl: any, k: number) => (
            <div key={'b' + k} style={{ marginTop: 12, breakBefore: k === 0 ? 'auto' : 'page', breakInside: 'avoid' }}>
              <div style={{ textAlign: 'center', fontWeight: 700, fontSize: '10.5pt', textDecoration: 'underline', marginBottom: 4 }}>Log of borehole {bl.title}</div>
              <BoreLog data={bl} />
              <SoilLegend soils={bl.strata.map((x: any) => x.soil)} />
            </div>
          ))}
          {(d.borelogs ?? []).length > 1 && (
            <div style={{ marginTop: 12, breakInside: 'avoid' }}>
              <div style={{ textAlign: 'center', fontWeight: 700, fontSize: '10.5pt', textDecoration: 'underline', marginBottom: 4 }}>Geotechnical profile of the site</div>
              <SiteProfile logs={d.borelogs} />
            </div>
          )}
          {!(d.details ?? []).some((x: any) => x.charts?.length) && !p.template.blocks.some((x) => x.type === 'charts' && x.visible) && !d.hideCharts && (d.charts ?? []).length > 0 && <ChartList charts={d.charts} />}
    </>
  );
}

/** Report house style (same as the generated report sections): section band, sub-band and shaded column headings. */
const BAND: CSSProperties = { background: '#E3E8EF', fontWeight: 700, letterSpacing: '0.6pt', textAlign: 'left', textTransform: 'uppercase', fontSize: '10pt' };
const SUBBAND: CSSProperties = { background: '#EEF1F5', fontWeight: 700, letterSpacing: '0.4pt', textAlign: 'left' };
const HEADCELL: CSSProperties = { background: '#F4F6F9', fontWeight: 700 };

function DetailTable({ tb, band }: { tb: { title: string; sample?: string; columns: string[]; rows: string[][] }; band?: string }) {
  const n = tb.columns.length + 1;
  return (
    <div style={{ marginTop: band ? 0 : 6, breakInside: 'avoid' }}>
      <table className="bx" style={{ fontSize: '9pt' }}>
        <thead>
          {band && <tr><th colSpan={n} style={BAND}>{band}</th></tr>}
          <tr><th colSpan={n} style={SUBBAND}>{tb.title}{tb.sample ? ` – ${tb.sample}` : ''}</th></tr>
          <tr><th style={{ width: '6%', ...HEADCELL }}>S.No</th>{tb.columns.map((c, i) => <th key={i} style={HEADCELL}>{c}</th>)}</tr>
        </thead>
        <tbody>{tb.rows.map((r, i) => <tr key={i}><td style={{ textAlign: 'center' }}>{i + 1}</td>{r.map((v, j) => <td key={j} style={{ textAlign: j === 0 ? 'left' : 'center' }}>{v || '--'}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function ChartList({ charts }: { charts: any[] }) {
  return (
    <div style={{ marginTop: 10 }}>
      {charts.map((ch: any, i: number) => (
        <div key={i} style={{ textAlign: 'center', breakInside: 'avoid', marginBottom: 12 }}>
          <LineChart points={ch.points} series={ch.series} xLog={ch.xLog} yLog={ch.yLog} yReverse={ch.yReverse} xTop={ch.xTop} xMin={ch.xMin} xMax={ch.xMax} yMin={ch.yMin} yMax={ch.yMax} fit={ch.fit}
            title={`Fig. ${i + 1}: ${ch.title}`} xLabel={ch.xLabel} yLabel={ch.yLabel} note={ch.note} width={620} height={380} />
        </div>
      ))}
    </div>
  );
}

function VerifyQr({ url }: { url: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(url); qr.make();
  return (
    <div style={{ textAlign: 'center', fontSize: '7.5pt', lineHeight: 1.2 }}>
      <div style={{ width: 84, height: 84, margin: '0 auto' }} dangerouslySetInnerHTML={{ __html: qr.createSvgTag({ cellSize: 2, margin: 0, scalable: true }) }} />
      <div style={{ marginTop: 2 }}>Scan to verify</div>
    </div>
  );
}

function Signature({ pr, p, fill }: { pr: Record<string, any>; p: RenderInput; fill: (s?: string) => string }) {
  const issued = ['issued', 'paid', 'partly_paid'].includes(p.status ?? '');
  const signer = p.issuer;
  return (
    <div style={{ marginTop: 14, textAlign: pr.align === 'right' ? 'right' : 'left' }}>
      {pr.forText && <div style={{ fontWeight: 700 }}>{fill(pr.forText)}</div>}
      <div style={{ height: 64, display: 'flex', gap: 8, alignItems: 'center', justifyContent: pr.align === 'right' ? 'flex-end' : 'flex-start' }}>
        {issued && pr.showSignature && signer?.signature && <img src={signer.signature} alt="" style={{ maxHeight: 56 }} />}
        {issued && pr.showSeal && p.company.seal && !p.data.sealPos && <img src={p.company.seal} alt="" style={{ maxHeight: 64 }} />}
        {!issued && (pr.showSignature || pr.showSeal) && <span className="no-print" style={{ color: '#999', fontSize: '8pt', border: '1px dashed #bbb', padding: '4px 8px' }}>Signature and seal are applied on issue</span>}
      </div>
      {pr.label && <div>{pr.label}</div>}
      {pr.showName && signer && (issued || (signer as any).preview) && <div>{signer.name}</div>}
      {pr.showQualifications && signer && (issued || (signer as any).preview) && <div style={{ fontSize: '8.5pt', maxWidth: 360, display: 'inline-block' }}>{signer.designation}{signer.qualifications ? ` ${signer.qualifications}` : ''}</div>}
    </div>
  );
}

/**
 * Test report sign-off, in the same ruled style as the report body: one box with the authorised signatory
 * (signature, name, designation) on the left, the laboratory seal beside the signature, and the verification
 * QR code on the right once issued. Before issue, dashed placeholders show where the signature and seal go.
 */
function ReportSignature({ pr, p, fill }: { pr: Record<string, any>; p: RenderInput; fill: (s?: string) => string }) {
  const issued = ['issued', 'paid', 'partly_paid'].includes(p.status ?? '');
  const signer = p.issuer;
  const showSigner = signer && (issued || (signer as any).preview);
  const label = /^authori[sz]ed signatory$/i.test(String(pr.label ?? '').trim()) || !pr.label ? 'Authorised Signatory' : pr.label;
  const seal = pr.showSeal && !p.data.sealPos && (!issued || !!p.company.seal); // a seal dragged elsewhere on the page is drawn there instead
  const qr = p.verifyUrl && pr.showQr !== false;
  const ph: CSSProperties = { border: '1px dashed #b8c2d3', color: '#8a96a8', fontSize: '7.5pt', display: 'grid', placeItems: 'center', textAlign: 'center', lineHeight: 1.2 };
  return (
    <div className="rpt-sign" style={{ marginTop: '4mm', border: '1px solid #333', display: 'flex', alignItems: 'stretch', fontSize: '10pt', lineHeight: 1.3 }}>
      <div style={{ flex: 1, padding: '5px 8px', display: 'flex', flexDirection: 'column' }}>
        {pr.forText && <div style={{ fontSize: '9pt', color: '#444' }}>{fill(pr.forText)}</div>}
        <div style={{ height: '17mm', display: 'flex', alignItems: 'center' }}>
          {issued && pr.showSignature && signer?.signature && <img src={signer.signature} alt="" style={{ maxHeight: '15mm', maxWidth: '60mm' }} />}
          {!issued && pr.showSignature && <span className="no-print" style={{ ...ph, width: '42mm', height: '12mm' }}>Signature – applied on issue</span>}
        </div>
        {pr.showName && showSigner ? <div style={{ fontWeight: 700 }}>{signer!.name}</div> : null}
        <div>{label}{pr.showQualifications && showSigner && signer!.designation ? <span style={{ color: '#444' }}> · {signer!.designation}</span> : null}</div>
        {pr.showQualifications && showSigner && signer!.qualifications ? <div style={{ fontSize: '8.5pt', color: '#444' }}>{signer!.qualifications}</div> : null}
      </div>
      {seal && (
        <div style={{ width: '36mm', padding: '4px', display: 'grid', placeItems: 'center' }}>
          {issued && p.company.seal && <img src={p.company.seal} alt="" style={{ maxHeight: '26mm', maxWidth: '32mm' }} />}
          {!issued && <span className="no-print" style={{ ...ph, width: '24mm', height: '24mm', borderRadius: '50%' }}>{p.company.seal ? 'Seal – applied on issue' : 'Laboratory seal'}</span>}
        </div>
      )}
      {qr && <div style={{ width: '26mm', padding: '4px', display: 'grid', placeItems: 'center' }}><VerifyQr url={p.verifyUrl!} /></div>}
    </div>
  );
}

/** Seal placed freely on the page. Solid once issued; a dashed, draggable preview before that. */
function FreeSeal({ p }: { p: RenderInput }) {
  const pos = p.data.sealPos as { x: number; y: number; w: number };
  const issued = ['issued', 'paid', 'partly_paid', 'cancelled'].includes(p.status ?? '');
  const style: CSSProperties = { position: 'absolute', left: `${pos.x}mm`, top: `${pos.y}mm`, width: `${pos.w}mm`, zIndex: 5, userSelect: 'none', touchAction: 'none' };
  if (issued) return <img src={p.company.seal} alt="" style={style} draggable={false} />;
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!p.onSealMove) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget; const pageEl = el.parentElement as HTMLElement;
    const rect = pageEl.getBoundingClientRect();
    const mmPerPx = (p.template.page.orientation === 'landscape' ? 297 : 210) / rect.width;
    const sx = e.clientX, sy = e.clientY, ox = pos.x, oy = pos.y;
    let last = pos;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const x = Math.max(0, Math.min((rect.width * mmPerPx) - pos.w, ox + (ev.clientX - sx) * mmPerPx));
      const y = Math.max(0, Math.min((rect.height * mmPerPx) - pos.w, oy + (ev.clientY - sy) * mmPerPx));
      last = { ...pos, x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2 };
      el.style.left = `${last.x}mm`; el.style.top = `${last.y}mm`;
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); p.onSealMove!(last); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  return (
    <div className="no-print free-seal" style={{ ...style, cursor: p.onSealMove ? 'grab' : 'default', outline: '1.5px dashed #3b82f6', borderRadius: 4, opacity: 0.75 }} onPointerDown={start} onClick={(e) => e.stopPropagation()}
      title={p.onSealMove ? 'Drag the seal to where it should be stamped' : 'Seal position (applied on issue)'}>
      <img src={p.company.seal} alt="" style={{ width: '100%', display: 'block', pointerEvents: 'none' }} draggable={false} />
      {p.onSealMove && <div style={{ position: 'absolute', top: -18, left: 0, fontSize: 10, background: '#3b82f6', color: '#fff', padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap' }}>Drag seal</div>}
    </div>
  );
}
