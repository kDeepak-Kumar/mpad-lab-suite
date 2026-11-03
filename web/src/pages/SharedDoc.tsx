import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Badge, Box, Button, Center, Group, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { IconDownload, IconPrinter, IconBrandWhatsapp, IconShieldCheck } from '@tabler/icons-react';
import { applyOverrides, DEFAULT_TEMPLATES, waNumber, WA_GREEN, type DocTemplate } from '@suite/shared';
import { DocRenderer } from '../doc/DocRenderer';
import { FitWidth } from '../doc/FitWidth';

const LABEL: Record<string, string> = { quote: 'Quotation', invoice: 'Tax invoice', report: 'Test report' };

/** Public page behind the link sent on WhatsApp: view, download and print the document without signing in. */
export function SharedDocPage() {
  const { token } = useParams();
  const [d, setD] = useState<any>(undefined);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fetch(`/api/public/doc/${encodeURIComponent(token ?? '')}`).then(async (r) => { const j = await r.json(); if (r.ok) setD(j); else { setErr(j.error); setD(null); } })
      .catch(() => { setErr('Could not reach the laboratory server. Please try again.'); setD(null); });
  }, [token]);
  const template = useMemo(() => (d ? applyOverrides((d.template ?? DEFAULT_TEMPLATES[d.kind as 'quote']) as DocTemplate, d.overrides ?? {}) : null), [d]);
  useEffect(() => { if (d) document.title = `${LABEL[d.kind]} ${d.number} – ${d.company.name}`; }, [d]);

  if (d === undefined) return <Center h="100vh"><Loader /></Center>;
  if (d === null || !template) return (
    <Center mih="100vh" p="md" bg="#f4f6f9"><Paper withBorder radius="md" p="xl" maw={480}><Title order={3} mb="sm">Link not available</Title><Alert color="red">{err}</Alert></Paper></Center>
  );
  const file = `${LABEL[d.kind]} ${d.number}`.replace(/[\\/:*?"<>|]+/g, '-');
  const download = async () => { setBusy(true); try { const m = await import('../doc/export'); await m.downloadPdf(ref.current!, file); } finally { setBusy(false); } };
  const wa = waNumber(d.company.phone);
  const withdrawn = d.status === 'cancelled';
  return (
    <Box bg="#eef1f5" mih="100vh">
      <Paper className="no-print" radius={0} px="md" py="sm" style={{ position: 'sticky', top: 0, zIndex: 5, borderBottom: '1px solid #dde3ea' }}>
        <Group justify="space-between" maw={1000} mx="auto" wrap="wrap" gap="xs">
          <Group gap="sm" wrap="nowrap">
            {d.company.logo && <img src={d.company.logo} alt="" style={{ height: 36, width: 'auto' }} />}
            <div><Text fw={700} lh={1.2}>{d.company.name}</Text><Text size="xs" c="dimmed">{LABEL[d.kind]} {d.number}</Text></div>
          </Group>
          <Group gap="xs">
            <Button leftSection={<IconDownload size={16} />} loading={busy} onClick={download} disabled={withdrawn}>Download PDF</Button>
            <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()} visibleFrom="sm">Print</Button>
            {wa && <Button component="a" href={`https://wa.me/${wa}?text=${encodeURIComponent(`Hello, regarding ${LABEL[d.kind].toLowerCase()} ${d.number}: `)}`} target="_blank" variant="light" color="#25D366" leftSection={<IconBrandWhatsapp size={16} color={WA_GREEN} />}>Chat with us</Button>}
          </Group>
        </Group>
      </Paper>
      <Stack maw={1000} mx="auto" p="md" gap="sm">
        {withdrawn && <Alert color="orange" className="no-print">This {LABEL[d.kind].toLowerCase()} was withdrawn{d.replacedBy ? ` and replaced by ${d.replacedBy}` : ''}. Please contact the laboratory for the current version.</Alert>}
        {d.verify && !withdrawn && <Group gap={6} className="no-print"><IconShieldCheck size={16} color="#0b8a5a" /><Text size="sm">Genuine report. <a href={`/verify/${d.verify}`}>Verify details</a></Text><Badge variant="light" color="teal">Issued</Badge></Group>}
        <div className="print-root" ref={ref}>
          <div className="doc-stage"><FitWidth>
            <DocRenderer template={template} kind={d.kind} data={{ ...d.data, date: d.date }} company={d.company} number={d.number} status={d.status} totals={d.totals}
              issuer={d.issuer} verifyUrl={d.verify ? `${window.location.origin}/verify/${d.verify}` : null} />
          </FitWidth></div>
        </div>
        <Text size="xs" c="dimmed" ta="center" className="no-print">Shared securely by {d.company.name}{d.company.website ? ` · ${d.company.website}` : ''}</Text>
      </Stack>
    </Box>
  );
}
