import type { CSSProperties, ReactNode } from 'react';
import { amountInWords, fillPlaceholders, formatDate, inr, type Block, type Column, type DocTemplate } from '@suite/shared';
import { LineChart } from './Chart';

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
}

const get = (o: any, path: string) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const nl = (s: string) => s.split('\n').map((line, i, arr) => <span key={i}>{line}{i < arr.length - 1 && <br />}</span>);

export function DocRenderer(p: RenderInput) {
  const t = p.template;
  const isDraft = p.kind === 'quote' ? p.status === 'draft' : !['issued', 'paid', 'partly_paid'].includes(p.status ?? '');
  const ctx = {
    company: { ...p.company, accreditationText: p.company.accreditation?.certNo },
    doc: { ...p.data, number: p.number }, template: { docControl: t.docControl ?? '' },
  };
  const page: CSSProperties = {
    width: t.page.orientation === 'landscape' ? '297mm' : '210mm', minHeight: t.page.orientation === 'landscape' ? '210mm' : '297mm',
    padding: `${t.page.marginMm}mm`, fontFamily: t.page.fontFamily, fontSize: `${t.page.fontSize}pt`, display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
  };
  return (
    <div className="doc-page" style={page}>
      {isDraft && <div className="doc-watermark">DRAFT</div>}
      {t.blocks.filter((b) => b.visible).map((b) => {
        const el = renderBlock(b, p, ctx);
        if (!el) return null;
        return (
          <div key={b.id} className={`doc-block${p.onSelect ? ' selectable' : ''}${p.selected === b.id ? ' selected' : ''}`}
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
    case 'letterhead':
      if (lh) return <div style={{ height: '32mm' }} />;
      return (
        <div style={{ borderBottom: `2px solid ${accent}`, paddingBottom: 6, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {pr.showLogo && c.logo && <img src={c.logo} alt="" style={{ height: 70, objectFit: 'contain' }} />}
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: '22pt', letterSpacing: 0.5, color: '#111' }}>{c.name}</div>
              {c.tagline && <div style={{ fontStyle: 'italic', textAlign: 'right', fontSize: '10pt' }}>{c.tagline}</div>}
            </div>
            {pr.showAccreditation && (c.accreditationLogo || c.accreditation?.certNo) && (
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
      const rateMode = d.mode === 'rate';
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
      return (
        <table className="bx" style={{ marginTop: 4 }}>
          <thead><tr>{cols.map((col) => <th key={col.key} style={{ width: col.width ? `${col.width}%` : undefined, textAlign: 'center', fontWeight: 400 }}>{col.label}</th>)}</tr></thead>
          <tbody>{lines.map((l, i) => <tr key={i}>{cols.map((col) => <td key={col.key} style={{ textAlign: col.align ?? 'left' }}>{cell(col, l, i)}</td>)}</tr>)}</tbody>
        </table>
      );
    }
    case 'totals': {
      const tt = p.totals;
      if (!tt || d.mode === 'rate') return null;
      const rate = tt.taxSummary?.length === 1 ? tt.taxSummary[0].rate : null;
      const rows: [string, number][] = [[pr.subtotal, tt.subtotal]];
      if (tt.discount > 0) rows.push([pr.discount, -tt.discount], ['Taxable value', tt.taxable]);
      if (tt.interState) rows.push([`${pr.igst}${rate !== null ? ` -${rate}%` : ''}`, tt.igst]);
      else rows.push([`${pr.cgst}${rate !== null ? ` -${rate / 2}%` : ''}`, tt.cgst], [`${pr.sgst}${rate !== null ? ` -${rate / 2}%` : ''}`, tt.sgst]);
      if (tt.roundOff) rows.push([pr.roundOff, tt.roundOff]);
      rows.push([pr.total, tt.total]);
      return (
        <table className="bx" style={{ width: '100%', borderTop: 0 }}><tbody>
          {rows.map(([l, v], i) => <tr key={i}><td style={{ border: 0 }} /><td style={{ width: '22%', textAlign: 'center', fontWeight: i === rows.length - 1 ? 700 : 400 }}>{l}</td><td style={{ width: '14%', textAlign: 'right', fontWeight: i === rows.length - 1 ? 700 : 400 }}>{inr(v, Math.abs(v % 1) > 0.001 ? 2 : 0)}</td></tr>)}
        </tbody></table>
      );
    }
    case 'amountWords':
      if (!p.totals || d.mode === 'rate') return null;
      return <div style={{ textAlign: 'center', border: '1px solid #333', borderTop: 0, padding: 4 }}><div>{pr.label}</div><div>( {amountInWords(p.totals.total)} )</div></div>;
    case 'notes': {
      const notes: string[] = Array.isArray(d.notes) ? d.notes : String(d.notes ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
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
    case 'footer':
      if (lh) return <div style={{ height: '18mm' }} />;
      return (
        <div style={{ borderTop: `1px solid ${accent}`, marginTop: 10, paddingTop: 4, textAlign: 'center', fontSize: '9pt', color: accent }}>
          <div>Contact : {c.phone} | Email: {c.email}{c.website ? `, Website: ${c.website}` : ''}</div>
          <div style={{ color: '#222' }}>{c.address}</div>
        </div>
      );
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
      const rows = (d.rows ?? []) as { group?: string; name: string; unit: string; method: string; values: string[] }[];
      const samples = (d.samples ?? []) as { label: string }[];
      const span = (i: number, key: 'group' | 'method') => {
        const v = rows[i][key]; if (!v) return 1;
        if (i > 0 && rows[i - 1][key] === v) return 0;
        let n = 1; while (i + n < rows.length && rows[i + n][key] === v) n++; return n;
      };
      return (
        <table className="bx" style={{ fontSize: '10pt' }}>
          <thead>
            <tr><th rowSpan={3} style={{ width: '7%' }}>{pr.sno}</th><th rowSpan={3} colSpan={2}>{pr.test}</th><th rowSpan={3} style={{ width: '9%' }}>{pr.units}</th><th rowSpan={3}>{pr.method}</th><th colSpan={samples.length}>{pr.sampleHeader}</th></tr>
            <tr>{samples.map((s, i) => <th key={i}>{s.label}</th>)}</tr>
            <tr>{samples.map((_, i) => <th key={i}>{pr.resultsLabel}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const gs = span(i, 'group'), ms = span(i, 'method');
              return (
                <tr key={i}>
                  <td style={{ textAlign: 'center' }}>{i + 1}</td>
                  {r.group ? <>{gs > 0 && <td rowSpan={gs} style={{ textAlign: 'center', width: '20%' }}>{r.group}</td>}<td style={{ textAlign: 'center' }}>{r.name}</td></> : <td colSpan={2}>{r.name}</td>}
                  <td style={{ textAlign: 'center' }}>{r.unit}</td>
                  {ms > 0 && <td rowSpan={ms} style={{ textAlign: 'center' }}>{r.method}</td>}
                  {r.values.map((v, j) => <td key={j} style={{ textAlign: 'center' }}>{v}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      );
    }
    case 'remarks':
      if (!d.remarks) return null;
      return <div style={{ border: '1px solid #333', borderTop: 0, padding: '3px 6px', fontWeight: 700 }}>{pr.label} {d.remarks}</div>;
    case 'charts':
      if (!(d.charts ?? []).length) return null;
      return <div style={{ marginTop: 8 }}>{d.charts.map((ch: any, i: number) => <div key={i} style={{ textAlign: 'center', breakInside: 'avoid' }}><LineChart points={ch.points} title={ch.title} xLabel={ch.xLabel} yLabel={ch.yLabel} /></div>)}</div>;
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

function Signature({ pr, p, fill }: { pr: Record<string, any>; p: RenderInput; fill: (s?: string) => string }) {
  const issued = ['issued', 'paid', 'partly_paid'].includes(p.status ?? '');
  const signer = p.issuer;
  return (
    <div style={{ marginTop: 14, textAlign: pr.align === 'right' ? 'right' : 'left' }}>
      {pr.forText && <div style={{ fontWeight: 700 }}>{fill(pr.forText)}</div>}
      <div style={{ height: 64, display: 'flex', gap: 8, alignItems: 'center', justifyContent: pr.align === 'right' ? 'flex-end' : 'flex-start' }}>
        {issued && pr.showSignature && signer?.signature && <img src={signer.signature} alt="" style={{ maxHeight: 56 }} />}
        {issued && pr.showSeal && p.company.seal && <img src={p.company.seal} alt="" style={{ maxHeight: 64 }} />}
        {!issued && (pr.showSignature || pr.showSeal) && <span className="no-print" style={{ color: '#999', fontSize: '8pt', border: '1px dashed #bbb', padding: '4px 8px' }}>Signature and seal are applied on issue</span>}
      </div>
      {pr.label && <div>{pr.label}</div>}
      {pr.showName && signer && issued && <div>{signer.name}</div>}
      {pr.showQualifications && signer && issued && <div style={{ fontSize: '8.5pt', maxWidth: 360, display: 'inline-block' }}>{signer.designation}{signer.qualifications ? ` ${signer.qualifications}` : ''}</div>}
    </div>
  );
}
