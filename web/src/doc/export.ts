import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { measureDoc, planPages, type DocLayout } from './paginate';
export { measureDocTrueSize } from './paginate';

const pageEl = (root: HTMLElement) => (root.querySelector('.doc-page') as HTMLElement) ?? root;
/** 300 dpi across an A4 page: 210 mm = 8.27 in → 2480 px. */
const PRINT_WIDTH_PX = 2480;
const A4 = { w: 210, h: 297 };

/** The page captured in horizontal bands (browsers refuse very tall pictures; iPhones limit picture area too). */
const BAND_CSS_PX = 1900; // × 3.12 ≈ 5,900 px tall × 2,480 px wide ≈ 14.6 MP per band
interface Snapshot { layout: DocLayout; scale: number; band: (i: number) => Promise<HTMLImageElement> }

async function snapshot(root: HTMLElement): Promise<{ snap: Snapshot; restore: () => void }> {
  const el = pageEl(root);
  const zoomEl = el.closest('.doc-zoom') as HTMLElement | null;
  const prevZoom = zoomEl?.style.zoom ?? '';
  if (zoomEl) zoomEl.style.zoom = '1';
  el.classList.add('exporting');
  const restore = () => { el.classList.remove('exporting'); if (zoomEl) zoomEl.style.zoom = prevZoom; };
  try {
    await document.fonts?.ready;
    await Promise.all([...el.querySelectorAll('img')].map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
    const layout = measureDoc(el);
    const scale = PRINT_WIDTH_PX / layout.width; // HD: 300 dpi on A4
    const cache = new Map<number, Promise<HTMLImageElement>>();
    const filter = (n: Node) => !(n instanceof HTMLElement && (n.classList.contains('no-print') || n.classList.contains('doc-watermark-hide')));
    const band = (i: number) => {
      if (!cache.has(i)) {
        const top = i * BAND_CSS_PX, h = Math.min(BAND_CSS_PX, layout.height - top);
        cache.set(i, toPng(el, { pixelRatio: scale, backgroundColor: '#ffffff', width: layout.width, height: h, filter,
          style: { transform: `translateY(-${top}px)`, transformOrigin: 'top left', margin: '0', boxShadow: 'none' } }).then(load)
          .then((img) => { console.info(`[export] band ${i} ${img.width}x${img.height} expected ${Math.round(layout.width * scale)}x${Math.round(h * scale)}`); return img; }));
      }
      return cache.get(i)!;
    };
    return { snap: { layout, scale, band }, restore };
  } catch (e) { restore(); throw e; }
}
const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

/** Copy the page region [y0, y1) (CSS px) to the canvas at destination y (canvas px), scaled to width dw. */
async function drawRegion(g: CanvasRenderingContext2D, s: Snapshot, y0: number, y1: number, dx: number, dy: number, dw: number) {
  const k = dw / s.layout.width; // canvas px per CSS px for this draw
  for (let i = Math.floor(y0 / BAND_CSS_PX); i * BAND_CSS_PX < y1; i++) {
    const bTop = i * BAND_CSS_PX, a = Math.max(y0, bTop), b = Math.min(y1, bTop + BAND_CSS_PX);
    if (b <= a) continue;
    const img = await s.band(i);
    const sx = img.width / s.layout.width; // actual picture px per CSS px (never assume)
    g.drawImage(img, 0, (a - bTop) * sx, img.width, (b - a) * sx, dx, dy + (a - y0) * k, dw, (b - a) * k);
  }
}

/**
 * The document as A4 page images at 300 dpi. A long document is split at row / block boundaries, and the
 * letterhead (header) and footer are repeated on every page, with "Page x of y".
 */
export async function pageImages(root: HTMLElement): Promise<HTMLCanvasElement[]> {
  const { snap, restore } = await snapshot(root);
  try {
    const L = snap.layout, plan = planPages(L), k = snap.scale;
    const W = Math.round(L.width * k), H = Math.round(plan.pageH * k);
    const many = plan.slices.length > 1;
    const ident = pageEl(root).dataset.ident ?? '';
    const out: HTMLCanvasElement[] = [];
    for (const [i, [a, b]] of plan.slices.entries()) {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.imageSmoothingQuality = 'high';
      if (plan.headH) await drawRegion(g, snap, 0, plan.headH, 0, 0, W);
      let y = plan.headH * k;
      const rh = plan.repeatHead[i]; // table continued from the previous page: repeat its column headings
      if (rh) { await drawRegion(g, snap, rh[0], rh[1], 0, y, W); y += (rh[1] - rh[0]) * k; }
      // body: full size, or very slightly reduced (centred) so that a just-too-long report stays on one page
      const sw = W * plan.scale;
      await drawRegion(g, snap, a, b, (W - sw) / 2, y, sw);
      if (plan.footH) await drawRegion(g, snap, L.footerTop, L.height, 0, H - plan.footH * k, W);
      // every page after the first carries the report identification and page number (ISO/IEC 17025 cl. 7.8.2.1)
      if (many) { g.fillStyle = '#444'; g.font = `${Math.round(9 * k)}px "Times New Roman", serif`; g.textAlign = 'right'; g.fillText(`${ident ? `${ident}  ·  ` : ''}Page ${i + 1} of ${plan.slices.length}`, W - L.width * 0.06 * k, H - (plan.footH + 5) * k); }
      out.push(c);
    }
    return out;
  } finally { restore(); }
}

/** A4 PDF at 300 dpi (download, email, WhatsApp, print). */
export async function makePdf(root: HTMLElement): Promise<jsPDF> {
  const pages = await pageImages(root);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pages.forEach((c, i) => {
    if (i > 0) pdf.addPage();
    pdf.addImage(c.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, A4.w, A4.h, undefined, 'FAST');
  });
  return pdf;
}

/** Print exactly what the PDF contains: A4 pages, letterhead on every page. Falls back to the browser's print. */
export async function printDocument(root?: HTMLElement) {
  if (!root) { window.print(); return; }
  try {
    const blob = (await makePdf(root)).output('blob');
    const url = URL.createObjectURL(blob);
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    f.src = url;
    document.body.appendChild(f);
    await new Promise((r) => { f.onload = r; setTimeout(r, 4000); });
    try { f.contentWindow?.focus(); f.contentWindow?.print(); }
    catch { window.open(url, '_blank'); } // some mobile browsers cannot print an embedded PDF
    setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 120000);
  } catch { window.print(); }
}

/** PNG at 300 dpi; a multi-page document downloads one image per page. */
export async function downloadPng(root: HTMLElement, filename: string) {
  const pages = await pageImages(root);
  const base = filename.replace(/\.png$/i, '');
  pages.forEach((c, i) => { const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = pages.length > 1 ? `${base} - page ${i + 1}.png` : `${base}.png`; a.click(); });
}

export async function downloadPdf(root: HTMLElement, filename: string) {
  (await makePdf(root)).save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}

export async function pdfBase64(root: HTMLElement) {
  const s = (await makePdf(root)).output('datauristring');
  return s.slice(s.indexOf(',') + 1);
}

/** Word-compatible export on an A4 page: letterhead images sized in millimetres so Word keeps them full width. */
export function downloadDoc(root: HTMLElement, filename: string) {
  const src = pageEl(root);
  const el = src.cloneNode(true) as HTMLElement;
  el.querySelectorAll('.no-print, .doc-watermark').forEach((n) => n.remove());
  el.style.cssText = 'font-family:' + (src.style.fontFamily || 'Times New Roman') + ';font-size:' + (src.style.fontSize || '11pt');
  el.querySelectorAll<HTMLImageElement>('img.doc-lh-img').forEach((i) => { i.setAttribute('width', '718'); i.style.cssText = 'width:190mm;display:block;margin:0 0 3mm'; });
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">
<style>@page WordSection1{size:210mm 297mm;margin:10mm 10mm 10mm 10mm}div.WordSection1{page:WordSection1}table{border-collapse:collapse;width:100%} .bx td,.bx th{border:1px solid #333;padding:3px 6px}</style></head>
<body><div class="WordSection1">${el.outerHTML}</div></body></html>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿', html], { type: 'application/msword' }));
  a.download = filename.endsWith('.doc') ? filename : `${filename}.doc`; a.click();
}
