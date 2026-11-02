import { useId } from 'react';

/** SVG line chart for observation sheets and reports (prints crisply, no external library). */
export interface ChartLine { label: string; points: [number, number][]; dashed?: boolean; markers?: boolean }
export interface AxisOpts { log?: boolean; reverse?: boolean; min?: number; max?: number }

const COLORS = ['#1f3a68', '#eb6834', '#1baf7a', '#6250d6'];

const niceStep = (span: number, target = 6) => {
  const raw = span / target;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
};

/** Axis range and ticks, scaled automatically from the data unless fixed limits are given. */
function axis(values: number[], o: AxisOpts, percent = false) {
  if (o.log) {
    const pos = values.filter((v) => v > 0);
    let lo = Math.floor(Math.log10(o.min && o.min > 0 ? o.min : Math.min(...pos)));
    let hi = Math.ceil(Math.log10(o.max && o.max > 0 ? o.max : Math.max(...pos)));
    if (hi <= lo) hi = lo + 1;
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    const ticks: { v: number; major: boolean; label: boolean }[] = [];
    const decades = hi - lo;
    for (let e = lo; e <= hi; e++) for (const m of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const v = m * 10 ** e;
      if (Math.log10(v) > hi + 1e-9) break;
      ticks.push({ v, major: m === 1, label: m === 1 || (decades <= 2 && (m === 2 || m === 5)) || (decades === 1 && m !== 7 && m !== 9) });
    }
    return { lo, hi, ticks, t: (v: number) => Math.log10(v) };
  }
  const dmin = Math.min(...values), dmax = Math.max(...values);
  const span = dmax - dmin || Math.abs(dmax) || 1;
  let lo = o.min ?? (dmin >= 0 && dmin <= span * 0.8 ? 0 : dmin - span * 0.05);
  let hi = o.max ?? dmax + span * 0.06;
  if (percent && o.min === undefined && o.max === undefined && dmin >= 0 && dmax <= 100 && dmax >= 60) { lo = 0; hi = 100; }
  const step = niceStep(hi - lo);
  if (o.min === undefined) lo = Math.floor(lo / step + 1e-9) * step;
  if (o.max === undefined) hi = Math.ceil(hi / step - 1e-9) * step;
  if (hi <= lo) hi = lo + step;
  const ticks: { v: number; major: boolean; label: boolean }[] = [];
  for (let v = lo, i = 0; v <= hi + step * 1e-6 && i < 60; v += step, i++) ticks.push({ v: Number(v.toFixed(10)), major: true, label: true });
  // minor grid: 5 subdivisions for a clear, graph-paper look
  const minor: number[] = [];
  for (let k = 0; k < ticks.length - 1; k++) for (let j = 1; j < 5; j++) minor.push(ticks[k].v + (step * j) / 5);
  return { lo, hi, ticks: [...ticks, ...minor.map((v) => ({ v, major: false, label: false }))], t: (v: number) => v };
}

const fmt = (v: number) => {
  const a = Math.abs(v);
  return (a >= 1000 ? v.toFixed(0) : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(3)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
};

export function LineChart({ points, series, title, xLabel, yLabel, xLog, yLog, yReverse, xTop, xMin, xMax, yMin, yMax, fit, note, width = 600, height = 360 }: {
  points?: [number, number][]; series?: ChartLine[]; title?: string; xLabel: string; yLabel: string;
  xLog?: boolean; yLog?: boolean; yReverse?: boolean; xTop?: boolean; xMin?: number; xMax?: number; yMin?: number; yMax?: number;
  fit?: string; note?: string; width?: number; height?: number;
}) {
  const clip = `plot${useId().replace(/:/g, '')}`;
  const lines: ChartLine[] = (series?.length ? series : [{ label: yLabel, points: points ?? [], markers: true }])
    .map((l) => ({ ...l, points: l.points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && (!xLog || x > 0) && (!yLog || y > 0)) }))
    .filter((l) => l.points.length > 0);
  const all = lines.flatMap((l) => l.points);
  if (!all.length) return null;
  const legend = lines.length > 1;
  const pad = { l: 62, r: 18, t: (title ? 26 : 8) + (xTop ? 34 : 6), b: (xTop ? 10 : 42) + (legend ? 22 : 0) };
  const ax = axis(all.map((p) => p[0]), { log: xLog, min: xMin, max: xMax });
  const ay = axis(all.map((p) => p[1]), { log: yLog, reverse: yReverse, min: yMin, max: yMax }, /%/.test(yLabel));
  const W = width - pad.l - pad.r, H = height - pad.t - pad.b;
  const X = (x: number) => pad.l + ((ax.t(x) - ax.lo) / (ax.hi - ax.lo || 1)) * W;
  const Yf = (y: number) => ((ay.t(y) - ay.lo) / (ay.hi - ay.lo || 1)) * H;
  const Y = (y: number) => (yReverse ? pad.t + Yf(y) : pad.t + H - Yf(y));
  const xAxisY = xTop ? pad.t : pad.t + H;

  let fitLine: [number, number][] | null = null;
  if (fit === 'line' && lines[0].points.length >= 2) {
    const ps = lines[0].points.map(([x, y]) => [ax.t(x), y]);
    const n = ps.length, mx = ps.reduce((s, p) => s + p[0], 0) / n, my = ps.reduce((s, p) => s + p[1], 0) / n;
    const sxx = ps.reduce((s, p) => s + (p[0] - mx) ** 2, 0), sxy = ps.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
    if (sxx > 0) {
      const b = sxy / sxx, a = my - b * mx;
      const x0 = xLog ? 10 ** ax.lo : ax.lo, x1 = xLog ? 10 ** ax.hi : ax.hi;
      fitLine = [[x0, a + b * ax.t(x0)], [x1, a + b * ax.t(x1)]];
    }
  }
  const inX = (v: number) => ax.t(v) >= ax.lo - 1e-9 && ax.t(v) <= ax.hi + 1e-9;
  const inY = (v: number) => ay.t(v) >= ay.lo - 1e-9 && ay.t(v) <= ay.hi + 1e-9;

  return (
    <figure style={{ margin: 0, breakInside: 'avoid' }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width, fontFamily: 'inherit', display: 'block', margin: '0 auto' }} role="img" aria-label={title}>
        {title && <text x={width / 2} y={16} textAnchor="middle" fontSize={13} fontWeight={600}>{title}</text>}
        <defs><clipPath id={clip}><rect x={pad.l} y={pad.t} width={W} height={H} /></clipPath></defs>
        {ax.ticks.filter((t) => inX(t.v)).map((t, i) => (
          <g key={'x' + i}>
            <line x1={X(t.v)} x2={X(t.v)} y1={pad.t} y2={pad.t + H} stroke={t.major ? '#c9ced6' : '#eceef1'} />
            {t.label && <text x={X(t.v)} y={xTop ? pad.t - 6 : pad.t + H + 14} fontSize={10} textAnchor="middle">{fmt(t.v)}</text>}
          </g>
        ))}
        {ay.ticks.filter((t) => inY(t.v)).map((t, i) => (
          <g key={'y' + i}>
            <line x1={pad.l} x2={pad.l + W} y1={Y(t.v)} y2={Y(t.v)} stroke={t.major ? '#c9ced6' : '#eceef1'} />
            {t.label && <text x={pad.l - 6} y={Y(t.v) + 3} fontSize={10} textAnchor="end">{fmt(t.v)}</text>}
          </g>
        ))}
        <rect x={pad.l} y={pad.t} width={W} height={H} fill="none" stroke="#444" />
        <line x1={pad.l} x2={pad.l + W} y1={xAxisY} y2={xAxisY} stroke="#222" strokeWidth={1.2} />
        <g clipPath={`url(#${clip})`}>
          {fitLine && <line x1={X(fitLine[0][0])} y1={Y(fitLine[0][1])} x2={X(fitLine[1][0])} y2={Y(fitLine[1][1])} stroke={COLORS[0]} strokeWidth={1.6} />}
          {lines.map((l, k) => (
            <g key={k}>
              {!(fit === 'line' && k === 0) && l.points.length > 1 && <polyline fill="none" stroke={COLORS[k % COLORS.length]} strokeWidth={k === 0 ? 1.9 : 1.3} strokeDasharray={l.dashed ? '5 4' : undefined} points={l.points.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ')} />}
              {(l.markers ?? k === 0) && l.points.map((p, i) => <circle key={i} cx={X(p[0])} cy={Y(p[1])} r={3.2} fill={COLORS[k % COLORS.length]} />)}
            </g>
          ))}
        </g>
        <text x={pad.l + W / 2} y={xTop ? pad.t - 22 : pad.t + H + 32} fontSize={11} fontWeight={600} textAnchor="middle">{xLabel}</text>
        <text x={14} y={pad.t + H / 2} fontSize={11} fontWeight={600} textAnchor="middle" transform={`rotate(-90 14 ${pad.t + H / 2})`}>{yLabel}</text>
        {legend && (
          <g transform={`translate(${pad.l}, ${height - 8})`}>
            {lines.map((l, k) => (
              <g key={k} transform={`translate(${k * Math.min(170, W / lines.length)}, 0)`}>
                <line x1={0} x2={22} y1={-4} y2={-4} stroke={COLORS[k % COLORS.length]} strokeWidth={2} strokeDasharray={l.dashed ? '5 4' : undefined} />
                <text x={28} y={0} fontSize={10}>{l.label}</text>
              </g>
            ))}
          </g>
        )}
      </svg>
      {note && <figcaption style={{ fontSize: '8.5pt', color: '#333', maxWidth: width, margin: '4px auto 0', textAlign: 'left' }}>{note}</figcaption>}
    </figure>
  );
}
