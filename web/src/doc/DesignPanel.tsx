import { ActionIcon, Button, Group, NumberInput, Paper, ScrollArea, Select, Stack, Switch, Text, TextInput, Textarea, ColorInput, Divider, SegmentedControl } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconEye, IconEyeOff } from '@tabler/icons-react';
import { BLOCK_LABELS, type DocOverrides, type DocTemplate } from '@suite/shared';

/**
 * Block-based layout editor. Changes are stored as per-document overrides; "Save to template"
 * promotes them into a new template version for future documents.
 */
export function DesignPanel({ base, overrides, onChange, selected, onSelect, onSaveTemplate, onReset, readOnly }: {
  base: DocTemplate; overrides: DocOverrides; onChange: (o: DocOverrides) => void; selected: string | null; onSelect: (id: string | null) => void;
  onSaveTemplate?: () => void; onReset?: () => void; readOnly?: boolean;
}) {
  const order = overrides.order?.length ? overrides.order : base.blocks.map((b) => b.id);
  const blocks = order.map((id) => base.blocks.find((b) => b.id === id)).filter(Boolean) as DocTemplate['blocks'];
  const eff = (id: string) => { const b = base.blocks.find((x) => x.id === id)!; const o = overrides.blocks?.[id]; return { ...b, visible: o?.visible ?? b.visible, props: { ...b.props, ...(o?.props ?? {}) } }; };
  const setBlock = (id: string, patch: { visible?: boolean; props?: Record<string, unknown> }) => {
    const cur = overrides.blocks?.[id] ?? {};
    onChange({ ...overrides, blocks: { ...(overrides.blocks ?? {}), [id]: { ...cur, ...(patch.visible !== undefined ? { visible: patch.visible } : {}), ...(patch.props ? { props: { ...(cur.props ?? {}), ...patch.props } } : {}) } } });
  };
  const move = (id: string, dir: -1 | 1) => {
    const o = [...order]; const i = o.indexOf(id); const j = i + dir;
    if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; onChange({ ...overrides, order: o });
  };
  const pageS = { ...base.page, ...(overrides.page ?? {}) };
  const setPage = (k: string, v: unknown) => onChange({ ...overrides, page: { ...(overrides.page ?? {}), [k]: v } });
  const sel = selected ? eff(selected) : null;

  return (
    <Paper withBorder p="sm" radius="md" className="no-print">
      <ScrollArea.Autosize mah="calc(100vh - 200px)">
        <Stack gap="xs">
          <Text fw={600} size="sm">Layout</Text>
          {readOnly && <Text size="xs" c="dimmed">This document is issued: its layout is frozen.</Text>}
          <Group grow>
            <NumberInput size="xs" label="Margin (mm)" value={pageS.marginMm} min={5} max={30} onChange={(v) => setPage('marginMm', Number(v))} disabled={readOnly} />
            <NumberInput size="xs" label="Font size (pt)" value={pageS.fontSize} min={8} max={14} step={0.5} decimalScale={1} onChange={(v) => setPage('fontSize', Number(v))} disabled={readOnly} />
          </Group>
          <Select size="xs" label="Font" disabled={readOnly} value={pageS.fontFamily} onChange={(v) => v && setPage('fontFamily', v)} data={[
            { value: 'Times New Roman, Times, serif', label: 'Times New Roman' }, { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
            { value: 'Calibri, Carlito, sans-serif', label: 'Calibri' }, { value: 'Cambria, Georgia, serif', label: 'Cambria' }]} />
          <Group grow>
            <SegmentedControl size="xs" disabled={readOnly} value={pageS.orientation} onChange={(v) => setPage('orientation', v)} data={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
            <ColorInput size="xs" disabled={readOnly} value={pageS.accent} onChange={(v) => setPage('accent', v)} />
          </Group>
          <Switch size="xs" disabled={readOnly} label="Letterhead mode (print on pre-printed letterhead)" checked={pageS.letterheadMode} onChange={(e) => setPage('letterheadMode', e.currentTarget.checked)} />
          <Divider label="Blocks – click one to edit" labelPosition="left" />
          {blocks.map((b, i) => {
            const e = eff(b.id);
            return (
              <Group key={b.id} gap={4} wrap="nowrap" p={4} style={{ borderRadius: 6, background: selected === b.id ? '#eef2f9' : undefined, cursor: 'pointer' }} onClick={() => onSelect(b.id)}>
                <ActionIcon size="sm" variant="subtle" disabled={readOnly} onClick={(ev) => { ev.stopPropagation(); setBlock(b.id, { visible: !e.visible }); }}>{e.visible ? <IconEye size={15} /> : <IconEyeOff size={15} />}</ActionIcon>
                <Text size="sm" style={{ flex: 1 }} c={e.visible ? undefined : 'dimmed'}>{BLOCK_LABELS[b.type] ?? b.type}{b.type === 'text' ? `: ${String(e.props.text ?? '').slice(0, 18)}…` : ''}</Text>
                <ActionIcon size="sm" variant="subtle" disabled={readOnly || i === 0} onClick={(ev) => { ev.stopPropagation(); move(b.id, -1); }}><IconArrowUp size={14} /></ActionIcon>
                <ActionIcon size="sm" variant="subtle" disabled={readOnly || i === blocks.length - 1} onClick={(ev) => { ev.stopPropagation(); move(b.id, 1); }}><IconArrowDown size={14} /></ActionIcon>
              </Group>
            );
          })}
          {sel && !readOnly && <BlockProps block={sel} onProps={(props) => setBlock(sel.id, { props })} />}
          {!readOnly && (
            <Group mt="sm" grow>
              {onReset && <Button size="xs" variant="default" onClick={onReset}>Reset layout</Button>}
              {onSaveTemplate && <Button size="xs" variant="light" onClick={onSaveTemplate}>Save to template</Button>}
            </Group>
          )}
          <Text size="xs" c="dimmed">Layout edits apply to this document only. “Save to template” makes them the default for future documents.</Text>
        </Stack>
      </ScrollArea.Autosize>
    </Paper>
  );
}

function BlockProps({ block, onProps }: { block: { id: string; type: string; props: Record<string, any> }; onProps: (p: Record<string, unknown>) => void }) {
  const p = block.props;
  return (
    <Paper withBorder p="xs" bg="#fafbfc">
      <Text size="xs" fw={600} mb={4}>Edit: {BLOCK_LABELS[block.type] ?? block.type}</Text>
      <Stack gap={6}>
        {Object.entries(p).map(([k, v]) => {
          const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
          if (typeof v === 'boolean') return <Switch key={k} size="xs" label={label} checked={v} onChange={(e) => onProps({ [k]: e.currentTarget.checked })} />;
          if (typeof v === 'number') return <NumberInput key={k} size="xs" label={label} value={v} onChange={(x) => onProps({ [k]: Number(x) })} />;
          if (k === 'align') return <SegmentedControl key={k} size="xs" value={String(v)} onChange={(x) => onProps({ [k]: x })} data={['left', 'center', 'right']} />;
          if (typeof v === 'string') return v.length > 50 || k === 'text'
            ? <Textarea key={k} size="xs" label={label} autosize minRows={2} value={v} onChange={(e) => onProps({ [k]: e.currentTarget.value })} />
            : <TextInput key={k} size="xs" label={label} value={v} onChange={(e) => onProps({ [k]: e.currentTarget.value })} />;
          if (Array.isArray(v) && v.length && typeof v[0] === 'object' && 'label' in v[0]) {
            const list = v as { label: string; visible?: boolean; hidden?: boolean; align?: string; key?: string; field?: string }[];
            const upd = (i: number, patch: object) => onProps({ [k]: list.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <Stack key={k} gap={4}>
                <Text size="xs" c="dimmed">{label} – rename, show or hide</Text>
                {list.map((x, i) => {
                  const shown = x.visible !== undefined ? x.visible : !x.hidden;
                  return (
                    <Group key={i} gap={4} wrap="nowrap">
                      <ActionIcon size="sm" variant="subtle" onClick={() => upd(i, x.visible !== undefined ? { visible: !shown } : { hidden: shown })}>{shown ? <IconEye size={14} /> : <IconEyeOff size={14} />}</ActionIcon>
                      <TextInput size="xs" style={{ flex: 1 }} value={x.label} placeholder={x.key ?? x.field} onChange={(e) => upd(i, { label: e.currentTarget.value })} />
                      {x.align && <Select size="xs" w={78} data={['left', 'center', 'right']} value={x.align} onChange={(a) => a && upd(i, { align: a })} />}
                    </Group>
                  );
                })}
              </Stack>
            );
          }
          return null;
        })}
        {!Object.keys(p).length && <Text size="xs" c="dimmed">This block uses company settings (Settings → Company & branding).</Text>}
      </Stack>
    </Paper>
  );
}
