import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Badge, Button, CopyButton, FileButton, Group, Image, Modal, PasswordInput, SegmentedControl, Select, SimpleGrid, Stack, Switch, Text, TextInput, Textarea, Tooltip } from '@mantine/core';
import { IconCircleCheck, IconMailForward, IconCopy, IconCheck } from '@tabler/icons-react';
import { waLink, waNumber } from '@suite/shared';
import { WhatsAppButton } from '../../components/WhatsApp';
import { passwordOk, strength } from '../Login';
import { api, fileToDataUrl, ok, useApi } from '../../api';
import { useCan, useMe, useMeta, isAdmin } from '../../ctx';
import { PageHeader } from '../../components/ui';
import { ListView } from '../../components/ListView';

export function UsersSettings() {
  const { data, reload } = useApi<any[]>('/users');
  const [sp, setSp] = useSearchParams();
  const [edit, setEdit] = useState<any>(null);
  const [link, setLink] = useState<any>(null);
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
        { key: 'name', label: 'Name' },
        { key: 'email', label: 'Email', render: (u) => <Group gap={4} wrap="nowrap"><Text size="sm">{u.email}</Text>{u.email_verified_at ? <Tooltip label="Email confirmed"><IconCircleCheck size={15} color="#12b76a" /></Tooltip> : null}</Group> },
        { key: 'status', label: 'Status', filter: 'select', value: (u) => (!u.active ? 'Inactive' : isPending(u) ? 'Invited' : 'Active'),
          render: (u) => (!u.active ? <Badge color="gray" variant="light">Inactive</Badge> : isPending(u) ? <Badge color="orange" variant="light">Invited – pending</Badge> : <Badge color="teal" variant="light">Active</Badge>) },
        { key: 'role', label: 'Role', value: (u) => roleLabel(u.role), render: (u) => <Badge variant="light" color={u.role === 'admin' ? 'red' : 'brand'} style={{ textTransform: 'none' }}>{roleLabel(u.role)}</Badge>, filter: 'select' },
        { key: 'designation', label: 'Designation' }, { key: 'signature', label: 'Signature', value: (u) => (u.signature ? 'Uploaded' : '—') }, { key: 'totp', label: 'Two-step', value: (u) => (u.totp_enabled ? 'On' : 'Off'), filter: 'select' }]} />
      {edit && <UserModal user={edit} canManage={can('manageUsers')} admin={isAdmin(me)} roles={meta.roles} onLink={(l) => setLink(l)} onClose={(s) => { setEdit(null); if (s) reload(); }} />}
      {link && <AccessLinkModal info={link} onClose={() => setLink(null)} />}
    </>
  );
}

const isPending = (u: any) => u.password_set === false || u.password_set === 0;

function UserModal({ user, canManage, admin, roles, onClose, onLink }: { user: any; canManage: boolean; admin: boolean; roles: any[]; onClose: (saved: boolean) => void; onLink: (l: any) => void }) {
  const [v, setV] = useState<any>({ ...user, password: '' });
  const [mode, setMode] = useState<'invite' | 'password'>('invite');
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email ?? '');
  const needPw = !user.id ? mode === 'password' : manual;
  const save = async () => {
    const body = { ...v }; if (!needPw || !body.password) delete body.password;
    for (const k of ['id', 'totp_enabled', 'password_set', 'email_verified_at']) delete body[k];
    setBusy(true);
    try {
      if (user.id) { await api(`/users/${user.id}`, { method: 'PUT', body }); ok('User saved'); onClose(true); return; }
      const r = await api<any>('/users', { body });
      onClose(true);
      if (r.invite) onLink({ ...r.invite, purpose: 'invite', name: v.name, email: v.email, phone: v.phone }); else ok('User created');
    } finally { setBusy(false); }
  };
  const sendLink = async () => {
    setBusy(true);
    try { const r = await api<any>(`/users/${user.id}/access-link`, { method: 'POST' }); onClose(true); onLink({ ...r, name: user.name, email: user.email, phone: user.phone }); }
    finally { setBusy(false); }
  };
  const st = strength(v.password ?? '');
  const roleOptions = roles.filter((r) => admin || r.key !== 'admin').map((r) => ({ value: r.key, label: r.label }));
  return (
    <Modal opened onClose={() => onClose(false)} title={user.id ? `Edit ${user.name}` : 'Add user'} size="lg">
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Name" value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} />
          <TextInput label="Email (login)" value={v.email ?? ''} onChange={(e) => setV({ ...v, email: e.currentTarget.value })} />
          <Select label="Role" disabled={!canManage || (user.role === 'admin' && !admin)} data={roleOptions} value={v.role} onChange={(x) => setV({ ...v, role: x })} />
          <TextInput label="Designation" value={v.designation ?? ''} onChange={(e) => setV({ ...v, designation: e.currentTarget.value })} />
          <TextInput label="Phone" value={v.phone ?? ''} onChange={(e) => setV({ ...v, phone: e.currentTarget.value })} />
        </SimpleGrid>
        {!user.id && (
          <div>
            <Text size="sm" fw={500} mb={4}>How will they get their password?</Text>
            <SegmentedControl fullWidth value={mode} onChange={(x) => setMode(x as never)} data={[{ value: 'invite', label: 'Email an invitation (recommended)' }, { value: 'password', label: 'I’ll set a password now' }]} />
            <Text size="xs" c="dimmed" mt={4}>{mode === 'invite' ? 'They get a link to confirm their email and choose their own password. They cannot sign in until they do. The link is valid for 7 days.' : 'You choose the password and tell them. Their email is not confirmed this way.'}</Text>
          </div>
        )}
        {user.id && canManage && (
          <Alert variant="light" color={isPending(user) ? 'orange' : 'gray'} p="sm">
            <Group justify="space-between" wrap="wrap" gap="xs">
              <Text size="sm">{isPending(user) ? 'Invitation not accepted yet – they have not set a password.' : user.email_verified_at ? 'Email confirmed. Forgot their password? Send a reset link.' : 'Send a link so they choose a new password themselves.'}</Text>
              <Group gap="xs">
                <Button size="xs" variant="light" leftSection={<IconMailForward size={14} />} loading={busy} onClick={sendLink} disabled={!user.active}>{isPending(user) ? 'Resend invitation' : 'Send password reset link'}</Button>
                {!manual && <Button size="xs" variant="subtle" onClick={() => setManual(true)}>Set password myself</Button>}
              </Group>
            </Group>
          </Alert>
        )}
        {needPw && (
          <div>
            <PasswordInput label={user.id ? 'New password' : 'Password'} value={v.password} onChange={(e) => setV({ ...v, password: e.currentTarget.value })} autoComplete="new-password" />
            {v.password && <Text size="xs" c={passwordOk(v.password) ? 'dimmed' : 'orange'} mt={2}>{st.label} · at least 8 characters with letters and a number</Text>}
          </div>
        )}
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
        <Group justify="space-between">
          {canManage && user.id && user.totp_enabled ? <Button variant="subtle" color="orange" onClick={async () => { if (!window.confirm(`Reset two-step verification for ${user.name}? They will set it up again at next sign-in (if required) and are signed out everywhere.`)) return; await api(`/account/admin/reset-2fa/${user.id}`, { method: 'POST' }); ok('Two-step verification reset'); onClose(true); }}>Reset two-step verification</Button> : <span />}
          <Button onClick={save} loading={busy} disabled={!v.name || !emailOk || (needPw && !(user.id && !v.password) && !passwordOk(v.password ?? ''))}>{!user.id && mode === 'invite' ? 'Create and send invitation' : 'Save'}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Shows the invitation / reset link after it is created: emailed, or ready to copy and send on WhatsApp. */
function AccessLinkModal({ info, onClose }: { info: any; onClose: () => void }) {
  const invite = info.purpose === 'invite';
  const msg = invite
    ? `Hi ${info.name}, your account for our lab application is ready. Open this link to confirm your email and set your password (valid 7 days):\n${info.url}\n\nSign-in email: ${info.email}`
    : `Hi ${info.name}, use this link to set a new password for the lab application (valid 1 hour):\n${info.url}`;
  const phone = waNumber(info.phone);
  return (
    <Modal opened onClose={onClose} title={invite ? 'Invitation created' : 'Password reset link created'} size="lg">
      <Stack>
        {info.emailed
          ? <Alert color="teal" variant="light" icon={<IconCircleCheck />}>Email sent to <b>{info.email}</b>. {invite ? 'They confirm their email and set a password from the link.' : 'The link expires in 1 hour.'}</Alert>
          : <Alert color="orange" variant="light" title="Email could not be sent">{info.emailError} Copy the link below and send it to {info.name} yourself – on WhatsApp, for example.</Alert>}
        <TextInput label={`${invite ? 'Invitation' : 'Reset'} link (works once)`} value={info.url} readOnly onFocus={(e) => e.currentTarget.select()}
          rightSection={<CopyButton value={info.url}>{({ copied, copy }) => <Tooltip label={copied ? 'Copied' : 'Copy'}><Button size="compact-xs" variant="subtle" onClick={copy}>{copied ? <IconCheck size={14} /> : <IconCopy size={14} />}</Button></Tooltip>}</CopyButton>} rightSectionWidth={44} />
        <Group justify="flex-end">
          <CopyButton value={msg}>{({ copied, copy }) => <Button variant="default" onClick={copy}>{copied ? 'Message copied' : 'Copy message'}</Button>}</CopyButton>
          <WhatsAppButton label={phone ? `Send to ${info.name} on WhatsApp` : 'Send on WhatsApp'} onClick={() => window.open(waLink(phone, msg), '_blank', 'noopener')} />
        </Group>
        <Text size="xs" c="dimmed">Only share this link with {info.name}: whoever opens it can set the password.</Text>
      </Stack>
    </Modal>
  );
}
