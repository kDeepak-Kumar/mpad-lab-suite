import { useState } from 'react';
import { Button, Group, Modal, NumberInput, Select, SimpleGrid, Stack, Switch, TextInput, Text } from '@mantine/core';
import { api, dmy, ok, useApi, localToday } from '../../api';
import { PageHeader, SimpleTable, StatusBadge } from '../../components/ui';

const CATEGORIES = ['Proving ring', 'Compression testing machine', 'Universal testing machine', 'Balance', 'Oven', 'Dial gauge', 'Sieve set', 'Other'];

export function EquipmentPage() {
  const { data, reload } = useApi<any[]>('/equipment');
  const [edit, setEdit] = useState<any>(null);
  const td = localToday();
  return (
    <>
      <PageHeader title="Equipment & calibration" subtitle="Observation sheets pull calibration factors from here and refuse expired equipment"
        actions={<Button onClick={() => setEdit({ category: 'Proving ring', data: {}, active: true })}>Add equipment</Button>} />
      <SimpleTable head={['Equipment', 'Category', 'ID', 'Certificate', 'Factor', 'Calibrated', 'Due', 'Status']}
        rows={(data ?? []).map((e) => [e.name, e.category, e.id_no, e.cert_no, e.data?.factor ?? '', dmy(e.cal_date), dmy(e.due_date), <StatusBadge status={!e.due_date ? undefined : e.due_date < td ? 'EXPIRED' : 'Valid'} />])}
        onRow={(i) => setEdit(data![i])} />
      {edit && <EqModal item={edit} onClose={(s) => { setEdit(null); if (s) reload(); }} />}
    </>
  );
}

function EqModal({ item, onClose }: { item: any; onClose: (s: boolean) => void }) {
  const [v, setV] = useState<any>({ ...item, data: item.data ?? {} });
  const set = (k: string) => (x: any) => setV({ ...v, [k]: x?.currentTarget ? x.currentTarget.value : x });
  const save = async () => {
    const { id, company_id, created_at, ...body } = v;
    if (id) await api(`/equipment/${id}`, { method: 'PUT', body }); else await api('/equipment', { body });
    ok('Equipment saved'); onClose(true);
  };
  return (
    <Modal opened onClose={() => onClose(false)} title={item.id ? 'Edit equipment' : 'Add equipment'} size="lg">
      <Stack>
        <SimpleGrid cols={2}>
          <TextInput label="Name" value={v.name ?? ''} onChange={set('name')} />
          <Select label="Category" data={CATEGORIES} value={v.category} onChange={set('category')} />
          <TextInput label="ID number" value={v.id_no ?? ''} onChange={set('id_no')} />
          <TextInput label="Make / model" value={v.make ?? ''} onChange={set('make')} />
          <TextInput label="Calibration certificate no." value={v.cert_no ?? ''} onChange={set('cert_no')} />
          <NumberInput label="Calibration factor (e.g. kN/div)" decimalScale={6} value={v.data?.factor ?? ''} onChange={(x) => setV({ ...v, data: { ...v.data, factor: x === '' ? undefined : Number(x) } })} />
          <TextInput type="date" label="Calibrated on" value={v.cal_date ?? ''} onChange={set('cal_date')} />
          <TextInput type="date" label="Calibration due" value={v.due_date ?? ''} onChange={set('due_date')} />
        </SimpleGrid>
        <Text size="xs" c="dimmed">When re-calibrated, update the factor, certificate and dates. Earlier observation sheets keep the factor they were tested with.</Text>
        <Switch label="Active" checked={v.active !== false} onChange={(e) => setV({ ...v, active: e.currentTarget.checked })} />
        <Group justify="flex-end"><Button onClick={save} disabled={!v.name}>Save</Button></Group>
      </Stack>
    </Modal>
  );
}
