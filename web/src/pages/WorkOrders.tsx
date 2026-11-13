import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Group, Paper, Text, Stack, Badge, Modal, Select, TextInput } from '@mantine/core';
import { IconCheck, IconPlus } from '@tabler/icons-react';
import { RecordLayout, Block } from '../components/Record';
import { Facts } from '../components/Sheet';
import { api, dmy, money, ok, useApi, localToday } from '../api';
import { Empty, PageHeader, SimpleTable, StatusBadge, Loading } from '../components/ui';
import { ListView } from '../components/ListView';
import { useCan } from '../ctx';
import { NewSampleModal } from './Samples';
import { AdminDelete, RecordInfo } from '../components/RecordAdmin';

export function WorkOrdersPage() {
  const { data, reload } = useApi<any[]>('/workorders');
  const nav = useNavigate();
  const can = useCan();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader title="Work orders" subtitle="An accepted quotation becomes a work order; samples, reports and invoices hang off it"
        actions={can('workorder.create') && <Button onClick={() => setOpen(true)}>New work order</Button>} />
      <ListView id="workorders" rows={data} onRow={(w) => nav(`/workorders/${w.id}`)} columns={[
        { key: 'number', label: 'Number', render: (w) => <Text size="sm" fw={550}>{w.number}</Text> }, { key: 'date', label: 'Date', type: 'date' },
        { key: 'client_name', label: 'Client', filter: 'select' }, { key: 'site_name', label: 'Site', filter: 'select' }, { key: 'customer_ref', label: 'Customer ref' },
        { key: 'samples', label: 'Samples', type: 'number' }, { key: 'status', label: 'Status', type: 'status' }]} />
      {open && <NewWorkOrder onClose={(id) => { setOpen(false); if (id) { reload(); nav(`/workorders/${id}`); } }} />}
    </>
  );
}

function NewWorkOrder({ onClose }: { onClose: (id?: number) => void }) {
  const { data: clients } = useApi<any[]>('/clients');
  const [clientId, setClientId] = useState<string | null>(null);
  const { data: client } = useApi<any>(clientId ? `/clients/${clientId}` : null, [clientId]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [ref, setRef] = useState('');
  const save = async () => { const r = await api<any>('/workorders', { body: { client_id: Number(clientId), site_id: siteId ? Number(siteId) : null, customer_ref: ref, date: localToday() } }); ok(`Work order ${r.number} created`); onClose(r.id); };
  return (
    <Modal opened onClose={() => onClose()} title="New work order (without quotation)">
      <Stack>
        <Select label="Client" searchable data={(clients ?? []).map((c) => ({ value: String(c.id), label: c.name }))} value={clientId} onChange={setClientId} />
        {client && <Select label="Site" clearable data={client.sites.map((s: any) => ({ value: String(s.id), label: s.name }))} value={siteId} onChange={setSiteId} />}
        <TextInput label="Customer reference / PO" value={ref} onChange={(e) => setRef(e.currentTarget.value)} />
        <Group justify="flex-end"><Button disabled={!clientId} onClick={save}>Create</Button></Group>
      </Stack>
    </Modal>
  );
}

export function WorkOrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const can = useCan();
  const { data: wo, reload } = useApi<any>(`/workorders/${id}`, [id]);
  const [newSample, setNewSample] = useState(false);
  if (!wo) return <Loading />;
  const quoteLines = (wo.quote?.data?.lines ?? []) as any[];
  const invoice = async () => { const r = await api<any>(`/workorders/${wo.id}/invoice`, { method: 'POST' }); nav(`/documents/${r.id}`); };
  const docs = wo.documents.filter((d: any) => d.status !== 'cancelled');
  const tests = wo.samples.flatMap((s: any) => s.tests);
  const doneT = tests.filter((t: any) => ['accepted', 'reported'].includes(t.status)).length;
  const invoiced = docs.filter((d: any) => d.kind === 'invoice' && d.status !== 'draft').reduce((a: number, d: any) => a + Number(d.total || 0), 0);
  const quoted = docs.find((d: any) => d.kind === 'quote')?.total ?? wo.quote?.total;
  const KIND: Record<string, string> = { quote: 'Quotation', invoice: 'Invoice', report: 'Test report' };
  const side = <>
    <Block title="Details">
      <Facts items={[['Client', wo.client?.id ? <a className="lnk" onClick={() => nav(`/clients/${wo.client.id}`)}>{wo.client.name}</a> : wo.client?.name], ['Site', wo.site?.name], ['Date', dmy(wo.date)], ['Customer ref', wo.customer_ref],
        ['Quotation', wo.quote ? <a className="lnk" onClick={() => nav(`/documents/${wo.quote.id}`)}>{wo.quote.number}</a> : 'Without quotation']]} />
    </Block>
    {quoteLines.length > 0 && <Block title="Quoted scope" count={quoteLines.length}>
      <ol className="wo-scope">{quoteLines.map((l, i) => <li key={i}><span>{l.description}</span><small className="tnum">₹{money(l.rate)} {l.unit}{l.qty ? ` × ${l.qty}` : ''}</small></li>)}</ol>
    </Block>}
    <RecordInfo object="workorder" id={wo.id} />
  </>;
  return (
    <RecordLayout eyebrow="Work order" title={wo.number} fav={{ kind: 'workorder', sub: wo.client?.name }}
      meta={<>{wo.client?.name && <span>{wo.client.name}{wo.site ? ` · ${wo.site.name}` : ''}</span>}<span className="tnum">{dmy(wo.date)}</span><StatusBadge status={wo.status} /></>}
      actions={<>
        {can('invoice.create') && <Button variant="default" onClick={invoice}>Invoice tested work</Button>}
        {can('sample.create') && <Button leftSection={<IconPlus size={16} />} onClick={() => setNewSample(true)}>Register sample</Button>}
        <AdminDelete object="workorder" id={wo.id} compact onDeleted={() => nav('/workorders')} />
      </>}
      stats={[
        { label: 'Samples', value: wo.samples.length, hint: wo.samples.length ? `${wo.samples.filter((x: any) => x.status === 'reported').length} reported` : 'None yet' },
        { label: 'Tests done', value: tests.length ? `${doneT} / ${tests.length}` : '0', hint: tests.length ? `${Math.round((100 * doneT) / tests.length)}% accepted or reported` : 'No tests yet' },
        { label: 'Quoted', value: quoted ? `₹${money(quoted)}` : '–', hint: wo.quote ? wo.quote.number : 'No quotation' },
        { label: 'Invoiced', value: `₹${money(invoiced)}`, hint: `${docs.filter((d: any) => d.kind === 'invoice').length} ${docs.filter((d: any) => d.kind === 'invoice').length === 1 ? 'invoice' : 'invoices'}` },
      ]} side={side}>
      <div className="blk-head"><b>Samples and tests</b><span>{wo.samples.length}</span></div>
      {wo.samples.length === 0 ? <div className="card"><Empty title="No samples yet" action={can('sample.create') && <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={() => setNewSample(true)}>Register sample</Button>}>Register a sample when material arrives or is collected at site.</Empty></div> : (
        <div className="wo-samples">
          {wo.samples.map((s: any) => (
            <section key={s.id} className="card wo-sample">
              <header><a className="lnk tnum" style={{ fontWeight: 600 }} onClick={() => nav(`/samples?open=${s.id}`)}>{s.code}</a><span className="wo-sub">{s.material} · received {dmy(s.received_date)}</span><StatusBadge status={s.status} /></header>
              {s.tests.map((t: any) => { const ok2 = ['accepted', 'reported'].includes(t.status); return (
                <a key={t.id} className="qv-row" onClick={() => nav(`/tests/${t.id}`)} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/tests/${t.id}`)}>
                  <span className={`qv-tick${ok2 ? ' on' : ''}`}>{ok2 && <IconCheck size={12} stroke={2.6} />}</span>
                  <span className="qv-row-t" style={{ flex: 1, minWidth: 0 }}>{t.report_name || t.billing_name}</span>
                  <StatusBadge status={t.status} />
                </a>); })}
            </section>
          ))}
        </div>
      )}
      <div className="blk-head" style={{ marginTop: 22 }}><b>Documents</b><span>{docs.length}</span></div>
      <ListView id="wo-docs" embedded rows={docs} onRow={(d) => nav(`/documents/${d.id}`)} empty="No quotations, reports or invoices yet." columns={[
        { key: 'kind', label: 'Type', value: (d) => KIND[d.kind] ?? d.kind }, { key: 'number', label: 'Number', value: (d) => d.number || '(draft)' },
        { key: 'date', label: 'Date', type: 'date' }, { key: 'total', label: 'Amount', align: 'right', value: (d) => (d.total ? `₹${money(d.total)}` : '') }, { key: 'status', label: 'Status', type: 'status' }]} />
      {newSample && <NewSampleModal preset={{ work_order_id: wo.id, client_id: wo.client_id, site_id: wo.site_id, customer_ref: wo.customer_ref, quoteCatalogIds: quoteLines.map((l) => l.catalogId).filter(Boolean), accreditation: wo.quote?.data?.accreditation ?? undefined }} onClose={(saved) => { setNewSample(false); if (saved) reload(); }} />}
    </RecordLayout>
  );
}
