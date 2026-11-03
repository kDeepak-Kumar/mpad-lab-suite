import { useState } from 'react';
import { Alert, Badge, Button, FileButton, Group, Modal, ScrollArea, Stack, Table, Text, Textarea } from '@mantine/core';
import { IconDownload, IconFileSpreadsheet, IconUpload } from '@tabler/icons-react';
import { api, ok, parseCsv } from '../api';

/** Columns of the client import template, in order. * = required. */
const COLS: { h: string; w: number; ex: string; ex2?: string; note: string }[] = [
  { h: 'Client name*', w: 34, ex: 'Example Infra Projects Pvt Ltd', ex2: 'Example Infra Projects Pvt Ltd', note: 'Legal name. Repeat the same name on more rows to add more sites or contacts.' },
  { h: 'Short code', w: 12, ex: 'EIPL', note: 'Used in job codes, e.g. MPAD/EIPL/0001' },
  { h: 'Type', w: 12, ex: 'company', note: 'company, government, individual or walkin (default company)' },
  { h: 'GSTIN', w: 18, ex: '36AAACE1234F1Z5', note: 'State and PAN are filled from the GSTIN automatically' },
  { h: 'PAN', w: 12, ex: '', note: 'Only if there is no GSTIN' },
  { h: 'State', w: 14, ex: '', note: 'GST state code (36) or name (Telangana) – needed only without GSTIN' },
  { h: 'Billing address', w: 40, ex: 'Plot 12, Hitech City, Hyderabad - 500081', note: '' },
  { h: 'Email', w: 26, ex: 'accounts@example.com', note: '' },
  { h: 'Phone', w: 14, ex: '9876543210', note: '' },
  { h: 'Payment terms (days)', w: 10, ex: '30', note: '' },
  { h: 'Discount %', w: 10, ex: '5', note: 'Default discount on quotes and invoices' },
  { h: 'Opening balance', w: 14, ex: '0', note: 'Amount already due from this client (₹)' },
  { h: 'Notes', w: 24, ex: '', note: '' },
  { h: 'Site name', w: 26, ex: 'Data centre – Shamshabad', ex2: 'Office tower – Kokapet', note: 'Optional project / site' },
  { h: 'Site address', w: 34, ex: 'Survey 45, Shamshabad', ex2: 'Kokapet, Hyderabad', note: '' },
  { h: 'Site project', w: 24, ex: 'DC Phase 1', note: '' },
  { h: 'Site PO / WO no.', w: 16, ex: '', note: '' },
  { h: 'Contact name', w: 20, ex: 'Mr. Ravi Kumar', ex2: 'Ms. Anita Rao', note: 'Optional contact person' },
  { h: 'Contact role', w: 16, ex: 'QA/QC Engineer', ex2: 'Accounts', note: '' },
  { h: 'Contact phone', w: 14, ex: '9876500001', ex2: '9876500002', note: '' },
  { h: 'Contact email', w: 26, ex: 'ravi@example.com', ex2: 'anita@example.com', note: '' },
];

async function downloadTemplate() {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const head = COLS.map((c) => ({ value: c.h, fontWeight: 'bold' as const, backgroundColor: c.h.endsWith('*') ? '#FFE8A3' : '#DCE8F7' }));
  const ex1 = COLS.map((c) => ({ value: c.ex, textColor: '#888888' }));
  const ex2 = COLS.map((c) => ({ value: c.ex2 ?? '', textColor: '#888888' }));
  const help = [
    [{ value: 'How to fill this sheet', fontWeight: 'bold' as const }],
    [{ value: '1. One row per client. Delete the two grey example rows (rows starting with "Example" are ignored anyway).' }],
    [{ value: '2. Only "Client name" is required. Give a GSTIN, or a State if the client has no GSTIN.' }],
    [{ value: '3. To add several sites or contacts for one client, repeat the client name on new rows and fill only the site/contact columns.' }],
    [{ value: '4. Clients that already exist (same name or GSTIN) are not changed – only their new sites and contacts are added.' }],
    [{ value: '5. Save, then in the app: Clients → Import → choose this file. You will see a check of every row before anything is saved.' }],
    [{ value: '' }],
    [{ value: 'Column', fontWeight: 'bold' as const }, { value: 'Notes', fontWeight: 'bold' as const }],
    ...COLS.map((c) => [{ value: c.h }, { value: c.note }]),
  ];
  await (writeExcelFile as any)([
    { data: [head, ex1, ex2], sheet: 'Clients', columns: COLS.map((c) => ({ width: c.w })), stickyRowsCount: 1 },
    { data: help, sheet: 'Instructions', columns: [{ width: 26 }, { width: 90 }] },
  ]).toFile('Client import template.xlsx');
}

/** Rows from .xlsx, .csv or text pasted from Excel (tab separated) → objects keyed by header. */
async function readRows(file: File | null, pasted: string): Promise<Record<string, string>[]> {
  const toObjects = (grid: unknown[][]) => {
    const [h, ...body] = grid.filter((r) => r.some((x) => String(x ?? '').trim() !== ''));
    if (!h) return [];
    const keys = h.map((x) => String(x ?? '').trim());
    return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] === null || r[i] === undefined ? '' : String(r[i]).trim()])));
  };
  if (file && /\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/universal');
    return toObjects((await readSheet(await file.arrayBuffer())) as unknown[][]);
  }
  const text = file ? await file.text() : pasted;
  if (text.includes('\t')) return toObjects(text.replace(/\r/g, '').split('\n').map((l) => l.split('\t')));
  return parseCsv(text).map((r) => r);
}

export function ClientImport({ onClose }: { onClose: (imported: boolean) => void }) {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [pasted, setPasted] = useState('');
  const [check, setCheck] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const load = async (file: File | null, text = '') => {
    setBusy(true); setCheck(null);
    try {
      const r = await readRows(file, text);
      if (!r.length) throw new Error('No rows found. Keep the header row (Client name, GSTIN, …) as the first row.');
      if (!Object.keys(r[0]).some((k) => /client name|^name$/i.test(k.replace('*', '').trim()))) throw new Error('The first row must be the header row with a “Client name” column. Use the template.');
      setRows(r); setFileName(file?.name ?? 'pasted rows');
      setCheck(await api('/clients/import', { body: { rows: r, dryRun: true } }));
    } catch (e) { setCheck({ error: (e as Error).message }); } finally { setBusy(false); }
  };
  const run = async () => {
    setBusy(true);
    try { const r = await api<any>('/clients/import', { body: { rows, dryRun: false } }); ok(`Imported ${r.summary.newClients} client(s), ${r.summary.sites} site(s), ${r.summary.contacts} contact(s)`); onClose(true); }
    finally { setBusy(false); }
  };
  const s = check?.summary;
  return (
    <Modal opened onClose={() => onClose(false)} title="Import clients" size="xl">
      <Stack>
        <Alert variant="light" icon={<IconFileSpreadsheet />}>
          <b>1.</b> Download the template and fill it in Excel (one row per client; repeat the name to add more sites or contacts).<br />
          <b>2.</b> Upload the file (.xlsx or .csv), or copy the rows in Excel and paste them below.<br />
          <b>3.</b> Check the result, then click Import. Nothing is saved until you do.
        </Alert>
        <Group>
          <Button variant="default" leftSection={<IconDownload size={16} />} onClick={downloadTemplate}>Download template (.xlsx)</Button>
          <FileButton accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(f) => load(f)}>
            {(p) => <Button leftSection={<IconUpload size={16} />} loading={busy} {...p}>Upload filled file</Button>}
          </FileButton>
        </Group>
        <Textarea label="…or paste rows from Excel (include the header row)" autosize minRows={2} maxRows={6} value={pasted} onChange={(e) => setPasted(e.currentTarget.value)}
          placeholder="Client name*	Short code	Type	GSTIN …" styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }} />
        {pasted.trim() && <Group><Button size="xs" variant="light" loading={busy} onClick={() => load(null, pasted)}>Check pasted rows</Button></Group>}
        {check?.error && <Alert color="red" variant="light">{check.error}</Alert>}
        {s && (
          <>
            <Group gap="xs">
              <Text size="sm" fw={600}>{fileName}:</Text>
              <Badge variant="light" color="teal">{s.newClients} new client{s.newClients === 1 ? '' : 's'}</Badge>
              <Badge variant="light">{s.sites} site{s.sites === 1 ? '' : 's'}</Badge>
              <Badge variant="light">{s.contacts} contact{s.contacts === 1 ? '' : 's'}</Badge>
              {s.errors > 0 && <Badge variant="filled" color="red">{s.errors} row{s.errors === 1 ? '' : 's'} with errors</Badge>}
            </Group>
            <ScrollArea.Autosize mah={320}>
              <Table striped fz="sm" verticalSpacing={4}>
                <Table.Thead><Table.Tr><Table.Th w={60}>Row</Table.Th><Table.Th>Client</Table.Th><Table.Th w={130}>Result</Table.Th><Table.Th>Details</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {check.results.map((r: any) => (
                    <Table.Tr key={r.row}>
                      <Table.Td>{r.row}</Table.Td><Table.Td>{r.client}</Table.Td>
                      <Table.Td><Badge size="sm" variant="light" color={r.status === 'error' ? 'red' : r.status === 'new client' ? 'teal' : 'gray'}>{r.status}</Badge></Table.Td>
                      <Table.Td><Text size="xs" c={r.status === 'error' ? 'red' : 'dimmed'}>{r.message ?? (r.added.length ? `adds ${r.added.join(', ')}` : r.status === 'existing client' ? 'already exists – no change' : '')}</Text></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
            {s.errors > 0 && <Text size="xs" c="dimmed">Fix the rows in red in your file and upload it again, or import now – rows with errors are skipped.</Text>}
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={() => onClose(false)}>Cancel</Button>
          <Button loading={busy} disabled={!s || (s.newClients + s.sites + s.contacts === 0)} onClick={run}>Import {s ? `${s.newClients} client${s.newClients === 1 ? '' : 's'}` : ''}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
