import { useState } from 'react';
import { ActionIcon, Button, Group, Menu, NumberInput, Popover, Select, Stack, Text, Tooltip } from '@mantine/core';
import {
  IconAlignCenter, IconAlignJustified, IconAlignLeft, IconAlignRight, IconArrowBackUp, IconArrowForwardUp, IconArrowDown, IconArrowUp, IconBold, IconClearFormatting, IconColumnInsertLeft,
  IconColumnInsertRight, IconColumnRemove, IconCopy, IconItalic, IconLayoutAlignBottom, IconLayoutAlignMiddle, IconLayoutAlignTop, IconPlus, IconRowInsertBottom, IconRowInsertTop, IconRowRemove,
  IconSubscript, IconSuperscript, IconTableOptions, IconTrash, IconUnderline, IconArrowsJoin2, IconArrowsSplit2, IconTable, IconTextSize, IconBorderAll, IconBorderOuter, IconBorderNone, IconBorderInner,
} from '@tabler/icons-react';
import { anchorOf, deleteCol, deleteRow, insertCol, insertRow, mergeCells, newId, normalise, splitCell, table, text, type Align, type Cell, type Section, type TableSection, type TextSection } from '@suite/shared';
import type { LayoutSel } from './LayoutView';

/** Keep the caret / text selection when a toolbar button is pressed. */
const keep = (e: React.MouseEvent) => e.preventDefault();
const exec = (cmd: string, v?: string) => document.execCommand(cmd, false, v);
/** Apply a point size to the selected text (execCommand only knows sizes 1–7). */
function fontSize(pt: number) {
  exec('fontSize', '7');
  document.querySelectorAll('.lay-edit font[size="7"]').forEach((f) => {
    const s = document.createElement('span'); s.style.fontSize = `${pt}pt`; s.innerHTML = (f as HTMLElement).innerHTML; f.replaceWith(s);
  });
  (document.activeElement as HTMLElement | null)?.dispatchEvent(new Event('input', { bubbles: true }));
}
const hasTextSelection = () => { const s = window.getSelection(); return !!s && !s.isCollapsed && !!(s.anchorNode && (s.anchorNode as HTMLElement).parentElement?.closest('.lay-edit')); };

function Btn({ label, icon, onClick, disabled, active }: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <Tooltip label={label} openDelay={300} withinPortal>
      <ActionIcon variant={active ? 'light' : 'subtle'} color="gray" size="md" onMouseDown={keep} onClick={onClick} disabled={disabled} aria-label={label}>{icon}</ActionIcon>
    </Tooltip>
  );
}

export function LayoutToolbar({ sections, sel, setSel, onChange, undo, redo, canUndo, canRedo, onRebuild }: {
  sections: Section[]; sel: LayoutSel | null; setSel: (s: LayoutSel | null) => void; onChange: (s: Section[]) => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean; onRebuild: () => void;
}) {
  const sec = sel ? sections.find((s) => s.id === sel.sid) : undefined;
  const idx = sec ? sections.indexOf(sec) : -1;
  const tbl = sec?.type === 'table' ? sec : null;
  const txt = sec?.type === 'text' ? sec : null;
  const cellSel = tbl && sel?.r !== undefined && sel.c !== undefined;
  const [rows, setRows] = useState<number>(3), [cols, setCols] = useState<number>(3);

  const put = (s: Section) => onChange(sections.map((x) => (x.id === s.id ? s : x)));
  const rect = () => { const r1 = sel!.r!, c1 = sel!.c!, r2 = sel!.r2 ?? r1, c2 = sel!.c2 ?? c1; return [Math.min(r1, r2), Math.min(c1, c2), Math.max(r1, r2), Math.max(c1, c2)]; };
  /** Change every selected cell (anchors only). */
  const cells = (fn: (c: Cell) => Cell) => {
    if (!tbl || !cellSel) return;
    const [a, b, c, d] = rect();
    put({ ...tbl, rows: tbl.rows.map((r, i) => r.map((x, j) => (i >= a && i <= c && j >= b && j <= d && !x.m ? fn(x) : x))) });
  };
  const insertAt = (s: Section) => {
    const at = idx >= 0 ? idx + 1 : Math.max(0, sections.findIndex((x) => x.type !== 'auto' && ['notes', 'end'].includes((x as TextSection).role ?? '')));
    const next = [...sections]; next.splice(at < 0 ? next.length : at, 0, s); onChange(next); setSel({ sid: s.id, ...(s.type === 'table' ? { r: 0, c: 0 } : {}) });
  };
  const align = (al: Align) => {
    if (txt) put({ ...txt, al });
    else if (cellSel) cells((c) => ({ ...c, al }));
    else if (tbl) put({ ...tbl, align: al === 'justify' ? 'center' : al as TableSection['align'] });
  };
  const curAlign = txt?.al ?? (cellSel ? tbl!.rows[sel!.r!][sel!.c!].al : undefined);
  const curSize = txt?.sz ?? (cellSel ? tbl!.rows[sel!.r!][sel!.c!].sz ?? tbl!.sz : tbl?.sz);
  const setSize = (pt: number) => {
    if (hasTextSelection()) return fontSize(pt);
    if (txt) put({ ...txt, sz: pt }); else if (cellSel) cells((c) => ({ ...c, sz: pt })); else if (tbl) put({ ...tbl, sz: pt });
  };
  const move = (d: number) => { if (idx < 0) return; const j = idx + d; if (j < 0 || j >= sections.length) return; const next = [...sections]; [next[idx], next[j]] = [next[j], next[idx]]; onChange(next); };
  const dup = () => { if (!sec) return; const c = { ...JSON.parse(JSON.stringify(sec)), id: newId(sec.type === 'table' ? 't' : 'p') }; const next = [...sections]; next.splice(idx + 1, 0, c); onChange(next); setSel({ sid: c.id }); };
  const del = () => { if (!sec) return; if (sec.type === 'auto' && !window.confirm('Remove the graphs and detailed calculations from this report?')) return; onChange(sections.filter((x) => x.id !== sec.id)); setSel(null); };
  const tOp = (fn: (t: TableSection) => TableSection, nextSel?: Partial<LayoutSel>) => { if (!tbl) return; put(fn(tbl)); if (nextSel) setSel({ sid: tbl.id, ...nextSel }); };
  const r0 = sel?.r ?? 0, c0 = sel?.c ?? 0;
  const anchor = cellSel ? tbl!.rows[anchorOf(tbl!, r0, c0)[0]][anchorOf(tbl!, r0, c0)[1]] : null;
  const merged = !!anchor && ((anchor.rs ?? 1) > 1 || (anchor.cs ?? 1) > 1);
  const multi = cellSel && (sel!.r2 !== undefined && (sel!.r2 !== sel!.r || sel!.c2 !== sel!.c));

  return (
    <div className="lay-toolbar no-print" onMouseDown={(e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); }}>
      <Btn label="Undo (Ctrl+Z)" icon={<IconArrowBackUp size={17} />} onClick={undo} disabled={!canUndo} />
      <Btn label="Redo (Ctrl+Y)" icon={<IconArrowForwardUp size={17} />} onClick={redo} disabled={!canRedo} />
      <span className="sep" />
      <Btn label="Bold (selected text)" icon={<IconBold size={17} />} onClick={() => (hasTextSelection() ? exec('bold') : cells((c) => ({ ...c, b: !c.b })))} />
      <Btn label="Italic" icon={<IconItalic size={17} />} onClick={() => exec('italic')} />
      <Btn label="Underline" icon={<IconUnderline size={17} />} onClick={() => exec('underline')} />
      <Btn label="Superscript (e.g. mm²)" icon={<IconSuperscript size={17} />} onClick={() => exec('superscript')} />
      <Btn label="Subscript (e.g. SO₃)" icon={<IconSubscript size={17} />} onClick={() => exec('subscript')} />
      <Btn label="Clear formatting of the selected text" icon={<IconClearFormatting size={17} />} onClick={() => exec('removeFormat')} />
      <Select size="xs" w={78} leftSection={<IconTextSize size={13} />} placeholder="pt" data={['7', '8', '8.5', '9', '9.5', '10', '10.5', '11', '12', '13', '14', '16']} value={curSize ? String(curSize) : null}
        onChange={(v) => v && setSize(Number(v))} comboboxProps={{ withinPortal: true }} aria-label="Font size" title="Font size: the selected text, or the whole cell / paragraph / table" />
      <span className="sep" />
      <Btn label="Align left" icon={<IconAlignLeft size={17} />} onClick={() => align('left')} active={curAlign === 'left'} disabled={!sec} />
      <Btn label="Centre" icon={<IconAlignCenter size={17} />} onClick={() => align('center')} active={curAlign === 'center'} disabled={!sec} />
      <Btn label="Align right" icon={<IconAlignRight size={17} />} onClick={() => align('right')} active={curAlign === 'right'} disabled={!sec} />
      <Btn label="Justify" icon={<IconAlignJustified size={17} />} onClick={() => align('justify')} active={curAlign === 'justify'} disabled={!sec || (!txt && !cellSel)} />
      {cellSel && <>
        <Btn label="Top" icon={<IconLayoutAlignTop size={17} />} onClick={() => cells((c) => ({ ...c, va: 'top' }))} />
        <Btn label="Middle" icon={<IconLayoutAlignMiddle size={17} />} onClick={() => cells((c) => ({ ...c, va: 'middle' }))} />
        <Btn label="Bottom" icon={<IconLayoutAlignBottom size={17} />} onClick={() => cells((c) => ({ ...c, va: 'bottom' }))} />
      </>}
      {tbl && <>
        <span className="sep" />
        <Btn label="Insert row above" icon={<IconRowInsertTop size={17} />} disabled={!cellSel} onClick={() => tOp((t) => insertRow(t, r0, r0), { r: r0, c: c0 })} />
        <Btn label="Insert row below" icon={<IconRowInsertBottom size={17} />} disabled={!cellSel} onClick={() => { const [ai] = anchorOf(tbl, r0, c0); const end = ai + (tbl.rows[ai][anchorOf(tbl, r0, c0)[1]].rs ?? 1); tOp((t) => insertRow(t, end, end - 1), { r: end, c: c0 }); }} />
        <Btn label="Delete row" icon={<IconRowRemove size={17} />} disabled={!cellSel || tbl.rows.length < 2} onClick={() => tOp((t) => deleteRow(t, r0), { r: Math.max(0, Math.min(r0, tbl.rows.length - 2)), c: c0 })} />
        <Btn label="Insert column left" icon={<IconColumnInsertLeft size={17} />} disabled={!cellSel} onClick={() => tOp((t) => insertCol(t, c0), { r: r0, c: c0 })} />
        <Btn label="Insert column right" icon={<IconColumnInsertRight size={17} />} disabled={!cellSel} onClick={() => { const [, aj] = anchorOf(tbl, r0, c0); const end = aj + (tbl.rows[anchorOf(tbl, r0, c0)[0]][aj].cs ?? 1); tOp((t) => insertCol(t, end), { r: r0, c: end }); }} />
        <Btn label="Delete column" icon={<IconColumnRemove size={17} />} disabled={!cellSel || tbl.cols.length < 2} onClick={() => tOp((t) => deleteCol(t, c0), { r: r0, c: Math.max(0, Math.min(c0, tbl.cols.length - 2)) })} />
        <Btn label="Merge selected cells (Shift+click to select several)" icon={<IconArrowsJoin2 size={17} />} disabled={!multi} onClick={() => { const [a, b, c, d] = rect(); tOp((t) => mergeCells(t, a, b, c, d), { r: a, c: b }); }} />
        <Btn label="Split merged cell" icon={<IconArrowsSplit2 size={17} />} disabled={!merged} onClick={() => tOp((t) => splitCell(t, r0, c0), { r: r0, c: c0 })} />
        <TableProps t={tbl} sel={sel} onChange={put} />
      </>}
      {txt && <>
        <span className="sep" />
        <Popover withinPortal position="bottom" shadow="md">
          <Popover.Target><Button size="compact-xs" variant="subtle" color="gray" onMouseDown={keep}>Paragraph</Button></Popover.Target>
          <Popover.Dropdown>
            <Stack gap={6} w={220}>
              <NumberInput size="xs" label="Line spacing" min={0.8} max={3} step={0.05} decimalScale={2} value={txt.lh ?? 1.35} onChange={(v) => put({ ...txt, lh: Number(v) || undefined })} />
              <Group grow><NumberInput size="xs" label="Space before (mm)" min={0} max={80} step={0.5} value={txt.mt ?? 0.5} onChange={(v) => put({ ...txt, mt: Number(v) })} />
                <NumberInput size="xs" label="after (mm)" min={0} max={80} step={0.5} value={txt.mb ?? 0} onChange={(v) => put({ ...txt, mb: Number(v) })} /></Group>
              <NumberInput size="xs" label="Indent (mm)" min={0} max={120} value={txt.indent ?? 0} onChange={(v) => put({ ...txt, indent: Number(v) || undefined })} />
              <Group gap="xs">
                <Button size="compact-xs" variant={txt.box ? 'filled' : 'default'} onClick={() => put({ ...txt, box: !txt.box })}>Text box (border)</Button>
                <Button size="compact-xs" variant={txt.heading ? 'filled' : 'default'} onClick={() => put({ ...txt, heading: !txt.heading })} title="A heading is kept on the same page as what follows">Heading</Button>
              </Group>
              {txt.box && <NumberInput size="xs" label="Box width (% of page)" min={10} max={100} value={txt.width ?? 100} onChange={(v) => put({ ...txt, width: Number(v) || undefined })} />}
            </Stack>
          </Popover.Dropdown>
        </Popover>
      </>}
      <span className="sep" />
      <Btn label="Move up" icon={<IconArrowUp size={17} />} onClick={() => move(-1)} disabled={idx <= 0} />
      <Btn label="Move down" icon={<IconArrowDown size={17} />} onClick={() => move(1)} disabled={idx < 0 || idx >= sections.length - 1} />
      <Btn label="Duplicate" icon={<IconCopy size={17} />} onClick={dup} disabled={!sec || sec.type === 'auto'} />
      <Btn label="Delete this table / paragraph" icon={<IconTrash size={17} />} onClick={del} disabled={!sec} />
      <span className="sep" />
      <Menu withinPortal shadow="md" closeOnItemClick={false}>
        <Menu.Target><Button size="compact-xs" variant="light" leftSection={<IconPlus size={13} />} onMouseDown={keep}>Insert</Button></Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>{idx >= 0 ? 'After the selected part' : 'Before the notes'}</Menu.Label>
          <Menu.Item onClick={() => insertAt(text('New paragraph', { mt: 2 }))}>Paragraph / remarks (multi-line)</Menu.Item>
          <Menu.Item onClick={() => insertAt(text('<u>HEADING</u>', { al: 'center', heading: true, mt: 3, sz: 10.5 }))}>Heading</Menu.Item>
          <Menu.Item onClick={() => insertAt(text('Text', { box: true, mt: 2 }))}>Text box</Menu.Item>
          <Menu.Divider />
          <Group gap={6} px="sm" py={4} wrap="nowrap">
            <IconTable size={15} />
            <NumberInput size="xs" w={62} min={1} max={60} value={rows} onChange={(v) => setRows(Number(v) || 1)} aria-label="Rows" />
            <Text size="xs">×</Text>
            <NumberInput size="xs" w={62} min={1} max={20} value={cols} onChange={(v) => setCols(Number(v) || 1)} aria-label="Columns" />
            <Button size="compact-xs" onClick={() => insertAt(table(Array(cols).fill(100 / cols), Array.from({ length: rows }, () => Array(cols).fill('')), { mt: 2, head: rows > 1 ? 1 : 0 }))}>Table</Button>
          </Group>
        </Menu.Dropdown>
      </Menu>
      <Button size="compact-xs" variant="subtle" color="orange" onMouseDown={keep} onClick={onRebuild} title="Throw away manual changes and build the layout again from the report format">Rebuild</Button>
    </div>
  );
}

function TableProps({ t, sel, onChange }: { t: TableSection; sel: LayoutSel | null; onChange: (t: TableSection) => void }) {
  const r = sel?.r;
  const borders: [NonNullable<TableSection['border']>, React.ReactNode, string][] = [['all', <IconBorderAll size={15} key="a" />, 'All borders'], ['outer', <IconBorderOuter size={15} key="o" />, 'Outside border'], ['inner', <IconBorderInner size={15} key="i" />, 'Inside borders'], ['none', <IconBorderNone size={15} key="n" />, 'No borders']];
  return (
    <Popover withinPortal position="bottom" shadow="md">
      <Popover.Target><Tooltip label="Table properties: borders, width, column widths, row height" openDelay={300}><ActionIcon variant="subtle" color="gray" onMouseDown={keep} aria-label="Table properties"><IconTableOptions size={17} /></ActionIcon></Tooltip></Popover.Target>
      <Popover.Dropdown>
        <Stack gap={6} w={260}>
          <Text size="xs" fw={600}>Borders</Text>
          <Group gap={4}>{borders.map(([k, ic, l]) => <Tooltip key={k} label={l}><ActionIcon variant={(t.border ?? 'all') === k ? 'filled' : 'default'} onClick={() => onChange({ ...t, border: k })}>{ic}</ActionIcon></Tooltip>)}</Group>
          <Group grow>
            <NumberInput size="xs" label="Table width (%)" min={10} max={100} value={t.width ?? 100} onChange={(v) => onChange({ ...t, width: Number(v) || undefined })} />
            <Select size="xs" label="Position" data={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]} value={t.align ?? 'center'} onChange={(v) => onChange({ ...t, align: (v ?? 'center') as TableSection['align'] })} comboboxProps={{ withinPortal: false }} />
          </Group>
          <Group grow>
            <NumberInput size="xs" label="Space before (mm)" min={0} max={80} step={0.5} value={t.mt ?? 1} onChange={(v) => onChange({ ...t, mt: Number(v) })} />
            <NumberInput size="xs" label="Cell padding (px)" min={0} max={20} value={t.pad ?? 2} onChange={(v) => onChange({ ...t, pad: Number(v) })} />
          </Group>
          <NumberInput size="xs" label="Heading rows (repeated on a new page)" min={0} max={Math.min(10, t.rows.length)} value={t.head ?? 0} onChange={(v) => onChange(normalise({ ...t, head: Number(v) || 0 }))} />
          {r !== undefined && <NumberInput size="xs" label={`Height of row ${r + 1} (mm, empty = automatic)`} min={2} max={200} step={0.5} value={t.rh?.[r] ?? ''} placeholder="automatic"
            onChange={(v) => { const rh = (t.rh ?? t.rows.map(() => null)).slice(); rh[r] = v === '' ? null : Number(v); onChange({ ...t, rh }); }} />}
          <Text size="xs" fw={600} mt={4}>Column widths (%) – or drag the blue lines on the table</Text>
          <Group gap={4}>{t.cols.map((w, j) => <NumberInput key={j} size="xs" w={56} min={1} max={95} decimalScale={1} value={w} hideControls
            onChange={(v) => { const cols = t.cols.slice(); cols[j] = Number(v) || 1; onChange({ ...t, cols }); }} onBlur={() => onChange(normalise(t))} aria-label={`Column ${j + 1} width`} />)}</Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
