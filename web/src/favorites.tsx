import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { IconStar, IconStarFilled } from '@tabler/icons-react';
import { api, ok } from './api';

export interface Fav { id: number; kind: string; ref: string; label: string; sub?: string | null }
interface FavApi { list: Fav[]; isFav: (ref: string) => Fav | undefined; toggle: (f: Omit<Fav, 'id'>) => Promise<void>; remove: (id: number) => Promise<void>; reorder: (ids: number[]) => void }
const Ctx = createContext<FavApi | null>(null);

/** Per-user favourites (pages, records, saved list views), shown at the top of the sidebar. */
export function FavProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Fav[]>([]);
  const load = useCallback(() => api<Fav[]>('/favorites', { quiet: true }).then(setList).catch(() => undefined), []);
  useEffect(() => { load(); }, [load]);
  const isFav = (ref: string) => list.find((f) => f.ref === ref);
  const toggle = async (f: Omit<Fav, 'id'>) => {
    const ex = isFav(f.ref);
    if (ex) { setList((l) => l.filter((x) => x.id !== ex.id)); await api(`/favorites/${ex.id}`, { method: 'DELETE', quiet: true }); ok('Removed from favourites'); }
    else { await api('/favorites', { body: f }); ok('Added to favourites'); }
    load();
  };
  const remove = async (id: number) => { setList((l) => l.filter((x) => x.id !== id)); await api(`/favorites/${id}`, { method: 'DELETE', quiet: true }); };
  const reorder = (ids: number[]) => { setList((l) => ids.map((id) => l.find((x) => x.id === id)!).filter(Boolean)); api('/favorites/order', { method: 'PUT', body: { ids }, quiet: true }).catch(() => undefined); };
  return <Ctx.Provider value={{ list, isFav, toggle, remove, reorder }}>{children}</Ctx.Provider>;
}
export const useFavs = () => useContext(Ctx);

/** Star button: adds/removes the current page or record. */
export function FavStar({ kind, refKey, label, sub }: { kind: string; refKey: string; label: string; sub?: string }) {
  const f = useFavs();
  if (!f) return null;
  const on = Boolean(f.isFav(refKey));
  return (
    <Tooltip label={on ? 'Remove from favourites' : 'Add to favourites'}>
      <ActionIcon variant="subtle" color={on ? 'yellow' : 'gray'} size="lg" aria-label="Favourite" onClick={() => f.toggle({ kind, ref: refKey, label, sub: sub ?? null })}>
        {on ? <IconStarFilled size={19} /> : <IconStar size={19} />}
      </ActionIcon>
    </Tooltip>
  );
}

// ---------- recently viewed records (this browser) ----------
export interface Recent { to: string; label: string; sub?: string; kind: string }
const RKEY = 'recent-records';
export function readRecent(): Recent[] { try { return JSON.parse(localStorage.getItem(RKEY) || '[]'); } catch { return []; } }
export function trackRecent(r: Recent) {
  try {
    const list = [r, ...readRecent().filter((x) => x.to !== r.to)].slice(0, 8);
    localStorage.setItem(RKEY, JSON.stringify(list));
    window.dispatchEvent(new Event('recent-records'));
  } catch { /* storage unavailable */ }
}
export function useRecent() {
  const [list, setList] = useState<Recent[]>(readRecent);
  useEffect(() => { const f = () => setList(readRecent()); window.addEventListener('recent-records', f); return () => window.removeEventListener('recent-records', f); }, []);
  return list;
}
