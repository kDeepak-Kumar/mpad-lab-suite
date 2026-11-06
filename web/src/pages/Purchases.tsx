import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ActionIcon, Alert, Anchor, Badge, Button, FileButton, Group, Modal, NumberInput, Paper, SegmentedControl, Select, SimpleGrid, Stack, Switch, Table, Tabs, Text, TextInput, Textarea } from '@mantine/core';
import { IconPlus, IconPaperclip, IconTrash, IconCash, IconBuildingStore } from '@tabler/icons-react';
import { INDIAN_STATES } from '@suite/shared';
import { api, dmy, localToday, money, ok, useApi } from '../api';
import { useCan, useMe } from '../ctx';
import { PageHeader, Kpi } from '../components/ui';
import { ListView } from '../components/ListView';
import { compressFile, blobToBase64, type Packed } from '../lib/vendorDocs';
import { FilePreview, UploadPreview, kb } from '../components/Attachments';
import { AdminDelete, RecordInfo } from '../components/RecordAdmin';

export const CATEGORIES = [
  { value: 'subcontract', label: 'Sub-contracted testing', color: 'grape' }, { value: 'equipment', label: 'Equipment', color: 'blue' },
  { value: 'consumables', label: 'Consumables / materials', color: 'teal' }, { value: 'calibration', label: 'Calibration', color: 'orange' }, { value: 'other', label: 'Other expense', color: 'gray' },
];
const catOf = (v: string) => CATEGORIES.find((c) => c.value === v);
const STATUS: Record<string, string> = { unpaid: 'red', partly_paid: 'orange', paid: 'teal' };

export function PurchasesPage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'bills';
  return (
    <>
      <PageHeader title="Purchases & vendor bills" subtitle="Bills from external labs, suppliers and calibration agencies – payments and GST input tax credit" />
      <Tabs value={tab} onChange={(t) => setSp({ tab: t ?? 'bills' })} keepMounted={false}>
        <Tabs.List mb="md"><Tabs.Tab value="bills">Bills</Tabs.Tab><Tabs.Tab value="vendors" leftSection={<IconBuildingStore size={14} />}>Vendors</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="bills"><Bills /></Tabs.Panel>
        <Tabs.Panel value="vendors"><Vendors /></Tabs.Panel>
      </Tabs>
    </>
  );
}

function Bills() {
  const { data, reload } = useApi<any[]>('/purchases');
  const [edit, setEdit] = useState<any>(null);
  const [pay, setPay] = useState<any>(null);
  const rows = data ?? [];
  const due = rows.reduce((a, r) => a + Math.max(0, r.balance), 0);
  const fy = rows.filter((r) => r.bill_date >= `${new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1}-04-01`);
  const itc = fy.filter((r) => r.itc_eligible).reduce((a, r) => a + Number(r.cgst) + Number(r.sgst) + Number(r.igst), 0);
  return (
    <>
      <SimpleGrid cols={{ base: 2, md: 4 }} mb="md" spacing="sm">
        <Kpi label="To pay" value={`₹${money(due)}`} color={due > 0 ? '#b42318' : undefined} hint={`${rows.filter((r) => r.balance > 0.5).length} open bill(s)`} />
        <Kpi label="Purchases this FY" value={`₹${money(fy.reduce((a, r) => a + r.total, 0))}`} hint={`${fy.length} bill(s)`} />
        <Kpi label="Sub-contracted testing (FY)" value={`₹${money(fy.filter((r) => r.category === 'subcontract').reduce((a, r) => a + r.total, 0))}`} />
        <Kpi label="GST input credit (FY)" value={`₹${money(itc)}`} hint="flows into GST returns" />
      </SimpleGrid>
      <ListView id="purchases" rows={data} onRow={(r) => setEdit(r)} actions={<Button size="compact-sm" leftSection={<IconPlus size={14} />} onClick={() => setEdit({ bill_date: localToday(), category: 'subcontract', rate: 18, itc_eligible: true })}>New bill</Button>}
        columns={[
          { key: 'bill_date', label: 'Date', type: 'date' }, { key: 'bill_no', label: 'Bill no.' }, { key: 'vendor_name', label: 'Vendor', filter: 'select' },
          { key: 'category', label: 'Category', filter: 'select', value: (r) => catOf(r.category)?.label, render: (r) => <Badge variant="light" size="sm" color={catOf(r.category)?.color} style={{ textTransform: 'none' }}>{catOf(r.category)?.label}</Badge> },
          { key: 'taxable', label: 'Taxable', type: 'money' }, { key: 'gst', label: 'GST', type: 'money', value: (r) => Number(r.cgst) + Number(r.sgst) + Number(r.igst) },
          { key: 'total', label: 'Total', type: 'money' }, { key: 'balance', label: 'Balance', type: 'money' },
          { key: 'status', label: 'Status', filter: 'select', render: (r) => <Badge variant="light" color={STATUS[r.status]}>{r.status.replace('_', ' ')}</Badge> },
          { key: 'files', label: 'Copy', render: (r) => (r.files ? <IconPaperclip size={14} color="#667085" /> : '') },
          { key: '_actions', label: '', render: (r) => (r.balance > 0.5 ? <Button size="compact-xs" variant="light" leftSection={<IconCash size={13} />} onClick={(e) => { e.stopPropagation(); setPay(r); }}>Pay</Button> : null) },
        ]} quickFilters={[{ label: 'Unpaid', filters: [{ key: 'status', op: 'in', value: ['unpaid', 'partly_paid'] }] }]} empty="No bills yet." />
      {edit && <BillModal initial={edit} onClose={(s) => { setEdit(null); if (s) reload(); }} />}
      {pay && <PayModal bill={pay} onClose={(s) => { setPay(null); if (s) reload(); }} />}
    </>
  );
}

export function BillModal({ initial, onClose }: { initial: any; onClose: (saved: boolean) => void }) {
  const { data: vendors, reload: rv } = useApi<any[]>('/vendors', []);
  const { data: equipment } = useApi<any[]>('/equipment', []);
  const me = useMe();
  const [v, setV] = useState<any>({ ...initial, vendor_id: initial.vendor_id ? String(initial.vendor_id) : null, equipment_id: initial.equipment_id ? String(initial.equipment_id) : null });
  const [files, setFiles] = useState<any[]>([]);
  const [pending, setPending] = useState<Packed | null>(null);
  const [preview, setPreview] = useState<Packed | null>(null);
  const [viewing, setViewing] = useState<any>(null);
  const pick = async (f: File | null) => { if (!f) return; setBusy('Compressing…'); try { setPreview(await compressFile(f, setBusy)); } finally { setBusy(''); } };
  const [busy, setBusy] = useState('');
  const [newVendor, setNewVendor] = useState(false);
  const vendor = vendors?.find((x) => String(x.id) === v.vendor_id);
  const interstate = Boolean(vendor?.state_code && me.company.stateCode && vendor.state_code !== me.company.stateCode);
  const tax = Math.round(Number(v.taxable || 0) * Number(v.rate || 0)) / 100;
  useEffect(() => { if (v.id) api<any[]>(`/files?entity=purchase&entity_id=${v.id}`, { quiet: true }).then(setFiles).catch(() => undefined); }, [v.id]);
  const save = async () => {
    setBusy('Saving…');
    try {
      const body = { vendor_id: Number(v.vendor_id), category: v.category, bill_no: v.bill_no, bill_date: v.bill_date, sac: v.sac || null, rate: Number(v.rate || 0), taxable: Number(v.taxable || 0), interstate, tds: Number(v.tds || 0), itc_eligible: v.itc_eligible !== false && v.itc_eligible !== 0, job_id: v.job_id ?? null, equipment_id: v.equipment_id ? Number(v.equipment_id) : null, notes: v.notes || null };
      const id = v.id ? (await api(`/purchases/${v.id}`, { method: 'PUT', body }), v.id) : (await api<any>('/purchases', { body })).id;
      if (pending) {
        setBusy('Uploading the bill copy…');
        await api('/files', { body: { entity: 'purchase', entity_id: id, name: pending.name, mime: pending.mime, data: await blobToBase64(pending.blob), kind: 'bill' } });
        ok(`Bill saved · copy attached (${kb(pending.after)})`);
      } else ok('Bill saved');
      onClose(true);
    } finally { setBusy(''); }
  };
  return (
    <Modal opened onClose={() => onClose(false)} title={v.id ? `Bill ${v.bill_no}` : 'Record a vendor bill'} size="lg">
      <Stack>
        <SegmentedControl size="xs" fullWidth value={v.category} onChange={(c) => setV({ ...v, category: c })} data={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} />
        <Group align="flex-end" gap="xs" grow>
          <Select label="Vendor" searchable data={(vendors ?? []).map((x) => ({ value: String(x.id), label: x.name }))} value={v.vendor_id} onChange={(x) => setV({ ...v, vendor_id: x })} />
          <Button variant="subtle" style={{ flex: '0 0 auto' }} onClick={() => setNewVendor(true)}>+ New vendor</Button>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TextInput label="Bill / invoice no." value={v.bill_no ?? ''} onChange={(e) => setV({ ...v, bill_no: e.currentTarget.value })} />
          <TextInput type="date" label="Bill date" value={v.bill_date ?? ''} onChange={(e) => setV({ ...v, bill_date: e.currentTarget.value })} />
          <TextInput label="SAC / HSN" value={v.sac ?? ''} onChange={(e) => setV({ ...v, sac: e.currentTarget.value })} placeholder={v.category === 'subcontract' || v.category === 'calibration' ? '998346' : ''} />
          <NumberInput label="Taxable value (₹)" min={0} decimalScale={2} value={v.taxable ?? ''} onChange={(x) => setV({ ...v, taxable: x })} />
          <Select label="GST rate" data={['0', '5', '12', '18', '28']} value={String(v.rate ?? 18)} onChange={(x) => setV({ ...v, rate: Number(x) })} allowDeselect={false} />
          <NumberInput label="TDS deducted (₹)" min={0} decimalScale={2} value={v.tds ?? 0} onChange={(x) => setV({ ...v, tds: x })} />
        </SimpleGrid>
        <Text size="sm" c="dimmed">{interstate ? `IGST ₹${money(tax, 2)}` : `CGST ₹${money(tax / 2, 2)} + SGST ₹${money(tax / 2, 2)}`} · Total ₹{money(Number(v.taxable || 0) + tax, 2)}{vendor && !vendor.gstin ? ' · vendor has no GSTIN – input credit cannot be claimed' : ''}</Text>
        {v.category === 'calibration' || v.category === 'equipment' ? <Select label="Equipment (optional)" searchable clearable data={(equipment ?? []).map((e) => ({ value: String(e.id), label: `${e.name}${e.id_no ? ` (${e.id_no})` : ''}` }))} value={v.equipment_id} onChange={(x) => setV({ ...v, equipment_id: x })} /> : null}
        <Switch label="Eligible for GST input tax credit" checked={v.itc_eligible !== false && v.itc_eligible !== 0} onChange={(e) => setV({ ...v, itc_eligible: e.currentTarget.checked })} />
        <Textarea label="Notes" autosize value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.currentTarget.value })} />
        <Group gap="xs">
          <FileButton accept="application/pdf,image/png,image/jpeg,image/webp" onChange={pick}>{(p) => <Button size="xs" variant="light" loading={busy === 'Compressing…'} leftSection={<IconPaperclip size={14} />} {...p}>{pending ? 'Change bill copy' : 'Attach bill copy'}</Button>}</FileButton>
          {pending && <Badge variant="light" color="teal" style={{ cursor: 'pointer', textTransform: 'none' }} onClick={() => setPreview(pending)}>{pending.name} · {kb(pending.after)} (on save)</Badge>}
          {files.map((f) => <Anchor key={f.id} size="xs" onClick={() => setViewing(f)}>{f.name} · {kb(f.size)}</Anchor>)}
        </Group>
        {v.id && <PaymentsList bill={v} onChange={() => undefined} />}
        <Group justify="space-between">
          {v.id ? <Button variant="subtle" color="red" onClick={async () => { if (window.confirm('Delete this bill?')) { await api(`/purchases/${v.id}`, { method: 'DELETE' }); onClose(true); } }}>Delete</Button> : <span />}
          {v.id ? <AdminDelete object="purchase" id={v.id} compact onDeleted={() => onClose(true)} /> : null}
          <Button loading={Boolean(busy)} onClick={save} disabled={!v.vendor_id || !v.bill_no || !v.bill_date || v.taxable === '' || v.taxable === undefined}>{busy || 'Save bill'}</Button>
        </Group>
        {v.id ? <RecordInfo object="purchase" id={v.id} /> : null}
      </Stack>
      {preview && <UploadPreview packed={preview} onCancel={() => setPreview(null)} onConfirm={() => { setPending(preview); setPreview(null); }} confirmLabel="Use this copy" />}
      {viewing && <FilePreview name={viewing.name} mime={viewing.mime} url={`/api/files/${viewing.id}/download?inline=1`} onClose={() => setViewing(null)} />}
      {newVendor && <VendorModal initial={{ kind: v.category === 'subcontract' ? 'lab' : v.category === 'calibration' ? 'calibration' : 'supplier' }} onClose={async (id) => { setNewVendor(false); if (id) { await rv(); setV((x: any) => ({ ...x, vendor_id: String(id) })); } }} />}
    </Modal>
  );
}

function PaymentsList({ bill }: { bill: any; onChange: () => void }) {
  const { data, reload } = useApi<any>(`/purchases/${bill.id}`, [bill.id]);
  if (!data?.payments?.length) return null;
  return (
    <Paper withBorder p="xs" radius="md">
      <Text size="sm" fw={600} mb={4}>Payments</Text>
      {data.payments.map((p: any) => <Group key={p.id} justify="space-between"><Text size="sm">{dmy(p.date)} · ₹{money(Number(p.amount), 2)} · {p.mode}{p.ref ? ` · ${p.ref}` : ''}</Text>
        <ActionIcon size="sm" variant="subtle" color="red" onClick={async () => { await api(`/purchases/${bill.id}/payments/${p.id}`, { method: 'DELETE' }); reload(); }}><IconTrash size={13} /></ActionIcon></Group>)}
    </Paper>
  );
}

function PayModal({ bill, onClose }: { bill: any; onClose: (s: boolean) => void }) {
  const [v, setV] = useState({ date: localToday(), amount: bill.balance, mode: 'Bank transfer', ref: '' });
  return (
    <Modal opened onClose={() => onClose(false)} title={`Pay ${bill.vendor_name} · bill ${bill.bill_no}`}>
      <Stack>
        <Text size="sm" c="dimmed">Total ₹{money(bill.total, 2)}{bill.tds ? ` − TDS ₹${money(bill.tds, 2)}` : ''} − paid ₹{money(bill.paid, 2)} = due ₹{money(bill.balance, 2)}</Text>
        <SimpleGrid cols={2}>
          <TextInput type="date" label="Paid on" value={v.date} onChange={(e) => setV({ ...v, date: e.currentTarget.value })} />
          <NumberInput label="Amount (₹)" min={0} decimalScale={2} value={v.amount} onChange={(x) => setV({ ...v, amount: Number(x) })} />
          <Select label="Mode" data={['Bank transfer', 'UPI', 'Cheque', 'Cash']} value={v.mode} onChange={(x) => setV({ ...v, mode: x ?? 'Bank transfer' })} />
          <TextInput label="Reference (UTR / cheque no.)" value={v.ref} onChange={(e) => setV({ ...v, ref: e.currentTarget.value })} />
        </SimpleGrid>
        <Group justify="flex-end"><Button onClick={async () => { await api(`/purchases/${bill.id}/payments`, { body: v }); ok('Payment recorded'); onClose(true); }} disabled={!v.amount}>Record payment</Button></Group>
      </Stack>
    </Modal>
  );
}

function Vendors() {
  const { data, reload } = useApi<any[]>('/vendors');
  const [edit, setEdit] = useState<any>(null);
  return (
    <>
      <ListView id="vendors" rows={data} onRow={setEdit} actions={<Button size="compact-sm" leftSection={<IconPlus size={14} />} onClick={() => setEdit({ kind: 'lab' })}>New vendor</Button>}
        columns={[
          { key: 'name', label: 'Vendor', render: (r) => <Text size="sm" fw={600}>{r.name}</Text> },
          { key: 'kind', label: 'Type', filter: 'select', value: (r) => ({ lab: 'Testing laboratory', supplier: 'Supplier', calibration: 'Calibration agency', other: 'Other' } as any)[r.kind] },
          { key: 'services', label: 'Services' }, { key: 'nabl_cert', label: 'NABL cert.', render: (r) => (r.nabl_cert ? <Badge variant="light" color={r.nabl_valid_till && r.nabl_valid_till < localToday() ? 'red' : 'teal'}>{r.nabl_cert}</Badge> : '') },
          { key: 'nabl_valid_till', label: 'Valid till', type: 'date' }, { key: 'gstin', label: 'GSTIN' }, { key: 'phone', label: 'Phone' }, { key: 'spend', label: 'Billed', type: 'money' },
        ]} empty="No vendors yet." />
      {edit && <VendorModal initial={edit} onClose={(id) => { setEdit(null); if (id) reload(); }} />}
    </>
  );
}

export function VendorModal({ initial, onClose }: { initial: any; onClose: (id: number | null) => void }) {
  const [v, setV] = useState<any>(initial);
  const T = (label: string, k: string, p: any = {}) => <TextInput label={label} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.currentTarget.value })} {...p} />;
  const save = async () => {
    const { id, spend: _s, created_at: _c, company_id: _co, ...body } = v;
    if (id) { await api(`/vendors/${id}`, { method: 'PUT', body }); ok('Vendor saved'); onClose(id); }
    else { const r = await api<any>('/vendors', { body }); ok('Vendor added'); onClose(r.id); }
  };
  return (
    <Modal opened onClose={() => onClose(null)} title={v.id ? v.name : 'New vendor'} size="lg">
      <Stack>
        <SegmentedControl size="xs" value={v.kind ?? 'lab'} onChange={(k) => setV({ ...v, kind: k })} data={[{ value: 'lab', label: 'Testing laboratory' }, { value: 'calibration', label: 'Calibration agency' }, { value: 'supplier', label: 'Supplier' }, { value: 'other', label: 'Other' }]} />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {T('Name', 'name')}{T('GSTIN', 'gstin')}
          <Select label="State" searchable clearable data={INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.code} – ${s.name}` }))} value={v.state_code ?? null} onChange={(x) => setV({ ...v, state_code: x })} />
          {T('PAN', 'pan')}
          {(v.kind ?? 'lab') !== 'supplier' && <>{T('NABL certificate no.', 'nabl_cert', { placeholder: 'TC-1234' })}{T('NABL valid till', 'nabl_valid_till', { type: 'date' })}</>}
          {T('Contact person', 'contact')}{T('Phone', 'phone')}{T('Email', 'email')}
        </SimpleGrid>
        <Textarea label="Services / tests they do" autosize value={v.services ?? ''} onChange={(e) => setV({ ...v, services: e.currentTarget.value })} placeholder="Cement chemical analysis, water (IS 456 / IS 10500)…" />
        <Textarea label="Address" autosize value={v.address ?? ''} onChange={(e) => setV({ ...v, address: e.currentTarget.value })} />
        {(v.kind ?? 'lab') === 'lab' && !v.nabl_cert && <Alert variant="light" color="orange" p="xs"><Text size="xs">For results that go on your NABL reports, sub-contract only to a laboratory accredited for those tests and record its certificate here.</Text></Alert>}
        {v.id ? <Group justify="space-between"><RecordInfo object="vendor" id={v.id} /><AdminDelete object="vendor" id={v.id} compact onDeleted={() => onClose(null)} /></Group> : null}
        <Group justify="space-between">{v.id ? <Switch label="Active" checked={v.active !== false && v.active !== 0} onChange={(e) => setV({ ...v, active: e.currentTarget.checked })} /> : <span />}<Button onClick={save} disabled={!v.name || v.name.length < 2}>Save vendor</Button></Group>
      </Stack>
    </Modal>
  );
}
