import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Group, Modal, MultiSelect, Select, SimpleGrid, Stack, Text, TextInput, Badge, Paper, Textarea } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { api, dmy, ok, useApi, localToday } from '../api';
import { PageHeader, SimpleTable, StatusBadge } from '../components/ui';

export function NewSampleModal({ preset, onClose }: { preset?: { work_order_id?: number; client_id?: number; site_id?: number | null; customer_ref?: string; quoteCatalogIds?: number[] }; onClose: (saved: boolean) => void }) {
  const { data: clients } = useApi<any[]>('/clients');
  const { data: catalog } = useApi<any[]>('/catalog');
  const { data: users } = useApi<any[]>('/users');
  const [v, setV] = useState<any>({ received_date: localToday(), condition: 'Satisfactory', source: 'Sample supplied by the customer', material: 'Soil', ...preset, tests: [] as string[] });
  const { data: client } = useApi<any>(v.client_id ? `/clients/${v.client_id}` : null, [v.client_id]);
  const { data: wos } = useApi<any[]>('/workorders');
  const [tech, setTech] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (catalog && preset?.quoteCatalogIds?.length && !v.tests.length) setV((o: any) => ({ ...o, tests: catalog.filter((c) => preset.quoteCatalogIds!.includes(c.id) && c.obs_template_code).map((c) => String(c.id)) }));
  }, [catalog]);
  const set = (k: string) => (x: any) => setV((o: any) => ({ ...o, [k]: x?.currentTarget ? x.currentTarget.value : x }));
  const testable = (catalog ?? []).filter((c) => c.active && c.obs_template_code);
  const materials = [...new Set(testable.map((c) => c.material))];
  const save = async () => {
    setBusy(true);
    try {
      const r = await api<any>('/samples', { body: {
        ...v, client_id: Number(v.client_id), site_id: v.site_id ? Number(v.site_id) : null, work_order_id: v.work_order_id ? Number(v.work_order_id) : null,
        tests: v.tests.map((id: string) => ({ catalog_id: Number(id), assigned_to: tech ? Number(tech) : null })),
      } });
      ok(`Sample ${r.code} registered${r.ulr ? ` · ULR ${r.ulr}` : ''}`); onClose(true);
    } finally { setBusy(false); }
  };
  return (
    <Modal opened onClose={() => onClose(false)} title="Register sample (inward)" size="xl">
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select label="Client" required searchable data={(clients ?? []).map((c) => ({ value: String(c.id), label: c.name }))} value={v.client_id ? String(v.client_id) : null} onChange={(x) => setV({ ...v, client_id: x, site_id: null, work_order_id: null })} disabled={!!preset?.work_order_id} />
          <Select label="Site" clearable data={(client?.sites ?? []).map((s: any) => ({ value: String(s.id), label: s.name }))} value={v.site_id ? String(v.site_id) : null} onChange={set('site_id')} />
          <Select label="Work order" clearable data={(wos ?? []).filter((w) => String(w.client_id) === String(v.client_id)).map((w) => ({ value: String(w.id), label: `${w.number}${w.site_name ? ' · ' + w.site_name : ''}` }))} value={v.work_order_id ? String(v.work_order_id) : null} onChange={set('work_order_id')} disabled={!!preset?.work_order_id} />
          <Select label="Material" data={materials.length ? materials : ['Soil']} value={v.material} onChange={set('material')} />
          <TextInput label="Date received" type="date" value={v.received_date} onChange={set('received_date')} />
          <TextInput label="Quantity received" placeholder="e.g. 30 kg, 6 cubes" value={v.quantity ?? ''} onChange={set('quantity')} />
          <TextInput label="Condition at lab" value={v.condition ?? ''} onChange={set('condition')} />
          <TextInput label="Source of sample" value={v.source ?? ''} onChange={set('source')} />
          <TextInput label="Customer reference" value={v.customer_ref ?? ''} onChange={set('customer_ref')} />
          <TextInput label="Sample ID (as given by customer)" placeholder="Sample-01" value={v.sample_label ?? ''} onChange={set('sample_label')} />
          <TextInput label="Specification" placeholder="e.g. Soil, M25" value={v.specification ?? ''} onChange={set('specification')} />
        </SimpleGrid>
        <Textarea label="Description / location" autosize value={v.description ?? ''} onChange={set('description')} />
        <MultiSelect label="Tests to perform" required searchable data={testable.filter((c) => !v.material || c.material === v.material || v.tests.includes(String(c.id))).map((c) => ({ value: String(c.id), label: `${c.report_name || c.billing_name} (${c.method || c.code})${c.nabl ? '' : ' · Non-NABL'}` }))} value={v.tests} onChange={set('tests')} />
        <Select label="Assign to technician" clearable data={(users ?? []).filter((u) => ['technician', 'reviewer', 'owner'].includes(u.role)).map((u) => ({ value: String(u.id), label: u.name }))} value={tech} onChange={setTech} />
        <Text size="xs" c="dimmed">The job code and ULR (for NABL-scope tests) are generated on save. Due dates follow each test’s turnaround in the rate card.</Text>
        <Group justify="flex-end"><Button loading={busy} disabled={!v.client_id || !v.tests.length} onClick={save}>Register sample</Button></Group>
      </Stack>
    </Modal>
  );
}

export function SamplesPage() {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const { data, reload } = useApi<any[]>(`/samples?q=${encodeURIComponent(q)}`, [q]);
  const nav = useNavigate();
  const openId = sp.get('open');
  const { data: sample } = useApi<any>(openId ? `/samples/${openId}` : null, [openId]);
  return (
    <>
      <PageHeader title="Sample register" subtitle="Every sample received, its job code, ULR and test status" actions={<Button leftSection={<IconPlus size={16} />} onClick={() => setSp({ new: '1' })}>Register sample</Button>} />
      <TextInput placeholder="Search job code, ULR or client" value={q} onChange={(e) => setQ(e.currentTarget.value)} mb="sm" maw={420} />
      <SimpleTable head={['Job code', 'ULR', 'Received', 'Client', 'Site', 'Material', 'Tests', 'Status']}
        rows={(data ?? []).map((s) => [<Text size="sm" fw={500}>{s.code}</Text>, <Text size="xs">{s.ulr}</Text>, dmy(s.received_date), s.client_name, s.site_name, s.material,
          <Group gap={4}>{s.tests.map((t: any, i: number) => <Badge key={i} size="xs" variant="light" color={t.status === 'reported' ? 'teal' : t.status === 'accepted' ? 'green' : 'gray'} style={{ textTransform: 'none' }}>{t.report_name || t.billing_name}</Badge>)}</Group>, <StatusBadge status={s.status} />])}
        onRow={(i) => setSp({ open: String(data![i].id) })} />
      {sp.get('new') === '1' && <NewSampleModal preset={sp.get('client') ? { client_id: Number(sp.get('client')) } : undefined} onClose={(saved) => { setSp({}); if (saved) reload(); }} />}
      <Modal opened={!!openId} onClose={() => setSp({})} title={sample ? `Sample ${sample.code}` : 'Sample'} size="lg">
        {sample && (
          <Stack>
            <Paper withBorder p="sm">
              <SimpleGrid cols={2} spacing={4}>
                {[['Client', sample.client?.name], ['ULR', sample.ulr || '—'], ['Received', dmy(sample.received_date)], ['Material', sample.material], ['Quantity', sample.quantity], ['Condition', sample.condition], ['Source', sample.source], ['Customer ref', sample.customer_ref], ['Description', sample.description]].map(([k, v]) => <Text key={k} size="sm"><Text span c="dimmed">{k}: </Text>{v}</Text>)}
              </SimpleGrid>
            </Paper>
            <SimpleTable head={['Test', 'Assigned', 'Due', 'Status']} rows={sample.tests.map((t: any) => [t.report_name || t.billing_name, t.assignee, dmy(t.due_date), <StatusBadge status={t.status} />])} onRow={(i) => nav(`/tests/${sample.tests[i].id}`)} />
            <Group justify="flex-end"><Button variant="default" onClick={() => printLabel(sample)}>Print sample label</Button></Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}

function printLabel(s: any) {
  const w = window.open('', '_blank', 'width=420,height=300');
  if (!w) return;
  w.document.write(`<html><body style="font-family:Arial;margin:12px"><div style="border:2px solid #000;padding:10px;width:340px">
    <div style="font-size:18px;font-weight:bold">${s.code}</div><div>${s.client?.name ?? ''}</div>
    <div>Material: ${s.material ?? ''} · Qty: ${s.quantity ?? ''}</div><div>Received: ${dmy(s.received_date)}</div>
    ${s.ulr ? `<div style="font-size:11px">ULR: ${s.ulr}</div>` : ''}<div style="font-size:11px">Tests: ${s.tests.map((t: any) => t.report_name || t.billing_name).join(', ')}</div></div>
    <script>window.onload=()=>{window.print();}</script></body></html>`);
  w.document.close();
}
