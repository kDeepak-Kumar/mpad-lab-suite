import { useState } from 'react';
import { FormSheet } from '../../components/Sheet';
import { Button, Group, Modal, NumberInput, SimpleGrid, Stack, Switch, Text } from '@mantine/core';
import { IconUpload } from '@tabler/icons-react';
import { EQUIPMENT_FIELDS } from '@suite/shared';
import { api, ok, useApi, localToday } from '../../api';
import { useCan } from '../../ctx';
import { PageHeader } from '../../components/ui';
import { ListView, useCustomCols } from '../../components/ListView';
import { RecordForm } from '../../components/RecordForm';
import { Attachments } from '../../components/Attachments';
import { EquipmentImport } from './EquipmentImport';
import { AdminDelete, RecordInfo } from '../../components/RecordAdmin';

export function EquipmentPage() {
  const { data, reload } = useApi<any[]>('/equipment');
  const [edit, setEdit] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const can = useCan();
  const custom = useCustomCols('equipment');
  const td = localToday();
  const status = (e: any) => (!e.due_date ? '' : e.due_date < td ? 'EXPIRED' : 'Valid');
  return (
    <>
      <PageHeader title="Equipment & calibration" subtitle="Observation sheets pull calibration factors from here and refuse expired equipment"
        actions={can('equipment.create') && <><Button variant="default" leftSection={<IconUpload size={16} />} onClick={() => setImporting(true)}>Import</Button><Button onClick={() => setEdit({ category: 'Proving ring', data: {}, active: true })}>Add equipment</Button></>} />
      <ListView id="equipment" rows={data} onRow={(e) => setEdit(e)} columns={[
        { key: 'name', label: 'Equipment' }, { key: 'category', label: 'Category', filter: 'select' }, { key: 'id_no', label: 'ID' }, { key: 'cert_no', label: 'Certificate' },
        { key: 'factor', label: 'Calibration values', value: (e) => Object.entries(e.data ?? {}).filter(([k, x]) => k !== 'custom' && x !== undefined && x !== null && x !== '').map(([k, x]) => `${k}: ${x}`).join(', ') }, { key: 'cal_date', label: 'Calibrated', type: 'date' }, { key: 'due_date', label: 'Due', type: 'date' },
        { key: 'status', label: 'Status', type: 'status', value: status }, ...custom]}
        quickFilters={[{ label: 'Expired', filters: [{ key: 'status', op: 'in', value: ['EXPIRED'] }] }]} />
      {importing && <EquipmentImport onClose={(done) => { setImporting(false); if (done) reload(); }} />}
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
    <FormSheet opened onClose={() => onClose(false)} title={item.id ? 'Edit equipment' : 'Add equipment'} size="lg">
      <Stack>
        <RecordForm object="equipment" value={v} onChange={setV} disabled={readOnly} />
        {(() => {
          const fields = EQUIPMENT_FIELDS[v.category] ?? [{ key: 'factor', label: 'Calibration factor', unit: '' }];
          if (!fields.length) return <Text size="xs" c="dimmed">No calibration values are used in calculations for this category; keep the certificate and due date current.</Text>;
          return (
            <>
              <Text size="sm" fw={600}>Calibration values used in observation sheets</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {fields.map((f) => <NumberInput key={f.key} label={`${f.label}${f.unit ? ` (${f.unit})` : ''}`} description={f.note} decimalScale={6} disabled={readOnly}
                  value={v.data?.[f.key] ?? ''} onChange={(x) => setV({ ...v, data: { ...v.data, [f.key]: x === '' ? undefined : Number(x) } })} />)}
              </SimpleGrid>
            </>
          );
        })()}
        <Text size="xs" c="dimmed">When re-calibrated, update these values, the certificate and the dates. Earlier observation sheets keep the values they were tested with; testers can still enter a value manually on a sheet.</Text>
        {v.id ? <Certificates equipmentId={v.id} readOnly={readOnly} /> : <Text size="xs" c="dimmed">Save the equipment first, then attach its calibration certificate.</Text>}
        <Switch label="Active" disabled={readOnly} checked={v.active !== false} onChange={(e) => setV({ ...v, active: e.currentTarget.checked })} />
        {item.id ? <RecordInfo object="equipment" id={item.id} /> : null}
        <Group className="form-actions" justify="flex-end">{item.id ? <AdminDelete object="equipment" id={item.id} compact onDeleted={() => onClose(true)} /> : null}{!readOnly && <Button onClick={save} disabled={!v.name}>Save</Button>}</Group>
      </Stack>
    </FormSheet>
  );
}

/** Calibration certificates (PDF / image) attached to the equipment record – compressed under 1 MB, previewed before attaching. */
function Certificates({ equipmentId, readOnly }: { equipmentId: number; readOnly: boolean }) {
  return <Attachments entity="equipment" entityId={equipmentId} readOnly={readOnly} title="Calibration certificates" buttonLabel="Upload certificate"
    emptyText="No certificate attached yet. PDF or photo – compressed to under 1 MB automatically." />;
}
