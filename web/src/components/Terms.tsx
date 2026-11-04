import { useState } from 'react';
import { ActionIcon, Badge, Button, Chip, Group, Menu, Paper, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { IconFileText, IconPlus, IconTrash, IconChevronDown } from '@tabler/icons-react';
import { useApi } from '../api';

export interface TermSet { id: string; name: string; applies: string[]; text: string }
const KINDS = [{ value: 'quote', label: 'Quotations' }, { value: 'report', label: 'Test reports' }, { value: 'invoice', label: 'Invoices' }];

/** "Insert terms" menu next to a notes box: picks a saved set (Boreholes, SPT, SBC…) and adds its lines. */
export function TermsPicker({ kind, onInsert, disabled }: { kind: string; onInsert: (lines: string[]) => void; disabled?: boolean }) {
  const { data } = useApi<any>('/company', []);
  const sets: TermSet[] = (data?.terms ?? []).filter((t: TermSet) => !t.applies?.length || t.applies.includes(kind));
  return (
    <Menu shadow="lg" position="bottom-end" width={280}>
      <Menu.Target><Button size="compact-xs" variant="light" disabled={disabled} leftSection={<IconFileText size={13} />} rightSection={<IconChevronDown size={12} />}>Insert terms</Button></Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Terms & conditions library</Menu.Label>
        {sets.map((t) => <Menu.Item key={t.id} onClick={() => onInsert(t.text.split('\n').map((l) => l.trim()).filter(Boolean))}>{t.name}</Menu.Item>)}
        {!sets.length && <Text size="xs" c="dimmed" p="xs">No terms yet. Add them in Company & branding → Terms & conditions.</Text>}
      </Menu.Dropdown>
    </Menu>
  );
}

/** Settings editor: named sets of terms, each for quotations / reports / invoices. */
export function TermsSettings({ v, set }: { v: any; set: (path: string, value: unknown) => void }) {
  const list: TermSet[] = v.terms ?? [];
  const [open, setOpen] = useState<string | null>(list[0]?.id ?? null);
  const upd = (id: string, patch: Partial<TermSet>) => set('terms', list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const add = () => { const id = Math.random().toString(36).slice(2, 9); set('terms', [...list, { id, name: 'New terms', applies: ['quote', 'report'], text: '' }]); setOpen(id); };
  return (
    <Stack>
      <Text size="sm" c="dimmed">Create a set for each kind of job – e.g. <b>Boreholes</b>, <b>SPT</b>, <b>SBC</b>, <b>Water testing</b>. On a quotation or report use <b>Insert terms</b> to add its lines. One condition per line.</Text>
      {list.map((t) => (
        <Paper key={t.id} withBorder p="sm" radius="md" style={{ borderColor: open === t.id ? '#9ec2ef' : undefined }}>
          <Group justify="space-between" onClick={() => setOpen(open === t.id ? null : t.id)} style={{ cursor: 'pointer' }}>
            <Group gap="xs"><Text fw={600}>{t.name}</Text>{t.applies.map((a) => <Badge key={a} size="xs" variant="light">{KINDS.find((k) => k.value === a)?.label}</Badge>)}<Text size="xs" c="dimmed">{t.text.split('\n').filter(Boolean).length} lines</Text></Group>
            <ActionIcon variant="subtle" color="red" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete "${t.name}"?`)) set('terms', list.filter((x) => x.id !== t.id)); }}><IconTrash size={15} /></ActionIcon>
          </Group>
          {open === t.id && (
            <Stack gap="xs" mt="sm">
              <TextInput label="Name (shown in the dropdown)" value={t.name} onChange={(e) => upd(t.id, { name: e.currentTarget.value })} />
              <div><Text size="sm" fw={500} mb={4}>Use on</Text><Chip.Group multiple value={t.applies} onChange={(a) => upd(t.id, { applies: a })}><Group gap="xs">{KINDS.map((k) => <Chip key={k.value} value={k.value} size="xs">{k.label}</Chip>)}</Group></Chip.Group></div>
              <Textarea label="Terms (one per line)" autosize minRows={5} value={t.text} onChange={(e) => upd(t.id, { text: e.currentTarget.value })}
                placeholder={'Boreholes will be drilled up to the depth specified or refusal, whichever is earlier.\nSite access, water and permissions to be arranged by the client.'} />
            </Stack>
          )}
        </Paper>
      ))}
      <Button variant="light" leftSection={<IconPlus size={15} />} onClick={add} w="fit-content">Add a terms set</Button>
    </Stack>
  );
}
