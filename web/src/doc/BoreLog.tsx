import { useId } from 'react';
import { soilStyle, type BoreLogData, type SoilPattern } from '@suite/shared';

/** Hatch pattern for a soil type, so logs read clearly in black-and-white print too. */
function Pattern({ id, color, pattern }: { id: string; color: string; pattern: SoilPattern }) {
  const ink = '#4b5563';
  const body: Record<SoilPattern, JSX.Element> = {
    cross: <><path d="M0 0L8 8M8 0L0 8" stroke={ink} strokeWidth={0.7} /></>,
    dash: <><path d="M1 3H7M5 7H11" stroke={ink} strokeWidth={0.9} /></>,
    dots: <><circle cx={2} cy={2} r={0.8} fill={ink} /><circle cx={6} cy={6} r={0.8} fill={ink} /></>,
    circles: <><circle cx={4} cy={4} r={2.2} fill="none" stroke={ink} strokeWidth={0.7} /></>,
    brick: <><path d="M0 0H8M0 4H8M4 0V4M0 4V8" stroke={ink} strokeWidth={0.7} /></>,
    hatch: <><path d="M0 8L8 0M-2 2L2 -2M6 10L10 6" stroke={ink} strokeWidth={0.7} /></>,
    wave: <><path d="M0 4Q2 2 4 4T8 4" fill="none" stroke={ink} strokeWidth={0.7} /></>,
    solid: <></>,
    dotdash: <><path d="M1 2H5" stroke={ink} strokeWidth={0.8} /><circle cx={6} cy={6} r={0.8} fill={ink} /></>,
    v: <><path d="M1 2L3 6L5 2" fill="none" stroke={ink} strokeWidth={0.7} /></>,
  };
  return (
    <pattern id={id} width={8} height={8} patternUnits="userSpaceOnUse">
      <rect width={8} height={8} fill={color} />
      {body[pattern]}
    </pattern>
  );
}

const fmtD = (v: number) => v.toFixed(2);
/** Short N label for narrow columns: '>50 (refusal, 6 cm)' → '>50 R/6 cm'. */
const shortN = (l: string) => l.replace(/\s*\(refusal(?:, ([\d.]+) cm)?\)/, (_m, cm) => (cm ? ` R/${cm} cm` : ' R'));

/** Borehole log: depth scale, strata column with legend patterns, description, SPT N (values and graph), samples and core recovery / RQD. */
export function BoreLog({ data, nMax = 50 }: { data: BoreLogData; nMax?: number }) {
  const uid = useId().replace(/:/g, '');
  const depth = Math.max(1, Math.ceil(data.depth + 0.4));
  const ppm = Math.max(28, Math.min(60, 560 / depth));
  const top = 34, H = depth * ppm, W = 700;
  const col = { depth: [0, 46], log: [46, 112], desc: [112, 330], spt: [330, 420], graph: [420, 560], samp: [560, 612], rec: [612, 656], rqd: [656, 700] } as const;
  const y = (d: number) => top + d * ppm;
  const kinds = [...new Set(data.strata.map((s) => s.soil))];
  const pid = (soil: string) => `${uid}-${kinds.indexOf(soil)}`;
  const nTop = Math.max(nMax, ...data.spt.map((s) => s.n ?? 0));
  const gx = (n: number) => col.graph[0] + 8 + (Math.min(n, nTop) / nTop) * (col.graph[1] - col.graph[0] - 16);
  const sptPts = data.spt.filter((s) => s.n !== null).sort((a, b) => a.depth - b.depth);
  const wt = data.waterTable && !isNaN(Number(data.waterTable)) ? Number(data.waterTable) : null;
  const headers: [keyof typeof col, string][] = [['depth', 'Depth (m)'], ['log', 'Log'], ['desc', 'Description of strata'], ['spt', 'SPT N'], ['graph', `N value (0–${nTop})`], ['samp', 'Sample'], ['rec', 'CR %'], ['rqd', 'RQD %']];
  return (
    <svg viewBox={`0 0 ${W} ${top + H + 2}`} width="100%" style={{ maxWidth: W, display: 'block', margin: '0 auto', fontFamily: 'inherit' }} role="img" aria-label={`Borehole log ${data.title}`}>
      <defs>{kinds.map((k) => { const st = soilStyle(k); return <Pattern key={k} id={pid(k)} color={st.color} pattern={st.pattern} />; })}</defs>
      {headers.map(([k, label]) => (
        <g key={k}>
          <rect x={col[k][0]} y={0} width={col[k][1] - col[k][0]} height={top} fill="#f3f4f6" stroke="#333" strokeWidth={0.8} />
          <text x={(col[k][0] + col[k][1]) / 2} y={top / 2 + 4} fontSize={9.5} fontWeight={700} textAnchor="middle">{label}</text>
        </g>
      ))}
      {Object.values(col).map(([a, b], i) => <rect key={i} x={a} y={top} width={b - a} height={H} fill="none" stroke="#333" strokeWidth={0.8} />)}
      {Array.from({ length: depth + 1 }, (_, d) => (
        <g key={d}>
          <line x1={col.depth[1] - 6} x2={col.depth[1]} y1={y(d)} y2={y(d)} stroke="#333" />
          <text x={col.depth[1] - 9} y={y(d) + (d === 0 ? 9 : 3)} fontSize={9} textAnchor="end">{d.toFixed(1)}</text>
          <line x1={col.graph[0]} x2={col.graph[1]} y1={y(d)} y2={y(d)} stroke="#eceef1" />
        </g>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => { const xv = gx(f * nTop); return <g key={f}><line x1={xv} x2={xv} y1={top} y2={top + H} stroke="#e1e4e8" /><text x={xv} y={top + H - 3} fontSize={7.5} textAnchor="middle" fill="#6b7280">{Math.round(f * nTop)}</text></g>; })}
      {data.strata.map((s, i) => (
        <g key={i}>
          <rect x={col.log[0]} y={y(s.from)} width={col.log[1] - col.log[0]} height={(s.to - s.from) * ppm} fill={`url(#${pid(s.soil)})`} stroke="#333" strokeWidth={0.8} />
          <line x1={col.desc[0]} x2={col.desc[1]} y1={y(s.to)} y2={y(s.to)} stroke="#333" strokeWidth={0.8} />
          <foreignObject x={col.desc[0] + 4} y={y(s.from) + 2} width={col.desc[1] - col.desc[0] - 8} height={Math.max(14, (s.to - s.from) * ppm - 4)}>
            <div style={{ fontSize: 9, lineHeight: 1.25, display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%' }}>
              <b>{s.soil}</b>{s.desc && <span>{s.desc}</span>}<span style={{ color: '#6b7280' }}>{fmtD(s.from)} – {fmtD(s.to)} m</span>
            </div>
          </foreignObject>
        </g>
      ))}
      {wt !== null && wt <= depth && (
        <g>
          <path d={`M${col.log[1] - 16} ${y(wt) - 7} h12 l-6 7 z`} fill="#2a78d6" />
          <line x1={col.log[0]} x2={col.log[1]} y1={y(wt)} y2={y(wt)} stroke="#2a78d6" strokeDasharray="3 2" />
          <text x={col.log[0] + 2} y={y(wt) - 2} fontSize={7.5} fill="#2a78d6">WT</text>
        </g>
      )}
      {data.spt.map((s, i) => (
        <g key={i}>
          <line x1={col.spt[0]} x2={col.spt[0] + 6} y1={y(s.depth)} y2={y(s.depth)} stroke="#333" />
          <text x={col.spt[0] + 9} y={y(s.depth) - 1} fontSize={7.5} fill="#6b7280">{fmtD(s.depth)} m</text>
          <text x={col.spt[0] + 9} y={y(s.depth) + 9} fontSize={9} fontWeight={700}>{shortN(s.label || '--')}</text>
        </g>
      ))}
      {sptPts.length > 1 && <polyline fill="none" stroke="#1f3a68" strokeWidth={1.6} points={sptPts.map((s) => `${gx(s.n!)},${y(s.depth)}`).join(' ')} />}
      {sptPts.map((s, i) => <circle key={i} cx={gx(s.n!)} cy={y(s.depth)} r={3} fill={(s.n ?? 0) >= nTop ? '#e34948' : '#1f3a68'} />)}
      {data.samples.map((s, i) => (
        <g key={i}>
          {s.type.startsWith('UDS') ? <rect x={col.samp[0] + 18} y={y(s.depth) - 5} width={14} height={10} fill="#1f3a68" /> : <rect x={col.samp[0] + 18} y={y(s.depth) - 5} width={14} height={10} fill="none" stroke="#1f3a68" strokeWidth={1.2} />}
          <text x={col.samp[0] + 25} y={y(s.depth) + 15} fontSize={7} textAnchor="middle">{s.type.split(' ')[0]}</text>
        </g>
      ))}
      {data.core.map((c, i) => (
        <g key={i}>
          <rect x={col.rec[0] + 2} y={y(c.from)} width={col.rec[1] - col.rec[0] - 4} height={(c.to - c.from) * ppm} fill="#f6efe6" stroke="#b98a6a" strokeWidth={0.6} />
          <text x={(col.rec[0] + col.rec[1]) / 2} y={(y(c.from) + y(c.to)) / 2 + 3} fontSize={8.5} textAnchor="middle">{c.rec ?? '--'}</text>
          <rect x={col.rqd[0] + 2} y={y(c.from)} width={col.rqd[1] - col.rqd[0] - 4} height={(c.to - c.from) * ppm} fill="#f6efe6" stroke="#b98a6a" strokeWidth={0.6} />
          <text x={(col.rqd[0] + col.rqd[1]) / 2} y={(y(c.from) + y(c.to)) / 2 + 3} fontSize={8.5} textAnchor="middle">{c.rqd ?? '--'}</text>
        </g>
      ))}
    </svg>
  );
}

/** Soil legend for the log or profile. */
export function SoilLegend({ soils }: { soils: string[] }) {
  const uid = useId().replace(/:/g, '');
  const kinds = [...new Set(soils)];
  if (!kinds.length) return null;
  return (
    <svg viewBox={`0 0 700 ${Math.ceil(kinds.length / 3) * 22 + 4}`} width="100%" style={{ maxWidth: 700, display: 'block', margin: '6px auto 0' }}>
      <defs>{kinds.map((k, i) => { const st = soilStyle(k); return <Pattern key={k} id={`${uid}-${i}`} color={st.color} pattern={st.pattern} />; })}</defs>
      {kinds.map((k, i) => (
        <g key={k} transform={`translate(${(i % 3) * 233}, ${Math.floor(i / 3) * 22 + 2})`}>
          <rect width={30} height={16} fill={`url(#${uid}-${i})`} stroke="#333" strokeWidth={0.7} />
          <text x={36} y={12} fontSize={9.5}>{k}</text>
        </g>
      ))}
      <g transform={`translate(0, ${Math.ceil(kinds.length / 3) * 22})`} />
    </svg>
  );
}

/** Geotechnical profile of the site: boreholes side by side on a common depth scale. */
export function SiteProfile({ logs }: { logs: BoreLogData[] }) {
  const uid = useId().replace(/:/g, '');
  const depth = Math.max(1, Math.ceil(Math.max(...logs.map((l) => l.depth)) + 0.4));
  const ppm = Math.max(26, Math.min(48, 480 / depth));
  const top = 30, H = depth * ppm, colW = 62, gap = Math.max(18, Math.min(60, (620 - logs.length * colW) / Math.max(1, logs.length))), left = 56;
  const W = Math.max(400, left + logs.length * (colW + gap) + 20);
  const kinds = [...new Set(logs.flatMap((l) => l.strata.map((s) => s.soil)))];
  const pid = (soil: string) => `${uid}-${kinds.indexOf(soil)}`;
  const y = (d: number) => top + d * ppm;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${top + H + 18}`} width="100%" style={{ maxWidth: W, display: 'block', margin: '0 auto', fontFamily: 'inherit' }} role="img" aria-label="Geotechnical profile">
        <defs>{kinds.map((k) => { const st = soilStyle(k); return <Pattern key={k} id={pid(k)} color={st.color} pattern={st.pattern} />; })}</defs>
        <text x={left - 30} y={top - 12} fontSize={9.5} fontWeight={700} textAnchor="middle">Depth (m)</text>
        {Array.from({ length: depth + 1 }, (_, d) => (
          <g key={d}>
            <line x1={left - 6} x2={W - 10} y1={y(d)} y2={y(d)} stroke="#eceef1" />
            <text x={left - 10} y={y(d) + 3} fontSize={9} textAnchor="end">{d.toFixed(1)}</text>
          </g>
        ))}
        {logs.map((l, i) => {
          const x = left + i * (colW + gap) + gap / 2;
          return (
            <g key={i}>
              <text x={x + colW / 2} y={top - 12} fontSize={10} fontWeight={700} textAnchor="middle">{l.title || `BH-${i + 1}`}</text>
              {l.strata.map((s, j) => <rect key={j} x={x} y={y(s.from)} width={colW} height={(s.to - s.from) * ppm} fill={`url(#${pid(s.soil)})`} stroke="#333" strokeWidth={0.7} />)}
              {l.spt.filter((s) => s.n !== null).map((s, j) => <text key={j} x={x + colW + 3} y={y(s.depth) + 3} fontSize={7.5}>N={shortN(s.label)}</text>)}
              <text x={x + colW / 2} y={y(l.depth) + 12} fontSize={8} textAnchor="middle" fill="#6b7280">{l.depth.toFixed(1)} m</text>
            </g>
          );
        })}
      </svg>
      <SoilLegend soils={kinds} />
    </div>
  );
}
