import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, FileButton, Group, Paper, ScrollArea, SegmentedControl, Stack, Table, Tabs, Text, TextInput, Tooltip } from '@mantine/core';
import { IconCalendar, IconChecks, IconDownload, IconFileSpreadsheet, IconUpload } from '@tabler/icons-react';
import { api, downloadCsv, localToday, ok, useApi } from '../api';
import { useCan } from '../ctx';
import { PageHeader } from '../components/ui';
import { readRows } from './ClientImport';

export const ST: { key: string; label: string; color: string }[] = [
  { key: 'P', label: 'Present', color: 'teal' }, { key: 'A', label: 'Absent', color: 'red' }, { key: 'HD', label: 'Half day', color: 'yellow' }, { key: 'L', label: 'Leave', color: 'violet' },
  { key: 'WO', label: 'Weekly off', color: 'gray' }, { key: 'H', label: 'Holiday', color: 'blue' }, { key: 'OD', label: 'On duty', color: 'cyan' },
];
const stColor = (k?: string) => ST.find((s) => s.key === k)?.color ?? 'gray';
type Rec = { employee_id: number; date: string; status: string; in_time?: string | null; out_time?: string | null; note?: string | null };

export function AttendancePage() {
  const can = useCan();
  const marker = can('manageEmployees') || can('markAttendance');
  return (
    <>
      <PageHeader title="Attendance" subtitle="Daily register, monthly view and upload from a spreadsheet or biometric export" />
      <Tabs defaultValue={marker ? 'daily' : 'month'}>
        <Tabs.List mb="md">{marker && <Tabs.Tab value="daily" leftSection={<IconChecks size={15} />}>Daily register</Tabs.Tab>}<Tabs.Tab value="month" leftSection={<IconCalendar size={15} />}>Monthly</Tabs.Tab>{marker && <Tabs.Tab value="upload" leftSection={<IconUpload size={15} />}>Upload</Tabs.Tab>}</Tabs.List>
        {marker && <Tabs.Panel value="daily"><Daily /></Tabs.Panel>}
        <Tabs.Panel value="month"><MonthGrid initialMonth={localToday().slice(0, 7)} /></Tabs.Panel>
        {marker && <Tabs.Panel value="upload"><Upload /></Tabs.Panel>}
      </Tabs>
    </>
  );
}

function Daily() {
  const [date, setDate] = useState(localToday());
  const { data, reload } = useApi<{ employees: any[]; records: Rec[] }>(`/attendance?date=${date}`, [date]);
  const [rows, setRows] = useState<Record<number, Rec>>({});
  const [busy, setBusy] = useState(false);
  const active = (data?.employees ?? []).filter((e) => e.status !== 'left' && (!e.date_of_joining || e.date_of_joining <= date));
  useEffect(() => { if (data) setRows(Object.fromEntries(data.records.map((r) => [r.employee_id, r]))); }, [data]);
  const set = (id: number, p: Partial<Rec>) => setRows((r) => ({ ...r, [id]: { ...(r[id] ?? { employee_id: id, date, status: 'P' }), ...p, employee_id: id, date } }));
  const dirty = active.some((e) => JSON.stringify(rows[e.id] ?? null) !== JSON.stringify(data?.records.find((r) => r.employee_id === e.id) ?? null));
  const save = async () => {
    const list = active.map((e) => rows[e.id]).filter(Boolean).map((r) => ({ employee_id: r.employee_id, date, status: r.status, in_time: r.in_time || null, out_time: r.out_time || null, note: r.note || null }));
    if (!list.length) return;
    setBusy(true); try { const r = await api<any>('/attendance', { method: 'PUT', body: { rows: list } }); ok(`Saved ${r.created + r.updated} entr${r.created + r.updated === 1 ? 'y' : 'ies'}`); reload(); } catch { /* shown */ } finally { setBusy(false); }
  };
  const unmarked = active.filter((e) => !rows[e.id]).length;
  return (
    <Paper withBorder radius="lg" p="md">
      <Group justify="space-between" mb="md" wrap="wrap">
        <Group><TextInput type="date" label="Date" value={date} max={localToday()} onChange={(e) => e.currentTarget.value && setDate(e.currentTarget.value)} />
          <Text size="sm" c="dimmed" mt={22}>{active.length} employees · {unmarked ? `${unmarked} not marked` : 'all marked'}</Text></Group>
        <Group mt={22}>
          <Button variant="default" onClick={() => active.forEach((e) => !rows[e.id] && set(e.id, { status: 'P' }))} disabled={!unmarked}>Mark the rest present</Button>
          <Button onClick={save} loading={busy} disabled={!dirty}>Save register</Button>
        </Group>
      </Group>
      {!active.length ? <Text size="sm" c="dimmed">No employees yet – add them under Employees.</Text> : (
        <Table.ScrollContainer minWidth={760}>
          <Table verticalSpacing={6}>
            <Table.Thead><Table.Tr><Table.Th>Employee</Table.Th><Table.Th>Status</Table.Th><Table.Th w={110}>In</Table.Th><Table.Th w={110}>Out</Table.Th><Table.Th>Note</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{active.map((e) => { const r = rows[e.id]; return (
              <Table.Tr key={e.id}>
                <Table.Td><Text size="sm" fw={550}>{e.name}</Text><Text size="xs" c="dimmed">{[e.code, e.designation].filter(Boolean).join(' · ')}</Text></Table.Td>
                <Table.Td><SegmentedControl size="xs" value={r?.status ?? ''} onChange={(s) => set(e.id, { status: s })} data={ST.map((s) => ({ value: s.key, label: <Tooltip label={s.label}><span>{s.key}</span></Tooltip> }))} color={stColor(r?.status)} /></Table.Td>
                <Table.Td><TextInput size="xs" type="time" value={r?.in_time ?? ''} onChange={(ev) => set(e.id, { in_time: ev.currentTarget.value, status: r?.status ?? 'P' })} /></Table.Td>
                <Table.Td><TextInput size="xs" type="time" value={r?.out_time ?? ''} onChange={(ev) => set(e.id, { out_time: ev.currentTarget.value, status: r?.status ?? 'P' })} /></Table.Td>
                <Table.Td><TextInput size="xs" placeholder="optional" value={r?.note ?? ''} onChange={(ev) => set(e.id, { note: ev.currentTarget.value, status: r?.status ?? 'P' })} /></Table.Td>
              </Table.Tr>); })}</Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <Group gap={6} mt="sm">{ST.map((s) => <Badge key={s.key} variant="light" color={s.color} style={{ textTransform: 'none' }}>{s.key} = {s.label}</Badge>)}</Group>
    </Paper>
  );
}

/** Month matrix: employees × days with totals; one employee when employeeId is given. */
export function MonthGrid({ employeeId, initialMonth }: { employeeId?: number; initialMonth: string }) {
  const [month, setMonth] = useState(initialMonth);
  const { data } = useApi<{ employees: any[]; records: Rec[] }>(`/attendance?month=${month}${employeeId ? `&employee=${employeeId}` : ''}`, [month, employeeId]);
  const days = useMemo(() => { const [y, m] = month.split('-').map(Number); const n = new Date(Date.UTC(y, m, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`); }, [month]);
  const by = useMemo(() => new Map((data?.records ?? []).map((r) => [`${r.employee_id}|${r.date}`, r])), [data]);
  const emps = (data?.employees ?? []).filter((e) => e.status !== 'left' || (e.left_on && e.left_on >= `${month}-01`));
  const total = (id: number, k: string) => days.filter((d) => by.get(`${id}|${d}`)?.status === k).length;
  const paid = (id: number) => total(id, 'P') + total(id, 'OD') + total(id, 'WO') + total(id, 'H') + total(id, 'L') + total(id, 'HD') * 0.5;
  const exportCsv = () => downloadCsv(`attendance-${month}.csv`, [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Employee' }, ...days.map((d) => ({ key: d, label: d.slice(8) })), ...ST.map((s) => ({ key: `t_${s.key}`, label: s.label })), { key: 'paid', label: 'Paid days' }],
    emps.map((e) => ({ code: e.code, name: e.name, ...Object.fromEntries(days.map((d) => [d, by.get(`${e.id}|${d}`)?.status ?? ''])), ...Object.fromEntries(ST.map((s) => [`t_${s.key}`, total(e.id, s.key)])), paid: paid(e.id) })));
  const td = localToday();
  return (
    <Paper withBorder radius="lg" p="md">
      <Group justify="space-between" mb="sm"><TextInput type="month" label="Month" value={month} onChange={(e) => e.currentTarget.value && setMonth(e.currentTarget.value)} />
        <Button mt={22} variant="default" leftSection={<IconDownload size={16} />} onClick={exportCsv} disabled={!emps.length}>Export (Excel / CSV)</Button></Group>
      {!emps.length ? <Text size="sm" c="dimmed">No attendance to show.</Text> : (
        <ScrollArea>
          <table className="att-grid">
            <thead><tr><th className="att-name">Employee</th>{days.map((d) => { const wd = new Date(d + 'T00:00:00').getDay(); return <th key={d} className={wd === 0 ? 'sun' : ''}>{Number(d.slice(8))}<div>{'SMTWTFS'[wd]}</div></th>; })}
              <th>P</th><th>A</th><th>L</th><th>HD</th><th title="Paid days: present, on duty, leave, weekly off, holidays, half days ×0.5">Paid</th></tr></thead>
            <tbody>{emps.map((e) => (
              <tr key={e.id}><td className="att-name"><Text size="sm" fw={550} truncate>{e.name}</Text></td>
                {days.map((d) => { const r = by.get(`${e.id}|${d}`); return <td key={d} title={r ? `${ST.find((s) => s.key === r.status)?.label}${r.in_time ? ` · ${r.in_time}–${r.out_time ?? ''}` : ''}${r.note ? ` · ${r.note}` : ''}` : d > td ? '' : 'Not marked'}>
                  {r ? <span className={`att-c att-${stColor(r.status)}`}>{r.status}</span> : d <= td ? <span className="att-c att-none">·</span> : null}</td>; })}
                <td className="num">{total(e.id, 'P')}</td><td className="num">{total(e.id, 'A')}</td><td className="num">{total(e.id, 'L')}</td><td className="num">{total(e.id, 'HD')}</td><td className="num"><b>{paid(e.id)}</b></td></tr>))}
            </tbody>
          </table>
        </ScrollArea>
      )}
    </Paper>
  );
}

function Upload() {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [check, setCheck] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const template = async () => {
    const { default: writeExcelFile } = await import('write-excel-file/browser');
    const head = ['Employee code', 'Employee name', 'Date', 'Status', 'In time', 'Out time', 'Note'].map((v) => ({ value: v, fontWeight: 'bold' as const, backgroundColor: '#DCE8F7' }));
    const ex = [['E001', 'Example – Ravi Kumar', '03-11-2026', 'P', '09:05', '18:10', ''], ['E002', 'Example – Suma', '03-11-2026', 'L', '', '', 'Casual leave']].map((r) => r.map((v) => ({ value: v, textColor: '#888888' })));
    const help = [['Status codes: P present, A absent, HD half day, L leave, WO weekly off, H holiday, OD on duty.'], ['Status can be left empty when In time is given (then P), or for biometric exports with only punch times.'], ['Match is by Employee code first, then by exact name. Dates DD-MM-YYYY. Re-uploading the same day updates it.'], ['Rows starting with "Example" are ignored.']].map((r) => r.map((v) => ({ value: v })));
    await (writeExcelFile as any)([{ data: [head, ...ex], sheet: 'Attendance', columns: [{ width: 14 }, { width: 26 }, { width: 12 }, { width: 8 }, { width: 10 }, { width: 10 }, { width: 24 }] }, { data: help, sheet: 'Instructions', columns: [{ width: 110 }] }]).toFile('Attendance upload template.xlsx');
  };
  const load = async (f: File | null) => { if (!f) return; setCheck(null); const r = (await readRows(f, "")).filter((x: Record<string, string>) => !Object.values(x).some((v) => /^example/i.test(String(v ?? '')))); setRows(r); setBusy(true); try { setCheck(await api('/attendance/import', { body: { rows: r, dryRun: true } })); } finally { setBusy(false); } };
  const run = async () => { setBusy(true); try { const r = await api<any>('/attendance/import', { body: { rows, dryRun: false } }); ok(`Imported: ${r.created} new, ${r.updated} updated`); setRows(null); setCheck(null); } finally { setBusy(false); } };
  return (
    <Paper withBorder radius="lg" p="md" maw={820}>
      <Stack>
        <Text size="sm">Upload an Excel or CSV file – our template, or the export from your biometric / attendance machine (columns for employee code or name, date, and status or in/out times are recognised).</Text>
        <Group><Button variant="default" leftSection={<IconFileSpreadsheet size={16} />} onClick={template}>Download template</Button>
          <FileButton accept=".xlsx,.csv" onChange={load}>{(p) => <Button leftSection={<IconUpload size={16} />} loading={busy} {...p}>Choose file</Button>}</FileButton></Group>
        {check && (check.errorCount ? (
          <Alert color="red" variant="light" title={`${check.errorCount} row(s) need fixing – nothing was saved`}>
            <Stack gap={2}>{check.errors.slice(0, 15).map((e: any) => <Text key={e.row} size="sm">Row {e.row}: {e.error}</Text>)}</Stack>
          </Alert>
        ) : (
          <Alert color="teal" variant="light" title={`${check.valid} entr${check.valid === 1 ? 'y' : 'ies'} ready to import`}>
            <Text size="sm" mb="xs">Existing entries for the same employee and day are updated.</Text>
            <Button onClick={run} loading={busy}>Import {check.valid} entries</Button>
          </Alert>
        ))}
        {rows && !rows.length && <Alert color="orange" variant="light">The file has no rows.</Alert>}
      </Stack>
    </Paper>
  );
}
