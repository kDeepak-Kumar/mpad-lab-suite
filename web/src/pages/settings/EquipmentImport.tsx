import { useState } from 'react';
import { Alert, Badge, Button, FileButton, Group, Modal, ScrollArea, Stack, Table, Text, Textarea } from '@mantine/core';
import { IconDownload, IconFileSpreadsheet, IconUpload } from '@tabler/icons-react';
import { EQUIPMENT_CATEGORIES, EQUIPMENT_FIELDS } from '@suite/shared';
import { api, ok } from '../../api';
import { readRows } from '../ClientImport';

/** Columns of the equipment & calibration template. * = required. Value columns feed observation-sheet calculations. */
const COLS: { h: string; w: number; ex: string; ex2?: string; note: string }[] = [
  { h: 'Equipment name*', w: 30, ex: 'Example – Proving ring 50 kN', ex2: 'Example – CTM 2000 kN', note: 'Name as you call it in the lab' },
  { h: 'Category', w: 26, ex: 'Proving ring', ex2: 'Compression testing machine', note: 'One of the categories on the "Categories" sheet (decides which calibration values are used). Unknown → Other.' },
  { h: 'Equipment ID', w: 14, ex: 'MPAD/PR/01', ex2: 'MPAD/CTM/01', note: 'Your asset / ID number. Re-importing a row with the same ID updates that equipment.' },
  { h: 'Make / model', w: 20, ex: 'AIMIL', ex2: 'HEICO', note: '' },
  { h: 'Certificate no.', w: 18, ex: 'CAL/2026/1182', ex2: 'CAL/2026/1190', note: 'Calibration certificate number' },
  { h: 'Calibrated on', w: 14, ex: '15-06-2026', ex2: '20-06-2026', note: 'DD-MM-YYYY' },
  { h: 'Calibration due', w: 15, ex: '14-06-2027', ex2: '19-06-2027', note: 'DD-MM-YYYY – expired equipment cannot be used on observation sheets' },
  { h: 'Calibration factor', w: 14, ex: '0.0521', note: 'Proving ring / direct shear: kN per division' },
  { h: 'Correction factor', w: 14, ex: '', ex2: '1.000', note: 'CTM / UTM / flexure machine: multiply reading (1.000 if none)' },
  { h: 'Least count', w: 12, ex: '', note: 'Dial gauge: mm per division' },
  { h: 'Volume', w: 10, ex: '', note: 'Core cutter (cm³), compaction mould (cm³), cylindrical measure (litre)' },
  { h: 'Mass', w: 10, ex: '', note: 'Core cutter / mould (g), cylindrical measure (kg)' },
  { h: 'Readability', w: 12, ex: '', note: 'Balance: g' },
  { h: 'Capacity', w: 10, ex: '', note: 'Hydraulic jack: T' },
  { h: 'Ram area', w: 10, ex: '', note: 'Hydraulic jack: cm²' },
  { h: 'Anvil average rebound', w: 12, ex: '', note: 'Rebound hammer' },
  { h: 'Anvil nominal rebound', w: 12, ex: '', note: 'Rebound hammer (typically 80)' },
  { h: 'Reference transit time', w: 12, ex: '', note: 'UPV calibration rod: µs' },
  { h: 'Mass of sand in cone', w: 12, ex: '', note: 'Sand pouring cylinder: g' },
  { h: 'Sand bulk density', w: 12, ex: '', note: 'Sand pouring cylinder: g/cm³' },
];

async function downloadTemplate() {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const head = COLS.map((c) => ({ value: c.h, fontWeight: 'bold' as const, backgroundColor: c.h.endsWith('*') ? '#FFE8A3' : c.h === 'Calibration factor' || COLS.indexOf(c) > 6 ? '#E3F4EA' : '#DCE8F7' }));
  const ex1 = COLS.map((c) => ({ value: c.ex, textColor: '#888888' }));
  const ex2 = COLS.map((c) => ({ value: c.ex2 ?? '', textColor: '#888888' }));
  const help = [
    [{ value: 'How to fill this sheet', fontWeight: 'bold' as const }],
    [{ value: '1. One row per equipment. Delete the grey example rows (rows starting with "Example" are ignored anyway).' }],
    [{ value: '2. Only "Equipment name" is required. Give the category so the right calibration values are used in calculations.' }],
    [{ value: '3. Fill only the green value columns that apply to that category (see the Categories sheet).' }],
    [{ value: '4. After re-calibration: change the certificate no., dates and values and import again – rows with the same Equipment ID update the existing equipment.' }],
    [{ value: '5. In the app: Equipment → Import → choose this file. Every row is checked before anything is saved.' }],
    [{ value: '' }],
    [{ value: 'Column', fontWeight: 'bold' as const }, { value: 'Notes', fontWeight: 'bold' as const }],
    ...COLS.map((c) => [{ value: c.h }, { value: c.note }]),
  ];
  const cats = [[{ value: 'Category', fontWeight: 'bold' as const }, { value: 'Calibration values used', fontWeight: 'bold' as const }],
    ...EQUIPMENT_CATEGORIES.map((c) => [{ value: c }, { value: (EQUIPMENT_FIELDS[c] ?? []).map((f) => `${f.label}${f.unit ? ` (${f.unit})` : ''}`).join(', ') || '— (certificate and due date only)' }])];
  await (writeExcelFile as any)([
    { data: [head, ex1, ex2], sheet: 'Equipment', columns: COLS.map((c) => ({ width: c.w })), stickyRowsCount: 1 },
    { data: help, sheet: 'Instructions', columns: [{ width: 26 }, { width: 100 }] },
    { data: cats, sheet: 'Categories', columns: [{ width: 34 }, { width: 90 }] },
  ]).toFile('Equipment & calibration import template.xlsx');
}

export function EquipmentImport({ onClose }: { onClose: (imported: boolean) => void }) {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [pasted, setPasted] = useState('');
  const [check, setCheck] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const load = async (file: File | null, text = '') => {
    setBusy(true); setCheck(null);
    try {
      const r = await readRows(file, text);
      if (!r.length) throw new Error('No rows found. Keep the header row (Equipment name, Category, …) as the first row.');
      if (!Object.keys(r[0]).some((k) => /equipment name|^name$|^equipment$/i.test(k.replace('*', '').trim()))) throw new Error('The first row must be the header row with an “Equipment name” column. Use the template.');
      setRows(r); setFileName(file?.name ?? 'pasted rows');
      setCheck(await api('/equipment/import', { body: { rows: r, dryRun: true } }));
    } catch (e) { setCheck({ error: (e as Error).message }); } finally { setBusy(false); }
  };
  const run = async () => {
    setBusy(true);
    try { const r = await api<any>('/equipment/import', { body: { rows, dryRun: false } }); ok(`Imported: ${r.summary.added} new, ${r.summary.updated} updated`); onClose(true); }
    finally { setBusy(false); }
  };
  const s = check?.summary;
  return (
    <Modal opened onClose={() => onClose(false)} title="Import equipment & calibration" size="xl">
      <Stack>
        <Alert variant="light" icon={<IconFileSpreadsheet />}>
          <b>1.</b> Download the template and fill it in Excel – name, category, ID, certificate, calibration dates and the calibration values.<br />
          <b>2.</b> Upload the file (.xlsx or .csv), or copy the rows in Excel and paste them below.<br />
          <b>3.</b> Check the result, then click Import. Rows with an existing Equipment ID update that equipment (handy after yearly re-calibration).
        </Alert>
        <Group>
          <Button variant="default" leftSection={<IconDownload size={16} />} onClick={downloadTemplate}>Download template (.xlsx)</Button>
          <FileButton accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(f) => load(f)}>
            {(p) => <Button leftSection={<IconUpload size={16} />} loading={busy} {...p}>Upload filled file</Button>}
          </FileButton>
        </Group>
        <Textarea label="…or paste rows from Excel (include the header row)" autosize minRows={2} maxRows={6} value={pasted} onChange={(e) => setPasted(e.currentTarget.value)}
          placeholder="Equipment name*	Category	Equipment ID	…" styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }} />
        {pasted.trim() && <Group><Button size="xs" variant="light" loading={busy} onClick={() => load(null, pasted)}>Check pasted rows</Button></Group>}
        {check?.error && <Alert color="red" variant="light">{check.error}</Alert>}
        {s && (
          <>
            <Group gap="xs">
              <Text size="sm" fw={600}>{fileName}:</Text>
              <Badge variant="light" color="teal">{s.added} new</Badge>
              <Badge variant="light">{s.updated} to update</Badge>
              {s.errors > 0 && <Badge variant="filled" color="red">{s.errors} row{s.errors === 1 ? '' : 's'} with errors</Badge>}
            </Group>
            <ScrollArea.Autosize mah={320}>
              <Table striped fz="sm" verticalSpacing={4}>
                <Table.Thead><Table.Tr><Table.Th w={60}>Row</Table.Th><Table.Th>Equipment</Table.Th><Table.Th w={110}>Result</Table.Th><Table.Th>Details</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>{check.results.map((r: any) => (
                  <Table.Tr key={r.row}><Table.Td>{r.row}</Table.Td><Table.Td>{r.name}</Table.Td>
                    <Table.Td><Badge size="sm" variant="light" color={r.status === 'error' ? 'red' : r.status === 'new' ? 'teal' : r.status === 'update' ? 'blue' : 'gray'}>{r.status}</Badge></Table.Td>
                    <Table.Td><Text size="xs" c={r.status === 'error' ? 'red' : 'dimmed'}>{r.message ?? ''}</Text></Table.Td></Table.Tr>))}</Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
            {s.errors > 0 && <Text size="xs" c="dimmed">Fix the rows in red and upload again, or import now – rows with errors are skipped.</Text>}
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={() => onClose(false)}>Cancel</Button>
          <Button loading={busy} disabled={!s || s.added + s.updated === 0} onClick={run}>Import {s ? `${s.added + s.updated} row${s.added + s.updated === 1 ? '' : 's'}` : ''}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
