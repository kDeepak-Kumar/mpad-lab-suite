import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ActionIcon, Alert, Badge, Button, Checkbox, ColorSwatch, Grid, Group, Modal, NavLink, Paper, ScrollArea, Select, SimpleGrid, Stack, Switch, Table, Tabs, Text, TextInput, Textarea, Tooltip } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconEye, IconEyeOff, IconPlus, IconTrash, IconLock } from '@tabler/icons-react';
import { ACTIONS, OBJECTS, PERM_OBJECTS, TABS, objectDef, type FieldDef, type MetaFieldType, type Picklist, type RoleDef } from '@suite/shared';
import { api, ok } from '../../api';
import { useMeta } from '../../ctx';
import { PageHeader } from '../../components/ui';

const TYPES: { value: MetaFieldType; label: string }[] = [
  { value: 'text', label: 'Text' }, { value: 'textarea', label: 'Long text' }, { value: 'number', label: 'Number' }, { value: 'integer', label: 'Whole number' },
  { value: 'currency', label: 'Amount (₹)' }, { value: 'date', label: 'Date' }, { value: 'picklist', label: 'Picklist' }, { value: 'multipicklist', label: 'Multi-select picklist' },
  { value: 'checkbox', label: 'Checkbox' }, { value: 'email', label: 'Email' }, { value: 'phone', label: 'Phone' },
];
const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40);

export function SetupPage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'objects';
  return (
    <>
      <PageHeader title="Setup" subtitle="Customise the application without code: fields, picklists, page layouts, roles and permissions." />
      <Tabs value={tab} onChange={(t) => setSp({ tab: t ?? 'objects' })} keepMounted={false}>
        <Tabs.List mb="md"><Tabs.Tab value="objects">Objects & fields</Tabs.Tab><Tabs.Tab value="picklists">Picklists</Tabs.Tab><Tabs.Tab value="roles">Roles & permissions</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="objects"><ObjectManager /></Tabs.Panel>
        <Tabs.Panel value="picklists"><Picklists /></Tabs.Panel>
        <Tabs.Panel value="roles"><Roles /></Tabs.Panel>
      </Tabs>
    </>
  );
}

// ---------------- objects, fields and layouts ----------------
function ObjectManager() {
  const { meta, reload } = useMeta();
  const [obj, setObj] = useState('client');
  const [newField, setNewField] = useState<Partial<FieldDef> | null>(null);
  const def = objectDef(obj)!;
  const custom = meta.fields.filter((f) => f.object === obj);
  const all: (FieldDef & { custom?: boolean })[] = [...def.fields, ...custom.map((f) => ({ ...f, custom: true }))];
  const saved = meta.layouts.find((l) => l.object === obj);
  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    const keys = all.map((f) => f.key);
    setOrder(saved?.fields?.length ? [...saved.fields.filter((k) => keys.includes(k)), ...keys.filter((k) => !saved.fields.includes(k))] : keys);
    setHidden(saved?.hidden ?? []);
  }, [obj, meta]);
  const move = (i: number, d: number) => { const o = [...order]; const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; setOrder(o); };
  const saveLayout = async () => { await api(`/meta/layout/${obj}`, { method: 'PUT', body: { object: obj, fields: order, hidden } }); ok('Layout saved'); reload(); };
  const delField = async (key: string) => { if (!window.confirm('Delete this field? Values already entered stay in the records but are no longer shown.')) return; await api(`/meta/field/${obj}.${key}`, { method: 'DELETE' }); ok('Field deleted'); reload(); };
  return (
    <Grid>
      <Grid.Col span={{ base: 12, md: 3 }}>
        <Paper withBorder p="xs">
          {OBJECTS.map((o) => <NavLink key={o.key} label={o.plural} active={o.key === obj} onClick={() => setObj(o.key)} rightSection={<Badge size="xs" variant="light">{o.fields.length + meta.fields.filter((f) => f.object === o.key).length}</Badge>} />)}
        </Paper>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 9 }}>
        <Paper withBorder p="md">
          <Group justify="space-between" mb="sm">
            <div><Text fw={650}>{def.plural}: fields and layout</Text><Text size="xs" c="dimmed">Order sets how forms show the fields. Hidden fields disappear from forms for everyone. Field access per role is under Roles & permissions.</Text></div>
            <Group gap="xs"><Button variant="default" onClick={() => setNewField({ type: 'text', object: obj } as never)} leftSection={<IconPlus size={14} />}>New field</Button><Button onClick={saveLayout}>Save layout</Button></Group>
          </Group>
          {['quote', 'invoice', 'report', 'workorder', 'payment', 'test'].includes(obj) && <Alert variant="light" mb="sm">Standard fields of {def.plural.toLowerCase()} are built into their screens. Fields you add here appear under “Additional fields” and can be printed using a Text block with {'{{doc.custom.field_name}}'}.</Alert>}
          <Table verticalSpacing={6} fz="sm">
            <Table.Thead><Table.Tr><Table.Th>Order</Table.Th><Table.Th>Label</Table.Th><Table.Th>API name</Table.Th><Table.Th>Type</Table.Th><Table.Th>Required</Table.Th><Table.Th>Shown</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {order.map((k, i) => {
                const f = all.find((x) => x.key === k); if (!f) return null;
                const isHidden = hidden.includes(k);
                return (
                  <Table.Tr key={k} style={{ opacity: isHidden ? 0.5 : 1 }}>
                    <Table.Td><Group gap={2}><ActionIcon size="sm" variant="subtle" onClick={() => move(i, -1)}><IconArrowUp size={14} /></ActionIcon><ActionIcon size="sm" variant="subtle" onClick={() => move(i, 1)}><IconArrowDown size={14} /></ActionIcon></Group></Table.Td>
                    <Table.Td>{f.label} {f.custom ? <Badge size="xs" variant="light" color="grape">custom</Badge> : null}</Table.Td>
                    <Table.Td><Text size="xs" ff="monospace">{f.custom ? `custom.${f.key}` : f.key}</Text></Table.Td>
                    <Table.Td>{TYPES.find((t) => t.value === f.type)?.label ?? f.type}{f.picklist ? <Text span size="xs" c="dimmed"> ({f.picklist})</Text> : null}</Table.Td>
                    <Table.Td>{f.required ? 'Yes' : ''}</Table.Td>
                    <Table.Td>{f.system ? <Tooltip label="Required by the application"><IconLock size={14} color="#98a2b3" /></Tooltip> :
                      <ActionIcon size="sm" variant="subtle" onClick={() => setHidden((h) => (isHidden ? h.filter((x) => x !== k) : [...h, k]))}>{isHidden ? <IconEyeOff size={14} /> : <IconEye size={14} />}</ActionIcon>}</Table.Td>
                    <Table.Td>{f.custom && <Group gap={2}><Button size="compact-xs" variant="subtle" onClick={() => setNewField({ ...f })}>Edit</Button><ActionIcon size="sm" variant="subtle" color="red" onClick={() => delField(f.key)}><IconTrash size={14} /></ActionIcon></Group>}</Table.Td>
                  </Table.Tr>
                );
              })}
              {!order.length && <Table.Tr><Table.Td colSpan={7}><Text size="sm" c="dimmed">No fields yet. Add your own with “New field”.</Text></Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </Paper>
      </Grid.Col>
      {newField && <FieldModal object={obj} field={newField} picklists={meta.picklists} existing={all.map((f) => f.key)} onClose={(s) => { setNewField(null); if (s) reload(); }} />}
    </Grid>
  );
}

function FieldModal({ object, field, picklists, existing, onClose }: { object: string; field: Partial<FieldDef>; picklists: Picklist[]; existing: string[]; onClose: (s: boolean) => void }) {
  const editing = Boolean(field.key);
  const [v, setV] = useState<Partial<FieldDef>>({ type: 'text', required: false, ...field });
  const [values, setValues] = useState('');
  const key = editing ? field.key! : slug(v.label ?? '');
  const clash = !editing && existing.includes(key);
  const save = async () => {
    let picklist = v.picklist;
    if ((v.type === 'picklist' || v.type === 'multipicklist') && !picklist && values.trim()) {
      picklist = `${object}_${key}`;
      await api(`/meta/picklist/${picklist}`, { method: 'PUT', body: { key: picklist, label: v.label, values: values.split('\n').map((x) => x.trim()).filter(Boolean).map((x) => ({ value: x, active: true })) } });
    }
    await api(`/meta/field/${object}.${key}`, { method: 'PUT', body: { object, key, label: v.label, type: v.type, picklist, required: v.required, help: v.help } });
    ok(editing ? 'Field updated' : 'Field created – it now appears on forms, lists, filters and exports'); onClose(true);
  };
  return (
    <Modal opened onClose={() => onClose(false)} title={editing ? `Edit field: ${field.label}` : `New field on ${objectDef(object)?.label}`}>
      <Stack>
        <TextInput label="Label" value={v.label ?? ''} onChange={(e) => setV({ ...v, label: e.currentTarget.value })} data-autofocus />
        <Text size="xs" c={clash ? 'red' : 'dimmed'}>API name: custom.{key || '…'}{clash ? ' – already used' : ''}</Text>
        <Select label="Type" data={TYPES} value={v.type ?? 'text'} onChange={(x) => setV({ ...v, type: x as MetaFieldType })} disabled={editing} />
        {(v.type === 'picklist' || v.type === 'multipicklist') && <>
          <Select label="Use an existing picklist" clearable data={picklists.map((p) => ({ value: p.key, label: p.label }))} value={v.picklist ?? null} onChange={(x) => setV({ ...v, picklist: x ?? undefined })} />
          {!v.picklist && <TextInputArea label="…or type the values (one per line)" value={values} onChange={setValues} />}
        </>}
        <TextInput label="Help text (optional)" value={v.help ?? ''} onChange={(e) => setV({ ...v, help: e.currentTarget.value })} />
        <Switch label="Required" checked={!!v.required} onChange={(e) => setV({ ...v, required: e.currentTarget.checked })} />
        <Group justify="flex-end"><Button disabled={!v.label || !key || clash} onClick={save}>Save field</Button></Group>
      </Stack>
    </Modal>
  );
}
const TextInputArea = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => <Textarea label={label} autosize minRows={3} value={value} onChange={(e) => onChange(e.currentTarget.value)} />;

// ---------------- picklists ----------------
const COLORS = ['gray', 'blue', 'teal', 'green', 'yellow', 'orange', 'red', 'grape'];
function Picklists() {
  const { meta, reload } = useMeta();
  const [key, setKey] = useState(meta.picklists[0]?.key);
  const pl = meta.picklists.find((p) => p.key === key);
  const [vals, setVals] = useState(pl?.values ?? []);
  const [label, setLabel] = useState(pl?.label ?? '');
  useEffect(() => { setVals(pl?.values ?? []); setLabel(pl?.label ?? ''); }, [key, meta]);
  const save = async () => { await api(`/meta/picklist/${key}`, { method: 'PUT', body: { ...pl, label, values: vals.filter((v) => v.value.trim()) } }); ok('Picklist saved'); reload(); };
  const create = async () => {
    const name = window.prompt('Name of the new picklist'); if (!name) return;
    const k = slug(name);
    await api(`/meta/picklist/${k}`, { method: 'PUT', body: { key: k, label: name, values: [] } }); reload(); setKey(k);
  };
  const move = (i: number, d: number) => { const o = [...vals]; const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; setVals(o); };
  return (
    <Grid>
      <Grid.Col span={{ base: 12, md: 3 }}>
        <Paper withBorder p="xs">
          <ScrollArea.Autosize mah={520}>{meta.picklists.map((p) => <NavLink key={p.key} label={p.label} description={`${p.values.filter((v) => v.active !== false).length} values`} active={p.key === key} onClick={() => setKey(p.key)} />)}</ScrollArea.Autosize>
          <Button fullWidth mt="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={create}>New picklist</Button>
        </Paper>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 9 }}>
        {pl && (
          <Paper withBorder p="md">
            <Group justify="space-between" mb="sm"><TextInput label="Picklist name" value={label} onChange={(e) => setLabel(e.currentTarget.value)} w={320} /><Button onClick={save}>Save picklist</Button></Group>
            {pl.system && <Alert variant="light" mb="sm">The application relies on the existing values of this picklist (e.g. NABL selects the NABL letterhead). You can rename labels, add values or change colours.</Alert>}
            <Stack gap={6}>
              {vals.map((v, i) => (
                <Group key={i} gap="xs" wrap="nowrap">
                  <ActionIcon size="sm" variant="subtle" onClick={() => move(i, -1)}><IconArrowUp size={14} /></ActionIcon><ActionIcon size="sm" variant="subtle" onClick={() => move(i, 1)}><IconArrowDown size={14} /></ActionIcon>
                  <TextInput size="xs" w={220} value={v.value} disabled={pl.system && (pl.values.some((x) => x.value === v.value))} onChange={(e) => setVals(vals.map((x, j) => (j === i ? { ...x, value: e.currentTarget.value } : x)))} placeholder="Value" />
                  <TextInput size="xs" w={220} value={v.label ?? ''} onChange={(e) => setVals(vals.map((x, j) => (j === i ? { ...x, label: e.currentTarget.value } : x)))} placeholder="Display label (optional)" />
                  <Group gap={4}>{COLORS.map((c) => <ColorSwatch key={c} size={16} color={`var(--mantine-color-${c}-6)`} style={{ cursor: 'pointer', outline: v.color === c ? '2px solid #101828' : undefined }} onClick={() => setVals(vals.map((x, j) => (j === i ? { ...x, color: c } : x)))} />)}</Group>
                  <Switch size="xs" label="Active" checked={v.active !== false} onChange={(e) => setVals(vals.map((x, j) => (j === i ? { ...x, active: e.currentTarget.checked } : x)))} />
                </Group>
              ))}
              <Button size="xs" variant="light" w={140} leftSection={<IconPlus size={14} />} onClick={() => setVals([...vals, { value: '', active: true }])}>Add value</Button>
            </Stack>
          </Paper>
        )}
      </Grid.Col>
    </Grid>
  );
}

// ---------------- roles & permissions ----------------
const OBJ_LABEL: Record<string, string> = { client: 'Clients & sites', quote: 'Quotations', workorder: 'Work orders', sample: 'Samples', test: 'Tests & observations', report: 'Test reports', invoice: 'Invoices', payment: 'Payments', catalog: 'Rate card', equipment: 'Equipment' };
function Roles() {
  const { meta, reload } = useMeta();
  const [key, setKey] = useState('frontdesk');
  const role = meta.roles.find((r) => r.key === key);
  const [r, setR] = useState<RoleDef | null>(role ?? null);
  const [fieldObj, setFieldObj] = useState('client');
  useEffect(() => { setR(role ? structuredClone(role) : null); }, [key, meta]);
  const fields = useMemo(() => [...(objectDef(fieldObj)?.fields ?? []), ...meta.fields.filter((f) => f.object === fieldObj)], [fieldObj, meta]);
  if (!r) return null;
  const locked = Boolean(r.admin);
  const save = async () => { const { system, admin, ...body } = r; await api(`/meta/role/${r.key}`, { method: 'PUT', body: { ...body, key: r.key } }); ok('Role saved. Users get the new permissions on their next action.'); reload(); };
  const create = async () => {
    const name = window.prompt('Name of the new role (it starts as a copy of the selected role)'); if (!name) return;
    const k = slug(name);
    const { system, admin, ...base } = r;
    await api(`/meta/role/${k}`, { method: 'PUT', body: { ...base, key: k, label: name } }); reload(); setKey(k);
  };
  const remove = async () => { if (!window.confirm('Delete this role? Users with it must be moved to another role first.')) return; await api(`/meta/role/${r.key}`, { method: 'DELETE' }); reload(); setKey('frontdesk'); };
  return (
    <Grid>
      <Grid.Col span={{ base: 12, md: 3 }}>
        <Paper withBorder p="xs">
          {meta.roles.map((x) => <NavLink key={x.key} label={x.label} description={x.admin ? 'Full access, skips validations' : x.system ? 'Standard role' : 'Custom role'} active={x.key === key} onClick={() => setKey(x.key)} />)}
          <Button fullWidth mt="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={create}>New role (copy of selected)</Button>
        </Paper>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 9 }}>
        <Paper withBorder p="md">
          <Group justify="space-between" mb="sm">
            <TextInput label="Role name" value={r.label} disabled={locked} onChange={(e) => setR({ ...r, label: e.currentTarget.value })} w={320} />
            <Group>{!r.system && <Button variant="subtle" color="red" onClick={remove}>Delete role</Button>}<Button disabled={locked} onClick={save}>Save role</Button></Group>
          </Group>
          {locked && <Alert color="orange" variant="light" mb="sm">The System Administrator has every permission, can customise the application and completes any workflow step alone (self-review, signing without verification, unlocking issued documents). Everything is still recorded in the audit trail.</Alert>}
          <Tabs defaultValue="tabs">
            <Tabs.List mb="sm"><Tabs.Tab value="tabs">Tabs</Tabs.Tab><Tabs.Tab value="objects">Records (CRUD)</Tabs.Tab><Tabs.Tab value="actions">Actions</Tabs.Tab><Tabs.Tab value="fields">Field access</Tabs.Tab></Tabs.List>
            <Tabs.Panel value="tabs">
              <SimpleGrid cols={{ base: 2, md: 3 }}>{TABS.map((t) => <Checkbox key={t.key} disabled={locked} label={t.label} checked={locked || r.tabs.includes(t.key)} onChange={(e) => setR({ ...r, tabs: e.currentTarget.checked ? [...r.tabs, t.key] : r.tabs.filter((x) => x !== t.key) })} />)}</SimpleGrid>
            </Tabs.Panel>
            <Tabs.Panel value="objects">
              <Table fz="sm" verticalSpacing={6}>
                <Table.Thead><Table.Tr><Table.Th>Records</Table.Th>{['read', 'create', 'edit', 'delete'].map((o) => <Table.Th key={o} ta="center" tt="capitalize">{o}</Table.Th>)}</Table.Tr></Table.Thead>
                <Table.Tbody>{PERM_OBJECTS.map((o) => (
                  <Table.Tr key={o}><Table.Td>{OBJ_LABEL[o]}</Table.Td>{(['read', 'create', 'edit', 'delete'] as const).map((op) => (
                    <Table.Td key={op} ta="center"><Checkbox disabled={locked} style={{ display: 'inline-block' }} checked={locked || Boolean(r.objects[o]?.[op])}
                      onChange={(e) => { const cur = Object.assign({ read: false, create: false, edit: false, delete: false }, r.objects[o]); cur[op] = e.currentTarget.checked; if (op !== 'read' && cur[op]) cur.read = true; if (op === 'read' && !cur.read) { cur.create = cur.edit = cur.delete = false; } setR({ ...r, objects: { ...r.objects, [o]: cur } }); }} /></Table.Td>))}</Table.Tr>
                ))}</Table.Tbody>
              </Table>
            </Tabs.Panel>
            <Tabs.Panel value="actions">
              <SimpleGrid cols={{ base: 1, md: 2 }}>{ACTIONS.map((a) => <Checkbox key={a.key} disabled={locked} label={a.label} checked={locked || Boolean(r.actions[a.key])} onChange={(e) => setR({ ...r, actions: { ...r.actions, [a.key]: e.currentTarget.checked } })} />)}</SimpleGrid>
            </Tabs.Panel>
            <Tabs.Panel value="fields">
              <Select label="Object" w={260} mb="sm" data={OBJECTS.filter((o) => objectDef(o.key)!.fields.length || meta.fields.some((f) => f.object === o.key)).map((o) => ({ value: o.key, label: o.plural }))} value={fieldObj} onChange={(v) => setFieldObj(v ?? 'client')} />
              <Table fz="sm" verticalSpacing={4}>
                <Table.Thead><Table.Tr><Table.Th>Field</Table.Th><Table.Th>Access for this role</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>{fields.map((f) => {
                  const k = `${fieldObj}.${f.key}`;
                  return <Table.Tr key={k}><Table.Td>{f.label}</Table.Td><Table.Td>
                    <Select size="xs" w={200} disabled={locked || (f as FieldDef).system} data={[{ value: 'edit', label: 'Read & edit' }, { value: 'read', label: 'Read only' }, { value: 'hidden', label: 'Hidden' }]} value={r.fields[k] ?? 'edit'}
                      onChange={(v) => { const fs = { ...r.fields }; if (!v || v === 'edit') delete fs[k]; else fs[k] = v as 'read' | 'hidden'; setR({ ...r, fields: fs }); }} />
                  </Table.Td></Table.Tr>;
                })}</Table.Tbody>
              </Table>
            </Tabs.Panel>
          </Tabs>
        </Paper>
      </Grid.Col>
    </Grid>
  );
}
