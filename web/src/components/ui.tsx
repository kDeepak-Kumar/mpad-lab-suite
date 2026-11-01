import { Badge, Group, Stack, Text, Table, Paper, Loader, Center, Skeleton } from '@mantine/core';
import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <Group justify="space-between" mb="md" align="flex-end" className="no-print" wrap="wrap" gap="sm">
      <Stack gap={2}>
        {eyebrow && <Text size="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: '.05em' }}>{eyebrow}</Text>}
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
  return <Badge color={c} variant="light" size="sm" style={{ textTransform: 'none', fontWeight: 600 }}>{l}</Badge>;
}
export function TypeBadge({ value }: { value?: string | null }) {
  if (!value) return null;
  return <Badge color={value === 'NABL' ? 'teal' : 'gray'} variant={value === 'NABL' ? 'filled' : 'light'} size="sm" style={{ textTransform: 'none' }}>{value}</Badge>;
}

/** Salesforce-style stage path. */
export function Path({ steps, current }: { steps: { key: string; label: string }[]; current: string }) {
  const idx = steps.findIndex((s) => s.key === current);
  return <div className="path no-print">{steps.map((s, i) => <div key={s.key} className={`path-step${i < idx ? ' done' : i === idx ? ' current' : ''}`}>{s.label}</div>)}</div>;
}

export function Loading() {
  return <Stack p="md" gap="sm"><Skeleton h={28} w="40%" /><Skeleton h={14} w="25%" /><Skeleton h={260} mt="md" radius="lg" /></Stack>;
}
export function Spinner() { return <Center p="xl"><Loader size="sm" /></Center>; }

export function Empty({ children }: { children: ReactNode }) {
  return <Paper p="xl" withBorder><Text c="dimmed" ta="center" size="sm">{children}</Text></Paper>;
}

export function Kpi({ label, value, hint, color, onClick }: { label: string; value: ReactNode; hint?: ReactNode; color?: string; onClick?: () => void }) {
  return (
    <div className={`kpi${onClick ? ' clickable' : ''}`} onClick={onClick}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color }}>{value}</div>
      {hint && <Text size="xs" c="dimmed" mt={2}>{hint}</Text>}
    </div>
  );
}

export function SimpleTable({ head, rows, onRow }: { head: ReactNode[]; rows: ReactNode[][]; onRow?: (i: number) => void }) {
  return (
    <Paper withBorder radius="lg" style={{ overflow: 'auto' }}>
      <Table highlightOnHover verticalSpacing={8} fz="sm">
        <Table.Thead bg="#f9fafb"><Table.Tr>{head.map((h, i) => <Table.Th key={i} fz={12} c="#475467">{h}</Table.Th>)}</Table.Tr></Table.Thead>
        <Table.Tbody>
          {rows.length === 0 && <Table.Tr><Table.Td colSpan={head.length}><Text c="dimmed" ta="center" size="sm" p="md">Nothing here yet</Text></Table.Td></Table.Tr>}
          {rows.map((r, i) => <Table.Tr key={i} className={onRow ? 'clickable' : undefined} onClick={onRow ? () => onRow(i) : undefined}>{r.map((c, j) => <Table.Td key={j}>{c}</Table.Td>)}</Table.Tr>)}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}
