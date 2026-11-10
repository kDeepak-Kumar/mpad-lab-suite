import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { measureDocTrueSize, planPages, type PagePlan } from './paginate';

/**
 * Preview helper: shows how the document will print (same plan as PDF / print / email) –
 * "1 page", "1 page – content at 95 %", or "2 pages" with a marker where each new page starts.
 */
export function PagePlanOverlay({ rootRef, onPages }: { rootRef: RefObject<HTMLElement>; onPages?: (n: number) => void }) {
  const [page, setPage] = useState<HTMLElement | null>(null);
  const [plan, setPlan] = useState<PagePlan | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined; let obs: ResizeObserver | null = null; let watched: HTMLElement | null = null;
    let measuring = false;
    const run = () => {
      const el = rootRef.current?.querySelector('.doc-page') as HTMLElement | null;
      if (!el) return;
      if (el !== watched) { obs?.disconnect(); obs = new ResizeObserver(() => { if (measuring) return; clearTimeout(timer); timer = setTimeout(run, 300); }); obs.observe(el); watched = el; }
      try {
        measuring = true; setTimeout(() => { measuring = false; }, 50);
        const L = measureDocTrueSize(el); const pl = planPages(L); setPlan(pl); setPage(el); onPages?.(pl.slices.length);
        const sig = el.querySelector(':scope > [data-block="signature"]') as HTMLElement | null;
        (window as any).__docPlan = { plan: pl, layout: L, signatureTop: sig ? sig.offsetTop : null, at: Date.now() }; // read by scripts/page-check.mjs
      } catch { /* ignore */ }
    };
    const t0 = setTimeout(run, 400);
    const iv = setInterval(run, 2500); // images / fonts finishing late
    return () => { clearTimeout(t0); clearTimeout(timer); clearInterval(iv); obs?.disconnect(); };
  }, [rootRef]);
  if (!page || !plan) return null;
  const n = plan.slices.length;
  const label = n === 1 ? (plan.scale < 1 ? `Prints on 1 page (content at ${Math.round(plan.scale * 100)} %)` : 'Prints on 1 page') : `Prints on ${n} pages`;
  return createPortal(
    <>
      <div className="no-print doc-pages-badge" data-pages={n}>{label}</div>
      {plan.slices.slice(1).map(([a], i) => (
        <div key={i} className="no-print doc-page-break" style={{ top: a }}><span>Page {i + 2} starts here</span></div>
      ))}
    </>,
    page,
  );
}
