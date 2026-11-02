import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Accordion, ActionIcon, Alert, Badge, Button, Checkbox, Code, Drawer, Grid, Group, Modal, NumberInput, Paper, ScrollArea, Select, SimpleGrid,
  Stack, Table, Tabs, Text, TextInput, Textarea, Tooltip,
} from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconHelp, IconPlus, IconTrash } from '@tabler/icons-react';
import {
  EQUIPMENT_CATEGORIES, TEMPLATE_CATEGORIES, evaluateObservation, exampleInput, formatValue, formulaIssue, renderSampleCalc, templateNames, validateTemplate,
  type ChartDef, type Grid as ObsGrid, type GridColumn, type ObservationTemplate,
} from '@suite/shared';
import { api, ok, useApi } from '../../api';
import { Loading, PageHeader } from '../../components/ui';

// ------------------------------------------------------------------ generic row editor

type Kind = 'text' | 'number' | 'select' | 'bool' | 'formula' | 'list' | 'textarea';
interface Col<T> { key: keyof T & string; label: string; type?: Kind; options?: string[]; width?: number; placeholder?: string; help?: string }

/** Small spreadsheet-like editor for a list of objects: add, delete, reorder, formula checking. */
function RowsEditor<T extends Record<string, any>>({ rows, cols, onChange, names, blank, addLabel = 'Add', preview }: {
  rows: T[]; cols: Col<T>[]; onChange: (rows: T[]) => void; names?: Set<string>; blank: T; addLabel?: string; preview?: (row: T) => string;
}) {
  const set = (i: number, k: string, v: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const move = (i: number, d: number) => { const n = [...rows]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); onChange(n); };
  return (
    <Stack gap={4}>
      <ScrollArea type="auto">
        <Table withTableBorder withColumnBorders verticalSpacing={2} horizontalSpacing={4} style={{ minWidth: 640 }}>
          <Table.Thead><Table.Tr>{cols.map((c) => <Table.Th key={c.key} style={{ width: c.width, fontSize: 12 }}>{c.help ? <Tooltip label={c.help} multiline w={260}><span style={{ borderBottom: '1px dotted' }}>{c.label}</span></Tooltip> : c.label}</Table.Th>)}{preview && <Table.Th style={{ fontSize: 12, width: 110 }}>Example value</Table.Th>}<Table.Th style={{ width: 84 }} /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {rows.map((r, i) => (
              <Table.Tr key={i}>
                {cols.map((c) => {
                  const v = r[c.key];
                  const issue = c.type === 'formula' && names ? formulaIssue(String(v ?? ''), names) : null;
                  return (
                    <Table.Td key={c.key} style={{ verticalAlign: 'top' }}>
                      {c.type === 'bool' ? <Checkbox mt={6} checked={Boolean(v)} onChange={(e) => set(i, c.key, e.currentTarget.checked || undefined)} />
                        : c.type === 'select' ? <Select size="xs" data={c.options ?? []} value={v === undefined || v === null ? null : String(v)} onChange={(x) => set(i, c.key, x ?? undefined)} searchable clearable />
                        : c.type === 'number' ? <NumberInput size="xs" value={v ?? ''} onChange={(x) => set(i, c.key, x === '' ? undefined : Number(x))} hideControls decimalScale={8} />
                        : c.type === 'textarea' ? <Textarea size="xs" autosize minRows={1} maxRows={6} value={v ?? ''} onChange={(e) => set(i, c.key, e.currentTarget.value)} placeholder={c.placeholder} />
                        : c.type === 'list' ? <TextInput size="xs" value={Array.isArray(v) ? v.join(', ') : v ?? ''} placeholder={c.placeholder ?? 'comma separated'} onChange={(e) => set(i, c.key, e.currentTarget.value === '' ? undefined : e.currentTarget.value.split(',').map((s) => s.trim()))} />
                        : <TextInput size="xs" value={v ?? ''} placeholder={c.placeholder} error={issue ?? undefined} styles={c.type === 'formula' ? { input: { fontFamily: 'ui-monospace, monospace', fontSize: 12 } } : undefined} onChange={(e) => set(i, c.key, e.currentTarget.value)} />}
                    </Table.Td>
                  );
                })}
                {preview && <Table.Td style={{ fontSize: 12, color: '#1d5598', fontVariantNumeric: 'tabular-nums' }}>{preview(r)}</Table.Td>}
                <Table.Td>
                  <Group gap={0} wrap="nowrap">
                    <ActionIcon size="sm" variant="subtle" disabled={i === 0} onClick={() => move(i, -1)}><IconArrowUp size={14} /></ActionIcon>
                    <ActionIcon size="sm" variant="subtle" disabled={i === rows.length - 1} onClick={() => move(i, 1)}><IconArrowDown size={14} /></ActionIcon>
                    <ActionIcon size="sm" variant="subtle" color="red" onClick={() => onChange(rows.filter((_, j) => j !== i))}><IconTrash size={14} /></ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      <Group><Button size="compact-xs" variant="light" leftSection={<IconPlus size={12} />} onClick={() => onChange([...rows, { ...blank }])}>{addLabel}</Button></Group>
    </Stack>
  );
}

const Section = ({ title, help, children }: { title: string; help?: string; children: ReactNode }) => (
  <Paper withBorder p="sm" radius="md">
    <Text fw={600} size="sm">{title}</Text>
    {help && <Text size="xs" c="dimmed" mb={6}>{help}</Text>}
    {children}
  </Paper>
);

// ------------------------------------------------------------------ grid columns view model

type ColKind = 'Number input' | 'Text input' | 'Drop-down' | 'Formula' | 'Fixed value';
type ColView = { key: string; label: string; unit?: string; kind: ColKind; formula?: string; options?: string[]; decimals?: number; hidden?: boolean; width?: number };
const toView = (c: GridColumn): ColView => ({
  key: c.key, label: c.label, unit: c.unit, decimals: c.decimals, hidden: c.hidden, width: c.width, options: c.options, formula: c.formula,
  kind: c.formula ? 'Formula' : c.input ? (c.options ? 'Drop-down' : c.text ? 'Text input' : 'Number input') : 'Fixed value',
});
const fromView = (v: ColView): GridColumn => {
  const c: GridColumn = { key: v.key, label: v.label };
  if (v.unit) c.unit = v.unit;
  if (v.decimals !== undefined) c.decimals = v.decimals;
  if (v.hidden) c.hidden = true;
  if (v.width) c.width = v.width;
  if (v.kind === 'Formula') c.formula = v.formula ?? '';
  else if (v.kind !== 'Fixed value') { c.input = true; if (v.kind === 'Text input') c.text = true; if (v.kind === 'Drop-down') c.options = v.options ?? []; }
  return c;
};

// ------------------------------------------------------------------ formula help

const FN_HELP: [string, string][] = [
  ['IF(test, then, else)', 'Choose a value. Blank cells compare equal to "".'], ['IFERROR(value, fallback)', 'Fallback when the value is an error (e.g. division by zero).'],
  ['AND(a, b, …) / OR(…) / NOT(x)', 'Logic.'], ['ROUND(x, d) / ROUNDUP / ROUNDDOWN / MROUND(x, 0.5) / INT(x)', 'Rounding; MROUND rounds to a multiple.'],
  ['SUM / AVERAGE / MIN / MAX / MEDIAN / STDEV / COUNT / COUNTA', 'Statistics over values or table columns, e.g. AVERAGE(cubes.fc).'],
  ['COUNTIF(list, ">6")', 'Count items meeting a condition ("Yes", "<0", "=text").'], ['INDEX(list, n) / MATCH(value, list, 0)', 'Pick the n-th item / find its position.'],
  ['LOOKUPX(value, keys, values)', 'Exact lookup in a table, e.g. LOOKUPX(grade, st.g, st.ys).'], ['INTERP(x, xs, ys)', 'Straight-line interpolation, e.g. load at 2.5 mm penetration.'],
  ['SUMTO(list, ROW()) / MAXTO / MINTO', 'Sum / max / min of the first n rows – cumulative values.'], ['ROW()', 'Row number inside a reading table.'],
  ['SLOPE / INTERCEPT / FORECAST(x, ys, xs) / RSQ', 'Best-fit straight line, e.g. liquid limit at 25 blows.'], ['PEAKX / PEAKY(xs, ys)', 'Peak of the curve through the highest point (compaction).'],
  ['SQRT / POWER / EXP / LN / LOG10 / PI() / ABS', 'Maths.'], ['SIN / COS / TAN / ATAN / RADIANS / DEGREES', 'Trigonometry (angles in radians).'],
  ['LEFT / RIGHT / LEN / UPPER / CONCAT / FIXED(x, d) / &', 'Text; FIXED gives a number with d decimals as text.'], ['MINUTES("10:45")', 'Clock time to minutes, for setting times.'],
];

// ------------------------------------------------------------------ page

export function ObsTemplateEditor() {
  const { code } = useParams();
  const nav = useNavigate();
  const { data: list } = useApi<any[]>('/obs-templates');
  const [def, setDef] = useState<ObservationTemplate | null>(null);
  const [dirty, setDirty] = useState(false);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);

  useEffect(() => {
    const row = list?.find((t) => t.code === code);
    if (row) { const { id: _id, ...d } = row; setDef(d as ObservationTemplate); setDirty(false); }
  }, [list, code]);

  const names = useMemo(() => (def ? templateNames(def) : new Set<string>()), [def]);
  const issues = useMemo(() => (def ? validateTemplate(def) : []), [def]);
  const preview = useMemo(() => { try { return def ? evaluateObservation(def, exampleInput(def)) : null; } catch { return null; } }, [def]);
  const calc = useMemo(() => { try { return def ? renderSampleCalc(def) : []; } catch { return []; } }, [def]);
  if (!list) return <Loading />;
  if (!def) return <Alert color="red">Observation sheet {code} not found.</Alert>;

  const up = (patch: Partial<ObservationTemplate>) => { setDef({ ...def, ...patch }); setDirty(true); };
  const val = (k: string, d?: number) => (preview ? formatValue((preview.results[k] ?? preview.scalars[k]) as never, d) : '');
  const publish = async (target = def.code, body: ObservationTemplate = def) => {
    setBusy(true);
    try { const r = await api<any>(`/obs-templates/${encodeURIComponent(target)}`, { method: 'PUT', body: { ...body, code: target } }); ok(`Published ${target} v${r.version} – new tests use it; earlier tests keep their version`); setDirty(false); return r; }
    finally { setBusy(false); }
  };
  const resultNames = [...def.results.map((r) => r.key), ...def.derived.map((d) => d.key), ...def.headerFields.map((h) => h.key)];
  const gridKeys = def.grids.map((g) => g.key);
  const charts: ChartDef[] = [...(def.chart ? [def.chart] : []), ...(def.charts ?? [])];
  const setCharts = (cs: ChartDef[]) => up({ chart: cs[0], charts: cs.slice(1) });
  const lines = (a?: string[]) => (a ?? []).join('\n');
  const toLines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

  return (
    <>
      <PageHeader title={<Group gap="sm">{def.name}<Badge variant="light">{def.code} v{def.version}</Badge>{dirty && <Badge color="orange" variant="light">Unsaved changes</Badge>}</Group>}
        subtitle="Change inputs, constants, IS limits, formulas, report text and graphs. Publishing creates a new version for new tests; tests already recorded keep their version."
        actions={<>
          <Button variant="default" leftSection={<IconHelp size={16} />} onClick={() => setHelp(true)}>Formula help</Button>
          <Button variant="default" onClick={() => setDupOpen(true)}>Copy as new test</Button>
          <Button variant="default" onClick={() => nav('/settings/templates')}>Back</Button>
          <Button loading={busy} disabled={!dirty} color={issues.length ? 'orange' : undefined} onClick={async () => { if (issues.length && !window.confirm(`${issues.length} problem(s) found. Publish anyway?`)) return; await publish(); }}>Publish new version</Button>
        </>} />
      {issues.length > 0 && (
        <Alert color="orange" mb="sm" title={`${issues.length} problem(s) to fix`}>
          <Stack gap={2}>{issues.slice(0, 8).map((i, k) => <Text key={k} size="sm"><b>{i.where}:</b> {i.message}</Text>)}{issues.length > 8 && <Text size="xs">… and {issues.length - 8} more</Text>}</Stack>
        </Alert>
      )}
      <Tabs defaultValue="general" keepMounted={false}>
        <Tabs.List mb="sm">
          <Tabs.Tab value="general">General</Tabs.Tab><Tabs.Tab value="inputs">Inputs</Tabs.Tab><Tabs.Tab value="constants">Constants & IS tables</Tabs.Tab>
          <Tabs.Tab value="grids">Reading tables</Tabs.Tab><Tabs.Tab value="calc">Calculations & checks</Tabs.Tab><Tabs.Tab value="report">Report</Tabs.Tab>
          <Tabs.Tab value="charts">Graphs</Tabs.Tab><Tabs.Tab value="guide">Procedure & example</Tabs.Tab><Tabs.Tab value="json">Advanced (JSON)</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="general">
          <Section title="Test">
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              <TextInput label="Name" value={def.name} onChange={(e) => up({ name: e.currentTarget.value })} />
              <TextInput label="IS method" value={def.method} onChange={(e) => up({ method: e.currentTarget.value })} />
              <TextInput label="Material" value={def.material} onChange={(e) => up({ material: e.currentTarget.value })} />
              <Select label="Category" data={[...new Set([...TEMPLATE_CATEGORIES, def.category ?? def.material])]} value={def.category ?? null} onChange={(v) => up({ category: v ?? undefined })} />
              <TextInput label="Document no." value={def.docControl?.docNo ?? ''} onChange={(e) => up({ docControl: { issueNo: '01', issueDate: '', amendmentNo: '0', ...def.docControl, docNo: e.currentTarget.value } })} />
              <SimpleGrid cols={3}>
                <TextInput label="Issue no." value={def.docControl?.issueNo ?? ''} onChange={(e) => up({ docControl: { docNo: '', issueDate: '', amendmentNo: '0', ...def.docControl, issueNo: e.currentTarget.value } })} />
                <TextInput label="Issue date" value={def.docControl?.issueDate ?? ''} onChange={(e) => up({ docControl: { docNo: '', issueNo: '01', amendmentNo: '0', ...def.docControl, issueDate: e.currentTarget.value } })} />
                <TextInput label="Amendment" value={def.docControl?.amendmentNo ?? ''} onChange={(e) => up({ docControl: { docNo: '', issueNo: '01', issueDate: '', ...def.docControl, amendmentNo: e.currentTarget.value } })} />
              </SimpleGrid>
            </SimpleGrid>
            <Textarea mt="sm" label="Instructions shown to the tester" autosize minRows={2} value={def.instructions ?? ''} onChange={(e) => up({ instructions: e.currentTarget.value || undefined })} />
            <TextInput mt="sm" label="Name of each test on a report (formula)" description='Used when a sample has several of these tests, e.g. "Test "&test_no&" – "&location' value={def.reportLabel ?? ''} error={formulaIssue(def.reportLabel ?? '', names) ?? undefined} styles={{ input: { fontFamily: 'monospace' } }} onChange={(e) => up({ reportLabel: e.currentTarget.value || undefined })} />
          </Section>
        </Tabs.Panel>

        <Tabs.Panel value="inputs">
          <Stack>
            <Section title="Values entered once per test" help="Key is the name used in formulas (letters, numbers, _). Drop-down options are comma separated.">
              <RowsEditor rows={def.headerFields as any[]} onChange={(r) => up({ headerFields: r })} blank={{ key: '', label: '', type: 'number' }} addLabel="Add input"
                cols={[{ key: 'key', label: 'Key', width: 110 }, { key: 'label', label: 'Label' }, { key: 'type', label: 'Type', type: 'select', options: ['number', 'text', 'select', 'date', 'textarea'], width: 110 },
                  { key: 'unit', label: 'Unit', width: 80 }, { key: 'options', label: 'Drop-down options', type: 'list' }, { key: 'default', label: 'Default', width: 90 }, { key: 'required', label: 'Required', type: 'bool', width: 70 }, { key: 'help', label: 'Help text' }]} />
            </Section>
            <Section title="Equipment selected on the sheet" help="Calibration values of the selected equipment feed constants such as ring.factor (Settings → Equipment).">
              <RowsEditor rows={(def.equipment ?? []) as any[]} onChange={(r) => up({ equipment: r })} blank={{ key: '', label: '', category: 'Other' }} addLabel="Add equipment"
                cols={[{ key: 'key', label: 'Key', width: 110 }, { key: 'label', label: 'Label' }, { key: 'category', label: 'Equipment category', type: 'select', options: EQUIPMENT_CATEGORIES }]} />
            </Section>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="constants">
          <Stack>
            <Section title="Constants and limits" help="Fixed values, IS limits or values read from the equipment certificate (slot.field, e.g. ring.factor). Testers may override a constant on the sheet unless it is locked.">
              <RowsEditor rows={def.constants as any[]} onChange={(r) => up({ constants: r })} blank={{ key: '', label: '' }} addLabel="Add constant" preview={(r) => val(r.key, r.decimals)}
                cols={[{ key: 'key', label: 'Key', width: 100 }, { key: 'label', label: 'Label' }, { key: 'value', label: 'Value', type: 'number', width: 100 }, { key: 'unit', label: 'Unit', width: 80 },
                  { key: 'fromEquipment', label: 'From equipment', width: 140, placeholder: 'slot.field' }, { key: 'locked', label: 'Locked', type: 'bool', width: 60 }, { key: 'note', label: 'Note / reference' }]} />
            </Section>
            <TablesEditor tables={def.tables ?? {}} onChange={(t) => up({ tables: t })} />
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="grids">
          <Stack>
            <Accordion variant="separated" multiple defaultValue={def.grids.map((g) => g.key)}>
              {def.grids.map((g, gi) => (
                <Accordion.Item key={gi} value={g.key || String(gi)}>
                  <Accordion.Control><Text fw={600} size="sm">{g.label || g.key} <Text span c="dimmed" size="xs">({g.key})</Text></Text></Accordion.Control>
                  <Accordion.Panel>
                    <GridEditor grid={g} names={names} preview={preview?.grids[g.key]?.[0]} onChange={(ng) => up({ grids: def.grids.map((x, j) => (j === gi ? ng : x)) })} onDelete={() => up({ grids: def.grids.filter((_, j) => j !== gi) })} />
                  </Accordion.Panel>
                </Accordion.Item>
              ))}
            </Accordion>
            <Group><Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => up({ grids: [...def.grids, { key: `t${def.grids.length + 1}`, label: 'New readings', rows: 3, columns: [{ key: 'reading', label: 'Reading', input: true }] }] })}>Add reading table</Button></Group>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="calc">
          <Stack>
            <Section title="Derived values (before the reading tables)" help="Formulas using inputs and constants, e.g. plate area.">
              <RowsEditor rows={def.derived as any[]} onChange={(r) => up({ derived: r })} names={names} blank={{ key: '', label: '', formula: '' }} addLabel="Add derived value" preview={(r) => val(r.key, r.decimals)}
                cols={[{ key: 'key', label: 'Key', width: 100 }, { key: 'label', label: 'Label', width: 220 }, { key: 'formula', label: 'Formula', type: 'formula' }, { key: 'unit', label: 'Unit', width: 80 }, { key: 'decimals', label: 'Decimals', type: 'number', width: 70 }]} />
            </Section>
            <Section title="Results (after the reading tables)" help="Table columns are lists: AVERAGE(cubes.fc), MAX(ld.p), INTERP(2.5, readings.pen, readings.load).">
              <RowsEditor rows={def.results as any[]} onChange={(r) => up({ results: r })} names={names} blank={{ key: '', label: '', formula: '' }} addLabel="Add result" preview={(r) => val(r.key, r.decimals)}
                cols={[{ key: 'key', label: 'Key', width: 100 }, { key: 'label', label: 'Label', width: 220 }, { key: 'formula', label: 'Formula', type: 'formula' }, { key: 'unit', label: 'Unit', width: 80 }, { key: 'decimals', label: 'Decimals', type: 'number', width: 70 }]} />
            </Section>
            <Section title="Rule checks" help="Shown to the tester when the condition is TRUE. Errors block submission (except for the System Admin).">
              <RowsEditor rows={def.checks as any[]} onChange={(r) => up({ checks: r })} names={names} blank={{ when: '', level: 'warning', message: '' }} addLabel="Add check"
                cols={[{ key: 'when', label: 'Condition', type: 'formula' }, { key: 'level', label: 'Level', type: 'select', options: ['warning', 'error'], width: 100 }, { key: 'message', label: 'Message' }]} />
            </Section>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="report">
          <Stack>
            <Section title="Result rows on the report" help="Requirement: fixed text, or a formula such as &quot;Min &quot;&FIXED(lim,0).">
              <RowsEditor rows={def.reportRows as any[]} onChange={(r) => up({ reportRows: r })} names={names} blank={{ name: '', unit: '', result: '' }} addLabel="Add report row"
                cols={[{ key: 'group', label: 'Group', width: 140 }, { key: 'name', label: 'Name' }, { key: 'unit', label: 'Unit', width: 80 }, { key: 'result', label: 'Value', type: 'select', options: resultNames, width: 150 },
                  { key: 'decimals', label: 'Decimals', type: 'number', width: 70 }, { key: 'spec', label: 'Requirement (text)', width: 150 }, { key: 'specFormula', label: 'Requirement (formula)', type: 'formula' }]} />
            </Section>
            <Section title="Test details box" help="Label and a formula for the value, e.g. shape&amp;&quot; &quot;&amp;FIXED(bp,2)&amp;&quot; m&quot;.">
              <RowsEditor rows={(def.reportInfo ?? []) as any[]} onChange={(r) => up({ reportInfo: r })} names={names} blank={{ label: '', value: '' }} addLabel="Add detail"
                cols={[{ key: 'label', label: 'Label', width: 220 }, { key: 'value', label: 'Value (formula)', type: 'formula' }, { key: 'unit', label: 'Unit', width: 80 }, { key: 'decimals', label: 'Decimals', type: 'number', width: 70 }]} />
            </Section>
            <Section title="Scope and method (printed once per report)" help="Use {name} or {name:2} to insert values from the first test.">
              <RowsEditor rows={(def.reportIntro ?? []) as any[]} onChange={(r) => up({ reportIntro: r })} names={names} blank={{ title: '', text: '' }} addLabel="Add paragraph"
                cols={[{ key: 'title', label: 'Heading', width: 140 }, { key: 'text', label: 'Text', type: 'textarea' }, { key: 'when', label: 'Show when (formula)', type: 'formula', width: 180 }]} />
            </Section>
            <Section title="Interpretation / calculation text (printed for every test)" help="Example: Safe bearing capacity = {sbc:1} T/m², governed by {governs}.">
              <RowsEditor rows={(def.reportText ?? []) as any[]} onChange={(r) => up({ reportText: r })} names={names} blank={{ title: '', text: '' }} addLabel="Add paragraph"
                cols={[{ key: 'title', label: 'Heading', width: 140 }, { key: 'text', label: 'Text', type: 'textarea' }, { key: 'when', label: 'Show when (formula)', type: 'formula', width: 180 }]} />
            </Section>
            <Section title="Observation tables on the report" help='Columns: key=Label pairs, e.g. "load=Load (T), p=Pressure (T/m²)". Rows whose "skip if blank" column is empty are left out.'>
              <RowsEditor rows={(def.reportTables ?? []).map((t) => ({ ...t, cols: t.columns.map((c) => `${c.key}=${c.label}`).join(', ') })) as any[]}
                onChange={(r) => up({ reportTables: r.map(({ cols, ...t }: any) => ({ ...t, columns: String(cols ?? '').split(',').map((x: string) => x.trim()).filter(Boolean).map((x: string) => { const [k, ...l] = x.split('='); const col = def.grids.find((g) => g.key === t.grid)?.columns.find((c) => c.key === k.trim()); return { key: k.trim(), label: l.join('=').trim() || col?.label || k.trim(), decimals: col?.decimals }; }) })) })}
                blank={{ title: '', grid: gridKeys[0] ?? '', cols: '' }} addLabel="Add table"
                cols={[{ key: 'title', label: 'Title', width: 200 }, { key: 'grid', label: 'Reading table', type: 'select', options: gridKeys, width: 120 }, { key: 'cols', label: 'Columns (key=Label, …)' }, { key: 'skipBlank', label: 'Skip if blank', width: 100 }]} />
            </Section>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="charts">
          <Section title="Graphs" help="Each graph plots two columns of a reading table. Scales adjust to the readings unless you fix them. Extra lines: column:Legend:dashed, separated by ; (e.g. lo:Lower limit:dashed; hi:Upper limit:dashed).">
            <RowsEditor rows={charts.map((c) => ({ ...c, extra: (c.series ?? []).map((s) => [s.y, s.label, s.dashed ? 'dashed' : ''].filter(Boolean).join(':')).join('; ') })) as any[]}
              onChange={(r) => setCharts(r.map(({ extra, ...c }: any) => ({ ...c, series: String(extra ?? '').split(';').map((x: string) => x.trim()).filter(Boolean).map((x: string) => { const [y, label, d] = x.split(':'); return { y: y.trim(), label: (label ?? y).trim(), dashed: d?.trim() === 'dashed' || undefined }; }) })))}
              blank={{ grid: gridKeys[0] ?? '', x: '', y: '', title: 'New graph', xLabel: '', yLabel: '' }} addLabel="Add graph"
              cols={[{ key: 'title', label: 'Title', width: 170 }, { key: 'grid', label: 'Table', type: 'select', options: gridKeys, width: 90 }, { key: 'x', label: 'X column', width: 80 }, { key: 'y', label: 'Y column', width: 80 },
                { key: 'xLabel', label: 'X axis label', width: 140 }, { key: 'yLabel', label: 'Y axis label', width: 140 }, { key: 'xLog', label: 'X log', type: 'bool', width: 50 }, { key: 'yLog', label: 'Y log', type: 'bool', width: 50 },
                { key: 'yReverse', label: 'Y down', type: 'bool', width: 55 }, { key: 'xTop', label: 'X on top', type: 'bool', width: 60 }, { key: 'xMin', label: 'X min', type: 'number', width: 70 }, { key: 'xMax', label: 'X max', type: 'number', width: 70 },
                { key: 'yMin', label: 'Y min', type: 'number', width: 70 }, { key: 'yMax', label: 'Y max', type: 'number', width: 70 }, { key: 'extra', label: 'Extra lines', width: 180 }, { key: 'note', label: 'Explanation under the graph ({name} allowed)', type: 'textarea', width: 240 }]} />
          </Section>
        </Tabs.Panel>

        <Tabs.Panel value="guide">
          <Grid>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Stack>
                <Textarea label="Test procedure (one step per line)" autosize minRows={6} value={lines(def.procedure)} onChange={(e) => up({ procedure: toLines(e.currentTarget.value) })} />
                <Textarea label="Sample calculation (one line each; {name}, {name:2} or {table.column#row:2} insert example values)" autosize minRows={4} value={lines(def.sampleCalc)} onChange={(e) => up({ sampleCalc: toLines(e.currentTarget.value) })} />
                <Textarea label="IS references (one per line)" autosize minRows={2} value={lines(def.references)} onChange={(e) => up({ references: toLines(e.currentTarget.value) })} />
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Section title="Sample calculation as testers will see it">
                {calc.length ? <Stack gap={6}>{calc.map((c, i) => <Text key={i} size="sm">{c}</Text>)}</Stack> : <Text size="sm" c="dimmed">Add example inputs below to see it.</Text>}
              </Section>
              <Section title="Example results">
                <Table fz="xs" withRowBorders={false}><Table.Tbody>{def.results.map((r) => <Table.Tr key={r.key}><Table.Td>{r.label}</Table.Td><Table.Td fw={600}>{formatValue(preview?.results[r.key] as never, r.decimals)} {r.unit}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
                {(preview?.checks ?? []).map((c, i) => <Alert key={i} mt={4} py={4} color={c.level === 'error' ? 'red' : 'orange'}>{c.message}</Alert>)}
              </Section>
              <Textarea mt="sm" label="Example inputs and expected results (JSON) – checked automatically" autosize minRows={6} maxRows={18} styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
                defaultValue={JSON.stringify(def.example ?? { input: { header: {}, grids: {} }, expect: {} }, null, 1)} onBlur={(e) => { try { up({ example: JSON.parse(e.currentTarget.value) }); } catch { /* keep editing */ } }} />
            </Grid.Col>
          </Grid>
        </Tabs.Panel>

        <Tabs.Panel value="json">
          <JsonPanel def={def} onApply={(d) => up(d)} />
        </Tabs.Panel>
      </Tabs>

      <Drawer opened={help} onClose={() => setHelp(false)} title="Formula help" position="right" size="lg">
        <Text size="sm" mb="sm">Formulas work like Excel. Use the keys of inputs, constants and results by name; a reading-table column is <Code>table.column</Code> (a list). Inside a reading table, other columns of the same row are used by key.</Text>
        <Table fz="xs" striped><Table.Tbody>{FN_HELP.map(([f, d]) => <Table.Tr key={f}><Table.Td><Code>{f}</Code></Table.Td><Table.Td>{d}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
        <Text size="sm" fw={600} mt="md">Names available in this template</Text>
        <Text size="xs" c="dimmed" style={{ wordBreak: 'break-word' }}>{[...names].filter((n) => n !== '_row').join(', ')}</Text>
      </Drawer>
      <DuplicateModal opened={dupOpen} def={def} onClose={() => setDupOpen(false)} onCopy={async (newCode, newName) => { setDupOpen(false); await publish(newCode, { ...def, code: newCode, name: newName, version: 1 }); nav(`/settings/templates/obs/${encodeURIComponent(newCode)}`); }} />
    </>
  );
}

function GridEditor({ grid, onChange, onDelete, names, preview }: { grid: ObsGrid; onChange: (g: ObsGrid) => void; onDelete: () => void; names: Set<string>; preview?: Record<string, unknown> }) {
  const views = grid.columns.map(toView);
  const fixedCols = grid.columns.filter((c) => !c.formula);
  return (
    <Stack gap="xs">
      <SimpleGrid cols={{ base: 1, md: 4 }}>
        <TextInput size="xs" label="Key (used in formulas)" value={grid.key} onChange={(e) => onChange({ ...grid, key: e.currentTarget.value })} />
        <TextInput size="xs" label="Title on the sheet" value={grid.label} onChange={(e) => onChange({ ...grid, label: e.currentTarget.value })} />
        {grid.fixedRows ? <Text size="xs" mt={22}>{grid.fixedRows.length} pre-set rows (edit below)</Text> : <NumberInput size="xs" label="Empty rows on a new sheet" min={1} max={60} value={grid.rows ?? 5} onChange={(v) => onChange({ ...grid, rows: Number(v) || 1 })} />}
        <Group mt={20} gap="xs">
          <Button size="compact-xs" variant="default" onClick={() => onChange(grid.fixedRows ? { ...grid, fixedRows: undefined, rows: grid.fixedRows.length } : { ...grid, fixedRows: Array.from({ length: grid.rows ?? 5 }, () => ({})) })}>{grid.fixedRows ? 'Use empty rows' : 'Pre-set rows'}</Button>
          <Button size="compact-xs" variant="subtle" color="red" onClick={() => window.confirm('Delete this reading table?') && onDelete()}>Delete table</Button>
        </Group>
      </SimpleGrid>
      <RowsEditor rows={views as any[]} names={names} onChange={(r) => onChange({ ...grid, columns: (r as ColView[]).map(fromView) })} blank={{ key: '', label: '', kind: 'Number input' }} addLabel="Add column"
        preview={(r) => (preview ? formatValue(preview[r.key] as never, r.decimals) : '')}
        cols={[{ key: 'key', label: 'Key', width: 90 }, { key: 'label', label: 'Heading', width: 180 }, { key: 'unit', label: 'Unit', width: 70 },
          { key: 'kind', label: 'Type', type: 'select', options: ['Number input', 'Text input', 'Drop-down', 'Formula', 'Fixed value'], width: 130 },
          { key: 'formula', label: 'Formula (Formula type)', type: 'formula' }, { key: 'options', label: 'Options (drop-down)', type: 'list', width: 150 },
          { key: 'decimals', label: 'Dec.', type: 'number', width: 55 }, { key: 'hidden', label: 'Hide', type: 'bool', width: 45, help: 'Helper column: calculated but not shown on the sheet' }]} />
      {grid.fixedRows && (
        <Section title="Pre-set rows" help="Values that are already in each row of a new sheet (sieve sizes, dial divisions, ages). Columns that are inputs can be left blank.">
          <RowsEditor rows={grid.fixedRows as any[]} onChange={(r) => onChange({ ...grid, fixedRows: r })} blank={{}} addLabel="Add row"
            cols={fixedCols.map((c) => ({ key: c.key, label: c.label, width: 110 }))} />
        </Section>
      )}
    </Stack>
  );
}

function TablesEditor({ tables, onChange }: { tables: Record<string, Record<string, (number | string)[]>>; onChange: (t: Record<string, Record<string, (number | string)[]>>) => void }) {
  const names = Object.keys(tables);
  const conv = (v: string) => (v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : v);
  return (
    <Section title="IS tables and lookup tables" help="Each table has named columns of equal length, used as name.column in formulas, e.g. LOOKUPX(grade, st.g, st.ys). Edit values like a spreadsheet.">
      <Stack>
        {names.map((n) => {
          const cols = Object.keys(tables[n]);
          const len = Math.max(0, ...cols.map((c) => tables[n][c].length));
          const rows = Array.from({ length: len }, (_, i) => Object.fromEntries(cols.map((c) => [c, tables[n][c][i] ?? ''])));
          const setRows = (r: Record<string, any>[]) => onChange({ ...tables, [n]: Object.fromEntries(cols.map((c) => [c, r.map((x) => conv(String(x[c] ?? '')))])) });
          return (
            <Paper key={n} withBorder p="xs">
              <Group justify="space-between" mb={4}>
                <Text size="sm" fw={600}>{n}</Text>
                <Group gap="xs">
                  <Button size="compact-xs" variant="default" onClick={() => { const c = window.prompt('New column name'); if (c) onChange({ ...tables, [n]: { ...tables[n], [c]: Array(len).fill('') } }); }}>Add column</Button>
                  <Button size="compact-xs" variant="subtle" color="red" onClick={() => { if (window.confirm(`Delete table ${n}?`)) { const { [n]: _x, ...rest } = tables; onChange(rest); } }}>Delete</Button>
                </Group>
              </Group>
              <RowsEditor rows={rows} onChange={setRows} blank={Object.fromEntries(cols.map((c) => [c, '']))} addLabel="Add row" cols={cols.map((c) => ({ key: c, label: c, width: 110 }))} />
            </Paper>
          );
        })}
        <Group><Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => { const n = window.prompt('Table name (letters only, e.g. limits)'); if (n && /^[A-Za-z_]\w*$/.test(n)) onChange({ ...tables, [n]: { key: [''], value: [''] } }); }}>Add table</Button></Group>
      </Stack>
    </Section>
  );
}

function JsonPanel({ def, onApply }: { def: ObservationTemplate; onApply: (d: ObservationTemplate) => void }) {
  const [text, setText] = useState(() => JSON.stringify(def, null, 2));
  const [err, setErr] = useState('');
  useEffect(() => { setText(JSON.stringify(def, null, 2)); }, [def]);
  return (
    <Stack>
      <Text size="sm" c="dimmed">The whole definition as JSON, for bulk edits or copying between labs. Apply, then publish.</Text>
      <Textarea value={text} onChange={(e) => setText(e.currentTarget.value)} autosize minRows={20} maxRows={34} styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }} />
      {err && <Alert color="red">{err}</Alert>}
      <Group justify="flex-end"><Button variant="light" onClick={() => { try { onApply(JSON.parse(text)); setErr(''); ok('Applied – publish to save'); } catch (e) { setErr((e as Error).message); } }}>Apply JSON</Button></Group>
    </Stack>
  );
}

function DuplicateModal({ opened, def, onClose, onCopy }: { opened: boolean; def: ObservationTemplate; onClose: () => void; onCopy: (code: string, name: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  useEffect(() => { if (opened) { setCode(`${def.code}-COPY`); setName(`${def.name} (copy)`); } }, [opened, def]);
  return (
    <Modal opened={opened} onClose={onClose} title="Copy as a new test">
      <Stack>
        <TextInput label="New code" description="Capital letters, numbers and dashes; link it to a rate-card item afterwards" value={code} onChange={(e) => setCode(e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} />
        <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Group justify="flex-end"><Button disabled={code.length < 2 || code === def.code} onClick={() => onCopy(code, name)}>Create</Button></Group>
      </Stack>
    </Modal>
  );
}
