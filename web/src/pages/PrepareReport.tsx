import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Button, Checkbox, Group, Paper, SegmentedControl, Stack, Switch, Text } from '@mantine/core';
import { api, dmy, ok, useApi } from '../api';
import { PageHeader, Empty } from '../components/ui';

/**
 * Pick accepted tests (one or more samples of the same client) and draft reports: one combined report,
 * one report per test (e.g. a 7-day and a 28-day cube report), or one per sample. Results already issued
 * on an earlier report can be repeated on a new one (e.g. 7-day results on the 28-day report); the earlier
 * report is not changed.
 */
export function PrepareReport() {
  const [withReported, setWithReported] = useState(false);
  const { data } = useApi<any[]>(`/reports/pending-tests${withReported ? '?withReported=1' : ''}`, [withReported]);
  const [sel, setSel] = useState<number[]>([]);
  const [split, setSplit] = useState<'none' | 'each' | 'sample'>('none');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const rows = data ?? [];
  const bySample = new Map<number, any[]>();
  for (const r of rows) bySample.set(r.sample_id, [...(bySample.get(r.sample_id) ?? []), r]);
  const selRow = rows.find((r) => sel.includes(r.id));
  const selClient = selRow?.client_id;
  const selType = selRow?.accreditation;
  const toggle = (ids: number[], on: boolean) => setSel((s) => (on ? [...new Set([...s, ...ids])] : s.filter((x) => !ids.includes(x))));
  const fresh = sel.filter((id) => !rows.find((r) => r.id === id)?.reported_in);
  const nSamples = new Set(rows.filter((r) => sel.includes(r.id)).map((r) => r.sample_id)).size;
  const nReports = split === 'none' ? 1 : split === 'sample' ? nSamples : fresh.length;
  const create = async () => {
    setBusy(true);
    try {
      const r = await api<any>('/reports', { body: { testIds: sel, split } });
      if (r.ids?.length > 1) { ok(`${r.ids.length} report drafts created`); nav('/reports'); } else nav(`/documents/${r.id}`);
    } finally { setBusy(false); }
  };
  const label = (t: any) => `${t.report_name || t.billing_name}${t.age ? ` – ${t.age} days` : ''}${t.completed_at ? ` (tested ${dmy(t.completed_at)})` : ''}`;
  return (
    <>
      <PageHeader title="Prepare test report" subtitle="Only observation sheets accepted by a reviewer appear here. Tick the parameters for the report – pending results (e.g. 28-day cubes) can follow on a later report."
        actions={<Button disabled={!fresh.length} loading={busy} onClick={create}>Create {nReports > 1 ? `${nReports} report drafts` : 'report draft'} ({sel.length} test{sel.length === 1 ? '' : 's'})</Button>} />
      <Paper withBorder p="sm" mb="sm">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <div>
            <Text size="sm" fw={500}>Reports</Text>
            <SegmentedControl size="xs" value={split} onChange={(v) => setSplit(v as typeof split)} data={[{ value: 'none', label: 'One combined report' }, { value: 'each', label: 'One report per test / age' }, { value: 'sample', label: 'One report per sample' }]} />
          </div>
          <Switch label="Show results already issued (to repeat them on a new report)" checked={withReported} onChange={(e) => { setWithReported(e.currentTarget.checked); setSel([]); }} />
        </Group>
      </Paper>
      {!rows.length && <Empty>No accepted tests waiting for a report. Tests appear here after a reviewer accepts their observation sheets.</Empty>}
      {sel.length > 0 && <Alert variant="light" mb="sm">You can add other {selType ?? ''} samples of the same client to this report; each sample becomes a result column. NABL and Non-NABL samples always go on separate reports.{sel.length > fresh.length ? ' Results issued earlier are repeated as they are – the earlier report is not changed.' : ''}</Alert>}
      <Stack>
        {[...bySample.entries()].map(([sid, tests]) => {
          const ids = tests.filter((t) => !t.reported_in).map((t) => t.id); const all = ids.length > 0 && ids.every((i) => sel.includes(i));
          const disabled = !!selClient && (selClient !== tests[0].client_id || (selType ?? '') !== (tests[0].accreditation ?? ''));
          return (
            <Paper key={sid} withBorder p="sm" opacity={disabled ? 0.5 : 1}>
              <Group justify="space-between">
                <Checkbox disabled={disabled || !ids.length} checked={all} indeterminate={!all && ids.some((i) => sel.includes(i))} onChange={(e) => toggle(ids, e.currentTarget.checked)}
                  label={<Text fw={600}>{tests[0].sample_code} <Text span size="sm" c="dimmed">· {tests[0].client_name} · {tests[0].material} · {tests[0].accreditation ?? ''}</Text></Text>} />
              </Group>
              <Group mt={6} ml={30} gap="lg">
                {tests.map((t) => <Checkbox key={t.id} disabled={disabled} size="xs" checked={sel.includes(t.id)} onChange={(e) => toggle([t.id], e.currentTarget.checked)}
                  label={<Group gap={6}><span>{label(t)}</span>{t.reported_in && <Badge size="xs" variant="light" color="gray">issued in {t.reported_in}</Badge>}</Group>} />)}
              </Group>
            </Paper>
          );
        })}
      </Stack>
    </>
  );
}
