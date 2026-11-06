import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Anchor, Badge, Button, Drawer, FileButton, Group, Loader, Modal, Paper, Progress, Select, SimpleGrid, Stack, Stepper, Table, Text, TextInput, Textarea, Tooltip } from '@mantine/core';
import { IconFileUpload, IconScan, IconTruckDelivery, IconFileCheck, IconPaperclip, IconCheck, IconAlertTriangle, IconReceipt2, IconExternalLink } from '@tabler/icons-react';
import type { ObservationTemplate } from '@suite/shared';
import { api, dmy, localToday, money, ok, useApi } from '../api';
import { useCan } from '../ctx';
import { PageHeader } from '../components/ui';
import { ListView } from '../components/ListView';
import { readDocumentText, matchValues, findReportMeta, type Match } from '../lib/vendorDocs';
import { BillModal } from './Purchases';
import { Attachments } from '../components/Attachments';
import { AdminDelete, RecordInfo } from '../components/RecordAdmin';

export const JOB_STATUS: Record<string, { label: string; color: string }> = {
  to_send: { label: 'To send', color: 'orange' }, sent: { label: 'Sent to lab', color: 'blue' }, received: { label: 'Report received', color: 'grape' },
  entered: { label: 'Results entered', color: 'teal' }, cancelled: { label: 'Cancelled', color: 'gray' },
};
const STEP = { to_send: 0, sent: 1, received: 2, entered: 3, cancelled: 0 } as Record<string, number>;
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function OutsourcingPage() {
  const { data, reload } = useApi<any[]>('/outsourcing');
  const [sp, setSp] = useSearchParams();
  const open = sp.get('open');
  return (
    <>
      <PageHeader title="Outsourced tests" subtitle="Samples sent to external laboratories – dispatch evidence, their reports, results and bills" />
      <ListView id="outsourcing" rows={data} onRow={(r) => setSp({ open: String(r.id) })} columns={[
        { key: 'sample_code', label: 'Sample', render: (r) => <Text size="sm" fw={600}>{r.sample_code}</Text> },
        { key: 'client_name', label: 'Client', filter: 'select' },
        { key: 'tests', label: 'Tests', value: (r) => r.tests.map((t: any) => t.report_name || t.billing_name).join(', ') },
        { key: 'vendor_name', label: 'External lab', filter: 'select', value: (r) => r.vendor_name ?? '—' },
        { key: 'status', label: 'Status', filter: 'select', value: (r) => JOB_STATUS[r.status]?.label, render: (r) => <Badge variant="light" color={JOB_STATUS[r.status]?.color}>{JOB_STATUS[r.status]?.label}</Badge> },
        { key: 'sent_date', label: 'Sent', type: 'date' }, { key: 'expected_date', label: 'Expected', type: 'date' },
        { key: 'vendor_report_no', label: 'Their report', hidden: true },
        { key: 'evidence', label: 'Files', value: (r) => r.files.length, render: (r) => (r.files.length ? <Group gap={4}><IconPaperclip size={14} />{r.files.length}</Group> : '') },
        { key: 'bill', label: 'Bill', value: (r) => (r.bills.length ? 'Recorded' : 'Pending'), render: (r) => (r.bills.length ? <Badge size="sm" variant="light" color={r.bills.every((b: any) => b.status === 'paid') ? 'teal' : 'orange'}>{r.bills.every((b: any) => b.status === 'paid') ? 'Paid' : 'Unpaid'}</Badge> : <Text size="xs" c="dimmed">—</Text>) },
      ]} quickFilters={[{ label: 'To send', filters: [{ key: 'status', op: 'in', value: ['To send'] }] }, { label: 'Awaiting report', filters: [{ key: 'status', op: 'in', value: ['Sent to lab'] }] }, { label: 'Enter results', filters: [{ key: 'status', op: 'in', value: ['Report received'] }] }]}
        empty="Nothing outsourced yet. Mark tests as Outsourced in the Rate card – registering such a sample creates a job here automatically." />
      {open && <JobDrawer id={Number(open)} onClose={() => setSp({})} onChange={reload} />}
    </>
  );
}

function JobDrawer({ id, onClose, onChange }: { id: number; onClose: () => void; onChange: () => void }) {
  const { data: j, reload } = useApi<any>(`/outsourcing/${id}`, [id]);
  const { data: vendors } = useApi<any[]>('/vendors', []);
  const can = useCan();
  const nav = useNavigate();
  const [f, setF] = useState<any>({});
  const [importing, setImporting] = useState<any>(null);
  const [bill, setBill] = useState(false);
  useEffect(() => { if (j) setF({ vendor_id: j.vendor_id ? String(j.vendor_id) : null, sent_date: j.sent_date ?? localToday(), expected_date: j.expected_date ?? '', vendor_report_no: j.vendor_report_no ?? '', vendor_report_date: j.vendor_report_date ?? '', notes: j.notes ?? '' }); }, [j?.id, j?.status]);
  if (!j) return <Drawer opened onClose={onClose} position="right" size="xl"><Loader /></Drawer>;
  const edit = can('manageOutsourcing');
  const vendor = vendors?.find((v) => String(v.id) === f.vendor_id);
  const save = async (patch: any, msg?: string) => {
    await api(`/outsourcing/${id}`, { method: 'PUT', body: { vendor_id: f.vendor_id ? Number(f.vendor_id) : null, sent_date: f.sent_date || null, expected_date: f.expected_date || null, vendor_report_no: f.vendor_report_no || null, vendor_report_date: f.vendor_report_date || null, notes: f.notes || null, ...patch } });
    if (msg) ok(msg); reload(); onChange();
  };
  return (
    <Drawer opened onClose={onClose} position="right" size="xl" title={<Group gap="xs"><Text fw={650}>Outsourced · {j.sample_code}</Text><Badge variant="light" color={JOB_STATUS[j.status]?.color}>{JOB_STATUS[j.status]?.label}</Badge></Group>}>
      <Stack>
        <Paper withBorder p="sm" radius="md">
          <SimpleGrid cols={2} spacing={4}>
            <Text size="sm"><Text span c="dimmed">Client: </Text>{j.client_name}</Text>
            <Text size="sm"><Text span c="dimmed">Material: </Text>{j.material} · received {dmy(j.received_date)}</Text>
          </SimpleGrid>
          <Group gap={6} mt={6}>{j.tests.map((t: any) => <Badge key={t.id} variant="light" color={t.status === 'pending' ? 'gray' : 'teal'} style={{ textTransform: 'none' }} rightSection={<Anchor size="xs" onClick={() => nav(`/tests/${t.id}`)}><IconExternalLink size={11} /></Anchor>}>{t.report_name || t.billing_name} · {t.status.replace('_', ' ')}</Badge>)}</Group>
        </Paper>
        <Stepper active={STEP[j.status] ?? 0} size="xs" allowNextStepsSelect={false}>
          <Stepper.Step label="Send" description="Sample dispatched" icon={<IconTruckDelivery size={16} />} />
          <Stepper.Step label="Their report" description="Upload it" icon={<IconFileUpload size={16} />} />
          <Stepper.Step label="Results" description="Read & confirm" icon={<IconScan size={16} />} />
          <Stepper.Step label="Report" description="Verify & sign" icon={<IconFileCheck size={16} />} />
        </Stepper>

        <Paper withBorder p="md" radius="md">
          <Text fw={600} mb="xs">1 · Dispatch</Text>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Select label="External laboratory" placeholder="Choose" searchable disabled={!edit} data={(vendors ?? []).filter((v) => v.active !== false).map((v) => ({ value: String(v.id), label: v.name }))} value={f.vendor_id} onChange={(x) => setF({ ...f, vendor_id: x })} />
            <TextInput type="date" label="Sent on" disabled={!edit} value={f.sent_date} onChange={(e) => setF({ ...f, sent_date: e.currentTarget.value })} />
            <TextInput type="date" label="Report expected by" disabled={!edit} value={f.expected_date} onChange={(e) => setF({ ...f, expected_date: e.currentTarget.value })} />
          </SimpleGrid>
          {vendor && (vendor.nabl_cert ? <Text size="xs" c={vendor.nabl_valid_till && vendor.nabl_valid_till < localToday() ? 'red' : 'dimmed'} mt={4}>NABL {vendor.nabl_cert}{vendor.nabl_valid_till ? ` · valid till ${dmy(vendor.nabl_valid_till)}${vendor.nabl_valid_till < localToday() ? ' – EXPIRED' : ''}` : ''}</Text>
            : <Text size="xs" c="orange" mt={4}>No NABL certificate recorded for this lab. For NABL reports, sub-contract only to a lab accredited for these tests.</Text>)}
          <Group mt="sm" gap="xs">
            {edit && j.status === 'to_send' && <Button size="xs" leftSection={<IconTruckDelivery size={14} />} onClick={() => save({ status: 'sent' }, 'Marked as sent')}>Mark as sent</Button>}
            {edit && j.status !== 'to_send' && <Button size="xs" variant="default" onClick={() => save({}, 'Saved')}>Save</Button>}
          </Group>
          <div style={{ marginTop: 10 }}><Attachments entity="outsource" entityId={id} kind="evidence" readOnly={!edit} compact buttonLabel="Attach evidence (optional)" onChange={() => { reload(); onChange(); }}
            emptyText="Optional: delivery challan, courier slip or a photo of the sealed sample." /></div>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Text fw={600} mb="xs">2 · Their test report</Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="Their report no." disabled={!edit} value={f.vendor_report_no} onChange={(e) => setF({ ...f, vendor_report_no: e.currentTarget.value })} />
            <TextInput type="date" label="Their report date" disabled={!edit} value={f.vendor_report_date} onChange={(e) => setF({ ...f, vendor_report_date: e.currentTarget.value })} />
          </SimpleGrid>
          <div style={{ marginTop: 10 }}><Attachments entity="outsource" entityId={id} kind="vendor_report" readOnly={!edit} compact buttonLabel="Upload their report"
            onUploaded={() => { if (['to_send', 'sent'].includes(j.status)) save({ status: 'received' }); }} onChange={() => { reload(); onChange(); }}
            emptyText="Upload the report the external lab issued – then use Read results."
            rowAction={edit ? (file) => <Button size="compact-xs" variant="light" color="grape" leftSection={<IconScan size={13} />} onClick={() => setImporting(file)}>Read results</Button> : undefined} /></div>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Group justify="space-between"><Text fw={600}>3 · Their bill</Text>{can('managePurchases') && <Button size="xs" variant="light" leftSection={<IconReceipt2 size={14} />} onClick={() => setBill(true)}>Record their bill</Button>}</Group>
          {j.bills.length ? j.bills.map((b: any) => <Text key={b.id} size="sm">Bill {b.bill_no} · ₹{money(Number(b.total), 2)} · <Badge size="xs" variant="light" color={b.status === 'paid' ? 'teal' : 'orange'}>{b.status.replace('_', ' ')}</Badge></Text>)
            : <Text size="sm" c="dimmed">No bill recorded yet. It goes to Purchases and into GST input tax credit.</Text>}
        </Paper>
        <Textarea label="Notes" autosize disabled={!edit} value={f.notes} onChange={(e) => setF({ ...f, notes: e.currentTarget.value })} onBlur={() => edit && save({})} />
        {edit && j.status !== 'cancelled' && <Button variant="subtle" color="gray" size="xs" w="fit-content" onClick={() => window.confirm('Cancel this outsourced job? The tests stay on the sample and can be done in-house.') && save({ status: 'cancelled' }, 'Cancelled')}>Cancel job (do in-house instead)</Button>}
        <Group justify="space-between"><RecordInfo object="outsource" id={j.id} /><AdminDelete object="outsource" id={j.id} compact onDeleted={() => { onChange(); onClose(); }} /></Group>
      </Stack>
      {importing && <ImportModal job={j} file={importing} onClose={(done) => { setImporting(null); if (done) { reload(); onChange(); } }} />}
      {bill && <BillModal initial={{ category: 'subcontract', vendor_id: j.vendor_id, job_id: j.id, bill_date: localToday(), rate: 18 }} onClose={(s) => { setBill(false); if (s) { reload(); onChange(); } }} />}
    </Drawer>
  );
}

/** Read the vendor report, match values to the template, let the user correct them, then fill the observation sheet. */
function ImportModal({ job, file, onClose }: { job: any; file: any; onClose: (done: boolean) => void }) {
  const { data: templates } = useApi<any[]>('/obs-templates', []);
  const [lines, setLines] = useState<string[] | null>(null);
  const [method, setMethod] = useState('');
  const [progress, setProgress] = useState('Opening the report…');
  const [err, setErr] = useState('');
  const pending = job.tests.filter((t: any) => ['pending', 'in_progress', 'returned'].includes(t.status));
  const [testId, setTestId] = useState<string | null>(pending[0] ? String(pending[0].id) : null);
  const test = job.tests.find((t: any) => String(t.id) === testId);
  const [tplCode, setTplCode] = useState<string | null>(null);
  const [rows, setRows] = useState<Match[]>([]);
  const [meta, setMeta] = useState({ reportNo: job.vendor_report_no ?? '', reportDate: job.vendor_report_date ?? '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (test) setTplCode(test.template_code); }, [testId]);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/files/${file.id}/download`); if (!res.ok) throw new Error('Could not open the file');
        const blob = await res.blob();
        const r = await readDocumentText(blob, blob.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'), setProgress);
        setLines(r.lines); setMethod(r.method);
        const m = findReportMeta(r.lines); setMeta((x) => ({ reportNo: x.reportNo || m.reportNo, reportDate: x.reportDate || m.reportDate }));
      } catch (e) { setErr((e as Error).message); setLines([]); }
    })();
  }, [file.id]);
  const tpl: ObservationTemplate | undefined = useMemo(() => templates?.find((t) => t.code === tplCode), [templates, tplCode]);
  useEffect(() => { if (tpl && lines) setRows(matchValues(tpl, lines)); }, [tpl, lines]);
  const found = rows.filter((r) => r.value !== '').length;
  const submit = async (send: boolean) => {
    setBusy(true);
    try {
      await api(`/outsourcing/${job.id}/import`, { body: { test_id: Number(testId), template_code: tplCode, values: Object.fromEntries(rows.map((r) => [r.key, r.value === '' ? null : r.value])), report_no: meta.reportNo || null, report_date: meta.reportDate || null, submit: send } });
      ok(send ? 'Results entered and sent for review' : 'Results saved as draft on the observation sheet'); onClose(true);
    } finally { setBusy(false); }
  };
  const tplOptions = (templates ?? []).map((t) => ({ value: t.code, label: `${t.name} (${t.code})`, group: t.category ?? 'Other' }));
  const groups = [...new Set(tplOptions.map((o) => o.group))].map((g) => ({ group: g, items: tplOptions.filter((o) => o.group === g).map(({ value, label }) => ({ value, label })) }));
  return (
    <Modal opened onClose={() => onClose(false)} size="80rem" title={<Group gap="xs"><IconScan size={18} /><Text fw={650}>Read results · {file.name}</Text></Group>}>
      {lines === null ? <Stack align="center" py="xl"><Loader /><Text size="sm" c="dimmed">{progress}</Text><Progress value={100} animated w={260} size="xs" /></Stack> : (
        <Stack>
          {err && <Alert color="red">{err}</Alert>}
          {!pending.length && <Alert color="orange">All tests of this job are already submitted. Ask the reviewer to return a test to change its values.</Alert>}
          <SimpleGrid cols={{ base: 1, md: 4 }}>
            <Select label="Test" data={pending.map((t: any) => ({ value: String(t.id), label: t.report_name || t.billing_name }))} value={testId} onChange={setTestId} allowDeselect={false} />
            <Select label="Observation template" description={tplCode !== test?.template_code ? 'Test will switch to this template' : 'Change if the wrong sheet was picked'} searchable data={groups} value={tplCode} onChange={setTplCode} allowDeselect={false} />
            <TextInput label="Their report no." value={meta.reportNo} onChange={(e) => setMeta({ ...meta, reportNo: e.currentTarget.value })} />
            <TextInput type="date" label="Their report date" value={meta.reportDate} onChange={(e) => setMeta({ ...meta, reportDate: e.currentTarget.value })} />
          </SimpleGrid>
          <Group gap="xs">
            <Badge variant="light" color={method === 'text' ? 'teal' : 'grape'}>{method === 'text' ? 'Read from the PDF text' : 'Read by OCR (scanned)'}</Badge>
            <Badge variant="light" color={found === rows.length ? 'teal' : 'orange'}>{found} of {rows.length} values found</Badge>
            <Text size="xs" c="dimmed">Check every value against their report before saving. Leave blank what they did not test.</Text>
          </Group>
          {tpl && tpl.grids?.length > 0 && <Alert color="orange" icon={<IconAlertTriangle size={16} />}>This template has observation tables; only its header values can be filled automatically. Use a direct-entry sheet (Water, Chemical analysis) for outsourced results.</Alert>}
          <Table withTableBorder verticalSpacing={4} fz="sm">
            <Table.Thead><Table.Tr><Table.Th w="34%">Parameter</Table.Th><Table.Th w={170}>Value</Table.Th><Table.Th>Found on this line of their report</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{rows.map((r, i) => (
              <Table.Tr key={r.key} style={{ background: r.value === '' ? '#fffaeb' : undefined }}>
                <Table.Td>{r.label}</Table.Td>
                <Table.Td>{r.options ? <Select size="xs" data={r.options} value={r.value || null} clearable onChange={(x) => setRows(rows.map((y, j) => (j === i ? { ...y, value: x ?? '' } : y)))} />
                  : <TextInput size="xs" value={r.value} onChange={(e) => setRows(rows.map((y, j) => (j === i ? { ...y, value: e.currentTarget.value } : y)))} error={r.value !== '' && isNaN(Number(r.value.replace(/[<>≤≥]/g, ''))) ? 'number' : undefined} />}</Table.Td>
                <Table.Td><Tooltip label={r.line || 'Not found – type it in, or leave blank if not tested'} multiline w={420} disabled={!r.line}><Text size="xs" c={r.line ? 'dimmed' : 'orange'} lineClamp={1}>{r.line || 'Not found'}</Text></Tooltip></Table.Td>
              </Table.Tr>))}</Table.Tbody>
          </Table>
          <details><summary style={{ cursor: 'pointer', fontSize: 13, color: '#475467' }}>Show the text read from the report ({lines.length} lines)</summary>
            <pre style={{ maxHeight: 240, overflow: 'auto', fontSize: 11.5, background: '#f8fafc', padding: 8, borderRadius: 8, whiteSpace: 'pre-wrap' }}>{lines.join('\n')}</pre></details>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">The report will mark these results as tested by {job.vendor_name ?? 'the external laboratory'} (ISO/IEC 17025 7.8.2.1).</Text>
            <Group gap="xs">
              <Button variant="default" loading={busy} disabled={!testId || !pending.length} onClick={() => submit(false)}>Save as draft</Button>
              <Button loading={busy} leftSection={<IconCheck size={15} />} disabled={!testId || !pending.length} onClick={() => submit(true)}>Save & send for review</Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
