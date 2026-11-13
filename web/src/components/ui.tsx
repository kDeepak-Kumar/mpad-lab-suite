import { useLocation } from 'react-router-dom';
import { FavStar } from '../favorites';
import { LabSpinner } from './LabSpinner';
import { Group, Stack, Text, Table, Paper, Loader, Center } from '@mantine/core';
import { IconInbox } from '@tabler/icons-react';
import type { ReactNode } from 'react';

/** Page title row. A star lets the user pin the page (or record) to Favourites; pass `fav` for records whose title is not plain text. */
export function PageHeader({ title, subtitle, actions, eyebrow, fav }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; fav?: { label: string; sub?: string } | false }) {
  const loc = useLocation();
  const label = fav === false ? null : fav?.label ?? (typeof title === 'string' ? title : null);
  const kind = /^\/clients\/\d/.test(loc.pathname) ? 'client' : /^\/documents\/\d/.test(loc.pathname) ? 'document' : /^\/workorders\/\d/.test(loc.pathname) ? 'workorder' : 'page';
  return (
    <Group justify="space-between" mb="md" align="flex-end" className="no-print" wrap="wrap" gap="sm">
      <Stack gap={2}>
        {eyebrow && <Text size="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: '.07em', fontSize: 11 }}>{eyebrow}</Text>}
        <Group gap={4} wrap="nowrap" align="center"><div className="page-title">{title}</div>{label && <FavStar kind={kind} refKey={loc.pathname} label={label} sub={fav ? fav.sub : typeof eyebrow === 'string' ? eyebrow : undefined} />}</Group>
        {subtitle && <Text size="sm" c="dimmed">{subtitle}</Text>}
      </Stack>
      {actions && <Group gap="xs">{actions}</Group>}
    </Group>
  );
}

/** Status → tone and label. One vocabulary for the whole app; colour always comes with the label. */
const STATUS: Record<string, [Tone, string]> = {
  draft: ['neu', 'Draft'], sent: ['info', 'Sent'], accepted: ['ok', 'Accepted'], rejected: ['bad', 'Rejected'], expired: ['neu', 'Expired'],
  review: ['warn', 'Awaiting verification'], verified: ['acc', 'Verified – ready to sign'], issued: ['ok', 'Issued'], cancelled: ['neu', 'Cancelled'],
  paid: ['ok', 'Paid'], partly_paid: ['warn', 'Part paid'], open: ['info', 'Open'], closed: ['neu', 'Closed'],
  pending: ['neu', 'Pending'], in_progress: ['info', 'In progress'], submitted: ['warn', 'Submitted for review'], returned: ['bad', 'Returned'],
  reported: ['ok', 'Reported'], registered: ['neu', 'Registered'], in_test: ['info', 'In testing'], EXPIRED: ['bad', 'Expired'], Valid: ['ok', 'Valid'],
};
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neu' | 'acc';
/** A status pill: soft background, a dot and a label. */
export function Pill({ tone = 'neu', children, dot = true }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return <span className={`pill p-${tone}`}>{dot && <i />}{children}</span>;
}
export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const [tone, label] = STATUS[status] ?? ['neu', status];
  return <Pill tone={tone}>{label}</Pill>;
}
export function TypeBadge({ value }: { value?: string | null }) {
  if (!value) return null;
  return <span className={`tag ${value === 'NABL' ? 't-nabl' : 't-non'}`}>{value === 'NABL' ? 'NABL' : value === 'Non-NABL' ? 'NON-NABL' : value}</span>;
}

/** Stage stepper: done steps are ticked, the current one carries the accent. */
export function Path({ steps, current }: { steps: { key: string; label: string }[]; current: string }) {
  const idx = steps.findIndex((s) => s.key === current);
  return <div className="path no-print" role="list" aria-label="Progress">{steps.map((s, i) => <div key={s.key} role="listitem" aria-current={i === idx ? 'step' : undefined} className={`path-step${i < idx ? ' done' : i === idx ? ' current' : ''}`}>{s.label}</div>)}</div>;
}

export function Loading() {
  return <Center mih={320}><LabSpinner size={60} label="Loading…" /></Center>;
}
export function Spinner() { return <Center p="xl"><Loader size="sm" /></Center>; }

/** Empty state: says what is missing and, where it helps, what to do next. */
export function Empty({ children, title, icon, action }: { children?: ReactNode; title?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-ic">{icon ?? <IconInbox size={20} stroke={1.6} />}</span>
      {title && <b>{title}</b>}
      {children && <div>{children}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}
/** Placeholder rows in the real layout while a list or card loads. */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return <div style={{ padding: '8px 12px' }} aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'center', height: 48, borderBottom: '1px solid var(--line)' }}><div className="skel" style={{ height: 12, width: `${14 + (i % 3) * 4}%` }} /><div className="skel" style={{ height: 12, width: `${26 + (i % 4) * 5}%` }} /><div className="skel" style={{ height: 12, width: '12%', marginLeft: 'auto' }} /></div>)}</div>;
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
      <Table highlightOnHover verticalSpacing={10} fz="sm">
        <Table.Thead><Table.Tr>{head.map((h, i) => <Table.Th key={i}>{h}</Table.Th>)}</Table.Tr></Table.Thead>
        <Table.Tbody>
          {rows.length === 0 && <Table.Tr><Table.Td colSpan={head.length}><Text c="dimmed" ta="center" size="sm" p="md">Nothing here yet</Text></Table.Td></Table.Tr>}
          {rows.map((r, i) => <Table.Tr key={i} className={onRow ? 'clickable' : undefined} onClick={onRow ? () => onRow(i) : undefined}>{r.map((c, j) => <Table.Td key={j}>{c}</Table.Td>)}</Table.Tr>)}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}
