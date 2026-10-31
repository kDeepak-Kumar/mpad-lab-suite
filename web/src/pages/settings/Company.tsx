import { useEffect, useState } from 'react';
import { Button, FileButton, Group, Image, NumberInput, Paper, Select, SimpleGrid, Stack, Switch, Tabs, Text, TextInput, Textarea, Alert } from '@mantine/core';
import { DEFAULT_NUMBERING, INDIAN_STATES, formatNumber } from '@suite/shared';
import { api, fileToDataUrl, ok, useApi, localToday } from '../../api';
import { PageHeader, Loading } from '../../components/ui';

const NUM_LABEL: Record<string, string> = { quote: 'Quotation', invoice: 'Invoice', workorder: 'Work order', sample: 'Sample job code', ulr: 'ULR number', report: 'Test report', receipt: 'Payment receipt' };

export function CompanySettings() {
  const { data, reload } = useApi<any>('/company');
  const [v, setV] = useState<any>(null);
  useEffect(() => { if (data) setV(data); }, [data]);
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
      <PageHeader title="Company & branding" subtitle="Used in every header, footer, number and document" actions={<Button onClick={save}>Save settings</Button>} />
      <Tabs defaultValue="profile">
        <Tabs.List mb="md"><Tabs.Tab value="profile">Profile</Tabs.Tab><Tabs.Tab value="branding">Branding</Tabs.Tab><Tabs.Tab value="bank">Bank & payments</Tabs.Tab><Tabs.Tab value="numbering">Numbering</Tabs.Tab><Tabs.Tab value="defaults">Defaults & rules</Tabs.Tab><Tabs.Tab value="email">Email</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="profile">
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            {T('Company name (as on documents)', 'name')}{T('Tagline', 'tagline')}{T('CIN', 'cin')}{T('GSTIN', 'gstin')}{T('PAN', 'pan')}
            <Select label="State (for GST)" searchable data={INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.code} – ${s.name}` }))} value={v.stateCode ?? null} onChange={(x) => set('stateCode', x)} />
            {T('Phone(s)', 'phone')}{T('Email', 'email')}{T('Website', 'website')}{T('Jurisdiction city', 'jurisdiction')}
            {T('Accreditation body', 'accreditation.body')}{T('Accreditation certificate no.', 'accreditation.certNo')}{T('Accreditation valid till', 'accreditation.validTill', { type: 'date' })}
          </SimpleGrid>
          <Textarea mt="sm" label="Address (footer)" autosize value={v.address ?? ''} onChange={(e) => set('address', e.currentTarget.value)} />
        </Tabs.Panel>
        <Tabs.Panel value="branding">
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            {img('Company logo', 'logo', 'Shown at top-left of every document')}
            {img('Accreditation symbol', 'accreditationLogo', 'Printed on reports for accredited tests. Follow the accreditation body’s rules for its use.')}
            {img('Company seal / stamp', 'seal', 'Applied automatically when a document is signed and issued')}
          </SimpleGrid>
          <Text size="xs" c="dimmed" mt="sm">Personal signatures are uploaded per user under Users & roles, and are only applied by that user when they sign.</Text>
        </Tabs.Panel>
        <Tabs.Panel value="bank">
          <SimpleGrid cols={{ base: 1, md: 2 }}>{T('Account name', 'bank.name')}{T('Bank', 'bank.bank')}{T('Branch', 'bank.branch')}{T('IFSC', 'bank.ifsc')}{T('Account number', 'bank.account')}{T('UPI ID (optional)', 'bank.upi')}</SimpleGrid>
        </Tabs.Panel>
        <Tabs.Panel value="numbering">
          <Alert variant="light" mb="sm">Tokens: {'{SEQ}'} running number, {'{SEQ:4}'} zero-padded, {'{FY}'} 26-27, {'{YYYY}'} {'{YY}'} {'{MM}'}, {'{CLIENT}'} client short code. Numbers containing {'{FY}'} restart every April; with {'{YYYY}'} every January.</Alert>
          <Stack>
            {Object.keys(DEFAULT_NUMBERING).map((k) => {
              const f = v.numbering?.[k] ?? DEFAULT_NUMBERING[k];
              let preview = ''; try { preview = formatNumber(f, k === 'invoice' ? 183 : 76, { date: localToday(), client: 'ABCD' }); } catch { preview = '?'; }
              return <Group key={k} grow><TextInput label={NUM_LABEL[k]} value={f} onChange={(e) => set(`numbering.${k}`, e.currentTarget.value)} /><TextInput label="Example" value={preview} readOnly variant="filled" /></Group>;
            })}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="defaults">
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            <NumberInput label="Default GST rate (%)" value={v.defaults?.gstRate ?? 18} onChange={(x) => set('defaults.gstRate', Number(x))} />
            {T('Default SAC', 'defaults.sac')}
            <NumberInput label="Quotation validity (days)" value={v.defaults?.validityDays ?? 30} onChange={(x) => set('defaults.validityDays', Number(x))} />
          </SimpleGrid>
          <Textarea mt="sm" label="Default quotation notes (one per line)" autosize minRows={3} value={v.defaults?.quoteNotes ?? ''} onChange={(e) => set('defaults.quoteNotes', e.currentTarget.value)} />
          <Textarea mt="sm" label="Standard report notes (one per line, added to every report after test-specific notes)" autosize minRows={4} value={v.defaults?.reportNotes ?? ''} onChange={(e) => set('defaults.reportNotes', e.currentTarget.value)} />
          <Switch mt="md" label="Allow a person to review observations they entered (not recommended for ISO 17025)" checked={!!v.defaults?.allowSelfReview} onChange={(e) => set('defaults.allowSelfReview', e.currentTarget.checked)} />
        </Tabs.Panel>
        <Tabs.Panel value="email">
          <Alert variant="light" mb="sm">Documents are emailed from your own mailbox. For Gmail use host smtp.gmail.com, port 465 and an App Password. For cPanel mail use mail.yourdomain.com. The password itself is set as SMTP_PASSWORD in the hosting environment, never stored here.</Alert>
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            {T('SMTP host', 'smtp.host')}<NumberInput label="Port" value={v.smtp?.port ?? 465} onChange={(x) => set('smtp.port', Number(x))} />
            {T('Username (email address)', 'smtp.user')}{T('From (name <email>)', 'smtp.from', { placeholder: `${v.name} <lab@example.com>` })}
            <Switch label="Use SSL/TLS (port 465)" checked={v.smtp?.secure ?? true} onChange={(e) => set('smtp.secure', e.currentTarget.checked)} />
          </SimpleGrid>
        </Tabs.Panel>
      </Tabs>
    </>
  );
}
