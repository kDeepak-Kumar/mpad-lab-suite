import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Grid, Group, Menu, Modal, Paper, Select, Stack, Tabs, Text, TextInput, Textarea, Timeline, Badge, Anchor, Switch } from '@mantine/core';
import { IconDownload, IconMail, IconPrinter, IconChevronDown, IconSparkles, IconLockOpen, IconCheck } from '@tabler/icons-react';
import { applyOverrides, computeTotals, DEFAULT_TEMPLATES, type DocOverrides, type DocTemplate, type LineInput } from '@suite/shared';
import { api, ok, useApi, dmy, money } from '../api';
import { useCan, useMe, isAdmin, useFields } from '../ctx';
import { PageHeader, StatusBadge, TypeBadge, Loading, Path } from '../components/ui';
import { RecordForm } from '../components/RecordForm';
import { DocRenderer } from '../doc/DocRenderer';
import { DesignPanel } from '../doc/DesignPanel';
import { DocDetailsForm } from '../doc/LinesEditor';
import { HeaderFields } from '../doc/HeaderFields';
import { FitWidth } from '../doc/FitWidth';
import { ClientForm } from './Clients';

const KIND_LABEL: Record<string, string> = { quote: 'Quotation', invoice: 'Tax invoice', report: 'Test report' };
const PATHS: Record<string, { key: string; label: string }[]> = {
  quote: [{ key: 'draft', label: 'Draft' }, { key: 'sent', label: 'Sent' }, { key: 'accepted', label: 'Accepted' }],
  invoice: [{ key: 'draft', label: 'Draft' }, { key: 'issued', label: 'Issued' }, { key: 'partly_paid', label: 'Part paid' }, { key: 'paid', label: 'Paid' }],
  report: [{ key: 'draft', label: 'Draft' }, { key: 'review', label: 'Verification' }, { key: 'verified', label: 'Verified' }, { key: 'issued', label: 'Signed & issued' }],
};
const exportLib = () => import('../doc/export');

/** New quotation / invoice: pick client, site and contact, then the draft opens for editing. */
function NewDocument({ kind }: { kind: 'quote' | 'invoice' }) {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { data: clients, reload } = useApi<any[]>('/clients');
  const [clientId, setClientId] = useState<string | null>(sp.get('client'));
  const { data: client } = useApi<any>(clientId ? `/clients/${clientId}` : null, [clientId]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [acc, setAcc] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (client?.sites?.length === 1) setSiteId(String(client.sites[0].id)); if (client?.contacts?.length === 1) setContactId(String(client.contacts[0].id)); }, [client]);
  const create = async () => {
    setBusy(true);
    try {
      const r = await api<{ id: number }>('/documents', { body: { kind, client_id: Number(clientId), site_id: siteId ? Number(siteId) : null, contact_id: contactId ? Number(contactId) : null, data: { accreditation: acc } } });
      nav(`/documents/${r.id}`, { replace: true });
    } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader eyebrow={`New ${KIND_LABEL[kind].toLowerCase()}`} title="Who is it for?" subtitle="Client details, GST state and contact are filled in automatically – you can still change any of them on the document." />
      <Paper withBorder p="lg" maw={620}>
        <Stack>
          <Group align="flex-end" wrap="nowrap">
            <Select style={{ flex: 1 }} label="Client" searchable placeholder="Type to search clients" data={(clients ?? []).map((c) => ({ value: String(c.id), label: `${c.name}${c.gstin ? ' · ' + c.gstin : ''}` }))} value={clientId}
              onChange={(v) => { setClientId(v); setSiteId(null); setContactId(null); }} data-autofocus />
            <Button variant="default" onClick={() => setAdding(true)}>New client</Button>
          </Group>
          {client && <Select label="Site / project" clearable data={client.sites.map((s: any) => ({ value: String(s.id), label: s.name }))} value={siteId} onChange={setSiteId} placeholder={client.sites.length ? 'Choose a site' : 'No sites yet (optional)'} />}
          {client && <Select label="Contact person" clearable data={client.contacts.map((c: any) => ({ value: String(c.id), label: `${c.name}${c.role ? ' – ' + c.role : ''}` }))} value={contactId} onChange={setContactId} />}
          <Select label="Report type" description="Choose NABL to print on the NABL letterhead" clearable data={['NABL', 'Non-NABL']} value={acc} onChange={setAcc} />
          <Group justify="flex-end"><Button disabled={!clientId} loading={busy} onClick={create}>Create draft</Button></Group>
        </Stack>
      </Paper>
      <Modal opened={adding} onClose={() => setAdding(false)} title="New client" size="xl">
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
  const can = useCan();
  const admin = isAdmin(me);
  const nav = useNavigate();
  const { data: doc, reload } = useApi<any>(`/documents/${id}`, [id]);
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [overrides, setOverrides] = useState<DocOverrides>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [noteModal, setNoteModal] = useState<null | { title: string; action: (note: string) => Promise<void> }>(null);
  const [tab, setTab] = useState<string | null>('details');
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (doc && (!dirtyRef.current || doc.id !== (data as any)?.__id)) { setData({ ...doc.data, __id: doc.id }); setOverrides(doc.overrides ?? {}); setDirty(false); dirtyRef.current = false; } }, [doc]);

  const issued = doc && ['issued', 'paid', 'partly_paid', 'cancelled'].includes(doc.status);
  const editable = doc && !issued && (admin || (!(doc.kind === 'quote' && doc.status !== 'draft') && !(doc.kind === 'report' && doc.status === 'verified')));
  const baseTemplate: DocTemplate | null = doc ? (doc.template?.definition ?? DEFAULT_TEMPLATES[doc.kind as 'quote']) : null;
  const template = useMemo(() => (baseTemplate ? applyOverrides(baseTemplate, overrides) : null), [baseTemplate, overrides]);
  const totals = useMemo(() => {
    if (!doc || !data || doc.kind === 'report') return null;
    const lines = (data.lines ?? []) as LineInput[];
    const showQty = doc.kind !== 'quote' || (data.showQty ?? data.mode !== 'rate');
    const includeGst = doc.kind !== 'quote' || (data.includeGst ?? data.mode !== 'rate');
    return computeTotals(lines.map((l) => ({ ...l, qty: showQty ? l.qty ?? 1 : 0, gstRate: includeGst ? l.gstRate : 0 })), { supplierState: doc.company.stateCode ?? '', placeOfSupply: data.placeOfSupply ?? doc.company.stateCode, defaultGst: includeGst ? doc.company.defaults?.gstRate ?? 18 : 0, overallDiscount: Number(data.overallDiscount ?? 0) });
  }, [doc, data]);

  const strip = (d: Record<string, any>) => { const { __id, ...rest } = d; return rest; };
  const save = async (quiet = false) => {
    if (!doc || !dirtyRef.current || !data) return;
    setSaving(true);
    try { await api(`/documents/${doc.id}`, { method: 'PUT', body: editable ? { data: strip(data), overrides } : {} }); dirtyRef.current = false; setDirty(false); if (!quiet) ok('Saved'); }
    finally { setSaving(false); }
  };
  useEffect(() => { if (!dirty || !editable) return; const t = setTimeout(() => save(true), 1200); return () => clearTimeout(t); }, [data, overrides, dirty]);

  if (!doc || !data || !template || !baseTemplate) return <Loading />;
  const change = (d: Record<string, any>) => { setData(d); setDirty(true); dirtyRef.current = true; };
  const changeOv = (o: DocOverrides) => { setOverrides(o); setDirty(true); dirtyRef.current = true; };
  const run = async (fn: () => Promise<unknown>, msg?: string) => { await save(true); await fn(); if (msg) ok(msg); dirtyRef.current = false; reload(); };
  const fileName = `${KIND_LABEL[doc.kind]} ${doc.number ?? 'draft'} ${doc.data.client?.name ?? ''}`.replace(/[\\/:*?"<>|]+/g, '-').trim();
  const signer = can('signReports');

  const actions: React.ReactNode[] = [];
  if (doc.kind === 'quote') {
    if (doc.status === 'draft') actions.push(<Button key="sent" variant="default" onClick={() => run(() => api(`/documents/${doc.id}/status`, { body: { status: 'sent' } }), 'Marked as sent')}>Mark as sent</Button>);
    if (['sent', 'accepted', 'draft'].includes(doc.status)) actions.push(
      <Menu key="next" shadow="lg"><Menu.Target><Button rightSection={<IconChevronDown size={14} />} leftSection={<IconCheck size={15} />}>Client accepted</Button></Menu.Target><Menu.Dropdown>
        <Menu.Item onClick={() => run(async () => { const r = await api<any>(`/documents/${doc.id}/to-workorder`, { method: 'POST' }); nav(`/workorders/${r.id}`); })}>Create work order (register samples next)</Menu.Item>
        <Menu.Item onClick={() => run(async () => { const r = await api<any>(`/documents/${doc.id}/to-invoice`, { method: 'POST' }); nav(`/documents/${r.id}`); })}>Create invoice from this quote</Menu.Item>
      </Menu.Dropdown></Menu>);
    if (doc.status !== 'draft') actions.push(<Button key="rev" variant="default" onClick={() => run(async () => { const r = await api<any>(`/documents/${doc.id}/revise`, { method: 'POST' }); nav(`/documents/${r.id}`); }, 'Revision created')}>Revise</Button>);
  }
  if (doc.kind === 'invoice') {
    if (doc.status === 'draft' && can('issueInvoices')) actions.push(<Button key="issue" onClick={() => window.confirm(doc.number ? `Issue invoice ${doc.number}?` : 'Issue this invoice? It gets the next invoice number and can no longer be edited.') && run(() => api(`/documents/${doc.id}/issue`, { method: 'POST' }), 'Invoice issued')}>Issue invoice</Button>);
    if (['issued', 'partly_paid'].includes(doc.status) && can('recordPayments')) actions.push(<Button key="pay" onClick={() => nav(`/payments?new=1&client=${doc.client_id}&invoice=${doc.id}`)}>Record payment</Button>);
  }
  if (doc.kind === 'report') {
    if (doc.status === 'draft' && can('prepareReports')) actions.push(
      <Button key="ref" variant="default" onClick={() => run(() => api(`/reports/${doc.id}/refresh`, { method: 'POST' }), 'Results refreshed from observation sheets')}>Refresh results</Button>,
      <Button key="sub" onClick={() => run(() => api(`/reports/${doc.id}/workflow`, { body: { action: 'submit' } }), 'Sent to the signatory for verification')}>Send for verification</Button>);
    if ((doc.status === 'review' || (admin && doc.status === 'draft')) && signer) actions.push(
      ...(doc.status === 'review' ? [<Button key="back" variant="default" color="red" onClick={() => setNoteModal({ title: 'Send back to reviewer', action: (note) => run(() => api(`/reports/${doc.id}/workflow`, { body: { action: 'sendback', note } }), 'Sent back') })}>Send back</Button>] : []),
      <Button key="ver" variant={admin && doc.status === 'draft' ? 'default' : 'filled'} onClick={() => run(() => api(`/reports/${doc.id}/workflow`, { body: { action: 'verify' } }), 'Verified')}>Verify</Button>);
    if ((doc.status === 'verified' || (admin && ['draft', 'review'].includes(doc.status))) && signer) actions.push(
      ...(doc.status === 'verified' ? [<Button key="back2" variant="default" onClick={() => setNoteModal({ title: 'Send back to reviewer', action: (note) => run(() => api(`/reports/${doc.id}/workflow`, { body: { action: 'sendback', note } }), 'Sent back') })}>Send back</Button>] : []),
      <Button key="sign" color="teal" onClick={() => window.confirm('Sign and issue this report? It will be locked with your signature, the company seal and the report number.') && run(() => api(`/documents/${doc.id}/issue`, { method: 'POST' }), 'Report signed and issued')}>Sign & issue</Button>);
    if (doc.status === 'issued' && signer) actions.push(<Button key="amend" variant="default" onClick={() => setNoteModal({ title: 'Reason for amendment', action: async (reason) => { const r = await api<any>(`/documents/${doc.id}/amend`, { body: { reason } }); nav(`/documents/${r.id}`); } })}>Amend</Button>);
  }
  if (issued && admin && doc.status !== 'cancelled') actions.push(<Button key="unlock" variant="light" color="orange" leftSection={<IconLockOpen size={15} />} onClick={() => setNoteModal({ title: 'Unlock issued document (System Admin) – reason', action: (reason) => run(() => api(`/documents/${doc.id}/unlock`, { body: { reason } }), 'Unlocked for editing. Issue it again when done.') })}>Unlock</Button>);

  const saveTemplate = async () => {
    const def = applyOverrides(baseTemplate, overrides);
    const r = await api<any>('/doc-templates', { body: { kind: doc.kind, definition: { ...def, name: baseTemplate.name }, makeDefault: true, baseId: doc.template?.id } });
    await api(`/documents/${doc.id}`, { method: 'PUT', body: { template_id: r.id, overrides: {} } });
    ok(`Saved as ${doc.kind} template version ${r.version}. Future documents use it.`); reload();
  };
  const exp = async (fn: 'downloadPdf' | 'downloadPng' | 'downloadDoc') => { setSelected(null); const m = await exportLib(); await (m[fn] as any)(printRef.current!, fileName); };

  return (
    <>
      <PageHeader eyebrow={KIND_LABEL[doc.kind]}
        title={<Group gap="sm">{doc.number ?? <Text span c="dimmed" fz={22}>Draft #{doc.id}</Text>} <StatusBadge status={doc.status} /><TypeBadge value={data.accreditation} />{doc.revision ? <Badge variant="outline">Rev {doc.revision}</Badge> : null}</Group>}
        subtitle={<>{data.client?.name}{data.site ? ` · ${data.site.name}` : ''} · {dmy(doc.date)}{doc.kind === 'invoice' && doc.paid !== undefined && doc.status !== 'draft' ? ` · received ₹${money(doc.paid)} of ₹${money(doc.total)}` : ''}{dirty && editable ? ' · saving…' : ''}</>}
        actions={<>
          {actions}
          <Menu shadow="lg"><Menu.Target><Button variant="default" leftSection={<IconDownload size={16} />}>Export</Button></Menu.Target><Menu.Dropdown>
            <Menu.Item leftSection={<IconPrinter size={14} />} onClick={() => { setSelected(null); setTimeout(() => window.print(), 50); }}>Print / Save as PDF (best quality)</Menu.Item>
            <Menu.Item onClick={() => exp('downloadPdf')}>Download PDF</Menu.Item>
            <Menu.Item onClick={() => exp('downloadPng')}>Download PNG image</Menu.Item>
            <Menu.Item onClick={() => exp('downloadDoc')}>Download Word (.doc)</Menu.Item>
          </Menu.Dropdown></Menu>
          <Button variant="default" leftSection={<IconMail size={16} />} onClick={() => setEmailOpen(true)}>Email</Button>
          {saving && <Text size="xs" c="dimmed">Saving…</Text>}
        </>} />
      <div style={{ marginBottom: 14 }}><Path steps={PATHS[doc.kind]} current={doc.status === 'sent' && doc.kind === 'quote' ? 'sent' : doc.status} /></div>
      {doc.kind === 'report' && data.workflowNote && doc.status === 'draft' && <Alert color="orange" mb="sm" title="Sent back by the signatory">{data.workflowNote}</Alert>}
      {issued && <Alert color="teal" variant="light" mb="sm">This document is {doc.status === 'cancelled' ? 'cancelled' : 'issued and locked'}.{admin ? ' As System Admin you can unlock it to make changes (logged).' : doc.kind === 'report' ? ' Use Amend to issue a corrected revision.' : ''}</Alert>}
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, xl: 5 }} className="no-print">
          <Tabs value={tab} onChange={setTab}>
            <Tabs.List mb="sm"><Tabs.Tab value="details">Details</Tabs.Tab><Tabs.Tab value="design">Layout</Tabs.Tab><Tabs.Tab value="history">History</Tabs.Tab></Tabs.List>
            <Tabs.Panel value="details">
              <Stack gap="md">
                <HeaderFields kind={doc.kind} doc={doc} data={data} onData={change} disabled={!editable}
                  onNumber={(n) => run(() => api(`/documents/${doc.id}`, { method: 'PUT', body: { number: n } }), 'Number updated')}
                  onDate={(d) => { change({ ...data, dateText: undefined }); run(() => api(`/documents/${doc.id}`, { method: 'PUT', body: { date: d, data: { ...strip(data), dateText: undefined, unlocked: { ...(data.unlocked ?? {}), date: true } } } }), 'Date updated'); }} />
                {doc.kind === 'report'
                  ? <ReportDetails doc={doc} data={data} onChange={change} disabled={!editable} />
                  : <DocDetailsForm kind={doc.kind} data={data} onChange={change} totals={totals} disabled={!editable} />}
                <CustomFields kind={doc.kind} data={data} onChange={change} disabled={!editable} />
                {doc.kind === 'quote' && doc.status !== 'draft' && !admin && <Alert variant="light">This quotation was sent, so it is locked. Use <b>Revise</b> to make changes; the original stays on record.</Alert>}
                {doc.revisions?.length > 0 && <Group gap="xs"><Text size="sm" c="dimmed">Related versions:</Text>{doc.revisions.map((r: any) => <Anchor key={r.id} size="sm" onClick={() => nav(`/documents/${r.id}`)}>{r.number || `#${r.id}`} ({r.status})</Anchor>)}</Group>}
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="design">
              <DesignPanel base={baseTemplate} overrides={overrides} onChange={changeOv} selected={selected} onSelect={setSelected} readOnly={!editable}
                onReset={() => changeOv({})} onSaveTemplate={can('manageTemplates') ? saveTemplate : undefined} />
            </Tabs.Panel>
            <Tabs.Panel value="history">
              <Paper withBorder p="md"><Timeline bulletSize={12}>
                {doc.history.map((h: any) => <Timeline.Item key={h.id} title={<Text size="sm">{h.action}</Text>}><Text size="xs" c="dimmed">{h.user} · {new Date(h.at).toLocaleString('en-IN')}{h.detail?.note ? ` · “${h.detail.note}”` : ''}{h.detail?.reason ? ` · ${h.detail.reason}` : ''}</Text></Timeline.Item>)}
              </Timeline>
              {doc.hash && <Text size="xs" c="dimmed" mt="sm">Fingerprint: {doc.hash.slice(0, 16)}…</Text>}</Paper>
            </Tabs.Panel>
          </Tabs>
        </Grid.Col>
        <Grid.Col span={{ base: 12, xl: 7 }}>
          <div className="print-root" ref={printRef}>
            <div className="doc-stage" onClick={() => setSelected(null)}><FitWidth>
              <DocRenderer template={template} kind={doc.kind} data={{ ...data, date: doc.date }} company={doc.company} number={doc.number} status={doc.status} totals={totals ?? doc.totals}
                issuer={doc.issuer} verifyUrl={doc.verify ? `${window.location.origin}/verify/${doc.verify}` : null} selected={tab === 'design' ? selected : null} onSelect={tab === 'design' && editable ? (bid) => setSelected(bid) : undefined} />
            </FitWidth></div>
          </div>
        </Grid.Col>
      </Grid>
      {emailOpen && <EmailModal doc={doc} getRoot={() => printRef.current!} fileName={fileName} onClose={(sent) => { setEmailOpen(false); if (sent) reload(); }} />}
      {noteModal && <NoteModal title={noteModal.title} onClose={() => setNoteModal(null)} onSubmit={async (n) => { await noteModal.action(n); setNoteModal(null); }} />}
    </>
  );
}

function CustomFields({ kind, data, onChange, disabled }: { kind: string; data: Record<string, any>; onChange: (d: any) => void; disabled: boolean }) {
  return <RecordFormIfAny object={kind} value={{ custom: data.custom ?? {} }} onChange={(v) => onChange({ ...data, custom: v.custom })} disabled={disabled} />;
}
function RecordFormIfAny(p: { object: string; value: any; onChange: (v: any) => void; disabled: boolean }) {
  const f = useFields(p.object);
  if (!f.length) return null;
  return <Paper withBorder p="md"><Text fw={600} size="sm" mb="xs">Additional fields</Text><RecordForm {...p} /></Paper>;
}

function ReportDetails({ doc, data, onChange, disabled }: { doc: any; data: Record<string, any>; onChange: (d: any) => void; disabled: boolean }) {
  const can = useCan();
  const [busy, setBusy] = useState(false);
  const set = (patch: Record<string, any>) => onChange({ ...data, ...patch });
  const notes: string[] = Array.isArray(data.notes) ? data.notes : [];
  const suggest = async () => {
    setBusy(true);
    try { const r = await api<any>('/ai/assist', { body: { task: 'remark', input: { material: data.material, specification: data.specification, results: data.rows } } }); set({ remarks: r.text }); }
    finally { setBusy(false); }
  };
  return (
    <Stack gap="sm">
      <Paper withBorder p="sm">
        <Text size="sm" fw={600}>Results come from accepted observation sheets</Text>
        <Text size="xs" c="dimmed">To change a result, return the observation sheet for correction, then use “Refresh results”. Every change is logged.</Text>
        <Text size="xs" mt={4}>{data.rows?.length ?? 0} result rows · {(data.samples ?? []).length} sample(s)</Text>
      </Paper>
      {(data.samples ?? []).length > 1 && (
        <Group grow>{data.samples.map((s: any, i: number) => <TextInput key={i} disabled={disabled} label={`Column label for ${s.code}`} value={s.label} onChange={(e) => set({ samples: data.samples.map((x: any, j: number) => (j === i ? { ...x, label: e.currentTarget.value } : x)) })} />)}</Group>
      )}
      <div>
        <Group justify="space-between" mb={4}><Text size="sm" fw={500}>Remarks / conclusion</Text>{can('useAI') && !disabled && <Button size="compact-xs" variant="light" leftSection={<IconSparkles size={12} />} loading={busy} onClick={suggest}>Suggest with AI</Button>}</Group>
        <Textarea disabled={disabled} placeholder="e.g. The soil can be used for backfilling purpose." autosize minRows={2} value={data.remarks ?? ''} onChange={(e) => set({ remarks: e.currentTarget.value })} />
      </div>
      <Textarea disabled={disabled} label="Notes (one per line – only notes for the tests on this report are pre-filled)" autosize minRows={4} value={notes.join('\n')} onChange={(e) => set({ notes: e.currentTarget.value.split('\n') })} />
      {(data.charts ?? []).length > 0 && <Switch disabled={disabled} label={`Include ${data.charts.length} graph(s) with explanations`} checked={!data.hideCharts} onChange={(e) => set({ hideCharts: !e.currentTarget.checked })} />}
      {doc.status === 'issued' && <Alert color="teal" variant="light">Issued on {data.issueText}.</Alert>}
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
      const { pdfBase64 } = await exportLib();
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
