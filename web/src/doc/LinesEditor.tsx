import { ActionIcon, Button, Group, NumberInput, Paper, Select, Stack, Text, TextInput, Textarea, SegmentedControl, SimpleGrid } from '@mantine/core';
import { IconTrash, IconPlus } from '@tabler/icons-react';
import { INDIAN_STATES, type LineInput } from '@suite/shared';
import { useApi, money } from '../api';

export function DocDetailsForm({ kind, data, onChange, totals, disabled }: { kind: string; data: Record<string, any>; onChange: (d: Record<string, any>) => void; totals: any; disabled?: boolean }) {
  const { data: catalog } = useApi<any[]>('/catalog');
  const lines = (data.lines ?? []) as LineInput[];
  const set = (patch: Record<string, any>) => onChange({ ...data, ...patch });
  const setLine = (i: number, patch: Partial<LineInput>) => set({ lines: lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const addCatalog = (id: string | null) => {
    const c = catalog?.find((x) => String(x.id) === id); if (!c) return;
    const line: LineInput = { description: c.billing_name, rate: c.rate, qty: 1, unit: c.unit, remarks: kind === 'quote' ? (c.obs_template_code || c.method ? (c.nabl ? 'NABL' : 'Non-NABL') : '--') : '', sac: c.sac, gstRate: c.gst_rate, catalogId: c.id };
    let notes: string = data.notes ?? '';
    if (c.conditions && !notes.includes(c.conditions)) notes = notes ? `${notes}\n${c.conditions}` : c.conditions;
    set({ lines: [...lines, line], notes });
  };
  const rateMode = data.mode === 'rate';
  return (
    <Stack gap="sm">
      {kind === 'quote' && (
        <SegmentedControl disabled={disabled} value={data.mode ?? 'rate'} onChange={(v) => set({ mode: v })} data={[{ value: 'rate', label: 'Rate quote (unit rates only)' }, { value: 'estimate', label: 'Estimate (qty, totals, GST)' }]} />
      )}
      <SimpleGrid cols={2}>
        <TextInput disabled={disabled} label="Customer reference" placeholder="Verbal / letter no. & date" value={data.customerRef ?? ''} onChange={(e) => set({ customerRef: e.currentTarget.value })} />
        <Select disabled={disabled} label="Place of supply" searchable data={INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.code} – ${s.name}` }))} value={data.placeOfSupply ?? null} onChange={(v) => set({ placeOfSupply: v })} />
        {kind === 'invoice' && <Select disabled={disabled} label="Copy label" data={['ORIGINAL COPY', 'DUPLICATE COPY', 'TRIPLICATE COPY', '']} value={data.copyLabel ?? 'ORIGINAL COPY'} onChange={(v) => set({ copyLabel: v ?? '' })} />}
        {kind === 'invoice' && <TextInput disabled={disabled} label="SAC" value={data.sac ?? ''} onChange={(e) => set({ sac: e.currentTarget.value })} />}
        {kind === 'quote' && <NumberInput disabled={disabled} label="Valid for (days)" value={data.validityDays ?? 30} onChange={(v) => set({ validityDays: Number(v) })} />}
        {!rateMode && <NumberInput disabled={disabled} label="Overall discount (₹)" value={data.overallDiscount ?? 0} min={0} thousandSeparator="," onChange={(v) => set({ overallDiscount: Number(v) || 0 })} />}
      </SimpleGrid>

      <Stack gap={6}>
        {lines.map((l, i) => (
          <Paper key={i} withBorder p="xs" radius="md">
            <Group gap="xs" align="flex-start" wrap="nowrap">
              <Text size="sm" fw={600} w={18} mt={6}>{i + 1}</Text>
              <Stack gap={6} style={{ flex: 1 }}>
                <Textarea disabled={disabled} size="xs" autosize minRows={1} placeholder="Description" value={l.description} onChange={(e) => setLine(i, { description: e.currentTarget.value })} />
                <Group gap={6} grow wrap="nowrap">
                  <NumberInput disabled={disabled} size="xs" label="Rate (₹)" value={l.rate} min={0} thousandSeparator="," hideControls onChange={(v) => setLine(i, { rate: Number(v) || 0 })} />
                  {!rateMode && <NumberInput disabled={disabled} size="xs" label="Qty" value={l.qty ?? 1} min={0} hideControls onChange={(v) => setLine(i, { qty: Number(v) || 0 })} />}
                  <TextInput disabled={disabled} size="xs" label="Unit" value={l.unit ?? ''} onChange={(e) => setLine(i, { unit: e.currentTarget.value })} />
                  <TextInput disabled={disabled} size="xs" label="Remarks" value={l.remarks ?? ''} onChange={(e) => setLine(i, { remarks: e.currentTarget.value })} />
                  {!rateMode && <TextInput size="xs" label="Amount" value={money((l.qty ?? 0) * l.rate)} readOnly variant="filled" />}
                </Group>
              </Stack>
              <ActionIcon disabled={disabled} variant="subtle" color="red" mt={4} onClick={() => set({ lines: lines.filter((_, j) => j !== i) })}><IconTrash size={15} /></ActionIcon>
            </Group>
          </Paper>
        ))}
        {!lines.length && <Text size="sm" c="dimmed">No lines yet. Add tests from the rate card below.</Text>}
        {!disabled && (
          <Group gap="xs">
            <Select placeholder="Add a test or service from the rate card…" searchable style={{ flex: 1 }} value={null} onChange={addCatalog}
              data={(catalog ?? []).filter((c) => c.active).map((c) => ({ value: String(c.id), label: `${c.billing_name} · ₹${money(c.rate)} ${c.unit ?? ''}` }))} />
            <Button variant="default" leftSection={<IconPlus size={14} />} onClick={() => set({ lines: [...lines, { description: '', rate: 0, qty: 1, unit: '', remarks: '' }] })}>Custom line</Button>
          </Group>
        )}
      </Stack>
      {!rateMode && totals && (
        <Group justify="flex-end" gap="lg">
          <Text size="sm">Taxable ₹{money(totals.taxable, 2)}</Text>
          <Text size="sm">{totals.interState ? `IGST ₹${money(totals.igst, 2)}` : `CGST ₹${money(totals.cgst, 2)} + SGST ₹${money(totals.sgst, 2)}`}</Text>
          <Text fw={700}>Total ₹{money(totals.total)}</Text>
        </Group>
      )}
      {kind === 'quote' && <Textarea disabled={disabled} label="Notes / terms (one per line)" autosize minRows={3} value={data.notes ?? ''} onChange={(e) => set({ notes: e.currentTarget.value })} />}
    </Stack>
  );
}
