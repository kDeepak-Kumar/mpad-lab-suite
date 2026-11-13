import { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { FavStar } from '../favorites';

export interface Stat { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'bad' | 'ok'; onClick?: () => void }

/**
 * Record page: who/what it is and the next actions on top, the key figures in one strip,
 * the working tabs on the left and a quiet rail with details and recent activity on the right.
 */
export function RecordLayout({ initials, eyebrow, title, meta, actions, stats, side, children, fav }: {
  initials?: string; eyebrow?: ReactNode; title: string; meta?: ReactNode; actions?: ReactNode; stats?: Stat[]; side?: ReactNode; children: ReactNode;
  fav?: { kind: string; sub?: string };
}) {
  const loc = useLocation();
  return (
    <div className="rec">
      <header className="rec-head no-print">
        {initials && <div className="rec-av" aria-hidden="true">{initials}</div>}
        <div className="rec-id">
          {eyebrow && <div className="rec-eyebrow">{eyebrow}</div>}
          <div className="rec-title-row"><h1 className="rec-title" title={title}>{title}</h1>{fav && <FavStar kind={fav.kind} refKey={loc.pathname} label={title} sub={fav.sub} />}</div>
          {meta && <div className="rec-meta">{meta}</div>}
        </div>
        {actions && <div className="rec-actions">{actions}</div>}
      </header>
      {stats && stats.length > 0 && (
        <div className="rec-stats" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
          {stats.map((s, i) => {
            const body = <><div className="rec-stat-l">{s.label}</div><div className={`rec-stat-v${s.tone ? ' ' + s.tone : ''}`}>{s.value}</div>{s.hint && <div className="rec-stat-h">{s.hint}</div>}</>;
            return s.onClick ? <button key={i} type="button" className="rec-stat click" onClick={s.onClick}>{body}</button> : <div key={i} className="rec-stat">{body}</div>;
          })}
        </div>
      )}
      <div className={`rec-grid${side ? ' with-side' : ''}`}>
        <div className="rec-main">{children}</div>
        {side && <aside className="rec-side">{side}</aside>}
      </div>
    </div>
  );
}

/** A titled block in the side rail or in a tab: heading with an optional count and one quiet action. */
export function Block({ title, count, action, children, mt }: { title: ReactNode; count?: number; action?: ReactNode; children: ReactNode; mt?: number }) {
  return (
    <section style={{ marginTop: mt }}>
      <div className="blk-head"><b>{title}</b>{count !== undefined && <span>{count}</span>}{action && <div style={{ marginLeft: 'auto' }}>{action}</div>}</div>
      {children}
    </section>
  );
}
