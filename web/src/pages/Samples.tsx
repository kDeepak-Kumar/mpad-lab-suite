import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Group, Modal, MultiSelect, NumberInput, Select, SimpleGrid, Stack, Text, TextInput, Badge, Paper, SegmentedControl, Divider } from '@mantine/core';
import { IconPlus, IconTruckDelivery } from '@tabler/icons-react';
import { JOB_STATUS } from './Outsourcing';
import { api, dmy, ok, useApi, localToday } from '../api';
import { useCan, useFields, useMe, isAdmin } from '../ctx';
import { PageHeader, StatusBadge, TypeBadge } from '../components/ui';
import { ListView, useCustomCols, type Col } from '../components/ListView';
import { RecordForm, missingRequired } from '../components/RecordForm';
import { WhatsAppButton, WhatsAppModal } from '../components/WhatsApp';
import { AdminDelete, RecordInfo } from '../components/RecordAdmin';

export function NewSampleModal({ preset, onClose }: { preset?: { work_order_id?: number; client_id?: number; site_id?: number | null; customer_ref?: string; quoteCatalogIds?: number[]; accreditation?: string }; onClose: (saved: boolean) => void }) {
  const me = useMe();
  const { data: clients } = useApi<any[]>('/clients');
  const { data: catalog } = useApi<any[]>('/catalog');
  const { data: users } = useApi<any[]>('/users');
  const { data: wos } = useApi<any[]>('/workorders');
  const [v, setV] = useState<any>({ received_date: localToday(), condition: 'Satisfactory', source: 'Sample supplied by the customer', material: 'Soil', accreditation: preset?.accreditation ?? 'NABL', ...preset });
  const [tests, setTests] = useState<string[]>([]);
  const { data: client } = useApi<any>(v.client_id ? `/clients/${v.client_id}` : null, [v.client_id]);
  const [tech, setTech] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fields = useFields('sample');
  useEffect(() => {
    if (catalog && preset?.quoteCatalogIds?.length && !tests.length) setTests(catalog.filter((c) => preset.quoteCatalogIds!.includes(c.id) && c.obs_template_code).map((c) => String(c.id)));
  }, [catalog]);
  const testable = (catalog ?? []).filter((c) => c.active && c.obs_template_code);
  const chosen = testable.filter((c) => tests.includes(String(c.id)));
  const outOfScope = v.accreditation === 'NABL' ? chosen.filter((c) => !c.nabl) : [];
  const missing = missingRequired(fields as never, v);
  const save = async () => {
    setBusy(true);
    try {
      const { quoteCatalogIds, ...rest } = v;
      const r = await api<any>('/samples', { body: {
        ...rest, client_id: Number(v.client_id), site_id: v.site_id ? Number(v.site_id) : null, work_order_id: v.work_order_id ? Number(v.work_order_id) : null,
        tests: tests.map((id) => ({ catalog_id: Number(id), assigned_to: tech ? Number(tech) : null })),
      } });
      ok(`Sample ${r.code} registered${r.ulr ? ` · ULR ${r.ulr}` : ''}`); onClose(true);
    } finally { setBusy(false); }
  };
  return (
    <Modal opened onClose={() => onClose(false)} title="Register sample (inward)" size="xl">
      <Stack>
        <SegmentedControl fullWidth value={v.accreditation} onChange={(x) => setV({ ...v, accreditation: x })} data={[{ value: 'NABL', label: 'NABL report (ULR, NABL letterhead)' }, { value: 'Non-NABL', label: 'Non-NABL report' }]} />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select label="Client" required searchable data={(clients ?? []).map((c) => ({ value: String(c.id), label: c.name }))} value={v.client_id ? String(v.client_id) : null} onChange={(x) => setV({ ...v, client_id: x, site_id: null, work_order_id: null })} disabled={!!preset?.work_order_id} />
          <Select label="Site" clearable data={(client?.sites ?? []).map((s: any) => ({ value: String(s.id), label: s.name }))} value={v.site_id ? String(v.site_id) : null} onChange={(x) => setV({ ...v, site_id: x })} />
          <Select label="Work order" clearable data={(wos ?? []).filter((w) => String(w.client_id) === String(v.client_id)).map((w) => ({ value: String(w.id), label: `${w.number}${w.site_name ? ' · ' + w.site_name : ''}` }))} value={v.work_order_id ? String(v.work_order_id) : null} onChange={(x) => setV({ ...v, work_order_id: x })} disabled={!!preset?.work_order_id} />
        </SimpleGrid>
        <Divider label="Sample details" labelPosition="left" />
        <RecordForm object="sample" value={v} onChange={setV} cols={3} exclude={['accreditation']} />
        <NumberInput mt="sm" w={260} label="Retain sample for (days)" description="Blank = default for this material (Settings → Defaults)" min={0} max={3650} value={v.retention_days ?? ''} onChange={(x) => setV({ ...v, retention_days: x === '' ? null : Number(x) })} />
        <Divider label="Tests" labelPosition="left" />
        <MultiSelect label="Tests to perform" required searchable data={testable.filter((c) => !v.material || c.material === v.material || tests.includes(String(c.id))).map((c) => ({ value: String(c.id), label: `${c.report_name || c.billing_name} (${c.method || c.code})${c.nabl ? '' : ' · Non-NABL'}` }))} value={tests} onChange={setTests} />
        {outOfScope.length > 0 && <Alert color={isAdmin(me) ? 'orange' : 'red'} variant="light">Not in NABL scope: {outOfScope.map((c) => c.report_name || c.billing_name).join(', ')}. {isAdmin(me) ? 'As System Admin you may still register them.' : 'Register those as a separate Non-NABL sample.'}</Alert>}
        <Select label="Assign to technician" clearable data={(users ?? []).filter((u) => ['technician', 'reviewer', 'owner', 'admin', 'signatory'].includes(u.role)).map((u) => ({ value: String(u.id), label: u.name }))} value={tech} onChange={setTech} />
        <Text size="xs" c="dimmed">The job code{v.accreditation === 'NABL' ? ' and ULR' : ''} are generated on save. Due dates follow each test’s turnaround in the rate card.</Text>
        <Group justify="flex-end"><Button loading={busy} disabled={!v.client_id || !tests.length || missing.length > 0 || (outOfScope.length > 0 && !isAdmin(me))} onClick={save}>Register sample</Button></Group>
      </Stack>
    </Modal>
  );
}

export function SamplesPage() {
  const [sp, setSp] = useSearchParams();
  const { data, reload } = useApi<any[]>('/samples');
  const nav = useNavigate();
  const can = useCan();
  const custom = useCustomCols('sample');
  const openId = sp.get('open');
  const { data: sample, reload: reloadSample } = useApi<any>(openId ? `/samples/${openId}` : null, [openId]);
  const [edit, setEdit] = useState<any>(null);
  const [waSample, setWaSample] = useState<any>(null);
  const [dispose, setDispose] = useState<any>(null);
  const cols: Col[] = [
    { key: 'code', label: 'Job code', render: (s) => <Text size="sm" fw={550}>{s.code}</Text> },
    { key: 'accreditation', label: 'Type', type: 'badge' },
    { key: 'ulr', label: 'ULR', render: (s) => <Text size="xs">{s.ulr}</Text> },
    { key: 'received_date', label: 'Received', type: 'date' },
    { key: 'client_name', label: 'Client', filter: 'select' },
    { key: 'site_name', label: 'Site', filter: 'select' },
    { key: 'material', label: 'Material', filter: 'select' },
    { key: 'tests', label: 'Tests', value: (s) => s.tests.map((t: any) => t.report_name || t.billing_name).join(', '),
      render: (s) => <Group gap={4}>{s.tests.map((t: any, i: number) => <Badge key={i} size="xs" variant="light" color={t.status === 'reported' ? 'teal' : t.status === 'accepted' ? 'green' : 'gray'} style={{ textTransform: 'none' }}>{t.report_name || t.billing_name}</Badge>)}</Group> },
    { key: 'status', label: 'Status', type: 'status' },
    { key: 'disposal', label: 'Disposal', filter: 'select', value: (s) => (s.disposed_at ? 'Disposed' : s.dispose_after && s.dispose_after <= localToday() ? 'Due' : 'Retained'),
      render: (s) => (s.disposed_at ? <Badge size="sm" variant="light" color="gray">Disposed {dmy(s.disposed_at)}</Badge> : s.dispose_after ? <Badge size="sm" variant="light" color={s.dispose_after <= localToday() ? 'orange' : 'teal'}>{s.dispose_after <= localToday() ? 'Due' : 'Keep till'} {dmy(s.dispose_after)}</Badge> : '') },
    { key: 'quantity', label: 'Quantity', hidden: true }, { key: 'condition', label: 'Condition', hidden: true }, { key: 'customer_ref', label: 'Customer ref', hidden: true },
    ...custom,
  ];
  return (
    <>
      <PageHeader title="Sample register" subtitle="Every sample received, its job code, ULR and test status" actions={can('sample.create') && <Button leftSection={<IconPlus size={16} />} onClick={() => setSp({ new: '1' })}>Register sample</Button>} />
      <ListView id="samples" rows={data} columns={cols} onRow={(s) => setSp({ open: String(s.id) })}
        quickFilters={[{ label: 'NABL', filters: [{ key: 'accreditation', op: 'in', value: ['NABL'] }] }, { label: 'Non-NABL', filters: [{ key: 'accreditation', op: 'in', value: ['Non-NABL'] }] }, { label: 'In testing', filters: [{ key: 'status', op: 'in', value: ['registered', 'in_test'] }] }]} />
      {sp.get('new') === '1' && <NewSampleModal preset={sp.get('client') ? { client_id: Number(sp.get('client')) } : undefined} onClose={(saved) => { setSp({}); if (saved) reload(); }} />}
      <Modal opened={!!openId} onClose={() => setSp({})} title={sample ? <Group gap="xs">Sample {sample.code}<TypeBadge value={sample.accreditation} /><StatusBadge status={sample.status} /></Group> : 'Sample'} size="xl">
        {sample && (
          <Stack>
            {edit ? (
              <Paper withBorder p="md">
                <RecordForm object="sample" value={edit} onChange={setEdit} cols={3} />
                <Group justify="flex-end" mt="sm"><Button variant="default" onClick={() => setEdit(null)}>Cancel</Button>
                  <Button onClick={async () => { const { accreditation, material, received_date, quantity, condition, source, customer_ref, sample_label, specification, description, custom: cu } = edit; await api(`/samples/${sample.id}`, { method: 'PUT', body: { accreditation, material, received_date, quantity, condition, source, customer_ref, sample_label, specification, description, custom: cu } }); ok('Sample updated'); setEdit(null); reloadSample(); reload(); }}>Save</Button></Group>
              </Paper>
            ) : (
              <Paper withBorder p="sm">
                <SimpleGrid cols={2} spacing={4}>
                  {[['Client', sample.client?.name], ['ULR', sample.ulr || '—'], ['Received', dmy(sample.received_date)], ['Retention', sample.disposed_at ? `Disposed ${dmy(sample.disposed_at)} – ${sample.disposal_method}${sample.disposal_note ? ` (${sample.disposal_note})` : ''}` : sample.dispose_after ? `${sample.retention_days} days · keep till ${dmy(sample.dispose_after)}` : '—'], ['Material', sample.material], ['Quantity', sample.quantity], ['Condition', sample.condition], ['Source', sample.source], ['Customer ref', sample.customer_ref], ['Description', sample.description]].map(([k, val]) => <Text key={k} size="sm"><Text span c="dimmed">{k}: </Text>{val}</Text>)}
                </SimpleGrid>
              </Paper>
            )}
            <SampleOutsourcing sample={sample} />
            <ListView id="sample-tests" rows={sample.tests} onRow={(t) => nav(`/tests/${t.id}`)} columns={[{ key: 'test', label: 'Test', value: (t) => t.report_name || t.billing_name }, { key: 'assignee', label: 'Assigned' }, { key: 'due_date', label: 'Due', type: 'date' }, { key: 'status', label: 'Status', type: 'status' }]} />
            <Group justify="flex-end">
              {can('sample.edit') && !edit && <Button variant="default" onClick={() => setEdit({ ...sample })}>Edit details</Button>}
              <Button variant="default" onClick={() => printLabel(sample)}>Print sample label</Button>
              {can('sample.edit') && (sample.disposed_at
                ? <Button variant="subtle" color="gray" onClick={async () => { await api(`/samples/${sample.id}/disposal`, { method: 'DELETE' }); reloadSample(); reload(); }}>Undo disposal</Button>
                : <Button variant="default" onClick={() => setDispose({ date: localToday(), method: 'Discarded as per lab procedure', note: '' })}>Record disposal</Button>)}
              <WhatsAppButton label="Acknowledge on WhatsApp" variant="light" onClick={() => setWaSample(sample)} />
              <AdminDelete object="sample" id={sample.id} compact onDeleted={() => { setSp({}); reload(); }} />
            </Group>
            <RecordInfo object="sample" id={sample.id} />
          </Stack>
        )}
      </Modal>
      <Modal opened={Boolean(dispose)} onClose={() => setDispose(null)} title={`Record disposal · ${sample?.code ?? ''}`}>
        {dispose && <Stack>
          <TextInput type="date" label="Date" value={dispose.date} onChange={(e) => setDispose({ ...dispose, date: e.currentTarget.value })} />
          <Select label="What was done" data={['Discarded as per lab procedure', 'Returned to customer', 'Retained on customer request', 'Sent to external lab', 'Consumed in testing']} value={dispose.method} onChange={(x) => setDispose({ ...dispose, method: x })} allowDeselect={false} />
          <TextInput label="Remarks (optional)" value={dispose.note} onChange={(e) => setDispose({ ...dispose, note: e.currentTarget.value })} />
          <Group justify="flex-end"><Button onClick={async () => { await api(`/samples/${sample.id}/disposal`, { body: dispose }); ok('Disposal recorded'); setDispose(null); reloadSample(); reload(); }}>Save</Button></Group>
        </Stack>}
      </Modal>
      {waSample && <WhatsAppModal context="sample" clientId={waSample.client_id} title={`Sample ${waSample.code} received`} link={{ kind: 'sample', id: waSample.id }}
        vars={{ client: waSample.client?.name, sample_code: waSample.code, date: dmy(waSample.received_date), tests: [...new Set((waSample.tests ?? []).map((t: any) => t.report_name || t.billing_name))].join(', ') }}
        onClose={() => setWaSample(null)} />}
    </>
  );
}

function printLabel(s: any) {
  const w = window.open('', '_blank', 'width=420,height=300');
  if (!w) return;
  w.document.write(`<html><body style="font-family:Arial;margin:12px"><div style="border:2px solid #000;padding:10px;width:340px">
    <div style="font-size:18px;font-weight:bold">${s.code}</div><div>${s.client?.name ?? ''}</div>
    <div>${s.accreditation ?? ''} · Material: ${s.material ?? ''} · Qty: ${s.quantity ?? ''}</div><div>Received: ${dmy(s.received_date)}</div>
    ${s.ulr ? `<div style="font-size:11px">ULR: ${s.ulr}</div>` : ''}<div style="font-size:11px">Tests: ${s.tests.map((t: any) => t.report_name || t.billing_name).join(', ')}</div></div>
    <script>window.onload=()=>{window.print();}</script></body></html>`);
  w.document.close();
}

/** Outsourced jobs of a sample, and sending more of its tests to an external lab. */
function SampleOutsourcing({ sample }: { sample: any }) {
  const nav = useNavigate();
  const can = useCan();
  const { data: jobs, reload } = useApi<any[]>(`/outsourcing?sample_id=${sample.id}`, [sample.id]);
  const { data: vendors } = useApi<any[]>(can('manageOutsourcing') ? '/vendors' : null, []);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<{ tests: string[]; vendor: string | null }>({ tests: [], vendor: null });
  const taken = new Set((jobs ?? []).filter((j) => j.status !== 'cancelled').flatMap((j) => j.test_ids));
  const free = sample.tests.filter((t: any) => !taken.has(t.id) && ['pending', 'in_progress'].includes(t.status));
  if (!jobs?.length && !can('manageOutsourcing')) return null;
  return (
    <Paper withBorder p="sm" radius="md">
      <Group justify="space-between">
        <Group gap="xs"><IconTruckDelivery size={16} color="#7a5af8" /><Text size="sm" fw={600}>External laboratory</Text>
          {(jobs ?? []).map((j) => <Badge key={j.id} variant="light" color={JOB_STATUS[j.status]?.color} style={{ cursor: 'pointer', textTransform: 'none' }} onClick={() => nav(`/outsourcing?open=${j.id}`)}>{j.vendor_name ?? 'Lab not chosen'} · {JOB_STATUS[j.status]?.label}</Badge>)}
          {!jobs?.length && <Text size="xs" c="dimmed">All tests in-house</Text>}</Group>
        {can('manageOutsourcing') && free.length > 0 && <Button size="compact-xs" variant="light" onClick={() => setOpen(true)}>Outsource tests…</Button>}
      </Group>
      <Modal opened={open} onClose={() => setOpen(false)} title="Send tests to an external laboratory">
        <Stack>
          <MultiSelect label="Tests" data={free.map((t: any) => ({ value: String(t.id), label: t.report_name || t.billing_name }))} value={v.tests} onChange={(x) => setV({ ...v, tests: x })} />
          <Select label="External laboratory" searchable clearable data={(vendors ?? []).map((x) => ({ value: String(x.id), label: x.name }))} value={v.vendor} onChange={(x) => setV({ ...v, vendor: x })} description="Add labs under Purchases → Vendors" />
          <Group justify="flex-end"><Button disabled={!v.tests.length} onClick={async () => { const r = await api<any>('/outsourcing', { body: { sample_id: sample.id, test_ids: v.tests.map(Number), vendor_id: v.vendor ? Number(v.vendor) : null } }); setOpen(false); reload(); nav(`/outsourcing?open=${r.id}`); }}>Create job</Button></Group>
        </Stack>
      </Modal>
    </Paper>
  );
}
