import { useState } from 'react';
import { Button, Group, SegmentedControl, TextInput } from '@mantine/core';
import { IconDownload, IconPrinter } from '@tabler/icons-react';
import { useApi, dmy, money, downloadCsv } from '../api';
import { PageHeader, SimpleTable, StatusBadge } from '../components/ui';

const REGISTERS = [
  { value: 'samples', label: 'Sample inward' }, { value: 'tests', label: 'Tests' }, { value: 'reports', label: 'Report issue' },
  { value: 'quotations', label: 'Quotations' }, { value: 'invoices', label: 'Sales (GST)' }, { value: 'receipts', label: 'Receipts' }, { value: 'equipment', label: 'Calibration' },
];

export function RegistersPage() {
  const [name, setName] = useState('samples');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data } = useApi<any>(`/registers/${name}?from=${from || '0000-00-00'}&to=${to || '9999-12-31'}`, [name, from, to]);
  const fmt = (c: any, v: any) => (c.type === 'money' ? (v === null || v === undefined ? '' : money(v, 2)) : c.type === 'date' ? dmy(v) : c.key === 'status' ? <StatusBadge status={v} /> : v);
  return (
    <>
      <PageHeader title="Registers" subtitle="Live views of the same data – nothing is typed twice"
        actions={<>
          <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>Print</Button>
          <Button variant="default" leftSection={<IconDownload size={16} />} disabled={!data} onClick={() => downloadCsv(`${name}-register.csv`, data.columns, data.rows)}>Export to Excel</Button>
        </>} />
      <Group mb="sm" className="no-print">
        <SegmentedControl value={name} onChange={setName} data={REGISTERS} />
        <TextInput type="date" size="xs" label="From" value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
        <TextInput type="date" size="xs" label="To" value={to} onChange={(e) => setTo(e.currentTarget.value)} />
      </Group>
      <div className="print-root">
        <SimpleTable head={(data?.columns ?? []).map((c: any) => c.label)} rows={(data?.rows ?? []).map((r: any) => data.columns.map((c: any) => fmt(c, r[c.key])))} />
      </div>
    </>
  );
}
