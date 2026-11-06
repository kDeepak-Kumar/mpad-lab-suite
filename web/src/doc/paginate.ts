/**
 * Page planning for documents (shared by the on-screen preview and every export).
 * Rules: one A4 page whenever the content fits – shrinking it slightly (down to 88 %) if it only just overflows;
 * otherwise split into pages of similar fill at row / block boundaries; the signature never starts a page,
 * a title never ends a page, and the letterhead and footer are repeated on every page.
 */
export interface DocLayout { width: number; height: number; headerBottom: number; footerTop: number; contentEnd: number; breaks: number[]; tables: { top: number; headTop: number; headBottom: number; bottom: number }[] }
/** repeatHead: [top, bottom] of a table heading to repeat at the top of that page (table continued from the previous page). */
export interface PagePlan { pageH: number; headH: number; footH: number; scale: number; slices: [number, number][]; repeatHead: ([number, number] | null)[] }

export const A4_RATIO = 297 / 210;
export const MIN_FIT_SCALE = 0.88;
const PAGE_NO_PX = 16; // room for "Page x of y"

/** Measure a rendered .doc-page (works under CSS zoom). Values are CSS px from the top of the page. */
export function measureDoc(el: HTMLElement): DocLayout {
  const r0 = el.getBoundingClientRect();
  const z = r0.height / (el.offsetHeight || 1) || 1;
  const y = (n: Element, edge: 'top' | 'bottom') => (n.getBoundingClientRect()[edge] - r0.top) / z;
  const blocks = [...el.querySelectorAll<HTMLElement>(':scope > [data-block]')];
  const head = blocks.find((b) => b.dataset.block === 'letterhead');
  const foot = blocks.find((b) => b.dataset.block === 'footer');
  const height = el.offsetHeight;
  const headerBottom = head ? Math.ceil(y(head, 'bottom')) : 0;
  const footerTop = foot ? Math.floor(y(foot, 'top')) : height;
  const body = blocks.filter((b) => b !== head && b !== foot);
  const contentEnd = body.length ? Math.ceil(Math.max(...body.map((b) => y(b, 'bottom')))) + 2 : headerBottom;
  // candidate break points: bottoms of blocks, table rows, list items and paragraphs (+2 px keeps borders)
  const cand = new Set<number>();
  // any block-level element's bottom is a candidate (rows, paragraphs, sections, charts…); unsafe ones are removed below
  el.querySelectorAll('[data-block], tr, li, p, .doc-line, div, table, svg, canvas, img, h1, h2, h3, h4').forEach((n) => { if (n.closest('.no-print')) return; const b = Math.ceil(y(n, 'bottom')) + 2; if (b > headerBottom + 20 && b < contentEnd) cand.add(b); });
  // forbidden: inside or right before the signature; inside charts / images; right after a title
  const banned: [number, number][] = [];
  for (const b of body) {
    const t = y(b, 'top'), bt = y(b, 'bottom'), type = b.dataset.block;
    if (type === 'signature' || type === 'bankSignature') banned.push([t - 8, bt + 1]);

    if (type === 'title' || type === 'text') banned.push([bt - 1, bt + 8]);
  }
  // never through a chart, picture or table row
  el.querySelectorAll('svg, img, canvas').forEach((c) => { if (!c.closest('[data-block="letterhead"], [data-block="footer"]')) banned.push([y(c, 'top') + 3, y(c, 'bottom') + 1]); });
  // (a break sits 2 px below an element's bottom, so protected ranges start 3 px below an element's top)
  el.querySelectorAll('tr').forEach((r) => banned.push([y(r, 'top') + 3, y(r, 'bottom') + 1]));
  // keep a chart / figure caption with its picture: no break right after a caption-like line
  el.querySelectorAll('svg, canvas').forEach((c) => {
    const t = y(c, 'top');
    let n: Element | null = c; // the caption is the short element just before the chart (or before its wrapper)
    while (n && !n.previousElementSibling && n.parentElement && n.parentElement !== el) n = n.parentElement;
    const cap = n?.previousElementSibling;
    const capTop = cap && y(cap, 'bottom') - y(cap, 'top') < 60 ? y(cap, 'top') : t;
    banned.push([capTop + 3, t + 1]);
  });
  el.querySelectorAll('thead').forEach((th) => banned.push([y(th, 'top') - 2, y(th, 'bottom') + 26])); // keep a table header with its first row
  // never cut through merged cells (e.g. one "Test method" cell spanning several rows)
  const maxKeep = el.offsetWidth * A4_RATIO * 0.33; // a very tall merged group may still be split
  el.querySelectorAll('td[rowspan], th[rowspan]').forEach((c) => { const t = y(c, 'top'), b = y(c, 'bottom'); if (Number(c.getAttribute('rowspan')) > 1 && b - t < maxKeep) banned.push([t + 3, b - 1]); });
  const tables = [...el.querySelectorAll('table')].filter((t) => t.tHead && !t.closest('.no-print')).map((t) => ({ top: y(t, 'top'), headTop: y(t.tHead!, 'top'), headBottom: Math.ceil(y(t.tHead!, 'bottom')) + 1, bottom: y(t, 'bottom') }));
  const breaks = [...cand].filter((b) => !banned.some(([a, z2]) => b > a && b < z2)).sort((a, b) => a - b);
  return { width: el.offsetWidth, height, headerBottom, footerTop, contentEnd: Math.max(contentEnd, headerBottom), breaks, tables };
}

/** Measure at true size (preview zoom can wrap text differently from the export). Synchronous, so nothing flickers. */
export function measureDocTrueSize(el: HTMLElement): DocLayout {
  const z = el.closest('.doc-zoom') as HTMLElement | null;
  const prev = z?.style.zoom ?? '';
  if (z) z.style.zoom = '1';
  try { return measureDoc(el); } finally { if (z) z.style.zoom = prev; }
}

export function planPages(L: DocLayout): PagePlan {
  const pageH = L.width * A4_RATIO;
  const headH = L.headerBottom, footH = Math.max(0, L.height - L.footerTop);
  const top = L.headerBottom, end = L.contentEnd, total = end - top;
  const one = pageH - headH - footH; // a single page needs no page number
  if (total <= one + 1) return { pageH, headH, footH, scale: 1, slices: [[top, end]], repeatHead: [null] };
  if (total * MIN_FIT_SCALE <= one) return { pageH, headH, footH, scale: Math.floor((one / total) * 1000) / 1000, slices: [[top, end]], repeatHead: [null] };

  const base = Math.max(pageH * 0.3, pageH - headH - footH - PAGE_NO_PX);
  // a page that starts inside a table repeats that table's heading, which takes room
  const headAt = (y: number) => { const t = (L.tables ?? []).find((x) => y > x.headBottom + 2 && y < x.bottom - 2); return t ? ([t.headTop, t.headBottom] as [number, number]) : null; };
  const avail = (from: number) => { const h = headAt(from); return base - (h ? h[1] - h[0] : 0); };
  const greedy = (from: number) => { const lim = from + avail(from); if (lim >= end) return end; const ok = L.breaks.filter((b) => b > from + 30 && b <= lim); return ok.length ? ok[ok.length - 1] : lim; };
  const count = (from: number) => { let m = 0; for (let s = from; s < end - 1; s = greedy(s)) m++; return m; };
  const n = count(top);
  // balance: aim each break at an equal share of the content, never past what fits, keeping the rest placeable
  const slices: [number, number][] = [];
  let start = top;
  for (let k = 1; k < n && start < end - 1; k++) {
    const target = start + (end - start) / (n - k + 1);
    const ok = L.breaks.filter((b) => b > start + 30 && b <= start + avail(start));
    const good = ok.filter((b) => count(b) <= n - k);
    const pick = (good.length ? good : ok).reduce<number | null>((best, b) => (best === null || Math.abs(b - target) < Math.abs(best - target) ? b : best), null) ?? greedy(start);
    slices.push([start, pick]); start = pick;
  }
  while (start < end - 1) { const e = greedy(start); slices.push([start, e]); start = e; }
  return { pageH, headH, footH, scale: 1, slices, repeatHead: slices.map(([a], i) => (i === 0 ? null : headAt(a))) };
}
