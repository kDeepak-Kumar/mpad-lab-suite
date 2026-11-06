import { useState } from 'react';
import { ActionIcon, Alert, Button, Group, List, Modal, Stack, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconClockEdit, IconHistory, IconTrash } from '@tabler/icons-react';
import { api, invalidate, ok, useApi } from '../api';
import { isAdmin, useMe } from '../ctx';

export type BinObject = 'sample' | 'test' | 'quote' | 'invoice' | 'report' | 'client' | 'workorder' | 'payment' | 'equipment' | 'vendor' | 'purchase' | 'outsource' | 'activity' | 'catalog' | 'employee';

const fmt = (v?: string | null) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(+d) ? v : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const toLocalInput = (v?: string | null) => { if (!v) return ''; const d = new Date(v); if (Number.isNaN(+d)) return ''; const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

/** "Created … · Last modified …" footer shown on record pages. System Administrators can correct the dates (audited). */
export function RecordInfo({ object, id }: { object: string; id?: number | null }) {
  const { data, reload } = useApi<{ created_at: string; updated_at: string; created_by: string | null; modified_by: string | null; canEdit: boolean }>(id ? `/record-info/${object}/${id}` : null, [object, id]);
  const [edit, setEdit] = useState(false);
  if (!data) return null;
  return (
    <Group gap={6} mt="md" c="dimmed" className="record-info">
      <IconHistory size={14} />
      <Text size="xs">Created {fmt(data.created_at)}{data.created_by ? ` by ${data.created_by}` : ''} · Last modified {fmt(data.updated_at)}{data.modified_by ? ` by ${data.modified_by}` : ''}</Text>
      {data.canEdit && <Tooltip label="Correct these dates (administrators only, recorded in the audit trail)"><ActionIcon size="xs" variant="subtle" color="gray" onClick={() => setEdit(true)}><IconClockEdit size={13} /></ActionIcon></Tooltip>}
      {edit && <EditDates object={object} id={id!} created={data.created_at} updated={data.updated_at} onClose={(saved) => { setEdit(false); if (saved) reload(); }} />}
    </Group>
  );
}

function EditDates({ object, id, created, updated, onClose }: { object: string; id: number; created: string; updated: string; onClose: (saved: boolean) => void }) {
  const [c, setC] = useState(toLocalInput(created)); const [u, setU] = useState(toLocalInput(updated)); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api(`/record-info/${object}/${id}`, { method: 'PUT', body: { created_at: c ? new Date(c).toISOString() : undefined, updated_at: u ? new Date(u).toISOString() : undefined } }); ok('Record dates updated'); onClose(true); }
    catch { /* shown */ } finally { setBusy(false); }
  };
  return (
    <Modal opened onClose={() => onClose(false)} title="Correct record dates" size="sm">
      <Stack>
        <Text size="xs" c="dimmed">Use this when entering old records from paper. The change and the previous dates are kept in the audit trail.</Text>
        <TextInput type="datetime-local" label="Created" value={c} onChange={(e) => setC(e.currentTarget.value)} />
        <TextInput type="datetime-local" label="Last modified" value={u} onChange={(e) => setU(e.currentTarget.value)} />
        <Group justify="flex-end"><Button variant="default" onClick={() => onClose(false)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></Group>
      </Stack>
    </Modal>
  );
}

/** Delete button for System Administrators: shows what goes with the record, then moves it to the Recycle Bin. */
export function AdminDelete({ object, id, onDeleted, label = 'Delete', compact }: { object: BinObject; id: number; onDeleted?: () => void; label?: string; compact?: boolean }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  if (!isAdmin(me)) return null;
  return (
    <>
      {compact ? <Tooltip label="Delete (moves to the Recycle Bin)"><ActionIcon variant="subtle" color="red" onClick={(e) => { e.stopPropagation(); setOpen(true); }}><IconTrash size={16} /></ActionIcon></Tooltip>
        : <Button variant="light" color="red" leftSection={<IconTrash size={16} />} onClick={() => setOpen(true)}>{label}</Button>}
      {open && <DeleteModal object={object} id={id} onClose={(done) => { setOpen(false); if (done) { invalidate(); onDeleted?.(); } }} />}
    </>
  );
}

function DeleteModal({ object, id, onClose }: { object: BinObject; id: number; onClose: (done: boolean) => void }) {
  const { data, loading } = useApi<{ label: string; includes: string[]; blocked: string | null; keepDays: number }>(`/recycle/preview/${object}/${id}`, [object, id]);
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await api(`/recycle/${object}/${id}`, { method: 'DELETE', body: { reason: reason.trim() || null } }); ok(`${data?.label} moved to the Recycle Bin`); onClose(true); }
    catch { /* shown */ } finally { setBusy(false); }
  };
  return (
    <Modal opened onClose={() => onClose(false)} title={<Group gap={6}><IconTrash size={18} color="var(--mantine-color-red-6)" /><Text fw={650}>Delete {data?.label ?? 'record'}?</Text></Group>} size="md">
      {!data ? <Text size="sm" c="dimmed">{loading ? 'Checking related records…' : 'Could not check this record.'}</Text> : data.blocked ? (
        <Stack><Alert color="orange" icon={<IconAlertTriangle size={16} />} title="Cannot delete yet">{data.blocked}</Alert><Group justify="flex-end"><Button variant="default" onClick={() => onClose(false)}>Close</Button></Group></Stack>
      ) : (
        <Stack>
          <Text size="sm">It moves to the <b>Recycle Bin</b>. You can restore it within <b>{data.keepDays} days</b>; after that it is permanently deleted.</Text>
          {data.includes.length > 0 && <div><Text size="sm" fw={600}>Also moved with it:</Text><List size="sm">{data.includes.map((x) => <List.Item key={x}>{x}</List.Item>)}</List></div>}
          <Textarea label="Reason (kept in the audit trail)" placeholder="e.g. entered twice" value={reason} onChange={(e) => setReason(e.currentTarget.value)} autosize minRows={2} maxLength={500} />
          <Group justify="flex-end"><Button variant="default" onClick={() => onClose(false)}>Cancel</Button><Button color="red" loading={busy} onClick={go}>Move to Recycle Bin</Button></Group>
        </Stack>
      )}
    </Modal>
  );
}
