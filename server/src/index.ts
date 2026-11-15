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
import { hr } from './routes/hr';
import { chat as chatRoutes } from './routes/chat';
import { account } from './routes/account';
import { gst } from './routes/gst';
import { files } from './routes/files';
import compression from 'compression';

const app = express();
app.disable('x-powered-by');
app.use(compression());
// behind Caddy/nginx/cPanel proxy: use the real client IP (sign-in alerts, rate limit)
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
// Security headers: no framing by other sites, a content policy matching what the app loads, HTTPS pinning in production
const CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:", "font-src 'self' data:",
  "connect-src 'self'", "frame-src 'self' blob: data:", "frame-ancestors 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"].join('; ');
app.use((_req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.COOKIE_SECURE === 'true') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});
// Writes must come from this site's own pages: a browser sends Origin on cross-site requests, so refuse other origins.
const allowedHosts = new Set([process.env.APP_URL, process.env.PUBLIC_URL].filter(Boolean).map((u) => { try { return new URL(String(u)).host; } catch { return ''; } }).filter(Boolean));
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || process.env.ORIGIN_CHECK === 'off') return next();
  const origin = req.get('origin');
  if (!origin) return next();
  let host = '';
  try { host = new URL(origin).host; } catch { /* malformed */ }
  const own = [req.get('x-forwarded-host'), req.get('host')].filter(Boolean).map((h) => String(h).split(',')[0].trim());
  if (host && (own.includes(host) || allowedHosts.has(host))) return next();
  res.status(403).json({ error: 'Request blocked: it did not come from this site' });
});
app.use(express.json({ limit: '15mb' }));
// A body that is too large or not JSON gets a plain message instead of an HTML error page
app.use((err: { type?: string; status?: number }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'The upload is too large. Files must be 10 MB or smaller.' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request could not be read' });
  next(err);
});
app.use(cookieParser());
// Build fingerprint: changes with every deployed version, so open browser tabs can tell a new version is live.
let VERSION = 'dev';
app.use('/api', (_req, res, next) => { res.setHeader('X-App-Version', VERSION); res.setHeader('Cache-Control', 'no-store'); next(); });
app.get('/api/health', (_req, res) => res.json({ ok: true, version: VERSION, time: new Date().toISOString() }));
// Screen crashes reported by the browser (ErrorBoundary) – written to the server log for diagnosis.
const errorHits = new Map<string, { n: number; t: number }>();
app.post('/api/client-error', express.json({ limit: '20kb' }), (req, res) => {
  // at most 20 reports a minute from one address, so the log cannot be flooded
  const ip = req.ip ?? '?'; const nowMs = Date.now(); const hit = errorHits.get(ip);
  if (!hit || nowMs - hit.t > 60_000) errorHits.set(ip, { n: 1, t: nowMs }); else if (++hit.n > 20) return res.status(429).json({ error: 'Too many reports' });
  if (errorHits.size > 5000) for (const [k, v] of errorHits) if (nowMs - v.t > 60_000) errorHits.delete(k);
  const b = req.body ?? {};
  console.error(`[client-error] ${String(b.url ?? '').slice(0, 200)} :: ${String(b.message ?? '').slice(0, 300)}\n${String(b.stack ?? '').slice(0, 3000)}`);
  res.json({ ok: true });
});
app.use('/api', publicApi, account, onboarding, share, purchasing, gst, recycle, assistant, quick, hr, chatRoutes, core, lab, finance, analytics, crm, files);
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
