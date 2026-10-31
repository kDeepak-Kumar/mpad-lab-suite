import { useNavigate, useParams } from 'react-router-dom';
import { Button, Group, Text } from '@mantine/core';
import { IconPrinter, IconDownload } from '@tabler/icons-react';
import { DEFAULT_TEMPLATES } from '@suite/shared';
import { useApi, money, downloadCsv, localToday } from '../api';
import { PageHeader, SimpleTable, Loading } from '../components/ui';
import { DocRenderer } from '../doc/DocRenderer';

export function LedgerPage() {
  const { data } = useApi<any[]>('/ledger');
  const nav = useNavigate();
  const rows = (data ?? []).sort((a, b) => b.balance - a.balance);
  const tot = rows.reduce((s, r) => ({ inv: s.inv + r.invoiced, rec: s.rec + r.received, bal: s.bal + r.balance }), { inv: 0, rec: 0, bal: 0 });
  const cols = [{ key: 'name', label: 'Client' }, { key: 'invoiced', label: 'Invoiced' }, { key: 'received', label: 'Received (incl. TDS)' }, { key: 'balance', label: 'Balance' }, { key: 'd0_30', label: '0–30 days' }, { key: 'd31_60', label: '31–60' }, { key: 'd61_90', label: '61–90' }, { key: 'd90', label: '90+' }];
  return (
    <>
      <PageHeader title="Ledgers" subtitle={`Total outstanding ₹${money(tot.bal)} · invoiced ₹${money(tot.inv)} · received ₹${money(tot.rec)}`}
        actions={<Button variant="default" leftSection={<IconDownload size={16} />} onClick={() => downloadCsv(`outstanding-${localToday()}.csv`, cols, rows.map((r) => ({ ...r, ...r.ageing })))}>Export to Excel</Button>} />
      <SimpleTable head={['Client', 'Invoiced', 'Received', 'Balance', '0–30', '31–60', '61–90', '90+ days']}
        rows={rows.map((r) => [r.name, money(r.invoiced), money(r.received), <Text size="sm" fw={600} c={r.balance > 0 ? 'red' : undefined}>{money(r.balance)}</Text>, money(r.ageing.d0_30), money(r.ageing.d31_60), money(r.ageing.d61_90), <Text size="sm" c={r.ageing.d90 ? 'red' : undefined}>{money(r.ageing.d90)}</Text>])}
        onRow={(i) => nav(`/ledger/${rows[i].id}`)} />
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
