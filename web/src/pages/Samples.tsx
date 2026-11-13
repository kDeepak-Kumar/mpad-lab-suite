import { ExtraValuesInput } from '../components/ExtraFields';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ActionIcon, Alert, Button, Group, Menu, Modal, MultiSelect, NumberInput, Select, SimpleGrid, Stack, Text, TextInput, Badge, Paper, SegmentedControl, Tooltip } from '@mantine/core';
import { IconArchive, IconCheck, IconDots, IconFileAnalytics, IconPencil, IconPlus, IconPrinter, IconTruckDelivery } from '@tabler/icons-react';
import { JOB_STATUS } from './Outsourcing';
import { api, dmy, ok, useApi, localToday } from '../api';
import { useCan, useFields, useMe, isAdmin } from '../ctx';
import { PageHeader, Pill, SkeletonRows, StatusBadge, TypeBadge } from '../components/ui';
import { ListView, useCustomCols, type Col } from '../components/ListView';
import { RecordForm, missingRequired } from '../components/RecordForm';
import { WhatsAppButton, WhatsAppModal } from '../components/WhatsApp';
import { AdminDelete, RecordInfo } from '../components/RecordAdmin';
import { Facts, FormSection, QuickView, Sheet } from '../components/Sheet';

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
  const [savedAny, setSavedAny] = useState(false);
  const save = async (another: boolean) => {
    setBusy(true);
    try {
      const { quoteCatalogIds, ...rest } = v;
      const r = await api<any>('/samples', { body: {
        ...rest, client_id: Number(v.client_id), site_id: v.site_id ? Number(v.site_id) : null, work_order_id: v.work_order_id ? Number(v.work_order_id) : null,
        tests: tests.map((id) => ({ catalog_id: Number(id), assigned_to: tech ? Number(tech) : null })),
      } });
      ok(`Sample ${r.code} registered${r.ulr ? ` · ULR ${r.ulr}` : ''}`);
      if (!another) { onClose(true); return; }
      // next sample from the same delivery: keep the client, site, work order, report type and receipt details
      setSavedAny(true); setTests([]); setV({ ...v, description: '', sample_label: '', quantity: '', extra: {} });
    } finally { setBusy(false); }
  };
  const S_SAMPLE = ['material', 'description', 'specification', 'sample_label', 'quantity', 'packing', 'condition'];
  const S_RECEIPT = ['received_date', 'received_time', 'source', 'customer_ref', 'customer_ref_date', 'test_location'];
  const needs = (keys: string[] | null) => (fields as any[]).some((f) => missing.includes(f.label) && (keys ? keys.includes(f.key) : ![...S_SAMPLE, ...S_RECEIPT, 'accreditation'].includes(f.key)));
  const blockers = [!v.client_id && 'Client', !tests.length && 'Tests', ...missing].filter(Boolean) as string[];
  const blocked = blockers.length > 0 || (outOfScope.length > 0 && !isAdmin(me));
  return (
    <Sheet title="Register sample" subtitle={<>The job code is assigned when you save.{v.accreditation === 'NABL' ? ' The ULR is given to the test report when it is signed.' : ''}</>} onClose={() => onClose(savedAny)}
      footer={<>
        <span className="grow">{blockers.length ? `Still needed: ${blockers.slice(0, 4).join(', ')}${blockers.length > 4 ? '…' : ''}` : 'Due dates follow each test’s turnaround in the rate card.'}</span>
        <Button variant="subtle" color="gray" onClick={() => onClose(savedAny)}>Cancel</Button>
        {!preset?.work_order_id && <Button variant="default" loading={busy} disabled={blocked} onClick={() => save(true)}>Save & add another</Button>}
        <Button loading={busy} disabled={blocked} onClick={() => save(false)}>Register sample</Button>
      </>}>
      <FormSection n={1} title="Client & site" hint="From the client master">
        <Stack gap="sm">
          <SegmentedControl value={v.accreditation} onChange={(x) => setV({ ...v, accreditation: x })} data={[{ value: 'NABL', label: 'NABL report' }, { value: 'Non-NABL', label: 'Non-NABL report' }]} style={{ alignSelf: 'flex-start' }} aria-label="Report type" />
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <Select label="Client" required searchable data={(clients ?? []).map((c) => ({ value: String(c.id), label: c.name }))} value={v.client_id ? String(v.client_id) : null} onChange={(x) => setV({ ...v, client_id: x, site_id: null, work_order_id: null })} disabled={!!preset?.work_order_id} />
            <Select label="Site / project" clearable placeholder={v.client_id ? 'Optional' : 'Choose a client first'} disabled={!v.client_id} data={(client?.sites ?? []).map((s: any) => ({ value: String(s.id), label: s.name }))} value={v.site_id ? String(v.site_id) : null} onChange={(x) => setV({ ...v, site_id: x })} />
            <Select label="Work order" clearable placeholder="Optional" data={(wos ?? []).filter((w) => String(w.client_id) === String(v.client_id)).map((w) => ({ value: String(w.id), label: `${w.number}${w.site_name ? ' · ' + w.site_name : ''}` }))} value={v.work_order_id ? String(v.work_order_id) : null} onChange={(x) => setV({ ...v, work_order_id: x })} disabled={!!preset?.work_order_id || !v.client_id} />
          </SimpleGrid>
        </Stack>
      </FormSection>
      <FormSection n={2} title="Sample & tests" hint="What came in and what to test">
        <Stack gap="sm">
          <RecordForm object="sample" value={v} onChange={setV} cols={2} only={S_SAMPLE} />
          <MultiSelect label="Tests to perform" required searchable placeholder={tests.length ? undefined : 'Pick from the rate card'} data={testable.filter((c) => !v.material || c.material === v.material || tests.includes(String(c.id))).map((c) => ({ value: String(c.id), label: `${c.report_name || c.billing_name} (${c.method || c.code})${c.nabl ? '' : ' · Non-NABL'}` }))} value={tests} onChange={setTests} />
          {outOfScope.length > 0 && <Alert color={isAdmin(me) ? 'orange' : 'red'} variant="light">Not in NABL scope: {outOfScope.map((c) => c.report_name || c.billing_name).join(', ')}. {isAdmin(me) ? 'As System Admin you may still register them.' : 'Register those as a separate Non-NABL sample.'}</Alert>}
          <Select label="Assign to technician" clearable placeholder="Optional" data={(users ?? []).filter((u) => ['technician', 'reviewer', 'owner', 'admin', 'signatory'].includes(u.role)).map((u) => ({ value: String(u.id), label: u.name }))} value={tech} onChange={setTech} />
        </Stack>
      </FormSection>
      <FormSection n={3} title="Receipt" hint="Date, time, source and customer reference" collapsible defaultOpen={needs(S_RECEIPT)}>
        <RecordForm object="sample" value={v} onChange={setV} cols={2} only={S_RECEIPT} />
      </FormSection>
      <FormSection n={4} title="More details" hint="Other fields, client-specific information, retention" collapsible defaultOpen={needs(null)}>
        <Stack gap="sm">
          <RecordForm object="sample" value={v} onChange={setV} cols={2} exclude={['accreditation', ...S_SAMPLE, ...S_RECEIPT]} />
          <ExtraValuesInput clientId={v.client_id} value={v.extra ?? {}} onChange={(x) => setV({ ...v, extra: x })} />
          <NumberInput w={260} label="Retain sample for (days)" description="Blank = default for this material (Settings → Defaults)" min={0} max={3650} value={v.retention_days ?? ''} onChange={(x) => setV({ ...v, retention_days: x === '' ? null : Number(x) })} />
        </Stack>
      </FormSection>
    </Sheet>
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
  const done = (s: any) => s.tests.filter((t: any) => ['accepted', 'reported'].includes(t.status)).length;
  const cols: Col[] = [
    { key: 'code', label: 'Job code', render: (s) => <span className="tnum" style={{ whiteSpace: 'nowrap' }}>{s.code}</span> },
    { key: 'accreditation', label: 'Type', type: 'badge' },
    { key: 'client_name', label: 'Client · site', filter: 'select', render: (s) => <div className="lv-two" title={`${s.client_name}${s.site_name ? ' · ' + s.site_name : ''}`}><div>{s.client_name}</div>{s.site_name && <small>{s.site_name}</small>}</div> },
    { key: 'material', label: 'Material', filter: 'select' },
    { key: 'tests', label: 'Tests done', value: (s) => s.tests.map((t: any) => t.report_name || t.billing_name).join(', '),
      render: (s) => (s.tests.length ? <Tooltip multiline maw={320} label={s.tests.map((t: any) => `${['accepted', 'reported'].includes(t.status) ? '✓' : '·'} ${t.report_name || t.billing_name}`).join('\n')} styles={{ tooltip: { whiteSpace: 'pre-line' } }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}><span className="bar" style={{ width: 64 }}><span className={done(s) === s.tests.length ? 'ok' : ''} style={{ width: `${(100 * done(s)) / s.tests.length}%` }} /></span><span className="tnum" style={{ fontSize: 12, color: 'var(--muted)' }}>{done(s)} / {s.tests.length}</span></span></Tooltip> : '') },
    { key: 'status', label: 'Status', type: 'status' },
    { key: 'received_date', label: 'Received', type: 'date' },
    { key: 'site_name', label: 'Site', filter: 'select', hidden: true },
    { key: 'ulr', label: 'ULR', hidden: true },
    { key: 'disposal', label: 'Disposal', filter: 'select', hidden: true, value: (s) => (s.disposed_at ? 'Disposed' : s.dispose_after && s.dispose_after <= localToday() ? 'Due' : 'Retained'),
      render: (s) => (s.disposed_at ? <Pill tone="neu">Disposed {dmy(s.disposed_at)}</Pill> : s.dispose_after ? <Pill tone={s.dispose_after <= localToday() ? 'warn' : 'neu'}>{s.dispose_after <= localToday() ? 'Due' : 'Keep till'} {dmy(s.dispose_after)}</Pill> : '') },
    { key: 'quantity', label: 'Quantity', hidden: true }, { key: 'condition', label: 'Condition', hidden: true }, { key: 'customer_ref', label: 'Customer ref', hidden: true },
    ...custom,
  ];
  const close = () => { setEdit(null); setSp({}); };
  const ready = sample?.tests?.some((t: any) => t.status === 'accepted');
  const saveEdit = async () => { const { accreditation, material, received_date, received_time, quantity, packing, condition, source, customer_ref, customer_ref_date, test_location, sample_label, specification, description, custom: cu, extra } = edit; await api(`/samples/${sample.id}`, { method: 'PUT', body: { accreditation, material, received_date, received_time, quantity, packing, condition, source, customer_ref, customer_ref_date, test_location, sample_label, specification, description, custom: cu, extra } }); ok('Sample updated'); setEdit(null); reloadSample(); reload(); };
  const panel = !openId ? undefined : !sample || String(sample.id) !== openId ? <QuickView title={<div className="skel" style={{ height: 22, width: 160 }} />} onClose={close}><SkeletonRows rows={5} /></QuickView> : (
    <QuickView onClose={close} badges={<><StatusBadge status={sample.status} /><TypeBadge value={sample.accreditation} /></>} title={<span className="tnum">{sample.code}</span>}
      subtitle={[sample.material, sample.description].filter(Boolean).join(' · ')}
      tools={<Menu position="bottom-end" width={230}>
        <Menu.Target><Tooltip label="More actions"><ActionIcon variant="subtle" color="gray" size={32} radius={9} aria-label="More actions"><IconDots size={16} /></ActionIcon></Tooltip></Menu.Target>
        <Menu.Dropdown>
          {can('sample.edit') && !edit && <Menu.Item leftSection={<IconPencil size={15} />} onClick={() => setEdit({ ...sample })}>Edit details</Menu.Item>}
          <Menu.Item leftSection={<IconPrinter size={15} />} onClick={() => printLabel(sample)}>Print sample label</Menu.Item>
          {can('sample.edit') && (sample.disposed_at
            ? <Menu.Item leftSection={<IconArchive size={15} />} onClick={async () => { await api(`/samples/${sample.id}/disposal`, { method: 'DELETE' }); reloadSample(); reload(); }}>Undo disposal</Menu.Item>
            : <Menu.Item leftSection={<IconArchive size={15} />} onClick={() => setDispose({ date: localToday(), method: 'Discarded as per lab procedure', note: '' })}>Record disposal</Menu.Item>)}
        </Menu.Dropdown>
      </Menu>}
      footer={edit ? <><Button variant="subtle" color="gray" onClick={() => setEdit(null)} style={{ marginLeft: 'auto' }}>Cancel</Button><Button onClick={saveEdit}>Save</Button></> : <>
        <AdminDelete object="sample" id={sample.id} compact onDeleted={() => { close(); reload(); }} />
        <WhatsAppButton label="Acknowledge" variant="default" onClick={() => setWaSample(sample)} />
        {ready && can('prepareReports') ? <Button color="accent" style={{ marginLeft: 'auto' }} leftSection={<IconFileAnalytics size={16} />} onClick={() => nav('/reports/prepare')}>Prepare report</Button>
          : can('sample.edit') ? <Button variant="default" style={{ marginLeft: 'auto' }} leftSection={<IconPencil size={15} />} onClick={() => setEdit({ ...sample })}>Edit details</Button> : null}
      </>}>
      {edit ? <>
        <RecordForm object="sample" value={edit} onChange={setEdit} cols={2} />
        <ExtraValuesInput fields={sample.extraFields} value={edit.extra ?? {}} onChange={(x) => setEdit({ ...edit, extra: x })} />
      </> : <>
        <Facts items={[['Client', sample.client?.id ? <a className="lnk" onClick={() => nav(`/clients/${sample.client.id}`)}>{sample.client.name}</a> : sample.client?.name], ['Site', sample.site?.name ?? sample.site_name], ['ULR', sample.ulr && <span className="tnum">{sample.ulr}</span>],
          ['Received', [dmy(sample.received_date), sample.received_time].filter(Boolean).join(', ')], ['Quantity', sample.quantity], ['Packing', sample.packing], ['Condition', sample.condition], ['Source', sample.source],
          ['Customer ref', [sample.customer_ref, sample.customer_ref_date && `dated ${dmy(sample.customer_ref_date)}`].filter(Boolean).join(', ')], ['Specification', sample.specification],
          ...(sample.extraFields ?? []).map((f: any) => [f.label, sample.extra?.[f.key]] as [string, any]),
          ['Retention', sample.disposed_at ? `Disposed ${dmy(sample.disposed_at)} – ${sample.disposal_method}${sample.disposal_note ? ` (${sample.disposal_note})` : ''}` : sample.dispose_after ? `${sample.retention_days} days · keep till ${dmy(sample.dispose_after)}` : null]]} />
        <div>
          <div className="qv-sec"><b>Tests</b><span>{done(sample)} of {sample.tests.length} accepted</span></div>
          {sample.tests.map((t: any) => { const ok2 = ['accepted', 'reported'].includes(t.status); return (
            <a key={t.id} className="qv-row" onClick={() => nav(`/tests/${t.id}`)} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/tests/${t.id}`)}>
              <span className={`qv-tick${ok2 ? ' on' : ''}`}>{ok2 && <IconCheck size={12} stroke={2.6} />}</span>
              <span style={{ flex: 1, minWidth: 0 }}><span className="qv-row-t">{t.report_name || t.billing_name}</span><small>{[t.assignee, t.due_date && `due ${dmy(t.due_date)}`].filter(Boolean).join(' · ')}</small></span>
              <StatusBadge status={t.status} />
            </a>); })}
        </div>
        <SampleOutsourcing sample={sample} />
        <RecordInfo object="sample" id={sample.id} />
      </>}
    </QuickView>
  );
  return (
    <>
      <PageHeader title="Samples" subtitle="Every sample received, its tests and where it stands" actions={can('sample.create') && <Button leftSection={<IconPlus size={16} />} onClick={() => setSp({ new: '1' })}>Register sample</Button>} />
      <ListView id="samples" rows={data} columns={cols} onRow={(s) => { setEdit(null); setSp({ open: String(s.id) }); }} panel={panel} activeId={openId} onClosePanel={close}
        quickFilters={[{ label: 'In testing', filters: [{ key: 'status', op: 'in', value: ['registered', 'in_test'] }] }, { label: 'NABL', filters: [{ key: 'accreditation', op: 'in', value: ['NABL'] }] }, { label: 'Non-NABL', filters: [{ key: 'accreditation', op: 'in', value: ['Non-NABL'] }] }]} />
      {sp.get('new') === '1' && <NewSampleModal preset={sp.get('client') ? { client_id: Number(sp.get('client')) } : undefined} onClose={(saved) => { setSp({}); if (saved) reload(); }} />}
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
