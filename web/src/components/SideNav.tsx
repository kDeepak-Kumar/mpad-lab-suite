import { type ComponentType } from 'react';
import { Link as RLink, useLocation, useNavigate } from 'react-router-dom';
import { ActionIcon, Popover, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { IconBriefcase, IconChevronRight, IconCoinRupee, IconFlask, IconSettings, IconStarFilled, IconStar, IconClockHour4, IconX, IconUsers, IconFileText, IconLayoutList, IconFile, IconClipboardCheck } from '@tabler/icons-react';
import { useFavs, useRecent, type Fav } from '../favorites';
import { useDragReorder, moveItem } from './useDragReorder';

export type NavItem = { label: string; to: string; tab: string; icon: ComponentType<{ size?: number | string; stroke?: number | string }>; section?: string };
/** Accent per section: icon tint of the active item and the section marker. */
export const SECTION_COLOR: Record<string, string> = { 'Sales & CRM': '#9b8afb', Laboratory: '#2ed3b7', Accounts: '#fdb022', Administration: '#98a2b3' };

export const SECTION_ICON: Record<string, ComponentType<{ size?: number | string; color?: string }>> = { 'Sales & CRM': IconBriefcase, Laboratory: IconFlask, Accounts: IconCoinRupee, Administration: IconSettings };
const KIND_ICON: Record<string, ComponentType<{ size?: number | string }>> = { client: IconUsers, document: IconFileText, listview: IconLayoutList, workorder: IconClipboardCheck, page: IconFile };

export function SideNav({ items, mini, all }: { items: NavItem[]; mini: boolean; all: NavItem[] }) {
  const loc = useLocation();
  const nav = useNavigate();
  const favs = useFavs();
  const recent = useRecent().filter((r) => r.to !== loc.pathname).slice(0, 5);
  const [open, setOpen] = useLocalStorage<Record<string, boolean>>({ key: 'nav-groups-v2', defaultValue: { Favourites: true, Recent: false, 'Sales & CRM': true, Laboratory: true, Accounts: true, Administration: false } });
  const isActive = (n: NavItem) => (n.to === '/' ? loc.pathname === '/' : loc.pathname === n.to || (loc.pathname.startsWith(n.to + '/') && !all.some((o) => o.to !== n.to && o.to.startsWith(n.to) && loc.pathname.startsWith(o.to))));
  const top = items.filter((n) => !n.section);
  const groups = [...new Set(items.filter((n) => n.section).map((n) => n.section!))];
  const favList = favs?.list ?? [];
  const dnd = useDragReorder('fav', (from, to) => favs?.reorder(moveItem(favList, from, to).map((f) => f.id)));
  const iconFor = (f: { kind: string; ref: string }) => items.find((n) => n.to === f.ref.split('?')[0])?.icon ?? KIND_ICON[f.kind] ?? IconFile;

  const link = (n: NavItem) => {
    const active = isActive(n);
    return (
      <Tooltip key={n.to} label={n.label} position="right" disabled={!mini} withArrow>
        <RLink to={n.to} className={`sn-link${active ? ' active' : ''}${mini ? ' mini' : ''}`} aria-current={active ? 'page' : undefined}>
          <span className="sn-ic"><n.icon size={18} stroke={1.75} /></span>
          {!mini && <span className="sn-label">{n.label}</span>}
        </RLink>
      </Tooltip>
    );
  };
  const head = (key: string, label: string, icon?: React.ReactNode, count?: number) => {
    const shown = open[key] !== false;
    return (
      <UnstyledButton className="sn-head" onClick={() => setOpen({ ...open, [key]: !shown })} aria-expanded={shown}>
        {icon}<span className="sn-head-label">{label}</span>
        {!shown && count ? <span className="sn-count">{count}</span> : null}
        <IconChevronRight size={13} className="sn-chev" style={{ transform: shown ? 'rotate(90deg)' : 'none' }} />
      </UnstyledButton>
    );
  };
  const favRow = (f: Fav, i: number) => {
    const Ic = iconFor(f);
    const active = loc.pathname + loc.search === f.ref || loc.pathname === f.ref;
    return (
      <div key={f.id} {...dnd.rowProps(i)} className={`sn-fav ${dnd.rowProps(i).className ?? ''}`}>
        <RLink to={f.ref} className={`sn-link${active ? ' active' : ''}`} title={f.sub ? `${f.label} · ${f.sub}` : f.label}>
          <span className="sn-ic" {...dnd.handleProps(i)} style={{ ...dnd.handleProps(i).style, cursor: 'grab' }}><Ic size={17} /></span>
          <span className="sn-label">{f.label}{f.sub && <span className="sn-sub">{f.sub}</span>}</span>
        </RLink>
        <ActionIcon size="xs" variant="subtle" color="gray" className="sn-x" aria-label="Remove favourite" onClick={() => favs?.remove(f.id)}><IconX size={12} /></ActionIcon>
      </div>
    );
  };

  if (mini) return (
    <div className="sn mini">
      <Popover position="right-start" shadow="lg" width={260} withArrow>
        <Popover.Target><Tooltip label="Favourites" position="right" withArrow><UnstyledButton className="sn-link mini"><span className="sn-ic"><IconStarFilled size={18} color="#f5b301" /></span></UnstyledButton></Tooltip></Popover.Target>
        <Popover.Dropdown p={6}>
          <Text size="xs" fw={650} c="dimmed" px={8} py={4}>FAVOURITES</Text>
          {favList.length ? favList.map((f) => { const Ic = iconFor(f); return <UnstyledButton key={f.id} className="sn-link" onClick={() => nav(f.ref)}><span className="sn-ic"><Ic size={17} /></span><span className="sn-label">{f.label}</span></UnstyledButton>; })
            : <Text size="xs" c="dimmed" p={8}>Star ☆ any page or record to pin it here.</Text>}
        </Popover.Dropdown>
      </Popover>
      <div className="sn-sep" />
      {top.map(link)}
      {groups.map((g) => <div key={g}><div className="sn-sep" />{items.filter((n) => n.section === g).map(link)}</div>)}
    </div>
  );

  return (
    <div className="sn">
      {head('Favourites', 'Favourites', <IconStarFilled size={12} color="#f5b301" />, favList.length)}
      {open.Favourites !== false && (favList.length ? favList.map(favRow)
        : <div className="sn-empty"><IconStar size={14} /> Star any page, record or list view to pin it here</div>)}
      {recent.length > 0 && <>
        {head('Recent', 'Recently viewed', <IconClockHour4 size={12} />, recent.length)}
        {open.Recent !== false && recent.map((r) => { const Ic = KIND_ICON[r.kind] ?? IconFile; return (
          <RLink key={r.to} to={r.to} className="sn-link" title={r.sub ? `${r.label} · ${r.sub}` : r.label}>
            <span className="sn-ic"><Ic size={16} /></span><span className="sn-label">{r.label}{r.sub && <span className="sn-sub">{r.sub}</span>}</span>
          </RLink>); })}
      </>}
      <div className="sn-sep wide" />
      {top.map(link)}
      {groups.map((g) => {
        const list = items.filter((n) => n.section === g);
        const here = list.some(isActive);
        const shown = here || open[g] !== false;
        return (
          <div key={g} className="sn-group">
            {head(g, g, (() => { const Ic = SECTION_ICON[g]; return Ic ? <span className="sn-head-ic"><Ic size={13} color={SECTION_COLOR[g]} /></span> : <span className="sn-dot" style={{ background: SECTION_COLOR[g] }} />; })(), list.length)}
            {shown && list.map(link)}
          </div>
        );
      })}
    </div>
  );
}
