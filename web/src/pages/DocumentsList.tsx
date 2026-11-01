import { useNavigate } from 'react-router-dom';
import { Button, Text } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useApi } from '../api';
import { useCan } from '../ctx';
import { PageHeader } from '../components/ui';
import { ListView, type Col } from '../components/ListView';

const CFG: Record<string, { title: string; sub: string; newTo?: string; quick: { label: string; filters: any[] }[] }> = {
  quote: { title: 'Quotations', sub: 'Rate quotes and estimates sent to clients', newTo: '/quotes/new',
    quick: [{ label: 'Drafts', filters: [{ key: 'status', op: 'in', value: ['draft'] }] }, { label: 'Awaiting reply', filters: [{ key: 'status', op: 'in', value: ['sent'] }] }, { label: 'Accepted', filters: [{ key: 'status', op: 'in', value: ['accepted'] }] }] },
  invoice: { title: 'Invoices', sub: 'Tax invoices, payments and balances', newTo: '/invoices/new',
    quick: [{ label: 'Unpaid', filters: [{ key: 'status', op: 'in', value: ['issued', 'partly_paid'] }] }, { label: 'Drafts', filters: [{ key: 'status', op: 'in', value: ['draft'] }] }, { label: 'NABL', filters: [{ key: 'accreditation', op: 'in', value: ['NABL'] }] }] },
  report: { title: 'Test reports', sub: 'Draft → verification → signed and issued',
    quick: [{ label: 'To verify', filters: [{ key: 'status', op: 'in', value: ['review'] }] }, { label: 'To sign', filters: [{ key: 'status', op: 'in', value: ['verified'] }] }, { label: 'NABL', filters: [{ key: 'accreditation', op: 'in', value: ['NABL'] }] }, { label: 'Non-NABL', filters: [{ key: 'accreditation', op: 'in', value: ['Non-NABL'] }] }] },
};

export function DocumentsList({ kind }: { kind: 'quote' | 'invoice' | 'report' }) {
  const cfg = CFG[kind];
  const can = useCan();
  const { data } = useApi<any[]>(`/documents?kind=${kind}`, [kind]);
  const nav = useNavigate();
  const rows = (data ?? []).filter((d) => d.status !== 'cancelled');
  const cols: Col[] = [
    { key: 'number', label: 'Number', render: (d) => <Text size="sm" fw={550}>{d.number || <Text span c="dimmed" size="sm">Draft #{d.id}</Text>}{d.revision ? ` (R${d.revision})` : ''}</Text>, value: (d) => d.number || `Draft ${d.id}` },
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'accreditation', label: 'Type', type: 'badge' },
    { key: 'client_name', label: 'Client', filter: 'select' },
    { key: 'site_name', label: 'Site', filter: 'select' },
    ...(kind === 'invoice' ? [{ key: 'total', label: 'Amount', type: 'money' as const }, { key: 'paid', label: 'Received', type: 'money' as const }, { key: 'balance', label: 'Balance', type: 'money' as const, value: (d: any) => (d.status === 'draft' ? null : Math.max(0, d.total - (d.paid ?? 0))) }]
      : kind === 'quote' ? [{ key: 'total', label: 'Value', type: 'money' as const }] : []),
    { key: 'status', label: 'Status', type: 'status' },
  ];
  return (
    <>
      <PageHeader title={cfg.title} subtitle={cfg.sub} actions={kind === 'report'
        ? can('prepareReports') && <Button onClick={() => nav('/reports/prepare')}>Prepare report</Button>
        : can(`${kind}.create`) && <Button leftSection={<IconPlus size={16} />} onClick={() => nav(cfg.newTo!)}>New {kind === 'quote' ? 'quotation' : 'invoice'}</Button>} />
      <ListView id={`${kind}s`} rows={data ? rows : null} columns={cols} onRow={(d) => nav(`/documents/${d.id}`)} quickFilters={cfg.quick} />
    </>
  );
}
