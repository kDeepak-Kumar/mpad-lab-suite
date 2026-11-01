import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActionIcon, Badge, Button, Checkbox, Group, Menu, MultiSelect, Pagination, Paper, Popover, Select, Stack, Text, TextInput, Tooltip, Modal, Switch } from '@mantine/core';
import { IconAdjustmentsHorizontal, IconArrowDown, IconArrowUp, IconColumns3, IconDeviceFloppy, IconDownload, IconFilter, IconSearch, IconTrash, IconX } from '@tabler/icons-react';
import { api, dmy, downloadCsv, money, ok } from '../api';
import { useCan, useMe, useMeta } from '../ctx';
import { StatusBadge } from './ui';

export type ColType = 'text' | 'money' | 'number' | 'date' | 'status' | 'badge' | 'picklist';
export interface Col<T = any> {
  key: string; label: string; type?: ColType; width?: number; align?: 'left' | 'right' | 'center';
  value?: (r: T) => unknown;            // value used for filter/sort/export
  render?: (r: T) => ReactNode;          // custom cell
  filter?: 'text' | 'select' | 'date' | 'number';
  hidden?: boolean;                      // not shown by default
}
interface Filter { key: string; op: 'contains' | 'in' | 'from' | 'to' | 'min' | 'max'; value: any }
interface ViewDef { name: string; filters: Filter[]; columns?: string[]; sort?: { key: string; dir: 1 | -1 }; search?: string }

const getVal = (c: Col, r: any) => (c.value ? c.value(r) : r[c.key]);

/**
 * Salesforce-style list view: search, per-column filters, sorting, column chooser, saved views
 * (personal or shared by admins) and export of exactly what is on screen.
 */
export function ListView<T extends Record<string, any>>({ id, rows, columns, onRow, loading, actions, empty, pageSize = 50, quickFilters }: {
  id: string; rows: T[] | null; columns: Col<T>[]; onRow?: (r: T) => void; loading?: boolean; actions?: ReactNode; empty?: ReactNode; pageSize?: number;
  quickFilters?: { label: string; filters: Filter[] }[];
}) {
  const { meta, reload: reloadMeta } = useMeta();
  const me = useMe();
  const can = useCan();
  const saved = meta.listviews.filter((v) => v.key.startsWith(`${id}:`));
  const [view, setView] = useState<string>('__all');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [visible, setVisible] = useState<string[]>(columns.filter((c) => !c.hidden).map((c) => c.key));
  const [page, setPage] = useState(1);
  const [saveOpen, setSaveOpen] = useState(false);

  useEffect(() => {
    const v = saved.find((x) => x.key === view)?.data as ViewDef | undefined;
    if (v) { setFilters(v.filters ?? []); setSort(v.sort ?? null); setSearch(v.search ?? ''); if (v.columns?.length) setVisible(v.columns); }
    else if (view === '__all') { setFilters([]); setSort(null); setSearch(''); setVisible(columns.filter((c) => !c.hidden).map((c) => c.key)); }
    setPage(1);
  }, [view]);

  const shown = columns.filter((c) => visible.includes(c.key));
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
      case 'badge': case 'picklist': return v ? <Badge variant="light" color={v === 'NABL' ? 'teal' : 'gray'} size="sm" style={{ textTransform: 'none' }}>{String(v)}</Badge> : '';
      default: return v === null || v === undefined ? '' : String(v);
    }
  };
  const distinct = (c: Col<T>) => [...new Set((rows ?? []).map((r) => String(getVal(c, r) ?? '')).filter(Boolean))].sort().slice(0, 200);
  const filterKind = (c: Col<T>) => c.filter ?? (c.type === 'date' ? 'date' : c.type === 'money' || c.type === 'number' ? 'number' : c.type === 'status' || c.type === 'badge' || c.type === 'picklist' ? 'select' : 'text');

  const saveView = async (name: string, shared: boolean) => {
    const key = `${id}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    await api(`/meta/listview/${encodeURIComponent(key)}`, { method: 'PUT', body: { name, filters, columns: visible, sort, search, shared } });
    ok(`View “${name}” saved`); reloadMeta(); setView(key); setSaveOpen(false);
  };

  return (
    <Paper withBorder radius="lg" style={{ overflow: 'hidden' }}>
      <Group p="sm" gap="xs" justify="space-between" style={{ borderBottom: '1px solid var(--line)' }} wrap="wrap">
        <Group gap="xs" wrap="wrap">
          <Select size="xs" w={190} value={view} onChange={(v) => setView(v ?? '__all')} allowDeselect={false}
            data={[{ value: '__all', label: 'All records' }, ...saved.map((v) => ({ value: v.key, label: `${v.data.name}${v.owner_id ? '' : ' (shared)'}` }))]} />
          <TextInput size="xs" w={220} placeholder="Search this list" leftSection={<IconSearch size={14} />} value={search} onChange={(e) => { setSearch(e.currentTarget.value); setPage(1); }}
            rightSection={search ? <ActionIcon size="xs" variant="subtle" onClick={() => setSearch('')}><IconX size={12} /></ActionIcon> : null} />
          {quickFilters?.map((q) => <Button key={q.label} size="compact-xs" variant={JSON.stringify(filters) === JSON.stringify(q.filters) ? 'filled' : 'light'} onClick={() => setFilters(JSON.stringify(filters) === JSON.stringify(q.filters) ? [] : q.filters)}>{q.label}</Button>)}
          <Popover width={340} position="bottom-start" shadow="lg">
            <Popover.Target><Button size="compact-sm" variant={filters.length ? 'light' : 'default'} leftSection={<IconFilter size={14} />}>Filters{filters.length ? ` (${filters.length})` : ''}</Button></Popover.Target>
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
          {filters.map((f) => {
            const c = columns.find((x) => x.key === f.key);
            const label = f.op === 'in' ? f.value.join(', ') : f.op === 'contains' ? `“${f.value}”` : `${{ from: '≥', to: '≤', min: '≥', max: '≤' }[f.op as 'from']} ${f.op === 'from' || f.op === 'to' ? dmy(f.value) : f.value}`;
            return <Badge key={f.key + f.op} variant="light" size="lg" style={{ textTransform: 'none', fontWeight: 500 }} rightSection={<IconX size={12} style={{ cursor: 'pointer' }} onClick={() => setFilters((fs) => fs.filter((x) => x !== f))} />}>{c?.label}: {label}</Badge>;
          })}
        </Group>
        <Group gap={6}>
          <Text size="xs" c="dimmed">{filtered.length} of {rows?.length ?? 0}</Text>
          <Menu shadow="lg" closeOnItemClick={false}>
            <Menu.Target><Tooltip label="Columns"><ActionIcon variant="default" size="md"><IconColumns3 size={16} /></ActionIcon></Tooltip></Menu.Target>
            <Menu.Dropdown>{columns.map((c) => <Menu.Item key={c.key}><Checkbox size="xs" label={c.label} checked={visible.includes(c.key)} onChange={(e) => setVisible((v) => (e.currentTarget.checked ? [...v, c.key] : v.filter((x) => x !== c.key)))} /></Menu.Item>)}</Menu.Dropdown>
          </Menu>
          <Menu shadow="lg">
            <Menu.Target><Tooltip label="List view options"><ActionIcon variant="default" size="md"><IconAdjustmentsHorizontal size={16} /></ActionIcon></Tooltip></Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconDeviceFloppy size={14} />} onClick={() => setSaveOpen(true)}>Save as new view…</Menu.Item>
              {view !== '__all' && (saved.find((v) => v.key === view)?.owner_id === me.user.id || can('manageCustomization')) &&
                <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={async () => { await api(`/meta/listview/${encodeURIComponent(view)}`, { method: 'DELETE' }); reloadMeta(); setView('__all'); }}>Delete this view</Menu.Item>}
            </Menu.Dropdown>
          </Menu>
          <Button size="compact-sm" variant="default" leftSection={<IconDownload size={14} />} onClick={exportRows}>Export</Button>
          {actions}
        </Group>
      </Group>
      <div className="lv-scroll">
        <table className="lv-table">
          <thead><tr>{shown.map((c) => (
            <th key={c.key} className={c.key !== '_actions' ? 'sortable' : undefined} style={{ width: c.width, textAlign: c.align ?? (c.type === 'money' || c.type === 'number' ? 'right' : 'left') }}
              onClick={() => c.key !== '_actions' && setSort((s) => (s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))}>
              {c.label}{sort?.key === c.key && (sort.dir === 1 ? <IconArrowUp size={12} style={{ verticalAlign: -2, marginLeft: 3 }} /> : <IconArrowDown size={12} style={{ verticalAlign: -2, marginLeft: 3 }} />)}
            </th>))}</tr></thead>
          <tbody>
            {loading && !rows && Array.from({ length: 6 }).map((_, i) => <tr key={i}>{shown.map((c) => <td key={c.key}><div style={{ height: 12, borderRadius: 4, background: '#eef1f5', width: `${50 + ((i * 17 + c.key.length * 7) % 45)}%` }} /></td>)}</tr>)}
            {pageRows.map((r, i) => (
              <tr key={(r.id as string) ?? i} className={onRow ? 'row-click' : undefined} onClick={onRow ? () => onRow(r) : undefined}>
                {shown.map((c) => <td key={c.key} style={{ textAlign: c.align ?? (c.type === 'money' || c.type === 'number' ? 'right' : 'left'), fontVariantNumeric: c.type === 'money' || c.type === 'number' ? 'tabular-nums' : undefined, whiteSpace: ['badge', 'status', 'picklist', 'money', 'date'].includes(c.type ?? '') ? 'nowrap' : undefined }}>{cell(c, r)}</td>)}
              </tr>
            ))}
            {rows && !filtered.length && <tr><td colSpan={shown.length}><Text c="dimmed" ta="center" size="sm" p="lg">{rows.length ? 'No records match these filters.' : empty ?? 'Nothing here yet.'}</Text></td></tr>}
          </tbody>
          {totalsCols.length > 0 && filtered.length > 1 && (
            <tfoot><tr>{shown.map((c, i) => <td key={c.key} style={{ padding: '9px 12px', fontWeight: 650, textAlign: c.type === 'money' ? 'right' : 'left', background: '#f9fafb', borderTop: '1px solid var(--line)' }}>
              {c.type === 'money' ? `₹${money(filtered.reduce((a, r) => a + Number(getVal(c, r) ?? 0), 0))}` : i === 0 ? 'Total' : ''}</td>)}</tr></tfoot>
          )}
        </table>
      </div>
      {pages > 1 && <Group justify="center" p="xs" style={{ borderTop: '1px solid var(--line)' }}><Pagination size="sm" total={pages} value={page} onChange={setPage} /></Group>}
      <SaveViewModal opened={saveOpen} onClose={() => setSaveOpen(false)} onSave={saveView} canShare={can('manageCustomization')} />
    </Paper>
  );
}

function SaveViewModal({ opened, onClose, onSave, canShare }: { opened: boolean; onClose: () => void; onSave: (n: string, shared: boolean) => void; canShare: boolean }) {
  const [name, setName] = useState(''); const [shared, setShared] = useState(false);
  return (
    <Modal opened={opened} onClose={onClose} title="Save list view" size="sm">
      <Stack>
        <TextInput label="View name" placeholder="e.g. Unpaid NABL invoices" value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
        {canShare && <Switch label="Share with everyone" checked={shared} onChange={(e) => setShared(e.currentTarget.checked)} />}
        <Text size="xs" c="dimmed">Saves the current search, filters, sort and columns.</Text>
        <Group justify="flex-end"><Button disabled={!name.trim()} onClick={() => onSave(name.trim(), shared)}>Save view</Button></Group>
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
