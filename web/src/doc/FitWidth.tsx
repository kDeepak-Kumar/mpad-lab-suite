import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Scales the A4 page down to fit the available width on screen (printing and exports use full size). */
export function FitWidth({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const el = outer.current; if (!el) return;
    const ro = new ResizeObserver(() => {
      const page = el.querySelector('.doc-page') as HTMLElement | null;
      if (!page) return;
      const avail = el.clientWidth - 8;
      setZoom(Math.min(1, avail / page.offsetWidth));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div ref={outer} style={{ width: '100%' }}><div className="doc-zoom" style={{ zoom }}>{children}</div></div>;
}
