// Copies the free, open-source OCR engine (tesseract.js, Apache-2.0) and English language data into public/ocr,
// so scanned reports are read in the browser from our own server – no third-party service, no per-page cost.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const out = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'ocr');
fs.mkdirSync(out, { recursive: true });
const pkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`));
const files = [
  [path.join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'), 'worker.min.js'],
  [path.join(pkgDir('tesseract.js-core'), 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [path.join(pkgDir('tesseract.js-core'), 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [path.join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz'],
];
for (const [src, name] of files) {
  const dst = path.join(out, name);
  if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst);
}
console.log('OCR files ready in public/ocr');
