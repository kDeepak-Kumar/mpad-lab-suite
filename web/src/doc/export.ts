import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';

const pageEl = (root: HTMLElement) => (root.querySelector('.doc-page') as HTMLElement) ?? root;

async function snapshot(root: HTMLElement) {
  const el = pageEl(root);
  const zoomEl = el.closest('.doc-zoom') as HTMLElement | null;
  const prevZoom = zoomEl?.style.zoom ?? '';
  if (zoomEl) zoomEl.style.zoom = '1';
  el.classList.add('exporting');
  try {
    return await toPng(el, { pixelRatio: 2, backgroundColor: '#ffffff', filter: (n) => !(n instanceof HTMLElement && (n.classList.contains('no-print') || n.classList.contains('doc-watermark-hide'))) });
  } finally { el.classList.remove('exporting'); if (zoomEl) zoomEl.style.zoom = prevZoom; }
}

/** Print / Save as PDF via the browser: exact vector output. */
export function printDocument() { window.print(); }

export async function downloadPng(root: HTMLElement, filename: string) {
  const url = await snapshot(root);
  const a = document.createElement('a'); a.href = url; a.download = filename.endsWith('.png') ? filename : `${filename}.png`; a.click();
}

/** Image-based A4 PDF (used for email attachments). Splits tall documents across pages. */
export async function makePdf(root: HTMLElement): Promise<jsPDF> {
  const url = await snapshot(root);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = 210, H = 297;
  const pageHpx = (img.width * H) / W;
  const pages = Math.max(1, Math.ceil(img.height / pageHpx - 0.02));
  for (let i = 0; i < pages; i++) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = Math.min(pageHpx, img.height - i * pageHpx);
    const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, i * pageHpx, img.width, c.height, 0, 0, img.width, c.height);
    if (i > 0) pdf.addPage();
    pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, (c.height * W) / img.width);
  }
  return pdf;
}

export async function downloadPdf(root: HTMLElement, filename: string) {
  (await makePdf(root)).save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}

export async function pdfBase64(root: HTMLElement) {
  const s = (await makePdf(root)).output('datauristring');
  return s.slice(s.indexOf(',') + 1);
}

/** Word-compatible export: the rendered page as HTML that Word opens and edits. */
export function downloadDoc(root: HTMLElement, filename: string) {
  const el = pageEl(root).cloneNode(true) as HTMLElement;
  el.querySelectorAll('.no-print, .doc-watermark').forEach((n) => n.remove());
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style>table{border-collapse:collapse;width:100%} .bx td,.bx th{border:1px solid #333;padding:3px 6px}</style></head><body>${el.outerHTML}</body></html>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿', html], { type: 'application/msword' }));
  a.download = filename.endsWith('.doc') ? filename : `${filename}.doc`; a.click();
}
