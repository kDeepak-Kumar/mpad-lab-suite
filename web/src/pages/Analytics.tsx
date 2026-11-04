import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ActionIcon, Alert, Badge, Button, Grid, Group, Menu, Modal, NumberInput, Paper, SegmentedControl, Select, SimpleGrid, Stack, Switch, Tabs, Text, TextInput, Tooltip, Loader } from '@mantine/core';
import { IconSparkles, IconTrash, IconPlus, IconDownload, IconDots, IconArrowUpRight, IconArrowDownRight, IconAlertTriangle, IconChartBar, IconChartBarPopular, IconChartLine, IconChartArea, IconChartDonut, IconChartPie, IconChartFunnel, IconTable, IconNumber } from '@tabler/icons-react';
import { useLocalStorage } from '@mantine/hooks';
import { CHART_KINDS, chartsFor, DATE_PRESETS, REPORT_OBJECTS, timeLabel, type ReportResult, type ReportSpec } from '@suite/shared';
import { api, compact, downloadCsv, ok, useApi } from '../api';
import { useCan, useMeta } from '../ctx';
import { PageHeader, Kpi } from '../components/ui';
import { ReportChart, fmtValue } from '../components/ReportChart';

const W = (title: string, spec: Omit<ReportSpec, 'title'>): ReportSpec => ({ title, ...spec });
export const DEFAULT_WIDGETS: ReportSpec[] = [
  W('Revenue trend and 3-month forecast', { object: 'invoices', measure: { agg: 'sum', field: 'total' }, groupBy: ['month'], dateRange: { preset: 'last_12_months' }, chart: 'line', forecast: 3 }),
  W('Revenue by client (this financial year)', { object: 'invoices', measure: { agg: 'sum', field: 'total' }, groupBy: ['client'], dateRange: { preset: 'this_fy' }, chart: 'hbar', limit: 10 }),
  W('Most requested tests (last 90 days)', { object: 'tests', measure: { agg: 'count' }, groupBy: ['test'], dateRange: { preset: 'last_90' }, chart: 'hbar', limit: 10 }),
  W('Samples by material (this financial year)', { object: 'samples', measure: { agg: 'count' }, groupBy: ['material'], dateRange: { preset: 'this_fy' }, chart: 'bar' }),
  W('NABL vs Non-NABL revenue (this financial year)', { object: 'invoices', measure: { agg: 'sum', field: 'total' }, groupBy: ['accreditation'], dateRange: { preset: 'this_fy' }, chart: 'donut' }),
  W('Outstanding by ageing', { object: 'outstanding', measure: { agg: 'sum', field: 'balance' }, groupBy: ['ageing'], chart: 'bar', sort: 'label' }),
  W('Revenue by test (this financial year)', { object: 'invoice_lines', measure: { agg: 'sum', field: 'amount' }, groupBy: ['test'], dateRange: { preset: 'this_fy' }, chart: 'hbar', limit: 10 }),
  W('Quotations by status (last 90 days)', { object: 'quotes', measure: { agg: 'count' }, groupBy: ['status'], dateRange: { preset: 'last_90' }, chart: 'donut' }),
];
const EXAMPLES = ['How much revenue from Sunrise Infra this year?', 'Revenue by month with forecast', 'Which tests are most requested this quarter?', 'Outstanding by client', 'NABL vs Non-NABL revenue', 'Samples by material last 30 days'];

export function AnalyticsWidget(p: { spec: ReportSpec }) { return <Widget spec={p.spec} />; }

function Widget({ spec, onRemove, onOpen, period }: { spec: ReportSpec; onRemove?: () => void; onOpen?: (s: ReportSpec) => void; period?: string }) {
  const [res, setRes] = useState<ReportResult | null>(null);
  const [err, setErr] = useState('');
  const [chartPref, setChartPref] = useLocalStorage<string | null>({ key: `chart:${spec.title ?? JSON.stringify(spec.groupBy)}`, defaultValue: null });
  const options = chartsFor(spec);
  const chart = chartPref && options.includes(chartPref as never) ? chartPref : spec.chart;
  const eff = useMemo(() => (period && !spec.forecast ? { ...spec, dateRange: { preset: period as never } } : spec), [spec, period]);
  const shownRes = res ? { ...res, spec: { ...res.spec, chart: chart as never } } : null;
  useEffect(() => { setRes(null); api<ReportResult>('/analytics/run', { body: eff, quiet: true }).then(setRes).catch((e) => setErr(e.message)); }, [JSON.stringify(eff)]);
  return (
    <Paper withBorder p="md" h="100%" className="widget">
      <Group justify="space-between" mb={6} wrap="nowrap">
        <Text fw={600} size="sm" lineClamp={1}>{spec.title ?? res?.title}</Text>
        <Group gap={2} wrap="nowrap">
        {options.length > 1 && <ChartPicker value={chart ?? options[0]} options={options} onChange={setChartPref} />}
        <Menu position="bottom-end" shadow="lg">
          <Menu.Target><ActionIcon variant="subtle" color="gray" size="sm"><IconDots size={16} /></ActionIcon></Menu.Target>
          <Menu.Dropdown>
            {onOpen && <Menu.Item onClick={() => onOpen(eff)}>Open in report builder</Menu.Item>}
            {res && <Menu.Item leftSection={<IconDownload size={14} />} onClick={() => downloadCsv(`${(spec.title ?? 'report').replace(/\W+/g, '-')}.csv`, [{ key: 'label', label: res.groupLabel ?? 'Group' }, ...(res.series2 ? [{ key: 'label2', label: res.group2Label ?? '' }] : []), { key: 'value', label: res.measureLabel }], res.rows)}>Export data</Menu.Item>}
            {onRemove && <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={onRemove}>Remove from dashboard</Menu.Item>}
          </Menu.Dropdown>
        </Menu>
        </Group>
      </Group>
      {err ? <Text size="sm" c="red">{err}</Text> : !shownRes ? <Group justify="center" h={220}><Loader size="sm" /></Group> : <ReportChart result={shownRes} height={240} />}
    </Paper>
  );
}

function Insights() {
  const { data: d } = useApi<any>('/analytics/insights');
  if (!d) return <SimpleGrid cols={{ base: 2, md: 4 }} mb="md">{Array.from({ length: 4 }).map((_, i) => <Kpi key={i} label="…" value="–" />)}</SimpleGrid>;
  const arrow = d.change === null ? null : d.change >= 0 ? <IconArrowUpRight size={14} color="#116b3b" style={{ verticalAlign: -2 }} /> : <IconArrowDownRight size={14} color="#b42318" style={{ verticalAlign: -2 }} />;
  return (
    <>
      <SimpleGrid cols={{ base: 2, md: 4, xl: 8 }} mb="md" spacing="sm">
        <Kpi label="Revenue this month" value={`₹${compact(d.thisMonth)}`} hint={<>{arrow} {d.change === null ? 'no data last month' : `${d.change}% vs last month`}</>} />
        <Kpi label="Forecast next month" value={d.forecastNext === null ? '–' : `₹${compact(d.forecastNext)}`} hint="trend of last 12 months" />
        <Kpi label="Quote pipeline" value={`₹${compact(d.pipeline.value)}`} hint={`${d.pipeline.count} sent, awaiting reply`} />
        <Kpi label="Quote conversion" value={d.conversion === null ? '–' : `${d.conversion}%`} hint="accepted of decided" />
        <Kpi label="Outstanding" value={`₹${compact(d.outstanding)}`} hint={<Text span c={d.overdue ? 'red' : 'dimmed'} size="xs">₹{compact(d.overdue)} overdue</Text>} />
        <Kpi label="Unbilled work" value={`₹${compact(d.unbilled)}`} hint="tested, not invoiced" color={d.unbilled ? '#b54708' : undefined} />
        <Kpi label="Tests due next 7 days" value={d.dueNext7} hint={d.overdueTests ? <Text span c="red" size="xs">{d.overdueTests} overdue</Text> : 'none overdue'} />
        <Kpi label="Avg turnaround" value={d.avgTat === null ? '–' : `${d.avgTat} d`} hint="received → tested, 90 days" />
      </SimpleGrid>
      {d.attention.length > 0 && (
        <Paper withBorder p="md" mb="md">
          <Text fw={600} size="sm" mb={6}>Needs attention</Text>
          <Stack gap={4}>{d.attention.map((a: any, i: number) => <Group key={i} gap="xs" wrap="nowrap"><IconAlertTriangle size={15} color={a.level === 'danger' ? '#d92d20' : '#dc6803'} /><Badge size="sm" variant="light" color={a.level === 'danger' ? 'red' : 'orange'} style={{ textTransform: 'none', minWidth: 96 }}>{a.kind}</Badge><Text size="sm">{a.text}</Text></Group>)}</Stack>
        </Paper>
      )}
    </>
  );
}

export function AskAI({ initial, onOpen, onAdd }: { initial?: string; onOpen?: (s: ReportSpec) => void; onAdd?: (s: ReportSpec) => void }) {
  const [q, setQ] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<(ReportResult & { explanation: string; source: string; aiError?: string }) | null>(null);
  const ask = async (question = q) => {
    if (question.trim().length < 3) return;
    setQ(question); setBusy(true);
    try { setRes(await api('/ai/ask', { body: { question } })); } finally { setBusy(false); }
  };
  useEffect(() => { if (initial) ask(initial); }, [initial]);
  return (
    <Paper withBorder p="md" mb="md" style={{ background: 'linear-gradient(180deg,#f5f9ff,#fff)' }}>
      <Group gap="xs" mb="xs"><IconSparkles size={18} color="#2a78d6" /><Text fw={650}>Ask about your business</Text></Group>
      <Group gap="xs" wrap="nowrap">
        <TextInput style={{ flex: 1 }} size="md" placeholder="e.g. How much revenue from DAMAC Hills this year?" value={q} onChange={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} />
        <Button size="md" loading={busy} onClick={() => ask()} leftSection={<IconSparkles size={16} />}>Ask</Button>
      </Group>
      {!res && <Group gap={6} mt="xs">{EXAMPLES.map((e) => <Badge key={e} variant="outline" color="gray" style={{ textTransform: 'none', cursor: 'pointer', fontWeight: 500 }} onClick={() => ask(e)}>{e}</Badge>)}</Group>}
      {res && (
        <Paper withBorder p="md" mt="sm">
          <Group justify="space-between" mb={4} wrap="nowrap">
            <div><Text fw={650}>{res.title}</Text><Text size="xs" c="dimmed">{res.explanation} {res.range.from !== '0000-01-01' && `Period ${res.range.from} → ${res.range.to}.`}</Text></div>
            <Group gap={6} wrap="nowrap">
              <Tooltip label={res.aiError ? `AI unavailable (${res.aiError}); used the built-in assistant` : res.source === 'builtin' ? 'Answered by the built-in assistant (works offline). Connect an AI model in Settings for free-form questions.' : `Answered with ${res.source}`}>
                <Badge variant="light" color={res.source === 'builtin' ? 'gray' : 'grape'}>{res.source === 'builtin' ? 'Built-in' : 'AI'}</Badge>
              </Tooltip>
              {onOpen && <Button size="compact-sm" variant="default" onClick={() => onOpen(res.spec)}>Edit report</Button>}
              {onAdd && <Button size="compact-sm" variant="light" leftSection={<IconPlus size={14} />} onClick={() => onAdd(res.spec)}>Add to dashboard</Button>}
            </Group>
          </Group>
          <ReportChart result={res} height={260} />
          {res.spec.groupBy?.length ? <Text size="xs" c="dimmed" mt={4}>Total {fmtValue(res, res.total)} across {res.count} record(s).</Text> : null}
        </Paper>
      )}
    </Paper>
  );
}

function Builder({ initial, onSaved, onAdd }: { initial?: ReportSpec | null; onSaved: () => void; onAdd: (s: ReportSpec) => void }) {
  const can = useCan();
  const [spec, setSpec] = useState<ReportSpec>(initial ?? { object: 'invoices', measure: { agg: 'sum', field: 'total' }, groupBy: ['month'], dateRange: { preset: 'last_12_months' }, chart: 'line' });
  const [res, setRes] = useState<ReportResult | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  useEffect(() => { if (initial) setSpec(initial); }, [initial]);
  const obj = REPORT_OBJECTS.find((o) => o.key === spec.object)!;
  const set = (p: Partial<ReportSpec>) => setSpec((s) => ({ ...s, ...p }));
  useEffect(() => { const t = setTimeout(() => api<ReportResult>('/analytics/run', { body: spec, quiet: true }).then(setRes).catch(() => setRes(null)), 250); return () => clearTimeout(t); }, [JSON.stringify(spec)]);
  const groups = obj.fields.filter((f) => f.group).map((f) => ({ value: f.key, label: f.label }));
  const measures = obj.fields.filter((f) => f.measure).map((f) => ({ value: f.key, label: f.label }));
  const filterFields = obj.fields.filter((f) => f.type !== 'date').map((f) => ({ value: f.key, label: f.label }));
  return (
    <Grid>
      <Grid.Col span={{ base: 12, lg: 4 }}>
        <Paper withBorder p="md">
          <Stack gap="sm">
            <Select label="Report on" data={REPORT_OBJECTS.map((o) => ({ value: o.key, label: o.label }))} value={spec.object} allowDeselect={false}
              onChange={(v) => { const o = REPORT_OBJECTS.find((x) => x.key === v)!; set({ object: v!, measure: { agg: 'count' }, groupBy: [], filters: [] }); void o; }} />
            <Group grow>
              <Select label="Measure" data={[{ value: 'count', label: 'Count' }, { value: 'sum', label: 'Sum' }, { value: 'avg', label: 'Average' }, { value: 'max', label: 'Max' }, { value: 'min', label: 'Min' }]} value={spec.measure.agg} allowDeselect={false}
                onChange={(v) => set({ measure: { agg: v as never, field: v === 'count' ? undefined : spec.measure.field ?? measures[0]?.value } })} />
              {spec.measure.agg !== 'count' && <Select label="of" data={measures} value={spec.measure.field ?? null} onChange={(v) => set({ measure: { ...spec.measure, field: v ?? undefined } })} />}
            </Group>
            <Group grow>
              <Select label="Group by" clearable data={groups} value={spec.groupBy?.[0] ?? null} onChange={(v) => set({ groupBy: v ? [v, ...(spec.groupBy?.slice(1) ?? [])] : [], chart: v ? (['month', 'week', 'day', 'quarter'].includes(v) ? 'line' : 'bar') : 'number' })} />
              <Select label="then by" clearable disabled={!spec.groupBy?.[0]} data={groups.filter((g) => g.value !== spec.groupBy?.[0])} value={spec.groupBy?.[1] ?? null} onChange={(v) => set({ groupBy: v ? [spec.groupBy![0], v] : spec.groupBy?.slice(0, 1) })} />
            </Group>
            <Select label="Period" data={[...DATE_PRESETS, { value: 'custom', label: 'Custom range…' }]} value={spec.dateRange?.preset ?? (spec.dateRange?.from ? 'custom' : 'all')}
              onChange={(v) => set({ dateRange: v === 'custom' ? { from: '', to: '' } : { preset: v as never } })} />
            {spec.dateRange && !spec.dateRange.preset && <Group grow><TextInput type="date" label="From" value={spec.dateRange.from ?? ''} onChange={(e) => set({ dateRange: { ...spec.dateRange, from: e.currentTarget.value } })} /><TextInput type="date" label="To" value={spec.dateRange.to ?? ''} onChange={(e) => set({ dateRange: { ...spec.dateRange, to: e.currentTarget.value } })} /></Group>}
            <Text size="sm" fw={500}>Filters</Text>
            {(spec.filters ?? []).map((f, i) => (
              <Group key={i} gap={4} wrap="nowrap">
                <Select size="xs" w={130} data={filterFields} value={f.field} onChange={(v) => set({ filters: spec.filters!.map((x, j) => (j === i ? { ...x, field: v! } : x)) })} />
                <Select size="xs" w={100} data={[{ value: 'eq', label: 'equals' }, { value: 'neq', label: 'not' }, { value: 'contains', label: 'contains' }, { value: 'gt', label: '>' }, { value: 'lt', label: '<' }]} value={f.op} onChange={(v) => set({ filters: spec.filters!.map((x, j) => (j === i ? { ...x, op: v as never } : x)) })} />
                <TextInput size="xs" style={{ flex: 1 }} value={String(f.value ?? '')} onChange={(e) => set({ filters: spec.filters!.map((x, j) => (j === i ? { ...x, value: e.currentTarget.value } : x)) })} />
                <ActionIcon variant="subtle" color="red" onClick={() => set({ filters: spec.filters!.filter((_, j) => j !== i) })}><IconTrash size={14} /></ActionIcon>
              </Group>
            ))}
            <Button size="xs" variant="light" onClick={() => set({ filters: [...(spec.filters ?? []), { field: filterFields[0].value, op: 'eq', value: '' }] })}>Add filter</Button>
            <ChartPicker value={spec.chart ?? chartsFor(spec)[0]} options={chartsFor(spec)} onChange={(v) => set({ chart: v as never })} labels />
            <Group grow>
              <NumberInput size="xs" label="Top N" min={0} value={spec.limit ?? ''} onChange={(v) => set({ limit: v === '' ? undefined : Number(v) })} />
              <NumberInput size="xs" label="Forecast periods" min={0} max={12} disabled={!['month', 'week', 'quarter'].includes(spec.groupBy?.[0] ?? '')} value={spec.forecast ?? 0} onChange={(v) => set({ forecast: Number(v) || undefined })} />
            </Group>
            <Group grow>
              <Button variant="default" onClick={() => onAdd(spec)}>Add to dashboard</Button>
              <Button onClick={() => setSaveOpen(true)}>Save report</Button>
            </Group>
          </Stack>
        </Paper>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 8 }}>
        <Paper withBorder p="md">
          <Group justify="space-between" mb="xs"><Text fw={650}>{spec.title || res?.title}</Text>
            {res && <Button size="compact-sm" variant="default" leftSection={<IconDownload size={14} />} onClick={() => downloadCsv('report.csv', [{ key: 'label', label: res.groupLabel ?? 'Group' }, ...(res.series2 ? [{ key: 'label2', label: res.group2Label ?? '' }] : []), { key: 'value', label: res.measureLabel }], res.rows.map((r) => ({ ...r, label: timeLabel(spec.groupBy?.[0] ?? '', r.label) })))}>Export</Button>}
          </Group>
          {res ? <><ReportChart result={res} height={340} /><Text size="xs" c="dimmed" mt="xs">Total {fmtValue(res, res.total)} · {res.count} record(s) · {res.range.from === '0000-01-01' ? 'all time' : `${res.range.from} → ${res.range.to}`}</Text></> : <Group justify="center" h={300}><Loader size="sm" /></Group>}
        </Paper>
      </Grid.Col>
      <SaveReport opened={saveOpen} onClose={() => setSaveOpen(false)} canShare={can('manageCustomization')} onSave={async (name, shared) => {
        await api(`/meta/report/${encodeURIComponent(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}`, { method: 'PUT', body: { ...spec, title: name, shared } });
        ok('Report saved'); setSaveOpen(false); onSaved();
      }} />
    </Grid>
  );
}

function SaveReport({ opened, onClose, onSave, canShare }: { opened: boolean; onClose: () => void; onSave: (n: string, s: boolean) => void; canShare: boolean }) {
  const [n, setN] = useState(''); const [s, setS] = useState(false);
  return <Modal opened={opened} onClose={onClose} title="Save report" size="sm"><Stack><TextInput label="Report name" value={n} onChange={(e) => setN(e.currentTarget.value)} data-autofocus />{canShare && <Switch label="Share with everyone" checked={s} onChange={(e) => setS(e.currentTarget.checked)} />}<Group justify="flex-end"><Button disabled={!n.trim()} onClick={() => onSave(n.trim(), s)}>Save</Button></Group></Stack></Modal>;
}

export function AnalyticsPage() {
  const [sp, setSp] = useSearchParams();
  const { meta, reload } = useMeta();
  const [tab, setTab] = useState<string | null>(sp.get('tab') ?? 'dashboard');
  const [period, setPeriod] = useState<string>('');
  const [builderSpec, setBuilderSpec] = useState<ReportSpec | null>(null);
  const mine = meta.dashboards.find((d) => d.key === 'main');
  const widgets: ReportSpec[] = mine?.data?.widgets ?? DEFAULT_WIDGETS;
  const saveWidgets = async (w: ReportSpec[]) => { await api('/meta/dashboard/main', { method: 'PUT', body: { name: 'My dashboard', widgets: w } }); reload(); };
  const addWidget = async (s: ReportSpec) => { await saveWidgets([...widgets, s]); ok('Added to your dashboard'); setTab('dashboard'); };
  const open = (s: ReportSpec) => { setBuilderSpec({ ...s }); setTab('builder'); };
  return (
    <>
      <PageHeader title="Analytics & AI" subtitle="Revenue, workload and trends. Ask a question in plain English or build your own report." />
      <AskAI initial={sp.get('ask') ?? undefined} onOpen={open} onAdd={addWidget} />
      <Insights />
      <Tabs value={tab} onChange={(t) => { setTab(t); setSp({}); }} keepMounted={false}>
        <Group justify="space-between" mb="sm">
          <Tabs.List><Tabs.Tab value="dashboard">Dashboard</Tabs.Tab><Tabs.Tab value="reports">Saved reports</Tabs.Tab><Tabs.Tab value="builder">Report builder</Tabs.Tab></Tabs.List>
          {tab === 'dashboard' && <Group gap="xs">
            <Select size="xs" w={190} placeholder="Each widget’s own period" clearable data={DATE_PRESETS} value={period || null} onChange={(v) => setPeriod(v ?? '')} />
            {mine && <Button size="xs" variant="subtle" color="gray" onClick={async () => { await api('/meta/dashboard/main', { method: 'DELETE' }); reload(); }}>Reset to default</Button>}
          </Group>}
        </Group>
        <Tabs.Panel value="dashboard">
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            {widgets.map((w, i) => <Widget key={i + JSON.stringify(w)} spec={w} period={period} onOpen={open} onRemove={() => saveWidgets(widgets.filter((_, j) => j !== i))} />)}
          </SimpleGrid>
        </Tabs.Panel>
        <Tabs.Panel value="reports">
          {!meta.reports.length && <Alert variant="light">No saved reports yet. Build one in the Report builder, or ask a question above and choose “Edit report”.</Alert>}
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            {meta.reports.map((r) => <Widget key={r.key} spec={r.data} onOpen={open} onRemove={async () => { await api(`/meta/report/${encodeURIComponent(r.key)}`, { method: 'DELETE' }); reload(); }} />)}
          </SimpleGrid>
        </Tabs.Panel>
        <Tabs.Panel value="builder"><Builder initial={builderSpec} onSaved={() => { reload(); setTab('reports'); }} onAdd={addWidget} /></Tabs.Panel>
      </Tabs>
    </>
  );
}

const CHART_ICON: Record<string, React.ComponentType<{ size?: number | string }>> = { bar: IconChartBar, hbar: IconChartBarPopular, line: IconChartLine, area: IconChartArea, donut: IconChartDonut, pie: IconChartPie, funnel: IconChartFunnel, table: IconTable, number: IconNumber };
/** Switch how a report is drawn; only the chart types that suit its grouping are offered. */
function ChartPicker({ value, options, onChange, labels }: { value: string; options: string[]; onChange: (v: string) => void; labels?: boolean }) {
  return (
    <SegmentedControl size="xs" className={labels ? undefined : 'chart-pick'} value={options.includes(value) ? value : options[0]} onChange={onChange}
      data={options.map((o) => { const Ic = CHART_ICON[o]; const label = CHART_KINDS.find((k) => k.value === o)?.label ?? o;
        return { value: o, label: labels ? <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Ic size={14} />{label}</span> : <Tooltip label={label}><span style={{ display: 'flex' }}><Ic size={14} /></span></Tooltip> }; })} />
  );
}
