import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { cleanHtml, fillTokens, resizeCol, unfillTokens, type Cell, type Section, type TableSection, type TextSection } from '@suite/shared';

/** Selection inside the report layout: a section, optionally a cell or a block of cells (r..r2 × c..c2). */
export interface LayoutSel { sid: string; r?: number; c?: number; r2?: number; c2?: number }
export interface LayoutEdit {
  sel: LayoutSel | null;
  setSel: (s: LayoutSel | null) => void;
  /** Replace one section (already cleaned / normalised by the caller where needed). */
  update: (sid: string, fn: (s: Section) => Section) => void;
}

const BORDER = '1px solid #333';
export const inSel = (sel: LayoutSel | null, sid: string, r: number, c: number) => {
  if (!sel || sel.sid !== sid || sel.r === undefined || sel.c === undefined) return false;
  const r2 = sel.r2 ?? sel.r, c2 = sel.c2 ?? sel.c;
  return r >= Math.min(sel.r, r2) && r <= Math.max(sel.r, r2) && c >= Math.min(sel.c, c2) && c <= Math.max(sel.c, c2);
};

/** contentEditable that does not lose the caret when the parent re-renders. */
export function RichText({ html, onChange, editable, style, className, onFocus }: { html: string; onChange?: (h: string) => void; editable: boolean; style?: CSSProperties; className?: string; onFocus?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  /** The value this editor last reported: when it comes back as the new html, the DOM (and caret) are kept. */
  const emitted = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const own = emitted.current !== null && unfillTokens(cleanHtml(html)) === emitted.current;
    if (document.activeElement === el && own) return; // typing: keep the DOM as it is
    if (el.innerHTML !== html) el.innerHTML = html; // changed from outside (merge, undo, rebuild…)
    emitted.current = unfillTokens(cleanHtml(html));
  }, [html]);
  if (!editable) return <div className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
  const emit = () => { const el = ref.current; if (!el || !onChange) return; const v = unfillTokens(cleanHtml(el.innerHTML)); if (v === emitted.current) return; emitted.current = v; onChange(v); };
  return (
    <div ref={ref} className={`lay-edit ${className ?? ''}`} style={style} contentEditable suppressContentEditableWarning spellCheck
      onInput={emit} onBlur={emit} onFocus={onFocus}
      onPaste={(e) => { // paste as simple formatted text
        e.preventDefault();
        const h = e.clipboardData.getData('text/html');
        const t = e.clipboardData.getData('text/plain');
        document.execCommand('insertHTML', false, h ? cleanHtml(h.replace(/<\/(p|div|tr|li)>/gi, '<br>').replace(/<(td|th)[^>]*>/gi, ' ')) : t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'));
      }} />
  );
}

const cellStyle = (t: TableSection, c: Cell, i: number, j: number, rows: number, cols: number): CSSProperties => {
  const b = t.border ?? 'all';
  const st: CSSProperties = { textAlign: c.al ?? 'center', verticalAlign: c.va ?? 'middle', padding: t.pad !== undefined ? `${t.pad}px ${Math.max(t.pad, 2) + 2}px` : '2px 5px', fontWeight: c.b ? 700 : undefined, fontSize: c.sz ? `${c.sz}pt` : undefined, background: c.bg, overflowWrap: 'break-word' };
  if (b === 'all') st.border = BORDER;
  else if (b === 'outer') { if (i === 0) st.borderTop = BORDER; if (i + (c.rs ?? 1) >= rows) st.borderBottom = BORDER; if (j === 0) st.borderLeft = BORDER; if (j + (c.cs ?? 1) >= cols) st.borderRight = BORDER; }
  else if (b === 'inner') { if (i > 0) st.borderTop = BORDER; if (j > 0) st.borderLeft = BORDER; }
  return st;
};

function TableView({ t, tok, edit }: { t: TableSection; tok: Record<string, string>; edit?: LayoutEdit }) {
  const editing = !!edit;
  const wrap = useRef<HTMLDivElement>(null);
  const R = t.rows.length, N = t.cols.length;
  const head = Math.min(t.head ?? 0, R);
  const selected = edit?.sel?.sid === t.id;
  const row = (i: number) => (
    <tr key={i} style={t.rh?.[i] ? { height: `${t.rh[i]}mm` } : undefined}>
      {t.rows[i].map((c, j) => {
        if (c.m) return null;
        const Tag = i < head ? 'th' : 'td';
        const html = fillTokens(c.h, tok, editing);
        const style = { ...cellStyle(t, c, i, j, R, N), fontWeight: c.b ? 700 : Tag === 'th' ? 400 : undefined };
        const on = editing && inSel(edit!.sel, t.id, i, j);
        return (
          <Tag key={j} rowSpan={c.rs} colSpan={c.cs} style={style} className={on ? 'lay-cell-sel' : undefined}
            onMouseDown={editing ? (e) => {
              if (e.shiftKey && edit!.sel?.sid === t.id && edit!.sel.r !== undefined) { e.preventDefault(); edit!.setSel({ ...edit!.sel, r2: i + (c.rs ?? 1) - 1, c2: j + (c.cs ?? 1) - 1 }); }
              else if (!on || (edit!.sel?.r2 !== undefined && (edit!.sel.r2 !== edit!.sel.r || edit!.sel.c2 !== edit!.sel.c))) edit!.setSel({ sid: t.id, r: i, c: j });
            } : undefined}>
            {editing ? <RichText editable html={html} onChange={(h) => edit!.update(t.id, (s) => {
              const x = s as TableSection; if (x.rows[i]?.[j]?.h === h) return s;
              return { ...x, rows: x.rows.map((r, a) => (a === i ? r.map((cc, b) => (b === j ? { ...cc, h } : cc)) : r)) };
            })} /> : <span dangerouslySetInnerHTML={{ __html: html }} />}
          </Tag>
        );
      })}
    </tr>
  );
  const width = t.width ?? 100;
  const margin = t.align === 'left' ? '0 auto 0 0' : t.align === 'right' ? '0 0 0 auto' : '0 auto';
  // column resize handles (edit mode, selected table)
  const handles: ReactNode[] = [];
  if (editing && selected) {
    let acc = 0;
    for (let j = 0; j < N - 1; j++) {
      acc += t.cols[j];
      const col = j;
      handles.push(<div key={j} className="lay-col-handle no-print" style={{ left: `${acc}%` }} title="Drag to change the column width"
        onPointerDown={(e) => {
          e.preventDefault(); e.stopPropagation();
          const w = wrap.current?.getBoundingClientRect().width ?? 1;
          const x0 = e.clientX; const start = t;
          const el = e.currentTarget; el.setPointerCapture(e.pointerId);
          const move = (ev: PointerEvent) => { const d = ((ev.clientX - x0) / w) * 100; edit!.update(t.id, () => resizeCol(start, col, Math.round(d * 10) / 10)); };
          const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
          el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
        }} />);
    }
  }
  return (
    <div ref={wrap} style={{ position: 'relative', width: `${width}%`, margin }}>
      <table className="lay-table" style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: t.sz ? `${t.sz}pt` : undefined }}>
        <colgroup>{t.cols.map((w, j) => <col key={j} style={{ width: `${w}%` }} />)}</colgroup>
        {head > 0 && <thead>{Array.from({ length: head }, (_, i) => row(i))}</thead>}
        <tbody>{Array.from({ length: R - head }, (_, k) => row(head + k))}</tbody>
      </table>
      {handles}
    </div>
  );
}

function TextView({ s, tok, edit }: { s: TextSection; tok: Record<string, string>; edit?: LayoutEdit }) {
  const style: CSSProperties = {
    textAlign: s.al ?? 'left', fontSize: s.sz ? `${s.sz}pt` : undefined, lineHeight: s.lh ?? undefined, paddingLeft: s.indent ? `${s.indent}mm` : undefined,
    ...(s.box ? { border: BORDER, padding: '4px 6px', width: s.width ? `${s.width}%` : undefined } : {}),
    minHeight: edit ? '1.3em' : undefined,
  };
  const html = fillTokens(s.h, tok, !!edit);
  if (!edit) return <div style={style} dangerouslySetInnerHTML={{ __html: html }} />;
  return <RichText editable html={html} style={style} onFocus={() => edit.setSel({ sid: s.id })} onChange={(h) => edit.update(s.id, (x) => ((x as TextSection).h === h ? x : { ...x, h } as TextSection))} />;
}

/** The report body drawn from its layout. Each section is a top-level block, so page planning can break between them. */
export function layoutBlocks(sections: Section[], tok: Record<string, string>, details: (what: 'details' | 'charts') => ReactNode, edit?: LayoutEdit): ReactNode[] {
  return sections.map((s) => {
    const type = s.type === 'table' ? 'ltable' : s.type === 'auto' ? 'results' : (s as TextSection).heading ? 'title' : 'ltext';
    const sel = edit?.sel?.sid === s.id;
    const mt = 'mt' in s && s.mt !== undefined ? `${s.mt}mm` : s.type === 'table' ? '1mm' : '0.5mm';
    const mb = s.type === 'text' && s.mb !== undefined ? `${s.mb}mm` : undefined;
    return (
      <div key={s.id} data-block={type} data-sid={s.id} className={`doc-block lay-sec${edit ? ' lay-editing' : ''}${sel ? ' lay-sel' : ''}`} style={{ marginTop: mt, marginBottom: mb }}
        onMouseDown={edit ? () => { if (edit.sel?.sid !== s.id) edit.setSel({ sid: s.id }); } : undefined} onClick={edit ? (e) => e.stopPropagation() : undefined}>
        {s.type === 'table' ? <TableView t={s} tok={tok} edit={edit} /> : s.type === 'text' ? <TextView s={s} tok={tok} edit={edit} /> : details(s.what)}
      </div>
    );
  });
}

/** Keep the selection valid when sections or rows disappear. */
export function useValidSel(sections: Section[] | undefined, sel: LayoutSel | null, setSel: (s: LayoutSel | null) => void) {
  useEffect(() => {
    if (!sel) return;
    const s = sections?.find((x) => x.id === sel.sid);
    if (!s) setSel(null);
    else if (s.type === 'table' && sel.r !== undefined && (sel.r >= s.rows.length || (sel.c ?? 0) >= s.cols.length)) setSel({ sid: sel.sid });
  }, [sections, sel]);
}
