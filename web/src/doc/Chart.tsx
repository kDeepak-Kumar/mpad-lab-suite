import { useId } from 'react';
/** SVG line chart for observation sheets and reports (prints crisply, no external library). */
export interface ChartLine { label: string; points: [number, number][]; dashed?: boolean; markers?: boolean }

const COLORS = ['#1f3a68', '#eb6834', '#1baf7a', '#6250d6'];

export function LineChart({ points, series, title, xLabel, yLabel, xLog, fit, width = 560, height = 320 }: {
  points?: [number, number][]; series?: ChartLine[]; title?: string; xLabel: string; yLabel: string; xLog?: boolean; fit?: string; width?: number; height?: number;
}) {
  const clip = `plot${useId().replace(/:/g, '')}`;
  const lines: ChartLine[] = (series?.length ? series : [{ label: yLabel, points: points ?? [], markers: true }])
    .map((l) => ({ ...l, points: [...l.points].filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && (!xLog || x > 0)).sort((a, b) => a[0] - b[0]) }))
    .filter((l) => l.points.length > 0);
  const legend = lines.length > 1;
  const pad = { l: 58, r: 16, t: title ? 28 : 12, b: legend ? 62 : 44 };
  const all = lines.flatMap((l) => l.points);
  if (!all.length) return null;
  const tx = (x: number) => (xLog ? Math.log10(x) : x);
  const nice = (v: number, up: boolean) => {
    if (v === 0) return 0;
    const p = 10 ** Math.floor(Math.log10(Math.abs(v)));
    const steps = [1, 2, 2.5, 5, 10];
    const m = Math.abs(v) / p;
    const s = up ? steps.find((k) => k >= m - 1e-9)! : [...steps].reverse().find((k) => k <= m + 1e-9) ?? 1;
    return Math.sign(v) * s * p;
  };
  let xmin: number, xmax: number;
  if (xLog) {
    xmin = Math.floor(Math.log10(Math.min(...all.map((p) => p[0]))));
    xmax = Math.ceil(Math.log10(Math.max(...all.map((p) => p[0]))));
    if (xmax === xmin) xmax += 1;
  } else {
    const lo = Math.min(...all.map((p) => p[0])), hi = Math.max(...all.map((p) => p[0]));
    xmin = lo >= 0 && lo < (hi - lo) * 0.6 ? 0 : nice(lo, false); xmax = nice(hi, true);
  }
  const ylo = Math.min(...all.map((p) => p[1])), yhi = Math.max(...all.map((p) => p[1]));
  const span = yhi - ylo || Math.abs(yhi) || 1;
  let ymin = ylo >= 0 && ylo < span * 0.8 ? 0 : ylo - span * 0.1;
  let ymax = yhi + span * 0.08;
  let step = nice(((ymax - ymin) / 5), true);
  ymin = Math.floor(ymin / step) * step; ymax = Math.ceil(ymax / step) * step;
  // percentages (passing, compaction) read best on a fixed 0–100 scale
  if (ylo >= 0 && yhi <= 100 && yhi >= 60 && /%/.test(yLabel)) { ymin = 0; ymax = 100; step = 20; }
  const W = width - pad.l - pad.r, H = height - pad.t - pad.b;
  const X = (x: number) => pad.l + ((tx(x) - xmin) / (xmax - xmin || 1)) * W;
  const Y = (y: number) => pad.t + H - ((y - ymin) / (ymax - ymin || 1)) * H;
  const fmt = (v: number) => {
    const a = Math.abs(v);
    return (a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(3)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  };
  const xTicks: { v: number; major: boolean }[] = [];
  if (xLog) {
    for (let e = xmin; e <= xmax; e++) for (const m of [1, 2, 3, 4, 5, 6, 7, 8, 9]) { const v = m * 10 ** e; if (Math.log10(v) <= xmax + 1e-9) xTicks.push({ v, major: m === 1 || m === 2 || m === 5 }); }
  } else {
    const st = nice((xmax - xmin) / 6, true);
    for (let v = xmin; v <= xmax + 1e-9; v += st) xTicks.push({ v: Number(v.toFixed(10)), major: true });
  }
  const yTicks: number[] = [];
  for (let v = ymin; v <= ymax + 1e-9; v += step) yTicks.push(Number(v.toFixed(10)));

  let fitLine: [number, number][] | null = null;
  if (fit === 'line' && lines[0].points.length >= 2) {
    const ps = lines[0].points.map(([x, y]) => [tx(x), y]);
    const n = ps.length, mx = ps.reduce((s, p) => s + p[0], 0) / n, my = ps.reduce((s, p) => s + p[1], 0) / n;
    const sxx = ps.reduce((s, p) => s + (p[0] - mx) ** 2, 0), sxy = ps.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
    if (sxx > 0) {
      const b = sxy / sxx, a = my - b * mx;
      const x0 = xLog ? 10 ** xmin : xmin, x1 = xLog ? 10 ** xmax : xmax;
      fitLine = [[x0, a + b * tx(x0)], [x1, a + b * tx(x1)]];
    }
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width, fontFamily: 'inherit' }} role="img" aria-label={title}>
      {title && <text x={width / 2} y={16} textAnchor="middle" fontSize={13} fontWeight={600}>{title}</text>}
      <defs><clipPath id={clip}><rect x={pad.l} y={pad.t} width={W} height={H} /></clipPath></defs>
      {xTicks.map((t, i) => (
        <g key={'x' + i}>
          <line x1={X(t.v)} x2={X(t.v)} y1={pad.t} y2={pad.t + H} stroke={t.major ? '#d4d4d4' : '#eeeeee'} />
          {t.major && <text x={X(t.v)} y={pad.t + H + 14} fontSize={10} textAnchor="middle">{fmt(t.v)}</text>}
        </g>
      ))}
      {yTicks.map((t, i) => <g key={'y' + i}><line x1={pad.l} x2={pad.l + W} y1={Y(t)} y2={Y(t)} stroke="#d4d4d4" /><text x={pad.l - 6} y={Y(t) + 3} fontSize={10} textAnchor="end">{fmt(t)}</text></g>)}
      <rect x={pad.l} y={pad.t} width={W} height={H} fill="none" stroke="#555" />
      <g clipPath={`url(#${clip})`}>
        {fitLine && <line x1={X(fitLine[0][0])} y1={Y(fitLine[0][1])} x2={X(fitLine[1][0])} y2={Y(fitLine[1][1])} stroke={COLORS[0]} strokeWidth={1.6} />}
        {lines.map((l, k) => (
          <g key={k}>
            {!(fit === 'line' && k === 0) && l.points.length > 1 && <polyline fill="none" stroke={COLORS[k % COLORS.length]} strokeWidth={k === 0 ? 1.8 : 1.3} strokeDasharray={l.dashed ? '5 4' : undefined} points={l.points.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ')} />}
            {(l.markers ?? k === 0) && l.points.map((p, i) => <circle key={i} cx={X(p[0])} cy={Y(p[1])} r={3} fill={COLORS[k % COLORS.length]} />)}
          </g>
        ))}
      </g>
      <text x={pad.l + W / 2} y={pad.t + H + 32} fontSize={11} textAnchor="middle">{xLabel}</text>
      <text x={14} y={pad.t + H / 2} fontSize={11} textAnchor="middle" transform={`rotate(-90 14 ${pad.t + H / 2})`}>{yLabel}</text>
      {legend && (
        <g transform={`translate(${pad.l}, ${height - 14})`}>
          {lines.map((l, k) => (
            <g key={k} transform={`translate(${k * Math.min(170, W / lines.length)}, 0)`}>
              <line x1={0} x2={22} y1={-4} y2={-4} stroke={COLORS[k % COLORS.length]} strokeWidth={2} strokeDasharray={l.dashed ? '5 4' : undefined} />
              <text x={28} y={0} fontSize={10}>{l.label}</text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}
