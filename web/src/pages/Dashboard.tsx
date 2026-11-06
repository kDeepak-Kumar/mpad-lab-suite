import { useNavigate } from 'react-router-dom';
import { type ComponentType, type ReactNode } from 'react';
import { Badge, Button, Grid, Group, Menu, Paper, SimpleGrid, Skeleton, Stack, Text, ThemeIcon, Tooltip, UnstyledButton } from '@mantine/core';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import {
  IconAlertTriangle, IconArrowDownRight, IconArrowUpRight, IconBell, IconCash, IconChevronRight, IconClipboardList, IconFileInvoice, IconFlask2, IconInfoCircle,
  IconPlus, IconReceipt2, IconSparkles, IconTestPipe, IconUsers, IconWallet, IconCertificate, IconChecklist, IconFileDollar,
} from '@tabler/icons-react';
import { useApi, money, compact } from '../api';
import { useMe, useCan, hasTab } from '../ctx';
import { Loading } from '../components/ui';
import { AskAI } from './Analytics';

// Fixed, validated chart colours (categorical order never changes; brand colours stay for the interface).
export const S1 = '#2a78d6', S2 = '#eb6834';
const UP = '#067647', DOWN = '#b42318';
const MONTH = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short' });
const rupees = (n: number) => `₹${money(n)}`;
const pct = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 1000) / 10 : now ? null : 0);

interface Insights {
  months: string[];
  money?: { invoiced: number[]; collected: number[]; invoicedThis: number; invoicedLast: number; collectedThis: number; collectedLast: number; outstanding: number; overdue: number; aging: { label: string; amount: number }[]; topClients: { name: string; total: number; share: number }[] };
  lab?: { samplesThis: number; samplesLast: number; samplesByMonth: number[]; intake: { day: string; count: number }[]; testsByStatus: Record<string, number>; materials: { name: string; count: number }[]; testsThis: number; testsLast: number };
}

export function Dashboard() {
  const me = useMe();
  const can = useCan();
  const nav = useNavigate();
  const { data } = useApi<any>('/dashboard');
  const { data: ins } = useApi<Insights>('/dashboard/insights');
  if (!data) return <Loading />;
  const c = data.counts;
  const hour = new Date().getHours();
  const create = [
    { label: 'Quotation', to: '/quotes/new', icon: IconFileDollar, show: can('quote.create') },
    { label: 'Register sample', to: '/samples?new=1', icon: IconTestPipe, show: can('sample.create') },
    { label: 'Client', to: '/clients?new=1', icon: IconUsers, show: can('client.create') },
    { label: 'Invoice', to: '/invoices/new', icon: IconFileInvoice, show: can('invoice.create') },
    { label: 'Record payment', to: '/payments?new=1', icon: IconWallet, show: can('recordPayments') },
  ].filter((q) => q.show);
  const queue = [
    { label: me.user.role === 'technician' ? 'My tests to do' : 'Tests to do', value: me.user.role === 'technician' ? c.myTests : c.testsToDo, to: me.user.role === 'technician' ? '/tests?tab=mine' : '/tests', icon: IconFlask2, show: can('enterObservations') },
    { label: 'Observations to review', value: c.toReview, to: '/tests?tab=review', icon: IconChecklist, show: can('reviewTests'), alert: c.toReview > 0 },
    { label: 'Ready for report', value: c.toReport, to: '/reports/prepare', icon: IconClipboardList, show: can('prepareReports') },
    { label: 'Reports to verify / sign', value: c.reportsToVerify + c.reportsToIssue, to: '/reports', icon: IconCertificate, show: can('signReports'), alert: c.reportsToVerify + c.reportsToIssue > 0 },
    { label: 'Quotes awaiting reply', value: c.quotesAwaiting, to: '/quotes', icon: IconFileDollar, show: hasTab(me, 'quotes') },
  ].filter((q) => q.show);
  const m = ins?.money, lab = ins?.lab;
  const months = ins?.months ?? [];

  return (
    <Stack gap="md">
      <div className="dash-hero">
        <div>
          <Text className="dash-eyebrow">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Text>
          <Text className="dash-title">Good {hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, {me.user.name.split(' ')[0]}</Text>
          <Text size="sm" c="dimmed">{data.unread ? `${data.unread} new reminder${data.unread === 1 ? '' : 's'} · ` : ''}{queue.filter((q) => q.value).length ? (() => { const n = queue.reduce((a, q) => a + Number(q.value || 0), 0); return `${n} item${n === 1 ? '' : 's'} waiting in your queue`; })() : 'Your queue is clear'}</Text>
        </div>
        <Group gap="xs">
          {can('viewAnalytics') && <Button variant="default" leftSection={<IconSparkles size={16} />} onClick={() => nav('/analytics')}>Ask AI</Button>}
          {create.length > 0 && (
            <Menu shadow="lg" position="bottom-end" width={220}>
              <Menu.Target><Button leftSection={<IconPlus size={16} />}>Create</Button></Menu.Target>
              <Menu.Dropdown>{create.map((q) => <Menu.Item key={q.to} leftSection={<q.icon size={16} />} onClick={() => nav(q.to)}>{q.label}</Menu.Item>)}</Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </div>

      {(m || lab) && (
        <SimpleGrid cols={{ base: 1, xs: 2, lg: m ? 4 : 2 }} spacing="md" maw={m ? undefined : 760}>
          {m && <Stat icon={IconReceipt2} label="Invoiced this month" value={rupees(m.invoicedThis)} now={m.invoicedThis} before={m.invoicedLast} spark={m.invoiced} onClick={() => nav('/invoices')} />}
          {m && <Stat icon={IconCash} label="Collected this month" value={rupees(m.collectedThis)} now={m.collectedThis} before={m.collectedLast} spark={m.collected} onClick={() => nav('/payments')} />}
          {lab && <Stat icon={IconTestPipe} label="Samples received" value={String(lab.samplesThis)} now={lab.samplesThis} before={lab.samplesLast} spark={lab.samplesByMonth} onClick={() => nav('/samples')} />}
          {m && <Stat icon={IconWallet} label="Outstanding" value={rupees(m.outstanding)} sub={m.overdue ? <Text size="xs" c={DOWN} fw={600}><IconAlertTriangle size={12} style={{ verticalAlign: -1 }} /> {rupees(m.overdue)} over 30 days</Text> : <Text size="xs" c="dimmed">Nothing overdue</Text>} onClick={() => nav('/ledger')} />}
          {!m && lab && <Stat icon={IconFlask2} label="Tests registered this month" value={String(lab.testsThis)} now={lab.testsThis} before={lab.testsLast} onClick={() => nav('/tests')} />}
        </SimpleGrid>
      )}
      {!ins && <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={118} radius="lg" />)}</SimpleGrid>}

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          {m ? (
            <Card title="Invoiced vs collected" sub="Last 12 months" action={<Button size="compact-sm" variant="subtle" rightSection={<IconChevronRight size={14} />} onClick={() => nav('/analytics')}>Analytics</Button>}>
              <div style={{ height: 270 }}>
                <ResponsiveContainer>
                  <LineChart data={months.map((mm, i) => ({ m: MONTH(mm), Invoiced: m.invoiced[i], Collected: m.collected[i] }))} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#eef0f3" />
                    <XAxis dataKey="m" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#667085' }} />
                    <YAxis tickLine={false} axisLine={false} width={56} tick={{ fontSize: 12, fill: '#667085' }} tickFormatter={(v) => `₹${compact(v)}`} />
                    <RTooltip formatter={(v: number) => rupees(v)} contentStyle={{ borderRadius: 10, border: '1px solid #e4e8ee', fontSize: 13 }} cursor={{ stroke: '#d0d5dd' }} />
                    <Legend iconType="plainline" wrapperStyle={{ fontSize: 13, color: '#344054' }} />
                    <Line type="linear" dataKey="Invoiced" stroke={S1} strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} />
                    <Line type="linear" dataKey="Collected" stroke={S2} strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : lab ? <IntakeCard lab={lab} /> : null}
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Card title="Your queue" sub="Work waiting for you">
            <Stack gap={4}>
              {queue.map((q) => (
                <UnstyledButton key={q.label} className="dash-queue" onClick={() => nav(q.to)}>
                  <ThemeIcon variant="light" radius="md" size={34} color={q.alert ? 'orange' : 'brand'}><q.icon size={18} /></ThemeIcon>
                  <Text size="sm" fw={550} style={{ flex: 1 }}>{q.label}</Text>
                  <Text fw={700} fz={18} style={{ fontVariantNumeric: 'tabular-nums' }}>{q.value}</Text>
                  <IconChevronRight size={16} color="#98a2b3" />
                </UnstyledButton>
              ))}
              {!queue.length && <Text size="sm" c="dimmed">Nothing assigned to your role.</Text>}
            </Stack>
          </Card>
        </Grid.Col>

        {m && lab && <Grid.Col span={{ base: 12, lg: 8 }}><IntakeCard lab={lab} /></Grid.Col>}
        {lab && <Grid.Col span={{ base: 12, lg: 4 }}>
          <Card title="Tests by stage" sub="All open and finished tests">
            <BarList rows={STAGES.filter((s) => lab.testsByStatus[s.key]).map((s) => ({ label: s.label, value: lab.testsByStatus[s.key], onClick: () => nav(s.to) }))} empty="No tests yet" />
          </Card>
        </Grid.Col>}

        {m && <Grid.Col span={{ base: 12, md: 6, lg: 4 }}>
          <Card title="Top clients" sub="Invoiced, last 12 months">
            <BarList rows={m.topClients.map((t) => ({ label: t.name, value: t.total, display: `${rupees(t.total)} · ${t.share}%` }))} empty="No invoices yet" />
          </Card>
        </Grid.Col>}
        {m && <Grid.Col span={{ base: 12, md: 6, lg: 4 }}>
          <Card title="Receivables by age" sub="Unpaid invoice balance" action={<Button size="compact-sm" variant="subtle" onClick={() => nav('/ledger')}>Ledgers</Button>}>
            <BarList rows={m.aging.map((a) => ({ label: `${a.label}`, value: a.amount, display: rupees(a.amount), warn: a.label !== '0–30 days' && a.amount > 0 }))} empty="Nothing outstanding" />
          </Card>
        </Grid.Col>}
        <Grid.Col span={{ base: 12, lg: m ? 4 : lab ? 8 : 12 }}>
          <Reminders data={data} />
        </Grid.Col>
        {can('viewAnalytics') && <Grid.Col span={12}><AskAI onOpen={() => nav('/analytics?tab=builder')} /></Grid.Col>}
      </Grid>
    </Stack>
  );
}

const STAGES = [
  { key: 'pending', label: 'Not started', to: '/tests' }, { key: 'in_progress', label: 'In progress', to: '/tests' }, { key: 'returned', label: 'Returned for correction', to: '/tests' },
  { key: 'submitted', label: 'Awaiting review', to: '/tests?tab=review' }, { key: 'accepted', label: 'Accepted', to: '/reports/prepare' }, { key: 'reported', label: 'Reported', to: '/reports' },
];

export function Card({ title, sub, action, children }: { title: string; sub?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Paper withBorder radius="lg" p="md" h="100%" className="dash-card">
      <Group justify="space-between" mb="sm" wrap="nowrap" align="flex-start">
        <div><Text fw={650}>{title}</Text>{sub && <Text size="xs" c="dimmed">{sub}</Text>}</div>{action}
      </Group>
      {children}
    </Paper>
  );
}

export function Stat({ icon: Icon, label, value, now, before, spark, sub, onClick, vs = 'vs last month' }: { icon: ComponentType<{ size?: number | string }>; label: string; value: string; now?: number; before?: number; spark?: number[]; sub?: ReactNode; onClick?: () => void; vs?: string }) {
  const p = now !== undefined && before !== undefined ? pct(now, before) : undefined;
  return (
    <UnstyledButton className="dash-stat" onClick={onClick}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <div className="dash-stat-ic"><Icon size={20} /></div>
        {spark && spark.some(Boolean) && <Spark values={spark} />}
      </Group>
      <Text size="sm" c="dimmed" mt="sm" fw={550}>{label}</Text>
      <Text className="dash-stat-value">{value}</Text>
      {sub ?? (p === undefined ? null : p === null ? <Text size="xs" c="dimmed">Nothing to compare yet</Text> : (
        <Group gap={4}>
          <Badge size="sm" variant="light" color={p >= 0 ? 'green' : 'red'} leftSection={p >= 0 ? <IconArrowUpRight size={12} /> : <IconArrowDownRight size={12} />} style={{ textTransform: 'none' }}>{Math.abs(p)}%</Badge>
          <Text size="xs" c="dimmed">{vs}</Text>
        </Group>
      ))}
    </UnstyledButton>
  );
}

/** Tiny trend line for a stat tile (no axes; the tile names it). */
function Spark({ values }: { values: number[] }) {
  const w = 84, h = 30, max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (w - 4) + 2},${h - 3 - (v / max) * (h - 6)}`).join(' ');
  const last = pts.split(' ').pop()!.split(',');
  return <svg width={w} height={h} aria-hidden><polyline points={pts} fill="none" stroke={S1} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /><circle cx={last[0]} cy={last[1]} r={3} fill={S1} stroke="#fff" strokeWidth={1.5} /></svg>;
}

export function BarList({ rows, empty }: { rows: { label: string; value: number; display?: string; warn?: boolean; onClick?: () => void }[]; empty: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (!rows.some((r) => r.value)) return <Text size="sm" c="dimmed">{empty}</Text>;
  return (
    <Stack gap={10}>
      {rows.map((r) => (
        <Tooltip key={r.label} label={`${r.label}: ${r.display ?? r.value}`} position="top-start">
          <UnstyledButton onClick={r.onClick} style={{ cursor: r.onClick ? 'pointer' : 'default' }}>
            <Group justify="space-between" gap="xs" wrap="nowrap" mb={4}>
              <Text size="sm" truncate style={{ minWidth: 0 }}>{r.label}</Text>
              <Text size="sm" fw={600} style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }} c={r.warn ? DOWN : undefined}>{r.display ?? r.value}</Text>
            </Group>
            <div className="dash-bar"><span style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: S1 }} /></div>
          </UnstyledButton>
        </Tooltip>
      ))}
    </Stack>
  );
}

function IntakeCard({ lab }: { lab: NonNullable<Insights['lab']> }) {
  return (
    <Card title="Samples received" sub="Last 14 days">
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, sm: 8 }}>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={lab.intake.map((d) => ({ d: new Date(d.day + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), Samples: d.count }))} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#eef0f3" />
                <XAxis dataKey="d" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#667085' }} interval={1} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#667085' }} />
                <RTooltip cursor={{ fill: '#f2f4f7' }} contentStyle={{ borderRadius: 10, border: '1px solid #e4e8ee', fontSize: 13 }} />
                <Bar dataKey="Samples" fill={S1} radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <Text size="xs" c="dimmed" fw={600} mb={8}>BY MATERIAL · 90 DAYS</Text>
          <BarList rows={lab.materials.map((x) => ({ label: x.name, value: x.count }))} empty="No samples yet" />
        </Grid.Col>
      </Grid>
    </Card>
  );
}

function Reminders({ data }: { data: any }) {
  const nav = useNavigate();
  return (
    <Card title="Reminders" sub="Due tests, calibrations, follow-ups and payments" action={<Badge variant="light">{data.unread ?? data.reminders.length} new</Badge>}>
      <Stack gap={2} mah={360} style={{ overflow: 'auto' }}>
        {data.reminders.length === 0 && <Group gap={6}><IconBell size={16} color="#98a2b3" /><Text size="sm" c="dimmed">All clear. Nothing overdue.</Text></Group>}
        {data.reminders.map((r: any, i: number) => (
          <UnstyledButton key={i} className="dash-rem" onClick={() => nav(r.link)}>
            {r.level === 'info' ? <IconInfoCircle size={18} color="#2a78d6" /> : <IconAlertTriangle size={18} color={r.level === 'danger' ? '#d92d20' : '#dc6803'} />}
            <div style={{ minWidth: 0, flex: 1 }}>
              <Text size="xs" fw={650} c={r.level === 'danger' ? 'red.7' : r.level === 'warning' ? 'orange.8' : 'blue.7'}>{r.kind}</Text>
              <Text size="sm" lineClamp={2}>{r.text}</Text>
            </div>
          </UnstyledButton>
        ))}
      </Stack>
    </Card>
  );
}
