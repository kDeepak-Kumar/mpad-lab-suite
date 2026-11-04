import { Area, Bar, BarChart, CartesianGrid, Cell, Funnel, FunnelChart, LabelList, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ComposedChart } from 'recharts';
import { Table, Text } from '@mantine/core';
import { reportObject, timeLabel, type ReportResult } from '@suite/shared';
import { compact, money } from '../api';

// Validated categorical order (blue, orange, aqua, yellow, magenta, green, violet, red) – identity follows the entity, never rank.
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const INK2 = '#52514e', GRID = '#eceae6';

export function isMoney(r: ReportResult) {
  const f = reportObject(r.spec.object)?.fields.find((x) => x.key === r.spec.measure.field);
  return r.spec.measure.agg !== 'count' && f?.type === 'currency';
}
export const fmtValue = (r: ReportResult, v: number) => (isMoney(r) ? `₹${money(v)}` : Number.isInteger(v) ? money(v) : v.toFixed(1));

export function ReportChart({ result, height = 280 }: { result: ReportResult; height?: number }) {
  const chart = result.spec.chart ?? (result.spec.groupBy?.length ? 'bar' : 'number');
  const g1 = result.spec.groupBy?.[0] ?? '';
  const lab = (k: string) => timeLabel(g1, k);
  const axisTick = { fontSize: 11, fill: INK2 };
  const tip = (v: number) => fmtValue(result, v);
  const ints = result.spec.measure.agg === 'count';
  if (chart === 'number' || !result.spec.groupBy?.length) {
    return <div style={{ padding: '12px 4px' }}><div style={{ fontSize: 34, fontWeight: 750, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{fmtValue(result, result.total)}</div><Text size="sm" c="dimmed">{result.measureLabel} · {result.count} record(s)</Text></div>;
  }
  if (!result.rows.length) return <Text c="dimmed" size="sm" p="lg" ta="center">No data for this period or filter.</Text>;

  if (result.series2?.length) {
    const s2 = result.series2.slice(0, 8);
    const labels = [...new Set(result.rows.map((r) => r.label))];
    const data = labels.map((l) => ({ name: lab(l), ...Object.fromEntries(s2.map((s) => [s, result.rows.find((r) => r.label === l && r.label2 === s)?.value ?? 0])) }));
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => compact(v)} width={52} allowDecimals={!ints} />
          <Tooltip formatter={(v: number) => tip(v)} cursor={{ fill: '#f2f4f7' }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          {s2.map((s, i) => <Bar key={s} dataKey={s} fill={SERIES[i]} radius={[4, 4, 0, 0]} maxBarSize={28} />)}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  const data = result.rows.map((r) => ({ name: lab(r.label), value: r.value, actual: r.forecast ? null : r.value, forecast: r.forecast ? r.value : null }));
  // join the forecast line to the last actual point
  const lastActual = data.map((d) => d.actual !== null).lastIndexOf(true);
  if (lastActual >= 0 && data.some((d) => d.forecast !== null)) data[lastActual].forecast = data[lastActual].actual;

  if (chart === 'line') return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => compact(v)} width={52} allowDecimals={!ints} />
        <Tooltip formatter={(v: number, n) => [tip(v), n === 'forecast' ? 'Forecast' : result.measureLabel]} />
        <Line type="monotone" dataKey="actual" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 4, fill: SERIES[0], stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls={false} />
        <Line type="monotone" dataKey="forecast" stroke={SERIES[0]} strokeWidth={2} strokeDasharray="6 5" dot={{ r: 4, fill: '#fff', stroke: SERIES[0], strokeWidth: 2 }} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
  if (chart === 'area') return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.32} /><stop offset="100%" stopColor={SERIES[0]} stopOpacity={0.02} /></linearGradient></defs>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => compact(v)} width={52} allowDecimals={!ints} />
        <Tooltip formatter={(v: number, n) => [tip(v), n === 'forecast' ? 'Forecast' : result.measureLabel]} />
        <Area type="monotone" dataKey="actual" stroke={SERIES[0]} strokeWidth={2} fill="url(#areaFill)" connectNulls={false} />
        <Line type="monotone" dataKey="forecast" stroke={SERIES[0]} strokeWidth={2} strokeDasharray="6 5" dot={false} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
  if (chart === 'pie' || chart === 'donut') {
    const top = data.slice(0, 7);
    const others = data.slice(7).reduce((a, d) => a + d.value, 0);
    const slices = others > 0 ? [...top, { name: 'Others', value: others }] : top;
    const sum = slices.reduce((a, d) => a + d.value, 0);
    return (
      <div style={{ position: 'relative' }}>
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="name" cx="36%" innerRadius={chart === 'donut' ? '58%' : 0} outerRadius="82%" paddingAngle={chart === 'donut' ? 1.5 : 0.5} stroke="#fff" strokeWidth={2}
              label={({ percent }) => (percent >= 0.05 ? `${Math.round(percent * 100)}%` : '')} labelLine={false} style={{ fontSize: 11, fontWeight: 600 }}>
              {slices.map((_, i) => <Cell key={i} fill={i === 7 ? '#c3c8d0' : SERIES[i]} />)}
            </Pie>
            <Tooltip formatter={(v: number) => tip(v)} />
            <Legend iconType="circle" layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 12, maxWidth: '45%' }} />
          </PieChart>
        </ResponsiveContainer>
        {chart === 'donut' && <div className="donut-center"><div className="donut-total">{isMoney(result) ? `₹${compact(sum)}` : compact(sum)}</div><div className="donut-cap">Total</div></div>}
      </div>
    );
  }
  if (chart === 'funnel') {
    const steps = [...data].sort((a, b) => b.value - a.value).slice(0, 8).map((d, i) => ({ ...d, fill: SERIES[i] }));
    return (
      <ResponsiveContainer width="100%" height={height}>
        <FunnelChart margin={{ right: 120 }}>
          <Tooltip formatter={(v: number) => tip(v)} />
          <Funnel dataKey="value" nameKey="name" data={steps} isAnimationActive>
            <LabelList position="right" dataKey="name" fill={INK2} stroke="none" style={{ fontSize: 12 }} />
            <LabelList position="center" dataKey="value" fill="#fff" stroke="none" style={{ fontSize: 11, fontWeight: 650 }} formatter={(v: number) => (isMoney(result) ? compact(v) : v)} />
          </Funnel>
        </FunnelChart>
      </ResponsiveContainer>
    );
  }
  if (chart === 'table') return (
    <Table fz="sm" striped>
      <Table.Thead><Table.Tr><Table.Th>{result.groupLabel}</Table.Th><Table.Th ta="right">{result.measureLabel}</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{data.map((d, i) => <Table.Tr key={i}><Table.Td>{d.name}</Table.Td><Table.Td ta="right">{tip(d.value)}</Table.Td></Table.Tr>)}</Table.Tbody>
    </Table>
  );
  const horizontal = chart === 'hbar';
  const h = horizontal ? Math.max(height, data.length * 30 + 30) : height;
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke={GRID} />
        {horizontal ? <>
          <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => compact(v)} allowDecimals={!ints} />
          <YAxis type="category" dataKey="name" tick={axisTick} tickLine={false} axisLine={false} width={160} interval={0} />
        </> : <>
          <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} interval={0} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => compact(v)} width={52} allowDecimals={!ints} />
        </>}
        <Tooltip formatter={(v: number) => [tip(v), result.measureLabel]} cursor={{ fill: '#f2f4f7' }} />
        <Bar dataKey="value" radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={horizontal ? 18 : 36}>
          {data.map((d, i) => <Cell key={i} fill={d.forecast !== null && d.actual === null ? '#b6d2f6' : SERIES[0]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
