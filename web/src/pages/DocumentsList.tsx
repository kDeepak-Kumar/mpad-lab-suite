import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Group, SegmentedControl, TextInput, Text } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useApi, dmy, money } from '../api';
import { PageHeader, SimpleTable, StatusBadge } from '../components/ui';

const CFG: Record<string, { title: string; sub: string; filters: { value: string; label: string }[]; newTo?: string }> = {
  quote: { title: 'Quotations', sub: 'Rate quotes and estimates sent to clients', newTo: '/quotes/new', filters: [{ value: '', label: 'All' }, { value: 'draft', label: 'Draft' }, { value: 'sent', label: 'Sent' }, { value: 'accepted', label: 'Accepted' }, { value: 'rejected,expired', label: 'Closed' }] },
  invoice: { title: 'Invoices', sub: 'Tax invoices, payments and balances', newTo: '/invoices/new', filters: [{ value: '', label: 'All' }, { value: 'draft', label: 'Draft' }, { value: 'issued,partly_paid', label: 'Unpaid' }, { value: 'paid', label: 'Paid' }] },
  report: { title: 'Test reports', sub: 'Draft → verification → signed and issued', filters: [{ value: '', label: 'All' }, { value: 'draft', label: 'Draft' }, { value: 'review', label: 'To verify' }, { value: 'verified', label: 'To sign' }, { value: 'issued', label: 'Issued' }] },
};

export function DocumentsList({ kind }: { kind: 'quote' | 'invoice' | 'report' }) {
  const cfg = CFG[kind];
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const { data } = useApi<any[]>(`/documents?kind=${kind}&status=${status}&q=${encodeURIComponent(q)}`, [kind, status, q]);
  const nav = useNavigate();
  const rows = (data ?? []).filter((d) => status || d.status !== 'cancelled');
  return (
    <>
      <PageHeader title={cfg.title} subtitle={cfg.sub} actions={kind === 'report'
        ? <Button onClick={() => nav('/reports/prepare')}>Prepare report from accepted tests</Button>
        : <Button leftSection={<IconPlus size={16} />} onClick={() => nav(cfg.newTo!)}>New {kind === 'quote' ? 'quotation' : 'invoice'}</Button>} />
      <Group mb="sm">
        <SegmentedControl value={status} onChange={setStatus} data={cfg.filters} />
        <TextInput placeholder="Search number or client" value={q} onChange={(e) => setQ(e.currentTarget.value)} w={280} />
      </Group>
      <SimpleTable
        head={kind === 'invoice' ? ['Number', 'Date', 'Client', 'Site', 'Amount', 'Received', 'Status'] : kind === 'report' ? ['Number', 'Date', 'Client', 'Site', 'Status'] : ['Number', 'Date', 'Client', 'Site', 'Value', 'Status']}
        rows={rows.map((d) => {
          const base = [<Text size="sm" fw={500}>{d.number || <Text span c="dimmed" size="sm">(draft #{d.id})</Text>}{d.revision ? ` (R${d.revision})` : ''}</Text>, dmy(d.date), d.client_name, d.site_name];
          if (kind === 'invoice') return [...base, <span className="num">₹{money(d.total)}</span>, <span className="num">₹{money(d.paid)}</span>, <StatusBadge status={d.status} />];
          if (kind === 'report') return [...base, <StatusBadge status={d.status} />];
          return [...base, d.total ? `₹${money(d.total)}` : <Text size="xs" c="dimmed">rates only</Text>, <StatusBadge status={d.status} />];
        })}
        onRow={(i) => nav(`/documents/${rows[i].id}`)} />
    </>
  );
}
