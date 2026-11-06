import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ActionIcon, Badge, Button, Group, Modal, Paper, Select, SimpleGrid, Stack, Tabs, Text, TextInput, Textarea, Tooltip } from '@mantine/core';
import { IconCheck, IconPhone, IconPlus, IconRotate, IconBrandWhatsapp } from '@tabler/icons-react';
import { api, dmy, localToday, ok, useApi } from '../api';
import { useMe } from '../App';
import { PageHeader } from '../components/ui';
import { ListView } from '../components/ListView';

/** Activity type label; WhatsApp messages get the green WhatsApp mark. */
function TypeTag({ type, size = 'md' }: { type: string; size?: 'sm' | 'md' }) {
  return type === 'WhatsApp' ? <Badge size={size} variant="light" color="#25D366" styles={{ label: { color: '#128C7E' } }} leftSection={<IconBrandWhatsapp size={12} />}>WhatsApp</Badge> : <Badge size={size} variant="light">{type}</Badge>;
}
const TYPES = ['Call', 'Visit', 'Email', 'WhatsApp', 'Meeting', 'Task', 'Note'];
const LINKS: Record<string, string> = { quote: '/documents/', invoice: '/documents/', report: '/documents/', sample: '/samples' };

export function FollowUpsPage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'mine';
  const q = tab === 'mine' ? '?mine=1&open=1' : tab === 'open' ? '?open=1' : '';
  const { data, reload } = useApi<any[]>(`/activities${q}`, [tab]);
  const [add, setAdd] = useState(() => sp.get('new') === '1');
  const td = localToday();
  const nav = useNavigate();
  const rows = (data ?? []).filter((a) => tab !== 'done' || a.done_at);
  return (
    <>
      <PageHeader title="Follow-ups" subtitle="Calls, visits and tasks for clients. Quotations get a follow-up call automatically when sent."
        actions={<Button leftSection={<IconPlus size={16} />} onClick={() => setAdd(true)}>New follow-up</Button>} />
      <Tabs value={tab} onChange={(t) => setSp({ tab: t ?? 'mine' })} mb="sm">
        <Tabs.List><Tabs.Tab value="mine">My open</Tabs.Tab><Tabs.Tab value="open">All open</Tabs.Tab><Tabs.Tab value="done">Completed</Tabs.Tab><Tabs.Tab value="all">All</Tabs.Tab></Tabs.List>
      </Tabs>
      <ListView id={`followups-${tab}`} rows={rows} onRow={(a) => a.client_id && nav(`/clients/${a.client_id}?tab=activity`)} columns={[
        { key: 'due_date', label: 'Due', type: 'date', render: (a) => <Text size="sm" c={!a.done_at && a.due_date && a.due_date < td ? 'red' : !a.done_at && a.due_date === td ? 'orange' : undefined} fw={!a.done_at && a.due_date && a.due_date <= td ? 600 : undefined}>{dmy(a.due_date) || '—'}</Text> },
        { key: 'type', label: 'Type', filter: 'select', render: (a) => <TypeTag type={a.type} /> },
        { key: 'subject', label: 'Subject', render: (a) => <><Text size="sm" fw={550}>{a.subject}</Text>{a.notes && <Text size="xs" c="dimmed" lineClamp={1}>{a.notes}</Text>}</> },
        { key: 'client_name', label: 'Client', filter: 'select' },
        { key: 'assignee', label: 'Assigned to', filter: 'select' },
        { key: 'status', label: 'Status', value: (a) => (a.done_at ? 'Done' : a.due_date && a.due_date < td ? 'Overdue' : 'Open'), render: (a) => <Group gap={6} wrap="nowrap">
          {a.done_at ? <Badge color="teal" variant="light">Done</Badge> : <Badge color={a.due_date && a.due_date < td ? 'red' : 'blue'} variant="light">{a.due_date && a.due_date < td ? 'Overdue' : 'Open'}</Badge>}
          {a.link_kind && LINKS[a.link_kind] && <Button size="compact-xs" variant="subtle" onClick={(e) => { e.stopPropagation(); nav(`${LINKS[a.link_kind]}${a.link_kind === 'sample' ? '' : a.link_id}`); }}>Open {a.link_kind}</Button>}
          <DoneButton a={a} onDone={reload} />
        </Group> },
      ]} />
      {add && <ActivityModal onClose={(s) => { setAdd(false); if (s) reload(); }} />}
    </>
  );
}

function DoneButton({ a, onDone }: { a: any; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [next, setNext] = useState('');
  if (a.done_at) return <Tooltip label="Reopen"><ActionIcon size="sm" variant="subtle" onClick={async (e) => { e.stopPropagation(); await api(`/activities/${a.id}`, { method: 'PUT', body: { done: false } }); onDone(); }}><IconRotate size={14} /></ActionIcon></Tooltip>;
  return (
    <>
      <Tooltip label="Mark done"><ActionIcon size="sm" color="teal" variant="light" onClick={(e) => { e.stopPropagation(); setOpen(true); }}><IconCheck size={14} /></ActionIcon></Tooltip>
      <Modal opened={open} onClose={() => setOpen(false)} title={`Complete: ${a.subject}`} onClick={(e) => e.stopPropagation()}>
        <Stack>
          <TextInput label="Outcome" placeholder="e.g. Client confirmed, PO expected on Monday" value={outcome} onChange={(e) => setOutcome(e.currentTarget.value)} data-autofocus />
          <TextInput type="date" label="Schedule the next follow-up (optional)" value={next} onChange={(e) => setNext(e.currentTarget.value)} />
          <Group justify="flex-end"><Button onClick={async () => {
            await api(`/activities/${a.id}`, { method: 'PUT', body: { done: true, outcome: outcome || null } });
            if (next) await api('/activities', { body: { type: a.type === 'Note' ? 'Call' : a.type, subject: a.subject, client_id: a.client_id, due_date: next, link_kind: a.link_kind, link_id: a.link_id, notes: outcome ? `Previous: ${outcome}` : null } });
            ok('Follow-up completed'); setOpen(false); onDone();
          }}>Mark done</Button></Group>
        </Stack>
      </Modal>
    </>
  );
}

export function ActivityModal({ clientId, link, onClose }: { clientId?: number; link?: { kind: string; id: number }; onClose: (saved: boolean) => void }) {
  const { data: clients } = useApi<any[]>('/clients');
  const { data: users } = useApi<any[]>('/users');
  const me = useMe();
  const [v, setV] = useState<any>({ type: 'Call', subject: '', notes: '', client_id: clientId ?? null, due_date: localToday(), assigned_to: me.user.id });
  const save = async () => {
    await api('/activities', { body: { ...v, due_date: v.type === 'Note' ? null : v.due_date || null, link_kind: link?.kind ?? null, link_id: link?.id ?? null } });
    ok(v.type === 'Note' ? 'Note added' : 'Follow-up scheduled'); onClose(true);
  };
  return (
    <Modal opened onClose={() => onClose(false)} title="New follow-up / note" size="lg">
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select label="Type" data={TYPES} value={v.type} onChange={(x) => setV({ ...v, type: x ?? 'Call' })} allowDeselect={false} />
          <Select label="Client" searchable clearable data={(clients ?? []).map((c) => ({ value: String(c.id), label: c.name }))} value={v.client_id ? String(v.client_id) : null} onChange={(x) => setV({ ...v, client_id: x ? Number(x) : null })} disabled={!!clientId} />
        </SimpleGrid>
        <TextInput label="Subject" required placeholder="e.g. Discuss NDT scope for Tower B" value={v.subject} onChange={(e) => setV({ ...v, subject: e.currentTarget.value })} data-autofocus />
        <Textarea label="Notes" autosize minRows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.currentTarget.value })} />
        {v.type !== 'Note' && <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput type="date" label="Due date" value={v.due_date ?? ''} onChange={(e) => setV({ ...v, due_date: e.currentTarget.value })} />
          <Select label="Assign to" data={(users ?? []).filter((u) => u.active !== false).map((u) => ({ value: String(u.id), label: u.name }))} value={String(v.assigned_to)} onChange={(x) => setV({ ...v, assigned_to: x ? Number(x) : me.user.id })} />
        </SimpleGrid>}
        <Group justify="flex-end"><Button disabled={v.subject.trim().length < 2} onClick={save}>{v.type === 'Note' ? 'Add note' : 'Schedule'}</Button></Group>
      </Stack>
    </Modal>
  );
}

/** Activity list for a client (used on the client page). */
export function ClientActivity({ clientId }: { clientId: number }) {
  const { data, reload } = useApi<any[]>(`/activities?client_id=${clientId}`, [clientId]);
  const [add, setAdd] = useState(false);
  const td = localToday();
  return (
    <Paper withBorder p="md">
      <Group justify="space-between" mb="sm"><Text fw={600}>Follow-ups and notes</Text><Button size="xs" leftSection={<IconPhone size={14} />} onClick={() => setAdd(true)}>Log call / schedule follow-up</Button></Group>
      <Stack gap={8}>
        {(data ?? []).map((a) => (
          <Group key={a.id} justify="space-between" align="flex-start" wrap="nowrap" style={{ borderBottom: '1px solid #eef0f3', paddingBottom: 6 }}>
            <div>
              <Group gap={6}><TypeTag type={a.type} size="sm" /><Text size="sm" fw={550}>{a.subject}</Text></Group>
              {a.notes && <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-line' }} lineClamp={a.type === 'WhatsApp' ? 3 : undefined} title={a.notes}>{a.notes}</Text>}
              {a.outcome && <Text size="xs">Outcome: {a.outcome}</Text>}
              <Text size="xs" c="dimmed">{a.created_by_name} · {new Date(a.created_at).toLocaleDateString('en-IN')}{a.assignee && a.assignee !== a.created_by_name ? ` · for ${a.assignee}` : ''}</Text>
            </div>
            <Group gap={6} wrap="nowrap">
              {a.due_date && <Text size="xs" c={!a.done_at && a.due_date < td ? 'red' : 'dimmed'}>{a.done_at ? 'Done' : `Due ${dmy(a.due_date)}`}</Text>}
              {a.type !== 'Note' && <DoneButton a={a} onDone={reload} />}
            </Group>
          </Group>
        ))}
        {!data?.length && <Text size="sm" c="dimmed">No follow-ups yet.</Text>}
      </Stack>
      {add && <ActivityModal clientId={clientId} onClose={(s) => { setAdd(false); if (s) reload(); }} />}
    </Paper>
  );
}
