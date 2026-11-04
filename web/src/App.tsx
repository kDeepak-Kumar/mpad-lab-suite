import { lazy, Suspense, useCallback, useEffect, useState, type ComponentType } from 'react';
import { Navigate, NavLink as RLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ActionIcon, AppShell, Avatar, Burger, Button, Center, Group, Indicator, Loader, Menu, NavLink, ScrollArea, Text, Badge, Tooltip, Kbd, UnstyledButton } from '@mantine/core';
import { useDisclosure, useLocalStorage } from '@mantine/hooks';
import { Spotlight, spotlight, type SpotlightActionData } from '@mantine/spotlight';
import {
  IconLayoutDashboard, IconUsers, IconFileDollar, IconClipboardList, IconFlask, IconFileCertificate, IconReceipt, IconCash,
  IconBook, IconListDetails, IconSettings, IconLogout, IconPlus, IconBox, IconTool, IconTemplate, IconUserCog, IconChecklist,
  IconSearch, IconChartBar, IconAdjustments, IconPhoneCall, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconBell, IconSparkles, IconMenu2, IconChevronRight, IconReceiptTax, IconCheck, IconMailOpened,
} from '@tabler/icons-react';
import { api, useApi } from './api';
import { MeCtx, MetaCtx, hasTab, useMe, type Me, type Meta } from './ctx';
import { Login, SetPasswordPage } from './pages/Login';
import { VerifyPage } from './pages/Verify';
import { Loading } from './components/ui';

// Pages load on demand, so the app opens fast and only fetches what a screen needs.
const page = <K extends string>(loader: () => Promise<Record<K, ComponentType<any>>>, name: K) => lazy(() => loader().then((m) => ({ default: m[name] })));
const SharedDocPage = page(() => import('./pages/SharedDoc'), 'SharedDocPage');
const Dashboard = page(() => import('./pages/Dashboard'), 'Dashboard');
const ClientsPage = page(() => import('./pages/Clients'), 'ClientsPage');
const ClientDetail = page(() => import('./pages/Clients'), 'ClientDetail');
const DocumentsList = page(() => import('./pages/DocumentsList'), 'DocumentsList');
const DocumentPage = page(() => import('./pages/DocumentPage'), 'DocumentPage');
const WorkOrdersPage = page(() => import('./pages/WorkOrders'), 'WorkOrdersPage');
const WorkOrderDetail = page(() => import('./pages/WorkOrders'), 'WorkOrderDetail');
const SamplesPage = page(() => import('./pages/Samples'), 'SamplesPage');
const TestsPage = page(() => import('./pages/Tests'), 'TestsPage');
const TestSheetPage = page(() => import('./pages/Tests'), 'TestSheetPage');
const PrepareReport = page(() => import('./pages/PrepareReport'), 'PrepareReport');
const PaymentsPage = page(() => import('./pages/Payments'), 'PaymentsPage');
const LedgerPage = page(() => import('./pages/Ledger'), 'LedgerPage');
const ClientLedger = page(() => import('./pages/Ledger'), 'ClientLedger');
const RegistersPage = page(() => import('./pages/Registers'), 'RegistersPage');
const AnalyticsPage = page(() => import('./pages/Analytics'), 'AnalyticsPage');
const CompanySettings = page(() => import('./pages/settings/Company'), 'CompanySettings');
const UsersSettings = page(() => import('./pages/settings/Users'), 'UsersSettings');
const CatalogSettings = page(() => import('./pages/settings/Catalog'), 'CatalogSettings');
const EquipmentPage = page(() => import('./pages/settings/Equipment'), 'EquipmentPage');
const TemplatesPage = page(() => import('./pages/settings/Templates'), 'TemplatesPage');
const TemplateDesigner = page(() => import('./pages/settings/Templates'), 'TemplateDesigner');
const ObsTemplateEditor = page(() => import('./pages/settings/ObsTemplateEditor'), 'ObsTemplateEditor');
const SetupPage = page(() => import('./pages/settings/Setup'), 'SetupPage');
const FollowUpsPage = page(() => import('./pages/FollowUps'), 'FollowUpsPage');
const AccountPage = page(() => import('./pages/Account'), 'AccountPage');
const GstPage = page(() => import('./pages/Gst'), 'GstPage');
const Required2fa = page(() => import('./pages/Account'), 'Required2fa');

export { useMe };
export const hasRole = (me: Me, ...roles: string[]) => Boolean(me.role?.admin || me.user.role === 'owner' || roles.includes(me.user.role));

type NavItem = { label: string; to: string; tab: string; icon: ComponentType<{ size?: number | string; stroke?: number | string }>; section?: string };
const NAV: NavItem[] = [
  { label: 'Home', to: '/', tab: 'home', icon: IconLayoutDashboard },
  { label: 'Analytics & AI', to: '/analytics', tab: 'analytics', icon: IconChartBar },
  { label: 'Clients', to: '/clients', tab: 'clients', icon: IconUsers, section: 'Sales' },
  { label: 'Quotations', to: '/quotes', tab: 'quotes', icon: IconFileDollar, section: 'Sales' },
  { label: 'Work orders', to: '/workorders', tab: 'workorders', icon: IconClipboardList, section: 'Sales' },
  { label: 'Follow-ups', to: '/followups', tab: 'followups', icon: IconPhoneCall, section: 'Sales' },
  { label: 'Sample register', to: '/samples', tab: 'samples', icon: IconBox, section: 'Laboratory' },
  { label: 'Tests & observations', to: '/tests', tab: 'tests', icon: IconFlask, section: 'Laboratory' },
  { label: 'Prepare report', to: '/reports/prepare', tab: 'prepare', icon: IconChecklist, section: 'Laboratory' },
  { label: 'Test reports', to: '/reports', tab: 'reports', icon: IconFileCertificate, section: 'Laboratory' },
  { label: 'Equipment', to: '/equipment', tab: 'equipment', icon: IconTool, section: 'Laboratory' },
  { label: 'Invoices', to: '/invoices', tab: 'invoices', icon: IconReceipt, section: 'Accounts' },
  { label: 'Payments', to: '/payments', tab: 'payments', icon: IconCash, section: 'Accounts' },
  { label: 'Ledgers', to: '/ledger', tab: 'ledger', icon: IconBook, section: 'Accounts' },
  { label: 'GST returns', to: '/gst', tab: 'gst', icon: IconReceiptTax, section: 'Accounts' },
  { label: 'Registers', to: '/registers', tab: 'registers', icon: IconListDetails, section: 'Accounts' },
  { label: 'Company & branding', to: '/settings/company', tab: 'company', icon: IconSettings, section: 'Settings' },
  { label: 'Rate card', to: '/settings/catalog', tab: 'catalog', icon: IconFileDollar, section: 'Settings' },
  { label: 'Templates', to: '/settings/templates', tab: 'templates', icon: IconTemplate, section: 'Settings' },
  { label: 'Users', to: '/settings/users', tab: 'users', icon: IconUserCog, section: 'Settings' },
  { label: 'Setup', to: '/setup', tab: 'setup', icon: IconAdjustments, section: 'Settings' },
];

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const loc = useLocation();
  useEffect(() => {
    if (loc.pathname === '/login' || /^\/(d|welcome|reset)\//.test(loc.pathname)) { setMe(null); return; }
    api<Me>('/auth/me', { quiet: true }).then(setMe).catch(() => setMe(null));
  }, [loc.pathname === '/login']);
  if (/^\/(welcome|reset)\//.test(loc.pathname)) return <Routes><Route path="/welcome/:token" element={<SetPasswordPage />} /><Route path="/reset/:token" element={<SetPasswordPage />} /></Routes>;
  if (loc.pathname.startsWith('/d/')) return <Suspense fallback={<Center h="100vh"><Loader /></Center>}><Routes><Route path="/d/:token" element={<SharedDocPage />} /></Routes></Suspense>;
  if (me === undefined && !loc.pathname.startsWith('/verify/')) return <Center h="100vh"><Loader /></Center>;
  if (loc.pathname.startsWith('/verify/')) return <Routes><Route path="/verify/:token" element={<VerifyPage />} /></Routes>;
  if (!me) return <Routes><Route path="/login" element={<Login onLogin={() => api<Me>('/auth/me').then(setMe)} />} /><Route path="*" element={<Navigate to="/login" />} /></Routes>;
  if (me.security?.required && !me.security.totpEnabled) return <MeCtx.Provider value={me}><Suspense fallback={<Loading />}><Required2fa /></Suspense></MeCtx.Provider>;
  return <MeCtx.Provider value={me}><MetaLoader /></MeCtx.Provider>;
}

function MetaLoader() {
  const { data, reload } = useApi<Meta>('/meta');
  if (!data) return <Center h="100vh"><Loader /></Center>;
  return <MetaCtx.Provider value={{ meta: data, reload }}><Shell /></MetaCtx.Provider>;
}

function Shell() {
  const me = useMe();
  const [opened, { toggle, close }] = useDisclosure();
  const [mini, setMini] = useLocalStorage({ key: 'nav-mini', defaultValue: false });
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(close, [loc.pathname]);
  const { data: dash } = useApi<any>('/dashboard');
  const items = NAV.filter((n) => hasTab(me, n.tab));
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); window.location.href = '/login'; };
  const reminders: any[] = dash?.reminders ?? [];

  // command palette: navigate, create and search records
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SpotlightActionData[]>([]);
  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setHits([]); return; }
    const [c, d, s] = await Promise.all([
      hasTab(me, 'clients') ? api<any[]>(`/clients?q=${encodeURIComponent(q)}`, { quiet: true }).catch(() => []) : [],
      api<any[]>(`/documents?q=${encodeURIComponent(q)}`, { quiet: true }).catch(() => []),
      hasTab(me, 'samples') ? api<any[]>(`/samples?q=${encodeURIComponent(q)}`, { quiet: true }).catch(() => []) : [],
    ]);
    setHits([
      ...c.slice(0, 5).map((x) => ({ id: `c${x.id}`, label: x.name, description: `Client${x.gstin ? ' · ' + x.gstin : ''}`, group: 'Records', onClick: () => nav(`/clients/${x.id}`) })),
      ...d.filter((x) => x.status !== 'cancelled').slice(0, 6).map((x) => ({ id: `d${x.id}`, label: `${x.number || 'Draft #' + x.id}`, description: `${{ quote: 'Quotation', invoice: 'Invoice', report: 'Report' }[x.kind as 'quote']} · ${x.client_name ?? ''}`, group: 'Records', onClick: () => nav(`/documents/${x.id}`) })),
      ...s.slice(0, 5).map((x) => ({ id: `s${x.id}`, label: x.code, description: `Sample · ${x.client_name}`, group: 'Records', onClick: () => nav(`/samples?open=${x.id}`) })),
    ]);
  }, [me]);
  useEffect(() => { const t = setTimeout(() => search(query), 220); return () => clearTimeout(t); }, [query]);
  const actions: SpotlightActionData[] = [
    ...(hasTab(me, 'analytics') ? [{ id: 'ask', label: `Ask AI: “${query || 'revenue by client this year'}”`, group: 'AI', leftSection: <IconSparkles size={18} />, onClick: () => nav(`/analytics?ask=${encodeURIComponent(query || 'revenue by client this year')}`) }] : []),
    ...hits,
    ...(hasTab(me, 'quotes') ? [{ id: 'nq', label: 'New quotation', group: 'Create', leftSection: <IconPlus size={18} />, onClick: () => nav('/quotes/new') }] : []),
    ...(hasTab(me, 'samples') ? [{ id: 'ns', label: 'Register sample', group: 'Create', leftSection: <IconPlus size={18} />, onClick: () => nav('/samples?new=1') }] : []),
    ...(hasTab(me, 'clients') ? [{ id: 'nc', label: 'New client', group: 'Create', leftSection: <IconPlus size={18} />, onClick: () => nav('/clients?new=1') }] : []),
    ...(hasTab(me, 'invoices') ? [{ id: 'ni', label: 'New invoice', group: 'Create', leftSection: <IconPlus size={18} />, onClick: () => nav('/invoices/new') }] : []),
    ...(hasTab(me, 'payments') ? [{ id: 'np', label: 'Record payment', group: 'Create', leftSection: <IconPlus size={18} />, onClick: () => nav('/payments?new=1') }] : []),
    ...items.map((n) => ({ id: `go${n.to}`, label: n.label, group: 'Go to', leftSection: <n.icon size={18} />, onClick: () => nav(n.to) })),
  ];

  const width = mini ? 72 : 244;
  return (
    <AppShell header={{ height: 56 }} navbar={{ width, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding={{ base: 'sm', sm: 'lg' }} styles={{ main: { background: 'var(--bg)' }, navbar: { borderRight: '1px solid var(--line)' }, header: { borderBottom: '1px solid var(--line)' } }}>
      <AppShell.Header className="no-print">
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <ActionIcon variant="subtle" color="gray" visibleFrom="sm" onClick={() => setMini(!mini)}>{mini ? <IconLayoutSidebarLeftExpand size={20} /> : <IconLayoutSidebarLeftCollapse size={20} />}</ActionIcon>
            {me.company.logo && <img src={me.company.logo} alt="" style={{ height: 30 }} />}
            <Text fw={700} size="sm" visibleFrom="xs" lineClamp={1}>{me.company.name}</Text>
          </Group>
          <UnstyledButton onClick={() => spotlight.open()} visibleFrom="sm" style={{ border: '1px solid #d0d5dd', borderRadius: 8, padding: '6px 10px', width: 360, background: '#f9fafb' }}>
            <Group justify="space-between"><Group gap={8}><IconSearch size={16} color="#667085" /><Text size="sm" c="dimmed">Search, create or ask AI…</Text></Group><Kbd size="xs">Ctrl K</Kbd></Group>
          </UnstyledButton>
          <Group gap="sm" wrap="nowrap">
            <ActionIcon variant="subtle" color="gray" hiddenFrom="sm" onClick={() => spotlight.open()}><IconSearch size={20} /></ActionIcon>
            <NotificationBell reminders={reminders} />
            <Menu position="bottom-end" shadow="lg">
              <Menu.Target><Avatar color="brand" radius="xl" style={{ cursor: 'pointer' }}>{me.user.name.slice(0, 2).toUpperCase()}</Avatar></Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{me.user.name}<br /><Badge size="xs" variant="light" color={me.role.admin ? 'red' : 'brand'}>{me.role.label}</Badge></Menu.Label>
                <Menu.Item onClick={() => nav('/account')}>My account & security</Menu.Item>
                <Menu.Item onClick={() => nav('/settings/users?me=1')}>My profile & signature</Menu.Item>
                <Menu.Item leftSection={<IconLogout size={16} />} onClick={logout}>Sign out</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar className="no-print" p={6}>
        <ScrollArea><SideNav items={items} mini={mini} /></ScrollArea>
      </AppShell.Navbar>
      <AppShell.Main>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/followups" element={<FollowUpsPage />} />
            <Route path="/quotes" element={<DocumentsList kind="quote" />} />
            <Route path="/quotes/new" element={<DocumentPage kind="quote" />} />
            <Route path="/invoices" element={<DocumentsList kind="invoice" />} />
            <Route path="/invoices/new" element={<DocumentPage kind="invoice" />} />
            <Route path="/reports" element={<DocumentsList kind="report" />} />
            <Route path="/reports/prepare" element={<PrepareReport />} />
            <Route path="/documents/:id" element={<DocumentPage />} />
            <Route path="/workorders" element={<WorkOrdersPage />} />
            <Route path="/workorders/:id" element={<WorkOrderDetail />} />
            <Route path="/samples" element={<SamplesPage />} />
            <Route path="/tests" element={<TestsPage />} />
            <Route path="/tests/:id" element={<TestSheetPage />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/ledger" element={<LedgerPage />} />
            <Route path="/ledger/:clientId" element={<ClientLedger />} />
            <Route path="/registers" element={<RegistersPage />} />
            <Route path="/equipment" element={<EquipmentPage />} />
            <Route path="/settings/company" element={<CompanySettings />} />
            <Route path="/settings/users" element={<UsersSettings />} />
            <Route path="/settings/catalog" element={<CatalogSettings />} />
            <Route path="/settings/templates" element={<TemplatesPage />} />
            <Route path="/settings/templates/obs/:code" element={<ObsTemplateEditor />} />
            <Route path="/settings/templates/:id" element={<TemplateDesigner />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/gst" element={<GstPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Suspense>
      </AppShell.Main>
      <BottomNav items={items} onMore={toggle} />
      <Spotlight actions={actions} query={query} onQueryChange={setQuery} filter={(q, a) => (!q ? a : (a as SpotlightActionData[]).filter((x) => x.group === 'Records' || x.group === 'AI' || String(x.label).toLowerCase().includes(q.toLowerCase())))} nothingFound="Nothing found" highlightQuery shortcut={['mod + K']}
        searchProps={{ leftSection: <IconSearch size={18} />, placeholder: 'Search clients, documents, samples… or ask a question' }} limit={30} scrollable maxHeight={460} />
    </AppShell>
  );
}

/** Phone: the four most-used screens one tap away; everything else under "More" (the side menu). */
function BottomNav({ items, onMore }: { items: NavItem[]; onMore: () => void }) {
  const loc = useLocation();
  const prefer = ['/', '/samples', '/tests', '/reports', '/quotes', '/invoices', '/clients'];
  const pick = prefer.map((to) => items.find((n) => n.to === to)).filter(Boolean).slice(0, 4) as NavItem[];
  const short: Record<string, string> = { '/': 'Home', '/samples': 'Samples', '/tests': 'Tests', '/reports': 'Reports', '/quotes': 'Quotes', '/invoices': 'Invoices', '/clients': 'Clients' };
  return (
    <nav className="bottom-nav no-print">
      {pick.map((n) => {
        const active = n.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.to);
        return <RLink key={n.to} to={n.to} className={active ? 'active' : ''}><n.icon size={22} stroke={1.7} /><span>{short[n.to] ?? n.label}</span></RLink>;
      })}
      <button type="button" onClick={onMore}><IconMenu2 size={22} stroke={1.7} /><span>More</span></button>
    </nav>
  );
}

/**
 * Sidebar: Home and Analytics always visible; Sales, Laboratory, Accounts and Settings fold open/closed.
 * The group of the screen you are on opens automatically; your choices are remembered on this device.
 */
function SideNav({ items, mini }: { items: NavItem[]; mini: boolean }) {
  const loc = useLocation();
  const [open, setOpen] = useLocalStorage<Record<string, boolean>>({ key: 'nav-groups', defaultValue: { Sales: true, Laboratory: true, Accounts: true, Settings: false } });
  const isActive = (n: NavItem) => (n.to === '/' ? loc.pathname === '/' : loc.pathname === n.to || (loc.pathname.startsWith(n.to + '/') && !NAV.some((o) => o.to !== n.to && o.to.startsWith(n.to) && loc.pathname.startsWith(o.to))));
  const top = items.filter((n) => !n.section);
  const groups = [...new Set(items.filter((n) => n.section).map((n) => n.section!))];
  const link = (n: NavItem) => (
    <Tooltip key={n.to} label={n.label} position="right" disabled={!mini}>
      <NavLink component={RLink} to={n.to} className="nav-link" label={mini ? null : n.label} leftSection={<n.icon size={19} stroke={1.7} />} active={isActive(n)} py={7} />
    </Tooltip>
  );
  return (
    <>
      {top.map(link)}
      {groups.map((g) => {
        const list = items.filter((n) => n.section === g);
        const here = list.some(isActive);
        const shown = mini || here || open[g] !== false;
        return (
          <div key={g}>
            {mini ? <div style={{ height: 10, borderTop: '1px solid var(--line)', margin: '8px 10px 0' }} /> : (
              <UnstyledButton className={`nav-group${here ? ' here' : ''}`} onClick={() => setOpen({ ...open, [g]: !shown })} aria-expanded={shown}>
                <span>{g}</span>
                {!shown && <span className="nav-group-count">{list.length}</span>}
                <IconChevronRight size={14} style={{ transform: shown ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
              </UnstyledButton>
            )}
            {shown && list.map(link)}
          </div>
        );
      })}
    </>
  );
}

/** Bell: unread notifications first; click one to open it (marks it read); "Mark all as read" clears the count. */
function NotificationBell({ reminders }: { reminders: any[] }) {
  const nav = useNavigate();
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const isRead = (r: any) => local[r.ref] ?? r.read;
  const unread = reminders.filter((r) => !isRead(r));
  const read = reminders.filter((r) => isRead(r));
  const mark = async (refs: string[], value = true) => {
    setLocal((x) => ({ ...x, ...Object.fromEntries(refs.map((k) => [k, value])) }));
    await api(value ? '/notifications/read' : '/notifications/unread', { body: { refs }, quiet: true }).catch(() => undefined);
  };
  const color = (l: string) => (l === 'danger' ? 'red' : l === 'warning' ? 'orange' : 'blue');
  const item = (r: any, i: number, done: boolean) => (
    <Menu.Item key={r.ref ?? i} onClick={() => { if (r.ref && !done) mark([r.ref]); nav(r.link); }} style={{ opacity: done ? 0.6 : 1 }}
      rightSection={r.ref && (
        <Tooltip label={done ? 'Mark as unread' : 'Mark as read'}>
          <ActionIcon size="sm" variant="subtle" color="gray" onClick={(e) => { e.stopPropagation(); mark([r.ref], !done); }}>{done ? <IconMailOpened size={15} /> : <IconCheck size={15} />}</ActionIcon>
        </Tooltip>
      )}>
      <Group gap={6} wrap="nowrap">{!done && <span style={{ width: 7, height: 7, borderRadius: 4, background: `var(--mantine-color-${color(r.level)}-6)`, flex: 'none' }} />}<Text size="xs" c={color(r.level)} fw={600}>{r.kind}</Text></Group>
      <Text size="sm">{r.text}</Text>
    </Menu.Item>
  );
  return (
    <Menu position="bottom-end" width={400} shadow="lg" closeOnItemClick>
      <Menu.Target>
        <Indicator disabled={!unread.length} label={unread.length} size={16} color="red" offset={4}>
          <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Notifications"><IconBell size={20} /></ActionIcon>
        </Indicator>
      </Menu.Target>
      <Menu.Dropdown>
        <Group justify="space-between" px="sm" py={6}>
          <Text size="sm" fw={650}>Notifications</Text>
          {unread.length > 0 && <Button size="compact-xs" variant="subtle" onClick={() => mark(unread.map((r) => r.ref).filter(Boolean))}>Mark all as read</Button>}
        </Group>
        <ScrollArea.Autosize mah={460}>
          {!reminders.length && <Text size="sm" c="dimmed" p="sm">All clear.</Text>}
          {reminders.length > 0 && !unread.length && <Text size="sm" c="dimmed" px="sm" pb="xs">You're all caught up.</Text>}
          {unread.slice(0, 20).map((r, i) => item(r, i, false))}
          {read.length > 0 && <><Menu.Divider /><Menu.Label>Earlier</Menu.Label>{read.slice(0, 15).map((r, i) => item(r, i, true))}</>}
        </ScrollArea.Autosize>
      </Menu.Dropdown>
    </Menu>
  );
}
