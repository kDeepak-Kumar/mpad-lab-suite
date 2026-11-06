import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';

const pageEl = (root: HTMLElement) => (root.querySelector('.doc-page') as HTMLElement) ?? root;
/** 300 dpi across an A4 page: 210 mm = 8.27 in → 2480 px. */
const PRINT_WIDTH_PX = 2480;
const A4 = { w: 210, h: 297 };

interface Layout { width: number; height: number; headerBottom: number; footerTop: number; breaks: number[] }

/** Positions (CSS px from the top of the page) used to split long documents into A4 pages at clean points. */
function measure(el: HTMLElement): Layout {
  const top = el.getBoundingClientRect().top;
  const y = (n: Element, edge: 'top' | 'bottom') => n.getBoundingClientRect()[edge] - top;
  const head = el.querySelector('[data-block="letterhead"]'), foot = el.querySelector('[data-block="footer"]');
  const height = el.offsetHeight;
  const headerBottom = head ? Math.ceil(y(head, 'bottom')) : 0;
  const footerTop = foot ? Math.floor(y(foot, 'top')) : height;
  const breaks = new Set<number>();
  // +2 px keeps a table row's bottom border on the page it belongs to
  el.querySelectorAll('[data-block], tr, li, p, .md-p, h1, h2, h3').forEach((n) => { const b = Math.ceil(y(n, 'bottom')) + 2; if (b > headerBottom && b < footerTop) breaks.add(b); });
  return { width: el.offsetWidth, height, headerBottom, footerTop, breaks: [...breaks].sort((a, b) => a - b) };
}

async function snapshot(root: HTMLElement): Promise<{ url: string; layout: Layout; scale: number }> {
  const el = pageEl(root);
  const zoomEl = el.closest('.doc-zoom') as HTMLElement | null;
  const prevZoom = zoomEl?.style.zoom ?? '';
  if (zoomEl) zoomEl.style.zoom = '1';
  el.classList.add('exporting');
  try {
    await document.fonts?.ready;
    await Promise.all([...el.querySelectorAll('img')].map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
    const layout = measure(el);
    const scale = PRINT_WIDTH_PX / layout.width; // HD: 300 dpi on A4
    const url = await toPng(el, { pixelRatio: scale, backgroundColor: '#ffffff', filter: (n) => !(n instanceof HTMLElement && (n.classList.contains('no-print') || n.classList.contains('doc-watermark-hide'))) });
    return { url, layout, scale };
  } finally { el.classList.remove('exporting'); if (zoomEl) zoomEl.style.zoom = prevZoom; }
}
const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

/**
 * The document as A4 page images at 300 dpi. A long document is split at row / block boundaries, and the
 * letterhead (header) and footer are repeated on every page, with "Page x of y".
 */
export async function pageImages(root: HTMLElement): Promise<HTMLCanvasElement[]> {
  const { url, layout: L, scale } = await snapshot(root);
  const img = await load(url);
  const pageH = (L.width * A4.h) / A4.w; // CSS px of one A4 page
  const px = (v: number) => Math.round(v * scale);
  const newPage = () => { const c = document.createElement('canvas'); c.width = px(L.width); c.height = px(pageH); const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = 'high'; return { c, g }; };
  if (L.height <= pageH + 2) { // fits on one page
    const { c, g } = newPage(); g.drawImage(img, 0, 0, img.width, Math.min(img.height, c.height), 0, 0, img.width, Math.min(img.height, c.height)); return [c];
  }
  const headH = L.headerBottom, footH = L.height - L.footerTop;
  const avail = Math.max(pageH * 0.3, pageH - headH - footH - 18); // 18 px for the page number line
  const slices: [number, number][] = [];
  for (let start = L.headerBottom; start < L.footerTop - 1;) {
    const limit = start + avail;
    let end = L.footerTop;
    if (limit < L.footerTop) { const ok = L.breaks.filter((b) => b > start + 40 && b <= limit); end = ok.length ? ok[ok.length - 1] : limit; }
    slices.push([start, end]); start = end;
  }
  return slices.map(([a, b], i) => {
    const { c, g } = newPage();
    if (headH) g.drawImage(img, 0, 0, img.width, px(headH), 0, 0, img.width, px(headH));
    g.drawImage(img, 0, px(a), img.width, px(b - a), 0, px(headH), img.width, px(b - a));
    if (footH) g.drawImage(img, 0, px(L.footerTop), img.width, px(footH), 0, c.height - px(footH), img.width, px(footH));
    g.fillStyle = '#444'; g.font = `${px(9)}px "Times New Roman", serif`; g.textAlign = 'right';
    g.fillText(`Page ${i + 1} of ${slices.length}`, c.width - px(L.width * 0.06), c.height - px(footH) - px(5));
    return c;
  });
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
