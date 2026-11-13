import { type ComponentType } from 'react';
import { Link as RLink, useLocation, useNavigate } from 'react-router-dom';
import { ActionIcon, Popover, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { IconChevronDown, IconStar, IconX, IconUsers, IconFileText, IconLayoutList, IconFile, IconClipboardCheck } from '@tabler/icons-react';
import { useFavs, type Fav } from '../favorites';
import { useDragReorder, moveItem } from './useDragReorder';

type Icon = ComponentType<{ size?: number | string; stroke?: number | string }>;
/** A page of a menu entry, shown as tabs above the page (e.g. Test reports → All reports · Prepare report · Quick report). */
export type NavSub = { label: string; to: string; tab: string };
/** One entry of the left menu. `sub` pages share the entry; `count` shows work waiting (the accent marks the user's own). */
export type NavItem = { label: string; to: string; tab: string; icon: Icon; section?: string; sub?: NavSub[]; count?: number; mine?: boolean; foot?: boolean };

/** The menu entry (and its sub-page) a path belongs to: the longest matching address wins, so /reports/prepare is not /reports. */
export function matchNav(items: NavItem[], path: string): { item: NavItem; sub?: NavSub } | null {
  let best: { item: NavItem; sub?: NavSub; len: number } | null = null;
  const hit = (to: string) => (to === '/' ? path === '/' : path === to || path.startsWith(to + '/'));
  for (const item of items) for (const t of item.sub?.length ? item.sub.map((sub) => ({ to: sub.to, sub })) : [{ to: item.to, sub: undefined }]) {
    if (hit(t.to) && (!best || t.to.length > best.len)) best = { item, sub: t.sub, len: t.to.length };
  }
  return best;
}

const KIND_ICON: Record<string, Icon> = { client: IconUsers, document: IconFileText, listview: IconLayoutList, workorder: IconClipboardCheck, page: IconFile };

export function SideNav({ items, mini, part = 'main' }: { items: NavItem[]; mini: boolean; part?: 'main' | 'foot' }) {
  const loc = useLocation();
  const nav = useNavigate();
  const favs = useFavs();
  const [open, setOpen] = useLocalStorage<Record<string, boolean>>({ key: 'nav-groups-v3', defaultValue: {} });
  const current = matchNav(items, loc.pathname)?.item;
  const main = items.filter((n) => !n.foot);
  const top = main.filter((n) => !n.section);
  const groups = [...new Set(main.filter((n) => n.section).map((n) => n.section!))];
  const foot = items.filter((n) => n.foot);
  const favList = favs?.list ?? [];
  const dnd = useDragReorder('fav', (from, to) => favs?.reorder(moveItem(favList, from, to).map((f) => f.id)));
  const iconFor = (f: { kind: string; ref: string }) => items.find((n) => n.to === f.ref.split('?')[0] || n.sub?.some((s) => s.to === f.ref.split('?')[0]))?.icon ?? KIND_ICON[f.kind] ?? IconFile;

  const link = (n: NavItem) => {
    const active = current === n;
    return (
      <Tooltip key={n.to} label={n.count ? `${n.label} · ${n.count} waiting` : n.label} position="right" disabled={!mini}>
        <RLink to={n.to} className={`sn-link${active ? ' active' : ''}${mini ? ' mini' : ''}`} aria-current={active ? 'page' : undefined} aria-label={mini ? n.label : undefined}>
          <span className="sn-ic"><n.icon size={mini ? 18 : 17} stroke={1.75} /></span>
          {!mini && <span className="sn-label">{n.label}</span>}
          {!mini && n.count ? <span className={`sn-cnt${n.mine ? ' acc' : ''}`}>{n.count > 99 ? '99+' : n.count}</span> : null}
          {mini && n.count && n.mine ? <span className="sn-dot" /> : null}
        </RLink>
      </Tooltip>
    );
  };
  const favRow = (f: Fav, i: number) => {
    const Ic = iconFor(f);
    const active = false; // the menu entry below already marks where you are
    return (
      <div key={f.id} {...dnd.rowProps(i)} className={`sn-fav ${dnd.rowProps(i).className ?? ''}`}>
        <RLink to={f.ref} className={`sn-link${active ? ' active' : ''}`} title={f.sub ? `${f.label} · ${f.sub}` : f.label}>
          <span className="sn-ic" {...dnd.handleProps(i)} style={{ ...dnd.handleProps(i).style, cursor: 'grab' }}><Ic size={17} stroke={1.75} /></span>
          <span className="sn-label">{f.label}{f.sub && <span className="sn-sub">{f.sub}</span>}</span>
        </RLink>
        <ActionIcon size="xs" variant="subtle" color="gray" className="sn-x" aria-label={`Remove ${f.label} from favourites`} onClick={() => favs?.remove(f.id)}><IconX size={12} /></ActionIcon>
      </div>
    );
  };
  const head = (key: string, label: string) => {
    const shown = open[key] !== false;
    return (
      <UnstyledButton className="sn-head" onClick={() => setOpen({ ...open, [key]: !shown })} aria-expanded={shown}>
        <span className="sn-head-label">{label}</span>
        <IconChevronDown size={13} className="sn-chev" style={{ transform: shown ? 'none' : 'rotate(-90deg)' }} />
      </UnstyledButton>
    );
  };

  if (part === 'foot') return foot.length ? <div className={`sn${mini ? ' mini' : ''}`} style={{ paddingBottom: 8 }}>{foot.map(link)}</div> : null;
  if (mini) return (
    <div className="sn mini">
      {top.map(link)}
      {favList.length > 0 && (
        <Popover position="right-start" width={260}>
          <Popover.Target><Tooltip label="Favourites" position="right"><UnstyledButton className="sn-link mini" aria-label="Favourites"><span className="sn-ic"><IconStar size={18} stroke={1.75} /></span></UnstyledButton></Tooltip></Popover.Target>
          <Popover.Dropdown p={6}>
            <Text size="xs" fw={600} c="dimmed" px={8} py={4} tt="uppercase" style={{ letterSpacing: '.07em' }}>Favourites</Text>
            {favList.map((f) => { const Ic = iconFor(f); return <UnstyledButton key={f.id} className="sn-link" style={{ color: 'var(--ink-2)' }} onClick={() => nav(f.ref)}><span className="sn-ic"><Ic size={17} /></span><span className="sn-label">{f.label}</span></UnstyledButton>; })}
          </Popover.Dropdown>
        </Popover>
      )}
      {groups.map((g) => <div key={g} style={{ display: 'contents' }}><div className="sn-sep" />{main.filter((n) => n.section === g).map(link)}</div>)}
    </div>
  );

  return (
    <div className="sn">
      {top.map(link)}
      {favList.length > 0 && <>
        {head('Favourites', 'Favourites')}
        {open.Favourites !== false && favList.map(favRow)}
      </>}
      {groups.map((g) => {
        const list = main.filter((n) => n.section === g);
        const shown = open[g] !== false || list.includes(current!);
        return <div key={g} style={{ display: 'contents' }}>{head(g, g)}{shown && list.map(link)}</div>;
      })}
    </div>
  );
}
