import { useState } from 'react';
import { Button, FileButton, Group, Modal, NumberInput, Select, SimpleGrid, Stack, Switch, Text, TextInput, Textarea, Alert, Badge } from '@mantine/core';
import { api, downloadCsv, money, ok, parseCsv, useApi } from '../../api';
import { PageHeader, SimpleTable } from '../../components/ui';

const CSV_COLS = [
  { key: 'code', label: 'code' }, { key: 'material', label: 'material' }, { key: 'billing_name', label: 'billing_name' }, { key: 'report_name', label: 'report_name' },
  { key: 'method', label: 'method' }, { key: 'nabl', label: 'nabl' }, { key: 'unit', label: 'unit' }, { key: 'rate', label: 'rate' }, { key: 'sac', label: 'sac' },
  { key: 'gst_rate', label: 'gst_rate' }, { key: 'tat_days', label: 'tat_days' }, { key: 'obs_template_code', label: 'obs_template_code' }, { key: 'conditions', label: 'conditions' }, { key: 'report_notes', label: 'report_notes' },
];

export function CatalogSettings() {
  const { data, reload } = useApi<any[]>('/catalog');
  const { data: tpls } = useApi<any[]>('/obs-templates');
  const [edit, setEdit] = useState<any>(null);
  const [q, setQ] = useState('');
  const rows = (data ?? []).filter((c) => !q || `${c.billing_name} ${c.report_name} ${c.code} ${c.method}`.toLowerCase().includes(q.toLowerCase()));
  const importCsv = async (f: File | null) => {
    if (!f) return;
    const items = parseCsv(await f.text()).filter((r) => r.billing_name).map((r) => ({
      ...r, nabl: /^(y|yes|true|1|nabl)$/i.test(r.nabl ?? ''), rate: Number(r.rate) || 0, gst_rate: Number(r.gst_rate) || 18, tat_days: r.tat_days ? Number(r.tat_days) : null, obs_template_code: r.obs_template_code || null,
    }));
    if (!items.length) return;
    if (!window.confirm(`Import ${items.length} items into the rate card?`)) return;
    await api('/catalog', { body: items }); ok(`${items.length} items imported`); reload();
  };
  return (
    <>
      <PageHeader title="Rate card & test catalog" subtitle="One record per test: billing name, report name, method, NABL scope, rate, observation sheet"
        actions={<>
          <Button variant="default" onClick={() => downloadCsv('rate-card.csv', CSV_COLS, data ?? [])}>Export (Excel)</Button>
          <FileButton accept=".csv,text/csv" onChange={importCsv}>{(p) => <Button variant="default" {...p}>Import CSV</Button>}</FileButton>
          <Button onClick={() => setEdit({ nabl: true, unit: 'Per sample', sac: '998346', gst_rate: 18, rate: 0, active: true })}>Add item</Button>
        </>} />
      <Alert variant="light" mb="sm">To import from Excel: export this list, fill the rows in Excel, “Save As → CSV”, then Import. Columns are matched by their header names.</Alert>
      <TextInput placeholder="Search" value={q} onChange={(e) => setQ(e.currentTarget.value)} mb="sm" maw={360} />
      <SimpleTable head={['Billing name', 'Report name', 'Method', 'Scope', 'Unit', 'Rate', 'Observation sheet']}
        rows={rows.map((c) => [<Text size="sm" c={c.active ? undefined : 'dimmed'}>{c.billing_name}</Text>, c.report_name, c.method, c.nabl ? <Badge size="xs" color="teal" variant="light">NABL</Badge> : <Badge size="xs" color="gray" variant="light">Non-NABL</Badge>, c.unit, <span className="num">₹{money(c.rate)}</span>, c.obs_template_code ?? <Text size="xs" c="dimmed">quote only</Text>])}
        onRow={(i) => setEdit(rows[i])} />
      {edit && <CatalogModal item={edit} templates={tpls ?? []} onClose={(s) => { setEdit(null); if (s) reload(); }} />}
    </>
  );
}

function CatalogModal({ item, templates, onClose }: { item: any; templates: any[]; onClose: (saved: boolean) => void }) {
  const [v, setV] = useState<any>(item);
  const set = (k: string) => (x: any) => setV({ ...v, [k]: x?.currentTarget ? x.currentTarget.value : x });
  const save = async () => {
    const { id, company_id, created_at, ...body } = v;
    if (id) await api(`/catalog/${id}`, { method: 'PUT', body }); else await api('/catalog', { body });
    ok('Rate card updated'); onClose(true);
  };
  return (
    <Modal opened onClose={() => onClose(false)} title={item.id ? 'Edit rate card item' : 'Add rate card item'} size="xl">
      <Stack>
        <Textarea label="Billing description (quotation & invoice)" autosize value={v.billing_name ?? ''} onChange={set('billing_name')} />
        <SimpleGrid cols={{ base: 1, md: 3 }}>
          <TextInput label="Report name" value={v.report_name ?? ''} onChange={set('report_name')} />
          <TextInput label="Test method" placeholder="IS 2720 (Part 16)…" value={v.method ?? ''} onChange={set('method')} />
          <TextInput label="Code" value={v.code ?? ''} onChange={set('code')} />
          <TextInput label="Material" value={v.material ?? ''} onChange={set('material')} />
          <TextInput label="Pricing unit" placeholder="Per sample / Per point / Per visit" value={v.unit ?? ''} onChange={set('unit')} />
          <NumberInput label="Rate (₹)" thousandSeparator="," value={v.rate} onChange={(x) => setV({ ...v, rate: Number(x) || 0 })} />
          <TextInput label="SAC" value={v.sac ?? ''} onChange={set('sac')} />
          <NumberInput label="GST %" value={v.gst_rate} onChange={(x) => setV({ ...v, gst_rate: Number(x) })} />
          <NumberInput label="Turnaround (days)" value={v.tat_days ?? ''} onChange={(x) => setV({ ...v, tat_days: x === '' ? null : Number(x) })} />
          <Select label="Observation sheet" clearable data={templates.map((t) => ({ value: t.code, label: `${t.name} (${t.code} v${t.version})` }))} value={v.obs_template_code ?? null} onChange={set('obs_template_code')} description="Leave empty for services that are only quoted/billed" />
        </SimpleGrid>
        <Textarea label="Conditions (added to quotation notes automatically)" autosize value={v.conditions ?? ''} onChange={set('conditions')} />
        <Textarea label="Report notes (printed only on reports that include this test)" autosize value={v.report_notes ?? ''} onChange={set('report_notes')} />
        <Group><Switch label="Within NABL accreditation scope" checked={!!v.nabl} onChange={(e) => setV({ ...v, nabl: e.currentTarget.checked })} /><Switch label="Active" checked={v.active !== false} onChange={(e) => setV({ ...v, active: e.currentTarget.checked })} /></Group>
        <Group justify="flex-end"><Button onClick={save} disabled={!v.billing_name}>Save</Button></Group>
      </Stack>
    </Modal>
  );
}
