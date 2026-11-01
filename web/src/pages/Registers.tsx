import { useState } from 'react';
import { Button, Group, SegmentedControl, TextInput } from '@mantine/core';
import { IconPrinter } from '@tabler/icons-react';
import { useApi } from '../api';
import { PageHeader } from '../components/ui';
import { ListView } from '../components/ListView';

const REGISTERS = [
  { value: 'samples', label: 'Sample inward' }, { value: 'tests', label: 'Tests' }, { value: 'reports', label: 'Report issue' },
  { value: 'quotations', label: 'Quotations' }, { value: 'invoices', label: 'Sales (GST)' }, { value: 'receipts', label: 'Receipts' }, { value: 'equipment', label: 'Calibration' },
];

export function RegistersPage() {
  const [name, setName] = useState('samples');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data } = useApi<any>(`/registers/${name}?from=${from || '0000-00-00'}&to=${to || '9999-12-31'}`, [name, from, to]);
  return (
    <>
      <PageHeader title="Registers" subtitle="Live views of the same data – nothing is typed twice. Filter, then export or print." actions={<Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>Print</Button>} />
      <Group mb="sm" className="no-print">
        <SegmentedControl value={name} onChange={setName} data={REGISTERS} />
        <TextInput type="date" size="xs" label="From" value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
        <TextInput type="date" size="xs" label="To" value={to} onChange={(e) => setTo(e.currentTarget.value)} />
      </Group>
      <div className="print-root">
        <ListView key={name} id={`register-${name}`} rows={data?.rows ?? null} columns={(data?.columns ?? []).map((c: any) => ({ key: c.key, label: c.label, type: c.type === 'money' ? 'money' : c.type === 'date' ? 'date' : c.key === 'status' ? 'status' : c.key === 'accreditation' ? 'badge' : undefined, filter: ['client', 'site', 'material', 'mode', 'category', 'signatory', 'tested_by', 'reviewer', 'test'].includes(c.key) ? 'select' : undefined }))} />
      </div>
    </>
  );
}
