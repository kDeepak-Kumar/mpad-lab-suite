import { Alert, Badge, Button, Checkbox, Group, Paper, SegmentedControl, Select, Stack, Switch, Text } from '@mantine/core';
import { buildLayout, formatFits, refreshRoles, REPORT_FORMATS, type ReportLayout, type ReportOptions, type TestSnap } from '@suite/shared';

/**
 * What goes on this report: format, parameters (tests / result rows), customer contact details and the
 * client-specific additional information. Changes rebuild only the affected parts of the layout; nothing
 * here changes the client master, the samples or the observation sheets.
 */
export function ReportContents({ data, onChange, disabled }: { data: Record<string, any>; onChange: (d: Record<string, any>) => void; disabled: boolean }) {
  const layout = data.layout as ReportLayout | undefined;
  const opts: ReportOptions = data.options ?? {};
  const tests: TestSnap[] = data.tests ?? [];
  const ex = new Set((opts.excluded ?? []).map(String));
  const edited = !!layout?.edited;

  const rebuild = (d: Record<string, any>, ask = true) => {
    if (ask && edited && !window.confirm('Rebuild the report layout from the format? Changes made by hand in the report (text, tables, formatting) will be replaced.')) return;
    onChange({ ...d, layout: { ...buildLayout({ data: d }), edited: false } });
  };
  const setOpts = (patch: Partial<ReportOptions>, how: 'rebuild' | ('customer' | 'extra')[]) => {
    const d = { ...data, options: { ...opts, ...patch } };
    if (!layout) return onChange(d);
    if (how === 'rebuild') return rebuild(d);
    onChange({ ...d, layout: refreshRoles(layout, { data: d }, how) });
  };
  const toggle = (id: string, on: boolean) => {
    const next = new Set(ex); if (on) next.delete(id); else next.add(id);
    if (tests.filter((t) => !next.has(String(t.id))).length === 0) return; // keep at least one test
    setOpts({ excluded: [...next] }, 'rebuild');
  };
  if (!layout) {
    return (
      <Paper withBorder p="sm">
        <Text size="sm" fw={600}>Report format</Text>
        <Text size="xs" c="dimmed" mb={6}>This report was prepared before editable report formats. Convert it to edit tables and text directly on the report.</Text>
        <Button size="xs" disabled={disabled} onClick={() => rebuild(data, false)}>Convert to editable layout</Button>
      </Paper>
    );
  }
  const extra = (data.extra ?? []) as { key: string; label: string; value: string; sample?: string }[];
  const extraKeys = [...new Map(extra.map((x) => [x.key, x.label])).entries()];
  const c = data.customer;
  const fmtLabel = (t: TestSnap) => `${t.name}${t.header.age ? ` – ${t.header.age} days` : ''}${t.header.dia ? ` – ${t.header.dia} mm` : ''}${t.sampleLabel || (data.samples ?? []).length > 1 ? ` (${t.sampleLabel || t.sampleCode})` : ''}`;
  return (
    <Stack gap="sm">
      <Paper withBorder p="sm">
        <Group justify="space-between" align="flex-end">
          <Select size="xs" style={{ flex: 1 }} label="Report format" disabled={disabled} data={Object.entries(REPORT_FORMATS).map(([value, f]) => { const fits = formatFits(value, tests.map((t) => t.code)); return { value, label: fits ? f.label : `${f.label} – not for these tests`, disabled: tests.length > 0 && !fits }; })}
            value={layout.format} onChange={(v) => v && setOpts({ format: v }, 'rebuild')} />
          <Button size="xs" variant="default" disabled={disabled} onClick={() => rebuild(data)}>Rebuild layout</Button>
        </Group>
        <Text size="xs" c="dimmed" mt={4}>{edited ? 'Edited by hand – edit the report directly in the preview. Rebuilding replaces the manual changes.' : 'Click any table or text in the preview to edit it like a Word document.'}</Text>
      </Paper>
      {tests.length > 0 && (
        <Paper withBorder p="sm">
          <Text size="sm" fw={600}>Parameters on this report</Text>
          <Text size="xs" c="dimmed" mb={6}>Untick what should not appear (for example the 28-day cubes on an early report). The tests stay available for another report.</Text>
          <Stack gap={4}>
            {tests.map((t) => {
              const on = !ex.has(String(t.id));
              return (
                <div key={t.id}>
                  <Checkbox size="xs" disabled={disabled} checked={on} onChange={(e) => toggle(String(t.id), e.currentTarget.checked)}
                    label={<Group gap={6}><span>{fmtLabel(t)}</span>{t.previous && <Badge size="xs" variant="light" color="gray">issued earlier in {t.previous}</Badge>}</Group>} />
                  {on && t.rows.length > 1 && (
                    <Group gap="md" ml={28} mt={2}>
                      {t.rows.map((r) => <Checkbox key={r.id} size="xs" disabled={disabled} checked={!ex.has(r.id)} onChange={(e) => toggle(r.id, e.currentTarget.checked)} label={`${r.group ? `${r.group} – ` : ''}${r.name}`} />)}
                    </Group>
                  )}
                </div>
              );
            })}
          </Stack>
        </Paper>
      )}
      <Paper withBorder p="sm">
        <Text size="sm" fw={600}>Customer</Text>
        {c ? <Text size="xs" c="dimmed">{c.name}{c.project ? ` · Project: ${c.project}` : ''}{c.customerRef ? ` · Ref: ${c.customerRef}` : ''} – from the client master. Changes typed in the report apply to this report only.</Text>
          : <Text size="xs" c="dimmed">Use “Refresh results” to load the customer details from the client master.</Text>}
        <Switch mt={6} size="xs" disabled={disabled || !c?.contact} label={c?.contact ? `Include contact details (${[c.contact.name, c.contact.phone, c.contact.email].filter(Boolean).join(', ')})` : 'Include contact details (no contact on the client)'}
          checked={!!opts.includeContact} onChange={(e) => setOpts({ includeContact: e.currentTarget.checked }, ['customer'])} />
      </Paper>
      <Paper withBorder p="sm">
        <Text size="sm" fw={600}>Additional information</Text>
        {extraKeys.length === 0
          ? <Text size="xs" c="dimmed">None recorded. Define fields such as supplier, vehicle no. or invoice no. on the client (Clients → Additional sample fields), then fill them in on each sample.</Text>
          : <>
            <Switch size="xs" mt={4} disabled={disabled} label="Show on the report" checked={opts.includeExtra !== false} onChange={(e) => setOpts({ includeExtra: e.currentTarget.checked }, ['extra'])} />
            {opts.includeExtra !== false && <>
              <Group gap="md" mt={6}>{extraKeys.map(([k, label]) => <Checkbox key={k} size="xs" disabled={disabled} label={label} checked={!(opts.extraHidden ?? []).includes(k)}
                onChange={(e) => setOpts({ extraHidden: e.currentTarget.checked ? (opts.extraHidden ?? []).filter((x) => x !== k) : [...(opts.extraHidden ?? []), k] }, ['extra'])} />)}</Group>
              <SegmentedControl mt={6} size="xs" disabled={disabled} data={[{ value: 'line', label: 'One line in Sample details' }, { value: 'table', label: 'A row per field' }, { value: 'below', label: 'Below the results' }]} value={opts.extraStyle ?? 'line'} onChange={(v) => setOpts({ extraStyle: v as 'line' | 'table' | 'below' }, ['extra'])} />
            </>}
          </>}
      </Paper>
      {data.layout && !data.tests && <Alert variant="light" color="gray">Use “Refresh results” to enable parameter selection and the test-specific format.</Alert>}
    </Stack>
  );
}
