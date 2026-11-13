import { ExtraFieldsEditor } from '../components/ExtraFields';
import { FormSheet } from '../components/Sheet';
import { useEffect, useState } from 'react';
import { trackRecent } from '../favorites';
import { SharingButton, SharingModal } from '../components/Sharing';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ClientActivity } from './FollowUps';
import { Button, Group, Modal, Paper, Stack, Tabs, Text, Timeline, MultiSelect, Select, Anchor, SimpleGrid, ActionIcon, Menu, Tooltip } from '@mantine/core';
import { IconPlus, IconPencil, IconDots, IconUpload, IconHistory, IconBook2, IconTrash } from '@tabler/icons-react';
import { RecordLayout, Block } from '../components/Record';
import { Facts, FormSection, Sheet } from '../components/Sheet';
import { ClientImport } from './ClientImport';
import { INDIAN_STATES, validateGstin } from '@suite/shared';
import { api, money, ok, useApi } from '../api';
import { useCan, useFields } from '../ctx';
import { PageHeader, Loading, Kpi } from '../components/ui';
import { WhatsAppButton, WhatsAppIcon, WhatsAppModal } from '../components/WhatsApp';
import { ListView, useCustomCols, type Col } from '../components/ListView';
import { RecordForm, missingRequired } from '../components/RecordForm';
import { AdminDelete, RecordInfo } from '../components/RecordAdmin';

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
  const A = ['name', 'short_code', 'type', 'gstin', 'state_code', 'pan'], B = ['email', 'phone', 'address', 'payment_terms_days', 'discount_pct', 'opening_balance'];
  const errors = g && !g.ok ? { gstin: g.message! } : undefined;
  return (
    <Sheet title={initial?.id ? 'Edit client' : 'New client'} subtitle={initial?.id ? initial.name : 'Sites and contacts are added on the client page after saving.'} onClose={onCancel}
      footer={<>
        <span className="grow">{missing.length ? `Still needed: ${missing.slice(0, 4).join(', ')}` : g?.ok ? 'GSTIN valid – state and PAN filled in.' : ''}</span>
        <Button variant="subtle" color="gray" onClick={onCancel}>Cancel</Button>
        <Button loading={busy} onClick={() => save()} disabled={missing.length > 0 || (g ? !g.ok : false)}>Save client</Button>
      </>}>
      <FormSection n={1} title="Identity & tax" hint="As printed on quotations, reports and invoices"><RecordForm object="client" value={v} onChange={change} only={A} errors={errors} /></FormSection>
      <FormSection n={2} title="Contact & billing"><RecordForm object="client" value={v} onChange={change} only={B} /></FormSection>
      <FormSection n={3} title="More details" hint="Notes and your own fields" collapsible><RecordForm object="client" value={v} onChange={change} exclude={[...A, ...B]} /></FormSection>
    </Sheet>
  );
}

export function ClientsPage() {
  const [sp, setSp] = useSearchParams();
  const { data, reload } = useApi<any[]>('/clients');
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
      <PageHeader title="Clients" subtitle="Companies, their sites and contacts" actions={can('client.create') && <>
        <Button variant="default" leftSection={<IconUpload size={16} />} onClick={() => setSp({ import: '1' })}>Import</Button>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setSp({ new: '1' })}>New client</Button></>} />
      {sp.get('import') === '1' && <ClientImport onClose={(done) => { setSp({}); if (done) reload(); }} />}
      <ListView id="clients" rows={data} columns={cols} onRow={(r) => nav(`/clients/${r.id}`)} empty="No clients yet – add your first client, or use Import to bring in your list from Excel." />
      {sp.get('new') === '1' && <ClientForm onCancel={() => setSp({})} onSaved={(id) => { setSp({}); nav(`/clients/${id}`); }} />}
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
    <FormSheet opened onClose={() => onClose(false)} title={site?.id ? 'Edit site' : 'Add site / project'} size="lg">
      <Stack><RecordForm object="site" value={v} onChange={setV} /><Group className="form-actions" justify="flex-end"><Button onClick={save} disabled={!v.name}>Save</Button></Group></Stack>
    </FormSheet>
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
    <FormSheet opened onClose={() => onClose(false)} title={contact?.id ? 'Edit contact' : 'Add contact'} size="lg">
      <Stack>
        <RecordForm object="contact" value={v} onChange={setV} />
        <SimpleGrid cols={2}>
          <Select label="Site" clearable placeholder="All sites" data={sites.map((s) => ({ value: String(s.id), label: s.name }))} value={v.site_id ? String(v.site_id) : null} onChange={(x) => setV({ ...v, site_id: x })} />
          <MultiSelect label="Receives" data={[{ value: 'quote', label: 'Quotations' }, { value: 'report', label: 'Reports' }, { value: 'invoice', label: 'Invoices' }]} value={v.receives ?? []} onChange={(x) => setV({ ...v, receives: x })} />
        </SimpleGrid>
        <Group className="form-actions" justify="flex-end"><Button onClick={save} disabled={!v.name}>Save</Button></Group>
      </Stack>
    </FormSheet>
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
  const [wa, setWa] = useState<null | { phone?: string; name?: string }>(null);
  const [shareOpen, setShareOpen] = useState(false);
  useEffect(() => { if (c?.id) trackRecent({ to: `/clients/${c.id}`, label: c.name, sub: 'Client', kind: 'client' }); }, [c?.id]);
  if (!c) return <Loading />;
  const openInv = c.documents.filter((d: any) => d.kind === 'invoice' && ['issued', 'partly_paid'].includes(d.status));
  const docs = (k: string) => c.documents.filter((d: any) => d.kind === k && d.status !== 'cancelled');
  const highlight = fields.filter((f) => !['name', 'address', 'notes'].includes(f.key)).slice(0, 8);
  const show = (f: any) => { const v = f.custom ? c.custom?.[f.key] : c[f.key]; if (f.type === 'state') return INDIAN_STATES.find((s) => s.code === v)?.name; if (f.type === 'currency') return v !== null && v !== undefined ? `₹${money(v)}` : ''; if (f.type === 'checkbox') return v ? 'Yes' : 'No'; return v; };
  const invoiced = docs('invoice').filter((d: any) => d.status !== 'draft').reduce((a: number, d: any) => a + d.total, 0);
  const inTest = c.samples.filter((x: any) => ['registered', 'in_test'].includes(x.status)).length;
  const canEdit = can('client.edit') && c.access !== 'read';
  const side = <>
    <Block title="Details" action={canEdit && <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconPencil size={13} />} onClick={() => setEdit(true)}>Edit</Button>}>
      <Facts items={[...highlight.map((f) => [f.label, show(f)] as [string, any]), ['Address', c.address], ['Owner', c.owner_name], ['Notes', c.notes]]} />
    </Block>
    <Block title="Recent activity">
      {c.timeline.slice(0, 6).map((t: any, i: number, arr: any[]) => (
        <div key={t.id} className="act"><div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}><span className="act-ic"><IconHistory size={13} /></span>{i < arr.length - 1 && <span className="act-line" />}</div>
          <div style={{ minWidth: 0 }}><div className="act-t">{t.action}</div><div className="act-s">{t.user} · {new Date(t.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></div></div>
      ))}
      {!c.timeline.length && <Text size="xs" c="dimmed">No activity yet.</Text>}
    </Block>
    <RecordInfo object="client" id={c.id} />
  </>;
  return (
    <RecordLayout initials={c.name.replace(/^(M\/s\.?|Mr\.?|Ms\.?)\s+/i, '').split(/\s+/).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()} eyebrow="Client" title={c.name} fav={{ kind: 'client', sub: 'Client' }}
      meta={<>{c.short_code && <span>{c.short_code}</span>}{c.gstin && <span className="tnum">GSTIN {c.gstin}</span>}{c.phone && <span className="tnum">{c.phone}</span>}{c.payment_terms_days ? <span>Credit {c.payment_terms_days} days</span> : null}</>}
      actions={<>
        <SharingButton access={c.access} onClick={() => setShareOpen(true)} />
        <WhatsAppButton variant="default" onClick={() => setWa({})} />
        {can('sample.create') && <Button variant="default" onClick={() => nav(`/samples?new=1&client=${c.id}`)}>Register sample</Button>}
        {can('quote.create') && <Button leftSection={<IconPlus size={16} />} onClick={() => nav(`/quotes/new?client=${c.id}`)}>New quotation</Button>}
        <AdminDelete object="client" id={c.id} compact onDeleted={() => nav('/clients')} />
        {(canEdit || can('client.delete')) && <Menu position="bottom-end" width={200}><Menu.Target><Tooltip label="More actions"><ActionIcon variant="default" size={36} aria-label="More actions"><IconDots size={16} /></ActionIcon></Tooltip></Menu.Target><Menu.Dropdown>
          {canEdit && <Menu.Item leftSection={<IconPencil size={15} />} onClick={() => setEdit(true)}>Edit client</Menu.Item>}
          <Menu.Item leftSection={<IconBook2 size={15} />} onClick={() => nav(`/ledger/${c.id}`)}>Statement of account</Menu.Item>
          {can('client.delete') && <><Menu.Divider /><Menu.Item color="red" leftSection={<IconTrash size={15} />} onClick={async () => { if (window.confirm('Delete this client? Only possible when it has no documents or samples.')) { await api(`/clients/${c.id}`, { method: 'DELETE' }); nav('/clients'); } }}>Delete client</Menu.Item></>}
        </Menu.Dropdown></Menu>}
      </>}
      stats={[
        { label: 'Balance due', value: `₹${money(c.ledger.balance)}`, tone: c.ledger.balance > 0 ? 'bad' : undefined, hint: openInv.length ? `${openInv.length} open ${openInv.length === 1 ? 'invoice' : 'invoices'}` : 'Nothing outstanding', onClick: () => nav(`/ledger/${c.id}`) },
        { label: 'Invoiced (all time)', value: `₹${money(invoiced)}`, hint: `${docs('invoice').length} ${docs('invoice').length === 1 ? 'invoice' : 'invoices'}` },
        { label: 'Samples', value: c.samples.length, hint: inTest ? `${inTest} in testing now` : 'None in testing' },
        { label: 'Sites', value: c.sites.length, hint: `${c.contacts.length} ${c.contacts.length === 1 ? 'contact' : 'contacts'}` },
      ]} side={side}>
      {shareOpen && <SharingModal object="client" id={c.id} title={c.name} onClose={(ch) => { setShareOpen(false); if (ch) reload(); }} />}
      {wa && <WhatsAppModal context={c.ledger.balance > 0 ? 'reminder' : 'client'} clientId={c.id} preferred={wa} title={`WhatsApp ${c.name}`}
        vars={{ client: c.name, balance: money(c.ledger.balance, 2), number: openInv.map((d: any) => d.number).slice(0, 5).join(', ') }} onClose={(sent) => { setWa(null); if (sent) reload(); }} />}
      <Tabs defaultValue={new URLSearchParams(window.location.search).get('tab') ?? 'sites'} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="sites">Sites & contacts</Tabs.Tab>
          <Tabs.Tab value="quotes" rightSection={<span className="cnt">{docs('quote').length}</span>}>Quotations</Tabs.Tab>
          <Tabs.Tab value="samples" rightSection={<span className="cnt">{c.samples.length}</span>}>Samples & reports</Tabs.Tab>
          <Tabs.Tab value="invoices" rightSection={<span className="cnt">{docs('invoice').length}</span>}>Invoices</Tabs.Tab>
          <Tabs.Tab value="ledger">Ledger</Tabs.Tab>
          <Tabs.Tab value="activity">Follow-ups</Tabs.Tab>
          <Tabs.Tab value="timeline">Timeline</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="sites">
          <div className="blk-head"><b>Sites / projects</b><span>{c.sites.length}</span>{can('client.edit') && <Button ml="auto" size="compact-sm" variant="subtle" color="gray" leftSection={<IconPlus size={14} />} onClick={() => setSite({})}>Add site</Button>}</div>
          <ListView id={`client-sites`} empty="No sites yet. Add the projects you test for." embedded rows={c.sites} onRow={(r) => setSite(r)} columns={[{ key: 'name', label: 'Site' }, { key: 'project', label: 'Project' }, { key: 'po_number', label: 'PO / WO no.' }, { key: 'address', label: 'Address' }]} />
          <div className="blk-head" style={{ marginTop: 22 }}><b>Contacts</b><span>{c.contacts.length}</span>{can('client.edit') && <Button ml="auto" size="compact-sm" variant="subtle" color="gray" leftSection={<IconPlus size={14} />} onClick={() => setContact({ receives: [] })}>Add contact</Button>}</div>
          <ListView id={`client-contacts`} empty="No contacts yet. Add who receives quotations, reports and invoices." embedded rows={c.contacts} onRow={(r) => setContact(r)} columns={[{ key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'phone', label: 'Phone', render: (p: any) => p.phone ? <Group gap={6} wrap="nowrap"><Text size="sm">{p.phone}</Text><WhatsAppIcon title={`WhatsApp ${p.name}`} onClick={() => setWa({ phone: p.phone, name: p.name })} /></Group> : '' }, { key: 'email', label: 'Email' },
            { key: 'site', label: 'Site', value: (p) => c.sites.find((s: any) => s.id === p.site_id)?.name ?? 'All sites' }, { key: 'receives', label: 'Receives', value: (p) => (p.receives ?? []).join(', ') }]} />
          <div style={{ marginTop: 18 }}><ExtraFieldsEditor clientId={c.id} canEdit={can('client.edit') && c.access !== 'read'} /></div>
        </Tabs.Panel>
        <Tabs.Panel value="quotes">
          <ListView id="client-quotes" embedded rows={docs('quote')} onRow={(d) => nav(`/documents/${d.id}`)} columns={[{ key: 'number', label: 'Number' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'accreditation', label: 'Type', type: 'badge' }, { key: 'site', label: 'Site', value: (d) => c.sites.find((s: any) => s.id === d.site_id)?.name }, { key: 'total', label: 'Value', type: 'money' }, { key: 'status', label: 'Status', type: 'status' }]} />
        </Tabs.Panel>
        <Tabs.Panel value="samples">
          <ListView id="client-samples" embedded rows={c.samples} onRow={(s) => nav(`/samples?open=${s.id}`)} columns={[{ key: 'code', label: 'Job code' }, { key: 'accreditation', label: 'Type', type: 'badge' }, { key: 'material', label: 'Material', filter: 'select' }, { key: 'received_date', label: 'Received', type: 'date' }, { key: 'site', label: 'Site', value: (s) => c.sites.find((x: any) => x.id === s.site_id)?.name }, { key: 'status', label: 'Status', type: 'status' }]} />
          <div className="blk-head" style={{ marginTop: 22 }}><b>Reports</b><span>{docs('report').length}</span></div>
          <ListView id="client-reports" embedded rows={docs('report')} onRow={(d) => nav(`/documents/${d.id}`)} columns={[{ key: 'number', label: 'Number', value: (d) => d.number || '(draft)' }, { key: 'accreditation', label: 'Type', type: 'badge' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'status', label: 'Status', type: 'status' }]} />
        </Tabs.Panel>
        <Tabs.Panel value="invoices">
          <ListView id="client-invoices" embedded rows={docs('invoice')} onRow={(d) => nav(`/documents/${d.id}`)} columns={[{ key: 'number', label: 'Number', value: (d) => d.number || '(draft)' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'accreditation', label: 'Type', type: 'badge' }, { key: 'total', label: 'Amount', type: 'money' }, { key: 'status', label: 'Status', type: 'status' }]} />
        </Tabs.Panel>
        <Tabs.Panel value="ledger">
          <Group justify="flex-end" mb="xs"><Anchor size="sm" onClick={() => nav(`/ledger/${c.id}`)}>Open printable statement of account</Anchor></Group>
          <ListView id="client-ledger" embedded rows={[{ date: '', type: 'Opening balance', ref: '', debit: null, credit: null, balance: c.ledger.opening }, ...c.ledger.entries]} columns={[
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
      {edit && <ClientForm initial={c} onCancel={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
      {site && <SiteModal clientId={c.id} site={site.id ? site : undefined} onClose={(s) => { setSite(null); if (s) reload(); }} />}
      {contact && <ContactModal clientId={c.id} sites={c.sites} contact={contact.id ? contact : undefined} onClose={(s) => { setContact(null); if (s) reload(); }} />}
    </RecordLayout>
  );
}
