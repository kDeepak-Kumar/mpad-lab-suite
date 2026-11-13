import { lazy, Suspense, useCallback, useEffect, useState, type ComponentType } from 'react';
import { Navigate, NavLink as RLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ActionIcon, AppShell, Button, Center, Group, Indicator, Loader, Menu, ScrollArea, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useDisclosure, useLocalStorage } from '@mantine/hooks';
import { Spotlight, spotlight, type SpotlightActionData } from '@mantine/spotlight';
import {
  IconSmartHome, IconChartDonut3, IconBuildingSkyscraper, IconFileDollar, IconClipboardCheck, IconCalendarEvent, IconTestPipe, IconFlask2, IconFileAnalytics,
  IconCertificate, IconRuler2, IconFileInvoice, IconWallet, IconBook2, IconTable, IconBuilding, IconTags, IconAdjustmentsAlt, IconRecycle, IconChartBar, IconBolt, IconId, IconCalendarCheck,
  IconLogout, IconPlus, IconTemplate, IconUserCog, IconSearch, IconTruckDelivery, IconShoppingCart, IconFileSearch, IconLayoutSidebar, IconBell, IconSparkles, IconMenu2, IconChevronRight, IconReceiptTax, IconCheck, IconMailOpened, IconSettings, IconUsersGroup, IconDots, IconShieldLock, IconSignature, IconClockHour4,
} from '@tabler/icons-react';
import { api, signOut, useApi } from './api';
import { applyBrand } from './brand';
import { Assistant } from './components/Assistant';
import { ChatButton, ChatProvider } from './components/Chat';
import { MeCtx, MetaCtx, hasTab, useCan, useMe, type Me, type Meta } from './ctx';
import { Login, SetPasswordPage } from './pages/Login';
import { VerifyPage } from './pages/Verify';
import { Loading } from './components/ui';
import { SideNav, matchNav, type NavItem } from './components/SideNav';
import { FavProvider, useRecent } from './favorites';
import { IdleGuard } from './components/IdleGuard';
import { ErrorBoundary } from './components/ErrorBoundary';

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
const InvoiceAnalyticsPage = page(() => import('./pages/InvoiceAnalytics'), 'InvoiceAnalyticsPage');
const QuickReportsPage = page(() => import('./pages/QuickReports'), 'QuickReportsPage');
const EmployeesPage = page(() => import('./pages/Employees'), 'EmployeesPage');
const EmployeeDetail = page(() => import('./pages/Employees'), 'EmployeeDetail');
const AttendancePage = page(() => import('./pages/Attendance'), 'AttendancePage');
const RecycleBinPage = page(() => import('./pages/settings/RecycleBin'), 'RecycleBinPage');
const FollowUpsPage = page(() => import('./pages/FollowUps'), 'FollowUpsPage');
const AccountPage = page(() => import('./pages/Account'), 'AccountPage');
const GstPage = page(() => import('./pages/Gst'), 'GstPage');
const ContractReviewPage = page(() => import('./pages/ContractReview'), 'ContractReviewPage');
const OutsourcingPage = page(() => import('./pages/Outsourcing'), 'OutsourcingPage');
const PurchasesPage = page(() => import('./pages/Purchases'), 'PurchasesPage');
const Required2fa = page(() => import('./pages/Account'), 'Required2fa');

export { useMe };
export const hasRole = (me: Me, ...roles: string[]) => Boolean(me.role?.admin || me.user.role === 'owner' || roles.includes(me.user.role));

/**
 * The left menu. Related pages share one entry and appear as tabs above the page (`sub`), so the menu stays short
 * while every page keeps its address and its permission (`tab`).
 */
const NAV: NavItem[] = [
  { label: 'Home', to: '/', tab: 'home', icon: IconSmartHome },
  { label: 'Samples', to: '/samples', tab: 'samples', icon: IconTestPipe, section: 'Laboratory' },
  { label: 'Tests & observations', to: '/tests', tab: 'tests', icon: IconFlask2, section: 'Laboratory' },
  { label: 'Test reports', to: '/reports', tab: 'reports', icon: IconCertificate, section: 'Laboratory', sub: [
    { label: 'All reports', to: '/reports', tab: 'reports' }, { label: 'Prepare report', to: '/reports/prepare', tab: 'prepare' }, { label: 'Quick test report', to: '/reports/quick', tab: 'tests' }] },
  { label: 'Outsourced tests', to: '/outsourcing', tab: 'outsourcing', icon: IconTruckDelivery, section: 'Laboratory' },
  { label: 'Equipment', to: '/equipment', tab: 'equipment', icon: IconRuler2, section: 'Laboratory' },
  { label: 'Clients', to: '/clients', tab: 'clients', icon: IconBuildingSkyscraper, section: 'Sales' },
  { label: 'Quotations', to: '/quotes', tab: 'quotes', icon: IconFileDollar, section: 'Sales', sub: [
    { label: 'Quotations', to: '/quotes', tab: 'quotes' }, { label: 'Contract review', to: '/contract-review', tab: 'quotes' }] },
  { label: 'Work orders', to: '/workorders', tab: 'workorders', icon: IconClipboardCheck, section: 'Sales' },
  { label: 'Follow-ups', to: '/followups', tab: 'followups', icon: IconCalendarEvent, section: 'Sales' },
  { label: 'Invoices', to: '/invoices', tab: 'invoices', icon: IconFileInvoice, section: 'Accounts', sub: [
    { label: 'Invoices', to: '/invoices', tab: 'invoices' }, { label: 'Invoice analytics', to: '/invoices/analytics', tab: 'invoices' }] },
  { label: 'Payments', to: '/payments', tab: 'payments', icon: IconWallet, section: 'Accounts' },
  { label: 'Purchases', to: '/purchases', tab: 'purchases', icon: IconShoppingCart, section: 'Accounts' },
  { label: 'Ledgers & GST', to: '/ledger', tab: 'ledger', icon: IconBook2, section: 'Accounts', sub: [
    { label: 'Ledgers', to: '/ledger', tab: 'ledger' }, { label: 'GST returns', to: '/gst', tab: 'gst' }, { label: 'Registers', to: '/registers', tab: 'registers' }] },
  { label: 'Analytics & AI', to: '/analytics', tab: 'analytics', icon: IconChartDonut3, section: 'Insights & team' },
  { label: 'People', to: '/employees', tab: 'employees', icon: IconUsersGroup, section: 'Insights & team', sub: [
    { label: 'Employees', to: '/employees', tab: 'employees' }, { label: 'Attendance', to: '/attendance', tab: 'employees' }] },
  { label: 'Settings', to: '/settings/company', tab: 'company', icon: IconSettings, foot: true, sub: [
    { label: 'Company & branding', to: '/settings/company', tab: 'company' }, { label: 'Rate card', to: '/settings/catalog', tab: 'catalog' }, { label: 'Templates', to: '/settings/templates', tab: 'templates' },
    { label: 'Users', to: '/settings/users', tab: 'users' }, { label: 'Setup', to: '/setup', tab: 'setup' }, { label: 'Recycle Bin', to: '/settings/recycle-bin', tab: '__admin' }] },
];
/** The menu a user may see: pages without access drop out, and an entry opens its first permitted page. */
function navFor(me: Me): NavItem[] {
  return NAV.flatMap((n) => {
    if (!n.sub) return hasTab(me, n.tab) ? [n] : [];
    const sub = n.sub.filter((s) => hasTab(me, s.tab));
    return sub.length ? [{ ...n, sub, to: sub[0].to }] : [];
  });
}

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
  return <MetaCtx.Provider value={{ meta: data, reload }}><FavProvider><Shell /></FavProvider></MetaCtx.Provider>;
}

function Shell() {
  const me = useMe();
  const [opened, { toggle, close }] = useDisclosure();
  const [miniPref, setMini] = useLocalStorage({ key: 'nav-mini', defaultValue: false });
  // a docked quick view asks for room: the menu folds to icons while it is open and comes back afterwards
  const [autoMini, setAutoMini] = useState(false);
  useEffect(() => { const on = (e: Event) => setAutoMini(Boolean((e as CustomEvent).detail)); window.addEventListener('nav:auto-mini', on); return () => window.removeEventListener('nav:auto-mini', on); }, []);
  const mini = miniPref || autoMini;
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(close, [loc.pathname]);
  useEffect(() => { applyBrand(me.company.theme); }, [JSON.stringify(me.company.theme ?? null)]);
  const { data: dash } = useApi<any>('/dashboard');
  const c = dash?.counts ?? {};
  const waiting: Record<string, [number, boolean]> = { '/tests': [(c.myTests || 0) + (c.toReview || 0), (c.myTests || 0) > 0], '/reports': [(c.reportsToVerify || 0) + (c.reportsToIssue || 0), true], '/quotes': [c.quotesAwaiting || 0, false] };
  const items = navFor(me).map((n) => (waiting[n.to]?.[0] ? { ...n, count: waiting[n.to][0], mine: waiting[n.to][1] } : n));
  const pages = items.flatMap((n) => (n.sub ? n.sub.map((s) => ({ ...s, icon: n.icon })) : [n]));
  // a record page can name itself in the breadcrumb (e.g. a document says which list it belongs to)
  const [crumb, setCrumb] = useState<{ to: string; label: string } | null>(null);
  useEffect(() => { const on = (e: Event) => setCrumb((e as CustomEvent).detail); window.addEventListener('crumb', on); return () => window.removeEventListener('crumb', on); }, []);
  const here = matchNav(items, crumb ? crumb.to : loc.pathname);
  const recent = useRecent().filter((r) => r.to !== loc.pathname).slice(0, 5);
  const logout = () => signOut();
  const reminders: any[] = dash?.reminders ?? [];
  const initials = me.user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

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
    ...(query ? [] : recent.map((r) => ({ id: `r${r.to}`, label: r.label, description: r.sub, group: 'Recently viewed', leftSection: <IconClockHour4 size={18} />, onClick: () => nav(r.to) }))),
    ...pages.map((n) => ({ id: `go${n.to}`, label: n.label, group: 'Go to', leftSection: <n.icon size={18} />, onClick: () => nav(n.to) })),
  ];

  const width = mini ? 64 : 248;
  const userMenu = (
    <Menu.Dropdown>
      <Menu.Label>{me.user.name} · {me.role.label}</Menu.Label>
      <Menu.Item leftSection={<IconShieldLock size={16} />} onClick={() => nav('/account')}>My account & security</Menu.Item>
      <Menu.Item leftSection={<IconSignature size={16} />} onClick={() => nav('/settings/users?me=1')}>My profile & signature</Menu.Item>
      <Menu.Item leftSection={<IconId size={16} />} onClick={() => nav('/employees/me')}>My employee record & attendance</Menu.Item>
      <Menu.Divider />
      <Menu.Item leftSection={<IconLogout size={16} />} onClick={logout}>Sign out</Menu.Item>
    </Menu.Dropdown>
  );
  return (
    <ChatProvider meId={me.user.id}>
    <AppShell layout="alt" header={{ height: 'calc(var(--topbar-h) + var(--shell-gap))' as any }} navbar={{ width, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding={{ base: 'sm', sm: 'lg' }} transitionDuration={220}>
      <Assistant />
      <IdleGuard minutes={me.security?.idleMinutes ?? 10} warnAfter={me.security?.idleWarnAfter ?? 7} />
      <div className="shell-frame no-print" aria-hidden="true"><i /></div>
      <AppShell.Header className="no-print shell-header" withBorder={false}>
        <div className="topbar">
          <Tooltip label={mini ? 'Expand the menu' : 'Collapse the menu'}><UnstyledButton className="iconbtn" visibleFrom="sm" aria-label="Toggle the menu" onClick={() => { setAutoMini(false); setMini(!mini); }}><IconLayoutSidebar size={18} stroke={1.75} /></UnstyledButton></Tooltip>
          <Group gap={8} hiddenFrom="sm" wrap="nowrap" style={{ minWidth: 0 }}>{me.company.logo ? <img src={me.company.logo} alt="" style={{ height: 28, borderRadius: 7 }} /> : <span className="sn-logo" style={{ width: 28, height: 28 }}>{me.company.name.slice(0, 2).toUpperCase()}</span>}</Group>
          <nav className="crumbs" aria-label="Breadcrumb">
            {here ? <>
              {here.item.section && <span className="hide-mobile">{here.item.section}</span>}
              {here.item.section && <IconChevronRight size={13} className="hide-mobile" />}
              {crumb ? <><RLink to={crumb.to} className="hide-mobile">{here.sub && here.item.sub!.length > 1 ? here.sub.label : here.item.label}</RLink><IconChevronRight size={13} className="hide-mobile" /><b className="tnum">{crumb.label}</b></>
              : here.sub && here.item.sub!.length > 1 && here.sub.label !== here.item.label ? <><RLink to={here.item.to} className="hide-mobile">{here.item.label}</RLink><IconChevronRight size={13} className="hide-mobile" /><b>{here.sub.label}</b></> : <b>{here.item.label}</b>}
            </> : <b>{loc.pathname.startsWith('/account') ? 'My account' : loc.pathname.startsWith('/documents') ? 'Document' : ''}</b>}
          </nav>
          <div className="tb-right">
            {<Tooltip label="Ask the assistant (Ctrl+J)"><UnstyledButton className="ai-pill" onClick={() => window.dispatchEvent(new Event('assistant:toggle'))} aria-label="Ask AI"><IconSparkles size={15} /><span>Ask AI</span><kbd className="hide-mobile">Ctrl J</kbd></UnstyledButton></Tooltip>}
            <Tooltip label="Search (Ctrl+K)"><UnstyledButton className="iconbtn" hiddenFrom="sm" aria-label="Search" onClick={() => spotlight.open()}><IconSearch size={18} stroke={1.75} /></UnstyledButton></Tooltip>
            <QuickCreate />
            <ChatButton />
            <NotificationBell reminders={reminders} />
            <Menu position="bottom-end" width={250}><Menu.Target><UnstyledButton className="sn-av" hiddenFrom="sm" aria-label="Account menu" style={{ marginLeft: 6 }}>{initials}</UnstyledButton></Menu.Target>{userMenu}</Menu>
          </div>
        </div>
      </AppShell.Header>
      <AppShell.Navbar className="no-print sn-shell" withBorder={false}>
        <AppShell.Section className={`sn-brand${mini ? ' mini' : ''}`}>
          {me.company.logo ? <img src={me.company.logo} alt="" /> : <span className="sn-logo">{me.company.name.slice(0, 2).toUpperCase()}</span>}
          {!mini && <div style={{ minWidth: 0 }}><div className="sn-brand-name" title={me.company.name}>{me.company.name}</div><div className="sn-brand-sub">Lab Suite</div></div>}
        </AppShell.Section>
        <AppShell.Section px={mini ? 0 : 8} visibleFrom="sm">
          {mini ? <Tooltip label="Search (Ctrl+K)" position="right"><UnstyledButton className="sn-link mini" style={{ margin: '0 auto 6px' }} aria-label="Search" onClick={() => spotlight.open()}><span className="sn-ic"><IconSearch size={18} stroke={1.75} /></span></UnstyledButton></Tooltip>
            : <UnstyledButton className="cmdk" onClick={() => spotlight.open()}><IconSearch size={15} /><span>Search or jump to…</span><kbd>Ctrl K</kbd></UnstyledButton>}
        </AppShell.Section>
        <AppShell.Section grow component={ScrollArea} px={mini ? 0 : 8} pt={0} scrollbarSize={6}><SideNav items={items} mini={mini} /></AppShell.Section>
        <AppShell.Section px={mini ? 0 : 8} pt={6}><SideNav items={items} mini={mini} part="foot" /></AppShell.Section>
        <AppShell.Section className="sn-foot" visibleFrom="sm">
          <Menu position="top-start" width={250}>
            <Menu.Target>
              <UnstyledButton className={`sn-user${mini ? ' mini' : ''}`} aria-label="Account menu">
                <span className="sn-av">{initials}</span>
                {!mini && <><div style={{ minWidth: 0, flex: 1 }}><Text size="sm" fw={600} truncate lh={1.3}>{me.user.name}</Text><Text size="xs" className="sn-user-role" truncate lh={1.3}>{me.role.label}</Text></div><IconDots size={16} style={{ opacity: .6, flex: 'none' }} /></>}
              </UnstyledButton>
            </Menu.Target>
            {userMenu}
          </Menu>
        </AppShell.Section>
      </AppShell.Navbar>
      <AppShell.Main className="shell-main">
        {here?.item.sub && here.item.sub.length > 1 && !crumb && !/\/(new|\d+)$/.test(loc.pathname) && !/^\/settings\/templates\/./.test(loc.pathname) && (
          <nav className="subnav no-print" aria-label={here.item.label}>
            {here.item.sub.map((x) => <RLink key={x.to} to={x.to} end className={x === here.sub ? 'on' : ''}>{x.label}</RLink>)}
          </nav>
        )}
        <ErrorBoundary resetKey={loc.pathname + loc.search}>
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
            <Route path="/invoices/analytics" element={<InvoiceAnalyticsPage />} />
            <Route path="/reports" element={<DocumentsList kind="report" />} />
            <Route path="/reports/prepare" element={<PrepareReport />} />
            <Route path="/documents/:id" element={<DocumentPage />} />
            <Route path="/workorders" element={<WorkOrdersPage />} />
            <Route path="/workorders/:id" element={<WorkOrderDetail />} />
            <Route path="/samples" element={<SamplesPage />} />
            <Route path="/outsourcing" element={<OutsourcingPage />} />
            <Route path="/contract-review" element={<ContractReviewPage />} />
            <Route path="/purchases" element={<PurchasesPage />} />
            <Route path="/tests" element={<TestsPage />} />
            <Route path="/tests/:id" element={<TestSheetPage />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/ledger" element={<LedgerPage />} />
            <Route path="/ledger/:clientId" element={<ClientLedger />} />
            <Route path="/registers" element={<RegistersPage />} />
            <Route path="/equipment" element={<EquipmentPage />} />
            <Route path="/settings/company" element={<CompanySettings />} />
            <Route path="/settings/users" element={<UsersSettings />} />
            <Route path="/settings/recycle-bin" element={<RecycleBinPage />} />
            <Route path="/reports/quick" element={<QuickReportsPage />} />
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/employees/:id" element={<EmployeeDetail />} />
            <Route path="/attendance" element={<AttendancePage />} />
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
        </ErrorBoundary>
      </AppShell.Main>
      <BottomNav items={items} onMore={toggle} />
      <Spotlight actions={actions} query={query} onQueryChange={setQuery} filter={(q, a) => (!q ? a : (a as SpotlightActionData[]).filter((x) => x.group === 'Records' || x.group === 'AI' || String(x.label).toLowerCase().includes(q.toLowerCase())))} nothingFound="Nothing found" highlightQuery shortcut={['mod + K']}
        searchProps={{ leftSection: <IconSearch size={18} />, placeholder: 'Search clients, documents, samples… or ask a question' }} limit={30} scrollable maxHeight={460} />
    </AppShell>
    </ChatProvider>
  );
}

/** Phone: the four most-used screens one tap away; everything else under "More" (the side menu). */
function BottomNav({ items, onMore }: { items: NavItem[]; onMore: () => void }) {
  const loc = useLocation();
  const prefer = ['/', '/samples', '/tests', '/reports', '/quotes', '/invoices', '/clients'];
  const pick = prefer.map((to) => items.find((n) => n.to === to || n.sub?.some((x) => x.to === to))).filter(Boolean).slice(0, 4) as NavItem[];
  const short: Record<string, string> = { '/': 'Home', '/samples': 'Samples', '/tests': 'Tests', '/reports': 'Reports', '/quotes': 'Quotes', '/invoices': 'Invoices', '/clients': 'Clients' };
  return (
    <nav className="bottom-nav no-print">
      {pick.map((n) => {
        const active = n.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.to);
        return <RLink key={n.to} to={n.to} className={active ? 'active' : ''}><n.icon size={18} stroke={1.75} /><span>{short[n.to] ?? n.label}</span></RLink>;
      })}
      <button type="button" onClick={onMore}><IconMenu2 size={18} stroke={1.75} /><span>More</span></button>
    </nav>
  );
}

/**
 * Sidebar: Home and Analytics always visible; Sales, Laboratory, Accounts and Settings fold open/closed.
 * The group of the screen you are on opens automatically; your choices are remembered on this device.
 */
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
        <Indicator disabled={!unread.length} label={unread.length > 99 ? '99+' : unread.length} size={16} color="accent" offset={6} styles={{ indicator: { fontWeight: 600, fontSize: 10 } }}>
          <Tooltip label="Notifications"><UnstyledButton className="iconbtn" aria-label="Notifications"><IconBell size={18} stroke={1.75} /></UnstyledButton></Tooltip>
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

/** "+ New" in the top bar: create the common records from any screen in one click. */
function QuickCreate() {
  const can = useCan();
  const nav = useNavigate();
  const items = [
    { label: 'Quotation', to: '/quotes/new', icon: IconFileDollar, ok: can('quote.create') },
    { label: 'Register sample', to: '/samples?new=1', icon: IconTestPipe, ok: can('sample.create') },
    { label: 'Client', to: '/clients?new=1', icon: IconBuildingSkyscraper, ok: can('client.create') },
    { label: 'Invoice', to: '/invoices/new', icon: IconFileInvoice, ok: can('invoice.create') },
    { label: 'Record payment', to: '/payments?new=1', icon: IconWallet, ok: can('recordPayments') },
    { label: 'Follow-up', to: '/followups?new=1', icon: IconCalendarEvent, ok: can('client.read') },
  ].filter((i) => i.ok);
  if (!items.length) return null;
  return (
    <Menu shadow="lg" position="bottom-end" width={210}>
      <Menu.Target><Tooltip label="Create new"><UnstyledButton className="iconbtn" aria-label="Create new"><IconPlus size={18} stroke={1.75} /></UnstyledButton></Tooltip></Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Create</Menu.Label>
        {items.map((i) => <Menu.Item key={i.to} leftSection={<i.icon size={16} />} onClick={() => nav(i.to)}>{i.label}</Menu.Item>)}
      </Menu.Dropdown>
    </Menu>
  );
}
