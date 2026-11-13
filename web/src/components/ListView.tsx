import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocalStorage, useMediaQuery } from '@mantine/hooks';
import { useLocation, useSearchParams } from 'react-router-dom';
import { FavStar } from '../favorites';
import { moveItem, useDragReorder } from './useDragReorder';
import { ActionIcon, Button, Checkbox, Drawer, Group, Menu, MultiSelect, Pagination, Popover, ScrollArea, SegmentedControl, Select, SimpleGrid, Stack, Text, TextInput, Tooltip, Modal, UnstyledButton } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconCheck, IconChevronDown, IconColumns3, IconDeviceFloppy, IconDownload, IconFilter, IconGripVertical, IconLayoutKanban, IconLayoutList, IconLayoutRows, IconLock, IconPencil, IconPin, IconPinnedOff, IconPlus, IconSearch, IconSettings2, IconTable, IconTrash, IconUsersGroup, IconX } from '@tabler/icons-react';
import { api, dmy, downloadCsv, money, ok } from '../api';
import { useCan, useMe, useMeta } from '../ctx';
import { Empty, StatusBadge, TypeBadge } from './ui';

export type ColType = 'text' | 'money' | 'number' | 'date' | 'status' | 'badge' | 'picklist';
export interface Col<T = any> {
  key: string; label: string; type?: ColType; width?: number; align?: 'left' | 'right' | 'center';
  value?: (r: T) => unknown;            // value used for filter/sort/export
  render?: (r: T) => ReactNode;          // custom cell
  filter?: 'text' | 'select' | 'date' | 'number';
  hidden?: boolean;                      // not shown by default
}
interface Filter { key: string; op: 'contains' | 'in' | 'from' | 'to' | 'min' | 'max'; value: any }
interface ViewDef { name: string; filters: Filter[]; columns?: string[]; sort?: { key: string; dir: 1 | -1 }; search?: string; display?: 'table' | 'kanban'; groupBy?: string | null }

const getVal = (c: Col, r: any) => (c.value ? c.value(r) : r[c.key]);

/**
 * Salesforce-style list view: search, per-column filters, sorting, column chooser, saved views
 * (personal or shared by admins) and export of exactly what is on screen.
 */
const stamp = (v: unknown) => { if (!v) return ''; const d = new Date(String(v)); return Number.isNaN(+d) ? String(v) : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const workKey = (id: string, view: string) => `lv-work:${id}:${view}`;
const readWork = (id: string, view: string): ViewDef | null => { try { return JSON.parse(localStorage.getItem(workKey(id, view)) ?? 'null'); } catch { return null; } };
const writeWork = (id: string, view: string, v: ViewDef | null) => { try { if (v) localStorage.setItem(workKey(id, view), JSON.stringify(v)); else localStorage.removeItem(workKey(id, view)); } catch { /* storage unavailable */ } };

export function ListView<T extends Record<string, any>>({ id, rows, columns: columnsIn, onRow, loading, actions, empty, pageSize = 50, quickFilters, embedded, bulk, panel, activeId, onClosePanel }: {
  id: string; rows: T[] | null; columns: Col<T>[]; onRow?: (r: T) => void; loading?: boolean; actions?: ReactNode; empty?: ReactNode; pageSize?: number;
  quickFilters?: { label: string; filters: Filter[] }[];
  /** A short related list inside a record page: no toolbar of its own (search appears once it has more than a handful of rows). */
  embedded?: boolean;
  /** Extra actions for the selected rows, shown in the bar that appears when rows are ticked. */
  bulk?: (selected: T[], clear: () => void) => ReactNode;
  /** Quick view of the record with `activeId`, docked beside the list (a drawer on narrow screens). */
  panel?: ReactNode; activeId?: string | number | null; onClosePanel?: () => void;
}) {
  const { meta, reload: reloadMeta } = useMeta();
  const me = useMe();
  // Created / Last modified are available on every list whose records carry them (hidden until chosen in "Select fields").
  const hasCreated = Boolean(rows?.some((r) => r.created_at)), hasUpdated = Boolean(rows?.some((r) => r.updated_at));
  const columns = useMemo<Col<T>[]>(() => [
    ...columnsIn,
    ...(hasCreated && !columnsIn.some((c) => c.key === 'created_at') ? [{ key: 'created_at', label: 'Created', type: 'date' as const, hidden: true, value: (r: T) => String(r.created_at ?? '').slice(0, 10), render: (r: T) => stamp(r.created_at) }] : []),
    ...(hasUpdated && !columnsIn.some((c) => c.key === 'updated_at') ? [{ key: 'updated_at', label: 'Last modified', type: 'date' as const, hidden: true, value: (r: T) => String(r.updated_at ?? r.created_at ?? '').slice(0, 10), render: (r: T) => stamp(r.updated_at ?? r.created_at) }] : []),
  ], [columnsIn, hasCreated, hasUpdated]);
  const can = useCan();
  const loc = useLocation();
  const [sp] = useSearchParams();
  const saved = meta.listviews.filter((v) => v.key.startsWith(`${id}:`) && !v.key.includes(':__pin'));
  const pinKey = `${id}:__pin-u${me.user.id}`;
  const pinned = (meta.listviews.find((v) => v.key === pinKey)?.data?.view as string | undefined) ?? null;
  const defaults = columns.filter((c) => !c.hidden).map((c) => c.key);
  const [lastView, setLastView] = useLocalStorage<string>({ key: `lv-view:${id}`, defaultValue: '__all', getInitialValueInEffect: false });
  const [view, setViewState] = useState<string>(() => sp.get('view') ?? pinned ?? lastView);
  const setView = (v: string) => { setViewState(v); setLastView(v); };
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [visible, setVisible] = useState<string[]>(defaults);
  const [display, setDisplay] = useState<'table' | 'kanban'>('table');
  const [groupBy, setGroupBy] = useState<string | null>(null);
  const [density, setDensity] = useLocalStorage<'comfortable' | 'compact'>({ key: 'lv-density', defaultValue: 'comfortable' });
  const [page, setPage] = useState(1);
  const [saveOpen, setSaveOpen] = useState<null | 'new' | 'rename'>(null);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const phone = useMediaQuery('(max-width: 767px)');
  const narrow = useMediaQuery('(max-width: 1180px)');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const rowId = (r: T, i: number) => String(r.id ?? i);
  // While a quick view is docked the menu folds to icons, so the list keeps its room.
  useEffect(() => {
    if (!panel || narrow) return;
    window.dispatchEvent(new CustomEvent('nav:auto-mini', { detail: true })); document.body.classList.add('has-qv');
    return () => { window.dispatchEvent(new CustomEvent('nav:auto-mini', { detail: false })); document.body.classList.remove('has-qv'); };
  }, [Boolean(panel), narrow]);
  const current = saved.find((x) => x.key === view);
  const def = current?.data as ViewDef | undefined;
  const groupCols = columns.filter((c) => ['status', 'badge', 'picklist'].includes(c.type ?? '') || c.filter === 'select').sort((a, b) => Number(b.type === 'status') - Number(a.type === 'status'));

  useEffect(() => { const q = sp.get('view'); if (q && q !== view) setView(q); }, [sp.get('view')]);
  useEffect(() => {
    if (view !== '__all' && !current) { setViewState('__all'); return; } // view was deleted or is not shared with this user
    const v = def;
    if (v) { setFilters(v.filters ?? []); setSort(v.sort ?? null); setSearch(v.search ?? ''); setVisible(v.columns?.length ? v.columns.filter((k) => columns.some((c) => c.key === k)) : defaults); setDisplay(v.display ?? 'table'); setGroupBy(v.groupBy ?? null); }
    else { setFilters([]); setSort(null); setSearch(''); setVisible(defaults); setDisplay('table'); setGroupBy(null); }
    const w = readWork(id, view); // unsaved changes made earlier to this view are kept until saved or reset
    if (w) { setFilters(w.filters ?? []); setSort(w.sort ?? null); setSearch(w.search ?? ''); if (w.columns?.length) setVisible(w.columns.filter((k) => columns.some((c) => c.key === k))); setDisplay(w.display ?? 'table'); setGroupBy(w.groupBy ?? null); }
    setPage(1);
  }, [view, current?.data]);

  const state: ViewDef = { name: def?.name ?? '', filters, columns: visible, sort: sort ?? undefined, search, display, groupBy };
  const base: ViewDef = def ?? { name: '', filters: [], columns: defaults, search: '', display: 'table', groupBy: null };
  const dirty = JSON.stringify([filters, visible, sort ?? null, search, display, groupBy ?? null]) !== JSON.stringify([base.filters ?? [], base.columns?.length ? base.columns : defaults, base.sort ?? null, base.search ?? '', base.display ?? 'table', base.groupBy ?? null]);
  const mineOrAdmin = Boolean(current && def && (current.owner_id === me.user.id || can('manageCustomization')));
  useEffect(() => { writeWork(id, view, dirty ? state : null); }, [dirty, JSON.stringify(state)]);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const takenNames = (except?: string) => saved.filter((v) => v.key !== except).map((v) => String((v.data as ViewDef).name ?? '').trim().toLowerCase());
  const pin = async (v: string | null) => {
    if (v) await api(`/meta/listview/${encodeURIComponent(pinKey)}`, { method: 'PUT', body: { view: v, name: '__pin' } });
    else await api(`/meta/listview/${encodeURIComponent(pinKey)}`, { method: 'DELETE' });
    await reloadMeta(); ok(v ? 'This view now opens by default' : 'Default view removed');
  };
  const resetWork = () => { setFilters(base.filters ?? []); setSort(base.sort ?? null); setSearch(base.search ?? ''); setVisible(base.columns?.length ? base.columns : defaults); setDisplay(base.display ?? 'table'); setGroupBy(base.groupBy ?? null); writeWork(id, view, null); };

  const shown = visible.map((k) => columns.find((c) => c.key === k)).filter(Boolean) as Col<T>[];
  const filtered = useMemo(() => {
    let out = rows ?? [];
    const q = search.trim().toLowerCase();
    if (q) out = out.filter((r) => columns.some((c) => String(getVal(c, r) ?? '').toLowerCase().includes(q)));
    for (const f of filters) {
      const c = columns.find((x) => x.key === f.key); if (!c) continue;
      out = out.filter((r) => {
        const v = getVal(c, r);
        if (f.op === 'contains') return String(v ?? '').toLowerCase().includes(String(f.value).toLowerCase());
        if (f.op === 'in') return !f.value?.length || f.value.includes(String(v ?? ''));
        if (f.op === 'from') return !f.value || String(v ?? '') >= f.value;
        if (f.op === 'to') return !f.value || (String(v ?? '') !== '' && String(v ?? '') <= f.value);
        if (f.op === 'min') return f.value === '' || Number(v) >= Number(f.value);
        if (f.op === 'max') return f.value === '' || Number(v) <= Number(f.value);
        return true;
      });
    }
    if (sort) {
      const c = columns.find((x) => x.key === sort.key);
      if (c) out = [...out].sort((a, b) => {
        const x = getVal(c, a), y = getVal(c, b);
        const n = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true });
        return n * sort.dir;
      });
    }
    return out;
  }, [rows, search, filters, sort, columns]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { if (page > pages) setPage(1); }, [pages]);

  const setFilter = (key: string, op: Filter['op'], value: any) => setFilters((fs) => [...fs.filter((f) => !(f.key === key && f.op === op)), ...(value === '' || value === null || (Array.isArray(value) && !value.length) ? [] : [{ key, op, value }])]);
  const fval = (key: string, op: Filter['op']) => filters.find((f) => f.key === key && f.op === op)?.value;
  const totalsCols = shown.filter((c) => c.type === 'money');
  const exportRows = () => downloadCsv(`${id}-${new Date().toLocaleDateString('en-CA')}.csv`, shown.map((c) => ({ key: c.key, label: c.label })), filtered.map((r) => Object.fromEntries(shown.map((c) => [c.key, getVal(c, r)]))));

  const cell = (c: Col<T>, r: T) => {
    if (c.render) return c.render(r);
    const v = getVal(c, r);
    switch (c.type) {
      case 'money': return v === null || v === undefined || v === '' ? '' : `₹${money(Number(v))}`;
      case 'date': return dmy(v as string);
      case 'status': return <StatusBadge status={v as string} />;
      case 'badge': case 'picklist': return v ? (v === 'NABL' || v === 'Non-NABL' ? <TypeBadge value={String(v)} /> : <span className="tag t-non">{String(v)}</span>) : '';
      default: return v === null || v === undefined ? '' : String(v);
    }
  };
  const distinct = (c: Col<T>) => [...new Set((rows ?? []).map((r) => String(getVal(c, r) ?? '')).filter(Boolean))].sort().slice(0, 200);
  const filterKind = (c: Col<T>) => c.filter ?? (c.type === 'date' ? 'date' : c.type === 'money' || c.type === 'number' ? 'number' : c.type === 'status' || c.type === 'badge' || c.type === 'picklist' ? 'select' : 'text');

  const persist = async (key: string, name: string, shared: boolean) => {
    await api(`/meta/listview/${encodeURIComponent(key)}`, { method: 'PUT', body: { ...state, name, shared } });
    await reloadMeta(); // the new view must be in the list before it is selected
  };
  const saveNew = async (name: string, shared: boolean) => {
    if (takenNames().includes(name.trim().toLowerCase())) { throw new Error(`A view called “${name}” already exists here. Choose another name.`); }
    writeWork(id, view, null);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const key = `${id}:${shared ? '' : `u${me.user.id}-`}${slug}`;
    await persist(key, name, shared); ok(`View “${name}” saved`); setView(key); setSaveOpen(null);
  };
  const saveCurrent = async () => { if (!current || !def) return; writeWork(id, view, null); await persist(current.key, def.name, current.owner_id === null); ok('View updated'); };
  const rename = async (name: string, shared: boolean) => {
    if (!current) return;
    if (takenNames(current.key).includes(name.trim().toLowerCase())) throw new Error(`A view called “${name}” already exists here. Choose another name.`);
    await api(`/meta/listview/${encodeURIComponent(current.key)}`, { method: 'PUT', body: { ...(def as object), name, shared } }); await reloadMeta(); ok('View updated'); setSaveOpen(null);
  };
  const viewLabel = view === '__all' ? 'All records' : def?.name ?? 'All records';
  const favRef = view === '__all' || !def ? null : `${loc.pathname}?view=${encodeURIComponent(view)}`;

  const sameFilters = (f: Filter[]) => JSON.stringify(filters) === JSON.stringify(f);
  const matches = (f: Filter[]) => (rows ?? []).filter((r) => f.every((x) => { const c = columns.find((k) => k.key === x.key); if (!c) return true; const v = getVal(c, r); return x.op === 'in' ? x.value.includes(String(v ?? '')) : x.op === 'min' ? Number(v) >= Number(x.value) : x.op === 'max' ? Number(v) <= Number(x.value) : x.op === 'contains' ? String(v ?? '').toLowerCase().includes(String(x.value).toLowerCase()) : true; })).length;
  const quickActive = quickFilters?.find((q) => sameFilters(q.filters));
  const chips = quickActive ? [] : filters;
  const selectable = !embedded && !phone && display === 'table';
  const selected = filtered.filter((r, i) => picked.has(rowId(r, i)));
  const allOnPage = pageRows.length > 0 && pageRows.every((r, i) => picked.has(rowId(r, i)));
  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const clearPicked = () => setPicked(new Set());
  const showSearch = !embedded || (rows?.length ?? 0) > 8;
  const from = filtered.length ? (page - 1) * pageSize + 1 : 0, to = Math.min(filtered.length, page * pageSize);
  const align = (c: Col<T>) => c.align ?? (c.type === 'money' || c.type === 'number' ? 'right' : 'left');
  const emptyState = rows && !filtered.length ? (rows.length
    ? <Empty icon={<IconSearch size={20} stroke={1.6} />} title="No records match" action={<Button size="xs" variant="default" onClick={() => { setFilters([]); setSearch(''); }}>Clear search and filters</Button>}>Try a different search, or remove a filter.</Empty>
    : <Empty title={embedded ? undefined : 'Nothing here yet'}>{empty ?? (embedded ? 'Nothing here yet.' : 'Records will appear here once they are created.')}</Empty>) : null;

  const viewMenu = (
    <Menu width={290} position="bottom-start">
      <Menu.Target>
        <UnstyledButton className="lv-viewpick" aria-label="List views">
          <IconLayoutList size={15} stroke={1.75} />
          <span className="lv-viewname">{viewLabel}</span>
          {pinned === view && <Tooltip label="Your default view"><IconPin size={13} /></Tooltip>}
          <IconChevronDown size={13} />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>List views</Menu.Label>
        <Menu.Item onClick={() => setView('__all')} rightSection={view === '__all' ? <IconCheck size={14} /> : null}>All records</Menu.Item>
        {saved.map((v) => <Menu.Item key={v.key} onClick={() => setView(v.key)} leftSection={v.owner_id === null ? <Tooltip label="Shared with everyone"><IconUsersGroup size={14} /></Tooltip> : <Tooltip label="Only you"><IconLock size={14} /></Tooltip>} rightSection={<Group gap={4}>{pinned === v.key && <IconPin size={13} />}{view === v.key && <IconCheck size={14} />}</Group>}>{(v.data as ViewDef).name}</Menu.Item>)}
        <Menu.Divider />
        {pinned === view ? <Menu.Item leftSection={<IconPinnedOff size={14} />} onClick={() => pin(null)}>Unpin “{viewLabel}” as my default</Menu.Item>
          : <Menu.Item leftSection={<IconPin size={14} />} onClick={() => pin(view)}>Pin “{viewLabel}” as my default</Menu.Item>}
        <Menu.Item leftSection={<IconPlus size={14} />} onClick={() => setSaveOpen('new')}>New view from current filters…</Menu.Item>
        {mineOrAdmin && <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => setSaveOpen('rename')}>Rename / sharing…</Menu.Item>}
        {mineOrAdmin && <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={async () => { if (!window.confirm(`Delete the view “${def!.name}”?`)) return; await api(`/meta/listview/${encodeURIComponent(view)}`, { method: 'DELETE' }); reloadMeta(); setView('__all'); }}>Delete view</Menu.Item>}
      </Menu.Dropdown>
    </Menu>
  );
  const filterPopover = (
    <Popover width={340} position="bottom-end">
      <Popover.Target><Button size="xs" variant="default" className={filters.length && !quickActive ? 'lv-on' : undefined} leftSection={<IconFilter size={14} />}>Filter{chips.length ? ` · ${chips.length}` : ''}</Button></Popover.Target>
      <Popover.Dropdown>
        <Stack gap={8} mah={420} style={{ overflow: 'auto' }}>
          {columns.filter((c) => c.key !== '_actions').map((c) => {
            const k = filterKind(c);
            if (k === 'select') return <MultiSelect key={c.key} size="xs" label={c.label} data={distinct(c)} value={fval(c.key, 'in') ?? []} onChange={(v) => setFilter(c.key, 'in', v)} searchable clearable comboboxProps={{ withinPortal: false }} />;
            if (k === 'date') return <Group key={c.key} grow gap={6}><TextInput size="xs" type="date" label={`${c.label} from`} value={fval(c.key, 'from') ?? ''} onChange={(e) => setFilter(c.key, 'from', e.currentTarget.value)} /><TextInput size="xs" type="date" label="to" value={fval(c.key, 'to') ?? ''} onChange={(e) => setFilter(c.key, 'to', e.currentTarget.value)} /></Group>;
            if (k === 'number') return <Group key={c.key} grow gap={6}><TextInput size="xs" label={`${c.label} min`} value={fval(c.key, 'min') ?? ''} onChange={(e) => setFilter(c.key, 'min', e.currentTarget.value)} /><TextInput size="xs" label="max" value={fval(c.key, 'max') ?? ''} onChange={(e) => setFilter(c.key, 'max', e.currentTarget.value)} /></Group>;
            return <TextInput key={c.key} size="xs" label={c.label} placeholder="contains…" value={fval(c.key, 'contains') ?? ''} onChange={(e) => setFilter(c.key, 'contains', e.currentTarget.value)} />;
          })}
          {filters.length > 0 && <Button size="xs" variant="subtle" color="red" onClick={() => setFilters([])}>Clear all filters</Button>}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );

  const table = (
    <div className={`lv-scroll${embedded ? ' lv-embedded' : ''}`}>
      <table className="lv-table">
        <thead><tr>
          {selectable && <th className="lv-check"><Checkbox size="xs" aria-label="Select all on this page" checked={allOnPage} indeterminate={!allOnPage && pageRows.some((r, i) => picked.has(rowId(r, i)))} onChange={() => setPicked((p) => { const n = new Set(p); pageRows.forEach((r, i) => (allOnPage ? n.delete(rowId(r, i)) : n.add(rowId(r, i)))); return n; })} /></th>}
          {shown.map((c) => (
            <th key={c.key} className={c.key !== '_actions' ? 'sortable' : undefined} style={{ width: c.width, textAlign: align(c) }} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
              onClick={() => c.key !== '_actions' && setSort((x) => (x?.key === c.key ? (x.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))}>
              {c.label}{sort?.key === c.key && (sort.dir === 1 ? <IconArrowUp size={12} style={{ verticalAlign: -2, marginLeft: 3 }} /> : <IconArrowDown size={12} style={{ verticalAlign: -2, marginLeft: 3 }} />)}
            </th>))}
        </tr></thead>
        <tbody>
          {loading && !rows && Array.from({ length: 7 }).map((_, i) => <tr key={i}>{selectable && <td className="lv-check" />}{shown.map((c) => <td key={c.key}><div className="skel" style={{ height: 12, width: `${45 + ((i * 17 + c.key.length * 7) % 45)}%`, marginLeft: align(c) === 'right' ? 'auto' : undefined }} /></td>)}</tr>)}
          {pageRows.map((r, i) => {
            const k = rowId(r, i), on = picked.has(k), active = activeId !== undefined && activeId !== null && String(activeId) === k;
            return (
              <tr key={k} className={`${onRow ? 'row-click' : ''}${on || active ? ' sel' : ''}`} onClick={onRow ? () => onRow(r) : undefined} aria-selected={on || undefined}>
                {selectable && <td className="lv-check" onClick={(e) => e.stopPropagation()}><Checkbox size="xs" aria-label="Select row" checked={on} onChange={() => toggle(k)} /></td>}
                {shown.map((c) => { const v = cell(c, r); const plain = typeof v === 'string' || typeof v === 'number';
                  return <td key={c.key} className={plain ? 'lv-clip' : undefined} title={plain && String(v).length > 28 ? String(v) : undefined} style={{ textAlign: align(c), fontVariantNumeric: c.type === 'money' || c.type === 'number' || c.type === 'date' ? 'tabular-nums' : undefined, whiteSpace: ['badge', 'status', 'picklist', 'money', 'date'].includes(c.type ?? '') ? 'nowrap' : undefined }}>{v}</td>; })}
              </tr>
            );
          })}
          {emptyState && <tr className="lv-emptyrow"><td colSpan={shown.length + (selectable ? 1 : 0)}>{emptyState}</td></tr>}
        </tbody>
        {totalsCols.length > 0 && filtered.length > 1 && (
          <tfoot><tr>{selectable && <td />}{shown.map((c, i) => <td key={c.key} style={{ textAlign: c.type === 'money' ? 'right' : 'left' }}>
            {c.type === 'money' ? `₹${money(filtered.reduce((a, r) => a + Number(getVal(c, r) ?? 0), 0))}` : i === 0 ? 'Total' : ''}</td>)}</tr></tfoot>
        )}
      </table>
    </div>
  );

  return (
    <div className={`lv${density === 'compact' ? ' lv-compact' : ''}${embedded ? ' lv-emb' : ''}${panel && !narrow ? ' lv-split' : ''}`}>
      <div className="lv-main">
      {(!embedded || showSearch) && (
        <div className="lv-bar">
          {!embedded && viewMenu}
          {!embedded && quickFilters && quickFilters.length > 0 && (
            <div className="lv-seg" role="tablist" aria-label="Quick filters">
              <button type="button" role="tab" aria-selected={!filters.length} className={!filters.length ? 'on' : ''} onClick={() => setFilters([])}>All{rows ? <span className="n">{rows.length}</span> : null}</button>
              {quickFilters.map((q) => <button key={q.label} type="button" role="tab" aria-selected={sameFilters(q.filters)} className={sameFilters(q.filters) ? 'on' : ''} onClick={() => { setFilters(sameFilters(q.filters) ? [] : q.filters); setPage(1); }}>{q.label}{rows ? <span className="n">{matches(q.filters)}</span> : null}</button>)}
            </div>
          )}
          {!embedded && favRef && def && <FavStar kind="listview" refKey={favRef} label={def.name} sub={document.title.split('·')[0]?.trim() || undefined} />}
          <div className="lv-tools">
            {showSearch && <TextInput size="xs" className="lv-search" placeholder={embedded ? 'Search' : 'Search this list'} aria-label="Search this list" leftSection={<IconSearch size={14} />} value={search} onChange={(e) => { setSearch(e.currentTarget.value); setPage(1); }}
              rightSection={search ? <ActionIcon size="xs" variant="subtle" color="gray" aria-label="Clear search" onClick={() => setSearch('')}><IconX size={12} /></ActionIcon> : null} />}
            {!embedded && filterPopover}
            {!embedded && !phone && groupCols.length > 0 && (
              <SegmentedControl size="xs" value={display} onChange={(v) => { setDisplay(v as never); if (v === 'kanban' && !groupBy) setGroupBy(groupCols[0].key); }}
                data={[{ value: 'table', label: <Tooltip label="Table"><span style={{ display: 'flex' }}><IconTable size={15} /></span></Tooltip> }, { value: 'kanban', label: <Tooltip label="Board"><span style={{ display: 'flex' }}><IconLayoutKanban size={15} /></span></Tooltip> }]} />
            )}
            {!embedded && display === 'kanban' && !phone && <Select size="xs" w={160} aria-label="Group the board by" leftSection={<Text size="xs" c="dimmed" pl={4}>by</Text>} leftSectionWidth={28} data={groupCols.map((c) => ({ value: c.key, label: c.label }))} value={groupBy} onChange={setGroupBy} allowDeselect={false} />}
            {!embedded && (
              <Menu width={250} position="bottom-end">
                <Menu.Target><Tooltip label="Fields, row height, export"><ActionIcon className="hide-mobile" variant="default" size={30} aria-label="List options"><IconColumns3 size={15} /></ActionIcon></Tooltip></Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>This list</Menu.Label>
                  <Menu.Item leftSection={<IconColumns3 size={14} />} onClick={() => setFieldsOpen(true)}>Select fields to display…</Menu.Item>
                  <Menu.Item leftSection={<IconLayoutRows size={14} />} onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}>{density === 'compact' ? 'Comfortable rows' : 'Compact rows'}</Menu.Item>
                  <Menu.Item leftSection={<IconDownload size={14} />} onClick={exportRows}>Export these rows (CSV)</Menu.Item>
                  <Menu.Divider />
                  <Menu.Item leftSection={<IconPlus size={14} />} onClick={() => setSaveOpen('new')}>Save as a new view…</Menu.Item>
                  {mineOrAdmin && <Menu.Item leftSection={<IconDeviceFloppy size={14} />} onClick={saveCurrent} disabled={!dirty}>Save changes to “{def!.name}”</Menu.Item>}
                </Menu.Dropdown>
              </Menu>
            )}
            {actions}
          </div>
        </div>
      )}
      {!embedded && (chips.length > 0 || dirty) && (
        <div className="lv-chips">
          {chips.map((f) => {
            const c = columns.find((x) => x.key === f.key);
            const label = f.op === 'in' ? f.value.join(', ') : f.op === 'contains' ? `“${f.value}”` : `${{ from: 'from', to: 'to', min: '≥', max: '≤' }[f.op as 'from']} ${f.op === 'from' || f.op === 'to' ? dmy(f.value) : f.value}`;
            return <span key={f.key + f.op} className="lv-chip"><span>{c?.label}: {label}</span><button type="button" aria-label={`Remove filter ${c?.label}`} onClick={() => setFilters((fs) => fs.filter((x) => x !== f))}><IconX size={12} /></button></span>;
          })}
          {chips.length > 0 && <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setFilters([])}>Clear</Button>}
          {dirty && view !== '__all' && <span className="lv-dirty"><Text size="xs" c="dimmed">Unsaved changes to this view</Text>
            <Button size="compact-xs" variant="default" onClick={() => (mineOrAdmin ? setChoiceOpen(true) : setSaveOpen('new'))}>Save…</Button>
            <Button size="compact-xs" variant="subtle" color="gray" onClick={resetWork}>Reset</Button></span>}
          {dirty && view === '__all' && (chips.length > 0 || search) && <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconPlus size={12} />} onClick={() => setSaveOpen('new')}>Save as view</Button>}
        </div>
      )}
      {phone ? <CardList shown={shown} rows={pageRows} cell={cell} onRow={onRow} loading={Boolean(loading && !rows)} emptyText={emptyState} />
      : display === 'kanban' && groupBy && !embedded ? <Kanban rows={filtered} shown={shown} columns={columns} groupBy={groupBy} cell={cell} onRow={onRow} />
      : table}
      {!embedded && display !== 'kanban' && rows && filtered.length > 0 && (
        <div className="lv-foot">
          <Text size="xs" c="dimmed" className="tnum">{pages > 1 ? `${from}–${to} of ${filtered.length}` : `${filtered.length} ${filtered.length === 1 ? 'record' : 'records'}`}{filtered.length !== rows.length ? ` · filtered from ${rows.length}` : ''}{sort ? ` · sorted by ${columns.find((c) => c.key === sort.key)?.label}` : ''}</Text>
          {pages > 1 && <Pagination size="sm" total={pages} value={page} onChange={setPage} radius="md" />}
        </div>
      )}
      {embedded && pages > 1 && <div className="lv-foot"><Text size="xs" c="dimmed" className="tnum">{from}–{to} of {filtered.length}</Text><Pagination size="sm" total={pages} value={page} onChange={setPage} radius="md" /></div>}
      {selectable && selected.length > 0 && (
        <div className="lv-bulk no-print" role="toolbar" aria-label="Actions for the selected rows">
          <b className="tnum">{selected.length} selected</b><span className="lv-bulk-sep" />
          {bulk?.(selected, clearPicked)}
          <button type="button" onClick={() => downloadCsv(`${id}-selected-${new Date().toLocaleDateString('en-CA')}.csv`, shown.filter((c) => c.key !== '_actions').map((c) => ({ key: c.key, label: c.label })), selected.map((r) => Object.fromEntries(shown.map((c) => [c.key, getVal(c, r)]))))}><IconDownload size={14} />Export</button>
          <Tooltip label="Clear selection"><button type="button" className="x" aria-label="Clear selection" onClick={clearPicked}><IconX size={15} /></button></Tooltip>
        </div>
      )}
      </div>
      {panel && !narrow && <aside className="lv-panel" aria-label="Quick view">{panel}</aside>}
      {panel && narrow && <Drawer opened onClose={() => onClosePanel?.()} withCloseButton={false} size={phone ? '100%' : 460} padding={0}>{panel}</Drawer>}
      <SaveViewModal mode={saveOpen} onClose={() => setSaveOpen(null)} onSave={saveOpen === 'rename' ? rename : saveNew} canShare={can('manageCustomization')}
        initial={saveOpen === 'rename' && current && def ? { name: def.name, shared: current.owner_id === null } : undefined} />
      <Modal opened={choiceOpen} onClose={() => setChoiceOpen(false)} title="Save your changes" size="sm">
        <Stack gap="xs">
          <Text size="sm" c="dimmed">You changed the filters, fields or sorting of “{def?.name}”.</Text>
          <Button leftSection={<IconDeviceFloppy size={16} />} onClick={async () => { await saveCurrent(); setChoiceOpen(false); }}>Update “{def?.name}”</Button>
          <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => { setChoiceOpen(false); setSaveOpen('new'); }}>Save as a new view…</Button>
        </Stack>
      </Modal>
      {fieldsOpen && <FieldsModal columns={columns} visible={visible} onClose={() => setFieldsOpen(false)} onApply={(v) => { setVisible(v); setFieldsOpen(false); }} defaults={defaults} />}
    </div>
  );
}

/** Salesforce-style "Select fields to display": available fields on the left, visible fields (drag to order) on the right. */
function FieldsModal({ columns, visible, defaults, onClose, onApply }: { columns: Col[]; visible: string[]; defaults: string[]; onClose: () => void; onApply: (v: string[]) => void }) {
  const [v, setV] = useState(visible);
  const [q, setQ] = useState('');
  const dnd = useDragReorder('lv-fields', (from, to) => setV((x) => moveItem(x, from, to)));
  const label = (k: string) => columns.find((c) => c.key === k)?.label ?? k;
  const avail = columns.filter((c) => !v.includes(c.key) && c.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal opened onClose={onClose} title="Select fields to display" size="lg">
      <SimpleGrid cols={2} spacing="md">
        <div>
          <Text size="xs" fw={650} c="dimmed" mb={6}>AVAILABLE FIELDS</Text>
          <TextInput size="xs" placeholder="Search fields" leftSection={<IconSearch size={13} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} mb={6} />
          <ScrollArea h={340} className="lv-fieldbox">
            {avail.map((c) => <UnstyledButton key={c.key} className="lv-field" onClick={() => setV([...v, c.key])}><Text size="sm" style={{ flex: 1 }}>{c.label}</Text><IconPlus size={14} /></UnstyledButton>)}
            {!avail.length && <Text size="xs" c="dimmed" p="sm">All fields are shown.</Text>}
          </ScrollArea>
        </div>
        <div>
          <Text size="xs" fw={650} c="dimmed" mb={6}>VISIBLE FIELDS · drag to reorder</Text>
          <ScrollArea h={374} className="lv-fieldbox">
            {v.map((k, i) => (
              <div key={k} {...dnd.rowProps(i)} className={`lv-field on ${dnd.rowProps(i).className ?? ''}`}>
                <span className="drag-handle" {...dnd.handleProps(i)}><IconGripVertical size={15} /></span>
                <Text size="sm" style={{ flex: 1 }}>{label(k)}</Text>
                <ActionIcon size="sm" variant="subtle" color="gray" disabled={v.length <= 1} onClick={() => setV(v.filter((x) => x !== k))}><IconX size={13} /></ActionIcon>
              </div>
            ))}
          </ScrollArea>
        </div>
      </SimpleGrid>
      <Group justify="space-between" mt="md">
        <Button variant="subtle" color="gray" onClick={() => setV(defaults)}>Restore defaults</Button>
        <Group gap="xs"><Button variant="default" onClick={onClose}>Cancel</Button><Button onClick={() => onApply(v)}>Apply</Button></Group>
      </Group>
      <Text size="xs" c="dimmed" mt="xs">Applies to this list now. Use “Save” to keep it in the view.</Text>
    </Modal>
  );
}

/** Kanban board: one lane per value of a status / picklist field, with count and money total per lane. */
function Kanban<T extends Record<string, any>>({ rows, shown, columns, groupBy, cell, onRow }: { rows: T[]; shown: Col<T>[]; columns: Col<T>[]; groupBy: string; cell: (c: Col<T>, r: T) => ReactNode; onRow?: (r: T) => void }) {
  const g = columns.find((c) => c.key === groupBy)!;
  const lanes = [...new Set(rows.map((r) => String(getVal(g, r) ?? '') || '—'))];
  const moneyCol = shown.find((c) => c.type === 'money');
  const [title, ...rest] = shown.filter((c) => c.key !== groupBy && c.key !== '_actions' && !['status', 'badge'].includes(c.type ?? ''));
  return (
    <div className="kb">
      {lanes.map((lane) => {
        const items = rows.filter((r) => (String(getVal(g, r) ?? '') || '—') === lane);
        return (
          <div key={lane} className="kb-lane">
            <div className="kb-head">
              <Group gap={6} wrap="nowrap">{g.type === 'status' ? <StatusBadge status={lane} /> : <Text fw={600} size="sm">{lane}</Text>}<span className="cnt">{items.length}</span></Group>
              {moneyCol && <Text size="xs" c="dimmed" fw={600}>₹{money(items.reduce((a, r) => a + Number(getVal(moneyCol, r) ?? 0), 0))}</Text>}
            </div>
            <div className="kb-cards">
              {items.slice(0, 100).map((r, i) => (
                <div key={(r.id as string) ?? i} className={`kb-card${onRow ? ' row-click' : ''}`} onClick={onRow ? () => onRow(r) : undefined}>
                  <Text fw={620} size="sm" lineClamp={2}>{title ? cell(title, r) : ''}</Text>
                  {rest.slice(0, 3).map((c) => { const v = cell(c, r); return v === '' || v == null ? null : <Text key={c.key} size="xs" c="dimmed" lineClamp={1}><span style={{ color: 'var(--muted)' }}>{c.label}</span> <span style={{ color: 'var(--ink-2)' }}>{v}</span></Text>; })}
                </div>
              ))}
              {items.length > 100 && <Text size="xs" c="dimmed" ta="center">+{items.length - 100} more – filter to narrow down</Text>}
            </div>
          </div>
        );
      })}
      {!lanes.length && <Text c="dimmed" size="sm" p="lg">Nothing to show.</Text>}
    </div>
  );
}

function SaveViewModal({ mode, onClose, onSave, canShare, initial }: { mode: null | 'new' | 'rename'; onClose: () => void; onSave: (n: string, shared: boolean) => Promise<void> | void; canShare: boolean; initial?: { name: string; shared: boolean } }) {
  const [name, setName] = useState(''); const [shared, setShared] = useState(false); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (mode) { setName(initial?.name ?? ''); setShared(initial?.shared ?? false); setErr(null); } }, [mode]);
  const submit = async () => { setBusy(true); setErr(null); try { await onSave(name.trim(), shared); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <Modal opened={Boolean(mode)} onClose={onClose} title={mode === 'rename' ? 'Rename list view' : 'New list view'} size="sm">
      <Stack>
        <TextInput label="List name" placeholder="e.g. Unpaid NABL invoices" value={name} onChange={(e) => { setName(e.currentTarget.value); setErr(null); }} error={err} data-autofocus onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) submit(); }} />
        {canShare ? (
          <div>
            <Text size="sm" fw={500} mb={4}>Who sees this list view?</Text>
            <SegmentedControl fullWidth value={shared ? 'all' : 'me'} onChange={(v) => setShared(v === 'all')} data={[{ value: 'me', label: 'Only I can see it' }, { value: 'all', label: 'All users can see it' }]} />
          </div>
        ) : <Text size="xs" c="dimmed">Only you can see this view. Ask an administrator to share a view with everyone.</Text>}
        {mode === 'new' && <Text size="xs" c="dimmed">Saves the current search, filters, sort, fields and display (table or Kanban).</Text>}
        <Group justify="flex-end"><Button disabled={!name.trim()} loading={busy} onClick={submit}>Save</Button></Group>
      </Stack>
    </Modal>
  );
}

/** Columns for an object's custom fields, so they appear in lists, filters and exports automatically. */
export function useCustomCols(object: string): Col[] {
  const { meta } = useMeta();
  return meta.fields.filter((f) => f.object === object).map((f) => ({
    key: `custom.${f.key}`, label: f.label, hidden: true, value: (r: any) => r.custom?.[f.key] ?? r.data?.custom?.[f.key],
    type: f.type === 'currency' ? 'money' : f.type === 'number' || f.type === 'integer' ? 'number' : f.type === 'date' ? 'date' : f.type === 'picklist' ? 'picklist' : 'text',
  }));
}

/** Phone layout: one card per record – title, status badges and the next few fields. */
function CardList<T extends Record<string, any>>({ shown, rows, cell, onRow, loading, emptyText }: {
  shown: Col<T>[]; rows: T[]; cell: (c: Col<T>, r: T) => ReactNode; onRow?: (r: T) => void; loading: boolean; emptyText: ReactNode | null;
}) {
  const badges = shown.filter((c) => ['status', 'badge', 'picklist'].includes(c.type ?? ''));
  const plain = shown.filter((c) => !badges.includes(c) && c.key !== '_actions');
  const [title, ...rest] = plain;
  const actions = shown.find((c) => c.key === '_actions');
  if (loading) return <Stack p="sm" gap="xs">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 64, borderRadius: 10 }} />)}</Stack>;
  return (
    <div className="lv-cards">
      {rows.map((r, i) => (
        <div key={(r.id as string) ?? i} className={`lv-card${onRow ? ' row-click' : ''}`} onClick={onRow ? () => onRow(r) : undefined}>
          <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
            <Text fw={600} size="sm" style={{ minWidth: 0, wordBreak: 'break-word' }}>{title ? cell(title, r) : ''}</Text>
            <Group gap={4} wrap="nowrap">{badges.map((c) => <span key={c.key}>{cell(c, r)}</span>)}</Group>
          </Group>
          {rest.slice(0, 3).map((c) => { const v = cell(c, r); return v === '' || v === null || v === undefined ? null : <Text key={c.key} size="xs" c="dimmed" lineClamp={2}><span style={{ color: 'var(--muted)' }}>{c.label}</span> <span style={{ color: 'var(--ink-2)' }}>{v}</span></Text>; })}
          {actions && <div style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>{cell(actions, r)}</div>}
        </div>
      ))}
      {emptyText}
    </div>
  );
}
