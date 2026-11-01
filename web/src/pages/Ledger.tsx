import { useNavigate, useParams } from 'react-router-dom';
import { Button, Group, Text } from '@mantine/core';
import { IconPrinter } from '@tabler/icons-react';
import { DEFAULT_TEMPLATES } from '@suite/shared';
import { useApi, money, localToday } from '../api';
import { PageHeader, Loading } from '../components/ui';
import { ListView } from '../components/ListView';
import { DocRenderer } from '../doc/DocRenderer';

export function LedgerPage() {
  const { data } = useApi<any[]>('/ledger');
  const nav = useNavigate();
  const rows = (data ?? []).sort((a, b) => b.balance - a.balance);
  const tot = rows.reduce((s, r) => ({ inv: s.inv + r.invoiced, rec: s.rec + r.received, bal: s.bal + r.balance }), { inv: 0, rec: 0, bal: 0 });
  return (
    <>
      <PageHeader title="Ledgers" subtitle={`Total outstanding ₹${money(tot.bal)} · invoiced ₹${money(tot.inv)} · received ₹${money(tot.rec)}`} />
      <ListView id="ledger" rows={data ? rows : null} onRow={(r) => nav(`/ledger/${r.id}`)} columns={[
        { key: 'name', label: 'Client' }, { key: 'opening', label: 'Opening', type: 'money', hidden: true }, { key: 'invoiced', label: 'Invoiced', type: 'money' }, { key: 'received', label: 'Received (incl. TDS)', type: 'money' },
        { key: 'balance', label: 'Balance', type: 'money' }, { key: 'd0_30', label: '0–30 days', type: 'money', value: (r) => r.ageing.d0_30 }, { key: 'd31_60', label: '31–60', type: 'money', value: (r) => r.ageing.d31_60 },
        { key: 'd61_90', label: '61–90', type: 'money', value: (r) => r.ageing.d61_90 }, { key: 'd90', label: '90+ days', type: 'money', value: (r) => r.ageing.d90 }]}
        quickFilters={[{ label: 'With balance', filters: [{ key: 'balance', op: 'min', value: '1' }] }, { label: '90+ days', filters: [{ key: 'd90', op: 'min', value: '1' }] }]} />
    </>
  );
}

/** Printable statement of account for one client. */
export function ClientLedger() {
  const { clientId } = useParams();
  const { data } = useApi<any>(`/ledger/${clientId}`, [clientId]);
  const { data: company } = useApi<any>('/company');
  const { data: client } = useApi<any>(`/clients/${clientId}`, [clientId]);
  if (!data || !company || !client) return <Loading />;
  return (
    <>
      <PageHeader title={`Statement of account – ${data.client.name}`} subtitle={`Balance due ₹${money(data.balance, 2)}`} actions={<Button leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>Print / Save as PDF</Button>} />
      <Group className="print-root" justify="center">
        <div className="doc-stage">
          <DocRenderer template={DEFAULT_TEMPLATES.statement} kind="statement" company={company} status="issued"
            data={{ client: { name: client.name, address: client.address }, asOn: localToday(), opening: data.opening, entries: data.entries, balance: data.balance }} />
        </div>
      </Group>
    </>
  );
}
