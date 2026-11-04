import { useState } from 'react';
import { Alert, Badge, Button, Group, Modal, SegmentedControl, Select, Stack, Table, Text, ActionIcon, Tooltip } from '@mantine/core';
import { IconLock, IconShare2, IconTrash, IconUserCircle, IconUsersGroup, IconEye, IconPencil } from '@tabler/icons-react';
import { OWD_OPTIONS } from '@suite/shared';
import { api, ok, useApi } from '../api';
import { useMeta } from '../ctx';

/** "Sharing" button on client / quotation / invoice pages; shows a lock when the record is read-only for you. */
export function SharingButton({ access, onClick }: { access?: string; onClick: () => void }) {
  return (
    <Tooltip label={access === 'read' ? 'Read-only for you – open to see who can edit' : 'Owner, and who else can see or edit this record'}>
      <Button variant="default" leftSection={access === 'read' ? <IconLock size={16} /> : <IconShare2 size={16} />} onClick={onClick}>{access === 'read' ? 'Read only' : 'Sharing'}</Button>
    </Tooltip>
  );
}

export function SharingModal({ object, id, title, onClose }: { object: string; id: number; title: string; onClose: (changed: boolean) => void }) {
  const { data, reload } = useApi<any>(`/sharing/${object}/${id}`, [object, id]);
  const { meta } = useMeta();
  const [who, setWho] = useState<string | null>(null);
  const [access, setAccess] = useState<'read' | 'edit'>('read');
  const [changed, setChanged] = useState(false);
  if (!data) return null;
  const owd = OWD_OPTIONS.find((o) => o.value === data.owd);
  const roleLabel = (k: string) => meta.roles.find((r) => r.key === k)?.label ?? k;
  const add = async () => {
    if (!who) return;
    const [kind, val] = who.split(':');
    await api(`/sharing/${object}/${id}`, { body: kind === 'u' ? { user_id: Number(val), access } : { role: val, access } });
    ok('Shared'); setWho(null); setChanged(true); reload();
  };
  return (
    <Modal opened onClose={() => onClose(changed)} title={<Group gap={8}><IconShare2 size={18} /><Text fw={600}>Sharing · {title}</Text></Group>} size="lg">
      <Stack>
        <Alert variant="light" color={data.owd === 'private' ? 'grape' : 'blue'} p="sm" icon={data.owd === 'private' ? <IconLock size={18} /> : <IconUsersGroup size={18} />}>
          <Text size="sm"><b>Default for this object: {owd?.label}.</b> {owd?.hint}. Change it in Setup → Sharing & visibility.</Text>
        </Alert>
        <Group justify="space-between">
          <Group gap={8}><IconUserCircle size={20} color="#667085" /><div><Text size="xs" c="dimmed">Owner</Text><Text fw={600}>{data.owner?.name ?? 'No owner'}</Text></div></Group>
          {data.canManage && <Select size="xs" w={220} placeholder="Change owner…" data={data.users.map((u: any) => ({ value: String(u.id), label: u.name }))} value={null} searchable
            onChange={async (v) => { if (!v) return; await api(`/sharing/${object}/${id}/owner`, { method: 'PUT', body: { owner_id: Number(v) } }); ok('Owner changed'); setChanged(true); reload(); }} />}
        </Group>
        <div>
          <Text fw={600} size="sm" mb={6}>Shared with</Text>
          {data.shares.length ? (
            <Table verticalSpacing={6}><Table.Tbody>
              {data.shares.map((s: any) => (
                <Table.Tr key={s.id}>
                  <Table.Td>{s.user_id ? <Group gap={6}><IconUserCircle size={16} />{s.name}</Group> : <Group gap={6}><IconUsersGroup size={16} />All {roleLabel(s.role)} users</Group>}</Table.Td>
                  <Table.Td w={120}><Badge variant="light" color={s.access === 'edit' ? 'teal' : 'gray'} leftSection={s.access === 'edit' ? <IconPencil size={11} /> : <IconEye size={11} />}>{s.access === 'edit' ? 'Can edit' : 'Can view'}</Badge></Table.Td>
                  <Table.Td w={40}>{data.canManage && <ActionIcon variant="subtle" color="red" onClick={async () => { await api(`/sharing/${object}/${id}/${s.id}`, { method: 'DELETE' }); setChanged(true); reload(); }}><IconTrash size={15} /></ActionIcon>}</Table.Td>
                </Table.Tr>))}
            </Table.Tbody></Table>
          ) : <Text size="sm" c="dimmed">Not shared with anyone individually.</Text>}
        </div>
        {data.canManage ? (
          <Group align="flex-end" gap="xs" wrap="wrap">
            <Select label="Share with" placeholder="User or role" w={260} searchable value={who} onChange={setWho}
              data={[{ group: 'Users', items: data.users.filter((u: any) => u.id !== data.owner?.id).map((u: any) => ({ value: `u:${u.id}`, label: u.name })) }, { group: 'Roles', items: meta.roles.filter((r) => !r.admin).map((r) => ({ value: `r:${r.key}`, label: `Everyone with role ${r.label}` })) }]} />
            <SegmentedControl value={access} onChange={(v) => setAccess(v as never)} data={[{ value: 'read', label: 'Can view' }, { value: 'edit', label: 'Can edit' }]} />
            <Button onClick={add} disabled={!who}>Share</Button>
          </Group>
        ) : <Text size="xs" c="dimmed">Only the owner or an administrator can change sharing.</Text>}
        <Text size="xs" c="dimmed">System Administrators and roles with “View all” / “Modify all” for this object always have access. What a role can do at all (create, edit, delete) is set under Setup → Roles & permissions.</Text>
      </Stack>
    </Modal>
  );
}
