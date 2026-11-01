import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Checkbox, Group, Paper, Stack, Text } from '@mantine/core';
import { api, dmy, useApi } from '../api';
import { PageHeader, Empty } from '../components/ui';

/** Pick accepted tests (one or more samples of the same client) and draft a combined report. */
export function PrepareReport() {
  const { data } = useApi<any[]>('/reports/pending-tests');
  const [sel, setSel] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const rows = data ?? [];
  const bySample = new Map<number, any[]>();
  for (const r of rows) bySample.set(r.sample_id, [...(bySample.get(r.sample_id) ?? []), r]);
  const selRow = rows.find((r) => sel.includes(r.id));
  const selClient = selRow?.client_id;
  const selType = selRow?.accreditation;
  const toggle = (ids: number[], on: boolean) => setSel((s) => (on ? [...new Set([...s, ...ids])] : s.filter((x) => !ids.includes(x))));
  const create = async () => {
    setBusy(true);
    try { const r = await api<any>('/reports', { body: { testIds: sel } }); nav(`/documents/${r.id}`); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Prepare test report" subtitle="Only observation sheets accepted by a reviewer appear here. Tick the tests to combine into one report."
        actions={<Button disabled={!sel.length} loading={busy} onClick={create}>Create report draft ({sel.length} test{sel.length === 1 ? '' : 's'})</Button>} />
      {!rows.length && <Empty>No accepted tests waiting for a report. Tests appear here after a reviewer accepts their observation sheets.</Empty>}
      {sel.length > 0 && <Alert variant="light" mb="sm">You can add other {selType ?? ''} samples of the same client to this report; each sample becomes a result column. NABL and Non-NABL samples always go on separate reports.</Alert>}
      <Stack>
        {[...bySample.entries()].map(([sid, tests]) => {
          const ids = tests.map((t) => t.id); const all = ids.every((i) => sel.includes(i));
          const disabled = !!selClient && (selClient !== tests[0].client_id || (selType ?? '') !== (tests[0].accreditation ?? ''));
          return (
            <Paper key={sid} withBorder p="sm" opacity={disabled ? 0.5 : 1}>
              <Group justify="space-between">
                <Checkbox disabled={disabled} checked={all} indeterminate={!all && ids.some((i) => sel.includes(i))} onChange={(e) => toggle(ids, e.currentTarget.checked)}
                  label={<Text fw={600}>{tests[0].sample_code} <Text span size="sm" c="dimmed">· {tests[0].client_name} · {tests[0].material} · {tests[0].accreditation ?? ''}</Text></Text>} />
              </Group>
              <Group mt={6} ml={30} gap="lg">
                {tests.map((t) => <Checkbox key={t.id} disabled={disabled} size="xs" checked={sel.includes(t.id)} onChange={(e) => toggle([t.id], e.currentTarget.checked)} label={`${t.report_name || t.billing_name}${t.completed_at ? ` (tested ${dmy(t.completed_at)})` : ''}`} />)}
              </Group>
            </Paper>
          );
        })}
      </Stack>
    </>
  );
}
