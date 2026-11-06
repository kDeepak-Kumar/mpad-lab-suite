import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ActionIcon, Alert, Avatar, Badge, Button, FileButton, Grid, Group, Modal, Paper, Select, SimpleGrid, Stack, Tabs, Text, TextInput, Textarea, Tooltip } from '@mantine/core';
import { IconCamera, IconEye, IconLock, IconPencil, IconPlus, IconUsersPlus } from '@tabler/icons-react';
import { api, dmy, fileToDataUrl, ok, useApi } from '../api';
import { useCan } from '../ctx';
import { ListView, type Col } from '../components/ListView';
import { Loading, PageHeader } from '../components/ui';
import { Attachments } from '../components/Attachments';
import { AdminDelete, RecordInfo } from '../components/RecordAdmin';
import { MonthGrid } from './Attendance';

const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export function EmployeesPage() {
  const can = useCan();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { data, reload } = useApi<any[]>('/employees');
  const manage = can('manageEmployees');
  const cols: Col[] = [
    { key: 'name', label: 'Name', render: (r) => <Group gap={8} wrap="nowrap"><Avatar src={r.photo || null} radius="xl" size={30}>{initials(r.name)}</Avatar><div><Text size="sm" fw={600}>{r.name}</Text>{r.code && <Text size="xs" c="dimmed">{r.code}</Text>}</div></Group> },
    { key: 'designation', label: 'Designation', filter: 'select' }, { key: 'department', label: 'Department', filter: 'select' },
    { key: 'phone', label: 'Phone' }, { key: 'date_of_joining', label: 'Joined', type: 'date' },
    { key: 'login', label: 'App login', value: (r) => (r.login ? 'Yes' : 'No'), type: 'badge' },
    ...(manage ? [{ key: 'documents', label: 'Documents', type: 'number' as const }] : []),
    { key: 'status', label: 'Status', type: 'badge', value: (r) => (r.status === 'left' ? 'Left' : 'Active') },
  ];
  const fromUsers = async () => { const r = await api<{ created: number }>('/employees/from-users', { method: 'POST' }); ok(r.created ? `${r.created} profile(s) created from app users` : 'Every app user already has a profile'); reload(); };
  return (
    <>
      <PageHeader title="Employees" subtitle="Profiles, qualifications, ID documents and attendance"
        actions={manage && <Group gap="xs"><Button variant="default" leftSection={<IconUsersPlus size={16} />} onClick={fromUsers}>Add profiles for app users</Button><Button leftSection={<IconPlus size={16} />} onClick={() => setSp({ new: '1' })}>New employee</Button></Group>} />
      <ListView id="employees" rows={data ?? null} columns={cols} onRow={(r) => nav(`/employees/${r.id}`)} quickFilters={[{ label: 'Active', filters: [{ key: 'status', op: 'in', value: ['Active'] }] }]} empty="No employees yet. Add them, or create profiles for your app users in one click." />
      {sp.get('new') === '1' && <EmployeeForm onClose={(id) => { setSp({}); reload(); if (id) nav(`/employees/${id}`); }} />}
    </>
  );
}

export function EmployeeForm({ initial, onClose }: { initial?: any; onClose: (id?: number) => void }) {
  const { data: users } = useApi<any[]>('/users');
  const [v, setV] = useState<any>(initial ?? { status: 'active', id_type: 'Aadhaar' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const T = (k: string, label: string, props: any = {}) => <TextInput label={label} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.currentTarget.value })} {...props} />;
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const { id, user, canManage, has_id_number, documents, login, created_at, updated_at, data, company_id, ...body } = v;
      if (v.id) { await api(`/employees/${v.id}`, { method: 'PUT', body }); ok('Employee saved'); onClose(v.id); }
      else { const r = await api<{ id: number }>('/employees', { body }); ok('Employee added'); onClose(r.id); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal opened onClose={() => onClose()} title={v.id ? `Edit ${v.name}` : 'New employee'} size="xl">
      <Stack>
        <Group align="flex-start" wrap="nowrap">
          <Stack gap={4} align="center">
            <Avatar src={v.photo || null} size={84} radius={42}>{v.name ? initials(v.name) : <IconCamera />}</Avatar>
            <FileButton accept="image/png,image/jpeg,image/webp" onChange={async (f) => f && setV({ ...v, photo: await fileToDataUrl(f, 320) })}>{(p) => <Button size="compact-xs" variant="subtle" {...p}>{v.photo ? 'Change photo' : 'Add photo'}</Button>}</FileButton>
            {v.photo && <Button size="compact-xs" variant="subtle" color="red" onClick={() => setV({ ...v, photo: null })}>Remove</Button>}
          </Stack>
          <SimpleGrid cols={{ base: 1, sm: 2 }} style={{ flex: 1 }}>
            {T('name', 'Full name', { required: true, 'data-autofocus': true })}{T('code', 'Employee code')}{T('designation', 'Designation')}{T('department', 'Department')}
          </SimpleGrid>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          {T('date_of_joining', 'Date of joining', { type: 'date' })}{T('date_of_birth', 'Date of birth', { type: 'date' })}{T('blood_group', 'Blood group')}
          {T('phone', 'Phone')}{T('email', 'Email')}{T('emergency_contact', 'Emergency contact (name & phone)')}
        </SimpleGrid>
        <Textarea label="Qualifications" description="Degrees, diplomas, trainings and authorisations (e.g. B.E. Civil; NABL internal auditor training 2025)" autosize minRows={2} value={v.qualifications ?? ''} onChange={(e) => setV({ ...v, qualifications: e.currentTarget.value })} />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>{T('experience', 'Experience')}<Select label="App login (optional)" clearable searchable data={(users ?? []).map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))} value={v.user_id ? String(v.user_id) : null} onChange={(x) => setV({ ...v, user_id: x ? Number(x) : null })} description="Links the profile to the person's login so they can see their own attendance" /></SimpleGrid>
        <Textarea label="Address" autosize value={v.address ?? ''} onChange={(e) => setV({ ...v, address: e.currentTarget.value })} />
        <Paper withBorder p="sm" radius="md">
          <Group gap={6} mb={6}><IconLock size={14} /><Text size="sm" fw={600}>Identity (visible only to HR / administrators and the employee)</Text></Group>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Select label="ID type" data={['Aadhaar', 'Voter ID', 'Passport', 'Driving licence', 'Other']} value={v.id_type ?? null} onChange={(x) => setV({ ...v, id_type: x })} />
            {T('id_number', 'ID number', { description: v.id && v.has_id_number ? 'Shown masked; type a new number to change it' : undefined })}
            {T('pan', 'PAN')}
          </SimpleGrid>
        </Paper>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select label="Status" data={[{ value: 'active', label: 'Active' }, { value: 'left', label: 'Left the company' }]} value={v.status ?? 'active'} onChange={(x) => setV({ ...v, status: x })} allowDeselect={false} />
          {v.status === 'left' && T('left_on', 'Last working day', { type: 'date' })}
        </SimpleGrid>
        <Textarea label="Notes" autosize value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.currentTarget.value })} />
        {err && <Alert color="red" variant="light">{err}</Alert>}
        <Group justify="flex-end"><Button variant="default" onClick={() => onClose()}>Cancel</Button><Button loading={busy} disabled={!v.name?.trim()} onClick={save}>Save</Button></Group>
      </Stack>
    </Modal>
  );
}

/** One employee: profile, documents (ID proof, PAN, certificates) and attendance. /employees/me shows your own. */
export function EmployeeDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const me = id === 'me';
  const { data: e, reload } = useApi<any>(me ? '/employees/me' : `/employees/${id}`, [id]);
  const [edit, setEdit] = useState(false);
  const [full, setFull] = useState<string | null>(null);
  useEffect(() => setFull(null), [id]);
  if (e === null && me) return <><PageHeader title="My profile" /><Alert variant="light">No employee profile is linked to your login yet. Ask HR / an administrator.</Alert></>;
  if (!e) return <Loading />;
  const canManage = Boolean(e.canManage);
  const month = new Date().toISOString().slice(0, 7);
  const info: [string, any][] = [['Employee code', e.code], ['Designation', e.designation], ['Department', e.department], ['Joined', dmy(e.date_of_joining)], ['Date of birth', dmy(e.date_of_birth)], ['Blood group', e.blood_group],
    ['Phone', e.phone], ['Email', e.email], ['Emergency contact', e.emergency_contact], ['Experience', e.experience], ['App login', e.user ? `${e.user.name} (${e.user.email})` : '—']];
  return (
    <>
      <PageHeader eyebrow="Employee" title={<Group gap="sm"><Avatar src={e.photo || null} size={44} radius="xl">{initials(e.name)}</Avatar>{e.name}{e.status === 'left' && <Badge color="gray">Left {dmy(e.left_on)}</Badge>}</Group>}
        subtitle={[e.designation, e.department].filter(Boolean).join(' · ')}
        actions={canManage && <Group gap="xs"><Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setEdit(true)}>Edit</Button><AdminDelete object="employee" id={e.id} compact onDeleted={() => nav('/employees')} /></Group>} />
      <Tabs defaultValue="profile">
        <Tabs.List mb="md"><Tabs.Tab value="profile">Profile</Tabs.Tab><Tabs.Tab value="documents">Documents</Tabs.Tab><Tabs.Tab value="attendance">Attendance</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="profile">
          <Grid>
            <Grid.Col span={{ base: 12, md: 7 }}>
              <Paper withBorder p="md"><SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">{info.map(([k, v]) => <div key={k}><Text size="xs" c="dimmed">{k}</Text><Text size="sm">{v || '—'}</Text></div>)}</SimpleGrid>
                {e.address && <><Text size="xs" c="dimmed" mt="sm">Address</Text><Text size="sm" style={{ whiteSpace: 'pre-line' }}>{e.address}</Text></>}</Paper>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Paper withBorder p="md" mb="md"><Text size="xs" c="dimmed">Qualifications</Text><Text size="sm" style={{ whiteSpace: 'pre-line' }}>{e.qualifications || '—'}</Text></Paper>
              <Paper withBorder p="md">
                <Group gap={6} mb={6}><IconLock size={14} /><Text size="sm" fw={600}>Identity</Text></Group>
                <Group justify="space-between"><div><Text size="xs" c="dimmed">{e.id_type || 'ID'}</Text><Text size="sm" ff="monospace">{full ?? e.id_number ?? '—'}</Text></div>
                  {canManage && e.has_id_number && !full && <Tooltip label="Show the full number (recorded in the history)"><ActionIcon variant="light" onClick={async () => setFull((await api<any>(`/employees/${e.id}/reveal-id`, { method: 'POST' })).id_number)}><IconEye size={16} /></ActionIcon></Tooltip>}</Group>
                <Text size="xs" c="dimmed" mt={6}>PAN</Text><Text size="sm" ff="monospace">{e.pan || '—'}</Text>
              </Paper>
            </Grid.Col>
          </Grid>
          {e.notes && <Paper withBorder p="md" mt="md"><Text size="xs" c="dimmed">Notes</Text><Text size="sm" style={{ whiteSpace: 'pre-line' }}>{e.notes}</Text></Paper>}
          <RecordInfo object="employee" id={e.id} />
        </Tabs.Panel>
        <Tabs.Panel value="documents">
          <Alert variant="light" icon={<IconLock size={16} />} mb="md">ID documents are visible only to HR / administrators and {me ? 'you' : 'this employee'}. Files are compressed to under 1 MB; every view is recorded.</Alert>
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            {[['id', 'Aadhaar / ID proof'], ['pan', 'PAN card'], ['certificate', 'Qualification & training certificates'], ['other', 'Other documents (offer letter, address proof…)']].map(([k, t]) => (
              <Paper key={k} withBorder p="sm"><Attachments entity="employee" entityId={e.id} kind={k} title={t} readOnly={!canManage} emptyText="Nothing uploaded" onChange={reload} /></Paper>
            ))}
          </SimpleGrid>
        </Tabs.Panel>
        <Tabs.Panel value="attendance"><MonthGrid employeeId={e.id} initialMonth={month} /></Tabs.Panel>
      </Tabs>
      {edit && <EmployeeForm initial={e} onClose={(x) => { setEdit(false); if (x) reload(); }} />}
    </>
  );
}
