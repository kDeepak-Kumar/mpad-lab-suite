/**
 * Vendor reports and evidence, handled entirely in the browser with free, open-source tools:
 *  - compress: photos are resized/re-encoded; large scanned PDFs are re-rendered page by page (JPEG) – a typical
 *    5–10 MB scan becomes a few hundred KB while staying readable. The smaller of original/compressed is kept.
 *  - read text: digital PDFs → text layer (pdf.js); scans and photos → OCR (tesseract.js, served from our own server).
 *  - match: finds each template parameter in the text and takes the result printed next to it.
 */
import type { ObservationTemplate } from '@suite/shared';

let pdfjsP: Promise<typeof import('pdfjs-dist')> | null = null;
async function pdfjs() {
  if (!pdfjsP) pdfjsP = (async () => {
    const lib = await import('pdfjs-dist');
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    lib.GlobalWorkerOptions.workerSrc = worker;
    return lib;
  })();
  return pdfjsP;
}

const fileToDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(b); });
const loadImage = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const canvasBlob = (c: HTMLCanvasElement, q = 0.72) => new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg', q));

export interface Packed { blob: Blob; name: string; mime: string; before: number; after: number }

/** Compress an upload, keeping text legible. Files under 300 KB are left alone. */
export async function compressFile(file: File, onProgress?: (msg: string) => void): Promise<Packed> {
  const keep = { blob: file as Blob, name: file.name, mime: file.type || 'application/octet-stream', before: file.size, after: file.size };
  if (file.size < 300 * 1024) return keep;
  try {
    if (/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      const img = await loadImage(await fileToDataUrl(file));
      const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      const blob = await canvasBlob(c, 0.75);
      return blob.size < file.size ? { blob, name: file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', mime: 'image/jpeg', before: file.size, after: blob.size } : keep;
    }
    if (file.type === 'application/pdf') {
      const lib = await pdfjs();
      const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const { jsPDF } = await import('jspdf');
      let pdf: InstanceType<typeof jsPDF> | null = null;
      for (let p = 1; p <= doc.numPages; p++) {
        onProgress?.(`Compressing page ${p} of ${doc.numPages}…`);
        const page = await doc.getPage(p);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(2.2, 1650 / base.width) });
        const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: g, viewport: vp }).promise;
        const jpg = await fileToDataUrl(await canvasBlob(c, 0.7));
        const w = base.width, h = base.height, o = w > h ? 'l' : 'p';
        if (!pdf) pdf = new jsPDF({ orientation: o, unit: 'pt', format: [w, h], compress: true }); else pdf.addPage([w, h], o);
        pdf.addImage(jpg, 'JPEG', 0, 0, w, h, undefined, 'FAST');
      }
      const blob = pdf!.output('blob');
      return blob.size < file.size * 0.9 ? { blob, name: file.name, mime: 'application/pdf', before: file.size, after: blob.size } : keep;
    }
  } catch { /* fall back to the original */ }
  return keep;
}
export const blobToBase64 = async (b: Blob) => (await fileToDataUrl(b)).replace(/^data:[^;]+;base64,/, '');

/** Text lines of a PDF or image: the PDF's own text where it has one, OCR otherwise. */
export async function readDocumentText(file: Blob, mime: string, onProgress?: (msg: string) => void): Promise<{ lines: string[]; method: 'text' | 'ocr' }> {
  const canvases: HTMLCanvasElement[] = [];
  if (mime === 'application/pdf') {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const lines: string[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, 15); p++) {
      onProgress?.(`Reading page ${p} of ${doc.numPages}…`);
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      // group text items into lines by their vertical position, then left to right
      const rows = new Map<number, { x: number; s: string }[]>();
      for (const it of tc.items as { str: string; transform: number[] }[]) {
        if (!it.str?.trim()) continue;
        const y = Math.round(it.transform[5] / 3) * 3;
        rows.set(y, [...(rows.get(y) ?? []), { x: it.transform[4], s: it.str }]);
      }
      for (const y of [...rows.keys()].sort((a, b) => b - a)) lines.push(rows.get(y)!.sort((a, b) => a.x - b.x).map((r) => r.s).join('  ').replace(/\s{3,}/g, '  ').trim());
      if (lines.join('').length < 40) { // scanned page – render it for OCR
        const vp = page.getViewport({ scale: 2.2 });
        const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
        canvases.push(c);
      }
    }
    if (lines.join('').replace(/\s/g, '').length > 80) return { lines, method: 'text' };
  } else {
    const img = await loadImage(await fileToDataUrl(file));
    const c = document.createElement('canvas'); const s = Math.min(1, 2600 / Math.max(img.width, img.height));
    c.width = img.width * s; c.height = img.height * s; c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    canvases.push(c);
  }
  onProgress?.('Recognising text (first time loads the OCR engine, ~7 MB)…');
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, { workerPath: '/ocr/worker.min.js', corePath: '/ocr/', langPath: '/ocr/', workerBlobURL: false, gzip: true });
  const lines: string[] = [];
  try {
    for (const [i, c] of canvases.entries()) {
      onProgress?.(`Recognising text on page ${i + 1} of ${canvases.length}…`);
      const r = await worker.recognize(c);
      lines.push(...r.data.text.split('\n').map((l) => l.trim()).filter(Boolean));
    }
  } finally { await worker.terminate(); }
  return { lines, method: 'ocr' };
}

// ---------- matching ----------
const norm = (s: string) => s.toLowerCase().replace(/₂/g, '2').replace(/₃/g, '3').replace(/₄/g, '4').replace(/[^a-z0-9.%/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const SYN: Record<string, string[]> = {
  ph: ['ph', 'ph value', 'hydrogen ion'], tds: ['total dissolved solids', 'tds', 'dissolved solids'], th: ['total hardness', 'hardness'],
  turb: ['turbidity'], colour: ['colour', 'color'], odour: ['odour', 'odor'], ca: ['calcium'], mg: ['magnesium'], ta: ['total alkalinity', 'alkalinity'],
  cl: ['chloride', 'chlorides'], so4: ['sulphate', 'sulfate'], so3: ['sulphate', 'sulfate', 'so3', 'sulphuric anhydride', 'sulfur trioxide'],
  no3: ['nitrate'], f: ['fluoride'], fe: ['iron'], org: ['organic solids', 'organic'], inorg: ['inorganic solids', 'inorganic'], ss: ['suspended matter', 'suspended solids', 'tss'],
  acid: ['acidity', 'naoh'], alk: ['alkalinity', 'h2so4', 'alkalis', 'na2o'], loi: ['loss on ignition', 'loi', 'ignition loss'], ir: ['insoluble residue', 'insoluble'],
  mgo: ['magnesia', 'mgo', 'magnesium oxide'], lsf: ['lime saturation factor', 'lsf'], af: ['alumina to iron', 'alumina iron', 'a/f', 'al2o3/fe2o3'],
};
const NUM = /-?\d+(?:[.,]\d+)?/g;

export interface Match { key: string; label: string; value: string; line: string; score: number; options?: string[]; numeric: boolean }

/** For every input of a direct-entry template, find the line naming it and the first result value on that line. */
export function matchValues(tpl: ObservationTemplate, lines: string[]): Match[] {
  const fields = tpl.headerFields.filter((f) => f.type === 'number' || f.type === 'select');
  const used = new Set<number>();
  const L = lines.map(norm);
  return fields.map((f) => {
    const label = norm(f.label.replace(/\(.*?\)/g, ''));
    const paren = (f.label.match(/\(([^)]+)\)/)?.[1] ?? '');
    const aliases = [...new Set([label, ...(SYN[f.key] ?? []), ...(paren && paren.length <= 8 ? [norm(paren)] : [])].filter((a) => a.length >= 2))];
    let best = -1, bestScore = 0;
    L.forEach((l, i) => {
      if (used.has(i)) return;
      for (const a of aliases) {
        const re = new RegExp(`(^|[^a-z])${a.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^a-z]|$)`);
        if (re.test(l)) { const sc = a.length + (a === label ? 5 : 0); if (sc > bestScore) { bestScore = sc; best = i; } }
      }
    });
    if (best < 0) return { key: f.key, label: f.label, value: '', line: '', score: 0, options: f.type === 'select' ? f.options : undefined, numeric: f.type === 'number' };
    used.add(best);
    const raw = lines[best];
    let value = '';
    if (f.type === 'select') value = (f.options ?? []).find((o) => norm(raw).includes(norm(o))) ?? '';
    else {
      // drop method references and the parameter name, then take the first number left (result comes before the limit on most reports)
      const cleaned = norm(raw).replace(/\bis\s*:?\s*\d+[\w() .:-]*?(part\s*\d+)?\b/g, ' ').replace(/\bpart\s*\d+\b/g, ' ').replace(/\b(sl|s)\s*no\b/g, ' ');
      const after = aliases.reduce((s, a) => { const i = s.indexOf(a); return i >= 0 ? s.slice(i + a.length) : s; }, cleaned);
      // chemical formulae (CaCO3, SO3, Na2O, H2SO4…) and reagent strengths (0.02 N) are not results
      const plain = after.replace(/\b[a-z]{1,4}\d[a-z0-9]*\b/g, ' ').replace(/\b\d*\.?\d+\s*n\b(?=\s*(naoh|h2so4|hcl|$|\s))/g, ' ').replace(/neutrali[sz]e\s*\d+\s*ml/g, ' ');
      const nums = (plain.match(NUM) ?? []).map((n) => n.replace(',', '.'));
      value = nums[0] ?? '';
    }
    return { key: f.key, label: f.label, value, line: raw, score: bestScore, options: f.type === 'select' ? f.options : undefined, numeric: f.type === 'number' };
  });
}

/** Report number and date as printed by the vendor, if found. */
export function findReportMeta(lines: string[]) {
  const all = lines.join('\n');
  const no = all.match(/(?:report|certificate|ulr)\s*(?:no|number|#)\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9/\-_.]{3,40})/i)?.[1] ?? '';
  const d = all.match(/(?:date\s*of\s*(?:issue|report)|issue\s*date|report\s*date|dated?)\s*[:\-]?\s*(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})/i);
  const date = d ? `${d[3].length === 2 ? '20' + d[3] : d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}` : '';
  return { reportNo: no, reportDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '' };
}
