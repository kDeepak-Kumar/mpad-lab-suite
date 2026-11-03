import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Checkbox, Grid, Group, Paper, Select, SimpleGrid, Stack, Tabs, Text, TextInput, Textarea, Timeline, Modal, Badge, List, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconPrinter } from '@tabler/icons-react';
import { emptyInput, evaluateObservation, normalizeObservation, parseNumberInput, reportParts, formatValue, chartSeries, allCharts, fillRefs, boreLogData, renderSampleCalc, TEST_STATUS_LABEL, type ObservationInput, type ObservationTemplate } from '@suite/shared';
import { api, dmy, ok, useApi, localToday } from '../api';
import { useMe, hasRole } from '../App';
import { useCan, isAdmin } from '../ctx';
import { ListView } from '../components/ListView';
import { PageHeader, SimpleTable, StatusBadge, Loading } from '../components/ui';
import { LineChart } from '../doc/Chart';
import { BoreLog, SoilLegend } from '../doc/BoreLog';

export function TestsPage() {
  const me = useMe();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? (me.user.role === 'technician' ? 'mine' : ['reviewer', 'signatory'].includes(me.user.role) ? 'review' : 'open');
  const q = tab === 'mine' ? '?mine=1&status=pending,in_progress,returned' : tab === 'open' ? '?status=pending,in_progress,returned' : tab === 'review' ? '?status=submitted' : tab === 'accepted' ? '?status=accepted' : '';
  const { data } = useApi<any[]>(`/tests${q}`, [tab]);
  const nav = useNavigate();
  const today = localToday();
  return (
    <>
      <PageHeader title="Tests & observation sheets" subtitle="Technicians enter observations; reviewers accept or return them" />
      <Tabs value={tab} onChange={(t) => setSp({ tab: t ?? 'open' })} mb="sm">
        <Tabs.List><Tabs.Tab value="mine">My tests</Tabs.Tab><Tabs.Tab value="open">All open</Tabs.Tab><Tabs.Tab value="review">To review</Tabs.Tab><Tabs.Tab value="accepted">Accepted</Tabs.Tab><Tabs.Tab value="all">All</Tabs.Tab></Tabs.List>
      </Tabs>
      <ListView id={`tests-${tab}`} rows={data} onRow={(t) => nav(`/tests/${t.id}`)} columns={[
        { key: 'test', label: 'Test', value: (t) => t.report_name || t.billing_name, render: (t) => <Text size="sm" fw={550}>{t.report_name || t.billing_name}</Text>, filter: 'select' },
        { key: 'sample_code', label: 'Job code' }, { key: 'accreditation', label: 'Type', type: 'badge' }, { key: 'client_name', label: 'Client', filter: 'select' },
        { key: 'assignee', label: 'Assigned', filter: 'select' },
        { key: 'due_date', label: 'Due', type: 'date', render: (t) => <Text size="sm" c={t.due_date && t.due_date < today && ['pending', 'in_progress', 'returned'].includes(t.status) ? 'red' : undefined}>{dmy(t.due_date)}</Text> },
        { key: 'status', label: 'Status', type: 'status' }]} />
    </>
  );
}

export function TestSheetPage() {
  const { id } = useParams();
  const me = useMe();
  const can = useCan();
  const admin = isAdmin(me as never);
  const nav = useNavigate();
  const { data: t, reload } = useApi<any>(`/tests/${id}`, [id]);
  const [obs, setObs] = useState<ObservationInput | null>(null);
  const [dates, setDates] = useState<{ started_at: string; completed_at: string }>({ started_at: '', completed_at: '' });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);

  useEffect(() => {
    if (!t) return;
    const tpl = t.template as ObservationTemplate;
    const base = emptyInput(tpl);
    const saved = t.observation as ObservationInput | null;
    setObs(saved ? { ...base, ...saved, grids: { ...base.grids, ...(saved.grids ?? {}) } } : base);
    setDates({ started_at: t.started_at ?? localToday(), completed_at: t.completed_at ?? '' });
    setDirty(false);
  }, [t]);

  const tpl = t?.template as ObservationTemplate | undefined;
  const result = useMemo(() => {
    if (!tpl || !obs) return null;
    // use the selected equipment's calibration data live
    const eq: ObservationInput['equipment'] = {};
    for (const slot of tpl.equipment ?? []) {
      const sel = obs.equipment?.[slot.key]; const e = t.equipment.find((x: any) => x.id === sel?.id);
      // locked sheets keep the calibration values they were saved with
      const locked = !['pending', 'in_progress', 'returned'].includes(t.status) && sel?.data && Object.keys(sel.data).length;
      eq[slot.key] = locked ? sel! : e ? { id: e.id, name: e.name, data: e.data ?? {} } : null;
    }
    return evaluateObservation(tpl, { ...obs, equipment: eq });
  }, [tpl, obs, t]);

  if (!t || !obs || !tpl || !result) return <Loading />;
  const editable = (['pending', 'in_progress', 'returned'].includes(t.status) && can('enterObservations')) || (admin && t.status !== 'reported');
  const canReview = (t.status === 'submitted' || (admin && ['in_progress', 'returned'].includes(t.status))) && can('reviewTests');
  const setHeader = (k: string, v: any) => { setObs({ ...obs, header: { ...obs.header, [k]: v } }); setDirty(true); };
  // keep exactly what is typed ("12.", "0.0", "-") – numbers are read when calculating and saving
  const setConst = (k: string, v: string) => { const c = { ...(obs.constants ?? {}) }; if (v === '') delete c[k]; else c[k] = v as never; setObs({ ...obs, constants: c }); setDirty(true); };
  const setCell = (g: string, i: number, k: string, v: string, text = false) => {
    const rows = [...(obs.grids[g] ?? [])]; rows[i] = { ...rows[i], [k]: v === '' ? null : v };
    void text;
    setObs({ ...obs, grids: { ...obs.grids, [g]: rows } }); setDirty(true);
  };
  const save = async (reason?: string) => {
    setBusy(true);
    try {
      const r = await api<any>(`/tests/${t.id}/observation`, { method: 'PUT', body: { observation: normalizeObservation(tpl!, obs).input, started_at: dates.started_at || null, completed_at: dates.completed_at || null, reason } });
      setDirty(false); ok('Observation sheet saved'); await reload(); return r;
    } finally { setBusy(false); }
  };
  const submit = async () => {
    if (dirty || t.status === 'pending') await save();
    await api(`/tests/${t.id}/submit`, { method: 'POST' }); ok('Submitted for review'); reload();
  };
  const review = async (action: 'accept' | 'return', note?: string) => {
    if (dirty) await save();
    await api(`/tests/${t.id}/review`, { body: { action, note } }); ok(action === 'accept' ? 'Accepted – ready for the report' : 'Returned to the technician'); reload();
  };
  const inputIssues = normalizeObservation(tpl, obs).issues;
  const errors = [...result.checks.filter((c) => c.level === 'error'), ...inputIssues.map((m) => ({ level: 'error' as const, message: m }))];
  const s = t.sample;

  return (
    <>
      <PageHeader title={<Group gap="sm">{t.catalog?.report_name || tpl.name}<StatusBadge status={t.status} />{tpl.simplified && <Badge color="yellow" variant="light">Simplified sheet</Badge>}</Group>}
        subtitle={<>{s.code} · {t.client?.name}{t.site ? ` · ${t.site.name}` : ''} · {tpl.method}</>}
        actions={<>
          <Button className="hide-mobile" variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>Print sheet</Button>
          {can('manageTemplates') && <Button className="hide-mobile" variant="subtle" onClick={() => nav(`/settings/templates/obs/${encodeURIComponent(tpl.code)}`)}>Edit sheet template</Button>}
          {editable && <Button variant="default" loading={busy} disabled={!dirty} onClick={() => (t.status === 'returned' ? setReasonOpen(true) : save())}>Save</Button>}
          {editable && ['pending', 'in_progress', 'returned'].includes(t.status) && <Button loading={busy} disabled={errors.length > 0 && !admin} onClick={async () => { if (t.status === 'returned' && dirty) setReasonOpen(true); else await submit(); }}>Submit for review</Button>}
          {canReview && <Button variant="default" color="red" onClick={() => setReturnOpen(true)}>Return for correction</Button>}
          {canReview && <Button color="teal" onClick={() => review('accept')}>Accept</Button>}
          {t.status === 'accepted' && can('prepareReports') && <Button onClick={() => nav('/reports/prepare')}>Prepare report</Button>}
          {t.report_id && <Button variant="light" onClick={() => nav(`/documents/${t.report_id}`)}>Open report</Button>}
        </>} />
      {t.status === 'returned' && t.review_note && <Alert color="red" mb="sm" title={`Returned by ${t.reviewedBy ?? 'reviewer'}`}>{t.review_note}</Alert>}
      {t.status === 'submitted' && !canReview && <Alert mb="sm">Submitted on {new Date(t.submitted_at).toLocaleString('en-IN')} – waiting for review. The sheet is locked.</Alert>}
      {tpl.instructions && editable && <Alert variant="light" mb="sm">{tpl.instructions}</Alert>}
      <Grid>
        <Grid.Col span={{ base: 12, xl: 8 }}>
          <div className="print-root">
            <Paper withBorder p="md" radius="md">
              <Stack gap="sm">
                <Group justify="space-between" align="flex-start">
                  <div><Text fw={700}>OBSERVATION SHEET – {tpl.name.toUpperCase()}</Text><Text size="sm">{tpl.method}</Text></div>
                  {tpl.docControl && <Text size="xs" c="dimmed" ta="right">Doc: {tpl.docControl.docNo} · Issue {tpl.docControl.issueNo}{tpl.docControl.issueDate ? ` · ${tpl.docControl.issueDate}` : ''} · Amd {tpl.docControl.amendmentNo}</Text>}
                </Group>
                <SimpleGrid cols={{ base: 2, md: 4 }} spacing={6}>
                  <Info k="Job code" v={s.code} /><Info k="Sample ID" v={s.sample_label || s.code.split('/').slice(-3, -2)[0]} /><Info k="Received" v={dmy(s.received_date)} /><Info k="Quantity" v={s.quantity} />
                  <Info k="Condition" v={s.condition} /><Info k="ULR" v={s.ulr} /><Info k="Due date" v={dmy(t.due_date)} />
                  <Info k="Template" v={`${tpl.code} v${tpl.version}`} />
                </SimpleGrid>
                <SimpleGrid cols={{ base: 2, md: 4 }}>
                  <TextInput size="xs" type="date" label="Test started" value={dates.started_at} disabled={!editable} onChange={(e) => { setDates({ ...dates, started_at: e.currentTarget.value }); setDirty(true); }} />
                  <TextInput size="xs" type="date" label="Test completed" value={dates.completed_at} disabled={!editable} onChange={(e) => { setDates({ ...dates, completed_at: e.currentTarget.value }); setDirty(true); }} />
                  {tpl.headerFields.map((f) => f.type === 'select'
                    ? <Select key={f.key} size="xs" label={`${f.label}${f.unit ? ` (${f.unit})` : ''}`} required={f.required} data={f.options ?? []} value={(obs.header[f.key] as string) ?? (f.default !== undefined ? String(f.default) : null)} disabled={!editable} onChange={(v) => setHeader(f.key, v)} description={f.help} />
                    : <TextInput key={f.key} size="xs" label={`${f.label}${f.unit ? ` (${f.unit})` : ''}`} required={f.required} type={f.type === 'date' ? 'date' : 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined}
                        placeholder={f.default !== undefined ? String(f.default) : undefined} description={f.help}
                        error={f.type === 'number' && parseNumberInput(obs.header[f.key]) === undefined ? 'Enter a number' : undefined}
                        value={(obs.header[f.key] as string) ?? ''} disabled={!editable} onChange={(e) => setHeader(f.key, f.type === 'number' ? (e.currentTarget.value === '' ? null : e.currentTarget.value) : e.currentTarget.value)} />)}
                  {(tpl.equipment ?? []).map((slot) => {
                    const sel = obs.equipment?.[slot.key]?.id; const e = t.equipment.find((x: any) => x.id === sel);
                    return <Select key={slot.key} size="xs" label={slot.label} required disabled={!editable} value={sel ? String(sel) : null}
                      description={e ? `Cert ${e.cert_no ?? '—'} · due ${dmy(e.due_date)}` : undefined}
                      data={t.equipment.filter((x: any) => x.category === slot.category).map((x: any) => ({ value: String(x.id), label: `${x.name}${x.due_date && x.due_date < localToday() ? ' (calibration expired)' : ''}`, disabled: x.due_date && x.due_date < localToday() }))}
                      onChange={(v) => { setObs({ ...obs, equipment: { ...(obs.equipment ?? {}), [slot.key]: v ? { id: Number(v), name: '', data: {} } : null } }); setDirty(true); }} />;
                  })}
                </SimpleGrid>
                {(tpl.constants.length > 0 || tpl.derived.length > 0) && (
                  <Paper withBorder p="xs" bg="#fafbfc">
                    <Text size="xs" fw={600} mb={4}>Constants (from calibration or entered) and derived values</Text>
                    <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing={6} verticalSpacing={4}>
                      {tpl.constants.map((c) => {
                        const manual = obs.constants?.[c.key] !== undefined && obs.constants?.[c.key] !== null;
                        const src = c.fromEquipment ? 'calibration value' : 'standard value';
                        return c.locked || !editable
                          ? <Text key={c.key} size="xs">{c.label}: <b>{formatValue(result.scalars[c.key] as never) || '—'}</b> {c.unit} <Text span c="dimmed">({manual ? 'entered' : src})</Text></Text>
                          : <TextInput key={c.key} size="xs" label={`${c.label}${c.unit ? ` (${c.unit})` : ''}`} inputMode="decimal"
                              description={manual ? 'Entered manually – clear to use the ' + src : c.note ?? `Using the ${src}`}
                              placeholder={formatValue(result.scalars[c.key] as never) || (c.fromEquipment ? 'select equipment or enter' : '')}
                              styles={manual ? { input: { borderColor: '#eda100', background: '#fffaf0' } } : undefined}
                              error={manual && parseNumberInput(obs.constants![c.key]) === undefined ? 'Enter a number' : undefined}
                              value={manual ? String(obs.constants![c.key]) : ''} onChange={(e) => setConst(c.key, e.currentTarget.value)} />;
                      })}
                      {tpl.derived.map((c) => <Text key={c.key} size="xs" style={{ alignSelf: 'end' }}>{c.label}: <b>{formatValue(result.scalars[c.key] as never, c.decimals) || '—'}</b> {c.unit}</Text>)}
                    </SimpleGrid>
                  </Paper>
                )}
                {tpl.grids.map((g) => (
                  <div key={g.key} style={{ overflowX: 'auto' }}>
                    <Text size="sm" fw={600} mb={4}>{g.label}</Text>
                    <table className="grid-input">
                      <thead><tr><th style={{ width: 36, minWidth: 36 }}>#</th>{g.columns.filter((c) => !c.hidden).map((c) => <th key={c.key} style={{ minWidth: c.width ? c.width * 10 : c.text || c.options ? 150 : /^r\d+$/.test(c.key) ? 44 : 72 }}>{c.label}{c.unit ? <><br /><span style={{ fontWeight: 400 }}>({c.unit})</span></> : null}</th>)}</tr></thead>
                      <tbody>
                        {(obs.grids[g.key] ?? []).map((row, i) => (
                          <tr key={i}>
                            <td className="fixed">{i + 1}</td>
                            {g.columns.filter((c) => !c.hidden).map((c) => c.input
                              ? <td key={c.key} style={c.text ? { minWidth: 120 } : undefined}>{c.options
                                  ? <select value={row[c.key] === null || row[c.key] === undefined ? '' : String(row[c.key])} disabled={!editable} onChange={(e) => setCell(g.key, i, c.key, e.currentTarget.value, true)}><option value="" />{c.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                                  : <input inputMode={c.text || c.key === 'id' ? 'text' : 'decimal'} className={!c.text && parseNumberInput(row[c.key]) === undefined ? 'bad' : undefined} title={!c.text && parseNumberInput(row[c.key]) === undefined ? 'Not a number' : undefined}
                                      value={row[c.key] === null || row[c.key] === undefined ? '' : String(row[c.key])} disabled={!editable} onChange={(e) => setCell(g.key, i, c.key, e.currentTarget.value, c.text)} />}</td>
                              : <td key={c.key} className={c.formula ? 'calc' : 'fixed'}>{formatValue(result.grids[g.key]?.[i]?.[c.key] as never, c.decimals)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {editable && !g.fixedRows && <Group gap={6} mt={4} className="no-print">
                      <Button size="compact-xs" variant="subtle" onClick={() => { setObs({ ...obs, grids: { ...obs.grids, [g.key]: [...(obs.grids[g.key] ?? []), {}] } }); setDirty(true); }}>+ Add row</Button>
                      {(obs.grids[g.key]?.length ?? 0) > (g.rows ?? 1) && <Button size="compact-xs" variant="subtle" color="gray" onClick={() => { setObs({ ...obs, grids: { ...obs.grids, [g.key]: (obs.grids[g.key] ?? []).slice(0, -1) } }); setDirty(true); }}>Remove last row</Button>}
                    </Group>}
                  </div>
                ))}
                <Paper withBorder p="sm" bg="#f1f6ff">
                  <Text size="sm" fw={600} mb={4}>Results</Text>
                  <SimpleGrid cols={{ base: 1, md: 2 }} spacing={4}>
                    {tpl.results.filter((r) => !r.hidden).map((r) => <Text key={r.key} size="sm">{r.label}: <b>{formatValue(result.results[r.key] as never, r.decimals) || '—'}</b> {r.unit}</Text>)}
                  </SimpleGrid>
                </Paper>
                {inputIssues.length > 0 && <Alert color="red" icon={<IconAlertTriangle size={16} />} py={6} title="Fix these entries before saving">{inputIssues.slice(0, 6).map((m, i) => <div key={i}>{m}</div>)}</Alert>}
                {result.checks.map((c, i) => <Alert key={i} color={c.level === 'error' ? 'red' : 'orange'} icon={<IconAlertTriangle size={16} />} py={6}>{c.message}</Alert>)}
                {allCharts(tpl).map((ch, i) => {
                  const series = chartSeries(tpl, result, ch);
                  return (series[0]?.points.length ?? 0) > 1 ? <div key={i} style={{ textAlign: 'center', breakInside: 'avoid' }}><LineChart series={series} xLog={ch.xLog} yLog={ch.yLog} yReverse={ch.yReverse} xTop={ch.xTop} xMin={ch.xMin} xMax={ch.xMax} yMin={ch.yMin} yMax={ch.yMax} fit={ch.fit} title={ch.title} xLabel={ch.xLabel} yLabel={ch.yLabel} note={ch.note ? fillRefs(ch.note, result) : undefined} /></div> : null;
                })}
                {(() => { const bl = boreLogData(tpl, result); return bl && bl.strata.length ? <div style={{ breakInside: 'avoid' }}><Text size="sm" fw={600} mb={4}>Borehole log {bl.title}</Text><BoreLog data={bl} /><SoilLegend soils={bl.strata.map((x) => x.soil)} /></div> : null; })()}
                <Group justify="space-between" mt="sm">
                  <Text size="sm">Tested by: <b>{t.enteredBy ?? '—'}</b></Text>
                  <Text size="sm">Checked by: <b>{t.reviewedBy && ['accepted', 'reported'].includes(t.status) ? t.reviewedBy : '—'}</b></Text>
                </Group>
              </Stack>
            </Paper>
          </div>
        </Grid.Col>
        <Grid.Col span={{ base: 12, xl: 4 }} className="no-print">
          <ReportOptions t={t} tpl={tpl} obs={obs} onSaved={(show) => setObs({ ...obs, show })} />
          <TestGuide tpl={tpl} />
          <Paper withBorder p="md">
            <Text fw={600} mb="xs">History and corrections</Text>
            <Timeline bulletSize={12}>
              {t.history.map((h: any) => (
                <Timeline.Item key={h.id} title={<Text size="sm">{h.action}</Text>}>
                  <Text size="xs" c="dimmed">{h.user} · {new Date(h.at).toLocaleString('en-IN')}</Text>
                  {h.detail?.note && <Text size="xs">“{h.detail.note}”</Text>}
                  {h.detail?.reason && <Text size="xs">Reason: {h.detail.reason}</Text>}
                  {Array.isArray(h.detail?.changes) && h.detail.changes.slice(0, 8).map((c: any, i: number) => <Text key={i} size="xs" c="red">{c.field}: <s>{String(c.from ?? '')}</s> → {String(c.to ?? '')}</Text>)}
                </Timeline.Item>
              ))}
            </Timeline>
            {!t.history.length && <Text size="sm" c="dimmed">No entries yet.</Text>}
            <Text size="xs" c="dimmed" mt="sm">Status: {TEST_STATUS_LABEL[t.status as keyof typeof TEST_STATUS_LABEL]}. Corrections after return keep the old value and a reason.</Text>
          </Paper>
        </Grid.Col>
      </Grid>
      <ReasonModal opened={returnOpen} title="Return for correction – what needs fixing?" onClose={() => setReturnOpen(false)} onSubmit={async (n) => { setReturnOpen(false); await review('return', n); }} />
      <ReasonModal opened={reasonOpen} title="Reason for correction" onClose={() => setReasonOpen(false)} onSubmit={async (n) => { setReasonOpen(false); await save(n); }} />
    </>
  );
}

/** Switch report rows, tables and graphs on or off for this test (customers need different parameters). */
function ReportOptions({ t, tpl, obs, onSaved }: { t: any; tpl: ObservationTemplate; obs: ObservationInput; onSaved: (show: Record<string, boolean>) => void }) {
  const can = useCan();
  const parts = reportParts(tpl);
  const [show, setShow] = useState<Record<string, boolean>>(obs.show ?? {});
  useEffect(() => { setShow(obs.show ?? {}); }, [t.id]);
  if (!parts.length) return null;
  const allowed = t.status !== 'reported' && (can('enterObservations') || can('reviewTests') || can('reportPrepare'));
  const toggle = async (key: string, on: boolean) => {
    const next = { ...show, [key]: on };
    const def = parts.find((p) => p.key === key)?.on;
    if (on === def) delete next[key];
    setShow(next);
    await api(`/tests/${t.id}/report-options`, { method: 'PUT', body: { show: next } });
    ok(t.report_id ? 'Saved – use “Refresh results” on the report draft' : 'Saved for this test'); onSaved(next);
  };
  return (
    <Paper withBorder p="md" mb="md">
      <Text fw={600} mb={2}>Show on the report</Text>
      <Text size="xs" c="dimmed" mb="xs">Untick what this customer does not need. Everything is still calculated; the template sets the defaults.</Text>
      <Stack gap={4}>
        {parts.map((p) => <Checkbox key={p.key} size="xs" label={p.label} disabled={!allowed} checked={show[p.key] ?? p.on} onChange={(e) => toggle(p.key, e.currentTarget.checked)} />)}
      </Stack>
    </Paper>
  );
}

/** Procedure, worked example and references for testers learning the test. */
function TestGuide({ tpl }: { tpl: ObservationTemplate }) {
  const calc = useMemo(() => renderSampleCalc(tpl), [tpl]);
  if (!tpl.procedure?.length && !calc.length && !tpl.references?.length) return null;
  const first = tpl.procedure?.length ? 'procedure' : calc.length ? 'calc' : 'refs';
  return (
    <Paper withBorder p="md" mb="md">
      <Text fw={600} mb={6}>How to test – {tpl.method}</Text>
      <Tabs defaultValue={first} keepMounted={false}>
        <Tabs.List mb="xs">
          {!!tpl.procedure?.length && <Tabs.Tab value="procedure">Procedure</Tabs.Tab>}
          {!!calc.length && <Tabs.Tab value="calc">Sample calculation</Tabs.Tab>}
          {!!tpl.references?.length && <Tabs.Tab value="refs">IS references</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="procedure"><List type="ordered" size="sm" spacing={4}>{tpl.procedure?.map((p, i) => <List.Item key={i}>{p}</List.Item>)}</List></Tabs.Panel>
        <Tabs.Panel value="calc">
          <Stack gap={6}>{calc.map((c, i) => <Text key={i} size="sm">{c}</Text>)}</Stack>
          <Tooltip label="These numbers come from the template's worked example and are recalculated by the same formulas as this sheet." multiline w={260}><Text size="xs" c="dimmed" mt={6}>Worked example – not this sample's data</Text></Tooltip>
        </Tabs.Panel>
        <Tabs.Panel value="refs"><List size="sm" spacing={4}>{tpl.references?.map((r, i) => <List.Item key={i}>{r}</List.Item>)}</List></Tabs.Panel>
      </Tabs>
    </Paper>
  );
}

const Info = ({ k, v }: { k: string; v?: string | null }) => <Text size="xs"><Text span c="dimmed">{k}: </Text>{v || '—'}</Text>;

function ReasonModal({ opened, title, onClose, onSubmit }: { opened: boolean; title: string; onClose: () => void; onSubmit: (n: string) => void }) {
  const [n, setN] = useState('');
  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      <Textarea autosize minRows={3} value={n} onChange={(e) => setN(e.currentTarget.value)} data-autofocus />
      <Group justify="flex-end" mt="sm"><Button disabled={n.trim().length < 3} onClick={() => { onSubmit(n.trim()); setN(''); }}>Submit</Button></Group>
    </Modal>
  );
}
