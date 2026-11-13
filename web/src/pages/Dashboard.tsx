import { useNavigate } from 'react-router-dom';
import { type ComponentType, type ReactNode } from 'react';
import { Button, Grid, Group, Menu, Skeleton, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import {
  IconArrowDownRight, IconArrowUpRight, IconBell, IconChevronDown, IconChevronRight, IconClipboardList, IconFileInvoice, IconFlask2,
  IconPlus, IconTestPipe, IconUsers, IconWallet, IconCertificate, IconChecklist, IconFileDollar,
} from '@tabler/icons-react';
import { useApi, money, compact } from '../api';
import { useMe, useCan, hasTab } from '../ctx';
import { Empty, Loading } from '../components/ui';
import { AskAI } from './Analytics';

// Chart colours: charcoal for the main series, the accent for the one compared against it (they differ in lightness too).
export const S1 = '#292524', S2 = '#c2410c';
const UP = '#15803d', DOWN = '#b91c1c';
const GRID = '#efede8', AXIS = '#6b655e';
const MONTH = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short' });
const rupees = (n: number) => `₹${money(n)}`;
const pct = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 1000) / 10 : now ? null : 0);
const tipStyle = { borderRadius: 12, border: '1px solid #e7e3db', fontSize: 12.5, boxShadow: '0 16px 40px rgba(28,25,23,.14)', padding: '8px 12px' };

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

  const waiting = queue.reduce((a, q) => a + Number(q.value || 0), 0);
  const all = lab ? STAGES.map((st) => ({ ...st, n: lab.testsByStatus[st.key] ?? 0 })) : [];
  const stages = all.filter((st) => st.n);
  const open = stages.filter((st) => !['accepted', 'reported'].includes(st.key)).reduce((a, st) => a + st.n, 0);

  return (
    <div className="dash">
      <header className="dash-hero">
        <div style={{ minWidth: 0 }}>
          <div className="dash-eyebrow">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1 className="dash-title">Good {hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, {me.user.name.split(' ')[0]}</h1>
          <div className="dash-sub">{waiting ? <>{waiting} {waiting === 1 ? 'item is' : 'items are'} waiting in your queue</> : 'Your queue is clear'}{data.unread ? ` · ${data.unread} new reminder${data.unread === 1 ? '' : 's'}` : ''}</div>
        </div>
        {create.length > 0 && (
          <Menu position="bottom-end" width={220}>
            <Menu.Target><Button leftSection={<IconPlus size={16} />} rightSection={<IconChevronDown size={14} />}>New</Button></Menu.Target>
            <Menu.Dropdown>{create.map((q) => <Menu.Item key={q.to} leftSection={<q.icon size={16} />} onClick={() => nav(q.to)}>{q.label}</Menu.Item>)}</Menu.Dropdown>
          </Menu>
        )}
      </header>

      <Grid gutter="md">
        {(m || lab) && <Grid.Col span={12} order={{ base: 2, lg: 0 }}>
        <div className="dash-kpis" style={{ ['--n' as any]: m ? 4 : 2 }}>
          {m && <Stat label="Invoiced this month" value={rupees(m.invoicedThis)} now={m.invoicedThis} before={m.invoicedLast} spark={m.invoiced} onClick={() => nav('/invoices')} />}
          {m && <Stat label="Collected this month" value={rupees(m.collectedThis)} now={m.collectedThis} before={m.collectedLast} spark={m.collected} sub={m.invoicedThis ? <span>{Math.round((100 * m.collectedThis) / m.invoicedThis)}% of this month’s invoicing</span> : undefined} onClick={() => nav('/payments')} />}
          {lab && <Stat label="Samples received" value={String(lab.samplesThis)} now={lab.samplesThis} before={lab.samplesLast} spark={lab.samplesByMonth} onClick={() => nav('/samples')} />}
          {m && <Stat label="Outstanding" value={rupees(m.outstanding)} tone={m.overdue ? 'bad' : undefined} sub={m.overdue ? <span className="dn">{rupees(m.overdue)} over 30 days</span> : <span>Nothing overdue</span>} onClick={() => nav('/ledger')} />}
          {!m && lab && <Stat label="Tests registered this month" value={String(lab.testsThis)} now={lab.testsThis} before={lab.testsLast} onClick={() => nav('/tests')} />}
        </div>
        </Grid.Col>}
        {!ins && <Grid.Col span={12} order={{ base: 2, lg: 0 }}> <div className="dash-kpis" style={{ ['--n' as any]: 4 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={112} radius={16} />)}</div></Grid.Col>}

        {lab && (
          <Grid.Col span={{ base: 12, lg: 8 }} order={{ base: 3, lg: 1 }}>
            <Card title="Lab pipeline" sub={open ? `${open} ${open === 1 ? 'test' : 'tests'} in progress across all samples` : 'No tests in progress'} action={<Button size="compact-sm" variant="subtle" color="gray" rightSection={<IconChevronRight size={14} />} onClick={() => nav('/tests')}>Tests</Button>}>
              {stages.length ? <>
                <div className="pipe-bar" role="img" aria-label={stages.map((st) => `${st.label} ${st.n}`).join(', ')}>{stages.map((st) => <Tooltip key={st.key} label={`${st.label}: ${st.n}`}><span style={{ flex: st.n, background: st.color }} /></Tooltip>)}</div>
                <div className="pipe-tiles">
                  {all.map((st) => (
                    <UnstyledButton key={st.key} className={`pipe-tile${st.n ? '' : ' zero'}`} onClick={() => nav(st.to)}>
                      <span className="pipe-l"><i style={{ background: st.color }} />{st.label}</span>
                      <span className="pipe-v">{st.n}</span>
                    </UnstyledButton>
                  ))}
                </div>
              </> : <Empty title="No tests yet">Register a sample to start the first test.</Empty>}
            </Card>
          </Grid.Col>
        )}
        <Grid.Col span={{ base: 12, lg: lab ? 4 : 12 }} order={{ base: 1, lg: 2 }}>
          <Card title="Your queue" sub="Work waiting for your role" count={waiting || undefined}>
            <div className="queue">
              {queue.map((q) => (
                <UnstyledButton key={q.label} className={`queue-row${q.value ? '' : ' zero'}`} onClick={() => nav(q.to)}>
                  <span className="queue-ic"><q.icon size={16} stroke={1.75} /></span>
                  <span className="queue-t">{q.label}</span>
                  {q.value ? <span className={`pill ${q.alert ? 'p-acc' : 'p-neu'}`}>{q.value}</span> : <span className="queue-zero">None</span>}
                  <IconChevronRight size={15} className="queue-chev" />
                </UnstyledButton>
              ))}
              {!queue.length && <Text size="sm" c="dimmed">Nothing is assigned to your role.</Text>}
            </div>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 8 }} order={3}>
          {m ? (
            <Card title="Invoiced vs collected" sub="Last 12 months" action={<Button size="compact-sm" variant="subtle" color="gray" rightSection={<IconChevronRight size={14} />} onClick={() => nav('/analytics')}>Analytics</Button>}>
              <div className="dash-legend"><span><i style={{ background: S2 }} />Invoiced</span><span><i style={{ background: S1 }} />Collected</span></div>
              <div style={{ height: 250 }}>
                <ResponsiveContainer>
                  <LineChart data={months.map((mm, i) => ({ m: MONTH(mm), Invoiced: m.invoiced[i], Collected: m.collected[i] }))} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="m" tickLine={false} axisLine={false} tick={{ fontSize: 11.5, fill: AXIS }} interval="preserveStartEnd" minTickGap={8} padding={{ left: 8, right: 8 }} />
                    <YAxis tickLine={false} axisLine={false} width={60} tick={{ fontSize: 11.5, fill: AXIS }} tickFormatter={(v) => `₹${compact(v)}`} />
                    <RTooltip formatter={(v: number) => rupees(v)} contentStyle={tipStyle} cursor={{ stroke: '#d8d3c9', strokeDasharray: '3 3' }} />
                    <Line type="monotone" dataKey="Invoiced" stroke={S2} strokeWidth={2} dot={false} activeDot={{ r: 4.5, strokeWidth: 2, stroke: '#fff' }} />
                    <Line type="monotone" dataKey="Collected" stroke={S1} strokeWidth={2} dot={false} activeDot={{ r: 4.5, strokeWidth: 2, stroke: '#fff' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : lab ? <IntakeCard lab={lab} /> : null}
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }} order={4}><Reminders data={data} /></Grid.Col>

        {m && lab && <Grid.Col span={{ base: 12, lg: 6 }} order={5}><IntakeCard lab={lab} /></Grid.Col>}
        {m && <Grid.Col span={{ base: 12, md: 6, lg: 3 }} order={6}>
          <Card title="Top clients" sub="Invoiced, last 12 months">
            <BarList rows={m.topClients.map((t) => ({ label: t.name, value: t.total, display: `${rupees(t.total)} · ${t.share}%` }))} empty="No invoices yet" />
          </Card>
        </Grid.Col>}
        {m && <Grid.Col span={{ base: 12, md: 6, lg: 3 }} order={7}>
          <Card title="Receivables by age" sub="Unpaid invoice balance" action={<Button size="compact-sm" variant="subtle" color="gray" onClick={() => nav('/ledger')}>Ledgers</Button>}>
            <BarList rows={m.aging.map((a) => ({ label: `${a.label}`, value: a.amount, display: rupees(a.amount), warn: a.label !== '0–30 days' && a.amount > 0 }))} empty="Nothing outstanding" />
          </Card>
        </Grid.Col>}
        {can('viewAnalytics') && <Grid.Col span={12} order={8}><AskAI onOpen={() => nav('/analytics?tab=builder')} /></Grid.Col>}
      </Grid>
    </div>
  );
}

/** Test stages in workflow order; colours differ in lightness as well as hue. */
const STAGES = [
  { key: 'pending', label: 'Not started', to: '/tests', color: '#d8d3c9' }, { key: 'in_progress', label: 'In progress', to: '/tests', color: '#1d4ed8' },
  { key: 'returned', label: 'Returned', to: '/tests', color: '#b91c1c' }, { key: 'submitted', label: 'To review', to: '/tests?tab=review', color: '#a16207' },
  { key: 'accepted', label: 'Ready for report', to: '/reports/prepare', color: '#c2410c' }, { key: 'reported', label: 'Reported', to: '/reports', color: '#15803d' },
];

export function Card({ title, sub, action, children, count }: { title: string; sub?: string; action?: ReactNode; children: ReactNode; count?: number }) {
  return (
    <section className="card dash-card">
      <header className="dash-card-h">
        <div style={{ minWidth: 0 }}><h3>{title}{count ? <span className="cnt acc" style={{ marginLeft: 8, verticalAlign: 2 }}>{count}</span> : null}</h3>{sub && <div className="dash-card-sub">{sub}</div>}</div>{action}
      </header>
      {children}
    </section>
  );
}

/** A figure card. `icon` is accepted for older callers and not drawn: the label names the figure. */
export function Stat({ label, value, now, before, spark, sub, onClick, vs = 'vs last month', tone }: { icon?: ComponentType<any>; label: string; value: string; now?: number; before?: number; spark?: number[]; sub?: ReactNode; onClick?: () => void; vs?: string; tone?: 'bad' }) {
  const p = now !== undefined && before !== undefined ? pct(now, before) : undefined;
  return (
    <UnstyledButton className="kpi clickable dash-stat" onClick={onClick}>
      <div className="dash-stat-top"><span className="kpi-label">{label}</span>{spark && spark.some(Boolean) && <Spark values={spark} />}</div>
      <div className="kpi-value" style={tone === 'bad' ? { color: DOWN } : undefined}>{value}</div>
      <div className="dash-stat-d">
        {p !== undefined && p !== null && <span className={p >= 0 ? 'up' : 'dn'} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>{p >= 0 ? <IconArrowUpRight size={13} /> : <IconArrowDownRight size={13} />}{Math.abs(p)}%</span>}
        {sub ?? (p === undefined ? null : p === null ? <span>First month with figures</span> : <span>{vs}</span>)}
      </div>
    </UnstyledButton>
  );
}

/** Tiny trend line for a figure card (no axes; the card names it). */
function Spark({ values }: { values: number[] }) {
  const w = 72, h = 26, max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (w - 4) + 2},${h - 3 - (v / max) * (h - 6)}`).join(' ');
  const last = pts.split(' ').pop()!.split(',');
  return <svg width={w} height={h} aria-hidden style={{ flex: 'none' }}><polyline points={pts} fill="none" stroke="#a8a29a" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" /><circle cx={last[0]} cy={last[1]} r={2.6} fill="#1c1917" /></svg>;
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
            <div className="bar" style={{ width: '100%' }}><span className={r.warn ? 'warn' : ''} style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></div>
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
              <BarChart data={lab.intake.map((d) => ({ d: new Date(d.day + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), Samples: d.count }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="d" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: AXIS }} interval="preserveStartEnd" minTickGap={14} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} tick={{ fontSize: 11.5, fill: AXIS }} />
                <RTooltip cursor={{ fill: '#f3f1ec' }} contentStyle={tipStyle} />
                <Bar dataKey="Samples" fill={S1} radius={[4, 4, 0, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <div className="dash-mini-h">By material · 90 days</div>
          <BarList rows={lab.materials.map((x) => ({ label: x.name, value: x.count }))} empty="No samples yet" />
        </Grid.Col>
      </Grid>
    </Card>
  );
}

function Reminders({ data }: { data: any }) {
  const nav = useNavigate();
  const tone = (l: string) => (l === 'danger' ? 'bad' : l === 'warning' ? 'warn' : 'info');
  return (
    <Card title="Needs attention" sub="Due tests, calibrations, follow-ups and payments" count={data.reminders.length || undefined}>
      <div className="rem-list">
        {data.reminders.length === 0 && <Empty icon={<IconBell size={20} stroke={1.6} />} title="All clear">Nothing is overdue.</Empty>}
        {data.reminders.map((r: any, i: number) => (
          <UnstyledButton key={i} className="rem" onClick={() => nav(r.link)}>
            <span className={`rem-dot ${tone(r.level)}`} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className={`rem-k ${tone(r.level)}`}>{r.kind}</div>
              <Text size="sm" lineClamp={2}>{r.text}</Text>
            </div>
            <IconChevronRight size={15} className="queue-chev" />
          </UnstyledButton>
        ))}
      </div>
    </Card>
  );
}
