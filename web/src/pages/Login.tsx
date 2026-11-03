import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Anchor, Button, Checkbox, PasswordInput, PinInput, Stack, Text, TextInput } from '@mantine/core';
import { IconCircleCheck, IconShieldLock } from '@tabler/icons-react';
import { api } from '../api';

interface Branding {
  name?: string; tagline?: string; logo?: string | null; accreditation?: { body: string; certNo: string } | null; accreditationLogo?: string | null;
  website?: string; phone?: string; email?: string; address?: string; highlights?: string[] | null; accent?: string | null;
}

/** Branded sign-in: company story on the left, sign-in (with two-step code when turned on) on the right. */
export function Login({ onLogin }: { onLogin: () => Promise<unknown> }) {
  const [b, setB] = useState<Branding>({});
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nav = useNavigate();
  useEffect(() => { api<Branding>('/public/branding', { quiet: true }).then(setB).catch(() => undefined); }, []);
  useEffect(() => { document.title = b.name ? `Sign in · ${b.name}` : 'Sign in'; }, [b.name]);
  const accent = b.accent && /^#[0-9a-f]{3,8}$/i.test(b.accent) ? b.accent : '#1f3a68';

  const submit = async (e?: React.FormEvent, codeArg?: string) => {
    e?.preventDefault(); setBusy(true); setError('');
    try {
      const r = await api<any>('/auth/login', { body: { email, password, ...(step === 'code' ? { code: codeArg ?? code, remember } : {}) }, quiet: true });
      if (r.twoFactor) { setStep('code'); setCode(''); return; }
      await onLogin(); nav('/');
    } catch (err) { setError((err as Error).message); if (step === 'code') setCode(''); } finally { setBusy(false); }
  };

  const highlights = (b.highlights ?? []).filter(Boolean);
  const points = highlights.length ? highlights : [
    'Quotations, samples, tests and reports in one place',
    'IS-standard observation sheets with automatic calculations',
    'Signed, QR-verifiable test reports',
    'Invoices, payments and ledgers with GST',
  ];
  return (
    <div className="login-wrap" style={{ ['--brand' as string]: accent }}>
      <aside className="login-brand">
        <div className="login-brand-inner">
          <div className="login-logo-row">
            {b.logo ? <div className="login-logo"><img src={b.logo} alt="" /></div> : <div className="login-logo login-logo-text">{(b.name ?? 'L').slice(0, 1)}</div>}
            {b.accreditation && (
              <div className="login-acc">
                {b.accreditationLogo && <img src={b.accreditationLogo} alt="" />}
                <span>{b.accreditation.body} accredited<br /><b>{b.accreditation.certNo}</b></span>
              </div>
            )}
          </div>
          <h1>{b.name || 'Laboratory Suite'}</h1>
          {b.tagline && <p className="login-tagline">{b.tagline}</p>}
          <ul className="login-points">
            {points.slice(0, 4).map((p, i) => <li key={i}><IconCircleCheck size={18} /> <span>{p}</span></li>)}
          </ul>
          <div className="login-contact">
            {[b.phone, b.email, b.website?.replace(/^https?:\/\//, '').replace(/\/$/, '')].filter(Boolean).join('  ·  ')}
            {b.address && <div>{b.address.replace(/\s*\n\s*/g, ', ')}</div>}
          </div>
        </div>
      </aside>
      <main className="login-main">
        <form className="login-card" onSubmit={submit}>
          {step === 'password' ? (
            <Stack gap="md">
              <div>
                <Text fw={700} fz={26} lh={1.2}>Welcome back</Text>
                <Text size="sm" c="dimmed">Sign in to {b.name || 'your workspace'}</Text>
              </div>
              {error && <Alert color="red" variant="light">{error}</Alert>}
              <TextInput label="Email" size="md" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} autoComplete="username" required autoFocus />
              <PasswordInput label="Password" size="md" value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="current-password" required />
              <Button type="submit" size="md" loading={busy} fullWidth style={{ background: accent }}>Sign in</Button>
              <Text size="xs" c="dimmed" ta="center">Forgot your password? Ask your administrator to reset it.</Text>
            </Stack>
          ) : (
            <Stack gap="md">
              <div style={{ textAlign: 'center' }}>
                <IconShieldLock size={40} color={accent} />
                <Text fw={700} fz={22}>Two-step verification</Text>
                <Text size="sm" c="dimmed">{useBackup ? 'Enter one of your backup codes.' : 'Enter the 6-digit code from your authenticator app.'}</Text>
              </div>
              {error && <Alert color="red" variant="light">{error}</Alert>}
              {useBackup
                ? <TextInput label="Backup code" placeholder="xxxxx-xxxxx" value={code} onChange={(e) => setCode(e.currentTarget.value)} autoFocus />
                : <div style={{ display: 'flex', justifyContent: 'center' }}><PinInput length={6} type="number" oneTimeCode autoFocus size="lg" value={code} onChange={setCode} onComplete={(v) => submit(undefined, v)} /></div>}
              <Checkbox label="Trust this device for 30 days" checked={remember} onChange={(e) => setRemember(e.currentTarget.checked)} />
              <Button type="submit" size="md" loading={busy} fullWidth disabled={useBackup ? code.length < 9 : code.length !== 6} style={{ background: accent }}>Verify</Button>
              <Stack gap={4} align="center">
                <Anchor size="sm" component="button" type="button" onClick={() => { setUseBackup(!useBackup); setCode(''); setError(''); }}>{useBackup ? 'Use the authenticator app instead' : 'Lost your phone? Use a backup code'}</Anchor>
                <Anchor size="sm" c="dimmed" component="button" type="button" onClick={() => { setStep('password'); setError(''); }}>Back</Anchor>
              </Stack>
            </Stack>
          )}
        </form>
        <Text size="xs" c="dimmed" ta="center" mt="lg">Secured sign-in · new-device alerts{b.name ? ` · © ${new Date().getFullYear()} ${b.name}` : ''}</Text>
      </main>
    </div>
  );
}
