import { useState } from 'react';
import { Button, Group, Modal, NumberInput, Stack, Switch, Text } from '@mantine/core';
import { api, ok, useApi, localToday } from '../../api';
import { useCan } from '../../ctx';
import { PageHeader } from '../../components/ui';
import { ListView, useCustomCols } from '../../components/ListView';
import { RecordForm } from '../../components/RecordForm';

export function EquipmentPage() {
  const { data, reload } = useApi<any[]>('/equipment');
  const [edit, setEdit] = useState<any>(null);
  const can = useCan();
  const custom = useCustomCols('equipment');
  const td = localToday();
  const status = (e: any) => (!e.due_date ? '' : e.due_date < td ? 'EXPIRED' : 'Valid');
  return (
    <>
      <PageHeader title="Equipment & calibration" subtitle="Observation sheets pull calibration factors from here and refuse expired equipment"
        actions={can('equipment.create') && <Button onClick={() => setEdit({ category: 'Proving ring', data: {}, active: true })}>Add equipment</Button>} />
      <ListView id="equipment" rows={data} onRow={(e) => setEdit(e)} columns={[
        { key: 'name', label: 'Equipment' }, { key: 'category', label: 'Category', filter: 'select' }, { key: 'id_no', label: 'ID' }, { key: 'cert_no', label: 'Certificate' },
        { key: 'factor', label: 'Factor', value: (e) => e.data?.factor ?? '' }, { key: 'cal_date', label: 'Calibrated', type: 'date' }, { key: 'due_date', label: 'Due', type: 'date' },
        { key: 'status', label: 'Status', type: 'status', value: status }, ...custom]}
        quickFilters={[{ label: 'Expired', filters: [{ key: 'status', op: 'in', value: ['EXPIRED'] }] }]} />
      {edit && <EqModal item={edit} readOnly={!can(edit.id ? 'equipment.edit' : 'equipment.create')} onClose={(s) => { setEdit(null); if (s) reload(); }} />}
    </>
  );
}

function EqModal({ item, onClose, readOnly }: { item: any; onClose: (s: boolean) => void; readOnly: boolean }) {
  const [v, setV] = useState<any>({ ...item, data: item.data ?? {} });
  const save = async () => {
    const { id, company_id, created_at, ...body } = v;
    const { custom: _c, ...data } = body.data ?? {};
    if (id) await api(`/equipment/${id}`, { method: 'PUT', body: { ...body, data } }); else await api('/equipment', { body: { ...body, data } });
    ok('Equipment saved'); onClose(true);
  };
  return (
    <Modal opened onClose={() => onClose(false)} title={item.id ? 'Edit equipment' : 'Add equipment'} size="lg">
      <Stack>
        <RecordForm object="equipment" value={v} onChange={setV} disabled={readOnly} />
        <NumberInput label="Calibration factor (e.g. kN/div)" decimalScale={6} disabled={readOnly} value={v.data?.factor ?? ''} onChange={(x) => setV({ ...v, data: { ...v.data, factor: x === '' ? undefined : Number(x) } })} />
        <Text size="xs" c="dimmed">When re-calibrated, update the factor, certificate and dates. Earlier observation sheets keep the factor they were tested with.</Text>
        <Switch label="Active" disabled={readOnly} checked={v.active !== false} onChange={(e) => setV({ ...v, active: e.currentTarget.checked })} />
        {!readOnly && <Group justify="flex-end"><Button onClick={save} disabled={!v.name}>Save</Button></Group>}
      </Stack>
    </Modal>
  );
}
