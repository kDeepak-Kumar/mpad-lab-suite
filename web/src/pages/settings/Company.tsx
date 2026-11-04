import { useEffect, useState } from 'react';
import { Button, FileButton, Grid, Group, Image, NumberInput, Paper, Select, SimpleGrid, Stack, Switch, Text, UnstyledButton, TextInput, Textarea, Alert, SegmentedControl, PasswordInput, Anchor, ActionIcon, Badge } from '@mantine/core';
import { IconTrash, IconUpload, IconDownload, IconBrandWhatsapp, IconId, IconPalette, IconLayoutNavbar, IconFiles, IconBuildingBank, IconHash, IconListCheck, IconSignature, IconMail, IconShieldLock, IconSparkles, IconFileText } from '@tabler/icons-react';
import { TermsSettings } from '../../components/Terms';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_NUMBERING, INDIAN_STATES, formatNumber, isEmailList, WA_TEMPLATES, WA_PLACEHOLDERS, fillWa } from '@suite/shared';
import { api, fileToDataUrl, ok, useApi, localToday } from '../../api';
import { PageHeader, Loading } from '../../components/ui';

const NUM_LABEL: Record<string, string> = { quote: 'Quotation', invoice: 'Invoice', workorder: 'Work order', sample: 'Sample job code', ulr: 'ULR number', report: 'Test report', receipt: 'Payment receipt' };

const SECTIONS: { group: string; items: { key: string; label: string; hint: string; icon: React.ComponentType<{ size?: number | string }>; color: string; selfSave?: boolean }[] }[] = [
  { group: 'Company', items: [
    { key: 'profile', label: 'Company profile', hint: 'Name, registration, GST and accreditation details printed on every document', icon: IconId, color: '#2a78d6' },
    { key: 'branding', label: 'Logo & sign-in page', hint: 'Logo, seal, accreditation symbol and the branded sign-in page', icon: IconPalette, color: '#7a5af8' },
    { key: 'letterheads', label: 'Letterheads', hint: 'NABL and standard letterheads for quotations, invoices and reports', icon: IconLayoutNavbar, color: '#0e9384' },
    { key: 'docs', label: 'Brochure & documents', hint: 'Company profile, brochure and certificates to attach to emails', icon: IconFiles, color: '#dc6803', selfSave: true },
  ] },
  { group: 'Documents & billing', items: [
    { key: 'bank', label: 'Bank & payments', hint: 'Printed on invoices and used in WhatsApp payment messages', icon: IconBuildingBank, color: '#079455' },
    { key: 'numbering', label: 'Numbering', hint: 'Number formats for quotations, invoices, samples, ULR and reports', icon: IconHash, color: '#475467' },
    { key: 'defaults', label: 'Defaults & rules', hint: 'GST rate, SAC, validity, standard notes and review rules', icon: IconListCheck, color: '#2a78d6' },
    { key: 'terms', label: 'Terms & conditions', hint: 'Reusable sets of terms (Boreholes, SPT, SBC…) to insert into quotations and reports', icon: IconFileText, color: '#0e9384' },
    { key: 'signatories', label: 'Signatories', hint: 'Who signs quotations, invoices and reports, with their signatures', icon: IconSignature, color: '#7a5af8' },
  ] },
  { group: 'Communication', items: [
    { key: 'email', label: 'Email & alerts', hint: 'Sending mailbox, email footer and automatic alerts', icon: IconMail, color: '#d92d20' },
    { key: 'whatsapp', label: 'WhatsApp', hint: 'Message templates for the WhatsApp buttons', icon: IconBrandWhatsapp, color: '#25D366' },
  ] },
  { group: 'Security & AI', items: [
    { key: 'security', label: 'Security & backup', hint: 'Two-step verification policy and full backup download', icon: IconShieldLock, color: '#101828', selfSave: true },
    { key: 'ai', label: 'AI assistant', hint: 'AI model used for drafting, analytics questions and reviews', icon: IconSparkles, color: '#e04f16' },
  ] },
];

export function CompanySettings() {
  const { data, reload } = useApi<any>('/company');
  const [v, setV] = useState<any>(null);
  const [sp, setSp] = useSearchParams();
  const sec = sp.get('section') ?? 'profile';
  const go = (k: string) => setSp({ section: k }, { replace: true });
  const cur = SECTIONS.flatMap((g) => g.items).find((i) => i.key === sec) ?? SECTIONS[0].items[0];
  useEffect(() => { if (data) setV(data); }, [data]);
  const dirty = Boolean(v && data && JSON.stringify(v) !== JSON.stringify(data));
  if (!v) return <Loading />;
  const set = (path: string, val: any) => setV((o: any) => {
    const n = structuredClone(o); const ks = path.split('.'); let cur = n;
    for (const k of ks.slice(0, -1)) cur = cur[k] ??= {};
    cur[ks[ks.length - 1]] = val; return n;
  });
  const T = (label: string, path: string, props: any = {}) => <TextInput label={label} value={path.split('.').reduce((a: any, k) => a?.[k], v) ?? ''} onChange={(e) => set(path, e.currentTarget.value)} {...props} />;
  const save = async () => { await api('/company', { method: 'PUT', body: v }); ok('Settings saved'); reload(); };
  const img = (label: string, key: string, hint: string) => (
    <Paper withBorder p="sm">
      <Text size="sm" fw={600}>{label}</Text><Text size="xs" c="dimmed" mb="xs">{hint}</Text>
      {v[key] ? <Image src={v[key]} h={80} w="auto" fit="contain" mb="xs" /> : <Text size="xs" c="dimmed" mb="xs">Not uploaded</Text>}
      <Group gap="xs">
        <FileButton accept="image/png,image/jpeg" onChange={async (f) => f && set(key, await fileToDataUrl(f))}>{(p) => <Button size="xs" variant="light" {...p}>Upload</Button>}</FileButton>
        {v[key] && <Button size="xs" variant="subtle" color="red" onClick={() => set(key, null)}>Remove</Button>}
      </Group>
    </Paper>
  );
  return (
    <>
      <PageHeader title="Company & branding" subtitle="Used in every header, footer, number and document" actions={!cur.selfSave && <Button onClick={save} disabled={!dirty}>{dirty ? 'Save changes' : 'Saved'}</Button>} />
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 3, xl: 2.5 }}>
          <Paper withBorder radius="lg" p={6} className="set-nav">
            {SECTIONS.map((g) => (
              <div key={g.group}>
                <Text className="set-group">{g.group}</Text>
                {g.items.map((it) => (
                  <UnstyledButton key={it.key} className={`set-item${sec === it.key ? ' active' : ''}`} onClick={() => go(it.key)} aria-current={sec === it.key ? 'page' : undefined}>
                    <span className="set-ic" style={{ ['--c' as string]: it.color }}><it.icon size={16} /></span>
                    <span style={{ flex: 1, minWidth: 0 }}><span className="set-label">{it.label}</span></span>
                  </UnstyledButton>
                ))}
              </div>
            ))}
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 9, xl: 9.5 }}>
          <Paper withBorder radius="lg" p="lg" className="set-body">
            <Group gap="sm" mb="lg" wrap="nowrap" align="flex-start">
              <span className="set-ic big" style={{ ['--c' as string]: cur.color }}><cur.icon size={20} /></span>
              <div><Text fw={700} fz={18}>{cur.label}</Text><Text size="sm" c="dimmed">{cur.hint}</Text></div>
            </Group>
        {sec === "profile" && <>
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            {T('Company name (as on documents)', 'name')}{T('Tagline', 'tagline')}{T('Short name (printed under the logo, e.g. MPAD)', 'shortName')}{T('CIN', 'cin')}{T('GSTIN', 'gstin')}{T('PAN', 'pan')}
            <Select label="State (for GST)" searchable data={INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.code} – ${s.name}` }))} value={v.stateCode ?? null} onChange={(x) => set('stateCode', x)} />
            {T('Phone(s)', 'phone')}{T('Email', 'email')}{T('Website', 'website')}{T('Jurisdiction city', 'jurisdiction')}
            {T('Accreditation body', 'accreditation.body')}{T('Accreditation certificate no.', 'accreditation.certNo')}{T('Accreditation valid till', 'accreditation.validTill', { type: 'date' })}
          </SimpleGrid>
          <Textarea mt="sm" label="Address (footer)" autosize value={v.address ?? ''} onChange={(e) => set('address', e.currentTarget.value)} />
        </>}
        {sec === "branding" && <>
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            {img('Company logo', 'logo', 'Shown at top-left of every document')}
            {img('Accreditation symbol', 'accreditationLogo', 'Printed on reports for accredited tests. Follow the accreditation body’s rules for its use.')}
            {img('Company seal / stamp', 'seal', 'Applied automatically when a document is signed and issued')}
          </SimpleGrid>
          <Text size="xs" c="dimmed" mt="sm">Signatures are managed under the Signatories tab (or per user under Users & roles).</Text>
          <Paper withBorder p="sm" mt="md">
            <Text size="sm" fw={600}>Sign-in page</Text>
            <Text size="xs" c="dimmed" mb="xs">The sign-in page shows the logo, name, tagline and accreditation from this page, plus up to four highlights.</Text>
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              {[0, 1, 2, 3].map((i) => <TextInput key={i} label={`Highlight ${i + 1}`} placeholder={['NABL accredited testing laboratory', 'Field & lab testing under one roof', 'Traceable, verifiable reports', 'Hyderabad · since 2016'][i]}
                value={v.login?.highlights?.[i] ?? ''} onChange={(e) => { const h = [...(v.login?.highlights ?? ['', '', '', ''])]; h[i] = e.currentTarget.value; set('login.highlights', h); }} />)}
              <TextInput label="Brand colour (hex)" placeholder="#1f3a68" value={v.login?.accent ?? ''} onChange={(e) => set('login.accent', e.currentTarget.value)} />
            </SimpleGrid>
          </Paper>
        </>}
        {sec === "bank" && <>
          <SimpleGrid cols={{ base: 1, md: 2 }}>{T('Account name', 'bank.name')}{T('Bank', 'bank.bank')}{T('Branch', 'bank.branch')}{T('IFSC', 'bank.ifsc')}{T('Account number', 'bank.account')}{T('UPI ID (optional)', 'bank.upi')}</SimpleGrid>
        </>}
        {sec === "numbering" && <>
          <Alert variant="light" mb="sm">Tokens: {'{SEQ}'} running number, {'{SEQ:4}'} zero-padded, {'{FY}'} 26-27, {'{YYYY}'} {'{YY}'} {'{MM}'}, {'{CLIENT}'} client short code. Numbers containing {'{FY}'} restart every April; with {'{YYYY}'} every January.</Alert>
          <Stack>
            {Object.keys(DEFAULT_NUMBERING).map((k) => {
              const f = v.numbering?.[k] ?? DEFAULT_NUMBERING[k];
              let preview = ''; try { preview = formatNumber(f, k === 'invoice' ? 183 : 76, { date: localToday(), client: 'ABCD' }); } catch { preview = '?'; }
              return <Group key={k} grow><TextInput label={NUM_LABEL[k]} value={f} onChange={(e) => set(`numbering.${k}`, e.currentTarget.value)} /><TextInput label="Example" value={preview} readOnly variant="filled" /></Group>;
            })}
          </Stack>
        </>}
        {sec === "defaults" && <>
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            <NumberInput label="Default GST rate (%)" value={v.defaults?.gstRate ?? 18} onChange={(x) => set('defaults.gstRate', Number(x))} />
            {T('Default SAC', 'defaults.sac')}
            <NumberInput label="Quotation validity (days)" value={v.defaults?.validityDays ?? 30} onChange={(x) => set('defaults.validityDays', Number(x))} />
            <NumberInput label="Retain samples for (days after receipt)" description="Default when a material has no own value" value={v.defaults?.retentionDays ?? 30} onChange={(x) => set('defaults.retentionDays', Number(x))} />
          </SimpleGrid>
          <Text size="sm" fw={500} mt="md">Sample retention per material (days)</Text>
          <SimpleGrid cols={{ base: 2, md: 4 }} mt={4}>
            {['Soil', 'Cement', 'Concrete', 'Coarse aggregate', 'Fine aggregate', 'Steel', 'Water', 'Bricks'].map((m) => (
              <NumberInput key={m} size="xs" label={m} placeholder={String(v.defaults?.retentionDays ?? 30)} value={v.defaults?.retentionByMaterial?.[m] ?? ''} onChange={(x) => set('defaults.retentionByMaterial', { ...(v.defaults?.retentionByMaterial ?? {}), [m]: x === '' ? undefined : Number(x) })} />))}
          </SimpleGrid>
          <Textarea mt="sm" label="Default quotation notes (one per line)" autosize minRows={3} value={v.defaults?.quoteNotes ?? ''} onChange={(e) => set('defaults.quoteNotes', e.currentTarget.value)} />
          <Textarea mt="sm" label="Standard report notes (one per line, added to every report after test-specific notes)" autosize minRows={4} value={v.defaults?.reportNotes ?? ''} onChange={(e) => set('defaults.reportNotes', e.currentTarget.value)} />
          <Switch mt="md" label="Allow a person to review observations they entered (not recommended for ISO 17025)" checked={!!v.defaults?.allowSelfReview} onChange={(e) => set('defaults.allowSelfReview', e.currentTarget.checked)} />
        </>}
        {sec === "letterheads" && <>
          <Alert variant="light" mb="sm">Every quote, invoice and report has a Report type. NABL documents print with the NABL letterhead, the rest with the standard one. Use the designed header (logo, name, CIN, GSTIN and, for NABL, the accreditation symbol and certificate number) or upload your own header and footer images.</Alert>
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            {(['nabl', 'standard'] as const).map((k) => {
              const lh = v.letterheads?.[k] ?? { mode: 'designed', showAccreditation: k === 'nabl' };
              const setLh = (patch: any) => set(`letterheads.${k}`, { ...lh, ...patch });
              return (
                <Paper key={k} withBorder p="md">
                  <Text fw={650} mb="xs">{k === 'nabl' ? 'NABL letterhead' : 'Standard (Non-NABL) letterhead'}</Text>
                  <SegmentedControl fullWidth mb="sm" value={lh.mode} onChange={(m) => setLh({ mode: m })} data={[{ value: 'designed', label: 'Designed header' }, { value: 'image', label: 'Upload images' }]} />
                  {lh.mode === 'designed'
                    ? <Switch label="Show accreditation symbol and certificate number" checked={lh.showAccreditation !== false} onChange={(e) => setLh({ showAccreditation: e.currentTarget.checked })} />
                    : <Stack gap="xs">
                        {(['headerImage', 'footerImage'] as const).map((f) => (
                          <div key={f}>
                            <Text size="sm" fw={500}>{f === 'headerImage' ? 'Header image (full width)' : 'Footer image (full width)'}</Text>
                            {lh[f] ? <Image src={lh[f]} mah={80} fit="contain" my={4} /> : <Text size="xs" c="dimmed">Not uploaded</Text>}
                            <Group gap="xs"><FileButton accept="image/png,image/jpeg" onChange={async (file) => file && setLh({ [f]: await fileToDataUrl(file, 1800) })}>{(p) => <Button size="xs" variant="light" {...p}>Upload</Button>}</FileButton>
                              {lh[f] && <Button size="xs" variant="subtle" color="red" onClick={() => setLh({ [f]: null })}>Remove</Button>}</Group>
                          </div>
                        ))}
                      </Stack>}
                </Paper>
              );
            })}
          </SimpleGrid>
        </>}
        {sec === "ai" && <><AiSettings v={v} set={set} /></>}
        {sec === "signatories" && <><SignatoriesSettings v={v} set={set} /></>}
        {sec === "security" && <><SecuritySettings /></>}
        {sec === "docs" && <><CompanyDocuments /></>}
        {sec === "terms" && <TermsSettings v={v} set={set} />}
        {sec === "whatsapp" && <><WhatsAppSettings v={v} set={set} /></>}
        {sec === "email" && <>
          <Alert variant="light" mb="sm">Documents are emailed from your own mailbox. For Gmail use host smtp.gmail.com, port 465 and an App Password. For cPanel mail use mail.yourdomain.com. The password itself is set as SMTP_PASSWORD in the hosting environment, never stored here.</Alert>
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            {T('SMTP host', 'smtp.host')}<NumberInput label="Port" value={v.smtp?.port ?? 465} onChange={(x) => set('smtp.port', Number(x))} />
            {T('Username (email address)', 'smtp.user')}{T('From (name <email>)', 'smtp.from', { placeholder: `${v.name} <lab@example.com>` })}
            <Switch label="Use SSL/TLS (port 465)" checked={v.smtp?.secure ?? true} onChange={(e) => set('smtp.secure', e.currentTarget.checked)} />
          </SimpleGrid>
          <FooterSettings v={v} set={set} />
          <AlertSettings v={v} set={set} />
        </>}
          </Paper>
        </Grid.Col>
      </Grid>
      {dirty && !cur.selfSave && <div style={{ height: 88 }} />}
      {dirty && !cur.selfSave && (
        <div className="set-savebar">
          <Text size="sm" fw={600}>You have unsaved changes</Text>
          <Group gap="xs"><Button variant="default" onClick={() => setV(data)}>Discard</Button><Button onClick={save}>Save changes</Button></Group>
        </div>
      )}
    </>
  );
}

const PROVIDERS: { value: string; label: string; baseUrl: string; model: string; note: string; key: boolean }[] = [
  { value: 'gemini', label: 'Google Gemini (free tier)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-flash-latest', note: 'Free API key from aistudio.google.com. “-latest” model names follow Google’s newest release.', key: true },
  { value: 'groq', label: 'Groq (free tier)', baseUrl: 'https://api.groq.com/openai/v1', model: '', note: 'Free key at console.groq.com; copy a current model name from its Models page.', key: true },
  { value: 'openrouter', label: 'OpenRouter (free models)', baseUrl: 'https://openrouter.ai/api/v1', model: '', note: 'Key at openrouter.ai; pick any model ending in “:free”.', key: true },
  { value: 'ollama', label: 'Ollama on this computer (free, private)', baseUrl: 'http://localhost:11434/v1', model: '', note: 'Install Ollama, run e.g. “ollama pull <model>”, then enter that model name. No key, nothing leaves your network.', key: false },
  { value: 'anthropic', label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-5-5', note: 'Paid API key from console.anthropic.com.', key: true },
  { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '', note: 'Paid API key from platform.openai.com.', key: true },
  { value: 'custom', label: 'Other (OpenAI-compatible)', baseUrl: '', model: '', note: 'Any service with an OpenAI-compatible /chat/completions endpoint.', key: true },
];

function AiSettings({ v, set }: { v: any; set: (path: string, val: any) => void }) {
  const ai = v.ai ?? {};
  const prov = PROVIDERS.find((p) => p.value === ai.provider);
  const [test, setTest] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const runTest = async () => {
    setBusy(true); setTest('');
    try { const r = await api<any>('/ai/test', { body: { provider: ai.provider === 'anthropic' ? 'anthropic' : 'openai', baseUrl: ai.baseUrl, model: ai.model, apiKey: ai.apiKey } , quiet: true }); setTest(`✓ Connected in ${r.ms} ms`); }
    catch (e: any) { setTest(`✗ ${e.message}`); } finally { setBusy(false); }
  };
  return (
    <Stack maw={720}>
      <Alert variant="light">The AI assistant answers business questions (“revenue from DAMAC Hills this year”), drafts report remarks and turns client enquiries into quotation lines. Without a model it still answers common questions with the built-in assistant. Questions are sent to the provider you choose; for full privacy use Ollama on your own computer.</Alert>
      <Switch label="Use an AI model" checked={!!ai.enabled} onChange={(e) => set('ai', { ...ai, enabled: e.currentTarget.checked })} />
      <Select label="Provider" data={PROVIDERS.map((p) => ({ value: p.value, label: p.label }))} value={ai.provider ?? null}
        onChange={(x) => { const p = PROVIDERS.find((q) => q.value === x)!; set('ai', { ...ai, provider: x, baseUrl: p.baseUrl, model: p.model || ai.model || '' }); }} />
      {prov && <Text size="xs" c="dimmed">{prov.note}</Text>}
      <TextInput label="API base URL" value={ai.baseUrl ?? ''} onChange={(e) => set('ai', { ...ai, baseUrl: e.currentTarget.value })} />
      <TextInput label="Model name" description="Change this whenever the provider releases a newer model – no update to the app needed." value={ai.model ?? ''} onChange={(e) => set('ai', { ...ai, model: e.currentTarget.value })} />
      {(!prov || prov.key) && <PasswordInput label="API key" placeholder={ai.hasKey ? 'Saved – leave blank to keep' : 'Paste the key'} value={ai.apiKey ?? ''} onChange={(e) => set('ai', { ...ai, apiKey: e.currentTarget.value })} />}
      <Group><Button variant="default" loading={busy} onClick={runTest} disabled={!ai.model}>Test connection</Button><Text size="sm" c={test.startsWith('✓') ? 'teal' : 'red'}>{test}</Text></Group>
      <Text size="xs" c="dimmed">Remember to click “Save settings” at the top. The key is stored on your server and never shown again in the browser. <Anchor href="https://aistudio.google.com/apikey" target="_blank" size="xs">Get a free Gemini key</Anchor></Text>
    </Stack>
  );
}

/** Daily email digest: tests past due date (SLA) and calibration due / expired. */
function AlertSettings({ v, set }: { v: any; set: (path: string, value: unknown) => void }) {
  const a = v.alerts ?? {};
  const [preview, setPreview] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const toBad = a.to && !isEmailList(a.to) ? 'Enter valid email addresses separated by commas' : undefined;
  return (
    <Paper withBorder p="md" mt="md">
      <Text fw={600}>Email alerts</Text>
      <Text size="xs" c="dimmed" mb="sm">One email a day (India time) listing tests that have crossed their due date without a report, and equipment whose calibration is due soon or has expired. Each item is flagged NEW the first time; the full list is repeated every Monday. Alerts also show in the bell icon inside the app.</Text>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Switch label="Send daily alert email" checked={Boolean(a.enabled)} onChange={(e) => set('alerts.enabled', e.currentTarget.checked)} />
        <TextInput label="Send to" placeholder="qc@lab.com, manager@lab.com" value={a.to ?? ''} error={toBad} onChange={(e) => set('alerts.to', e.currentTarget.value)} />
        <Switch label="Tests past due date (SLA breach)" checked={a.sla !== false} onChange={(e) => set('alerts.sla', e.currentTarget.checked)} />
        <Switch label="Calibration due / expired" checked={a.calibration !== false} onChange={(e) => set('alerts.calibration', e.currentTarget.checked)} />
        <NumberInput label="Warn this many days before calibration is due" min={0} max={120} value={a.leadDays ?? 15} onChange={(x) => set('alerts.leadDays', Number(x) || 0)} />
        <NumberInput label="Send after (hour, 0–23, India time)" min={0} max={23} value={a.hour ?? 9} onChange={(x) => set('alerts.hour', Math.min(23, Math.max(0, Number(x) || 0)))} />
        <Switch label="Repeat the full list every Monday" checked={a.weeklyRepeat !== false} onChange={(e) => set('alerts.weeklyRepeat', e.currentTarget.checked)} />
      </SimpleGrid>
      <Group mt="sm">
        <Button size="xs" variant="light" onClick={async () => setPreview(await api('/alerts/preview'))}>Preview what would be sent</Button>
        <Button size="xs" variant="light" loading={busy} disabled={!a.to || Boolean(toBad)} onClick={async () => { setBusy(true); try { const r = await api('/alerts/run', { method: 'POST' }); ok(r.sent ? `Alert email sent (${r.items} items)` : 'Nothing to alert right now'); } finally { setBusy(false); } }}>Send now</Button>
        <Text size="xs" c="dimmed">Save settings first. “Send now” uses the SMTP details above.</Text>
      </Group>
      <StoragePanel />
      {preview && (
        <Stack gap={2} mt="sm">
          {!preview.length && <Text size="sm" c="dimmed">Nothing overdue and no calibration due. No email would be sent.</Text>}
          {preview.map((i) => <Text key={i.ref} size="sm" c={i.kind === 'cal' && i.text.includes('EXPIRED') ? 'red' : undefined}>{i.kind === 'sla' ? '⏱' : '🔧'} {i.isNew ? <b>NEW </b> : ''}{i.text}</Text>)}
        </Stack>
      )}
    </Paper>
  );
}

/** Server disk and database size, so storage never runs out unnoticed. */
function StoragePanel() {
  const { data } = useApi<any>('/system/storage', []);
  if (!data) return null;
  const h = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  return (
    <Alert mt="sm" variant="light" color={data.warn ? 'red' : 'gray'} title="Server storage">
      Database {h(data.dbBytes)} · {data.filesCount} attached file{data.filesCount === 1 ? '' : 's'} ({h(data.filesBytes)})
      {data.disk && <> · Disk {data.disk.usedPct}% used, {h(data.disk.freeBytes)} free of {h(data.disk.totalBytes)}</>}
      {data.warn && <div>The disk is over 80% full. Remove old backups or move to a bigger plan; the daily alert email will also warn about this.</div>}
    </Alert>
  );
}

/** Predefined signatories: chosen from a dropdown on each document; their details and signature fill in automatically. */
function SignatoriesSettings({ v, set }: { v: any; set: (path: string, value: unknown) => void }) {
  const { data: users } = useApi<any[]>('/users', []);
  const list: any[] = v.signatories ?? [];
  const upd = (i: number, patch: any) => set('signatories', list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const add = () => set('signatories', [...list, { id: `s${Date.now().toString(36)}`, name: '', designation: '', qualifications: '', signature: null, userId: null }]);
  return (
    <Stack>
      <Alert variant="light">These people appear in the <b>Signed by</b> dropdown on quotations, invoices and reports. Link a signatory to their user login so only they (or the System Administrator / Owner) can sign reports with their signature. Remember to <b>Save settings</b>.</Alert>
      {list.map((x, i) => (
        <Paper key={x.id} withBorder p="sm">
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <TextInput label="Name" required value={x.name} onChange={(e) => upd(i, { name: e.currentTarget.value })} />
            <TextInput label="Designation" placeholder="Director (Technical)" value={x.designation ?? ''} onChange={(e) => upd(i, { designation: e.currentTarget.value })} />
            <Textarea label="Qualifications / credentials (printed under the signature)" autosize value={x.qualifications ?? ''} onChange={(e) => upd(i, { qualifications: e.currentTarget.value })} />
            <Select label="Linked user login (recommended for reports)" clearable data={(users ?? []).map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))} value={x.userId ? String(x.userId) : null} onChange={(val) => upd(i, { userId: val ? Number(val) : null })} />
          </SimpleGrid>
          <Group mt="sm" justify="space-between">
            <Group gap="xs">
              {x.signature ? <Image src={x.signature} h={46} w="auto" fit="contain" /> : <Text size="xs" c="dimmed">No signature image</Text>}
              <FileButton accept="image/png,image/jpeg" onChange={async (f) => f && upd(i, { signature: await fileToDataUrl(f, 400) })}>{(p) => <Button size="xs" variant="light" leftSection={<IconUpload size={14} />} {...p}>Upload signature</Button>}</FileButton>
              {x.signature && <Button size="xs" variant="subtle" color="red" onClick={() => upd(i, { signature: null })}>Remove</Button>}
            </Group>
            <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />} onClick={() => set('signatories', list.filter((_, j) => j !== i))}>Delete signatory</Button>
          </Group>
        </Paper>
      ))}
      <Group><Button variant="light" onClick={add}>Add signatory</Button><Text size="xs" c="dimmed">Tip: a PNG with a transparent background looks best. Users who upload their own signature also appear automatically.</Text></Group>
    </Stack>
  );
}

/** Footer added under every document email: contact details, map, WhatsApp and a review link. */
function FooterSettings({ v, set }: { v: any; set: (path: string, value: unknown) => void }) {
  const f = v.emailFooter ?? {};
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <Paper withBorder p="md" mt="md">
      <Group justify="space-between"><Text fw={600}>Email footer</Text><Switch label="Add footer to emails" checked={f.enabled !== false} onChange={(e) => set('emailFooter.enabled', e.currentTarget.checked)} /></Group>
      <Text size="xs" c="dimmed" mb="sm">Company name, accreditation, address, phone, email and website come from the Profile tab. Add the links below.</Text>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <TextInput label="Google review link" placeholder="https://g.page/r/…/review" value={f.reviewUrl ?? ''} onChange={(e) => set('emailFooter.reviewUrl', e.currentTarget.value)} />
        <Select label="Show “Rate us on Google” on" data={[{ value: 'after-service', label: 'Reports and invoices (after the work is done)' }, { value: 'all', label: 'All emails' }, { value: 'never', label: 'Never' }]} value={f.reviewOn ?? 'after-service'} onChange={(x) => set('emailFooter.reviewOn', x)} />
        <TextInput label="Google Maps link (location)" placeholder="https://maps.google.com/…" value={f.mapsUrl ?? ''} onChange={(e) => set('emailFooter.mapsUrl', e.currentTarget.value)} />
        <TextInput label="WhatsApp number" placeholder="9000219015" value={f.whatsapp ?? ''} onChange={(e) => set('emailFooter.whatsapp', e.currentTarget.value)} />
        <TextInput label="Extra line (optional)" placeholder="Working hours: Mon–Sat, 9 AM – 6 PM" value={f.extra ?? ''} onChange={(e) => set('emailFooter.extra', e.currentTarget.value)} />
        <Switch mt={28} label="Show company logo in the footer" checked={f.showLogo !== false} onChange={(e) => set('emailFooter.showLogo', e.currentTarget.checked)} />
      </SimpleGrid>
      <Group mt="sm"><Button size="xs" variant="light" onClick={async () => { const r = await api<any>('/email/footer?kind=report&body=' + encodeURIComponent('Dear Sir/Madam,\n\nPlease find the test report attached.\n\nRegards,')); setPreview(r.html); }}>Preview (save settings first)</Button></Group>
      {preview && <iframe title="Email preview" srcDoc={preview} style={{ width: '100%', height: 380, border: '1px solid var(--line)', borderRadius: 8, marginTop: 8, background: '#fff' }} />}
    </Paper>
  );
}

/** Company policy: require two-step verification for every user. */
function SecuritySettings() {
  const { data: me } = useApi<any>('/account/security', []);
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  return (
    <Stack maw={720}>
      <Paper withBorder p="md">
        <Text fw={600}>Two-step verification for everyone</Text>
        <Text size="xs" c="dimmed" mb="sm">When on, every user must set up an authenticator app (Google or Microsoft Authenticator) the next time they sign in. Turn it on for your own account first under My account → Security.</Text>
        <Switch disabled={busy} label={me.required ? 'Required for all users' : 'Optional (each user decides)'} checked={me.required}
          onChange={async (e) => { setBusy(true); try { await api('/account/admin/policy', { body: { require2fa: e.currentTarget.checked } }); ok('Security policy updated'); window.location.reload(); } finally { setBusy(false); } }} />
      </Paper>
      <Paper withBorder p="md">
        <Text fw={600}>Full backup</Text>
        <Text size="xs" c="dimmed" mb="sm">Download everything – clients, documents, observation sheets, settings and attachments – as one file. Keep a copy every month outside the server (e.g. on your Google Drive). The server also makes its own nightly backups.</Text>
        <Button variant="light" component="a" href="/api/system/backup" leftSection={<IconDownload size={16} />}>Download full backup</Button>
      </Paper>
      <Paper withBorder p="md">
        <Text fw={600}>Sign-in alerts</Text>
        <Text size="sm">Users get an email (and a notification in the app) when their account signs in on a new device or browser. Lost phone? An administrator can reset a user's two-step verification under Users & roles.</Text>
      </Paper>
    </Stack>
  );
}

/** Brochure and other company documents, kept in one place and attachable to any email. */
function CompanyDocuments() {
  const { data, reload } = useApi<any[]>('/files?entity=company&entity_id=0', []);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    try { const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
      await api('/files', { body: { entity: 'company', entity_id: 0, name: file.name, mime: file.type || 'application/pdf', data: dataUrl } }); ok('Uploaded'); reload(); }
    finally { setBusy(false); }
  };
  return (
    <Stack maw={820}>
      <Alert variant="light">Keep the company brochure, accreditation certificate, scope of accreditation and rate cards here. They can be attached to any quotation, invoice or report email with one click.</Alert>
      <Group><FileButton onChange={upload} accept="application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">{(p) => <Button leftSection={<IconUpload size={16} />} loading={busy} {...p}>Upload document</Button>}</FileButton><Text size="xs" c="dimmed">PDF, image, Word or Excel · up to 10 MB</Text></Group>
      {(data ?? []).map((f) => (
        <Paper key={f.id} withBorder p="sm">
          <Group justify="space-between" wrap="nowrap">
            <div style={{ minWidth: 0 }}>
              <Group gap={6}><Anchor href={`/api/files/${f.id}/download?inline=1`} target="_blank" fw={600}>{f.name}</Anchor>{/brochure/i.test(f.name) && <Badge size="xs" variant="light">Brochure</Badge>}</Group>
              <Text size="xs" c="dimmed">{Math.max(1, Math.round(f.size / 1024))} KB · {f.uploaded_by_name ?? ''} · {new Date(f.created_at).toLocaleDateString('en-IN')}</Text>
            </div>
            <Group gap={4} wrap="nowrap">
              <ActionIcon variant="subtle" component="a" href={`/api/files/${f.id}/download`}><IconDownload size={16} /></ActionIcon>
              <ActionIcon variant="subtle" color="red" onClick={async () => { if (!window.confirm(`Delete ${f.name}?`)) return; await api(`/files/${f.id}`, { method: 'DELETE' }); reload(); }}><IconTrash size={16} /></ActionIcon>
            </Group>
          </Group>
        </Paper>
      ))}
      {!(data ?? []).length && <Text size="sm" c="dimmed">No documents yet.</Text>}
    </Stack>
  );
}

/** WhatsApp message templates used by the “WhatsApp” buttons on quotations, invoices, reports, samples, clients and ledgers. */
function WhatsAppSettings({ v, set }: { v: any; set: (path: string, value: unknown) => void }) {
  const w = v.whatsapp ?? {};
  const [key, setKey] = useState(WA_TEMPLATES[0].key);
  const t = WA_TEMPLATES.find((x) => x.key === key)!;
  const text = w.templates?.[key] ?? t.text;
  const sample = fillWa(text, { contact: 'Mr. Rao', client: 'ABC Constructions', site: 'Tower B foundation', number: key === 'report' ? 'TR/26/0142' : key === 'sample' ? '' : 'QT/26/0087', date: '04-11-2026', amount: '23,600.00', balance: '23,600.00', due_date: '04-12-2026', link: `${window.location.origin}/d/…`, tests: 'Compressive strength, Slump', sample_code: 'S-26-0311', upi: v.bank?.upi, bank: [v.bank?.name && `A/c name: ${v.bank.name}`, v.bank?.account && `A/c no: ${v.bank.account}`, v.bank?.ifsc && `IFSC: ${v.bank.ifsc}`].filter(Boolean).join('\n'), sender: 'Your name', company: v.name, phone: v.phone, website: v.website });
  return (
    <Stack maw={1100}>
      <Alert variant="light" color="green" icon={<IconBrandWhatsapp />} title="How WhatsApp works here">
        The green <b>WhatsApp</b> buttons open WhatsApp (phone app, WhatsApp Web or Desktop) with the message and a secure link already filled in – you only press Send.
        The client opens the link to view and download the PDF. On phones you can also share the PDF file itself. No WhatsApp Business API account or per-message charges are needed.
        Every message sent is saved as a WhatsApp activity under the client’s Follow-ups.
      </Alert>
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <TextInput label="Default country code" description="Added to 10-digit numbers" value={w.countryCode ?? '91'} onChange={(e) => set('whatsapp.countryCode', e.currentTarget.value.replace(/\D/g, '').slice(0, 4))} />
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Stack gap="xs">
          <Select label="Template" data={WA_TEMPLATES.map((x) => ({ value: x.key, label: `${x.label}${w.templates?.[x.key] ? ' (customised)' : ''}` }))} value={key} onChange={(x) => x && setKey(x)} allowDeselect={false} />
          <Textarea label="Message" autosize minRows={14} maxRows={24} value={text} onChange={(e) => set(`whatsapp.templates.${key}`, e.currentTarget.value)}
            description="Use *bold* and _italic_ like in WhatsApp. Lines whose placeholders are empty (e.g. UPI when none is set) are left out automatically." />
          <Group gap="xs">
            {w.templates?.[key] && <Button size="xs" variant="subtle" onClick={() => { const n = { ...(w.templates ?? {}) }; delete n[key]; set('whatsapp.templates', n); }}>Reset to default</Button>}
            <Text size="xs" c="dimmed">Remember to Save settings.</Text>
          </Group>
          <Text size="xs" fw={600} mt={4}>Placeholders</Text>
          <Group gap={6}>{WA_PLACEHOLDERS.map((p) => <Badge key={p.key} variant="light" color="gray" style={{ textTransform: 'none', cursor: 'pointer' }} title={p.label}
            onClick={() => set(`whatsapp.templates.${key}`, `${text}{{${p.key}}}`)}>{`{{${p.key}}}`}</Badge>)}</Group>
        </Stack>
        <Stack gap="xs">
          <Text size="sm" fw={500}>Preview with sample values</Text>
          <Paper radius="md" p="md" style={{ background: '#efeae2', minHeight: 300 }}>
            <div style={{ background: '#d9fdd3', borderRadius: '10px 0 10px 10px', padding: '8px 10px', marginLeft: 'auto', maxWidth: '92%', whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.4, color: '#111b21', boxShadow: '0 1px 1px rgba(0,0,0,.12)' }}
              dangerouslySetInnerHTML={{ __html: sample.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>') }} />
          </Paper>
          <Text size="xs" c="dimmed">Used on: {t.for.map((f) => ({ quote: 'quotations', invoice: 'invoices', report: 'test reports', reminder: 'ledger reminders', sample: 'sample register', client: 'client page' } as Record<string, string>)[f]).join(', ')}</Text>
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}
