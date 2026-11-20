/**
 * Word (.docx) export built from the rendered page, element by element, so Word lays it out natively:
 * - the letterhead and footer go into Word's own header and footer (on every page, never stretched);
 * - tables become Word tables with the same column widths, merged cells, rules, shading and padding,
 *   rows sized by their text and the column headings repeated on a new page;
 * - side-by-side boxes (sign-off, title row…) become borderless tables, so the signature, seal and QR keep their
 *   place and size;
 * - images keep the size they have on screen, in millimetres.
 * The text stays editable. Pictures that only exist on screen (QR code, charts, generated letterheads) are copied as images.
 */
import { toPng } from 'html-to-image';
import { measureDoc, planPages } from './paginate';
import {
  AlignmentType, BorderStyle, Document, Footer, Header, ImageRun, Packer, PageNumber, Paragraph, ShadingType, Table, TableCell,
  TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType, type IBorderOptions, type ParagraphChild,
} from 'docx';

type Block = Paragraph | Table;
const A4_MM = { w: 210, h: 297 };
const DXA_PER_MM = 56.6929;

interface Ctx { mmPerPx: number; font: string; /** same slight reduction the PDF uses to keep a just-too-long report on its pages */ fit: number; center?: boolean; /** keep with the next paragraph / row (headings) */ keep?: boolean }

const visible = (n: Element) => {
  if (!(n instanceof HTMLElement || n instanceof SVGElement)) return false;
  if (n.closest('.no-print, .doc-watermark, .doc-watermark-hide')) return false;
  const cs = getComputedStyle(n);
  return cs.display !== 'none' && cs.visibility !== 'hidden';
};
const hex = (c: string): string | undefined => {
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/.exec(c);
  if (!m || (m[4] !== undefined && Number(m[4]) < 0.05)) return undefined;
  return [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('').toUpperCase();
};
const px = (v: string) => parseFloat(v) || 0;
const dxa = (ctx: Ctx, p: number) => Math.max(0, Math.round(p * ctx.mmPerPx * DXA_PER_MM));
/** CSS px → points (for font sizes and border widths). */
const pt = (ctx: Ctx, p: number) => (p * ctx.fit * ctx.mmPerPx * 72) / 25.4;
/** spacing and padding (scaled with the text); widths use dxa() */
const sp = (ctx: Ctx, p: number) => dxa(ctx, p * ctx.fit);
/** docx image sizes are pixels at 96 dpi. */
const imgPx = (ctx: Ctx, p: number) => Math.max(1, Math.round((p * ctx.fit * ctx.mmPerPx * 96) / 25.4));

const blockish = new Set(['block', 'flex', 'grid', 'table', 'list-item', 'flow-root', 'inline-flex', 'inline-grid', 'inline-block']);
const isBlock = (n: Element) => n.tagName === 'TABLE' || n.tagName === 'BR' ? n.tagName === 'TABLE' : blockish.has(getComputedStyle(n).display) || ['IMG', 'SVG', 'CANVAS'].includes(n.tagName.toUpperCase()) && getComputedStyle(n).display === 'block';
const isRow = (n: Element) => {
  const cs = getComputedStyle(n);
  if (!(cs.display === 'flex' || cs.display === 'inline-flex' || cs.display === 'grid')) return false;
  if (cs.display.includes('flex') && cs.flexDirection.startsWith('column')) return false;
  const kids = [...n.children].filter(visible);
  if (kids.length < 2) return false;
  if (cs.display === 'grid') { const tops = kids.map((k) => Math.round(k.getBoundingClientRect().top)); return new Set(tops).size === 1; }
  return true;
};

async function raster(el: Element, ctx: Ctx): Promise<ImageRun | null> {
  const p = await pixels(el, ctx);
  return p ? new ImageRun({ type: 'png', data: p.data, transformation: { width: p.width, height: p.height } }) : null;
}
/** The element as a PNG at its on-page size (docx sizes: pixels at 96 dpi). */
async function pixels(el: Element, ctx: Ctx): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  const ratio = Math.min(4, Math.max(2, 900 / r.width));
  try {
    let url: string;
    if (el instanceof HTMLImageElement && el.complete && el.naturalWidth) {
      const c = document.createElement('canvas');
      const s = Math.min(1, 2400 / el.naturalWidth);
      c.width = Math.round(el.naturalWidth * s); c.height = Math.round(el.naturalHeight * s);
      c.getContext('2d')!.drawImage(el, 0, 0, c.width, c.height);
      url = c.toDataURL('image/png');
    } else if (el instanceof HTMLCanvasElement) url = el.toDataURL('image/png');
    else if (el instanceof SVGSVGElement) {
      // draw the SVG itself at its on-page size (a QR code must stay square and sharp)
      const clone = el.cloneNode(true) as SVGSVGElement;
      if (!el.getAttribute('viewBox')) {
        // no viewBox (e.g. the QR code): use the drawing's own size so it scales into the box instead of being cut
        const w0 = Number(el.getAttribute('width')) || 0, h0 = Number(el.getAttribute('height')) || 0;
        const bb = w0 && h0 ? { x: 0, y: 0, width: w0, height: h0 } : el.getBBox();
        clone.setAttribute('viewBox', `${bb.x} ${bb.y} ${bb.width} ${bb.height}`);
      }
      clone.setAttribute('width', String(r.width)); clone.setAttribute('height', String(r.height));
      if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const im = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone)); });
      const c = document.createElement('canvas'); const k = 4;
      c.width = Math.round(r.width * k); c.height = Math.round(r.height * k);
      const g = c.getContext('2d')!; g.imageSmoothingEnabled = false; g.drawImage(im, 0, 0, c.width, c.height);
      url = c.toDataURL('image/png');
    }
    else url = await toPng(el as HTMLElement, { pixelRatio: ratio, backgroundColor: undefined, filter: (n) => !(n instanceof HTMLElement && n.classList.contains('no-print')) });
    const data = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (ch) => ch.charCodeAt(0));
    return { data, width: imgPx(ctx, r.width), height: imgPx(ctx, r.height) };
  } catch (e) { console.warn('[docx] image skipped', e); return null; }
}

function runStyle(el: Element, ctx: Ctx) {
  const cs = getComputedStyle(el);
  const sup = cs.verticalAlign === 'super' || el.closest('sup') !== null;
  const sub = cs.verticalAlign === 'sub' || el.closest('sub') !== null;
  return {
    bold: Number(cs.fontWeight) >= 600 || cs.fontWeight === 'bold',
    italics: cs.fontStyle === 'italic',
    underline: cs.textDecorationLine.includes('underline') ? {} : undefined,
    strike: cs.textDecorationLine.includes('line-through'),
    color: hex(cs.color),
    size: Math.max(8, Math.round(pt(ctx, px(cs.fontSize) / (sup || sub ? 0.75 : 1)) * 2)),
    font: (cs.fontFamily.split(',')[0] || ctx.font).replace(/["']/g, '').trim(),
    superScript: sup, subScript: sub,
    upper: cs.textTransform === 'uppercase',
  };
}

/** Inline content of an element → runs (text, line breaks, inline images). */
async function runs(el: Element, ctx: Ctx, out: ParagraphChild[] = []): Promise<ParagraphChild[]> {
  for (const n of el.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) {
      const raw = (n.textContent ?? '').replace(/\s+/g, ' ');
      if (!raw.trim() && !raw) continue;
      const st = runStyle(el, ctx);
      const { upper, ...o } = st;
      out.push(new TextRun({ ...o, text: upper ? raw.toUpperCase() : raw }));
    } else if (n instanceof Element) {
      if (!visible(n)) continue;
      const tag = n.tagName.toUpperCase();
      if (tag === 'BR') { out.push(new TextRun({ text: '', break: 1 })); continue; }
      if (tag === 'IMG' || tag === 'SVG' || tag === 'CANVAS') { const im = await raster(n, ctx); if (im) out.push(im); continue; }
      await runs(n, ctx, out);
    }
  }
  return out;
}

const alignIn = (ctx: Ctx, v: string) => (ctx.center && (v === 'start' || v === 'left') ? AlignmentType.CENTER : align(v));
const align = (v: string) => (v === 'center' ? AlignmentType.CENTER : v === 'right' || v === 'end' ? AlignmentType.RIGHT : v === 'justify' ? AlignmentType.JUSTIFIED : AlignmentType.LEFT);
const border = (ctx: Ctx, w: string, s: string, c: string): IBorderOptions => {
  const width = px(w);
  if (!width || s === 'none' || s === 'hidden') return { style: BorderStyle.NONE, size: 0, color: 'auto' };
  return { style: s === 'dashed' ? BorderStyle.DASHED : s === 'dotted' ? BorderStyle.DOTTED : BorderStyle.SINGLE, size: Math.max(2, Math.round(pt(ctx, width) * 8)), color: hex(c) ?? '000000' };
};

async function paragraph(el: Element, ctx: Ctx, children?: ParagraphChild[]): Promise<Paragraph> {
  const cs = getComputedStyle(el);
  const kids = children ?? await runs(el, ctx);
  // a table cell's own padding and borders belong to the Word cell, not to its paragraph
  const cell = el.tagName === 'TD' || el.tagName === 'TH';
  if (cell) {
    const fs0 = px(cs.fontSize), lh0 = cs.lineHeight === 'normal' ? fs0 * 1.2 : px(cs.lineHeight);
    return new Paragraph({ keepNext: !!ctx.keep, children: kids.length ? kids : [new TextRun({ text: '', size: Math.round(pt(ctx, fs0) * 2) })], alignment: alignIn(ctx, cs.textAlign), spacing: { before: 0, after: 0, line: Math.max(200, Math.round((lh0 / Math.max(fs0, 1) / 1.15) * 240)) } });
  }
  const bt = border(ctx, cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor);
  const bb = border(ctx, cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor);
  const fs = px(cs.fontSize), lh = cs.lineHeight === 'normal' ? fs * 1.2 : px(cs.lineHeight);
  return new Paragraph({
    children: kids.length ? kids : [new TextRun({ text: '', size: Math.round(pt(ctx, fs) * 2) })],
    alignment: alignIn(ctx, cs.textAlign),
    spacing: { before: sp(ctx, px(cs.marginTop) + px(cs.paddingTop)), after: sp(ctx, px(cs.marginBottom) + px(cs.paddingBottom)), line: Math.max(200, Math.round((lh / Math.max(fs, 1) / 1.15) * 240)) },
    indent: px(cs.paddingLeft) + px(cs.marginLeft) > 0.5 ? { left: dxa(ctx, px(cs.paddingLeft) + px(cs.marginLeft)) } : undefined,
    border: { ...(bt.size ? { top: { ...bt, space: 2 } } : {}), ...(bb.size ? { bottom: { ...bb, space: 2 } } : {}) },
    keepNext: !!ctx.keep || /^H\d$/.test(el.tagName),
  });
}

/** Column edges of a rendered table, from where its cells actually start and end. */
function grid(cells: HTMLTableCellElement[]) {
  const xs = new Set<number>();
  for (const c of cells) { const r = c.getBoundingClientRect(); xs.add(Math.round(r.left)); xs.add(Math.round(r.right)); }
  const edges = [...xs].sort((a, b) => a - b).reduce<number[]>((a, x) => (a.length && x - a[a.length - 1] < 2 ? a : [...a, x]), []);
  const idx = (x: number) => edges.reduce((best, e, i) => (Math.abs(e - x) < Math.abs(edges[best] - x) ? i : best), 0);
  return { edges, idx };
}

async function table(t: HTMLTableElement, ctx: Ctx): Promise<Table | null> {
  const trs = [...t.rows].filter(visible);
  const cells = trs.flatMap((r) => [...r.cells].filter(visible));
  if (!cells.length) return null;
  const { edges, idx } = grid(cells);
  const widths = edges.slice(1).map((e, i) => dxa(ctx, e - edges[i]));
  const rows: TableRow[] = [];
  for (const tr of trs) {
    const out: TableCell[] = [];
    // a band across the whole table (section heading such as GRADATION ANALYSIS) stays with the rows under it
    const vc = [...tr.cells].filter(visible);
    const band = vc.length === 1 && edges.length > 2 && idx(Math.round(vc[0].getBoundingClientRect().right)) - idx(Math.round(vc[0].getBoundingClientRect().left)) === edges.length - 1;
    const isHead = tr.parentElement?.tagName === 'THEAD';
    const rctx = band || isHead ? { ...ctx, keep: true } : ctx;
    for (const c of [...tr.cells].filter(visible)) {
      const r = c.getBoundingClientRect(), cs = getComputedStyle(c);
      const a = idx(Math.round(r.left)), b = idx(Math.round(r.right));
      const span = Math.max(1, b - a);
      const bg = hex(cs.backgroundColor);
      out.push(new TableCell({
        children: await contents(c, rctx),
        columnSpan: span > 1 ? span : undefined,
        rowSpan: c.rowSpan > 1 ? c.rowSpan : undefined,
        width: { size: widths.slice(a, a + span).reduce((s, w) => s + w, 0), type: WidthType.DXA },
        verticalAlign: cs.verticalAlign === 'top' ? VerticalAlign.TOP : cs.verticalAlign === 'bottom' ? VerticalAlign.BOTTOM : VerticalAlign.CENTER,
        margins: { top: sp(ctx, px(cs.paddingTop)), bottom: sp(ctx, px(cs.paddingBottom)), left: dxa(ctx, px(cs.paddingLeft)), right: dxa(ctx, px(cs.paddingRight)), marginUnitType: WidthType.DXA },
        borders: {
          top: border(ctx, cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor), bottom: border(ctx, cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor),
          left: border(ctx, cs.borderLeftWidth, cs.borderLeftStyle, cs.borderLeftColor), right: border(ctx, cs.borderRightWidth, cs.borderRightStyle, cs.borderRightColor),
        },
        shading: bg && bg !== 'FFFFFF' ? { fill: bg, type: ShadingType.CLEAR, color: 'auto' } : undefined,
      }));
    }
    if (out.length) rows.push(new TableRow({ children: out, cantSplit: true, tableHeader: tr.parentElement?.tagName === 'THEAD' }));
  }
  const tb = t.getBoundingClientRect(), host = t.parentElement?.getBoundingClientRect();
  const indent = host ? tb.left - host.left : 0;
  return new Table({
    rows, columnWidths: widths, layout: TableLayoutType.FIXED,
    width: { size: widths.reduce((s, w) => s + w, 0), type: WidthType.DXA },
    indent: indent > 2 ? { size: dxa(ctx, indent), type: WidthType.DXA } : undefined,
    borders: { top: { style: BorderStyle.NONE, size: 0, color: 'auto' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' }, left: { style: BorderStyle.NONE, size: 0, color: 'auto' }, right: { style: BorderStyle.NONE, size: 0, color: 'auto' }, insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' }, insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' } },
  });
}

/** Boxes side by side (flex / grid row) → one borderless table row, each box in a cell of its rendered width. */
async function sideBySide(el: Element, ctx: Ctx): Promise<Block[]> {
  const cs = getComputedStyle(el);
  const kids = [...el.children].filter(visible);
  const er = el.getBoundingClientRect();
  const rects = kids.map((k) => k.getBoundingClientRect());
  // columns run from each box's left edge to the next box's left edge (gaps belong to the box before)
  const edges = [er.left, ...rects.slice(1).map((r) => r.left), er.right];
  const widths = edges.slice(1).map((e, i) => Math.max(dxa(ctx, 4), dxa(ctx, e - edges[i])));
  const va = cs.alignItems === 'flex-end' || cs.alignItems === 'end' ? VerticalAlign.BOTTOM : cs.alignItems === 'center' ? VerticalAlign.CENTER : VerticalAlign.TOP;
  const none = { style: BorderStyle.NONE, size: 0, color: 'auto' };
  const cellsOut: TableCell[] = [];
  for (const [i, k] of kids.entries()) {
    const kcs = getComputedStyle(k);
    // a box that centres its content (seal, QR) keeps it centred in Word
    const centred = kcs.textAlign === 'center' || kcs.placeItems?.includes('center') || kcs.justifyItems === 'center' || kcs.alignItems === 'center' && kcs.display.includes('grid');
    const body = await contents(k, ctx, !!centred);
    cellsOut.push(new TableCell({ children: body, width: { size: widths[i], type: WidthType.DXA }, verticalAlign: va, margins: { top: sp(ctx, px(cs.paddingTop)), bottom: 0, left: 0, right: 0, marginUnitType: WidthType.DXA }, borders: { top: none, bottom: none, left: none, right: none } }));
  }
  const bt = border(ctx, cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor);
  const bb = border(ctx, cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor);
  const tbl = new Table({
    rows: [new TableRow({ children: cellsOut, cantSplit: true })], columnWidths: widths, layout: TableLayoutType.FIXED,
    width: { size: widths.reduce((s, w) => s + w, 0), type: WidthType.DXA },
    borders: { top: bt, bottom: bb, left: none, right: none, insideHorizontal: none, insideVertical: none },
  });
  const out: Block[] = [];
  const gap = px(cs.marginTop);
  if (gap > 2) out.push(new Paragraph({ children: [], spacing: { before: 0, after: 0, line: Math.max(20, sp(ctx, gap)), lineRule: 'exact' } }));
  out.push(tbl);
  // space between the rule and the boxes (padding-top) goes into the cells' first paragraph via the box margins already
  return out;
}

/** An element → Word paragraphs and tables. */
async function blocks(el: Element, ctx: Ctx): Promise<Block[]> {
  if (!visible(el)) return [];
  const tag = el.tagName.toUpperCase();
  if (tag === 'TABLE') { const t = await table(el as HTMLTableElement, ctx); return t ? [t] : []; }
  if (tag === 'IMG' || tag === 'SVG' || tag === 'CANVAS') {
    const im = await raster(el, ctx);
    const cs = getComputedStyle(el.parentElement ?? el);
    const mid = cs.textAlign === 'center' || ((cs.display.includes('grid') && /center/.test(cs.justifyItems + cs.placeItems)) || (cs.display.includes('flex') && cs.justifyContent === 'center'));
    return im ? [new Paragraph({ children: [im], alignment: mid ? AlignmentType.CENTER : alignIn(ctx, cs.textAlign) })] : [];
  }
  if (isRow(el)) return sideBySide(el, ctx);
  const kids = [...el.childNodes];
  const hasBlockKid = kids.some((n) => n instanceof Element && visible(n) && isBlock(n));
  if (!hasBlockKid) {
    const r = await runs(el, ctx);
    const r0 = el.getBoundingClientRect();
    if (!r.length && r0.height < 3) return [];
    return [await paragraph(el, ctx, r)];
  }
  // mixed: runs of inline content between block children become their own paragraphs
  const out: Block[] = [];
  let inline: Node[] = [];
  const flush = async () => {
    if (!inline.some((n) => (n.textContent ?? '').trim() || (n instanceof Element && n.querySelector('img,svg,canvas')))) { inline = []; return; }
    const rr: ParagraphChild[] = [];
    for (const n of inline) {
      if (n.nodeType === Node.TEXT_NODE) { const { upper, ...o } = runStyle(el, ctx); const t = (n.textContent ?? '').replace(/\s+/g, ' '); rr.push(new TextRun({ ...o, text: upper ? t.toUpperCase() : t })); }
      else if (n instanceof Element && visible(n)) { if (n.tagName === 'BR') rr.push(new TextRun({ text: '', break: 1 })); else if (['IMG', 'SVG', 'CANVAS'].includes(n.tagName.toUpperCase())) { const im = await raster(n, ctx); if (im) rr.push(im); } else await runs(n, ctx, rr); }
    }
    out.push(new Paragraph({ children: rr, alignment: alignIn(ctx, getComputedStyle(el).textAlign) }));
    inline = [];
  };
  for (const n of kids) {
    if (n instanceof Element && visible(n) && isBlock(n)) { await flush(); out.push(...await blocks(n, ctx)); }
    else inline.push(n);
  }
  await flush();
  // the element's own top rule / spacing (e.g. ruled headings) on its first paragraph
  return out;
}

/** Cell / box contents: at least one paragraph (Word needs one), optional alignment for centred boxes. */
async function contents(el: Element, ctx: Ctx, centred = false): Promise<Block[]> {
  const b = await blocks(el, centred ? { ...ctx, center: true } : ctx);
  return b.length ? b : [new Paragraph({ children: [] })];
}

export async function makeDocx(root: HTMLElement): Promise<Blob> {
  const page = (root.querySelector('.doc-page') as HTMLElement) ?? root;
  const zoomEl = page.closest('.doc-zoom') as HTMLElement | null;
  const prevZoom = zoomEl?.style.zoom ?? '';
  if (zoomEl) zoomEl.style.zoom = '1';
  page.classList.add('exporting');
  try {
    await document.fonts?.ready;
    const pr = page.getBoundingClientRect();
    const pcs = getComputedStyle(page);
    const plan = planPages(measureDoc(page));
    const ctx: Ctx = { mmPerPx: A4_MM.w / pr.width, font: (pcs.fontFamily.split(',')[0] || 'Arial').replace(/["']/g, '').trim(), fit: Math.min(1, plan.scale) * 0.94 };
    const ctxFull: Ctx = { ...ctx, fit: 1 }; // letterhead and footer at full size
    const mm = (p: number) => p * ctx.mmPerPx;
    const top = mm(px(pcs.paddingTop)), bottom = mm(px(pcs.paddingBottom)), left = mm(px(pcs.paddingLeft)), right = mm(px(pcs.paddingRight));
    const all = [...page.querySelectorAll<HTMLElement>(':scope > [data-block]')].filter(visible);
    const head = all.find((b) => b.dataset.block === 'letterhead');
    const foot = all.find((b) => b.dataset.block === 'footer');
    const body = all.filter((b) => b !== head && b !== foot);

    // header and footer: copied as they look (letterheads are often a picture), at the full text width
    const headerKids: Paragraph[] = [];
    let headMm = 0;
    if (head) {
      const im = await raster(head, ctxFull);
      if (im) { headerKids.push(new Paragraph({ children: [im] })); headMm = mm(head.getBoundingClientRect().height); }
    }
    const ident = page.dataset.ident ?? '';
    const pageNo = new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 40, after: 40 }, children: [new TextRun({ size: 15, color: '57534E', font: ctx.font, children: [ident ? `${ident}  ·  Page ` : 'Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES] })] });
    const footerKids: Paragraph[] = [pageNo];
    let footMm = 5;
    if (foot) {
      const im = await raster(foot, ctxFull);
      if (im) { footerKids.push(new Paragraph({ children: [im] })); footMm += mm(foot.getBoundingClientRect().height); }
    }

    const children: Block[] = [];
    for (const b of body) {
      const bcs = getComputedStyle(b);
      const keep = b.dataset.block === 'title' || b.dataset.block === 'tableTitle';
      // a block positioned freely (seal stamped on the page) goes in at its size, right-aligned, where it sits
      if (bcs.position === 'absolute' || bcs.position === 'fixed') {
        const imgEl = b.querySelector('img');
        const im = imgEl ? await raster(imgEl, ctx) : null;
        if (im) children.push(new Paragraph({ children: [im], alignment: AlignmentType.RIGHT }));
        continue;
      }
      children.push(...await blocks(b, keep ? { ...ctx, keep: true } : ctx));
    }
    if (!children.length) children.push(new Paragraph({ children: [] }));

    // a seal placed freely on the page: floating, at the same place on the page, over the text (as stamped)
    for (const s of [...page.querySelectorAll<HTMLImageElement>(':scope > img')].filter((i) => visible(i) && getComputedStyle(i).position === 'absolute')) {
      const r = s.getBoundingClientRect();
      const px0 = await pixels(s, ctxFull);
      if (!px0) continue;
      const fl = new ImageRun({
        type: 'png', data: px0.data, transformation: { width: px0.width, height: px0.height },
        floating: {
          horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: Math.round(mm(r.left - pr.left) * 36000) },
          verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: Math.round(mm(r.top - pr.top) * 36000) },
          wrap: { type: TextWrappingType.NONE }, allowOverlap: true, zIndex: 5,
        },
      });
      // anchored in the body's first paragraph so it lands on page 1, exactly where it was placed
      children.unshift(new Paragraph({ children: [fl], spacing: { before: 0, after: 0, line: 20, lineRule: 'exact' } }));
    }

    const twip = (m: number) => Math.round(m * DXA_PER_MM);
    const doc = new Document({
      creator: 'MPAD QC Lab Suite',
      styles: { default: { document: { run: { font: ctx.font, size: Math.round(pt(ctx, px(pcs.fontSize)) * 2) }, paragraph: { spacing: { before: 0, after: 0 } } } } },
      sections: [{
        properties: {
          page: {
            size: { width: twip(A4_MM.w), height: twip(A4_MM.h) },
            margin: { top: twip(top + headMm + 1.5), bottom: twip(bottom + footMm + 1.5), left: twip(left), right: twip(right), header: twip(top), footer: twip(bottom) },
          },
        },
        headers: headerKids.length ? { default: new Header({ children: headerKids }) } : undefined,
        footers: { default: new Footer({ children: footerKids }) },
        children,
      }],
    });
    return await Packer.toBlob(doc);
  } finally {
    page.classList.remove('exporting');
    if (zoomEl) zoomEl.style.zoom = prevZoom;
  }
}

export async function downloadDocx(root: HTMLElement, filename: string) {
  const blob = await makeDocx(root);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.replace(/\.docx?$/i, '') + '.docx';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
