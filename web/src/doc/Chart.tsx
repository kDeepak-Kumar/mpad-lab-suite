/** Minimal SVG line chart used on observation sheets and reports (prints crisply). */
export function LineChart({ points, title, xLabel, yLabel, width = 520, height = 300 }: { points: [number, number][]; title?: string; xLabel: string; yLabel: string; width?: number; height?: number }) {
  const pad = { l: 56, r: 16, t: title ? 28 : 12, b: 44 };
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const nice = (max: number) => { if (max <= 0) return 1; const p = 10 ** Math.floor(Math.log10(max)); const m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
  const xmin = Math.min(0, ...pts.map((p) => p[0])), ymin = Math.min(0, ...pts.map((p) => p[1]));
  const xmax = nice(Math.max(1e-9, ...pts.map((p) => p[0]))), ymax = nice(Math.max(1e-9, ...pts.map((p) => p[1])) * 1.05);
  const W = width - pad.l - pad.r, H = height - pad.t - pad.b;
  const X = (x: number) => pad.l + ((x - xmin) / (xmax - xmin || 1)) * W;
  const Y = (y: number) => pad.t + H - ((y - ymin) / (ymax - ymin || 1)) * H;
  const ticks = (lo: number, hi: number) => Array.from({ length: 6 }, (_, i) => lo + ((hi - lo) * i) / 5);
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.0+$/, '');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width, fontFamily: 'inherit' }}>
      {title && <text x={width / 2} y={16} textAnchor="middle" fontSize={13} fontWeight={600}>{title}</text>}
      {ticks(xmin, xmax).map((t) => <g key={'x' + t}><line x1={X(t)} x2={X(t)} y1={pad.t} y2={pad.t + H} stroke="#ddd" /><text x={X(t)} y={pad.t + H + 14} fontSize={10} textAnchor="middle">{fmt(t)}</text></g>)}
      {ticks(ymin, ymax).map((t) => <g key={'y' + t}><line x1={pad.l} x2={pad.l + W} y1={Y(t)} y2={Y(t)} stroke="#ddd" /><text x={pad.l - 6} y={Y(t) + 3} fontSize={10} textAnchor="end">{fmt(t)}</text></g>)}
      <rect x={pad.l} y={pad.t} width={W} height={H} fill="none" stroke="#555" />
      {pts.length > 1 && <polyline fill="none" stroke="#1f3a68" strokeWidth={1.8} points={pts.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ')} />}
      {pts.map((p, i) => <circle key={i} cx={X(p[0])} cy={Y(p[1])} r={3} fill="#1f3a68" />)}
      <text x={pad.l + W / 2} y={height - 8} fontSize={11} textAnchor="middle">{xLabel}</text>
      <text x={14} y={pad.t + H / 2} fontSize={11} textAnchor="middle" transform={`rotate(-90 14 ${pad.t + H / 2})`}>{yLabel}</text>
    </svg>
  );
}
