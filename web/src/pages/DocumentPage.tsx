import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Grid, Group, Menu, Modal, Paper, Select, Stack, Tabs, Text, TextInput, Textarea, Timeline, Badge, Anchor } from '@mantine/core';
import { IconDownload, IconMail, IconPrinter, IconChevronDown, IconDeviceFloppy } from '@tabler/icons-react';
import { applyOverrides, computeTotals, DEFAULT_TEMPLATES, type DocOverrides, type DocTemplate, type LineInput } from '@suite/shared';
import { api, ok, useApi, dmy, money } from '../api';
import { useMe, hasRole } from '../App';
import { PageHeader, StatusBadge, Loading } from '../components/ui';
import { DocRenderer } from '../doc/DocRenderer';
import { FitWidth } from '../doc/FitWidth';
import { DesignPanel } from '../doc/DesignPanel';
import { DocDetailsForm } from '../doc/LinesEditor';
import { downloadDoc, downloadPdf, downloadPng, pdfBase64, printDocument } from '../doc/export';
import { ClientForm } from './Clients';

const KIND_LABEL: Record<string, string> = { quote: 'Quotation', invoice: 'Tax invoice', report: 'Test report' };

/** New quotation / invoice: pick client, site and contact, then the draft opens for editing. */
function NewDocument({ kind }: { kind: 'quote' | 'invoice' }) {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { data: clients, reload } = useApi<any[]>('/clients');
  const [clientId, setClientId] = useState<string | null>(sp.get('client'));
  const { data: client } = useApi<any>(clientId ? `/clients/${clientId}` : null, [clientId]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const r = await api<{ id: number }>('/documents', { body: { kind, client_id: Number(clientId), site_id: siteId ? Number(siteId) : null, contact_id: contactId ? Number(contactId) : null, data: {} } });
      nav(`/documents/${r.id}`, { replace: true });
    } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title={`New ${KIND_LABEL[kind].toLowerCase()}`} subtitle="Choose the client and site. Their details, GST state and contact are filled in automatically." />
      <Paper withBorder p="md" maw={560}>
        <Stack>
          <Group align="flex-end" wrap="nowrap">
            <Select style={{ flex: 1 }} label="Client" searchable placeholder="Search existing clients" data={(clients ?? []).map((c) => ({ value: String(c.id), label: `${c.name}${c.gstin ? ' · ' + c.gstin : ''}` }))} value={clientId} onChange={(v) => { setClientId(v); setSiteId(null); setContactId(null); }} />
            <Button variant="default" onClick={() => setAdding(true)}>New client</Button>
          </Group>
          {client && <Select label="Site / project" clearable data={client.sites.map((s: any) => ({ value: String(s.id), label: s.name }))} value={siteId} onChange={setSiteId} placeholder={client.sites.length ? 'Choose a site' : 'No sites yet (optional)'} />}
          {client && <Select label="Contact person" clearable data={client.contacts.map((c: any) => ({ value: String(c.id), label: `${c.name}${c.role ? ' – ' + c.role : ''}` }))} value={contactId} onChange={setContactId} />}
          <Group justify="flex-end"><Button disabled={!clientId} loading={busy} onClick={create}>Create draft</Button></Group>
        </Stack>
      </Paper>
      <Modal opened={adding} onClose={() => setAdding(false)} title="New client" size="lg">
        <ClientForm onCancel={() => setAdding(false)} onSaved={(id) => { setAdding(false); reload(); setClientId(String(id)); }} />
      </Modal>
    </>
  );
}

export function DocumentPage({ kind }: { kind?: 'quote' | 'invoice' }) {
  const { id } = useParams();
  if (!id && kind) return <NewDocument kind={kind} />;
  return <DocumentView id={Number(id)} />;
}

function DocumentView({ id }: { id: number }) {
  const me = useMe();
  const nav = useNavigate();
  const { data: doc, reload } = useApi<any>(`/documents/${id}`, [id]);
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [overrides, setOverrides] = useState<DocOverrides>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [noteModal, setNoteModal] = useState<null | { title: string; action: (note: string) => Promise<void> }>(null);
  const [tab, setTab] = useState<string | null>('details');
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (doc) { setData(doc.data); setOverrides(doc.overrides ?? {}); setDirty(false); } }, [doc]);

  const issued = doc && ['issued', 'paid', 'partly_paid', 'cancelled'].includes(doc.status);
  const editable = doc && !issued && !(doc.kind === 'quote' && doc.status !== 'draft') && !(doc.kind === 'report' && doc.status === 'verified');
  const baseTemplate: DocTemplate | null = doc ? (doc.template?.definition ?? DEFAULT_TEMPLATES[doc.kind as 'quote']) : null;
  const template = useMemo(() => (baseTemplate ? applyOverrides(baseTemplate, overrides) : null), [baseTemplate, overrides]);
  const totals = useMemo(() => {
    if (!doc || !data || doc.kind === 'report') return null;
    const lines = (data.lines ?? []) as LineInput[];
    return computeTotals(lines.map((l) => ({ ...l, qty: data.mode === 'rate' ? 0 : l.qty })), { supplierState: doc.company.stateCode ?? '', placeOfSupply: data.placeOfSupply ?? doc.company.stateCode, defaultGst: doc.company.defaults?.gstRate ?? 18, overallDiscount: Number(data.overallDiscount ?? 0) });
  }, [doc, data]);

  const save = async (quiet = false) => {
    if (!doc || !dirty) return;
    setSaving(true);
    try { await api(`/documents/${doc.id}`, { method: 'PUT', body: editable ? { data, overrides } : {} }); setDirty(false); if (!quiet) ok('Saved'); }
    finally { setSaving(false); }
  };
  // autosave edits after a short pause
  useEffect(() => { if (!dirty || !editable) return; const t = setTimeout(() => save(true), 1500); return () => clearTimeout(t); }, [data, overrides, dirty]);

  if (!doc || !data || !template || !baseTemplate) return <Loading />;
  const change = (d: Record<string, any>) => { setData(d); setDirty(true); };
  const changeOv = (o: DocOverrides) => { setOverrides(o); setDirty(true); };
  const run = async (fn: () => Promise<unknown>, msg?: string) => { await save(true); await fn(); if (msg) ok(msg); reload(); };
  const fileName = `${KIND_LABEL[doc.kind]} ${doc.number ?? 'draft'} ${doc.data.client?.name ?? ''}`.replace(/[\\/:*?"<>|]+/g, '-').trim();
  const isSignatory = hasRole(me, 'signatory');

  const actions: React.ReactNode[] = [];
  if (doc.kind === 'quote') {
    if (doc.status === 'draft') actions.push(<Button key="sent" variant="default" onClick={() => run(() => api(`/documents/${doc.id}/status`, { body: { status: 'sent' } }), 'Marked as sent')}>Mark as sent</Button>);
    if (['sent', 'accepted', 'draft'].includes(doc.status)) actions.push(
      <Menu key="next"><Menu.Target><Button rightSection={<IconChevronDown size={14} />}>Client accepted</Button></Menu.Target><Menu.Dropdown>
        <Menu.Item onClick={() => run(async () => { const r = await api<any>(`/documents/${doc.id}/to-workorder`, { method: 'POST' }); nav(`/workorders/${r.id}`); })}>Create work order (register samples next)</Menu.Item>
        <Menu.Item onClick={() => run(async () => { const r = await api<any>(`/documents/${doc.id}/to-invoice`, { method: 'POST' }); nav(`/documents/${r.id}`); })}>Create invoice from this quote</Menu.Item>
      </Menu.Dropdown></Menu>);
    if (doc.status !== 'draft') actions.push(<Button key="rev" variant="default" onClick={() => run(async () => { const r = await api<any>(`/documents/${doc.id}/revise`, { method: 'POST' }); nav(`/documents/${r.id}`); }, 'Revision created')}>Revise</Button>);
    if (doc.status === 'sent') actions.push(<Button key="rej" variant="subtle" color="red" onClick={() => run(() => api(`/documents/${doc.id}/status`, { body: { status: 'rejected' } }))}>Mark rejected</Button>);
  }
  if (doc.kind === 'invoice') {
    if (doc.status === 'draft') actions.push(<Button key="issue" onClick={() => window.confirm('Issue this invoice? It gets the next invoice number and can no longer be edited.') && run(() => api(`/documents/${doc.id}/issue`, { method: 'POST' }), 'Invoice issued')}>Issue invoice</Button>);
    if (['issued', 'partly_paid'].includes(doc.status)) actions.push(<Button key="pay" onClick={() => nav(`/payments?new=1&client=${doc.client_id}&invoice=${doc.id}`)}>Record payment</Button>);
  }
  if (doc.kind === 'report') {
    if (doc.status === 'draft') actions.push(
      <Button key="ref" variant="default" onClick={() => run(() => api(`/reports/${doc.id}/refresh`, { method: 'POST' }), 'Results refreshed from observation sheets')}>Refresh results</Button>,
      <Button key="sub" onClick={() => run(() => api(`/reports/${doc.id}/workflow`, { body: { action: 'submit' } }), 'Sent to the signatory for verification')}>Send for verification</Button>);
    if (doc.status === 'review' && isSignatory) actions.push(
      <Button key="back" variant="default" color="red" onClick={() => setNoteModal({ title: 'Send back to reviewer', action: (note) => run(() => api(`/reports/${doc.id}/workflow`, { body: { action: 'sendback', note } }), 'Sent back') })}>Send back</Button>,
      <Button key="ver" onClick={() => run(() => api(`/reports/${doc.id}/workflow`, { body: { action: 'verify' } }), 'Verified')}>Verify</Button>);
    if (doc.status === 'verified' && isSignatory) actions.push(
      <Button key="back2" variant="default" onClick={() => setNoteModal({ title: 'Send back to reviewer', action: (note) => run(() => api(`/reports/${doc.id}/workflow`, { body: { action: 'sendback', note } }), 'Sent back') })}>Send back</Button>,
      <Button key="sign" color="teal" onClick={() => window.confirm('Sign and issue this report? It will be locked with your signature, the company seal and the next report number.') && run(() => api(`/documents/${doc.id}/issue`, { method: 'POST' }), 'Report signed and issued')}>Sign & issue</Button>);
    if (doc.status === 'issued' && isSignatory) actions.push(<Button key="amend" variant="default" onClick={() => setNoteModal({ title: 'Reason for amendment', action: async (reason) => { const r = await api<any>(`/documents/${doc.id}/amend`, { body: { reason } }); nav(`/documents/${r.id}`); } })}>Amend</Button>);
  }
  if (doc.status === 'draft' && !(doc.kind === 'quote' && doc.number && false)) actions.push(<Button key="del" variant="subtle" color="gray" onClick={() => window.confirm('Cancel this draft?') && run(async () => { await api(`/documents/${doc.id}`, { method: 'DELETE' }); nav(-1); }, 'Draft cancelled')}>Cancel draft</Button>);

  const saveTemplate = async () => {
    const def = applyOverrides(baseTemplate, overrides);
    const r = await api<any>('/doc-templates', { body: { kind: doc.kind, definition: { ...def, name: baseTemplate.name }, makeDefault: true, baseId: doc.template?.id } });
    await api(`/documents/${doc.id}`, { method: 'PUT', body: { template_id: r.id, overrides: {} } });
    ok(`Saved as ${doc.kind} template version ${r.version}. Future documents use it.`); reload();
  };

  return (
    <>
      <PageHeader
        title={<Group gap="sm">{KIND_LABEL[doc.kind]} {doc.number ?? <Text span c="dimmed">(number on issue)</Text>} <StatusBadge status={doc.status} />{doc.revision ? <Badge variant="outline">Rev {doc.revision}</Badge> : null}</Group>}
        subtitle={<>{doc.data.client?.name}{doc.data.site ? ` · ${doc.data.site.name}` : ''} · {dmy(doc.date)}{doc.kind === 'invoice' && doc.paid !== undefined && doc.status !== 'draft' ? ` · received ₹${money(doc.paid)} of ₹${money(doc.total)}` : ''}</>}
        actions={<>
          {dirty && editable && <Button variant="subtle" leftSection={<IconDeviceFloppy size={16} />} loading={saving} onClick={() => save()}>Save</Button>}
          {actions}
          <Menu><Menu.Target><Button variant="default" leftSection={<IconDownload size={16} />}>Export</Button></Menu.Target><Menu.Dropdown>
            <Menu.Item leftSection={<IconPrinter size={14} />} onClick={() => { setSelected(null); setTimeout(printDocument, 50); }}>Print / Save as PDF (best quality)</Menu.Item>
            <Menu.Item onClick={() => downloadPdf(printRef.current!, fileName)}>Download PDF</Menu.Item>
            <Menu.Item onClick={() => downloadPng(printRef.current!, fileName)}>Download PNG image</Menu.Item>
            <Menu.Item onClick={() => downloadDoc(printRef.current!, fileName)}>Download Word (.doc)</Menu.Item>
          </Menu.Dropdown></Menu>
          <Button variant="default" leftSection={<IconMail size={16} />} onClick={() => setEmailOpen(true)}>Email</Button>
        </>} />
      {doc.kind === 'report' && doc.data.workflowNote && doc.status === 'draft' && <Alert color="orange" mb="sm" title="Sent back by the signatory">{doc.data.workflowNote}</Alert>}
      {doc.kind === 'report' && doc.status === 'review' && !isSignatory && <Alert color="blue" mb="sm">Waiting for an authorised signatory to verify.</Alert>}
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, lg: 5 }} className="no-print">
          <Tabs value={tab} onChange={setTab}>
            <Tabs.List mb="sm"><Tabs.Tab value="details">Details</Tabs.Tab><Tabs.Tab value="design">Design</Tabs.Tab><Tabs.Tab value="history">History</Tabs.Tab></Tabs.List>
            <Tabs.Panel value="details">
              {doc.kind === 'report'
                ? <ReportDetails doc={doc} data={data} onChange={change} disabled={!editable} />
                : <DocDetailsForm kind={doc.kind} data={data} onChange={change} totals={totals} disabled={!editable} />}
              {doc.kind === 'quote' && doc.status !== 'draft' && <Alert mt="sm" variant="light">This quotation was sent, so it is locked. Use <b>Revise</b> to make changes; the original stays on record.</Alert>}
              {doc.revisions?.length > 0 && <Group mt="sm" gap="xs"><Text size="sm" c="dimmed">Related versions:</Text>{doc.revisions.map((r: any) => <Anchor key={r.id} size="sm" onClick={() => nav(`/documents/${r.id}`)}>{r.number || `#${r.id}`} ({r.status})</Anchor>)}</Group>}
            </Tabs.Panel>
            <Tabs.Panel value="design">
              <DesignPanel base={baseTemplate} overrides={overrides} onChange={changeOv} selected={selected} onSelect={setSelected} readOnly={!editable}
                onReset={() => changeOv({})} onSaveTemplate={hasRole(me, 'reviewer') ? saveTemplate : undefined} />
            </Tabs.Panel>
            <Tabs.Panel value="history">
              <Paper withBorder p="md"><Timeline bulletSize={12}>
                {doc.history.map((h: any) => <Timeline.Item key={h.id} title={<Text size="sm">{h.action}</Text>}><Text size="xs" c="dimmed">{h.user} · {new Date(h.at).toLocaleString('en-IN')}{h.detail?.note ? ` · “${h.detail.note}”` : ''}{h.detail?.reason ? ` · ${h.detail.reason}` : ''}</Text></Timeline.Item>)}
              </Timeline>
              {doc.hash && <Text size="xs" c="dimmed" mt="sm">Fingerprint: {doc.hash.slice(0, 16)}…</Text>}</Paper>
            </Tabs.Panel>
          </Tabs>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <div className="print-root" ref={printRef}>
            <div className="doc-stage" onClick={() => setSelected(null)}><FitWidth>
              <DocRenderer template={template} kind={doc.kind} data={{ ...data, date: doc.date }} company={doc.company} number={doc.number} status={doc.status} totals={totals ?? doc.totals}
                issuer={doc.issuer} selected={tab === 'design' ? selected : null} onSelect={tab === 'design' && editable ? (bid) => setSelected(bid) : undefined} />
            </FitWidth></div>
          </div>
        </Grid.Col>
      </Grid>
      {emailOpen && <EmailModal doc={doc} getRoot={() => printRef.current!} fileName={fileName} onClose={(sent) => { setEmailOpen(false); if (sent) reload(); }} />}
      {noteModal && <NoteModal title={noteModal.title} onClose={() => setNoteModal(null)} onSubmit={async (n) => { await noteModal.action(n); setNoteModal(null); }} />}
    </>
  );
}

function ReportDetails({ doc, data, onChange, disabled }: { doc: any; data: Record<string, any>; onChange: (d: any) => void; disabled: boolean }) {
  const set = (patch: Record<string, any>) => onChange({ ...data, ...patch });
  const notes: string[] = Array.isArray(data.notes) ? data.notes : [];
  return (
    <Stack gap="sm">
      <Paper withBorder p="sm">
        <Text size="sm" fw={600}>Results come from accepted observation sheets</Text>
        <Text size="xs" c="dimmed">To change a result, return the observation sheet for correction (Tests page), then use “Refresh results”. Every change is logged.</Text>
        <Text size="xs" mt={4}>Job code(s): {data.jobCodeText} · ULR: {data.ulr || '—'} · {data.rows?.length ?? 0} result rows</Text>
      </Paper>
      <Group grow>
        <TextInput disabled={disabled} label="Specification*" value={data.specification ?? ''} onChange={(e) => set({ specification: e.currentTarget.value })} />
        <TextInput disabled={disabled} label="Condition of sample at lab" value={data.condition ?? ''} onChange={(e) => set({ condition: e.currentTarget.value })} />
      </Group>
      <Group grow>
        <TextInput disabled={disabled} label="Source of sample" value={data.source ?? ''} onChange={(e) => set({ source: e.currentTarget.value })} />
        <TextInput disabled={disabled} label="Customer reference" value={data.customerRef ?? ''} onChange={(e) => set({ customerRef: e.currentTarget.value })} />
      </Group>
      {(data.samples ?? []).length > 1 && (
        <Group grow>{data.samples.map((s: any, i: number) => <TextInput key={i} disabled={disabled} label={`Column label for ${s.code}`} value={s.label} onChange={(e) => set({ samples: data.samples.map((x: any, j: number) => (j === i ? { ...x, label: e.currentTarget.value } : x)) })} />)}</Group>
      )}
      <Textarea disabled={disabled} label="Remarks / conclusion" placeholder="e.g. The soil can be used for backfilling purpose." autosize minRows={2} value={data.remarks ?? ''} onChange={(e) => set({ remarks: e.currentTarget.value })} />
      <Textarea disabled={disabled} label="Notes (one per line – only notes for the tests on this report are pre-filled)" autosize minRows={4} value={notes.join('\n')} onChange={(e) => set({ notes: e.currentTarget.value.split('\n') })} />
      {(data.charts ?? []).length > 0 && <Text size="xs" c="dimmed">This report has {data.charts.length} graph(s). Turn on the “Graphs” block in Design to include them.</Text>}
      {doc.status === 'issued' && <Alert color="teal" variant="light">Issued on {data.issueText}. The report is locked; use Amend to issue a corrected revision.</Alert>}
    </Stack>
  );
}

function NoteModal({ title, onClose, onSubmit }: { title: string; onClose: () => void; onSubmit: (note: string) => Promise<void> }) {
  const [note, setNote] = useState('');
  return (
    <Modal opened onClose={onClose} title={title}>
      <Textarea autosize minRows={3} value={note} onChange={(e) => setNote(e.currentTarget.value)} data-autofocus />
      <Group justify="flex-end" mt="sm"><Button disabled={note.trim().length < 3} onClick={() => onSubmit(note.trim())}>Submit</Button></Group>
    </Modal>
  );
}

function EmailModal({ doc, getRoot, fileName, onClose }: { doc: any; getRoot: () => HTMLElement; fileName: string; onClose: (sent: boolean) => void }) {
  const contactEmail = doc.data.contact?.email || doc.data.client?.email || '';
  const label = KIND_LABEL[doc.kind];
  const [v, setV] = useState({
    to: contactEmail, cc: '',
    subject: `${label} ${doc.number ?? ''} – ${doc.company.name}`.replace(/\s+/g, ' '),
    body: `Dear ${doc.data.contact?.name || 'Sir/Madam'},\n\nPlease find attached our ${label.toLowerCase()} ${doc.number ?? ''}${doc.data.site ? ` for ${doc.data.site.project || doc.data.site.name}` : ''}.\n\nRegards,\n${doc.company.name}\n${doc.company.phone ?? ''}`,
  });
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const pdf = await pdfBase64(getRoot());
      await api(`/documents/${doc.id}/email`, { body: { ...v, pdfBase64: pdf, filename: `${fileName}.pdf` } });
      ok('Email sent'); onClose(true);
    } finally { setBusy(false); }
  };
  return (
    <Modal opened onClose={() => onClose(false)} title={`Email ${label.toLowerCase()}`} size="lg">
      <Stack>
        <TextInput label="To" value={v.to} onChange={(e) => setV({ ...v, to: e.currentTarget.value })} />
        <TextInput label="Cc" value={v.cc} onChange={(e) => setV({ ...v, cc: e.currentTarget.value })} />
        <TextInput label="Subject" value={v.subject} onChange={(e) => setV({ ...v, subject: e.currentTarget.value })} />
        <Textarea label="Message" autosize minRows={6} value={v.body} onChange={(e) => setV({ ...v, body: e.currentTarget.value })} />
        <Text size="xs" c="dimmed">The document is attached as a PDF and sent from the company email set in Settings. Prefer WhatsApp? Download the PDF and share it.</Text>
        <Group justify="flex-end"><Button loading={busy} onClick={send} disabled={!v.to}>Send email</Button></Group>
      </Stack>
    </Modal>
  );
}
