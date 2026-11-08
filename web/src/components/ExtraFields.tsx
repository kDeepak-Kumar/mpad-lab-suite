import { useEffect, useState } from 'react';
import { ActionIcon, Button, Checkbox, Group, Paper, Select, SimpleGrid, Stack, Text, TextInput, NumberInput, Tooltip } from '@mantine/core';
import { IconPlus, IconTrash, IconArrowUp } from '@tabler/icons-react';
import { api, ok, useApi } from '../api';

export interface ExtraFieldDef { key?: string; label: string; type: 'text' | 'number' | 'date' | 'select'; options?: string[]; onReport: boolean }
const SUGGEST = ['Original supplier', 'Procurement source', 'Vehicle No', 'Procurement date', 'Batch / Week No', 'Invoice No'];

/** Client master: the additional information this client wants on its samples and reports. */
export function ExtraFieldsEditor({ clientId, canEdit }: { clientId: number; canEdit: boolean }) {
  const { data, reload } = useApi<{ fields: ExtraFieldDef[] }>(`/clients/${clientId}/extra-fields`, [clientId]);
  const [rows, setRows] = useState<ExtraFieldDef[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setRows(data.fields.map((f) => ({ ...f, type: f.type ?? 'text', onReport: f.onReport !== false }))); }, [data]);
  if (!rows) return null;
  const set = (i: number, p: Partial<ExtraFieldDef>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const save = async () => { setBusy(true); try { await api(`/clients/${clientId}/extra-fields`, { method: 'PUT', body: { fields: rows.filter((r) => r.label.trim()) } }); ok('Additional sample fields saved'); reload(); } finally { setBusy(false); } };
  const dirty = JSON.stringify(rows) !== JSON.stringify((data?.fields ?? []).map((f) => ({ ...f, type: f.type ?? 'text', onReport: f.onReport !== false })));
  return (
    <Paper withBorder p="md">
      <Text fw={600}>Additional sample fields</Text>
      <Text size="xs" c="dimmed" mb="sm">Information this client gives with each sample (e.g. supplier, vehicle no., invoice no.). The fields appear when registering this client’s samples, and the values are printed on the report (each report can still hide them).</Text>
      <Stack gap={6}>
        {rows.map((r, i) => (
          <Group key={i} gap="xs" wrap="nowrap" align="flex-end">
            <TextInput size="xs" style={{ flex: 2 }} label={i === 0 ? 'Field name (as printed)' : undefined} value={r.label} disabled={!canEdit} onChange={(e) => set(i, { label: e.currentTarget.value })} />
            <Select size="xs" w={110} label={i === 0 ? 'Type' : undefined} disabled={!canEdit} data={[{ value: 'text', label: 'Text' }, { value: 'number', label: 'Number' }, { value: 'date', label: 'Date' }, { value: 'select', label: 'Choice' }]} value={r.type} onChange={(v) => set(i, { type: (v ?? 'text') as ExtraFieldDef['type'] })} />
            {r.type === 'select' && <TextInput size="xs" style={{ flex: 2 }} label={i === 0 || rows.slice(0, i).every((x) => x.type !== 'select') ? 'Choices (comma separated)' : undefined} disabled={!canEdit} value={(r.options ?? []).join(', ')} onChange={(e) => set(i, { options: e.currentTarget.value.split(',').map((x) => x.trim()) })} />}
            <Checkbox size="xs" mb={6} label="On report" disabled={!canEdit} checked={r.onReport} onChange={(e) => set(i, { onReport: e.currentTarget.checked })} />
            {canEdit && <Tooltip label="Move up"><ActionIcon variant="subtle" color="gray" mb={2} disabled={i === 0} onClick={() => { const n = rows.slice(); [n[i - 1], n[i]] = [n[i], n[i - 1]]; setRows(n); }}><IconArrowUp size={15} /></ActionIcon></Tooltip>}
            {canEdit && <ActionIcon variant="subtle" color="red" mb={2} onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove field"><IconTrash size={15} /></ActionIcon>}
          </Group>
        ))}
        {!rows.length && <Text size="sm" c="dimmed">No additional fields for this client.</Text>}
      </Stack>
      {canEdit && (
        <Group mt="sm" justify="space-between">
          <Group gap={4}>
            <Button size="xs" variant="light" leftSection={<IconPlus size={13} />} onClick={() => setRows([...rows, { label: '', type: 'text', onReport: true }])}>Add field</Button>
            {SUGGEST.filter((s) => !rows.some((r) => r.label.toLowerCase() === s.toLowerCase())).slice(0, 4).map((s) => <Button key={s} size="compact-xs" variant="subtle" onClick={() => setRows([...rows, { label: s, type: /date/i.test(s) ? 'date' : 'text', onReport: true }])}>+ {s}</Button>)}
          </Group>
          <Button size="xs" loading={busy} disabled={!dirty} onClick={save}>Save fields</Button>
        </Group>
      )}
    </Paper>
  );
}

/** Sample form: values for the client's additional fields. */
export function ExtraValuesInput({ clientId, value, onChange, fields: given }: { clientId?: number | string | null; value: Record<string, any>; onChange: (v: Record<string, any>) => void; fields?: ExtraFieldDef[] }) {
  const { data } = useApi<{ fields: ExtraFieldDef[] }>(!given && clientId ? `/clients/${clientId}/extra-fields` : null, [clientId]);
  const fields = given ?? data?.fields ?? [];
  if (!fields.length) return null;
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v === '' || v === undefined ? null : v });
  return (
    <div>
      <Text size="sm" fw={500} mb={4}>Additional information <Text span size="xs" c="dimmed">(this client’s fields – printed on the report)</Text></Text>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
        {fields.map((f) => f.type === 'number'
          ? <NumberInput key={f.key} size="sm" label={f.label} value={value[f.key!] ?? ''} onChange={(v) => set(f.key!, v === '' ? null : Number(v))} />
          : f.type === 'select'
            ? <Select key={f.key} size="sm" label={f.label} clearable data={f.options ?? []} value={value[f.key!] ?? null} onChange={(v) => set(f.key!, v)} />
            : <TextInput key={f.key} size="sm" type={f.type === 'date' ? 'date' : 'text'} label={f.label} value={value[f.key!] ?? ''} onChange={(e) => set(f.key!, e.currentTarget.value)} />)}
      </SimpleGrid>
    </div>
  );
}
