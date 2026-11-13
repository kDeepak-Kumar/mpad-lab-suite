import { useEffect, useState } from 'react';

/** Company colours: buttons/links (primary), the left menu (sidebar) and highlights (accent). Saved in Company settings. */
export interface BrandTheme { primary: string; sidebar: string; accent: string }

export const BRAND_PRESETS: { key: string; label: string; theme: BrandTheme }[] = [
  { key: 'stone', label: 'Stone & burnt orange (standard)', theme: { primary: '#1c1917', sidebar: '#f3f1ec', accent: '#c2410c' } },
  { key: 'mpad', label: 'Charcoal & gold', theme: { primary: '#1f2a3a', sidebar: '#14171e', accent: '#e9c33b' } },
  { key: 'navy', label: 'Deep blue', theme: { primary: '#2a5bd7', sidebar: '#1b2a6b', accent: '#ffc53d' } },
  { key: 'teal', label: 'Lab teal', theme: { primary: '#0e8577', sidebar: '#0d2e2b', accent: '#5eead4' } },
  { key: 'maroon', label: 'Maroon', theme: { primary: '#9b2c2c', sidebar: '#2a1215', accent: '#f6ad55' } },
];
export const DEFAULT_BRAND = BRAND_PRESETS[0].theme;
/** The colours every company had before the redesign; a company that never chose its own gets the new standard look. */
const LEGACY_DEFAULT: BrandTheme = { primary: '#1f2a3a', sidebar: '#13161d', accent: '#e9c33b' };

const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c: number[]) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
export const luminance = (h: string) => { const [r, g, b] = rgb(h).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const isLight = (h: string) => luminance(h) > 0.4;
export const valid = (t?: Partial<BrandTheme> | null): BrandTheme => {
  const v = {
    primary: t?.primary && HEX.test(t.primary) ? t.primary.toLowerCase() : DEFAULT_BRAND.primary,
    sidebar: t?.sidebar && HEX.test(t.sidebar) ? t.sidebar.toLowerCase() : DEFAULT_BRAND.sidebar,
    accent: t?.accent && HEX.test(t.accent) ? t.accent.toLowerCase() : DEFAULT_BRAND.accent,
  };
  return v.primary === LEGACY_DEFAULT.primary && v.sidebar === LEGACY_DEFAULT.sidebar && v.accent === LEGACY_DEFAULT.accent ? DEFAULT_BRAND : v;
};

/** Ten Mantine shades with the chosen colour at shade 6. */
export function shades(base: string) {
  const light = [0.93, 0.85, 0.7, 0.52, 0.34, 0.16].map((t) => mix(base, '#ffffff', t));
  const dark = [0.14, 0.27, 0.4].map((t) => mix(base, '#000000', t));
  return [...light, base, ...dark] as unknown as [string, string, string, string, string, string, string, string, string, string];
}

const KEY = 'brand-theme';
export function storedBrand(): BrandTheme { try { return valid(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return DEFAULT_BRAND; } }

/** Applies colours everywhere at once (also used for live preview in Settings). */
export function applyBrand(t: Partial<BrandTheme> | null | undefined, persist = true) {
  const v = valid(t);
  const root = document.documentElement.style;
  const lightNav = isLight(v.sidebar);
  // the left menu sits on the app canvas: a light menu colour becomes the canvas itself
  root.setProperty('--sn-bg', v.sidebar);
  root.setProperty('--canvas', lightNav ? v.sidebar : '#f3f1ec');
  root.setProperty('--sn-ink', lightNav ? '#44403c' : 'rgba(255,255,255,.86)');
  root.setProperty('--sn-ink-strong', lightNav ? '#1c1917' : '#ffffff');
  root.setProperty('--sn-muted', lightNav ? '#6b655e' : 'rgba(255,255,255,.58)');
  root.setProperty('--sn-hover', lightNav ? 'rgba(28,25,23,.055)' : 'rgba(255,255,255,.08)');
  root.setProperty('--sn-line', lightNav ? '#e0dbd1' : 'rgba(255,255,255,.12)');
  root.setProperty('--sn-active', lightNav ? v.primary : 'rgba(255,255,255,.16)');
  root.setProperty('--sn-active-ink', lightNav ? (isLight(v.primary) ? '#1c1917' : '#ffffff') : '#ffffff');
  root.setProperty('--sn-card', lightNav ? '#ffffff' : 'rgba(255,255,255,.07)');
  root.setProperty('--sn-acc', v.accent);
  root.setProperty('--sn-acc-ink', isLight(v.accent) ? '#1c1917' : '#ffffff');
  root.setProperty('--accent', v.accent);
  root.setProperty('--accent-on', isLight(v.accent) ? '#1c1917' : '#ffffff');
  root.setProperty('--brand-accent', v.accent);
  document.documentElement.dataset.nav = lightNav ? 'light' : 'dark';
  if (persist) try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent(KEY, { detail: v }));
}

/** Current brand colours; re-renders when they change. */
export function useBrand() {
  const [t, setT] = useState<BrandTheme>(storedBrand);
  useEffect(() => { const on = (e: Event) => setT((e as CustomEvent<BrandTheme>).detail); window.addEventListener(KEY, on); return () => window.removeEventListener(KEY, on); }, []);
  return t;
}

/** Most common strong colours in a logo (for one-click suggestions). */
export async function logoColours(src: string): Promise<string[]> {
  const img = new Image(); img.crossOrigin = 'anonymous'; img.src = src;
  await img.decode();
  const c = document.createElement('canvas'); c.width = 80; c.height = 80;
  const g = c.getContext('2d')!; g.drawImage(img, 0, 0, 80, 80);
  const d = g.getImageData(0, 0, 80, 80).data;
  const count = new Map<string, number>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const q = [d[i], d[i + 1], d[i + 2]].map((v) => Math.min(255, Math.round(v / 24) * 24));
    const sat = Math.max(...q) - Math.min(...q), lum = (q[0] + q[1] + q[2]) / 3;
    if (lum > 235 && sat < 25) continue; // white background
    const k = hex(q); count.set(k, (count.get(k) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const [k] of [...count.entries()].sort((a, b) => b[1] - a[1])) {
    if (out.every((o) => rgb(o).reduce((s, v, i) => s + Math.abs(v - rgb(k)[i]), 0) > 90)) out.push(k);
    if (out.length >= 5) break;
  }
  return out;
}
