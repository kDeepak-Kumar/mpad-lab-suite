import { useEffect, useState } from 'react';
import { FormSheet } from '../components/Sheet';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Badge, Button, Divider, Drawer, Group, Modal, MultiSelect, Paper, SegmentedControl, Select, SimpleGrid, Stack, Text, TextInput, Textarea, ThemeIcon } from '@mantine/core';
import { IconBolt, IconCertificate, IconCircleCheck, IconFileAnalytics, IconLink, IconPencil, IconPlus, IconUserPlus } from '@tabler/icons-react';
import { api, dmy, localToday, ok, useApi } from '../api';
import { useCan, usePicklist } from '../ctx';
import { ListView, type Col } from '../components/ListView';
import { PageHeader, StatusBadge } from '../components/ui';
import { ClientForm } from './Clients';
import { RecordInfo } from '../components/RecordAdmin';

interface Quick { id: number; code: string; material: string; description?: string; received_date: string; status: string; client_type: string; client_name: string; customer: Record<string, string>; tests: { id: number; status: string; report_name?: string; billing_name?: string }[]; report: { id: number; status: string; number?: string } | null; created_at: string; updated_at?: string }
const stage = (r: Quick) => (r.client_type !== 'system' ? 'Registered' : r.report ? (r.report.status === 'issued' ? 'Report issued' : 'Report in progress') : r.tests.every((t) => ['submitted', 'accepted', 'reported'].includes(t.status)) ? 'Ready for report' : 'Observations to enter');

/** Tests, observations and a signed report without registering the sample or customer first. */
export function QuickReportsPage() {
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  const { data, reload } = useApi<Quick[]>('/quick-reports');
  const open = sp.get('open');
  const cols: Col<Quick>[] = [
    { key: 'code', label: 'Quick no.', render: (r) => <Text size="sm" fw={600}>{r.code}</Text> },
    { key: 'customer', label: 'Customer', value: (r) => (r.client_type === 'system' ? r.customer.name : r.client_name) },
    { key: 'material', label: 'Material', filter: 'select' },
    { key: 'tests', label: 'Tests', value: (r) => r.tests.map((t) => t.report_name || t.billing_name).join(', ') },
    { key: 'received_date', label: 'Received', type: 'date' },
    { key: 'stage', label: 'Stage', type: 'badge', value: stage, render: (r) => <Badge size="sm" variant="light" color={({ Registered: 'teal', 'Report issued': 'green', 'Report in progress': 'blue', 'Ready for report': 'orange' } as Record<string, string>)[stage(r)] ?? 'gray'} style={{ textTransform: 'none' }}>{stage(r)}</Badge> },
    { key: 'report', label: 'Report', value: (r) => r.report?.number ?? (r.report ? 'Draft' : '') },
  ];
  return (
    <>
      <PageHeader title="Quick test reports" subtitle="Enter observations and issue a signed report without registering the sample first. Link it to a customer and sample later if needed."
        actions={(can('enterObservations') || can('prepareReports')) && <Button leftSection={<IconPlus size={16} />} onClick={() => setSp({ new: '1' })}>New quick report</Button>} />
      <Alert variant="light" mb="md" icon={<IconBolt size={18} />}>
        Use this for walk-in or urgent jobs. Quick reports are <b>Non-NABL</b> (a ULR is issued only for registered NABL samples). Signatures, seal, preview, PDF download and QR verification work as for any report.
      </Alert>
      <ListView id="quick-reports" rows={data ?? null} columns={cols} onRow={(r) => setSp({ open: String(r.id) })}
        quickFilters={[{ label: 'Not registered', filters: [{ key: 'stage', op: 'in', value: ['Observations to enter', 'Ready for report', 'Report in progress', 'Report issued'] }] }]}
        empty="No quick reports yet." />
      {sp.get('new') === '1' && <NewQuick onClose={(id) => { setSp(id ? { open: String(id) } : {}); reload(); }} />}
      {open && <QuickDrawer id={Number(open)} onClose={() => { setSp({}); reload(); }} />}
    </>
  );
}

function NewQuick({ onClose }: { onClose: (id?: number) => void }) {
  const { data: catalog } = useApi<any[]>('/catalog');
  const materials = usePicklist('material');
  const [c, setC] = useState<Record<string, string>>({ name: '' });
  const [v, setV] = useState<Record<string, string>>({ material: 'Concrete', received_date: localToday(), source: 'Sample supplied by the customer' });
  const [tests, setTests] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const testable = (catalog ?? []).filter((x) => x.active !== false && x.active !== 0 && x.obs_template_code);
  const forMat = testable.filter((x) => !v.material || x.material === v.material);
  const C = (k: string, label: string, props: any = {}) => <TextInput label={label} value={c[k] ?? ''} onChange={(e) => setC({ ...c, [k]: e.currentTarget.value })} {...props} />;
  const V = (k: string, label: string, props: any = {}) => <TextInput label={label} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.currentTarget.value })} {...props} />;
  const save = async () => {
    setBusy(true);
    try {
      const r = await api<{ id: number; code: string }>('/quick-reports', { body: { customer: c, ...v, tests: tests.map(Number) } });
      ok(`Quick report ${r.code} started – enter the observations next`); onClose(r.id);
    } catch { /* shown */ } finally { setBusy(false); }
  };
  return (
    <FormSheet opened onClose={() => onClose()} title="New quick test report" size="xl">
      <Stack>
        <Text fw={600} size="sm">Customer (as it should appear on the report)</Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>{C('name', 'Customer name', { required: true, 'data-autofocus': true })}{C('project', 'Project / site')}{C('contact', 'Contact person')}{C('phone', 'Phone')}{C('email', 'Email')}{C('gstin', 'GSTIN')}</SimpleGrid>
        <Textarea label="Address" autosize value={c.address ?? ''} onChange={(e) => setC({ ...c, address: e.currentTarget.value })} />
        <Divider />
        <Text fw={600} size="sm">Sample</Text>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select label="Material" data={materials} value={v.material ?? null} onChange={(x) => { setV({ ...v, material: x ?? '' }); setTests([]); }} searchable />
          {V('received_date', 'Received on', { type: 'date' })}{V('quantity', 'Quantity')}
          {V('description', 'Description')}{V('sample_label', 'Sample mark / ID')}{V('customer_ref', 'Customer reference')}
          {V('specification', 'Specification / grade')}{V('source', 'Source')}
        </SimpleGrid>
        <MultiSelect label="Tests" placeholder={forMat.length ? 'Choose tests' : 'No tests with an observation sheet for this material'} searchable data={forMat.map((x) => ({ value: String(x.id), label: x.report_name || x.billing_name }))} value={tests} onChange={setTests} />
        <Group className="form-actions" justify="flex-end"><Button variant="default" onClick={() => onClose()}>Cancel</Button><Button loading={busy} disabled={!c.name?.trim() || !tests.length} onClick={save}>Start and enter observations</Button></Group>
      </Stack>
    </FormSheet>
  );
}

function QuickDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const nav = useNavigate();
  const can = useCan();
  const { data: q, reload } = useApi<any>(`/quick-reports/${id}`, [id]);
  const [busy, setBusy] = useState(false);
  const [reg, setReg] = useState(false);
  const [editCu, setEditCu] = useState(false);
  if (!q) return <Drawer opened onClose={onClose} position="right" size="lg" title="Quick report"><Text size="sm" c="dimmed">Loading…</Text></Drawer>;
  const ready = q.tests.every((t: any) => ['submitted', 'accepted', 'reported'].includes(t.status));
  const makeReport = async () => {
    setBusy(true);
    try { const r = await api<{ id: number }>(`/quick-reports/${id}/report`, { method: 'POST' }); ok('Report drafted – check it, then submit for signing'); nav(`/documents/${r.id}`); } catch { /* shown */ } finally { setBusy(false); }
  };
  return (
    <Drawer opened onClose={onClose} position="right" size="lg" title={<Group gap={8}><ThemeIcon variant="light" radius="md"><IconBolt size={16} /></ThemeIcon><Text fw={650}>{q.code}</Text>{q.registered ? <Badge color="teal" variant="light">Registered</Badge> : <Badge variant="light" color="orange">Not registered</Badge>}</Group>}>
      <Stack>
        <Paper withBorder p="sm" radius="md">
          <Group justify="space-between" mb={4}><Text size="xs" c="dimmed" fw={600}>CUSTOMER</Text>{!q.registered && <Button size="compact-xs" variant="subtle" leftSection={<IconPencil size={12} />} onClick={() => setEditCu(true)}>Edit</Button>}</Group>
          {q.registered ? <Text fw={600}>{q.client?.name}</Text> : <><Text fw={600}>{q.customer.name}</Text><Text size="sm" c="dimmed">{[q.customer.project, q.customer.address, q.customer.phone, q.customer.email, q.customer.gstin].filter(Boolean).join(' · ')}</Text></>}
          <Text size="sm" mt={6}>{q.material}{q.description ? ` – ${q.description}` : ''} · received {dmy(q.received_date)}{q.quantity ? ` · ${q.quantity}` : ''}</Text>
        </Paper>

        <div>
          <Text size="sm" fw={650} mb={6}>1 · Observations</Text>
          <Stack gap={6}>
            {q.tests.map((t: any) => (
              <Paper key={t.id} withBorder p="xs" radius="md">
                <Group justify="space-between" wrap="nowrap">
                  <div><Text size="sm" fw={550}>{t.report_name || t.billing_name}</Text><Text size="xs" c="dimmed">{t.assignee ? `Assigned to ${t.assignee}` : ''}</Text></div>
                  <Group gap={6} wrap="nowrap"><StatusBadge status={t.status} /><Button size="compact-sm" variant={['pending', 'in_progress', 'returned'].includes(t.status) ? 'filled' : 'default'} onClick={() => nav(`/tests/${t.id}`)}>{['pending', 'in_progress', 'returned'].includes(t.status) ? 'Enter' : 'Open'}</Button></Group>
                </Group>
              </Paper>
            ))}
          </Stack>
        </div>

        <div>
          <Text size="sm" fw={650} mb={6}>2 · Report</Text>
          {q.report ? (
            <Group><Button leftSection={<IconCertificate size={16} />} onClick={() => nav(`/documents/${q.report.id}`)}>Open report – preview, sign & download</Button><StatusBadge status={q.report.status} />{q.report.number && <Text size="sm">{q.report.number}</Text>}</Group>
          ) : (
            <>
              <Button leftSection={<IconFileAnalytics size={16} />} disabled={!ready || !can('prepareReports')} loading={busy} onClick={makeReport}>Create report</Button>
              <Text size="xs" c="dimmed" mt={4}>{!can('prepareReports') ? 'Ask a reviewer or the technical manager to create the report.' : ready ? 'Submitted sheets are accepted by you when the report is created (recorded in the history).' : 'Enter and submit every observation sheet first.'}</Text>
            </>
          )}
        </div>

        <div>
          <Text size="sm" fw={650} mb={6}>3 · Register to a customer (optional)</Text>
          {q.registered ? <Group gap={6}><IconCircleCheck size={16} color="#067647" /><Text size="sm">Registered to <b>{q.client?.name}</b> as sample {q.code}. <Text span c="dimmed" size="xs">(was {q.data?.quickCode})</Text></Text><Button size="compact-sm" variant="subtle" onClick={() => nav(`/samples?open=${q.id}`)}>Open sample</Button></Group>
            : <><Button variant="light" leftSection={<IconLink size={16} />} disabled={!can('sample.create')} onClick={() => setReg(true)}>Register to a customer and sample</Button>
              <Text size="xs" c="dimmed" mt={4}>Links it to an existing or new customer, gives a proper job code, and it appears in the sample register, client history and invoicing. Nothing is entered again.</Text></>}
        </div>
        <RecordInfo object="sample" id={q.id} />
      </Stack>
      {reg && <RegisterModal q={q} onClose={(done) => { setReg(false); if (done) reload(); }} />}
      {editCu && <CustomerModal id={q.id} value={q.customer} onClose={(done) => { setEditCu(false); if (done) reload(); }} />}
    </Drawer>
  );
}

function CustomerModal({ id, value, onClose }: { id: number; value: Record<string, string>; onClose: (done: boolean) => void }) {
  const [c, setC] = useState<Record<string, string>>(value);
  const C = (k: string, label: string) => <TextInput label={label} value={c[k] ?? ''} onChange={(e) => setC({ ...c, [k]: e.currentTarget.value })} />;
  return (
    <Modal opened onClose={() => onClose(false)} title="Customer details on the report">
      <Stack>{C('name', 'Customer name')}{C('project', 'Project / site')}<Textarea label="Address" autosize value={c.address ?? ''} onChange={(e) => setC({ ...c, address: e.currentTarget.value })} />{C('contact', 'Contact person')}{C('phone', 'Phone')}{C('email', 'Email')}{C('gstin', 'GSTIN')}
        <Text size="xs" c="dimmed">A report already drafted keeps its customer block; refresh or recreate the draft to pick up changes.</Text>
        <Group justify="flex-end"><Button disabled={!c.name?.trim()} onClick={async () => { await api(`/quick-reports/${id}/customer`, { method: 'PUT', body: c }); ok('Customer updated'); onClose(true); }}>Save</Button></Group></Stack>
    </Modal>
  );
}

function RegisterModal({ q, onClose }: { q: any; onClose: (done: boolean) => void }) {
  const can = useCan();
  const { data: clients, reload } = useApi<any[]>('/clients');
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [clientId, setClientId] = useState<string | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [woId, setWoId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: client } = useApi<any>(clientId ? `/clients/${clientId}` : null, [clientId]);
  const { data: wos } = useApi<any[]>(clientId ? '/workorders' : null, [clientId]);
  // suggest a client with a similar name to the typed customer
  useEffect(() => { if (clients && !clientId) { const n = String(q.customer.name ?? '').toLowerCase(); const m = clients.find((c) => c.name.toLowerCase() === n || (q.customer.gstin && c.gstin === q.customer.gstin)); if (m) setClientId(String(m.id)); } }, [clients]);
  const register = async () => {
    setBusy(true);
    try { const r = await api<any>(`/quick-reports/${q.id}/register`, { body: { client_id: Number(clientId), site_id: siteId ? Number(siteId) : null, work_order_id: woId ? Number(woId) : null } }); ok(`Registered as sample ${r.code}`); onClose(true); }
    catch { /* shown */ } finally { setBusy(false); }
  };
  return (
    <Modal opened onClose={() => onClose(false)} title="Register to a customer and sample" size={mode === 'new' ? 'xl' : 'md'}>
      <Stack>
        <SegmentedControl value={mode} onChange={(x) => setMode(x as never)} data={[{ value: 'existing', label: 'Existing customer' }, { value: 'new', label: 'New customer', disabled: !can('client.create') }]} />
        {mode === 'new' ? (
          <ClientForm initial={{ name: q.customer.name, address: q.customer.address, gstin: q.customer.gstin, phone: q.customer.phone, email: q.customer.email, type: 'company' }}
            onCancel={() => setMode('existing')} onSaved={async (id) => { await reload(); setClientId(String(id)); setMode('existing'); ok('Customer created – now confirm the registration'); }} />
        ) : <>
          <Select label="Customer" searchable data={(clients ?? []).map((c) => ({ value: String(c.id), label: c.name }))} value={clientId} onChange={(x) => { setClientId(x); setSiteId(null); setWoId(null); }} />
          {client?.sites?.length > 0 && <Select label="Site / project (optional)" clearable data={client.sites.map((s: any) => ({ value: String(s.id), label: s.name }))} value={siteId} onChange={setSiteId} />}
          {(wos ?? []).filter((w) => String(w.client_id) === clientId).length > 0 && <Select label="Work order (optional)" clearable data={(wos ?? []).filter((w) => String(w.client_id) === clientId).map((w) => ({ value: String(w.id), label: `${w.number}${w.customer_ref ? ` · ${w.customer_ref}` : ''}` }))} value={woId} onChange={setWoId} />}
          {q.report && q.report.status !== 'draft' && <Alert variant="light" color="gray">The report is already {q.report.status}; it keeps the customer details printed on it and is linked to this customer.</Alert>}
          <Group justify="flex-end"><Button variant="default" onClick={() => onClose(false)}>Cancel</Button><Button leftSection={<IconUserPlus size={16} />} disabled={!clientId} loading={busy} onClick={register}>Register</Button></Group>
        </>}
      </Stack>
    </Modal>
  );
}
