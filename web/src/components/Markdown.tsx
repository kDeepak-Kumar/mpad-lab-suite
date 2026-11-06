import { Fragment, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Small, safe markdown renderer (no HTML is ever injected): paragraphs, **bold**, *italic*, `code`, links,
 * bullet / numbered lists and pipe tables. Links inside the app open without reloading the page.
 */
export function Markdown({ text, onLink }: { text: string; onLink?: () => void }) {
  const nav = useNavigate();
  const inline = (s: string, key: string): ReactNode[] => {
    const out: ReactNode[] = [];
    const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
    let last = 0; let m: RegExpExecArray | null; let i = 0;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(s.slice(last, m.index));
      const k = `${key}-${i++}`;
      if (m[2]) out.push(<b key={k}>{inline(m[2], k)}</b>);
      else if (m[3]) out.push(<i key={k}>{m[3]}</i>);
      else if (m[4]) out.push(<code key={k} className="md-code">{m[4]}</code>);
      else if (m[5]) {
        const url = m[6];
        if (url.startsWith('/')) out.push(<a key={k} href={url} className="md-link" onClick={(e) => { e.preventDefault(); nav(url); onLink?.(); }}>{m[5]}</a>);
        else if (/^https:\/\//.test(url)) out.push(<a key={k} href={url} target="_blank" rel="noreferrer noopener" className="md-link">{m[5]}</a>);
        else out.push(m[5]);
      }
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  };
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^\s*\|/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())); i++; }
      const body = rows.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c) || c === ''));
      const [head, ...rest] = rows.length > 1 && rows[1].every((c) => /^:?-{2,}:?$/.test(c)) ? [body[0], ...body.slice(1)] : [null, ...body];
      blocks.push(
        <div key={`t${i}`} className="md-table-wrap"><table className="md-table">
          {head && <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `h${i}${j}`)}</th>)}</tr></thead>}
          <tbody>{rest.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j} style={{ textAlign: /^[₹\d,.\-%\s]+$/.test(c) && c ? 'right' : undefined }}>{inline(c, `c${i}${ri}${j}`)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d+[.)]/.test(l); const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '')); i++; }
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(<Tag key={`l${i}`} className="md-list">{items.map((it, j) => <li key={j}>{inline(it, `li${i}${j}`)}</li>)}</Tag>);
      continue;
    }
    if (/^#{1,4}\s/.test(l)) { blocks.push(<p key={`h${i}`} className="md-h">{inline(l.replace(/^#+\s/, ''), `hh${i}`)}</p>); i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(\||[-*•]\s|\d+[.)]\s|#{1,4}\s)/.test(lines[i])) { para.push(lines[i]); i++; }
    blocks.push(<p key={`p${i}`} className="md-p">{para.map((p, j) => <Fragment key={j}>{j ? <br /> : null}{inline(p, `p${i}${j}`)}</Fragment>)}</p>);
  }
  return <div className="md">{blocks}</div>;
}
