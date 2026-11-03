import { notifications } from '@mantine/notifications';

/**
 * Keeps open tabs on the latest deployed version:
 * - a refresh always loads the newest app (index.html is never cached);
 * - if a tab was open during an update and tries to load a screen that no longer exists, it reloads itself once;
 * - open tabs notice a new version (checked every 2 minutes and when the tab is focused) and offer a one-click refresh.
 */
let current: string | null = null;
let shown = false;

function offerRefresh() {
  if (shown) return;
  shown = true;
  notifications.show({
    id: 'new-version', color: 'brand', autoClose: false, withCloseButton: true, title: 'A new version is available',
    message: 'Click here to refresh and get the latest changes (anything you have saved is kept).',
    onClick: () => window.location.reload(), style: { cursor: 'pointer' },
  });
}

async function check() {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    const { version } = await r.json();
    if (!version || version === 'dev') return;
    if (current === null) current = version;
    else if (version !== current) offerRefresh();
  } catch { /* offline – try later */ }
}

export function watchVersion() {
  // Vite raises this when a lazily-loaded screen's file was replaced by a newer deploy
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault();
    let last = 0; try { last = Number(sessionStorage.getItem('reloaded-for-version') ?? 0); } catch { /* ignore */ }
    if (Date.now() - last > 30000) { try { sessionStorage.setItem('reloaded-for-version', String(Date.now())); } catch { /* ignore */ } window.location.reload(); }
    else offerRefresh();
  });
  check();
  setInterval(check, 2 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}
