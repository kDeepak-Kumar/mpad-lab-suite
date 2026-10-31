import { useState } from 'react';
import { Button, FileButton, Group, Image, Modal, PasswordInput, Select, SimpleGrid, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { ROLES } from '@suite/shared';
import { api, fileToDataUrl, ok, useApi } from '../../api';
import { useMe } from '../../App';
import { PageHeader, SimpleTable } from '../../components/ui';

export function UsersSettings() {
  const { data, reload } = useApi<any[]>('/users');
  const [edit, setEdit] = useState<any>(null);
  const me = useMe();
  return (
    <>
      <PageHeader title="Users & roles" subtitle="Who can do what. A technician cannot review their own observations; only signatories can sign reports."
        actions={me.user.role === 'owner' && <Button onClick={() => setEdit({ role: 'technician', active: true })}>Add user</Button>} />
      <SimpleTable head={['Name', 'Email', 'Role', 'Designation', 'Signature', 'Active']}
        rows={(data ?? []).map((u) => [u.name, u.email, ROLES.find((r) => r.key === u.role)?.label, u.designation, u.signature ? 'Uploaded' : '—', u.active ? 'Yes' : 'No'])}
        onRow={(i) => (me.user.role === 'owner' || data![i].id === me.user.id) && setEdit(data![i])} />
      {edit && <UserModal user={edit} isOwner={me.user.role === 'owner'} onClose={(s) => { setEdit(null); if (s) reload(); }} />}
    </>
  );
}

function UserModal({ user, isOwner, onClose }: { user: any; isOwner: boolean; onClose: (saved: boolean) => void }) {
  const [v, setV] = useState<any>({ ...user, password: '' });
  const save = async () => {
    const body = { ...v }; if (!body.password) delete body.password; delete body.id;
    if (user.id) await api(`/users/${user.id}`, { method: 'PUT', body }); else await api('/users', { body });
    ok('User saved'); onClose(true);
  };
  return (
    <Modal opened onClose={() => onClose(false)} title={user.id ? `Edit ${user.name}` : 'Add user'} size="lg">
      <Stack>
        <SimpleGrid cols={2}>
          <TextInput label="Name" value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} />
          <TextInput label="Email (login)" value={v.email ?? ''} onChange={(e) => setV({ ...v, email: e.currentTarget.value })} />
          <Select label="Role" disabled={!isOwner} data={ROLES.map((r) => ({ value: r.key, label: r.label }))} value={v.role} onChange={(x) => setV({ ...v, role: x })} />
          <TextInput label="Designation" value={v.designation ?? ''} onChange={(e) => setV({ ...v, designation: e.currentTarget.value })} />
          <TextInput label="Phone" value={v.phone ?? ''} onChange={(e) => setV({ ...v, phone: e.currentTarget.value })} />
          <PasswordInput label={user.id ? 'New password (leave blank to keep)' : 'Initial password'} value={v.password} onChange={(e) => setV({ ...v, password: e.currentTarget.value })} />
        </SimpleGrid>
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
        {isOwner && <Switch label="Active (can sign in)" checked={v.active !== false} onChange={(e) => setV({ ...v, active: e.currentTarget.checked })} />}
        <Group justify="flex-end"><Button onClick={save} disabled={!v.name || !v.email || (!user.id && (v.password ?? '').length < 6)}>Save</Button></Group>
      </Stack>
    </Modal>
  );
}
