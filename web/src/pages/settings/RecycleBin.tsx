import { useState } from 'react';
import { Badge, Button, Group, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core';
import { IconLock, IconRecycle, IconRestore, IconTrashX } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { api, invalidate, ok, useApi } from '../../api';
import { isAdmin, useMe } from '../../ctx';
import { ListView, type Col } from '../../components/ListView';
import { Empty, PageHeader } from '../../components/ui';

interface BinRow { id: number; object: string; record_id: number; label: string; summary: string; deleted_at: string; purge_after: string; reason: string | null; restored_at: string | null; purged_at: string | null; deleted_by_name: string | null; restored_by_name: string | null }
const KIND: Record<string, string> = { sample: 'Sample', test: 'Observation sheet', quote: 'Quotation', invoice: 'Invoice', report: 'Test report', client: 'Client', workorder: 'Work order', payment: 'Payment', equipment: 'Equipment', vendor: 'Vendor', purchase: 'Vendor bill', outsource: 'Outsourced job', activity: 'Follow-up', catalog: 'Rate card item' };
const LINK: Record<string, (id: number) => string> = { sample: (id) => `/samples/${id}`, quote: (id) => `/documents/${id}`, invoice: (id) => `/documents/${id}`, report: (id) => `/documents/${id}`, client: (id) => `/clients/${id}`, workorder: (id) => `/workorders/${id}` };
const when = (v?: string | null) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const daysLeft = (v: string) => Math.max(0, Math.ceil((new Date(v).getTime() - Date.now()) / 86400000));
const state = (r: BinRow) => (r.purged_at ? 'Permanently deleted' : r.restored_at ? 'Restored' : 'In Recycle Bin');

export function RecycleBinPage() {
  const me = useMe();
  const nav = useNavigate();
  const { data, reload } = useApi<{ rows: BinRow[]; keepDays: number }>(isAdmin(me) ? '/recycle' : null);
  const [busy, setBusy] = useState<number | null>(null);
  if (!isAdmin(me)) return <Empty title="Recycle Bin is for System Administrators" icon={<IconLock size={22} />}>Ask a System Administrator to restore a deleted record.</Empty>;

  const restore = async (r: BinRow) => {
    setBusy(r.id);
    try { await api(`/recycle/${r.id}/restore`, { method: 'POST' }); ok(`${r.label} restored`); invalidate(); reload(); } catch { /* shown */ } finally { setBusy(null); }
  };
  const purge = async (r: BinRow) => {
    if (!window.confirm(`Permanently delete ${r.label}? This cannot be undone.`)) return;
    setBusy(r.id);
    try { await api(`/recycle/bin/${r.id}`, { method: 'DELETE' }); ok('Permanently deleted'); reload(); } catch { /* shown */ } finally { setBusy(null); }
  };
  const setDays = async (d: string) => { await api('/recycle/settings', { method: 'PUT', body: { days: Number(d) } }); ok(`Deleted records are now kept ${d} days`); reload(); };

  const cols: Col<BinRow>[] = [
    { key: 'label', label: 'Record', render: (r) => <Stack gap={0}><Text size="sm" fw={600}>{r.label}</Text>{r.summary && <Text size="xs" c="dimmed">with {r.summary}</Text>}</Stack> },
    { key: 'object', label: 'Type', type: 'badge', value: (r) => KIND[r.object] ?? r.object },
    { key: 'state', label: 'Status', type: 'badge', value: state, render: (r) => <Badge size="sm" variant="light" color={r.purged_at ? 'gray' : r.restored_at ? 'teal' : 'orange'} style={{ textTransform: 'none' }}>{state(r)}</Badge> },
    { key: 'deleted_at', label: 'Deleted', type: 'date', value: (r) => r.deleted_at.slice(0, 10), render: (r) => <Text size="sm">{when(r.deleted_at)}{r.deleted_by_name ? <Text span size="xs" c="dimmed"> · {r.deleted_by_name}</Text> : null}</Text> },
    { key: 'reason', label: 'Reason' },
    { key: 'purge_after', label: 'Kept until', type: 'date', value: (r) => r.purge_after.slice(0, 10), render: (r) => (r.restored_at || r.purged_at ? <Text size="xs" c="dimmed">{r.restored_at ? `Restored ${when(r.restored_at)}${r.restored_by_name ? ` by ${r.restored_by_name}` : ''}` : when(r.purged_at)}</Text> : <Text size="sm">{when(r.purge_after).slice(0, 11)} <Text span size="xs" c={daysLeft(r.purge_after) < 5 ? 'red' : 'dimmed'}>({daysLeft(r.purge_after)} days left)</Text></Text>) },
    { key: '_actions', label: '', render: (r) => (r.restored_at || r.purged_at ? (r.restored_at && LINK[r.object] ? <Button size="compact-xs" variant="subtle" onClick={(e) => { e.stopPropagation(); nav(LINK[r.object](r.record_id)); }}>Open</Button> : null) : (
      <Group gap={4} wrap="nowrap" onClick={(e) => e.stopPropagation()}>
        <Button size="compact-xs" leftSection={<IconRestore size={14} />} loading={busy === r.id} onClick={() => restore(r)}>Restore</Button>
        <Tooltip label="Delete forever"><Button size="compact-xs" variant="subtle" color="red" onClick={() => purge(r)}><IconTrashX size={14} /></Button></Tooltip>
      </Group>)) },
  ];

  return (
    <Stack>
      <PageHeader title="Recycle Bin" eyebrow="Administration" subtitle="Deleted records with everything that belonged to them. Restore brings them back with the same numbers; after the retention period they are deleted for good."
        actions={<Group gap="xs"><Text size="sm" c="dimmed">Keep deleted records</Text>
          <SegmentedControl size="xs" value={String(data?.keepDays ?? 30)} onChange={setDays} data={[{ value: '30', label: '30 days' }, { value: '60', label: '60 days' }]} /></Group>} />
      <ListView id="recycle" rows={data?.rows ?? null} loading={!data} columns={cols} quickFilters={[{ label: 'In Recycle Bin', filters: [{ key: 'state', op: 'in', value: ['In Recycle Bin'] }] }]}
        empty={<Group gap={6} justify="center"><IconRecycle size={16} /> Nothing has been deleted.</Group>} />
    </Stack>
  );
}
