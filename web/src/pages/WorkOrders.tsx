import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Group, Paper, Text, Stack, Badge, Modal, Select, TextInput } from '@mantine/core';
import { api, dmy, money, ok, useApi, localToday } from '../api';
import { PageHeader, SimpleTable, StatusBadge, Loading } from '../components/ui';
import { NewSampleModal } from './Samples';

export function WorkOrdersPage() {
  const { data, reload } = useApi<any[]>('/workorders');
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader title="Work orders" subtitle="An accepted quotation becomes a work order; samples, reports and invoices hang off it"
        actions={<Button onClick={() => setOpen(true)}>New work order</Button>} />
      <SimpleTable head={['Number', 'Date', 'Client', 'Site', 'Customer ref', 'Samples', 'Status']}
        rows={(data ?? []).map((w) => [<Text size="sm" fw={500}>{w.number}</Text>, dmy(w.date), w.client_name, w.site_name, w.customer_ref, w.samples, <StatusBadge status={w.status} />])}
        onRow={(i) => nav(`/workorders/${data![i].id}`)} />
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
  const { data: wo, reload } = useApi<any>(`/workorders/${id}`, [id]);
  const [newSample, setNewSample] = useState(false);
  if (!wo) return <Loading />;
  const quoteLines = (wo.quote?.data?.lines ?? []) as any[];
  const invoice = async () => { const r = await api<any>(`/workorders/${wo.id}/invoice`, { method: 'POST' }); nav(`/documents/${r.id}`); };
  return (
    <>
      <PageHeader title={`Work order ${wo.number}`} subtitle={<>{wo.client?.name}{wo.site ? ` · ${wo.site.name}` : ''} · {dmy(wo.date)}{wo.customer_ref ? ` · Ref: ${wo.customer_ref}` : ''}</>}
        actions={<>
          {wo.quote && <Button variant="default" onClick={() => nav(`/documents/${wo.quote.id}`)}>Quotation {wo.quote.number}</Button>}
          <Button variant="default" onClick={invoice}>Invoice tested work</Button>
          <Button onClick={() => setNewSample(true)}>Register sample</Button>
        </>} />
      {quoteLines.length > 0 && (
        <Paper withBorder p="sm" mb="md">
          <Text size="sm" fw={600} mb={4}>Quoted scope</Text>
          {quoteLines.map((l, i) => <Text key={i} size="sm">{i + 1}. {l.description} – ₹{money(l.rate)} {l.unit}{l.qty ? ` × ${l.qty}` : ''}</Text>)}
        </Paper>
      )}
      <Text fw={600} mb="xs">Samples and tests</Text>
      <Stack gap="sm">
        {wo.samples.length === 0 && <Paper withBorder p="md"><Text size="sm" c="dimmed">No samples yet. Use “Register sample” when material arrives or is collected at site.</Text></Paper>}
        {wo.samples.map((s: any) => (
          <Paper key={s.id} withBorder p="sm">
            <Group justify="space-between"><Text fw={600}>{s.code} <Text span size="sm" c="dimmed">· {s.material} · received {dmy(s.received_date)}{s.ulr ? ` · ULR ${s.ulr}` : ''}</Text></Text><StatusBadge status={s.status} /></Group>
            <Group gap="xs" mt={6}>{s.tests.map((t: any) => <Badge key={t.id} variant="light" style={{ cursor: 'pointer', textTransform: 'none' }} onClick={() => nav(`/tests/${t.id}`)} color={t.status === 'reported' ? 'teal' : t.status === 'accepted' ? 'green' : t.status === 'returned' ? 'red' : t.status === 'submitted' ? 'orange' : 'gray'}>{t.report_name || t.billing_name}: {t.status.replace('_', ' ')}</Badge>)}</Group>
          </Paper>
        ))}
      </Stack>
      <Text fw={600} mt="lg" mb="xs">Documents</Text>
      <SimpleTable head={['Type', 'Number', 'Date', 'Amount', 'Status']} rows={wo.documents.filter((d: any) => d.status !== 'cancelled').map((d: any) => [d.kind, d.number || '(draft)', dmy(d.date), d.total ? `₹${money(d.total)}` : '', <StatusBadge status={d.status} />])}
        onRow={(i) => nav(`/documents/${wo.documents.filter((d: any) => d.status !== 'cancelled')[i].id}`)} />
      {newSample && <NewSampleModal preset={{ work_order_id: wo.id, client_id: wo.client_id, site_id: wo.site_id, customer_ref: wo.customer_ref, quoteCatalogIds: quoteLines.map((l) => l.catalogId).filter(Boolean) }} onClose={(saved) => { setNewSample(false); if (saved) reload(); }} />}
    </>
  );
}
