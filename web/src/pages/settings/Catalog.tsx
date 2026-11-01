import { useState } from 'react';
import { Button, FileButton, Group, Modal, Select, Stack, Text, Alert, Badge } from '@mantine/core';
import { api, downloadCsv, ok, parseCsv, useApi } from '../../api';
import { useCan } from '../../ctx';
import { PageHeader } from '../../components/ui';
import { ListView, useCustomCols, type Col } from '../../components/ListView';
import { RecordForm } from '../../components/RecordForm';

const CSV_COLS = ['code', 'material', 'billing_name', 'report_name', 'method', 'nabl', 'unit', 'rate', 'sac', 'gst_rate', 'tat_days', 'obs_template_code', 'conditions', 'report_notes'].map((k) => ({ key: k, label: k }));

export function CatalogSettings() {
  const { data, reload } = useApi<any[]>('/catalog');
  const { data: tpls } = useApi<any[]>('/obs-templates');
  const can = useCan();
  const [edit, setEdit] = useState<any>(null);
  const custom = useCustomCols('catalog');
  const importCsv = async (f: File | null) => {
    if (!f) return;
    const items = parseCsv(await f.text()).filter((r) => r.billing_name).map((r) => ({
      ...r, nabl: /^(y|yes|true|1|nabl)$/i.test(r.nabl ?? ''), rate: Number(r.rate) || 0, gst_rate: Number(r.gst_rate) || 18, tat_days: r.tat_days ? Number(r.tat_days) : null, obs_template_code: r.obs_template_code || null,
    }));
    if (!items.length || !window.confirm(`Import ${items.length} items into the rate card?`)) return;
    await api('/catalog', { body: items }); ok(`${items.length} items imported`); reload();
  };
  const cols: Col[] = [
    { key: 'billing_name', label: 'Billing name', render: (c) => <Text size="sm" c={c.active ? undefined : 'dimmed'} lineClamp={2}>{c.billing_name}</Text> },
    { key: 'report_name', label: 'Report name' }, { key: 'material', label: 'Material', filter: 'select' }, { key: 'method', label: 'Method' },
    { key: 'scope', label: 'Scope', value: (c) => (c.nabl ? 'NABL' : 'Non-NABL'), type: 'badge' },
    { key: 'unit', label: 'Unit', filter: 'select' }, { key: 'rate', label: 'Rate', type: 'money' },
    { key: 'obs_template_code', label: 'Observation sheet', render: (c) => c.obs_template_code ?? <Text size="xs" c="dimmed">quote only</Text> },
    { key: 'active', label: 'Active', value: (c) => (c.active ? 'Yes' : 'No'), filter: 'select', hidden: true },
    ...custom,
  ];
  return (
    <>
      <PageHeader title="Rate card & test catalog" subtitle="One record per test: billing name, report name, method, NABL scope, rate, observation sheet"
        actions={<>
          <Button variant="default" onClick={() => downloadCsv('rate-card.csv', CSV_COLS, data ?? [])}>Download CSV template</Button>
          {can('catalog.create') && <FileButton accept=".csv,text/csv" onChange={importCsv}>{(p) => <Button variant="default" {...p}>Import CSV</Button>}</FileButton>}
          {can('catalog.create') && <Button onClick={() => setEdit({ nabl: true, unit: 'Per sample', sac: '998346', gst_rate: 18, rate: 0, active: true })}>Add item</Button>}
        </>} />
      <Alert variant="light" mb="sm">From Excel: download the CSV, fill the rows, “Save As → CSV”, then Import. Columns are matched by their header names.</Alert>
      <ListView id="catalog" rows={data} columns={cols} onRow={(c) => setEdit(c)} />
      {edit && <CatalogModal item={edit} templates={tpls ?? []} readOnly={!can(edit.id ? 'catalog.edit' : 'catalog.create')} canDelete={can('catalog.delete')} onClose={(s) => { setEdit(null); if (s) reload(); }} />}
    </>
  );
}

function CatalogModal({ item, templates, onClose, readOnly, canDelete }: { item: any; templates: any[]; onClose: (saved: boolean) => void; readOnly: boolean; canDelete: boolean }) {
  const [v, setV] = useState<any>(item);
  const save = async () => {
    const { id, company_id, created_at, data, ...body } = v;
    if (id) await api(`/catalog/${id}`, { method: 'PUT', body }); else await api('/catalog', { body });
    ok('Rate card updated'); onClose(true);
  };
  return (
    <Modal opened onClose={() => onClose(false)} title={item.id ? <Group gap="xs">Rate card item <Badge variant="light" color={v.nabl ? 'teal' : 'gray'}>{v.nabl ? 'NABL' : 'Non-NABL'}</Badge></Group> : 'Add rate card item'} size="xl">
      <Stack>
        <RecordForm object="catalog" value={v} onChange={setV} cols={3} disabled={readOnly} exclude={['obs_template_code']} />
        <Select label="Observation sheet" clearable disabled={readOnly} data={templates.map((t) => ({ value: t.code, label: `${t.name} (${t.code} v${t.version})` }))} value={v.obs_template_code ?? null} onChange={(x) => setV({ ...v, obs_template_code: x })} description="Leave empty for services that are only quoted/billed (transport, mobilisation…)" />
        <Group justify="space-between">
          {item.id && canDelete ? <Button variant="subtle" color="red" onClick={async () => { if (window.confirm('Delete this item? Items already used on tests are deactivated instead.')) { await api(`/catalog/${item.id}`, { method: 'DELETE' }); onClose(true); } }}>Delete</Button> : <span />}
          {!readOnly && <Button onClick={save} disabled={!v.billing_name}>Save</Button>}
        </Group>
      </Stack>
    </Modal>
  );
}
