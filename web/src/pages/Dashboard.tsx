import { useNavigate } from 'react-router-dom';
import { Paper, SimpleGrid, Text, Group, Stack, Badge, ThemeIcon } from '@mantine/core';
import { IconAlertTriangle, IconBell, IconInfoCircle } from '@tabler/icons-react';
import { useApi, money } from '../api';
import { useMe, hasRole } from '../App';
import { PageHeader, Loading } from '../components/ui';

function Stat({ label, value, to, hint, color }: { label: string; value: string | number; to: string; hint?: string; color?: string }) {
  const nav = useNavigate();
  return (
    <Paper withBorder p="md" radius="md" className="clickable" onClick={() => nav(to)}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
      <Text fw={700} fz={26} c={color}>{value}</Text>
      {hint && <Text size="xs" c="dimmed">{hint}</Text>}
    </Paper>
  );
}

export function Dashboard() {
  const me = useMe();
  const nav = useNavigate();
  const { data } = useApi<any>('/dashboard');
  if (!data) return <Loading />;
  const c = data.counts;
  const lab = hasRole(me, 'technician', 'reviewer', 'signatory');
  const acct = hasRole(me, 'accountant', 'frontdesk');
  return (
    <>
      <PageHeader title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${me.user.name.split(' ')[0]}`} subtitle="Here is what needs attention today" />
      <SimpleGrid cols={{ base: 2, md: 4 }} mb="lg">
        {lab && <Stat label={me.user.role === 'technician' ? 'My tests to do' : 'Tests to do'} value={me.user.role === 'technician' ? c.myTests : c.testsToDo} to="/tests" hint="Pending, in progress or returned" />}
        {hasRole(me, 'reviewer', 'signatory') && <Stat label="Observations to review" value={c.toReview} to="/tests?tab=review" color={c.toReview ? 'orange' : undefined} />}
        {hasRole(me, 'reviewer', 'signatory') && <Stat label="Accepted, not reported" value={c.toReport} to="/reports/prepare" />}
        {hasRole(me, 'signatory', 'reviewer') && <Stat label="Reports to verify / sign" value={`${c.reportsToVerify} / ${c.reportsToIssue}`} to="/reports" color={c.reportsToVerify + c.reportsToIssue ? 'grape' : undefined} />}
        {acct && <Stat label="Quotes awaiting reply" value={c.quotesAwaiting} to="/quotes" />}
        {acct && <Stat label="Invoiced this month" value={`₹${money(c.revenueMonth)}`} to="/invoices" />}
        {acct && <Stat label="Outstanding" value={`₹${money(c.outstanding)}`} to="/ledger" color={c.outstanding ? 'red' : undefined} />}
      </SimpleGrid>
      <Paper withBorder p="md" radius="md">
        <Group mb="sm"><ThemeIcon variant="light"><IconBell size={16} /></ThemeIcon><Text fw={600}>Reminders</Text><Badge variant="light">{data.reminders.length}</Badge></Group>
        <Stack gap={6}>
          {data.reminders.length === 0 && <Text size="sm" c="dimmed">All clear. No overdue tests, follow-ups, calibrations or payments.</Text>}
          {data.reminders.map((r: any, i: number) => (
            <Group key={i} gap="sm" className="clickable" p={6} style={{ borderRadius: 6 }} onClick={() => nav(r.link)} wrap="nowrap">
              {r.level === 'info' ? <IconInfoCircle size={18} color="#3d66b0" /> : <IconAlertTriangle size={18} color={r.level === 'danger' ? '#e03131' : '#f08c00'} />}
              <Badge variant="outline" color={r.level === 'danger' ? 'red' : r.level === 'warning' ? 'orange' : 'blue'} style={{ minWidth: 120 }}>{r.kind}</Badge>
              <Text size="sm">{r.text}</Text>
            </Group>
          ))}
        </Stack>
      </Paper>
    </>
  );
}
