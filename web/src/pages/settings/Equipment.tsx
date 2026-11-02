import { useState } from 'react';
import { ActionIcon, Anchor, Button, FileButton, Group, Modal, NumberInput, Paper, SimpleGrid, Stack, Switch, Text } from '@mantine/core';
import { IconPaperclip, IconTrash } from '@tabler/icons-react';
import { EQUIPMENT_FIELDS } from '@suite/shared';
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
        { key: 'factor', label: 'Calibration values', value: (e) => Object.entries(e.data ?? {}).filter(([k, x]) => k !== 'custom' && x !== undefined && x !== null && x !== '').map(([k, x]) => `${k}: ${x}`).join(', ') }, { key: 'cal_date', label: 'Calibrated', type: 'date' }, { key: 'due_date', label: 'Due', type: 'date' },
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
        {!readOnly && <Group justify="flex-end"><Button onClick={save} disabled={!v.name}>Save</Button></Group>}
      </Stack>
    </Modal>
  );
}

/** Calibration certificates (PDF / image) attached to the equipment record. */
function Certificates({ equipmentId, readOnly }: { equipmentId: number; readOnly: boolean }) {
  const { data, reload } = useApi<any[]>(`/files?entity=equipment&entity_id=${equipmentId}`, [equipmentId]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const upload = async (file: File | null) => {
    if (!file) return;
    setErr('');
    if (file.size > 10 * 1024 * 1024) { setErr('File is larger than 10 MB'); return; }
    setBusy(true);
    try {
      const dataUrl: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
      await api('/files', { body: { entity: 'equipment', entity_id: equipmentId, name: file.name, mime: file.type || 'application/pdf', data: dataUrl } });
      ok('Certificate attached'); reload();
    } finally { setBusy(false); }
  };
  const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  return (
    <Paper withBorder p="sm">
      <Group justify="space-between" mb={4}>
        <Text size="sm" fw={600}>Calibration certificates</Text>
        {!readOnly && <FileButton onChange={upload} accept="application/pdf,image/png,image/jpeg,image/webp">{(props) => <Button {...props} size="xs" variant="light" loading={busy} leftSection={<IconPaperclip size={14} />}>Upload certificate</Button>}</FileButton>}
      </Group>
      {err && <Text size="xs" c="red">{err}</Text>}
      <Stack gap={4}>
        {(data ?? []).map((f) => (
          <Group key={f.id} justify="space-between" wrap="nowrap">
            <div>
              <Anchor size="sm" href={`/api/files/${f.id}/download?inline=1`} target="_blank" rel="noreferrer">{f.name}</Anchor>
              <Text size="xs" c="dimmed">{kb(f.size)} · {f.uploaded_by_name ?? ''} · {new Date(f.created_at).toLocaleDateString('en-IN')}</Text>
            </div>
            {!readOnly && <ActionIcon variant="subtle" color="red" onClick={async () => { if (!window.confirm(`Remove ${f.name}?`)) return; await api(`/files/${f.id}`, { method: 'DELETE' }); reload(); }}><IconTrash size={14} /></ActionIcon>}
          </Group>
        ))}
        {!(data ?? []).length && <Text size="xs" c="dimmed">No certificate attached yet. PDF or image, up to 10 MB.</Text>}
      </Stack>
    </Paper>
  );
}
