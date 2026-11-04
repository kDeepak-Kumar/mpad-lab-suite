import { TermsPicker } from '../components/Terms';
import { moveItem, useDragReorder } from '../components/useDragReorder';
import { useState } from 'react';
import { ActionIcon, Button, Group, Modal, NumberInput, Paper, Select, Stack, Switch, Text, TextInput, Textarea, Tooltip } from '@mantine/core';
import { IconTrash, IconPlus, IconSparkles, IconGripVertical } from '@tabler/icons-react';
import type { LineInput } from '@suite/shared';
import { api, useApi, money, ok } from '../api';
import { useCan } from '../ctx';

/** Line items + quantity/GST options. Quotes can be rate-only or show qty, amount and GST. */
export function DocDetailsForm({ kind, data, onChange, totals, disabled }: { kind: string; data: Record<string, any>; onChange: (d: Record<string, any>) => void; totals: any; disabled?: boolean }) {
  const { data: catalog } = useApi<any[]>('/catalog');
  const can = useCan();
  const [paste, setPaste] = useState(false);
  const lines = (data.lines ?? []) as LineInput[];
  const set = (patch: Record<string, any>) => onChange({ ...data, ...patch });
  const setLine = (i: number, patch: Partial<LineInput>) => set({ lines: lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const showQty = kind !== 'quote' || (data.showQty ?? data.mode !== 'rate');
  const includeGst = kind !== 'quote' || (data.includeGst ?? data.mode !== 'rate');
  const lineFrom = (c: any, qty = 1): LineInput => ({ description: c.billing_name, rate: c.rate, qty, unit: c.unit, remarks: kind === 'quote' ? (c.obs_template_code || c.method ? (c.nabl ? 'NABL' : 'Non-NABL') : '--') : '', sac: c.sac, gstRate: c.gst_rate, catalogId: c.id });
  const addCatalog = (id: string | null) => {
    const c = catalog?.find((x) => String(x.id) === id); if (!c) return;
    let notes: string = data.notes ?? '';
    if (c.conditions && !notes.includes(c.conditions)) notes = notes ? `${notes}\n${c.conditions}` : c.conditions;
    set({ lines: [...lines, lineFrom(c)], notes });
  };
  const dnd = useDragReorder('doc-lines', (from, to) => set({ lines: moveItem(lines, from, to) }), disabled);
  return (
    <Stack gap="sm">
      {kind === 'quote' && (
        <Paper withBorder p="sm">
          <Group gap="xl">
            <Switch disabled={disabled} label="Show quantity and amount" description="Off = rate-only quotation" checked={showQty} onChange={(e) => set({ showQty: e.currentTarget.checked, mode: undefined })} />
            <Switch disabled={disabled || !showQty} label="Add GST to the total" description="Off = “GST extra as applicable”" checked={includeGst && showQty} onChange={(e) => set({ includeGst: e.currentTarget.checked, mode: undefined })} />
          </Group>
        </Paper>
      )}
      {showQty && (
        <Paper withBorder p="sm">
          <Group gap="md" align="flex-end">
            <NumberInput disabled={disabled} w={150} label="Discount %" min={0} max={100} decimalScale={2} clampBehavior="strict" value={data.discountPct ?? 0}
              description={data.unlocked?.discountPct ? 'Set for this document' : 'From client / site'}
              onChange={(v) => set({ discountPct: v === '' ? 0 : Number(v), unlocked: { ...(data.unlocked ?? {}), discountPct: true } })} />
            <NumberInput disabled={disabled} w={170} label="Extra discount (₹)" min={0} decimalScale={2} thousandSeparator="," value={data.overallDiscount ?? 0} onChange={(v) => set({ overallDiscount: v === '' ? 0 : Number(v) })} />
            {totals?.discount > 0 && <Text size="sm" c="dimmed" mb={6}>Total discount ₹{money(totals.discount)}</Text>}
          </Group>
        </Paper>
      )}
      <Stack gap={6}>
        {lines.map((l, i) => (
          <Paper key={i} withBorder p="xs" radius="md" {...dnd.rowProps(i)}>
            <Group gap="xs" align="flex-start" wrap="nowrap">
              <Stack gap={0} mt={4} align="center">
                <Text size="sm" fw={650} c="dimmed" w={18} ta="center">{i + 1}</Text>
                {!disabled && lines.length > 1 && <span className="drag-handle" {...dnd.handleProps(i)}><IconGripVertical size={14} /></span>}
              </Stack>
              <Stack gap={6} style={{ flex: 1 }}>
                <Textarea disabled={disabled} size="xs" autosize minRows={1} placeholder="Description" value={l.description} onChange={(e) => setLine(i, { description: e.currentTarget.value })} />
                <Group gap={6} grow wrap="nowrap">
                  <NumberInput disabled={disabled} size="xs" label="Rate (₹)" value={l.rate} min={0} thousandSeparator="," hideControls onChange={(v) => setLine(i, { rate: Number(v) || 0 })} />
                  {showQty && <NumberInput disabled={disabled} size="xs" label="Qty" value={l.qty ?? 1} min={0} decimalScale={2} onChange={(v) => setLine(i, { qty: Number(v) || 0 })} />}
                  <TextInput disabled={disabled} size="xs" label="Unit" value={l.unit ?? ''} onChange={(e) => setLine(i, { unit: e.currentTarget.value })} />
                  <TextInput disabled={disabled} size="xs" label="Remarks" value={l.remarks ?? ''} onChange={(e) => setLine(i, { remarks: e.currentTarget.value })} />
                  {showQty && <TextInput size="xs" label="Amount" value={money((l.qty ?? 0) * l.rate)} readOnly variant="filled" />}
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
            {kind === 'quote' && can('useAI') && <Button variant="light" leftSection={<IconSparkles size={14} />} onClick={() => setPaste(true)}>From enquiry text</Button>}
          </Group>
        )}
      </Stack>
      {showQty && totals && (
        <Group justify="flex-end" gap="lg">
          <Text size="sm">Taxable ₹{money(totals.taxable, 2)}</Text>
          {includeGst ? <Text size="sm">{totals.interState ? `IGST ₹${money(totals.igst, 2)}` : `CGST ₹${money(totals.cgst, 2)} + SGST ₹${money(totals.sgst, 2)}`}</Text> : <Text size="sm" c="dimmed">GST extra</Text>}
          <Text fw={700}>Total ₹{money(totals.total)}</Text>
        </Group>
      )}
      {!includeGst && kind === 'quote' && showQty && <Text size="xs" c="dimmed">Tip: keep a note such as “GST will be applicable on above rates”.</Text>}
      {kind === 'quote' && <div>
        <Group justify="space-between" mb={4}><Text size="sm" fw={500}>Notes / terms (one per line)</Text><TermsPicker kind="quote" disabled={disabled} onInsert={(l) => set({ notes: [...String(data.notes ?? '').split('\n').filter(Boolean), ...l].join('\n') })} /></Group>
        <Textarea disabled={disabled} autosize minRows={3} value={data.notes ?? ''} onChange={(e) => set({ notes: e.currentTarget.value })} />
      </div>}
      {paste && <EnquiryModal catalog={catalog ?? []} onClose={() => setPaste(false)} onLines={(ls, notes) => { set({ lines: [...lines, ...ls.map((x) => { const c = catalog?.find((k) => k.id === x.catalogId); return c ? { ...lineFrom(c, x.qty || 1) } : { description: x.description, rate: 0, qty: x.qty || 1, unit: '', remarks: '' }; })], notes: notes ? `${data.notes ?? ''}\n${notes}`.trim() : data.notes }); setPaste(false); }} />}
    </Stack>
  );
}

/** Paste a client's email/WhatsApp enquiry; AI (or keyword matching) turns it into quote lines. */
function EnquiryModal({ catalog, onClose, onLines }: { catalog: any[]; onClose: () => void; onLines: (l: { catalogId: number | null; description: string; qty: number }[], notes?: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fallback = () => {
    const t = text.toLowerCase();
    return catalog.filter((c) => c.active && [c.report_name, c.code].filter(Boolean).some((k: string) => k.length > 2 && t.includes(k.toLowerCase()))).map((c) => ({ catalogId: c.id, description: c.billing_name, qty: 1 }));
  };
  const run = async () => {
    setBusy(true);
    try { const r = await api<any>('/ai/assist', { body: { task: 'quote_lines', input: text }, quiet: true }); onLines(r.lines ?? [], r.notes); ok(`Added ${r.lines?.length ?? 0} line(s) with AI`); }
    catch { const l = fallback(); onLines(l); ok(l.length ? `Matched ${l.length} test(s) by name (AI not configured)` : 'No tests matched – add them from the rate card'); }
    finally { setBusy(false); }
  };
  return (
    <Modal opened onClose={onClose} title="Create lines from the client’s enquiry" size="lg">
      <Stack>
        <Textarea autosize minRows={6} placeholder="Paste the email or WhatsApp message, e.g. “Please quote for CBR and Proctor on 3 soil samples and 2 plate load tests at our Kokapet site”" value={text} onChange={(e) => setText(e.currentTarget.value)} />
        <Text size="xs" c="dimmed">Uses the AI model set in Settings; without one, tests are matched by name.</Text>
        <Group justify="flex-end"><Button loading={busy} disabled={text.trim().length < 5} leftSection={<IconSparkles size={14} />} onClick={run}>Add lines</Button></Group>
      </Stack>
    </Modal>
  );
}
