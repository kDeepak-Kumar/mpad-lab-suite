import crypto from 'node:crypto';
import { startAlertScheduler } from './alerts';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from './db';
import { core } from './routes/core';
import { lab } from './routes/lab';
import { finance } from './routes/finance';
import { seedIfEmpty } from './seed';
import { analytics } from './analytics';
import { ensurePlatform } from './meta';
import { syncTemplatePack } from './packs';
import { crm, publicApi } from './routes/crm';
import { onboarding } from './routes/onboarding';
import { share } from './routes/share';
import { purchasing } from './routes/purchasing';
import { startArchiveScheduler } from './archive';
import { recycle, startRecyclePurge } from './recycle';
import { assistant } from './assistant';
import { quick } from './routes/quick';
import { account } from './routes/account';
import { gst } from './routes/gst';
import { files } from './routes/files';
import compression from 'compression';

const app = express();
app.disable('x-powered-by');
app.use(compression());
// behind Caddy/nginx/cPanel proxy: use the real client IP (sign-in alerts, rate limit)
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
app.use(express.json({ limit: '15mb' }));
app.use(cookieParser());
// Build fingerprint: changes with every deployed version, so open browser tabs can tell a new version is live.
let VERSION = 'dev';
app.use('/api', (_req, res, next) => { res.setHeader('X-App-Version', VERSION); res.setHeader('Cache-Control', 'no-store'); next(); });
app.get('/api/health', (_req, res) => res.json({ ok: true, version: VERSION, time: new Date().toISOString() }));
// Screen crashes reported by the browser (ErrorBoundary) – written to the server log for diagnosis.
app.post('/api/client-error', express.json({ limit: '20kb' }), (req, res) => {
  const b = req.body ?? {};
  console.error(`[client-error] ${String(b.url ?? '').slice(0, 200)} :: ${String(b.message ?? '').slice(0, 300)}\n${String(b.stack ?? '').slice(0, 3000)}`);
  res.json({ ok: true });
});
app.use('/api', publicApi, account, onboarding, share, purchasing, gst, recycle, assistant, quick, core, lab, finance, analytics, crm, files);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built web app (single deployment for cPanel / any Node host)
const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [process.env.WEB_DIST, path.resolve(here, 'web'), path.resolve(here, '../../web/dist'), path.resolve(here, '../web'), path.resolve(process.cwd(), 'web/dist'), path.resolve(process.cwd(), 'web')].filter(Boolean) as string[];
const webDir = candidates.find((d) => fs.existsSync(path.join(d, 'index.html')));
if (webDir) {
  app.use('/assets', express.static(path.join(webDir, 'assets'), { maxAge: '365d', immutable: true }));
  VERSION = crypto.createHash('sha1').update(fs.readFileSync(path.join(webDir, 'index.html'))).digest('hex').slice(0, 10);
  app.use(express.static(webDir, { index: false, maxAge: '1h', setHeaders: (res, f) => { if (f.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
  // index.html is never cached, so a refresh always loads the newest version
  app.get('*', (_req, res) => { res.setHeader('Cache-Control', 'no-cache, must-revalidate'); res.sendFile(path.join(webDir, 'index.html')); });
}

const port = Number(process.env.PORT || 4000);
migrate()
  .then(() => seedIfEmpty())
  .then(() => ensurePlatform())
  .then(() => syncTemplatePack())
  .then(() => { if (process.env.ALERTS !== 'off') startAlertScheduler(); startArchiveScheduler(); startRecyclePurge(); })
  .then(() => app.listen(port, () => console.log(`Suite running on http://localhost:${port}${webDir ? '' : ' (API only; web not built)'}`)))
  .catch((e) => { console.error('Startup failed', e); process.exit(1); });
