import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, FileButton, Group, Image, Modal, PasswordInput, Select, SimpleGrid, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { api, fileToDataUrl, ok, useApi } from '../../api';
import { useCan, useMe, useMeta, isAdmin } from '../../ctx';
import { PageHeader } from '../../components/ui';
import { ListView } from '../../components/ListView';

export function UsersSettings() {
  const { data, reload } = useApi<any[]>('/users');
  const [sp, setSp] = useSearchParams();
  const [edit, setEdit] = useState<any>(null);
  const me = useMe();
  const can = useCan();
  const nav = useNavigate();
  const { meta } = useMeta();
  const roleLabel = (k: string) => meta.roles.find((r) => r.key === k)?.label ?? k;
  useEffect(() => { if (sp.get('me') && data) { setEdit(data.find((u) => u.id === me.user.id)); setSp({}); } }, [sp, data]);
  return (
    <>
      <PageHeader title="Users" subtitle="Who can sign in and what their role allows. Roles and permissions are defined in Setup."
        actions={<>{can('manageCustomization') && <Button variant="default" onClick={() => nav('/setup?tab=roles')}>Roles & permissions</Button>}{can('manageUsers') && <Button onClick={() => setEdit({ role: 'technician', active: true })}>Add user</Button>}</>} />
      <ListView id="users" rows={data} onRow={(u) => (can('manageUsers') || u.id === me.user.id) && setEdit(u)} columns={[
        { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' },
        { key: 'role', label: 'Role', value: (u) => roleLabel(u.role), render: (u) => <Badge variant="light" color={u.role === 'admin' ? 'red' : 'brand'} style={{ textTransform: 'none' }}>{roleLabel(u.role)}</Badge>, filter: 'select' },
        { key: 'designation', label: 'Designation' }, { key: 'signature', label: 'Signature', value: (u) => (u.signature ? 'Uploaded' : '—') }, { key: 'active', label: 'Active', value: (u) => (u.active ? 'Yes' : 'No'), filter: 'select' }]} />
      {edit && <UserModal user={edit} canManage={can('manageUsers')} admin={isAdmin(me)} roles={meta.roles} onClose={(s) => { setEdit(null); if (s) reload(); }} />}
    </>
  );
}

function UserModal({ user, canManage, admin, roles, onClose }: { user: any; canManage: boolean; admin: boolean; roles: any[]; onClose: (saved: boolean) => void }) {
  const [v, setV] = useState<any>({ ...user, password: '' });
  const save = async () => {
    const body = { ...v }; if (!body.password) delete body.password; delete body.id;
    if (user.id) await api(`/users/${user.id}`, { method: 'PUT', body }); else await api('/users', { body });
    ok('User saved'); onClose(true);
  };
  const roleOptions = roles.filter((r) => admin || r.key !== 'admin').map((r) => ({ value: r.key, label: r.label }));
  return (
    <Modal opened onClose={() => onClose(false)} title={user.id ? `Edit ${user.name}` : 'Add user'} size="lg">
      <Stack>
        <SimpleGrid cols={2}>
          <TextInput label="Name" value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} />
          <TextInput label="Email (login)" value={v.email ?? ''} onChange={(e) => setV({ ...v, email: e.currentTarget.value })} />
          <Select label="Role" disabled={!canManage || (user.role === 'admin' && !admin)} data={roleOptions} value={v.role} onChange={(x) => setV({ ...v, role: x })} />
          <TextInput label="Designation" value={v.designation ?? ''} onChange={(e) => setV({ ...v, designation: e.currentTarget.value })} />
          <TextInput label="Phone" value={v.phone ?? ''} onChange={(e) => setV({ ...v, phone: e.currentTarget.value })} />
          <PasswordInput label={user.id ? 'New password (leave blank to keep)' : 'Initial password'} value={v.password} onChange={(e) => setV({ ...v, password: e.currentTarget.value })} />
        </SimpleGrid>
        {v.role === 'admin' && <Text size="xs" c="orange">System Administrators have full access and skip workflow checks (all actions are still logged).</Text>}
        <Textarea label="Qualifications (printed under the signature on reports)" autosize value={v.qualifications ?? ''} onChange={(e) => setV({ ...v, qualifications: e.currentTarget.value })} />
        <Group align="flex-end">
          <div>
            <Text size="sm" fw={500}>Signature image</Text>
            <Text size="xs" c="dimmed">Applied only when this user signs and issues a document</Text>
            {v.signature && <Image src={v.signature} h={50} w="auto" fit="contain" my={4} />}
          </div>
          <FileButton accept="image/png,image/jpeg" onChange={async (f) => f && setV({ ...v, signature: await fileToDataUrl(f, 400) })}>{(p) => <Button size="xs" variant="light" {...p}>Upload</Button>}</FileButton>
          {v.signature && <Button size="xs" variant="subtle" color="red" onClick={() => setV({ ...v, signature: null })}>Remove</Button>}
        </Group>
        {canManage && <Switch label="Active (can sign in)" checked={v.active !== false} onChange={(e) => setV({ ...v, active: e.currentTarget.checked })} />}
        <Group justify="flex-end"><Button onClick={save} disabled={!v.name || !v.email || (!user.id && (v.password ?? '').length < 6)}>Save</Button></Group>
      </Stack>
    </Modal>
  );
}
