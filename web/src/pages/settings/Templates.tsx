import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Grid, Group, List, Modal, SegmentedControl, Stack, Tabs, Text, Textarea, TextInput } from '@mantine/core';
import { applyOverrides, computeTotals, renderSampleCalc, TEMPLATE_CATEGORIES, type DocOverrides, type DocTemplate, type ObservationTemplate } from '@suite/shared';
import { api, ok, useApi } from '../../api';
import { PageHeader, SimpleTable, Loading } from '../../components/ui';
import { DocRenderer } from '../../doc/DocRenderer';
import { DesignPanel } from '../../doc/DesignPanel';
import { FitWidth } from '../../doc/FitWidth';

const KINDS: Record<string, string> = { quote: 'Quotation', invoice: 'Invoice', report: 'Test report', receipt: 'Receipt', statement: 'Statement' };

export function TemplatesPage() {
  const { data: docs, reload } = useApi<any[]>('/doc-templates');
  const { data: obs, reload: reloadObs } = useApi<any[]>('/obs-templates');
  const [jsonEdit, setJsonEdit] = useState<any>(null);
  const [cat, setCat] = useState('All');
  const nav = useNavigate();
  const cats = ['All', ...TEMPLATE_CATEGORIES.filter((c) => (obs ?? []).some((t) => (t.category ?? t.material) === c)), ...((obs ?? []).some((t) => !TEMPLATE_CATEGORIES.includes(t.category ?? t.material)) ? ['Other'] : [])];
  const shown = (obs ?? []).filter((t) => cat === 'All' || (t.category ?? t.material) === cat || (cat === 'Other' && !TEMPLATE_CATEGORIES.includes(t.category ?? t.material)))
    .sort((a, b) => TEMPLATE_CATEGORIES.indexOf(a.category ?? a.material) - TEMPLATE_CATEGORIES.indexOf(b.category ?? b.material) || a.name.localeCompare(b.name));
  return (
    <>
      <PageHeader title="Templates" subtitle="Document layouts and observation sheets. Every change is a new version; issued documents keep the version they used." />
      <Tabs defaultValue="docs">
        <Tabs.List mb="sm"><Tabs.Tab value="docs">Document layouts</Tabs.Tab><Tabs.Tab value="obs">Observation sheets</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="docs">
          <SimpleTable head={['Type', 'Name', 'Version', 'Default', '']}
            rows={(docs ?? []).map((t) => [KINDS[t.kind] ?? t.kind, t.name, `v${t.version}`, t.is_default ? <Badge color="teal" variant="light">Default</Badge> : '',
              !t.is_default ? <Button size="xs" variant="subtle" onClick={async (e) => { e.stopPropagation(); await api(`/doc-templates/${t.id}/default`, { method: 'POST' }); reload(); }}>Make default</Button> : ''])}
            onRow={(i) => nav(`/settings/templates/${docs![i].id}`)} />
        </Tabs.Panel>
        <Tabs.Panel value="obs">
          <Alert variant="light" mb="sm">Observation sheets are defined as data: fields, constants (calibration lookup or manual entry), Excel-style formulas, rule checks, IS requirements, charts and report rows. Open a sheet to read its procedure and worked example; advanced users can edit the definition – publishing creates a new version used by new tests only.</Alert>
          <SegmentedControl mb="sm" data={cats} value={cat} onChange={setCat} />
          <SimpleTable head={['Category', 'Test', 'IS method', 'Version', 'Notes']}
            rows={shown.map((t) => [t.category ?? t.material, t.name, t.method, `v${t.version}`, t.simplified ? <Badge color="yellow" variant="light">Simplified – replace with lab sheet</Badge> : t.procedure?.length ? <Badge color="teal" variant="light">Procedure & worked example</Badge> : ''])}
            onRow={(i) => setJsonEdit(shown[i])} />
        </Tabs.Panel>
      </Tabs>
      {jsonEdit && <ObsJsonModal tpl={jsonEdit} onClose={(s) => { setJsonEdit(null); if (s) reloadObs(); }} />}
    </>
  );
}

function ObsJsonModal({ tpl, onClose }: { tpl: any; onClose: (s: boolean) => void }) {
  const { id, ...def } = tpl;
  const [text, setText] = useState(JSON.stringify(def, null, 2));
  const [err, setErr] = useState('');
  const publish = async () => {
    try { const parsed = JSON.parse(text); setErr(''); const r = await api<any>(`/obs-templates/${tpl.code}`, { method: 'PUT', body: parsed }); ok(`Published ${tpl.code} v${r.version}`); onClose(true); }
    catch (e: any) { if (e instanceof SyntaxError) setErr(e.message); }
  };
  const calc = useMemo(() => { try { return renderSampleCalc(def as ObservationTemplate); } catch { return []; } }, [tpl]);
  return (
    <Modal opened onClose={() => onClose(false)} title={`${tpl.name} (${tpl.code} v${tpl.version})`} size="90%">
      <Tabs defaultValue={def.procedure?.length ? 'guide' : 'json'}>
        <Tabs.List mb="sm"><Tabs.Tab value="guide">Procedure & worked example</Tabs.Tab><Tabs.Tab value="json">Definition</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="guide">
          <Grid>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Text fw={600} mb={4}>Procedure – {def.method}</Text>
              {def.procedure?.length ? <List type="ordered" size="sm" spacing={4}>{def.procedure.map((p: string, i: number) => <List.Item key={i}>{p}</List.Item>)}</List> : <Text size="sm" c="dimmed">No procedure recorded for this sheet.</Text>}
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Text fw={600} mb={4}>Sample calculation</Text>
              {calc.length ? <Stack gap={6}>{calc.map((c, i) => <Text key={i} size="sm">{c}</Text>)}</Stack> : <Text size="sm" c="dimmed">No worked example.</Text>}
              {!!def.references?.length && <><Text fw={600} mt="md" mb={4}>IS references and limits</Text><List size="sm" spacing={4}>{def.references.map((r: string, i: number) => <List.Item key={i}>{r}</List.Item>)}</List></>}
              {!!def.constants?.length && <><Text fw={600} mt="md" mb={4}>Constants</Text><List size="sm" spacing={2}>{def.constants.map((c: any) => <List.Item key={c.key}>{c.label}{c.unit ? ` (${c.unit})` : ''}: {c.fromEquipment ? `from equipment calibration (${c.fromEquipment})` : 'standard value'}{c.value !== undefined ? `, default ${c.value}` : ''}{c.locked ? '' : ' – tester may enter manually'}</List.Item>)}</List></>}
            </Grid.Col>
          </Grid>
        </Tabs.Panel>
        <Tabs.Panel value="json">
          <Stack>
            <Textarea value={text} onChange={(e) => setText(e.currentTarget.value)} autosize minRows={20} maxRows={30} styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }} />
            {err && <Alert color="red">{err}</Alert>}
            <Group justify="flex-end"><Button onClick={publish}>Publish as new version</Button></Group>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}

const SAMPLE = {
  client: { name: 'Sample Client Pvt Ltd', address: 'Plot 12, Example Road,\nHyderabad - 500001, Telangana', gstin: '36AAAAA0000A1Z5', stateCode: '36' },
  site: { name: 'Tower A', project: 'Example Residential Project' }, contact: { name: 'Mr. Example', phone: '99999 99999', email: 'qc@example.com' },
  customerRef: 'Verbal / 01-11-2026', placeOfSupply: '36', placeOfSupplyName: 'Telangana', copyLabel: 'ORIGINAL COPY', sac: '998346', mode: 'estimate',
  notes: 'GST 18% will be applicable on above rates.\nReport / results will be communicated only after receiving full payment.',
  lines: [{ description: 'Determining MDD and OMC of soil by heavy compaction method', rate: 3500, qty: 1, unit: 'Per sample', remarks: 'NABL' }, { description: 'Gradation analysis of soil', rate: 1000, qty: 1, unit: 'Per sample', remarks: 'NABL' }],
  jobCodeText: 'Soil : LAB/ABCD/0001/11/2026', ulr: 'TC000002600000001F', receivedText: '01-11-2026', testDatesText: '01-11-2026 to 03-11-2026', specification: 'Soil', condition: 'Satisfactory', source: 'Sample supplied by the customer', material: 'Soil', materialUpper: 'SOIL',
  samples: [{ label: 'Sample-01' }],
  rows: [{ group: 'Modified Proctor', name: 'MDD', unit: 'g/cc', method: 'IS 2720 (Part 8)', values: ['1.965'] }, { group: 'Modified Proctor', name: 'OMC', unit: '%', method: 'IS 2720 (Part 8)', values: ['10.2'] }, { name: 'Free Swell Index of soil', unit: '%', method: 'IS 2720 (Part 40)', values: ['20'] }],
  remarks: 'The soil can be used for backfilling purpose.',
};

export function TemplateDesigner() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: list } = useApi<any[]>('/doc-templates');
  const { data: company } = useApi<any>('/company');
  const tpl = list?.find((t) => String(t.id) === id);
  const [ov, setOv] = useState<DocOverrides>({});
  const [sel, setSel] = useState<string | null>(null);
  const [name, setName] = useState('');
  useEffect(() => { if (tpl) setName(tpl.name); }, [tpl]);
  const base = tpl?.definition as DocTemplate | undefined;
  const eff = useMemo(() => (base ? applyOverrides(base, ov) : null), [base, ov]);
  if (!tpl || !company || !eff || !base) return <Loading />;
  const totals = computeTotals(SAMPLE.lines, { supplierState: company.stateCode, placeOfSupply: '36', defaultGst: 18 });
  const save = async () => {
    const r = await api<any>('/doc-templates', { body: { kind: tpl.kind, definition: { ...eff, name }, name, makeDefault: true, baseId: tpl.id } });
    ok(`Saved as v${r.version} and set as default`); nav(`/settings/templates/${r.id}`); setOv({});
  };
  return (
    <>
      <PageHeader title={`${KINDS[tpl.kind]} layout – v${tpl.version}`} subtitle="Preview uses sample data. Click a block to edit it."
        actions={<><TextInput value={name} onChange={(e) => setName(e.currentTarget.value)} w={260} /><Button onClick={save} disabled={!Object.keys(ov).length && name === tpl.name}>Save as new version</Button></>} />
      <Grid>
        <Grid.Col span={{ base: 12, lg: 4 }}><DesignPanel base={base} overrides={ov} onChange={setOv} selected={sel} onSelect={setSel} onReset={() => setOv({})} /></Grid.Col>
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <div className="doc-stage" onClick={() => setSel(null)}><FitWidth>
            <DocRenderer template={eff} kind={tpl.kind} data={SAMPLE} company={company} number={tpl.kind === 'invoice' ? '183/26-27' : 'Q/076/26-27'} status="draft" totals={totals} selected={sel} onSelect={setSel} />
          </FitWidth></div>
          <Text size="xs" c="dimmed" mt="xs">Signature and seal appear when a real document is signed and issued.</Text>
        </Grid.Col>
      </Grid>
    </>
  );
}
