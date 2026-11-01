import { useNavigate } from 'react-router-dom';
import { Button, Group, Paper, SimpleGrid, Stack, Text, Badge, ThemeIcon, Grid } from '@mantine/core';
import { IconAlertTriangle, IconBell, IconInfoCircle, IconPlus } from '@tabler/icons-react';
import { useApi, money } from '../api';
import { useMe, useCan, hasTab } from '../ctx';
import { PageHeader, Kpi, Loading } from '../components/ui';
import { AskAI, AnalyticsWidget } from './Analytics';

export function Dashboard() {
  const me = useMe();
  const can = useCan();
  const nav = useNavigate();
  const { data } = useApi<any>('/dashboard');
  if (!data) return <Loading />;
  const c = data.counts;
  const hour = new Date().getHours();
  const tiles: { label: string; value: string | number; to: string; hint?: string; color?: string; show: boolean }[] = [
    { label: me.user.role === 'technician' ? 'My tests to do' : 'Tests to do', value: me.user.role === 'technician' ? c.myTests : c.testsToDo, to: '/tests', hint: 'pending, in progress or returned', show: can('enterObservations') },
    { label: 'Observations to review', value: c.toReview, to: '/tests?tab=review', color: c.toReview ? '#b54708' : undefined, show: can('reviewTests') },
    { label: 'Accepted, not reported', value: c.toReport, to: '/reports/prepare', show: can('prepareReports') },
    { label: 'Reports to verify / sign', value: `${c.reportsToVerify} / ${c.reportsToIssue}`, to: '/reports', color: c.reportsToVerify + c.reportsToIssue ? '#6941c6' : undefined, show: can('signReports') },
    { label: 'Quotes awaiting reply', value: c.quotesAwaiting, to: '/quotes', show: hasTab(me, 'quotes') },
    { label: 'Invoiced this month', value: `₹${money(c.revenueMonth)}`, to: '/invoices', show: hasTab(me, 'invoices') },
    { label: 'Outstanding', value: `₹${money(c.outstanding)}`, to: '/ledger', color: c.outstanding ? '#b42318' : undefined, show: hasTab(me, 'ledger') },
  ];
  const quick = [
    { label: 'New quotation', to: '/quotes/new', show: can('quote.create') },
    { label: 'Register sample', to: '/samples?new=1', show: can('sample.create') },
    { label: 'My tests', to: '/tests?tab=mine', show: can('enterObservations') },
    { label: 'Prepare report', to: '/reports/prepare', show: can('prepareReports') },
    { label: 'New invoice', to: '/invoices/new', show: can('invoice.create') },
    { label: 'Record payment', to: '/payments?new=1', show: can('recordPayments') },
  ].filter((q) => q.show);
  return (
    <>
      <PageHeader eyebrow={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        title={`Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, ${me.user.name.split(' ')[0]}`}
        actions={quick.slice(0, 4).map((q) => <Button key={q.to} variant="default" leftSection={<IconPlus size={15} />} onClick={() => nav(q.to)}>{q.label}</Button>)} />
      <SimpleGrid cols={{ base: 2, md: 4 }} mb="md" spacing="sm">
        {tiles.filter((t) => t.show).map((t) => <Kpi key={t.label} label={t.label} value={t.value} hint={t.hint} color={t.color} onClick={() => nav(t.to)} />)}
      </SimpleGrid>
      <Grid>
        <Grid.Col span={{ base: 12, lg: can('viewAnalytics') ? 7 : 12 }}>
          {can('viewAnalytics') && <AskAI onOpen={() => nav('/analytics?tab=builder')} />}
          <Paper withBorder p="md">
            <Group mb="sm"><ThemeIcon variant="light" radius="md"><IconBell size={16} /></ThemeIcon><Text fw={600}>Reminders</Text><Badge variant="light">{data.reminders.length}</Badge></Group>
            <Stack gap={4}>
              {data.reminders.length === 0 && <Text size="sm" c="dimmed">All clear. No overdue tests, follow-ups, calibrations or payments.</Text>}
              {data.reminders.map((r: any, i: number) => (
                <Group key={i} gap="sm" className="clickable" p={6} style={{ borderRadius: 8 }} onClick={() => nav(r.link)} wrap="nowrap">
                  {r.level === 'info' ? <IconInfoCircle size={18} color="#2a78d6" /> : <IconAlertTriangle size={18} color={r.level === 'danger' ? '#d92d20' : '#dc6803'} />}
                  <Badge variant="light" color={r.level === 'danger' ? 'red' : r.level === 'warning' ? 'orange' : 'blue'} style={{ minWidth: 120, textTransform: 'none' }}>{r.kind}</Badge>
                  <Text size="sm">{r.text}</Text>
                </Group>
              ))}
            </Stack>
          </Paper>
        </Grid.Col>
        {can('viewAnalytics') && <Grid.Col span={{ base: 12, lg: 5 }}><MiniTrend /></Grid.Col>}
      </Grid>
    </>
  );
}

function MiniTrend() {
  return (
    <Stack>
      <AnalyticsWidget spec={{ title: 'Revenue trend and forecast', object: 'invoices', measure: { agg: 'sum', field: 'total' }, groupBy: ['month'], dateRange: { preset: 'last_12_months' }, chart: 'line', forecast: 3 }} />
      <AnalyticsWidget spec={{ title: 'Most requested tests (90 days)', object: 'tests', measure: { agg: 'count' }, groupBy: ['test'], dateRange: { preset: 'last_90' }, chart: 'hbar', limit: 6 }} />
    </Stack>
  );
}
