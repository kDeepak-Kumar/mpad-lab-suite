import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Badge, Center, Loader, Paper, Stack, Table, Text, Title } from '@mantine/core';

/** Public page opened from the QR code on an issued test report. */
export function VerifyPage() {
  const { token } = useParams();
  const [d, setD] = useState<any>(undefined);
  const [err, setErr] = useState('');
  useEffect(() => {
    fetch(`/api/public/verify/${encodeURIComponent(token ?? '')}`).then(async (r) => { const j = await r.json(); if (r.ok) setD(j); else { setErr(j.error); setD(null); } }).catch(() => { setErr('Could not reach the laboratory server.'); setD(null); });
  }, [token]);
  return (
    <Center mih="100vh" p="md" bg="#f4f6f9">
      <Paper withBorder radius="md" p="xl" maw={560} w="100%">
        {d === undefined ? <Center><Loader /></Center> : d === null ? (
          <Stack><Title order={3}>Report not verified</Title><Alert color="red">{err}</Alert></Stack>
        ) : (
          <Stack gap="sm">
            <Text size="sm" c="dimmed">Test report verification</Text>
            <Title order={3}>{d.lab}</Title>
            {d.accreditation && <Text size="sm">NABL accreditation {d.accreditation}</Text>}
            <Badge size="lg" color={d.status === 'Valid' ? 'teal' : 'red'} variant="light">{d.status === 'Valid' ? 'Genuine report – valid' : d.status}</Badge>
            {d.replacedBy && <Alert color="orange">This report was amended and replaced by {d.replacedBy}.</Alert>}
            <Table withRowBorders={false}>
              <Table.Tbody>
                {[['Report number', d.number], ['Date of issue', d.issued], ['Customer', d.client], ['ULR', d.ulr], ['Job code', d.jobCode], ['Tests', d.tests.join(', ')]].filter(([, v]) => v).map(([k, v]) => (
                  <Table.Tr key={k}><Table.Td c="dimmed" w={140}>{k}</Table.Td><Table.Td>{v}</Table.Td></Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            <Text size="xs" c="dimmed">Compare these details with the printed report. If anything differs, contact the laboratory.</Text>
          </Stack>
        )}
      </Paper>
    </Center>
  );
}
