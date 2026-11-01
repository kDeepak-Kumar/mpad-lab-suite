import { useEffect, useState } from 'react';
import { ActionIcon, Group, Paper, Select, SimpleGrid, Text, TextInput, Textarea, Tooltip } from '@mantine/core';
import { IconLock, IconLockOpen } from '@tabler/icons-react';
import { INDIAN_STATES, formatDate, stateName } from '@suite/shared';
import { usePicklist } from '../ctx';

const getPath = (o: any, p: string) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
export const setPath = (o: any, p: string, v: unknown) => {
  const ks = p.split('.'); const out = { ...o }; let cur = out;
  for (const k of ks.slice(0, -1)) { cur[k] = { ...(cur[k] ?? {}) }; cur = cur[k]; }
  cur[ks[ks.length - 1]] = v; return out;
};

/**
 * A field that is filled automatically (from the client, numbering, today's date…) and locked.
 * Click the lock to type your own value; the document then keeps it.
 */
function LockField({ label, value, unlocked, onUnlock, onChange, disabled, multiline, type, placeholder }: {
  label: string; value: string; unlocked: boolean; onUnlock: (u: boolean) => void; onChange: (v: string) => void; disabled?: boolean; multiline?: boolean; type?: string; placeholder?: string;
}) {
  const [local, setLocal] = useState(value ?? '');
  useEffect(() => setLocal(value ?? ''), [value]);
  const lock = (
    <Tooltip label={disabled ? 'Document is locked' : unlocked ? 'Lock (use the automatic value)' : 'Unlock to edit'}>
      <ActionIcon size="sm" variant={unlocked ? 'light' : 'subtle'} color={unlocked ? 'orange' : 'gray'} disabled={disabled} onClick={() => onUnlock(!unlocked)}>
        {unlocked ? <IconLockOpen size={14} /> : <IconLock size={14} />}
      </ActionIcon>
    </Tooltip>
  );
  const props = { label, disabled: disabled || !unlocked, rightSection: lock, placeholder, value: local, onChange: (e: any) => setLocal(e.currentTarget.value), onBlur: () => local !== (value ?? '') && onChange(local) };
  return multiline ? <Textarea {...props} autosize minRows={1} /> : <TextInput {...props} type={type} />;
}

export function HeaderFields({ kind, doc, data, onData, onNumber, onDate, disabled }: {
  kind: string; doc: any; data: Record<string, any>; onData: (d: Record<string, any>) => void;
  onNumber: (n: string | null) => void; onDate: (d: string) => void; disabled: boolean;
}) {
  const acc = usePicklist('accreditation');
  const un = (data.unlocked ?? {}) as Record<string, boolean>;
  const setUn = (k: string, v: boolean) => onData({ ...data, unlocked: { ...un, [k]: v } });
  const F = (label: string, path: string, extra: { multiline?: boolean; placeholder?: string } = {}) => (
    <LockField key={path} label={label} value={String(getPath(data, path) ?? '')} unlocked={!!un[path]} onUnlock={(u) => setUn(path, u)} disabled={disabled}
      onChange={(v) => onData(setPath(data, path, v))} {...extra} />
  );
  const isReport = kind === 'report';
  return (
    <Paper withBorder p="md">
      <Text fw={600} size="sm" mb={2}>Document details</Text>
      <Text size="xs" c="dimmed" mb="sm">Filled in automatically. Click a <IconLock size={11} style={{ verticalAlign: -1 }} /> to change any value on this document.</Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <LockField label={isReport ? 'Report number' : kind === 'invoice' ? 'Invoice number' : 'Quotation number'} value={doc.number ?? ''} placeholder="assigned automatically on issue"
          unlocked={!!un.number} onUnlock={(u) => setUn('number', u)} disabled={disabled} onChange={(v) => onNumber(v.trim() || null)} />
        {isReport
          ? F('Date of issue', 'issueText', { placeholder: 'set when signed' })
          : <LockField label="Date" type="date" value={doc.date ?? ''} unlocked={!!un.date} onUnlock={(u) => setUn('date', u)} disabled={disabled} onChange={(v) => v && onDate(v)} />}
        <Select label="Report type" description="NABL selects the NABL letterhead" data={acc} value={data.accreditation ?? null} disabled={disabled} clearable={!isReport}
          onChange={(v) => onData({ ...data, accreditation: v })} />
        <TextInput label="Customer reference" placeholder="Verbal / letter no. & date" disabled={disabled} value={data.customerRef ?? ''} onChange={(e) => onData({ ...data, customerRef: e.currentTarget.value })} />
        {F('Client name', 'client.name')}
        {!isReport && F('GSTIN', 'client.gstin')}
        <div style={{ gridColumn: '1 / -1' }}>{F('Client address', 'client.address', { multiline: true })}</div>
        {!isReport && (
          <Group grow gap="xs" align="flex-end">
            <Select label="Place of supply" searchable disabled={disabled} data={INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.code} – ${s.name}` }))} value={data.placeOfSupply ?? null}
              onChange={(v) => onData({ ...data, placeOfSupply: v, placeOfSupplyName: un.placeOfSupplyName ? data.placeOfSupplyName : stateName(v) })} />
          </Group>
        )}
        {!isReport && F('Site / project', data.site ? 'site.project' : 'site.name')}
        {!isReport && F('Contact person', 'contact.name')}
        {!isReport && F('Contact phone', 'contact.phone')}
        {!isReport && F('Contact email', 'contact.email')}
        {kind === 'invoice' && F('Copy label', 'copyLabel')}
        {kind === 'invoice' && F('SAC', 'sac')}
        {kind === 'quote' && <TextInput label="Valid for (days)" type="number" disabled={disabled} value={data.validityDays ?? ''} onChange={(e) => onData({ ...data, validityDays: Number(e.currentTarget.value) || null })} />}
        {isReport && F('Job code', 'jobCodeText')}
        {isReport && F('ULR number', 'ulr')}
        {isReport && F('Date of sample received', 'receivedText')}
        {isReport && F('Date of test', 'testDatesText')}
        {isReport && F('Specification*', 'specification')}
        {isReport && F('Condition of sample', 'condition')}
        {isReport && F('Source of sample', 'source')}
      </SimpleGrid>
      {!isReport && doc.date && <Text size="xs" c="dimmed" mt="xs">Printed date: {data.dateText && un.dateText ? data.dateText : formatDate(doc.date)}</Text>}
    </Paper>
  );
}
