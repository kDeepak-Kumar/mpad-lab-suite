import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Box, Button, Center, Group, Loader, Paper, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconAlertTriangle, IconCircleCheck, IconDownload, IconPrinter, IconSearch } from '@tabler/icons-react';
import { applyOverrides, DEFAULT_TEMPLATES, type DocTemplate } from '@suite/shared';
import { DocRenderer } from '../doc/DocRenderer';
import { FitWidth } from '../doc/FitWidth';

/**
 * Public page opened from the QR code on an issued test report (or by typing the report number and the
 * verification code printed beside the QR). Shows whether the report is genuine and current, its key facts,
 * and the genuine report itself – drawn from the laboratory's issued record, not from a stored file –
 * so a printed or forwarded copy can be compared with it. Nothing to install: it opens in any browser and the
 * PDF is saved with the phone's own viewer.
 */
export function VerifyPage() {
  const { token } = useParams();
  /** ?print=1: the report alone, for the server's PDF printer */
  const printOnly = new URLSearchParams(window.location.search).get('print') === '1';
  const [d, setD] = useState<any>(token ? undefined : null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [num, setNum] = useState('');
  const [code, setCode] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const take = async (r: Response) => { const j = await r.json().catch(() => ({ error: 'Unexpected answer from the server.' })); if (r.ok) { setD(j); setErr(''); } else { setErr(j.error); setD(null); } };
  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/verify/${encodeURIComponent(token)}${printOnly ? '?render=1' : ''}`).then(take).catch(() => { setErr('Could not reach the laboratory server.'); setD(null); });
  }, [token]);
  const lookup = async () => {
    setBusy(true);
    try { await take(await fetch('/api/public/verify-lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ number: num, code }) })); }
    catch { setErr('Could not reach the laboratory server.'); }
    finally { setBusy(false); }
  };
  const rep = d?.report;
  const template = useMemo(() => (rep ? applyOverrides((rep.template ?? DEFAULT_TEMPLATES.report) as DocTemplate, rep.overrides ?? {}) : null), [rep]);
  useEffect(() => { document.title = d?.number ? `Verify report ${d.number}` : 'Verify a test report'; }, [d]);

  if (d === undefined) return <Center h="100vh"><Loader /></Center>;

  if (d === null) return (
    <Center mih="100vh" p="md" bg="#f5f5f4">
      <Paper withBorder radius="md" p="xl" maw={480} w="100%">
        <Stack gap="sm">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: 0.6 }}>Test report verification</Text>
          {token && <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Report not verified">{err}</Alert>}
          {!token && err && <Alert color="red">{err}</Alert>}
          <Text size="sm">Enter the report number and the verification code printed beside the QR code on the report.</Text>
          <TextInput label="Report number" value={num} onChange={(e) => setNum(e.currentTarget.value)} placeholder="e.g. DCTL-TR/0004/26-27" />
          <TextInput label="Verification code" value={code} onChange={(e) => setCode(e.currentTarget.value)} placeholder="8 characters" />
          <Button leftSection={<IconSearch size={16} />} loading={busy} disabled={num.trim().length < 3 || code.trim().length < 4} onClick={lookup}>Verify</Button>
        </Stack>
      </Paper>
    </Center>
  );

  const valid = d.status === 'Valid';
  const file = `Test report ${d.number}`.replace(/[\\/:*?"<>|]+/g, '-');
  // text PDF printed by the server when it can; otherwise made here in the browser – either way the phone's own viewer opens it
  const download = async () => {
    setBusy(true);
    try {
      if (d.serverPdf) {
        const r = await fetch(`/api/public/verify/${encodeURIComponent(d.token)}/pdf`);
        if (r.ok && r.headers.get('content-type')?.includes('pdf')) {
          const u = URL.createObjectURL(await r.blob());
          const a = document.createElement('a'); a.href = u; a.download = `${file}.pdf`; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(u), 60_000);
          return;
        }
      }
      const m = await import('../doc/export'); await m.downloadPdf(ref.current!, file);
    } finally { setBusy(false); }
  };
  const facts = [['Report number', d.number], ['ULR', d.ulr], ['Date of issue', d.issued], ['Issued to', d.client], ['Sample', d.material], ['Tests', (d.tests ?? []).join(', ')], ['Signed by', d.signedBy]].filter(([, v]) => v);
  if (printOnly) return rep && template ? (
    <div className="print-root">
      <DocRenderer template={template} kind="report" data={{ ...rep.data, date: rep.date }} company={rep.company} number={rep.number} status={rep.status}
        issuer={rep.issuer} verifyUrl={`${(/^https?:\/\/[\w.-]+(:\d+)?$/.test(new URLSearchParams(window.location.search).get('origin') ?? '') ? new URLSearchParams(window.location.search).get('origin') : d.publicUrl) || window.location.origin}/verify/${d.token}`} />
    </div>
  ) : null;
  return (
    <Box bg="#f5f5f4" mih="100vh">
      <Stack maw={1000} mx="auto" p="md" gap="md">
        <Paper withBorder radius="md" p="lg" className="no-print">
          <Stack gap="sm">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: 0.6 }}>Test report verification · {d.lab}</Text>
            {valid ? (
              <Alert color="teal" icon={<IconCircleCheck size={20} />} title="Genuine report – issued by this laboratory and currently valid">
                The details and the report below come directly from the laboratory's issued record.
              </Alert>
            ) : d.status === 'Check failed' ? (
              <Alert color="red" icon={<IconAlertTriangle size={20} />} title="This report cannot be confirmed">
                Please contact the laboratory before relying on it{d.phone ? ` (${d.phone})` : ''}.
              </Alert>
            ) : (
              <Alert color="orange" icon={<IconAlertTriangle size={20} />} title={`This report was withdrawn${d.replacedBy ? ` and replaced by ${d.replacedBy}` : ''}`}>
                It must not be relied on. Ask the laboratory for the current report.
              </Alert>
            )}
            <Table withRowBorders={false} verticalSpacing={4}>
              <Table.Tbody>{facts.map(([k, v]) => <Table.Tr key={k}><Table.Td c="dimmed" w={130} style={{ verticalAlign: 'top' }}>{k}</Table.Td><Table.Td>{v}</Table.Td></Table.Tr>)}</Table.Tbody>
            </Table>
            <Text size="sm" style={{ borderLeft: '3px solid #d6d3d1', paddingLeft: 10 }}>
              <b>Compare before you rely on a copy.</b> The genuine report is shown below exactly as issued. If the copy you hold differs in any
              way – a value, a date, a name or a page – it has been altered and is not valid. Report it to {d.lab}{d.phone ? ` on ${d.phone}` : ''}{d.email ? ` or ${d.email}` : ''}.
            </Text>
            {rep && valid && <Group gap="xs">
              <Button leftSection={<IconDownload size={16} />} loading={busy} onClick={download}>Download genuine PDF</Button>
              <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()} visibleFrom="sm">Print</Button>
            </Group>}
            <Text size="xs" c="dimmed">Verification code {d.code} · checked {d.scans} {d.scans === 1 ? 'time' : 'times'}. No app or download is needed to view this page.</Text>
          </Stack>
        </Paper>
        {rep && template && (
          <div className="print-root" ref={ref}>
            <div className="doc-stage"><FitWidth>
              <DocRenderer template={template} kind="report" data={{ ...rep.data, date: rep.date }} company={rep.company} number={rep.number} status={rep.status}
                issuer={rep.issuer} verifyUrl={`${window.location.origin}/verify/${d.token}`} />
            </FitWidth></div>
          </div>
        )}
      </Stack>
    </Box>
  );
}
