import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Badge, Button, FileButton, Group, Loader, Paper, Select, SimpleGrid, Stack, Table, Tabs, Text, Textarea, ThemeIcon, CopyButton } from '@mantine/core';
import { IconFileSearch, IconSparkles, IconAlertTriangle, IconListCheck, IconArrowsDiff, IconCurrencyRupee, IconQuestionMark, IconUpload } from '@tabler/icons-react';
import { api, money, useApi } from '../api';
import { useCan } from '../ctx';
import { PageHeader } from '../components/ui';
import { readDocumentText } from '../lib/vendorDocs';

const RISK: Record<string, string> = { high: 'red', medium: 'orange', low: 'gray' };
const SCOPE: Record<string, [string, string]> = { in_scope: ['teal', 'We do it'], outsourced: ['grape', 'Outsourced'], not_offered: ['red', 'Not in rate card'] };

/** Upload a contract / tender / specification: AI lists the testing it needs, flags risks and compares rates. */
export function ContractReviewPage() {
  const can = useCan();
  const [sp] = useSearchParams();
  const { data: quotes } = useApi<any[]>('/documents?kind=quote', []);
  const [quote, setQuote] = useState<string | null>(sp.get('quote'));
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { setRes(null); }, [text]);
  const load = async (f: File | null) => {
    if (!f) return;
    setErr(''); setFileName(f.name); setText('');
    try {
      if (/\.txt$/i.test(f.name) || f.type === 'text/plain') { setText(await f.text()); return; }
      if (!/pdf|image/.test(f.type)) { setErr('Upload a PDF, a photo/scan, or a .txt file. For Word files, use “Save as PDF” first.'); return; }
      const r = await readDocumentText(f, f.type, setProgress);
      setText(r.lines.join('\n'));
    } catch (e) { setErr((e as Error).message); } finally { setProgress(''); }
  };
  const run = async () => {
    setBusy(true); setErr('');
    try { setRes(await api('/ai/contract-review', { body: { text, fileName, quote_id: quote ? Number(quote) : null }, quiet: true })); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const report = res ? [
    `Contract review – ${fileName || 'document'}`, '', res.summary, '',
    'Unusual clauses:', ...res.unusualClauses.map((c: any) => `- [${c.risk}] ${c.clause}: ${c.why}`), '',
    'Differences from our practice:', ...res.deviations.map((d: any) => `- [${d.risk}] ${d.topic}: contract – ${d.contract}; we – ${d.ourPractice}. ${d.suggestion ?? ''}`), '',
    'Questions for the client:', ...res.questions.map((q: string) => `- ${q}`),
  ].join('\n') : '';
  if (!can('useAI')) return <Alert>Your role cannot use the AI assistant.</Alert>;
  return (
    <>
      <PageHeader title="Contract review" subtitle="Upload a contract, tender or specification – get the testing it requires, risky clauses and price differences" />
      <Paper withBorder p="md" radius="lg" mb="md">
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
          <Stack gap={6}>
            <Text fw={600} size="sm">1 · Document</Text>
            <FileButton accept="application/pdf,image/png,image/jpeg,text/plain" onChange={load}>{(p) => <Button variant="light" leftSection={<IconUpload size={16} />} {...p}>{fileName || 'Choose PDF, scan or .txt'}</Button>}</FileButton>
            {progress && <Group gap={6}><Loader size="xs" /><Text size="xs" c="dimmed">{progress}</Text></Group>}
            {text && <Text size="xs" c="dimmed">{text.length.toLocaleString('en-IN')} characters read{text.length > 60000 ? ' – only the first 60,000 are reviewed' : ''}</Text>}
          </Stack>
          <Stack gap={6}>
            <Text fw={600} size="sm">2 · Compare prices with (optional)</Text>
            <Select placeholder="Rate card (default)" clearable searchable data={(quotes ?? []).filter((q) => q.number).map((q) => ({ value: String(q.id), label: `${q.number} · ${q.client_name}` }))} value={quote} onChange={setQuote} />
            <Text size="xs" c="dimmed">Choose your quotation to see where the contract’s schedule of rates differs from what you quoted.</Text>
          </Stack>
          <Stack gap={6}>
            <Text fw={600} size="sm">3 · Review</Text>
            <Button leftSection={<IconSparkles size={16} />} loading={busy} disabled={text.length < 200} onClick={run}>Review with AI</Button>
            <Text size="xs" c="dimmed">Takes 20–60 seconds. The document text is sent to the AI provider set in Settings.</Text>
          </Stack>
        </SimpleGrid>
        {!fileName && <Textarea mt="md" label="…or paste the text" autosize minRows={3} maxRows={8} value={text} onChange={(e) => setText(e.currentTarget.value)} placeholder="Paste clauses, the testing schedule or the BOQ here" />}
      </Paper>
      {err && <Alert color="red" mb="md">{err}</Alert>}
      {busy && <Paper withBorder p="xl" radius="lg"><Group justify="center"><Loader /><Text c="dimmed">Reading the document and comparing it with your rate card and standard terms…</Text></Group></Paper>}
      {res && (
        <Stack>
          <Paper withBorder p="md" radius="lg">
            <Group justify="space-between" mb={6}><Group gap={8}><ThemeIcon variant="light" radius="md"><IconFileSearch size={18} /></ThemeIcon><Text fw={650}>Summary</Text></Group>
              <CopyButton value={report}>{({ copied, copy }) => <Button size="compact-sm" variant="default" onClick={copy}>{copied ? 'Copied' : 'Copy review as text'}</Button>}</CopyButton></Group>
            <Text size="sm">{res.summary}</Text>
            {res.truncated && <Text size="xs" c="orange" mt={4}>The document was long – only the first part was reviewed.</Text>}
            <Group gap="xs" mt="sm">
              <Badge variant="light">{res.requirements.length} testing requirements</Badge>
              <Badge variant="light" color={res.unusualClauses.some((c: any) => c.risk === 'high') ? 'red' : 'orange'}>{res.unusualClauses.length} unusual clauses</Badge>
              <Badge variant="light" color="grape">{res.deviations.length} differences from our practice</Badge>
              <Badge variant="light" color={res.pricing.some((p: any) => p.difference !== null && p.difference < 0) ? 'red' : 'teal'}>{res.pricing.length} contract rates</Badge>
            </Group>
          </Paper>
          <Tabs defaultValue={res.unusualClauses.length ? 'risk' : 'req'} keepMounted={false}>
            <Tabs.List mb="sm">
              <Tabs.Tab value="req" leftSection={<IconListCheck size={15} />}>Testing requirements</Tabs.Tab>
              <Tabs.Tab value="risk" leftSection={<IconAlertTriangle size={15} />}>Unusual clauses</Tabs.Tab>
              <Tabs.Tab value="dev" leftSection={<IconArrowsDiff size={15} />}>Differences</Tabs.Tab>
              <Tabs.Tab value="price" leftSection={<IconCurrencyRupee size={15} />}>Prices</Tabs.Tab>
              <Tabs.Tab value="q" leftSection={<IconQuestionMark size={15} />}>Questions ({res.questions.length})</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="req">
              <Paper withBorder radius="lg" style={{ overflow: 'auto' }}><Table fz="sm" verticalSpacing={6} striped>
                <Table.Thead><Table.Tr><Table.Th>Test</Table.Th><Table.Th>Material</Table.Th><Table.Th>Standard</Table.Th><Table.Th>Frequency</Table.Th><Table.Th>Acceptance</Table.Th><Table.Th>Clause</Table.Th><Table.Th>Our rate card</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>{res.requirements.map((r: any, i: number) => (
                  <Table.Tr key={i}><Table.Td fw={550}>{r.test}</Table.Td><Table.Td>{r.material}</Table.Td><Table.Td>{r.standard}</Table.Td><Table.Td>{r.frequency}</Table.Td><Table.Td>{r.acceptance}</Table.Td><Table.Td c="dimmed">{r.clause}</Table.Td>
                    <Table.Td><Badge size="sm" variant="light" color={SCOPE[r.scope]?.[0] ?? 'gray'}>{SCOPE[r.scope]?.[1] ?? r.scope}</Badge>{r.catalogName && <Text size="xs" c="dimmed">{r.catalogName}</Text>}</Table.Td></Table.Tr>))}</Table.Tbody>
              </Table></Paper>
              {res.notQuoted?.length > 0 && <Alert mt="sm" color="orange" title={`Required but not in quotation ${res.quote}`}>{res.notQuoted.join(', ')}</Alert>}
            </Tabs.Panel>
            <Tabs.Panel value="risk"><Stack gap="xs">{res.unusualClauses.length ? res.unusualClauses.map((c: any, i: number) => (
              <Paper key={i} withBorder p="sm" radius="md" style={{ borderLeft: `4px solid var(--mantine-color-${RISK[c.risk] ?? 'gray'}-6)` }}>
                <Group gap="xs"><Badge size="sm" color={RISK[c.risk]}>{c.risk}</Badge><Text fw={600} size="sm">{c.clause}</Text></Group>
                {c.text && <Text size="sm" mt={4} fs="italic" c="dimmed">“{c.text}”</Text>}<Text size="sm" mt={4}>{c.why}</Text>
              </Paper>)) : <Text c="dimmed" size="sm">Nothing unusual found.</Text>}</Stack></Tabs.Panel>
            <Tabs.Panel value="dev"><Paper withBorder radius="lg" style={{ overflow: 'auto' }}><Table fz="sm" verticalSpacing={6}>
              <Table.Thead><Table.Tr><Table.Th>Topic</Table.Th><Table.Th>Contract says</Table.Th><Table.Th>Our practice</Table.Th><Table.Th>Risk</Table.Th><Table.Th>Suggestion</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{res.deviations.map((d: any, i: number) => <Table.Tr key={i}><Table.Td fw={550}>{d.topic}</Table.Td><Table.Td>{d.contract}</Table.Td><Table.Td>{d.ourPractice}</Table.Td><Table.Td><Badge size="sm" color={RISK[d.risk]}>{d.risk}</Badge></Table.Td><Table.Td>{d.suggestion}</Table.Td></Table.Tr>)}</Table.Tbody>
            </Table></Paper></Tabs.Panel>
            <Tabs.Panel value="price">{res.pricing.length ? <Paper withBorder radius="lg" style={{ overflow: 'auto' }}><Table fz="sm" verticalSpacing={6}>
              <Table.Thead><Table.Tr><Table.Th>Item (contract)</Table.Th><Table.Th>Unit</Table.Th><Table.Th ta="right">Contract rate</Table.Th><Table.Th ta="right">Ours</Table.Th><Table.Th ta="right">Difference</Table.Th><Table.Th>Clause</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{res.pricing.map((p: any, i: number) => (
                <Table.Tr key={i} style={{ background: p.difference !== null && p.difference < 0 ? '#fef3f2' : undefined }}>
                  <Table.Td>{p.item}</Table.Td><Table.Td>{p.unit}</Table.Td><Table.Td ta="right">{p.contractRate !== null ? `₹${money(p.contractRate)}` : '—'}</Table.Td>
                  <Table.Td ta="right">{p.ourRate !== null ? `₹${money(p.ourRate)}` : <Text span size="xs" c="dimmed">no match</Text>}{p.source && <Text size="xs" c="dimmed">{p.source}</Text>}</Table.Td>
                  <Table.Td ta="right" c={p.difference === null ? 'dimmed' : p.difference < 0 ? 'red' : 'teal'} fw={600}>{p.difference === null ? '—' : `${p.difference > 0 ? '+' : ''}₹${money(p.difference)} (${p.pct}%)`}</Table.Td>
                  <Table.Td c="dimmed">{p.clause}</Table.Td></Table.Tr>))}</Table.Tbody>
            </Table></Paper> : <Text c="dimmed" size="sm">No rates printed in this document.</Text>}
              <Text size="xs" c="dimmed" mt="xs">Red rows: the contract pays less than you charge. Differences are calculated exactly from the figures, not by the AI.</Text></Tabs.Panel>
            <Tabs.Panel value="q"><Stack gap={6}>{res.questions.map((q: string, i: number) => <Text key={i} size="sm">• {q}</Text>)}</Stack></Tabs.Panel>
          </Tabs>
          <Text size="xs" c="dimmed">AI can miss or misread clauses. Use this as a checklist and confirm against the original document before signing.</Text>
        </Stack>
      )}
    </>
  );
}
