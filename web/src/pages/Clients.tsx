import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ClientActivity } from './FollowUps';
import { Button, Group, Modal, Paper, Stack, Tabs, Text, Badge, Timeline, MultiSelect, Select, Anchor, SimpleGrid, ActionIcon, Menu } from '@mantine/core';
import { IconPlus, IconPencil, IconDots } from '@tabler/icons-react';
import { INDIAN_STATES, validateGstin } from '@suite/shared';
import { api, money, ok, useApi } from '../api';
import { useCan, useFields } from '../ctx';
import { PageHeader, Loading, Kpi } from '../components/ui';
import { ListView, useCustomCols, type Col } from '../components/ListView';
import { RecordForm, missingRequired } from '../components/RecordForm';

export function ClientForm({ initial, onSaved, onCancel }: { initial?: any; onSaved: (id: number) => void; onCancel: () => void }) {
  const [v, setV] = useState<any>({ type: 'company', payment_terms_days: 30, opening_balance: 0, ...initial });
  const [busy, setBusy] = useState(false);
  const fields = useFields('client');
  const g = v.gstin ? validateGstin(v.gstin) : null;
  const change = (n: any) => {
    const gg = n.gstin ? validateGstin(n.gstin) : null;
    if (gg?.ok && n.gstin !== v.gstin) n = { ...n, state_code: gg.state, pan: n.pan || n.gstin.slice(2, 12).toUpperCase() };
    setV(n);
  };
  const missing = missingRequired(fields as never, v);
  const save = async (force = false) => {
    setBusy(true);
    try {
      const { id, sites, contacts, documents, workOrders, samples, ledger, timeline, data, company_id, created_at, ...body } = v;
      if (initial?.id) { await api(`/clients/${initial.id}`, { method: 'PUT', body }); onSaved(initial.id); }
      else { const r = await api<{ id: number }>(`/clients${force ? '?force=1' : ''}`, { body }); onSaved(r.id); }
      ok('Client saved');
    } catch (e: any) {
      if (e.status === 409 && window.confirm(`${e.message}. Create anyway?`)) await save(true);
    } finally { setBusy(false); }
  };
  return (
    <Stack>
      <RecordForm object="client" value={v} onChange={change} errors={g && !g.ok ? { gstin: g.message! } : undefined} />
      {g?.ok && <Text size="xs" c="teal">GSTIN valid – state and PAN filled in.</Text>}
      <Group justify="flex-end"><Button variant="default" onClick={onCancel}>Cancel</Button><Button loading={busy} onClick={() => save()} disabled={missing.length > 0 || (g ? !g.ok : false)}>Save client</Button></Group>
    </Stack>
  );
}

export function ClientsPage() {
  const [sp, setSp] = useSearchParams();
  const { data } = useApi<any[]>('/clients');
  const nav = useNavigate();
  const can = useCan();
  const custom = useCustomCols('client');
  const cols: Col[] = [
    { key: 'name', label: 'Client', render: (r) => <Text size="sm" fw={550}>{r.name}</Text> },
    { key: 'short_code', label: 'Code' },
    { key: 'gstin', label: 'GSTIN' },
    { key: 'state', label: 'State', value: (r) => INDIAN_STATES.find((s) => s.code === r.state_code)?.name ?? '', filter: 'select' },
    { key: 'type', label: 'Type', type: 'badge' },
    { key: 'sites', label: 'Sites', type: 'number' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email', hidden: true },
    { key: 'payment_terms_days', label: 'Terms (days)', type: 'number', hidden: true },
    ...custom,
  ];
  return (
    <>
      <PageHeader title="Clients" subtitle="Companies, their sites and contacts" actions={can('client.create') && <Button leftSection={<IconPlus size={16} />} onClick={() => setSp({ new: '1' })}>New client</Button>} />
      <ListView id="clients" rows={data} columns={cols} onRow={(r) => nav(`/clients/${r.id}`)} empty="No clients yet – add your first client." />
      <Modal opened={sp.get('new') === '1'} onClose={() => setSp({})} title="New client" size="xl">
        <ClientForm onCancel={() => setSp({})} onSaved={(id) => { setSp({}); nav(`/clients/${id}`); }} />
      </Modal>
    </>
  );
}

function SiteModal({ clientId, site, onClose }: { clientId: number; site?: any; onClose: (saved: boolean) => void }) {
  const [v, setV] = useState<any>(site ?? {});
  const save = async () => {
    const { id, company_id, client_id, created_at, data, ...body } = v;
    if (site?.id) await api(`/sites/${site.id}`, { method: 'PUT', body }); else await api(`/clients/${clientId}/sites`, { body });
    ok('Site saved'); onClose(true);
  };
  return (
    <Modal opened onClose={() => onClose(false)} title={site?.id ? 'Edit site' : 'Add site / project'} size="lg">
      <Stack><RecordForm object="site" value={v} onChange={setV} /><Group justify="flex-end"><Button onClick={save} disabled={!v.name}>Save</Button></Group></Stack>
    </Modal>
  );
}
function ContactModal({ clientId, sites, contact, onClose }: { clientId: number; sites: any[]; contact?: any; onClose: (saved: boolean) => void }) {
  const [v, setV] = useState<any>(contact ?? { receives: [] });
  const save = async () => {
    const { id, company_id, client_id, created_at, data, ...body } = v;
    const b = { ...body, site_id: body.site_id ? Number(body.site_id) : null };
    if (contact?.id) await api(`/contacts/${contact.id}`, { method: 'PUT', body: b }); else await api(`/clients/${clientId}/contacts`, { body: b });
    ok('Contact saved'); onClose(true);
  };
  return (
    <Modal opened onClose={() => onClose(false)} title={contact?.id ? 'Edit contact' : 'Add contact'} size="lg">
      <Stack>
        <RecordForm object="contact" value={v} onChange={setV} />
        <SimpleGrid cols={2}>
          <Select label="Site" clearable placeholder="All sites" data={sites.map((s) => ({ value: String(s.id), label: s.name }))} value={v.site_id ? String(v.site_id) : null} onChange={(x) => setV({ ...v, site_id: x })} />
          <MultiSelect label="Receives" data={[{ value: 'quote', label: 'Quotations' }, { value: 'report', label: 'Reports' }, { value: 'invoice', label: 'Invoices' }]} value={v.receives ?? []} onChange={(x) => setV({ ...v, receives: x })} />
        </SimpleGrid>
        <Group justify="flex-end"><Button onClick={save} disabled={!v.name}>Save</Button></Group>
      </Stack>
    </Modal>
  );
}

export function ClientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const can = useCan();
  const { data: c, reload } = useApi<any>(`/clients/${id}`, [id]);
  const fields = useFields('client');
  const [edit, setEdit] = useState(false);
  const [site, setSite] = useState<any>(null);
  const [contact, setContact] = useState<any>(null);
  if (!c) return <Loading />;
  const docs = (k: string) => c.documents.filter((d: any) => d.kind === k && d.status !== 'cancelled');
  const highlight = fields.filter((f) => !['name', 'address', 'notes'].includes(f.key)).slice(0, 8);
  const show = (f: any) => { const v = f.custom ? c.custom?.[f.key] : c[f.key]; if (f.type === 'state') return INDIAN_STATES.find((s) => s.code === v)?.name; if (f.type === 'currency') return v !== null && v !== undefined ? `₹${money(v)}` : ''; if (f.type === 'checkbox') return v ? 'Yes' : 'No'; return v; };
  return (
    <>
      <PageHeader eyebrow="Client" title={c.name} subtitle={c.address}
        actions={<>
          {can('client.edit') && <Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setEdit(true)}>Edit</Button>}
          {can('sample.create') && <Button variant="default" onClick={() => nav(`/samples?new=1&client=${c.id}`)}>Register sample</Button>}
          {can('quote.create') && <Button onClick={() => nav(`/quotes/new?client=${c.id}`)}>New quotation</Button>}
          {can('client.delete') && <Menu position="bottom-end"><Menu.Target><ActionIcon variant="default" size="lg"><IconDots size={16} /></ActionIcon></Menu.Target><Menu.Dropdown>
            <Menu.Item color="red" onClick={async () => { if (window.confirm('Delete this client? Only possible when it has no documents or samples.')) { await api(`/clients/${c.id}`, { method: 'DELETE' }); nav('/clients'); } }}>Delete client</Menu.Item>
          </Menu.Dropdown></Menu>}
        </>} />
      <Paper withBorder p="md" mb="md">
        <SimpleGrid cols={{ base: 2, md: 4 }} spacing="xs">
          {highlight.map((f) => <div key={f.key}><Text size="xs" c="dimmed">{f.label}</Text><Text size="sm" fw={500}>{show(f) || '—'}</Text></div>)}
        </SimpleGrid>
      </Paper>
      <SimpleGrid cols={{ base: 2, md: 4 }} mb="md" spacing="sm">
        <Kpi label="Balance due" value={`₹${money(c.ledger.balance)}`} color={c.ledger.balance > 0 ? '#b42318' : undefined} onClick={() => nav(`/ledger/${c.id}`)} />
        <Kpi label="Sites" value={c.sites.length} />
        <Kpi label="Samples" value={c.samples.length} />
        <Kpi label="Invoiced (all time)" value={`₹${money(docs('invoice').filter((d: any) => d.status !== 'draft').reduce((a: number, d: any) => a + d.total, 0))}`} />
      </SimpleGrid>
      <Tabs defaultValue={new URLSearchParams(window.location.search).get('tab') ?? 'sites'} keepMounted={false}>
        <Tabs.List mb="sm">
          <Tabs.Tab value="sites">Sites & contacts</Tabs.Tab>
          <Tabs.Tab value="quotes">Quotations <Badge size="xs" variant="light">{docs('quote').length}</Badge></Tabs.Tab>
          <Tabs.Tab value="samples">Samples & reports</Tabs.Tab>
          <Tabs.Tab value="invoices">Invoices</Tabs.Tab>
          <Tabs.Tab value="ledger">Ledger</Tabs.Tab>
          <Tabs.Tab value="activity">Follow-ups</Tabs.Tab>
          <Tabs.Tab value="timeline">Timeline</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="sites">
          <Group justify="space-between" mb="xs"><Text fw={600}>Sites / projects</Text>{can('client.edit') && <Button size="xs" variant="light" onClick={() => setSite({})}>Add site</Button>}</Group>
          <ListView id={`client-sites`} rows={c.sites} onRow={(r) => setSite(r)} columns={[{ key: 'name', label: 'Site' }, { key: 'project', label: 'Project' }, { key: 'po_number', label: 'PO / WO no.' }, { key: 'address', label: 'Address' }]} />
          <Group justify="space-between" mt="lg" mb="xs"><Text fw={600}>Contacts</Text>{can('client.edit') && <Button size="xs" variant="light" onClick={() => setContact({ receives: [] })}>Add contact</Button>}</Group>
          <ListView id={`client-contacts`} rows={c.contacts} onRow={(r) => setContact(r)} columns={[{ key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
            { key: 'site', label: 'Site', value: (p) => c.sites.find((s: any) => s.id === p.site_id)?.name ?? 'All sites' }, { key: 'receives', label: 'Receives', value: (p) => (p.receives ?? []).join(', ') }]} />
        </Tabs.Panel>
        <Tabs.Panel value="quotes">
          <ListView id="client-quotes" rows={docs('quote')} onRow={(d) => nav(`/documents/${d.id}`)} columns={[{ key: 'number', label: 'Number' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'accreditation', label: 'Type', type: 'badge' }, { key: 'site', label: 'Site', value: (d) => c.sites.find((s: any) => s.id === d.site_id)?.name }, { key: 'total', label: 'Value', type: 'money' }, { key: 'status', label: 'Status', type: 'status' }]} />
        </Tabs.Panel>
        <Tabs.Panel value="samples">
          <ListView id="client-samples" rows={c.samples} onRow={(s) => nav(`/samples?open=${s.id}`)} columns={[{ key: 'code', label: 'Job code' }, { key: 'accreditation', label: 'Type', type: 'badge' }, { key: 'material', label: 'Material', filter: 'select' }, { key: 'received_date', label: 'Received', type: 'date' }, { key: 'site', label: 'Site', value: (s) => c.sites.find((x: any) => x.id === s.site_id)?.name }, { key: 'status', label: 'Status', type: 'status' }]} />
          <Text fw={600} mt="lg" mb="xs">Reports</Text>
          <ListView id="client-reports" rows={docs('report')} onRow={(d) => nav(`/documents/${d.id}`)} columns={[{ key: 'number', label: 'Number', value: (d) => d.number || '(draft)' }, { key: 'accreditation', label: 'Type', type: 'badge' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'status', label: 'Status', type: 'status' }]} />
        </Tabs.Panel>
        <Tabs.Panel value="invoices">
          <ListView id="client-invoices" rows={docs('invoice')} onRow={(d) => nav(`/documents/${d.id}`)} columns={[{ key: 'number', label: 'Number', value: (d) => d.number || '(draft)' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'accreditation', label: 'Type', type: 'badge' }, { key: 'total', label: 'Amount', type: 'money' }, { key: 'status', label: 'Status', type: 'status' }]} />
        </Tabs.Panel>
        <Tabs.Panel value="ledger">
          <Group justify="flex-end" mb="xs"><Anchor size="sm" onClick={() => nav(`/ledger/${c.id}`)}>Open printable statement of account</Anchor></Group>
          <ListView id="client-ledger" rows={[{ date: '', type: 'Opening balance', ref: '', debit: null, credit: null, balance: c.ledger.opening }, ...c.ledger.entries]} columns={[
            { key: 'date', label: 'Date', type: 'date' }, { key: 'type', label: 'Particulars' }, { key: 'ref', label: 'Ref' },
            { key: 'debit', label: 'Debit', type: 'money' }, { key: 'credit', label: 'Credit', type: 'money' }, { key: 'balance', label: 'Balance', render: (e) => `₹${money(e.balance, 2)}`, align: 'right' }]} />
        </Tabs.Panel>
        <Tabs.Panel value="activity"><ClientActivity clientId={Number(id)} /></Tabs.Panel>
        <Tabs.Panel value="timeline">
          <Paper withBorder p="md"><Timeline bulletSize={14} lineWidth={2}>
            {c.timeline.map((t: any) => <Timeline.Item key={t.id} title={<Text size="sm">{t.action}</Text>}><Text size="xs" c="dimmed">{t.user} · {new Date(t.at).toLocaleString('en-IN')} · {t.entity} #{t.entity_id}</Text></Timeline.Item>)}
          </Timeline>{!c.timeline.length && <Text size="sm" c="dimmed">No activity yet</Text>}</Paper>
        </Tabs.Panel>
      </Tabs>
      <Modal opened={edit} onClose={() => setEdit(false)} title="Edit client" size="xl"><ClientForm initial={c} onCancel={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} /></Modal>
      {site && <SiteModal clientId={c.id} site={site.id ? site : undefined} onClose={(s) => { setSite(null); if (s) reload(); }} />}
      {contact && <ContactModal clientId={c.id} sites={c.sites} contact={contact.id ? contact : undefined} onClose={(s) => { setContact(null); if (s) reload(); }} />}
    </>
  );
}
