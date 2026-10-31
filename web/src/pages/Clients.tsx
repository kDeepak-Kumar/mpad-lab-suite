import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Tabs, Text, TextInput, Textarea, Badge, Timeline, MultiSelect, Anchor } from '@mantine/core';
import { IconPlus, IconPencil } from '@tabler/icons-react';
import { INDIAN_STATES, validateGstin } from '@suite/shared';
import { api, dmy, money, ok, useApi } from '../api';
import { PageHeader, SimpleTable, StatusBadge, Loading } from '../components/ui';

const stateOptions = INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.code} – ${s.name}` }));

export function ClientForm({ initial, onSaved, onCancel }: { initial?: any; onSaved: (id: number) => void; onCancel: () => void }) {
  const [v, setV] = useState<any>({ type: 'company', payment_terms_days: 30, opening_balance: 0, ...initial });
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (x: any) => setV((o: any) => ({ ...o, [k]: x?.currentTarget ? x.currentTarget.value : x }));
  const g = v.gstin ? validateGstin(v.gstin) : null;
  useEffect(() => { if (g?.ok && g.state && v.state_code !== g.state) setV((o: any) => ({ ...o, state_code: g.state })); }, [v.gstin]);
  const save = async (force = false) => {
    setBusy(true);
    try {
      const body = { ...v, gstin: v.gstin || null, payment_terms_days: Number(v.payment_terms_days ?? 30), opening_balance: Number(v.opening_balance ?? 0) };
      if (initial?.id) { await api(`/clients/${initial.id}`, { method: 'PUT', body }); onSaved(initial.id); }
      else { const r = await api<{ id: number }>(`/clients${force ? '?force=1' : ''}`, { body }); onSaved(r.id); }
      ok('Client saved');
    } catch (e: any) {
      if (e.status === 409 && window.confirm(`${e.message}. Create anyway?`)) await save(true);
    } finally { setBusy(false); }
  };
  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput label="Client (legal) name" required value={v.name ?? ''} onChange={set('name')} data-autofocus />
        <TextInput label="Short code" description="Used in job codes, e.g. XDPL" value={v.short_code ?? ''} onChange={set('short_code')} maxLength={10} />
        <TextInput label="GSTIN" value={v.gstin ?? ''} onChange={set('gstin')} error={g && !g.ok ? g.message : undefined} description={g?.ok ? 'Valid – state and PAN filled from GSTIN' : 'Leave blank if unregistered'} />
        <Select label="State (place of supply)" data={stateOptions} searchable value={v.state_code ?? null} onChange={set('state_code')} />
        <Select label="Type" data={[{ value: 'company', label: 'Company' }, { value: 'government', label: 'Government' }, { value: 'individual', label: 'Individual' }, { value: 'walkin', label: 'Walk-in / cash' }]} value={v.type} onChange={set('type')} />
        <TextInput label="PAN" value={v.pan ?? ''} onChange={set('pan')} />
        <TextInput label="Email" value={v.email ?? ''} onChange={set('email')} />
        <TextInput label="Phone" value={v.phone ?? ''} onChange={set('phone')} />
        <NumberInput label="Payment terms (days)" value={v.payment_terms_days} onChange={set('payment_terms_days')} min={0} />
        <NumberInput label="Opening balance (₹)" description="Dues before using this system" value={v.opening_balance} onChange={set('opening_balance')} thousandSeparator="," />
      </SimpleGrid>
      <Textarea label="Billing address" autosize minRows={2} value={v.address ?? ''} onChange={set('address')} />
      <Textarea label="Notes" autosize minRows={1} value={v.notes ?? ''} onChange={set('notes')} />
      <Group justify="flex-end"><Button variant="default" onClick={onCancel}>Cancel</Button><Button loading={busy} onClick={() => save()} disabled={!v.name || (g ? !g.ok : false)}>Save client</Button></Group>
    </Stack>
  );
}

export function ClientsPage() {
  const [q, setQ] = useState('');
  const [sp, setSp] = useSearchParams();
  const { data, reload } = useApi<any[]>(`/clients?q=${encodeURIComponent(q)}`, [q]);
  const nav = useNavigate();
  const open = sp.get('new') === '1';
  return (
    <>
      <PageHeader title="Clients" subtitle="Companies, their sites and contacts" actions={<Button leftSection={<IconPlus size={16} />} onClick={() => setSp({ new: '1' })}>New client</Button>} />
      <TextInput placeholder="Search by name, GSTIN or short code" value={q} onChange={(e) => setQ(e.currentTarget.value)} mb="sm" maw={420} />
      <SimpleTable head={['Client', 'Code', 'GSTIN', 'State', 'Sites', 'Phone']}
        rows={(data ?? []).map((c) => [<Text fw={500} size="sm">{c.name}</Text>, c.short_code, c.gstin || <Text size="xs" c="dimmed">Unregistered</Text>, INDIAN_STATES.find((s) => s.code === c.state_code)?.name, c.sites, c.phone])}
        onRow={(i) => nav(`/clients/${data![i].id}`)} />
      <Modal opened={open} onClose={() => setSp({})} title="New client" size="lg">
        <ClientForm onCancel={() => setSp({})} onSaved={(id) => { setSp({}); reload(); nav(`/clients/${id}`); }} />
      </Modal>
    </>
  );
}

function SiteModal({ clientId, site, onClose }: { clientId: number; site?: any; onClose: (saved: boolean) => void }) {
  const [v, setV] = useState<any>(site ?? {});
  const save = async () => {
    if (site?.id) await api(`/sites/${site.id}`, { method: 'PUT', body: v }); else await api(`/clients/${clientId}/sites`, { body: v });
    ok('Site saved'); onClose(true);
  };
  return (
    <Modal opened onClose={() => onClose(false)} title={site?.id ? 'Edit site' : 'Add site / project'}>
      <Stack>
        <TextInput label="Site name" required value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} />
        <TextInput label="Project name" value={v.project ?? ''} onChange={(e) => setV({ ...v, project: e.currentTarget.value })} />
        <TextInput label="Client PO / work order no." value={v.po_number ?? ''} onChange={(e) => setV({ ...v, po_number: e.currentTarget.value })} />
        <Textarea label="Site address" value={v.address ?? ''} onChange={(e) => setV({ ...v, address: e.currentTarget.value })} />
        <Group justify="flex-end"><Button onClick={save} disabled={!v.name}>Save</Button></Group>
      </Stack>
    </Modal>
  );
}
function ContactModal({ clientId, sites, contact, onClose }: { clientId: number; sites: any[]; contact?: any; onClose: (saved: boolean) => void }) {
  const [v, setV] = useState<any>(contact ?? { receives: [] });
  const save = async () => {
    const body = { ...v, site_id: v.site_id ? Number(v.site_id) : null };
    if (contact?.id) await api(`/contacts/${contact.id}`, { method: 'PUT', body }); else await api(`/clients/${clientId}/contacts`, { body });
    ok('Contact saved'); onClose(true);
  };
  return (
    <Modal opened onClose={() => onClose(false)} title={contact?.id ? 'Edit contact' : 'Add contact'}>
      <Stack>
        <TextInput label="Name" required value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} />
        <TextInput label="Role" placeholder="Site engineer, accounts…" value={v.role ?? ''} onChange={(e) => setV({ ...v, role: e.currentTarget.value })} />
        <TextInput label="Phone" value={v.phone ?? ''} onChange={(e) => setV({ ...v, phone: e.currentTarget.value })} />
        <TextInput label="Email" value={v.email ?? ''} onChange={(e) => setV({ ...v, email: e.currentTarget.value })} />
        <Select label="Site (optional)" clearable data={sites.map((s) => ({ value: String(s.id), label: s.name }))} value={v.site_id ? String(v.site_id) : null} onChange={(x) => setV({ ...v, site_id: x })} />
        <MultiSelect label="Receives" data={[{ value: 'quote', label: 'Quotations' }, { value: 'report', label: 'Reports' }, { value: 'invoice', label: 'Invoices' }]} value={v.receives ?? []} onChange={(x) => setV({ ...v, receives: x })} />
        <Group justify="flex-end"><Button onClick={save} disabled={!v.name}>Save</Button></Group>
      </Stack>
    </Modal>
  );
}

export function ClientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: c, reload } = useApi<any>(`/clients/${id}`, [id]);
  const [edit, setEdit] = useState(false);
  const [site, setSite] = useState<any>(null);
  const [contact, setContact] = useState<any>(null);
  if (!c) return <Loading />;
  const docs = (k: string) => c.documents.filter((d: any) => d.kind === k && d.status !== 'cancelled');
  return (
    <>
      <PageHeader title={c.name} subtitle={<>{c.gstin ? `GSTIN ${c.gstin}` : 'Unregistered'} · {c.short_code ?? 'no code'} · {c.address}</>}
        actions={<>
          <Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setEdit(true)}>Edit</Button>
          <Button variant="default" onClick={() => nav(`/samples?new=1&client=${c.id}`)}>Register sample</Button>
          <Button onClick={() => nav(`/quotes/new?client=${c.id}`)}>New quotation</Button>
        </>} />
      <SimpleGrid cols={{ base: 2, md: 4 }} mb="md">
        <Paper withBorder p="sm"><Text size="xs" c="dimmed">Balance due</Text><Text fw={700} c={c.ledger.balance > 0 ? 'red' : undefined}>₹{money(c.ledger.balance)}</Text></Paper>
        <Paper withBorder p="sm"><Text size="xs" c="dimmed">Sites</Text><Text fw={700}>{c.sites.length}</Text></Paper>
        <Paper withBorder p="sm"><Text size="xs" c="dimmed">Samples</Text><Text fw={700}>{c.samples.length}</Text></Paper>
        <Paper withBorder p="sm"><Text size="xs" c="dimmed">Payment terms</Text><Text fw={700}>{c.payment_terms_days} days</Text></Paper>
      </SimpleGrid>
      <Tabs defaultValue="sites" keepMounted={false}>
        <Tabs.List mb="sm">
          <Tabs.Tab value="sites">Sites & contacts</Tabs.Tab>
          <Tabs.Tab value="quotes">Quotations <Badge size="xs" variant="light">{docs('quote').length}</Badge></Tabs.Tab>
          <Tabs.Tab value="samples">Samples & reports</Tabs.Tab>
          <Tabs.Tab value="invoices">Invoices</Tabs.Tab>
          <Tabs.Tab value="ledger">Ledger</Tabs.Tab>
          <Tabs.Tab value="timeline">Timeline</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="sites">
          <Group justify="space-between" mb="xs"><Text fw={600}>Sites / projects</Text><Button size="xs" variant="light" onClick={() => setSite({})}>Add site</Button></Group>
          <SimpleTable head={['Site', 'Project', 'PO / WO no.', 'Address']} rows={c.sites.map((s: any) => [s.name, s.project, s.po_number, s.address])} onRow={(i) => setSite(c.sites[i])} />
          <Group justify="space-between" mt="lg" mb="xs"><Text fw={600}>Contacts</Text><Button size="xs" variant="light" onClick={() => setContact({ receives: [] })}>Add contact</Button></Group>
          <SimpleTable head={['Name', 'Role', 'Phone', 'Email', 'Site', 'Receives']} rows={c.contacts.map((p: any) => [p.name, p.role, p.phone, p.email, c.sites.find((s: any) => s.id === p.site_id)?.name ?? 'All sites', (p.receives ?? []).join(', ')])} onRow={(i) => setContact(c.contacts[i])} />
        </Tabs.Panel>
        <Tabs.Panel value="quotes">
          <SimpleTable head={['Number', 'Date', 'Site', 'Value', 'Status']} rows={docs('quote').map((d: any) => [d.number, dmy(d.date), c.sites.find((s: any) => s.id === d.site_id)?.name, `₹${money(d.total)}`, <StatusBadge status={d.status} />])} onRow={(i) => nav(`/documents/${docs('quote')[i].id}`)} />
        </Tabs.Panel>
        <Tabs.Panel value="samples">
          <SimpleTable head={['Job code', 'Material', 'Received', 'Site', 'Status']} rows={c.samples.map((s: any) => [s.code, s.material, dmy(s.received_date), c.sites.find((x: any) => x.id === s.site_id)?.name, <StatusBadge status={s.status} />])} onRow={(i) => nav(`/samples?open=${c.samples[i].id}`)} />
          <Text fw={600} mt="lg" mb="xs">Reports</Text>
          <SimpleTable head={['Number', 'Date', 'Status']} rows={docs('report').map((d: any) => [d.number || '(draft)', dmy(d.date), <StatusBadge status={d.status} />])} onRow={(i) => nav(`/documents/${docs('report')[i].id}`)} />
        </Tabs.Panel>
        <Tabs.Panel value="invoices">
          <SimpleTable head={['Number', 'Date', 'Amount', 'Status']} rows={docs('invoice').map((d: any) => [d.number || '(draft)', dmy(d.date), `₹${money(d.total)}`, <StatusBadge status={d.status} />])} onRow={(i) => nav(`/documents/${docs('invoice')[i].id}`)} />
        </Tabs.Panel>
        <Tabs.Panel value="ledger">
          <Group justify="flex-end" mb="xs"><Anchor size="sm" onClick={() => nav(`/ledger/${c.id}`)}>Open statement of account</Anchor></Group>
          <SimpleTable head={['Date', 'Particulars', 'Ref', 'Debit', 'Credit', 'Balance']}
            rows={[[ '', 'Opening balance', '', '', '', money(c.ledger.opening, 2)], ...c.ledger.entries.map((e: any) => [dmy(e.date), e.type, e.ref, e.debit ? money(e.debit, 2) : '', e.credit ? money(e.credit, 2) : '', money(e.balance, 2)])]} />
        </Tabs.Panel>
        <Tabs.Panel value="timeline">
          <Paper withBorder p="md"><Timeline bulletSize={14} lineWidth={2}>
            {c.timeline.map((t: any) => <Timeline.Item key={t.id} title={<Text size="sm">{t.action}</Text>}><Text size="xs" c="dimmed">{t.user} · {new Date(t.at).toLocaleString('en-IN')} · {t.entity} #{t.entity_id}</Text></Timeline.Item>)}
          </Timeline>{!c.timeline.length && <Text size="sm" c="dimmed">No activity yet</Text>}</Paper>
        </Tabs.Panel>
      </Tabs>
      <Modal opened={edit} onClose={() => setEdit(false)} title="Edit client" size="lg"><ClientForm initial={c} onCancel={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} /></Modal>
      {site && <SiteModal clientId={c.id} site={site.id ? site : undefined} onClose={(s) => { setSite(null); if (s) reload(); }} />}
      {contact && <ContactModal clientId={c.id} sites={c.sites} contact={contact.id ? contact : undefined} onClose={(s) => { setContact(null); if (s) reload(); }} />}
    </>
  );
}
