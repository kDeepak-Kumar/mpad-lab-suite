import { Badge, Group, Stack, Text, Table, Paper, Loader, Center } from '@mantine/core';
import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <Group justify="space-between" mb="md" align="flex-start" className="no-print">
      <Stack gap={2}>
        <div className="page-title">{title}</div>
        {subtitle && <Text size="sm" c="dimmed">{subtitle}</Text>}
      </Stack>
      {actions && <Group gap="xs">{actions}</Group>}
    </Group>
  );
}

const STATUS: Record<string, [string, string]> = {
  draft: ['gray', 'Draft'], sent: ['blue', 'Sent'], accepted: ['teal', 'Accepted'], rejected: ['red', 'Rejected'], expired: ['gray', 'Expired'],
  review: ['orange', 'Awaiting verification'], verified: ['grape', 'Verified – ready to sign'], issued: ['teal', 'Issued'], cancelled: ['gray', 'Cancelled'],
  paid: ['green', 'Paid'], partly_paid: ['yellow', 'Part paid'], open: ['blue', 'Open'], closed: ['gray', 'Closed'],
  pending: ['gray', 'Pending'], in_progress: ['blue', 'In progress'], submitted: ['orange', 'Submitted for review'], returned: ['red', 'Returned'],
  reported: ['teal', 'Reported'], registered: ['blue', 'Registered'], in_test: ['orange', 'In testing'], EXPIRED: ['red', 'Expired'], Valid: ['teal', 'Valid'],
};
export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const [c, l] = STATUS[status] ?? ['gray', status];
  return <Badge color={c} variant="light" size="sm" style={{ textTransform: 'none' }}>{l}</Badge>;
}

export function Loading() { return <Center p="xl"><Loader /></Center>; }

export function Empty({ children }: { children: ReactNode }) {
  return <Paper p="xl" withBorder><Text c="dimmed" ta="center" size="sm">{children}</Text></Paper>;
}

export function SimpleTable({ head, rows, onRow }: { head: ReactNode[]; rows: ReactNode[][]; onRow?: (i: number) => void }) {
  return (
    <Paper withBorder radius="md" style={{ overflow: 'auto' }}>
      <Table striped highlightOnHover verticalSpacing={6} fz="sm">
        <Table.Thead><Table.Tr>{head.map((h, i) => <Table.Th key={i}>{h}</Table.Th>)}</Table.Tr></Table.Thead>
        <Table.Tbody>
          {rows.length === 0 && <Table.Tr><Table.Td colSpan={head.length}><Text c="dimmed" ta="center" size="sm" p="md">Nothing here yet</Text></Table.Td></Table.Tr>}
          {rows.map((r, i) => <Table.Tr key={i} className={onRow ? 'clickable' : undefined} onClick={onRow ? () => onRow(i) : undefined}>{r.map((c, j) => <Table.Td key={j}>{c}</Table.Td>)}</Table.Tr>)}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}
