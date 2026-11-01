import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Checkbox, Group, Modal, NumberInput, Select, SimpleGrid, Stack, Table, Text, TextInput, Paper } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { api, dmy, money, ok, useApi, localToday } from '../api';
import { PageHeader } from '../components/ui';
import { ListView } from '../components/ListView';
import { useCan, usePicklist } from '../ctx';

export function PaymentsPage() {
  const [sp, setSp] = useSearchParams();
  const { data, reload } = useApi<any[]>('/payments');
  const can = useCan();
  return (
    <>
      <PageHeader title="Payments received" subtitle="Record receipts and TDS against invoices" actions={can('recordPayments') && <Button leftSection={<IconPlus size={16} />} onClick={() => setSp({ new: '1' })}>Record payment</Button>} />
      <ListView id="payments" rows={data} columns={[
        { key: 'number', label: 'Receipt' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'client_name', label: 'Client', filter: 'select' },
        { key: 'amount', label: 'Amount', type: 'money' }, { key: 'tds', label: 'TDS', type: 'money' }, { key: 'mode', label: 'Mode', filter: 'select' }, { key: 'reference', label: 'Reference' }]} />
      {sp.get('new') === '1' && <PaymentModal clientId={sp.get('client')} invoiceId={sp.get('invoice')} onClose={(saved) => { setSp({}); if (saved) reload(); }} />}
    </>
  );
}

function PaymentModal({ clientId, invoiceId, onClose }: { clientId: string | null; invoiceId: string | null; onClose: (saved: boolean) => void }) {
  const { data: clients } = useApi<any[]>('/clients');
  const [client, setClient] = useState<string | null>(clientId);
  const { data: open } = useApi<any[]>(client ? `/invoices/outstanding?client_id=${client}` : null, [client]);
  const [v, setV] = useState({ date: localToday(), amount: 0, tds: 0, mode: 'Bank transfer (NEFT/RTGS)', reference: '' });
  const [alloc, setAlloc] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const modes = usePicklist('payment_mode');
  useEffect(() => {
    if (!open) return;
    if (invoiceId) { const inv = open.find((i) => String(i.id) === invoiceId); if (inv) { setAlloc({ [inv.id]: inv.balance }); setV((o) => ({ ...o, amount: inv.balance })); } }
  }, [open]);
  const allocated = Object.values(alloc).reduce((s, x) => s + (x || 0), 0);
  const save = async () => {
    setBusy(true);
    try {
      await api('/payments', { body: { ...v, client_id: Number(client), allocations: Object.entries(alloc).filter(([, a]) => a > 0).map(([id, a]) => ({ invoiceId: Number(id), amount: a })) } });
      ok('Payment recorded'); onClose(true);
    } finally { setBusy(false); }
  };
  return (
    <Modal opened onClose={() => onClose(false)} title="Record payment received" size="xl">
      <Stack>
        <Select label="Client" searchable data={(clients ?? []).map((c) => ({ value: String(c.id), label: c.name }))} value={client} onChange={(x) => { setClient(x); setAlloc({}); }} />
        <SimpleGrid cols={{ base: 2, md: 5 }}>
          <TextInput type="date" label="Date" value={v.date} onChange={(e) => setV({ ...v, date: e.currentTarget.value })} />
          <NumberInput label="Amount received (₹)" thousandSeparator="," decimalScale={2} value={v.amount} onChange={(x) => setV({ ...v, amount: Number(x) || 0 })} />
          <NumberInput label="TDS deducted (₹)" thousandSeparator="," decimalScale={2} value={v.tds} onChange={(x) => setV({ ...v, tds: Number(x) || 0 })} />
          <Select label="Mode" data={modes} value={v.mode} onChange={(x) => setV({ ...v, mode: x ?? '' })} />
          <TextInput label="Reference / UTR / cheque no." value={v.reference} onChange={(e) => setV({ ...v, reference: e.currentTarget.value })} />
        </SimpleGrid>
        {client && (
          <Paper withBorder p={0}>
            <Table fz="sm">
              <Table.Thead><Table.Tr><Table.Th /><Table.Th>Invoice</Table.Th><Table.Th>Date</Table.Th><Table.Th className="num">Total</Table.Th><Table.Th className="num">Balance</Table.Th><Table.Th w={160}>Apply (incl. TDS)</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {(open ?? []).map((i) => (
                  <Table.Tr key={i.id}>
                    <Table.Td><Checkbox checked={!!alloc[i.id]} onChange={(e) => setAlloc({ ...alloc, [i.id]: e.currentTarget.checked ? Math.min(i.balance, Math.max(0, v.amount + v.tds - allocated) || i.balance) : 0 })} /></Table.Td>
                    <Table.Td>{i.number}</Table.Td><Table.Td>{dmy(i.date)}{i.overdue ? <Text span c="red" size="xs"> · {i.days}d</Text> : null}</Table.Td>
                    <Table.Td className="num">₹{money(i.total)}</Table.Td><Table.Td className="num">₹{money(i.balance, 2)}</Table.Td>
                    <Table.Td><NumberInput size="xs" thousandSeparator="," decimalScale={2} value={alloc[i.id] ?? 0} onChange={(x) => setAlloc({ ...alloc, [i.id]: Number(x) || 0 })} /></Table.Td>
                  </Table.Tr>
                ))}
                {open?.length === 0 && <Table.Tr><Table.Td colSpan={6}><Text size="sm" c="dimmed" p="sm">No unpaid invoices. The amount is recorded as an advance on the client ledger.</Text></Table.Td></Table.Tr>}
              </Table.Tbody>
            </Table>
          </Paper>
        )}
        <Group justify="space-between">
          <Text size="sm" c={allocated > v.amount + v.tds + 0.5 ? 'red' : 'dimmed'}>Applied ₹{money(allocated, 2)} of ₹{money(v.amount + v.tds, 2)} (amount + TDS)</Text>
          <Button loading={busy} disabled={!client || v.amount <= 0 || allocated > v.amount + v.tds + 0.5} onClick={save}>Save payment</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
