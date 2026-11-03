import { useState } from 'react';
import { Alert, Badge, Button, Code, Group, Modal, Paper, PasswordInput, PinInput, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconDeviceDesktop, IconDeviceMobile, IconShieldCheck, IconShieldLock } from '@tabler/icons-react';
import qrcode from 'qrcode-generator';
import { api, ok, useApi } from '../api';
import { PageHeader, Loading } from '../components/ui';

/** My account: password, two-step verification, devices that are signed in. */
export function AccountPage() {
  const { data, reload } = useApi<any>('/account/security', []);
  if (!data) return <Loading />;
  return (
    <>
      <PageHeader title="My account & security" subtitle="Password, two-step verification and the devices you are signed in on" />
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <TwoFactorCard state={data} onChange={reload} />
        <PasswordCard />
        <DevicesCard devices={data.devices} onChange={reload} />
      </SimpleGrid>
    </>
  );
}

export function TwoFactorCard({ state, onChange }: { state: any; onChange: () => void }) {
  const [setup, setSetup] = useState<null | { secret: string; otpauth: string }>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pw, setPw] = useState<null | 'disable' | 'codes'>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const start = async () => { setBusy(true); try { setSetup(await api('/account/2fa/setup', { method: 'POST' })); setCode(''); } finally { setBusy(false); } };
  const enable = async (c = code) => { setBusy(true); try { const r = await api<any>('/account/2fa/enable', { body: { code: c } }); setCodes(r.backupCodes); setSetup(null); onChange(); } catch { setCode(''); } finally { setBusy(false); } };
  const withPassword = async () => {
    setBusy(true);
    try {
      if (pw === 'disable') { await api('/account/2fa/disable', { body: { password } }); ok('Two-step verification turned off'); onChange(); }
      else { const r = await api<any>('/account/2fa/backup-codes', { body: { password } }); setCodes(r.backupCodes); onChange(); }
      setPw(null); setPassword('');
    } finally { setBusy(false); }
  };
  const qr = (() => { if (!setup) return ''; const q = qrcode(0, 'M'); q.addData(setup.otpauth); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); })();
  const download = () => { const blob = new Blob([`Backup codes – each works once\n\n${codes!.join('\n')}\n`], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'backup-codes.txt'; a.click(); };
  return (
    <Paper withBorder p="lg">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">{state.totpEnabled ? <IconShieldCheck color="var(--mantine-color-teal-6)" /> : <IconShieldLock />}<Text fw={700}>Two-step verification</Text></Group>
        <Badge color={state.totpEnabled ? 'teal' : 'gray'} variant="light">{state.totpEnabled ? 'On' : 'Off'}</Badge>
      </Group>
      <Text size="sm" c="dimmed" mb="md">After your password, you also enter a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator). Someone who learns your password still cannot sign in.</Text>
      {state.required && !state.totpEnabled && <Alert color="orange" variant="light" mb="sm">Your company requires two-step verification. Set it up to continue using the app.</Alert>}
      {!state.totpEnabled && !setup && <Button onClick={start} loading={busy}>Set up two-step verification</Button>}
      {setup && (
        <Stack gap="sm">
          <Text size="sm"><b>1.</b> Install Google Authenticator or Microsoft Authenticator on your phone.</Text>
          <Text size="sm"><b>2.</b> In the app tap <b>+</b> → <b>Scan a QR code</b>, and scan this:</Text>
          <div style={{ width: 180, height: 180, alignSelf: 'center', background: '#fff' }} dangerouslySetInnerHTML={{ __html: qr }} />
          <Text size="xs" c="dimmed" ta="center">Can't scan? Choose “Enter a setup key” and type: <Code>{setup.secret}</Code></Text>
          <Text size="sm"><b>3.</b> Enter the 6-digit code the app shows:</Text>
          <Group justify="center"><PinInput length={6} type="number" oneTimeCode value={code} onChange={setCode} onComplete={(v) => enable(v)} /></Group>
          <Group justify="flex-end"><Button variant="default" onClick={() => setSetup(null)}>Cancel</Button><Button loading={busy} disabled={code.length !== 6} onClick={() => enable()}>Turn on</Button></Group>
        </Stack>
      )}
      {state.totpEnabled && (
        <Stack gap="xs">
          <Text size="sm">Backup codes left: <b>{state.backupCodesLeft}</b> {state.backupCodesLeft <= 2 && <Text span c="orange" size="sm">– generate new ones</Text>}</Text>
          <Group gap="xs">
            <Button size="xs" variant="light" onClick={() => setPw('codes')}>New backup codes</Button>
            {!state.required && <Button size="xs" variant="subtle" color="red" onClick={() => setPw('disable')}>Turn off</Button>}
          </Group>
        </Stack>
      )}
      <Modal opened={Boolean(codes)} onClose={() => setCodes(null)} title="Save your backup codes" closeOnClickOutside={false}>
        <Text size="sm" mb="sm">If you lose your phone, sign in with one of these codes. Each works once. Keep them somewhere safe (not on the same phone).</Text>
        <SimpleGrid cols={2} spacing={6}>{(codes ?? []).map((c) => <Code key={c} fz="md" ta="center">{c}</Code>)}</SimpleGrid>
        <Group justify="flex-end" mt="md"><Button variant="default" onClick={download}>Download</Button><Button onClick={() => setCodes(null)}>I saved them</Button></Group>
      </Modal>
      <Modal opened={Boolean(pw)} onClose={() => setPw(null)} title="Confirm your password">
        <PasswordInput label="Password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} data-autofocus />
        <Group justify="flex-end" mt="md"><Button color={pw === 'disable' ? 'red' : undefined} loading={busy} onClick={withPassword} disabled={!password}>{pw === 'disable' ? 'Turn off' : 'Generate'}</Button></Group>
      </Modal>
    </Paper>
  );
}

function PasswordCard() {
  const [v, setV] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const bad = v.next && v.next.length < 8 ? 'At least 8 characters' : v.again && v.again !== v.next ? 'Passwords do not match' : undefined;
  return (
    <Paper withBorder p="lg">
      <Text fw={700} mb="xs">Change password</Text>
      <Stack gap="sm">
        <PasswordInput label="Current password" value={v.current} onChange={(e) => setV({ ...v, current: e.currentTarget.value })} autoComplete="current-password" />
        <PasswordInput label="New password" value={v.next} onChange={(e) => setV({ ...v, next: e.currentTarget.value })} autoComplete="new-password" />
        <PasswordInput label="New password again" value={v.again} error={bad} onChange={(e) => setV({ ...v, again: e.currentTarget.value })} autoComplete="new-password" />
        <Text size="xs" c="dimmed">Changing the password signs you out on every other device.</Text>
        <Group justify="flex-end"><Button loading={busy} disabled={!v.current || !v.next || Boolean(bad) || v.next !== v.again}
          onClick={async () => { setBusy(true); try { await api('/account/password', { body: { current: v.current, next: v.next } }); ok('Password changed'); setV({ current: '', next: '', again: '' }); } finally { setBusy(false); } }}>Change password</Button></Group>
      </Stack>
    </Paper>
  );
}

function DevicesCard({ devices, onChange }: { devices: any[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const when = (s: string) => new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Paper withBorder p="lg">
      <Group justify="space-between" mb="xs"><Text fw={700}>Where you're signed in</Text>
        <Button size="xs" variant="light" color="red" loading={busy} onClick={async () => { if (!window.confirm('Sign out on all other devices?')) return; setBusy(true); try { await api('/account/signout-others', { method: 'POST' }); ok('Signed out on all other devices'); onChange(); } finally { setBusy(false); } }}>Sign out other devices</Button></Group>
      <Text size="xs" c="dimmed" mb="sm">You get an email and a notification when your account signs in on a new device.</Text>
      <Stack gap="xs">
        {devices.map((d) => (
          <Group key={d.id} justify="space-between" wrap="nowrap" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            <Group gap="sm" wrap="nowrap">
              {/iPhone|Android|iPad/.test(d.label) ? <IconDeviceMobile size={22} /> : <IconDeviceDesktop size={22} />}
              <div>
                <Text size="sm" fw={600}>{d.label} {d.current && <Badge size="xs" variant="light" color="teal">This device</Badge>} {d.remembered && <Badge size="xs" variant="light">Trusted</Badge>}</Text>
                <Text size="xs" c="dimmed">Last active {when(d.lastSeen)} · IP {d.ip} · first seen {when(d.firstSeen)}</Text>
              </div>
            </Group>
            {!d.current && <Button size="compact-xs" variant="subtle" color="gray" onClick={async () => { await api(`/account/devices/${d.id}`, { method: 'DELETE' }); onChange(); }}>Forget</Button>}
          </Group>
        ))}
      </Stack>
    </Paper>
  );
}

/** Full-screen setup shown when the company requires two-step verification and the user hasn't set it up yet. */
export function Required2fa() {
  const { data, reload } = useApi<any>('/account/security', []);
  if (!data) return <Loading />;
  if (data.totpEnabled) { window.location.href = '/'; return null; }
  return (
    <div style={{ minHeight: '100vh', background: '#f4f6fb', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 520 }}>
        <Title order={3} mb="xs">One more step</Title>
        <TwoFactorCard state={data} onChange={reload} />
        <Group justify="center" mt="md"><Button variant="subtle" onClick={async () => { await api('/auth/logout', { method: 'POST' }); window.location.href = '/login'; }}>Sign out</Button></Group>
      </div>
    </div>
  );
}
