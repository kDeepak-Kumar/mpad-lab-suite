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
import { files } from './routes/files';
import compression from 'compression';

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '15mb' }));
app.use(cookieParser());
app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api', publicApi, core, lab, finance, analytics, crm, files);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built web app (single deployment for cPanel / any Node host)
const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [process.env.WEB_DIST, path.resolve(here, 'web'), path.resolve(here, '../../web/dist'), path.resolve(here, '../web'), path.resolve(process.cwd(), 'web/dist'), path.resolve(process.cwd(), 'web')].filter(Boolean) as string[];
const webDir = candidates.find((d) => fs.existsSync(path.join(d, 'index.html')));
if (webDir) {
  app.use('/assets', express.static(path.join(webDir, 'assets'), { maxAge: '365d', immutable: true }));
  app.use(express.static(webDir, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
}

const port = Number(process.env.PORT || 4000);
migrate()
  .then(() => seedIfEmpty())
  .then(() => ensurePlatform())
  .then(() => syncTemplatePack())
  .then(() => { if (process.env.ALERTS !== 'off') startAlertScheduler(); })
  .then(() => app.listen(port, () => console.log(`Suite running on http://localhost:${port}${webDir ? '' : ' (API only; web not built)'}`)))
  .catch((e) => { console.error('Startup failed', e); process.exit(1); });
