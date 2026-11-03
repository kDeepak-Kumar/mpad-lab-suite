import { useMemo, useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Group, Menu, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Switch, Table, Tabs, Text, TextInput, Tooltip } from '@mantine/core';
import { IconChevronDown, IconDownload, IconPlus, IconRefresh, IconRotate, IconTrash } from '@tabler/icons-react';
import { INDIAN_STATES, validateGstin } from '@suite/shared';
import { api, ok, useApi } from '../api';
import { useCan } from '../ctx';
import { Kpi, Loading, PageHeader } from '../components/ui';

const rs = (n: number) => { const v = Number(n) || 0; return `${v < 0 ? '−' : ''}₹${Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
const monthName = (p: string) => new Date(`${p}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const dmy = (d: string) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '');
const STATUS: Record<string, [string, string]> = { open: ['blue', 'Open'], sent: ['orange', 'Sent to CA'], filed: ['teal', 'Filed'] };
const thisMonth = () => new Date().toLocaleDateString('en-CA').slice(0, 7);
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toLocaleDateString('en-CA').slice(0, 7); };

/** GST returns: monthly register built from invoices, editable, with purchases for ITC and an Excel pack for the CA. */
export function GstPage() {
  const can = useCan();
  const { data: periods, reload: reloadPeriods } = useApi<any[]>('/gst/periods', []);
  // default to last month: returns are prepared after the month closes
  const [period, setPeriod] = useState<string>(() => (new Date().getDate() <= 20 ? prevMonth() : thisMonth()));
  const { data, reload } = useApi<any>(`/gst/${period}`, [period]);
  const [tab, setTab] = useState<string | null>('summary');
  const [edit, setEdit] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading />;
  const open = data.status === 'open';
  const s = data.summary;
  const refresh = () => { reload(); reloadPeriods(); };
  const setStatus = async (status: string) => { await api(`/gst/${period}/status`, { method: 'PUT', body: { status } }); ok(status === 'open' ? 'Month reopened for changes' : status === 'sent' ? 'Marked as sent to CA – the month is locked' : 'Marked as filed'); refresh(); };
  const pull = async () => { setBusy(true); try { const r = await api<any>(`/gst/${period}/sync`, { method: 'POST' }); ok(`${r.invoices} invoice(s) checked · ${r.added} added · ${r.refreshed} updated`); refresh(); } finally { setBusy(false); } };
  const [color, label] = STATUS[data.status] ?? STATUS.open;
  return (
    <>
      <PageHeader title={<Group gap="sm">GST returns <Badge color={color} variant="light">{label}</Badge></Group>}
        subtitle={`${monthName(period)} · ${data.company.gstin || 'GSTIN not set'} · sales are taken from issued invoices automatically`}
        actions={<>
          <Select w={230} value={period} onChange={(v) => v && setPeriod(v)} allowDeselect={false} searchable
            data={(periods ?? []).map((p) => ({ value: p.period, label: `${monthName(p.period)}${p.status !== 'open' ? ` · ${STATUS[p.status]?.[1]}` : ''}` }))} />
          <Button variant="default" leftSection={<IconDownload size={16} />} onClick={() => exportForCa(data)}>Export for CA (.xlsx)</Button>
          {can('manageGst') && (
            <Menu shadow="lg"><Menu.Target><Button rightSection={<IconChevronDown size={14} />}>{open ? 'Finish month' : 'Status'}</Button></Menu.Target>
              <Menu.Dropdown>
                {open && <Menu.Item onClick={() => setStatus('sent')}>Mark as sent to CA (locks the month)</Menu.Item>}
                {data.status !== 'filed' && <Menu.Item onClick={() => setStatus('filed')}>Mark as filed</Menu.Item>}
                {!open && <Menu.Item color="orange" onClick={() => setStatus('open')}>Reopen for changes</Menu.Item>}
              </Menu.Dropdown></Menu>
          )}
        </>} />
      {data.pulled?.added > 0 && <Alert variant="light" color="teal" mb="sm">{data.pulled.added} newly issued invoice(s) were added to {monthName(period)}.</Alert>}
      {!open && <Alert variant="light" color="orange" mb="sm">This month is {label.toLowerCase()} and locked. Use Status → Reopen to change it.</Alert>}
      <SimpleGrid cols={{ base: 2, md: 4 }} mb="md">
        <Kpi label="Sales (taxable)" value={rs(s.outward.taxable)} hint={`${s.outward.invoices} invoice(s) · B2B ${s.outward.b2b.count} · B2C ${s.outward.b2c.count}`} />
        <Kpi label="Output GST" value={rs(s.outward.igst + s.outward.cgst + s.outward.sgst)} hint={`IGST ${rs(s.outward.igst)} · CGST ${rs(s.outward.cgst)} · SGST ${rs(s.outward.sgst)}`} />
        <Kpi label="Input tax credit" value={rs(s.itc.igst + s.itc.cgst + s.itc.sgst)} hint={`${s.itc.bills} purchase bill(s)`} />
        <Kpi label="Net GST payable" value={rs(Math.max(0, s.net.igst + s.net.cgst + s.net.sgst))} color={s.net.igst + s.net.cgst + s.net.sgst < 0 ? 'teal' : undefined} hint={s.net.igst + s.net.cgst + s.net.sgst < 0 ? `Credit of ${rs(-(s.net.igst + s.net.cgst + s.net.sgst))} carries forward (before set-off rules)` : 'Before set-off rules – your CA finalises'} />
      </SimpleGrid>
      <Tabs value={tab} onChange={setTab}>
        <Tabs.List mb="sm">
          <Tabs.Tab value="summary">Summary (GSTR-3B)</Tabs.Tab>
          <Tabs.Tab value="sales">Sales register ({data.sales.filter((r: any) => !r.excluded).length})</Tabs.Tab>
          <Tabs.Tab value="purchases">Purchases / ITC ({data.purchases.length})</Tabs.Tab>
          <Tabs.Tab value="sac">SAC summary</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="summary"><Summary s={s} /></Tabs.Panel>
        <Tabs.Panel value="sales">
          <Group justify="space-between" mb="xs">
            <Text size="sm" c="dimmed">Issued invoices of the month appear here automatically (one row per GST rate). Edit any row, exclude an invoice, or add rows for sales made outside the app.</Text>
            {open && <Group gap="xs"><Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} loading={busy} onClick={pull}>Pull invoices again</Button>
              <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEdit({ kind: 'sales', doc_date: `${period}-01`, rate: 18 })}>Add sales row</Button></Group>}
          </Group>
          <Register rows={data.sales} kind="sales" open={open} onEdit={setEdit} onChange={refresh} />
        </Tabs.Panel>
        <Tabs.Panel value="purchases">
          <Group justify="space-between" mb="xs">
            <Text size="sm" c="dimmed">Enter purchase bills with GST (equipment, calibration, consumables, rent…) to claim input tax credit.</Text>
            {open && <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEdit({ kind: 'purchase', doc_date: `${period}-01`, rate: 18, itc_eligible: true })}>Add purchase bill</Button>}
          </Group>
          <Register rows={data.purchases} kind="purchase" open={open} onEdit={setEdit} onChange={refresh} />
        </Tabs.Panel>
        <Tabs.Panel value="sac">
          <Paper withBorder radius="lg" style={{ overflow: 'auto' }}>
            <Table striped fz="sm"><Table.Thead><Table.Tr><Table.Th>SAC</Table.Th><Table.Th ta="right">Rate</Table.Th><Table.Th ta="right">Rows</Table.Th><Table.Th ta="right">Taxable</Table.Th><Table.Th ta="right">IGST</Table.Th><Table.Th ta="right">CGST</Table.Th><Table.Th ta="right">SGST</Table.Th><Table.Th ta="right">Total value</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{s.sac.map((r: any) => <Table.Tr key={r.sac + r.rate}><Table.Td>{r.sac}</Table.Td><Table.Td ta="right">{r.rate}%</Table.Td><Table.Td ta="right">{r.count}</Table.Td><Table.Td ta="right">{rs(r.taxable)}</Table.Td><Table.Td ta="right">{rs(r.igst)}</Table.Td><Table.Td ta="right">{rs(r.cgst)}</Table.Td><Table.Td ta="right">{rs(r.sgst)}</Table.Td><Table.Td ta="right">{rs(r.total)}</Table.Td></Table.Tr>)}
                {!s.sac.length && <Table.Tr><Table.Td colSpan={8}><Text c="dimmed" ta="center" size="sm" p="md">No sales this month.</Text></Table.Td></Table.Tr>}</Table.Tbody></Table>
          </Paper>
        </Tabs.Panel>
      </Tabs>
      {edit && <RowModal row={edit} period={period} ownState={data.company.stateCode} onClose={(saved) => { setEdit(null); if (saved) refresh(); }} />}
    </>
  );
}

function Summary({ s }: { s: any }) {
  const row = (label: string, v: any, bold = false) => (
    <Table.Tr style={bold ? { fontWeight: 650 } : undefined}><Table.Td>{label}</Table.Td><Table.Td ta="right">{rs(v.taxable ?? 0)}</Table.Td><Table.Td ta="right">{rs(v.igst)}</Table.Td><Table.Td ta="right">{rs(v.cgst)}</Table.Td><Table.Td ta="right">{rs(v.sgst)}</Table.Td><Table.Td ta="right">{rs(v.cess ?? 0)}</Table.Td></Table.Tr>
  );
  return (
    <Stack>
      <Paper withBorder radius="lg" style={{ overflow: 'auto' }}>
        <Table fz="sm" verticalSpacing={8}>
          <Table.Thead><Table.Tr><Table.Th>GSTR-3B</Table.Th><Table.Th ta="right">Taxable value</Table.Th><Table.Th ta="right">IGST</Table.Th><Table.Th ta="right">CGST</Table.Th><Table.Th ta="right">SGST</Table.Th><Table.Th ta="right">Cess</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {row('3.1(a) Outward taxable supplies', s.outward)}
            {row('4(A)(5) Input tax credit – all other ITC', s.itc)}
            {row('Net tax (output − ITC)', { taxable: null, ...s.net }, true)}
          </Table.Tbody>
        </Table>
      </Paper>
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <Paper withBorder p="md" radius="lg"><Text size="sm" fw={600}>Registered clients (B2B)</Text><Text size="xl" fw={700}>{rs(s.outward.b2b.taxable)}</Text><Text size="xs" c="dimmed">{s.outward.b2b.count} invoice(s) – GSTR-1 table 4A</Text></Paper>
        <Paper withBorder p="md" radius="lg"><Text size="sm" fw={600}>Unregistered clients (B2C)</Text><Text size="xl" fw={700}>{rs(s.outward.b2c.taxable)}</Text><Text size="xs" c="dimmed">{s.outward.b2c.count} invoice(s) – GSTR-1 table 7</Text></Paper>
        <Paper withBorder p="md" radius="lg"><Text size="sm" fw={600}>Inter-state / intra-state</Text><Text size="xl" fw={700}>{rs(s.outward.interState)} / {rs(s.outward.intraState)}</Text><Text size="xs" c="dimmed">Taxable value by place of supply</Text></Paper>
      </SimpleGrid>
      {s.itc.ineligible > 0 && <Text size="xs" c="dimmed">Ineligible ITC (not claimed): {rs(s.itc.ineligible)}</Text>}
      <Text size="xs" c="dimmed">Figures are prepared from your invoices and the bills you enter. Your CA should check them, apply set-off rules and file the return on the GST portal.</Text>
    </Stack>
  );
}

function Register({ rows, kind, open, onEdit, onChange }: { rows: any[]; kind: string; open: boolean; onEdit: (r: any) => void; onChange: () => void }) {
  const [showExcluded, setShowExcluded] = useState(false);
  const list = rows.filter((r) => showExcluded || !r.excluded);
  const tot = (f: string) => list.filter((r) => !r.excluded).reduce((a, r) => a + r[f], 0);
  return (
    <Paper withBorder radius="lg" style={{ overflow: 'hidden' }}>
      <div className="lv-scroll">
        <Table striped highlightOnHover fz="sm" verticalSpacing={6} miw={980}>
          <Table.Thead><Table.Tr>
            <Table.Th>{kind === 'sales' ? 'Invoice' : 'Bill'}</Table.Th><Table.Th>Date</Table.Th><Table.Th>{kind === 'sales' ? 'Client' : 'Supplier'}</Table.Th><Table.Th>GSTIN</Table.Th><Table.Th>POS</Table.Th>
            <Table.Th ta="right">Rate</Table.Th><Table.Th ta="right">Taxable</Table.Th><Table.Th ta="right">IGST</Table.Th><Table.Th ta="right">CGST</Table.Th><Table.Th ta="right">SGST</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th />
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {list.map((r) => (
              <Table.Tr key={r.id} style={{ cursor: open ? 'pointer' : undefined, opacity: r.excluded ? 0.45 : 1 }} onClick={() => open && !r.excluded && onEdit(r)}>
                <Table.Td><Group gap={4} wrap="nowrap">{r.doc_no}{r.source === 'manual' && <Badge size="xs" variant="light" color="grape">manual</Badge>}{r.source === 'invoice' && r.edited && !r.excluded && <Badge size="xs" variant="light" color="orange">edited</Badge>}{r.excluded && <Badge size="xs" variant="light" color="gray">excluded</Badge>}{kind === 'purchase' && !r.itc_eligible && <Badge size="xs" variant="light" color="red">no ITC</Badge>}</Group></Table.Td>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>{dmy(r.doc_date)}</Table.Td><Table.Td>{r.party}</Table.Td><Table.Td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.gstin || <Text span size="xs" c="dimmed">unregistered</Text>}</Table.Td>
                <Table.Td>{r.pos}</Table.Td><Table.Td ta="right">{r.rate}%</Table.Td><Table.Td ta="right">{rs(r.taxable)}</Table.Td><Table.Td ta="right">{rs(r.igst)}</Table.Td><Table.Td ta="right">{rs(r.cgst)}</Table.Td><Table.Td ta="right">{rs(r.sgst)}</Table.Td><Table.Td ta="right">{rs(r.total)}</Table.Td>
                <Table.Td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                  {open && r.source === 'invoice' && (r.edited || r.excluded) && <Tooltip label="Undo changes – take the figures from the invoice again"><ActionIcon size="sm" variant="subtle" onClick={async () => { await api(`/gst/rows/${r.id}/reset`, { method: 'POST' }); onChange(); }}><IconRotate size={14} /></ActionIcon></Tooltip>}
                  {open && !r.excluded && <Tooltip label={r.source === 'invoice' ? 'Exclude from this month' : 'Delete row'}><ActionIcon size="sm" variant="subtle" color="red" onClick={async () => { if (!window.confirm(r.source === 'invoice' ? `Exclude ${r.doc_no} from this month's return?` : `Delete ${r.doc_no}?`)) return; await api(`/gst/rows/${r.id}`, { method: 'DELETE' }); onChange(); }}><IconTrash size={14} /></ActionIcon></Tooltip>}
                </Table.Td>
              </Table.Tr>
            ))}
            {!list.length && <Table.Tr><Table.Td colSpan={12}><Text c="dimmed" ta="center" size="sm" p="md">{kind === 'sales' ? 'No invoices issued in this month yet.' : 'No purchase bills entered for this month.'}</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
          {list.length > 1 && <Table.Tfoot><Table.Tr style={{ fontWeight: 650 }}><Table.Td colSpan={6}>Total</Table.Td><Table.Td ta="right">{rs(tot('taxable'))}</Table.Td><Table.Td ta="right">{rs(tot('igst'))}</Table.Td><Table.Td ta="right">{rs(tot('cgst'))}</Table.Td><Table.Td ta="right">{rs(tot('sgst'))}</Table.Td><Table.Td ta="right">{rs(tot('total'))}</Table.Td><Table.Td /></Table.Tr></Table.Tfoot>}
        </Table>
      </div>
      {rows.some((r) => r.excluded) && <Group p="xs"><Switch size="xs" label="Show excluded rows" checked={showExcluded} onChange={(e) => setShowExcluded(e.currentTarget.checked)} /></Group>}
    </Paper>
  );
}

/** Add / edit a row. Tax splits itself into CGST+SGST or IGST from the place of supply; every figure can still be changed. */
function RowModal({ row, period, ownState, onClose }: { row: any; period: string; ownState: string; onClose: (saved: boolean) => void }) {
  const [v, setV] = useState<any>({ cess: 0, ...row });
  const [auto, setAuto] = useState(!row.id);
  const g = v.gstin ? validateGstin(String(v.gstin).trim().toUpperCase()) : null;
  const recalc = (n: any) => {
    if (!auto) return n;
    const pos = n.pos || (n.gstin && n.gstin.length >= 2 ? n.gstin.slice(0, 2) : ownState);
    const tax = Math.round((Number(n.taxable) || 0) * (Number(n.rate) || 0)) / 100;
    const inter = Boolean(pos) && pos !== ownState;
    const half = Math.round((tax / 2) * 100) / 100;
    return { ...n, igst: inter ? tax : 0, cgst: inter ? 0 : half, sgst: inter ? 0 : Math.round((tax - half) * 100) / 100 };
  };
  const set = (patch: any) => setV((x: any) => recalc({ ...x, ...patch }));
  const total = useMemo(() => Math.round(((Number(v.taxable) || 0) + (Number(v.igst) || 0) + (Number(v.cgst) || 0) + (Number(v.sgst) || 0) + (Number(v.cess) || 0)) * 100) / 100, [v]);
  const save = async () => {
    const body = { kind: v.kind, doc_no: v.doc_no, doc_date: v.doc_date, party: v.party, gstin: v.gstin || null, pos: v.pos || null, sac: v.sac || null, rate: Number(v.rate) || 0, taxable: Number(v.taxable) || 0,
      igst: Number(v.igst) || 0, cgst: Number(v.cgst) || 0, sgst: Number(v.sgst) || 0, cess: Number(v.cess) || 0, total, itc_eligible: v.itc_eligible !== false, note: v.note || null };
    if (row.id) await api(`/gst/rows/${row.id}`, { method: 'PUT', body }); else await api(`/gst/${period}/rows`, { body });
    ok('Saved'); onClose(true);
  };
  const purchase = v.kind === 'purchase';
  return (
    <Modal opened onClose={() => onClose(false)} title={`${row.id ? 'Edit' : 'Add'} ${purchase ? 'purchase bill' : 'sales row'}`} size="lg">
      <Stack>
        {row.source === 'invoice' && <Alert variant="light" py={6}>This row comes from invoice {row.doc_no}. Your changes apply to the GST return only – the invoice itself is not changed.</Alert>}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label={purchase ? 'Bill number' : 'Invoice number'} required value={v.doc_no ?? ''} onChange={(e) => set({ doc_no: e.currentTarget.value })} />
          <TextInput label="Date" type="date" required value={v.doc_date ?? ''} onChange={(e) => set({ doc_date: e.currentTarget.value })} />
          <TextInput label={purchase ? 'Supplier' : 'Client'} required value={v.party ?? ''} onChange={(e) => set({ party: e.currentTarget.value })} />
          <TextInput label="GSTIN" placeholder="Leave empty if unregistered" value={v.gstin ?? ''} error={g && !g.ok ? g.message : undefined} onChange={(e) => set({ gstin: e.currentTarget.value.toUpperCase(), pos: '' })} />
          <Select label="Place of supply" searchable clearable data={INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.code} – ${s.name}` }))} value={v.pos || (v.gstin?.length >= 2 ? v.gstin.slice(0, 2) : null)} onChange={(x) => set({ pos: x ?? '' })} />
          <TextInput label="SAC / HSN" placeholder="998346" value={v.sac ?? ''} onChange={(e) => set({ sac: e.currentTarget.value })} />
          <Select label="GST rate" data={['0', '5', '12', '18', '28']} value={String(v.rate ?? 18)} onChange={(x) => set({ rate: Number(x) })} />
          <NumberInput label="Taxable value (₹)" decimalScale={2} thousandSeparator="," value={v.taxable ?? ''} onChange={(x) => set({ taxable: x })} />
        </SimpleGrid>
        <Switch size="xs" label="Work out CGST/SGST or IGST automatically" checked={auto} onChange={(e) => { setAuto(e.currentTarget.checked); if (e.currentTarget.checked) setV((x: any) => recalc(x)); }} />
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          {['igst', 'cgst', 'sgst', 'cess'].map((k) => <NumberInput key={k} label={k.toUpperCase()} decimalScale={2} disabled={auto && k !== 'cess'} value={v[k] ?? 0} onChange={(x) => setV({ ...v, [k]: x })} />)}
        </SimpleGrid>
        <Group justify="space-between"><Text size="sm">Total value: <b>{rs(total)}</b></Text>{purchase && <Switch label="Input tax credit can be claimed" checked={v.itc_eligible !== false} onChange={(e) => setV({ ...v, itc_eligible: e.currentTarget.checked })} />}</Group>
        <TextInput label="Note (optional)" value={v.note ?? ''} onChange={(e) => setV({ ...v, note: e.currentTarget.value })} />
        <Group justify="flex-end"><Button variant="default" onClick={() => onClose(false)}>Cancel</Button><Button onClick={save} disabled={!v.doc_no || !v.doc_date || !v.party || (g ? !g.ok : false)}>Save</Button></Group>
      </Stack>
    </Modal>
  );
}

/** Excel pack in the layout CAs and the GST offline tool expect: Summary, B2B, B2C, SAC summary, Sales register, Purchases. */
async function exportForCa(d: any) {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const B = (v: unknown) => ({ value: v as any, fontWeight: 'bold' as const, backgroundColor: '#DCE8F7' });
  const T = (v: unknown) => ({ value: v === null || v === undefined ? '' : (v as any) });
  const N = (v: number) => ({ value: Math.round((Number(v) || 0) * 100) / 100, type: Number, format: '#,##0.00' });
  const pos = (c: string) => (c ? `${c}-${INDIAN_STATES.find((s) => s.code === c)?.name ?? ''}` : '');
  const dateTxt = (x: string) => new Date(`${x}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
  const sales = d.sales.filter((r: any) => !r.excluded), s = d.summary;
  const invValue = new Map<string, number>(); for (const r of sales) invValue.set(r.doc_no, (invValue.get(r.doc_no) ?? 0) + r.total);
  const summary = [
    [B(`${d.company.name} – GST working for ${monthName(d.period)}`)], [T(`GSTIN: ${d.company.gstin ?? ''}`)], [T(`Prepared ${new Date().toLocaleString('en-IN')} · status: ${STATUS[d.status]?.[1]}`)], [T('')],
    [B('GSTR-3B'), B('Taxable value'), B('IGST'), B('CGST'), B('SGST'), B('Cess')],
    [T('3.1(a) Outward taxable supplies'), N(s.outward.taxable), N(s.outward.igst), N(s.outward.cgst), N(s.outward.sgst), N(s.outward.cess)],
    [T('4(A)(5) ITC – all other'), N(s.itc.taxable), N(s.itc.igst), N(s.itc.cgst), N(s.itc.sgst), N(s.itc.cess)],
    [T('Net (output − ITC), before set-off'), T(''), N(s.net.igst), N(s.net.cgst), N(s.net.sgst), N(s.net.cess)],
    [T('')], [B('Outward split'), B('Invoices'), B('Taxable value')],
    [T('B2B (registered)'), T(s.outward.b2b.count), N(s.outward.b2b.taxable)], [T('B2C (unregistered)'), T(s.outward.b2c.count), N(s.outward.b2c.taxable)],
    [T('Inter-state'), T(''), N(s.outward.interState)], [T('Intra-state'), T(''), N(s.outward.intraState)],
  ];
  const b2b = [[B('GSTIN/UIN of Recipient'), B('Receiver Name'), B('Invoice Number'), B('Invoice date'), B('Invoice Value'), B('Place Of Supply'), B('Reverse Charge'), B('Applicable % of Tax Rate'), B('Invoice Type'), B('E-Commerce GSTIN'), B('Rate'), B('Taxable Value'), B('Cess Amount')],
    ...sales.filter((r: any) => r.gstin).map((r: any) => [T(r.gstin), T(r.party), T(r.doc_no), T(dateTxt(r.doc_date)), N(invValue.get(r.doc_no) ?? r.total), T(pos(r.pos)), T('N'), T(''), T('Regular B2B'), T(''), N(r.rate), N(r.taxable), N(r.cess)])];
  const b2csMap = new Map<string, any>();
  for (const r of sales.filter((x: any) => !x.gstin)) { const k = `${r.pos}|${r.rate}`; const m = b2csMap.get(k) ?? { pos: r.pos, rate: r.rate, taxable: 0, cess: 0 }; m.taxable += r.taxable; m.cess += r.cess; b2csMap.set(k, m); }
  const b2cs = [[B('Type'), B('Place Of Supply'), B('Applicable % of Tax Rate'), B('Rate'), B('Taxable Value'), B('Cess Amount'), B('E-Commerce GSTIN')], ...[...b2csMap.values()].map((m) => [T('OE'), T(pos(m.pos)), T(''), N(m.rate), N(m.taxable), N(m.cess), T('')])];
  const hsn = [[B('HSN/SAC'), B('Description'), B('UQC'), B('Total Quantity'), B('Total Value'), B('Rate'), B('Taxable Value'), B('Integrated Tax Amount'), B('Central Tax Amount'), B('State/UT Tax Amount'), B('Cess Amount')],
    ...s.sac.map((r: any) => [T(r.sac), T('Testing and analysis services'), T('NA'), N(0), N(r.total), N(r.rate), N(r.taxable), N(r.igst), N(r.cgst), N(r.sgst), N(r.cess)])];
  const reg = (rows: any[], purchase: boolean) => [[B(purchase ? 'Bill no.' : 'Invoice no.'), B('Date'), B(purchase ? 'Supplier' : 'Client'), B('GSTIN'), B('Place of supply'), B('SAC'), B('Rate %'), B('Taxable'), B('IGST'), B('CGST'), B('SGST'), B('Cess'), B('Total'), ...(purchase ? [B('ITC eligible')] : [B('Source')]), B('Note')],
    ...rows.filter((r) => !r.excluded).map((r) => [T(r.doc_no), T(dmy(r.doc_date)), T(r.party), T(r.gstin), T(pos(r.pos)), T(r.sac), N(r.rate), N(r.taxable), N(r.igst), N(r.cgst), N(r.sgst), N(r.cess), N(r.total), T(purchase ? (r.itc_eligible ? 'Yes' : 'No') : r.source === 'manual' ? 'Manual' : r.edited ? 'Invoice (edited)' : 'Invoice'), T(r.note ?? '')])];
  const w = (n: number[]) => n.map((width) => ({ width }));
  await (writeExcelFile as any)([
    { data: summary, sheet: 'Summary', columns: w([38, 16, 14, 14, 14, 12]) },
    { data: b2b, sheet: 'b2b', columns: w([20, 34, 18, 13, 14, 22, 9, 10, 13, 10, 7, 14, 11]), stickyRowsCount: 1 },
    { data: b2cs, sheet: 'b2cs', columns: w([8, 22, 10, 7, 14, 11, 10]), stickyRowsCount: 1 },
    { data: hsn, sheet: 'hsn', columns: w([10, 28, 6, 10, 14, 7, 14, 14, 14, 14, 11]), stickyRowsCount: 1 },
    { data: reg(d.sales, false), sheet: 'Sales register', columns: w([18, 12, 34, 18, 20, 9, 7, 14, 12, 12, 12, 10, 14, 16, 30]), stickyRowsCount: 1 },
    { data: reg(d.purchases, true), sheet: 'Purchases (ITC)', columns: w([18, 12, 34, 18, 20, 9, 7, 14, 12, 12, 12, 10, 14, 12, 30]), stickyRowsCount: 1 },
  ]).toFile(`GST ${d.period} ${d.company.name}.xlsx`.replace(/[\\/:*?"<>|]+/g, '-'));
}
