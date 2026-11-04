import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Anchor, Button, Checkbox, Group, Loader, PasswordInput, PinInput, Progress, Stack, Text, TextInput } from '@mantine/core';
import { IconCircleCheck, IconMailCheck, IconShieldLock } from '@tabler/icons-react';
import { api } from '../api';

interface Branding {
  name?: string; tagline?: string; logo?: string | null; accreditation?: { body: string; certNo: string } | null; accreditationLogo?: string | null;
  website?: string; phone?: string; email?: string; address?: string; highlights?: string[] | null; accent?: string | null;
}

/** Branded sign-in: company story on the left, sign-in (with two-step code when turned on) on the right. */
export function Login({ onLogin }: { onLogin: () => Promise<unknown> }) {
  const { b, accent } = useBranding();
  const [sp] = useSearchParams();
  const [email, setEmail] = useState(sp.get('email') ?? '');
  const [sent, setSent] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'password' | 'code' | 'forgot'>('password');
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nav = useNavigate();
  useEffect(() => { document.title = b.name ? `Sign in · ${b.name}` : 'Sign in'; }, [b.name]);

  const forgot = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await api<any>('/public/forgot', { body: { email }, quiet: true }); setSent(r.message); } catch (x) { setError((x as Error).message); } finally { setBusy(false); }
  };
  const submit = async (e?: React.FormEvent, codeArg?: string) => {
    e?.preventDefault(); setBusy(true); setError('');
    try {
      const r = await api<any>('/auth/login', { body: { email, password, ...(step === 'code' ? { code: codeArg ?? code, remember } : {}) }, quiet: true });
      if (r.twoFactor) { setStep('code'); setCode(''); return; }
      await onLogin(); nav('/');
    } catch (err) { setError((err as Error).message); if (step === 'code') setCode(''); } finally { setBusy(false); }
  };

  return (
    <LoginShell b={b} accent={accent}>
        <form className="login-card" onSubmit={step === 'forgot' ? forgot : submit}>
          {step === 'forgot' ? (
            <Stack gap="md">
              <div>
                <Text fw={700} fz={24} lh={1.2}>Forgot password?</Text>
                <Text size="sm" c="dimmed">Enter your sign-in email. We'll send a link to choose a new password.</Text>
              </div>
              {error && <Alert color="red" variant="light">{error}</Alert>}
              {sent ? <Alert color="teal" variant="light" icon={<IconMailCheck size={18} />}>{sent}</Alert> : <>
                <TextInput label="Email" size="md" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} autoComplete="username" required autoFocus />
                <Button type="submit" size="md" loading={busy} fullWidth style={{ background: accent }}>Send reset link</Button>
              </>}
              <Text size="xs" c="dimmed">No email? Your administrator can send you a reset link from Settings → Users.</Text>
              <Anchor size="sm" component="button" type="button" onClick={() => { setStep('password'); setSent(''); setError(''); }}>← Back to sign in</Anchor>
            </Stack>
          ) : step === 'password' ? (
            <Stack gap="md">
              <div>
                <Text fw={700} fz={26} lh={1.2}>Welcome back</Text>
                <Text size="sm" c="dimmed">Sign in to {b.name || 'your workspace'}</Text>
              </div>
              {!error && sp.get('reason') === 'idle' && <Alert color="blue" variant="light">You were signed out after a period of inactivity. Sign in again to continue.</Alert>}
              {!error && sp.get('reason') === 'expired' && <Alert color="blue" variant="light">Your session ended. Sign in again to continue.</Alert>}
              {error && <Alert color="red" variant="light">{error}</Alert>}
              <TextInput label="Email" size="md" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} autoComplete="username" required autoFocus />
              <div>
                <PasswordInput label="Password" size="md" value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="current-password" required />
                <Group justify="flex-end" mt={6}><Anchor size="sm" component="button" type="button" onClick={() => { setStep('forgot'); setError(''); }}>Forgot password?</Anchor></Group>
              </div>
              <Button type="submit" size="md" loading={busy} fullWidth style={{ background: accent }}>Sign in</Button>
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
    </LoginShell>
  );
}

/** Branded two-column frame shared by sign-in, forgot password and set-password screens. */
export function LoginShell({ b, accent, children }: { b: Branding; accent: string; children: React.ReactNode }) {
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
        {children}
        <Text size="xs" c="dimmed" ta="center" mt="lg">Secured sign-in · new-device alerts{b.name ? ` · © ${new Date().getFullYear()} ${b.name}` : ''}</Text>
      </main>
    </div>
  );
}

export function useBranding() {
  const [b, setB] = useState<Branding>({});
  useEffect(() => { api<Branding>('/public/branding', { quiet: true }).then(setB).catch(() => undefined); }, []);
  const accent = b.accent && /^#[0-9a-f]{3,8}$/i.test(b.accent) ? b.accent : '#1f3a68';
  return { b, accent };
}

/** Password strength hint shown while choosing a password. */
export function strength(p: string) {
  let n = 0;
  if (p.length >= 8) n++; if (p.length >= 12) n++; if (/[a-z]/.test(p) && /[A-Z]/.test(p)) n++; if (/\d/.test(p)) n++; if (/[^A-Za-z0-9]/.test(p)) n++;
  return { score: n, label: ['Too short', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'][n], color: ['red', 'red', 'orange', 'yellow', 'teal', 'green'][n] };
}
export const passwordOk = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);

/** /welcome/:token (new user invitation) and /reset/:token (forgot password). */
export function SetPasswordPage() {
  const { token } = useParams();
  const { b, accent } = useBranding();
  const [info, setInfo] = useState<any>(undefined);
  const [err, setErr] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { signedIn: boolean; email: string }>(null);
  useEffect(() => { api<any>(`/public/token/${encodeURIComponent(token ?? '')}`, { quiet: true }).then(setInfo).catch((e) => { setErr(e.message); setInfo(null); }); }, [token]);
  const invite = info?.purpose === 'invite';
  useEffect(() => { document.title = invite ? 'Set up your account' : 'Choose a new password'; }, [invite]);
  const st = strength(pw);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api<any>(`/public/token/${encodeURIComponent(token ?? '')}`, { body: { password: pw }, quiet: true }); setDone(r); if (r.signedIn) setTimeout(() => { window.location.href = '/'; }, 1400); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <LoginShell b={b} accent={accent}>
      <form className="login-card" onSubmit={submit}>
        {info === undefined ? <Stack align="center"><Loader /></Stack> : info === null ? (
          <Stack gap="md">
            <Text fw={700} fz={24}>Link not valid</Text>
            <Alert color="orange" variant="light">{err}</Alert>
            <Button component="a" href="/login" variant="light">Go to sign in</Button>
          </Stack>
        ) : done ? (
          <Stack gap="md" align="center" ta="center">
            <IconCircleCheck size={48} color="#12b76a" />
            <Text fw={700} fz={22}>{invite ? 'Your account is ready' : 'Password changed'}</Text>
            <Text size="sm" c="dimmed">{done.signedIn ? 'Signing you in…' : 'Sign in with your new password and your authenticator code.'}</Text>
            {!done.signedIn && <Button component="a" href={`/login?email=${encodeURIComponent(done.email)}`} style={{ background: accent }}>Sign in</Button>}
          </Stack>
        ) : (
          <Stack gap="md">
            <div>
              <Text fw={700} fz={24} lh={1.2}>{invite ? `Welcome, ${info.name.split(' ')[0]}` : 'Choose a new password'}</Text>
              <Text size="sm" c="dimmed">{invite ? `Your email is confirmed. Set a password to start using ${info.company}.` : `For ${info.email}`}</Text>
            </div>
            {invite && <TextInput label="Sign-in email" value={info.email} readOnly rightSection={<IconCircleCheck size={18} color="#12b76a" />} />}
            {err && <Alert color="red" variant="light">{err}</Alert>}
            <div>
              <PasswordInput label="New password" size="md" value={pw} onChange={(e) => setPw(e.currentTarget.value)} autoComplete="new-password" autoFocus required />
              {pw && <><Progress mt={6} size="sm" value={(st.score / 5) * 100} color={st.color} /><Text size="xs" c="dimmed" mt={2}>{st.label} · at least 8 characters with letters and a number</Text></>}
            </div>
            <PasswordInput label="Confirm password" size="md" value={pw2} onChange={(e) => setPw2(e.currentTarget.value)} autoComplete="new-password" required
              error={pw2 && pw2 !== pw ? 'Passwords do not match' : undefined} />
            <Button type="submit" size="md" loading={busy} fullWidth disabled={!passwordOk(pw) || pw !== pw2} style={{ background: accent }}>{invite ? 'Set password and continue' : 'Save new password'}</Button>
          </Stack>
        )}
      </form>
    </LoginShell>
  );
}
