import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Grid, Group, Paper, SegmentedControl, Select, SimpleGrid, Skeleton, Stack, Table, Text } from '@mantine/core';
import { Bar, BarChart, CartesianGrid, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { IconCalendarStats, IconCash, IconClockDollar, IconReceipt2, IconWallet, IconX } from '@tabler/icons-react';
import type { ReportSpec } from '@suite/shared';
import { compact, money, useApi } from '../api';
import { useCan } from '../ctx';
import { PageHeader } from '../components/ui';
import { BarList, Card, S1, S2, Stat } from './Dashboard';
import { AskAI, Builder } from './Analytics';

const rupees = (n: number) => `₹${money(n)}`;
const SLATE = '#98a2b3';
interface Data {
  fy: number; currentFy: number;
  kpis: { thisMonth: number; lastMonth: number; fyToDate: number; lastFyToDate: number; collectedFy: number; outstanding: number; overdue: number; invoices: number; avgInvoice: number; avgDaysToPay: number | null };
  monthly: { label: string; current: number; previous: number; collected: number }[];
  years: { label: string; invoiced: number; collected: number }[];
  status: { paid: { count: number; amount: number }; partly: { count: number; amount: number; due: number }; unpaid: { count: number; amount: number } };
  topClients: { name: string; client_id: number; total: number; due: number; count: number; share: number }[];
  accreditation: { label: string; amount: number }[];
  ageing: { label: string; amount: number }[];
  clients: { value: string; label: string }[];
}
const fyLabel = (y: number) => `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`;
const tip = { contentStyle: { borderRadius: 10, border: '1px solid #e4e8ee', fontSize: 13 }, formatter: (v: number) => rupees(v) };

/** Invoice analytics: KPIs, month and year comparisons, customers, paid vs unpaid, plus AI custom reports. */
export function InvoiceAnalyticsPage() {
  const nav = useNavigate();
  const can = useCan();
  const [fy, setFy] = useState<string | null>(null);
  const [client, setClient] = useState<string | null>(null);
  const [acc, setAcc] = useState('all');
  const [spec, setSpec] = useState<ReportSpec | null>(null);
  const qs = new URLSearchParams({ ...(fy ? { fy } : {}), ...(client ? { client } : {}), ...(acc !== 'all' ? { accreditation: acc } : {}) }).toString();
  const { data } = useApi<Data>(`/invoices/analytics${qs ? `?${qs}` : ''}`, [qs]);
  const cur = data?.currentFy ?? new Date().getFullYear();
  const k = data?.kpis;
  const prevFyLabel = data ? fyLabel(data.fy - 1) : '';
  return (
    <Stack gap="md">
      <PageHeader eyebrow="Accounts" title="Invoice analytics" subtitle="Billing trends, comparisons, customers and collections. Figures are tax-inclusive invoice totals of issued invoices." />
      <Paper withBorder radius="lg" p="sm">
        <Group gap="sm" wrap="wrap">
          <Select w={150} size="sm" label="Financial year" data={Array.from({ length: 6 }, (_, i) => cur - i).map((y) => ({ value: String(y), label: fyLabel(y) }))} value={fy ?? String(cur)} onChange={setFy} allowDeselect={false} />
          <Select w={280} size="sm" label="Customer" placeholder="All customers" searchable clearable data={data?.clients ?? []} value={client} onChange={setClient} />
          <div><Text size="sm" fw={500} mb={3}>Report type</Text><SegmentedControl size="sm" value={acc} onChange={setAcc} data={[{ value: 'all', label: 'All' }, { value: 'NABL', label: 'NABL' }, { value: 'Non-NABL', label: 'Non-NABL' }]} /></div>
          {(fy || client || acc !== 'all') && <Button mt={22} size="sm" variant="subtle" color="gray" leftSection={<IconX size={14} />} onClick={() => { setFy(null); setClient(null); setAcc('all'); }}>Clear filters</Button>}
        </Group>
      </Paper>

      {!data || !k ? <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={130} radius="lg" />)}</SimpleGrid> : <>
        <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="md">
          <Stat icon={IconReceipt2} label="Invoiced this month" value={rupees(k.thisMonth)} now={k.thisMonth} before={k.lastMonth} sub={undefined} />
          <Stat icon={IconCalendarStats} label={`${fyLabel(data.fy)}${data.fy === data.currentFy ? ' to date' : ''}`} value={rupees(k.fyToDate)} now={k.fyToDate} before={k.lastFyToDate} vs={`vs ${prevFyLabel}${data.fy === data.currentFy ? ' same period' : ''}`} />
          <Stat icon={IconCash} label={`Collected in ${fyLabel(data.fy)}`} value={rupees(k.collectedFy)} sub={<Text size="xs" c="dimmed">{k.avgDaysToPay === null ? 'No payments yet' : `Paid on average ${k.avgDaysToPay} days after invoice`}</Text>} />
          <Stat icon={IconWallet} label="Outstanding now" value={rupees(k.outstanding)} sub={<Text size="xs" c={k.overdue ? '#b42318' : 'dimmed'} fw={k.overdue ? 600 : 400}>{k.overdue ? `${rupees(k.overdue)} over 30 days` : 'Nothing over 30 days'}</Text>} onClick={() => nav('/ledger')} />
        </SimpleGrid>

        <Grid gutter="md">
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Card title={`Monthly billing – ${fyLabel(data.fy)} vs ${prevFyLabel}`} sub="Bars: invoiced each month · line: collected this year">
              <div style={{ height: 300 }}>
                <ResponsiveContainer>
                  <ComposedChart data={data.monthly} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2}>
                    <CartesianGrid vertical={false} stroke="#eef0f3" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#667085' }} />
                    <YAxis tickLine={false} axisLine={false} width={56} tick={{ fontSize: 12, fill: '#667085' }} tickFormatter={(v) => `₹${compact(v)}`} />
                    <RTooltip {...tip} cursor={{ fill: '#f2f4f7' }} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Bar name={fyLabel(data.fy)} dataKey="current" fill={S1} radius={[4, 4, 0, 0]} maxBarSize={18} />
                    <Bar name={prevFyLabel} dataKey="previous" fill={SLATE} radius={[4, 4, 0, 0]} maxBarSize={18} />
                    <Line name="Collected" type="linear" dataKey="collected" stroke={S2} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: S2 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Card title="Paid vs unpaid" sub={`Invoices raised in ${fyLabel(data.fy)} (${k.invoices}, average ${rupees(k.avgInvoice)})`}>
              <BarList rows={[
                { label: `Paid · ${data.status.paid.count} invoice(s)`, value: data.status.paid.amount, display: rupees(data.status.paid.amount) },
                { label: `Part paid · ${data.status.partly.count} (₹${money(data.status.partly.due)} due)`, value: data.status.partly.amount, display: rupees(data.status.partly.amount) },
                { label: `Unpaid · ${data.status.unpaid.count}`, value: data.status.unpaid.amount, display: rupees(data.status.unpaid.amount), warn: data.status.unpaid.amount > 0 },
              ]} empty="No invoices in this period" />
              <Text size="xs" c="dimmed" fw={600} mt="lg" mb={8}>NABL VS NON-NABL</Text>
              <BarList rows={data.accreditation.map((a) => ({ label: a.label, value: a.amount, display: rupees(a.amount) }))} empty="No invoices in this period" />
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Card title="Top customers" sub={`${fyLabel(data.fy)} · contribution to billing`}>
              {!data.topClients.length ? <Text size="sm" c="dimmed">No invoices in this period</Text> : (
                <Table.ScrollContainer minWidth={520}>
                  <Table verticalSpacing={6} highlightOnHover>
                    <Table.Thead><Table.Tr><Table.Th>Customer</Table.Th><Table.Th ta="right">Invoices</Table.Th><Table.Th ta="right">Invoiced</Table.Th><Table.Th w="26%">Share</Table.Th><Table.Th ta="right">Outstanding</Table.Th></Table.Tr></Table.Thead>
                    <Table.Tbody>{data.topClients.map((t) => (
                      <Table.Tr key={t.client_id} style={{ cursor: 'pointer' }} onClick={() => nav(`/clients/${t.client_id}`)}>
                        <Table.Td><Text size="sm" fw={550}>{t.name}</Text></Table.Td>
                        <Table.Td ta="right">{t.count}</Table.Td>
                        <Table.Td ta="right" style={{ fontVariantNumeric: 'tabular-nums' }}>{rupees(t.total)}</Table.Td>
                        <Table.Td><Group gap={6} wrap="nowrap"><div className="dash-bar" style={{ flex: 1 }}><span style={{ width: `${Math.max(2, t.share)}%`, background: S1 }} /></div><Text size="xs" w={40} ta="right">{t.share}%</Text></Group></Table.Td>
                        <Table.Td ta="right" c={t.due ? '#b42318' : 'dimmed'} style={{ fontVariantNumeric: 'tabular-nums' }}>{t.due ? rupees(t.due) : '—'}</Table.Td>
                      </Table.Tr>))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Card title="Outstanding by age" sub="All unpaid invoice balances">
              <BarList rows={data.ageing.map((a) => ({ label: a.label, value: a.amount, display: rupees(a.amount), warn: a.label !== '0–30 days' && a.amount > 0 }))} empty="Nothing outstanding" />
            </Card>
          </Grid.Col>

          <Grid.Col span={12}>
            <Card title="Year on year" sub="Invoiced and collected per financial year">
              <div style={{ height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={data.years} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2}>
                    <CartesianGrid vertical={false} stroke="#eef0f3" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#667085' }} />
                    <YAxis tickLine={false} axisLine={false} width={56} tick={{ fontSize: 12, fill: '#667085' }} tickFormatter={(v) => `₹${compact(v)}`} />
                    <RTooltip {...tip} cursor={{ fill: '#f2f4f7' }} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Bar name="Invoiced" dataKey="invoiced" fill={S1} radius={[4, 4, 0, 0]} maxBarSize={36} />
                    <Bar name="Collected" dataKey="collected" fill={S2} radius={[4, 4, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </Grid.Col>
        </Grid>
      </>}

      {can('viewAnalytics') && <>
        <AskAI title="Custom report – ask in plain words" placeholder="e.g. Unpaid invoices by client older than 60 days" onOpen={setSpec}
          examples={['Invoiced by month this year vs last year', 'Top 10 customers this financial year', 'Outstanding by client', 'Collections by payment mode this year', 'NABL vs Non-NABL revenue by quarter', 'Revenue by test this year']} />
        {spec && <Paper withBorder radius="lg" p="md"><Group justify="space-between" mb="sm"><Text fw={650}>Adjust the report</Text><Button size="compact-sm" variant="subtle" color="gray" onClick={() => setSpec(null)}>Close</Button></Group>
          <Builder initial={spec} onSaved={() => undefined} onAdd={() => nav('/analytics')} /></Paper>}
        <Text size="xs" c="dimmed">The AI only turns your question into a report definition (what to measure, filters, grouping); the app checks it and calculates the figures itself. It never runs its own database queries.</Text>
      </>}
    </Stack>
  );
}
