import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, NavLink as RLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppShell, Avatar, Burger, Group, Loader, Menu, NavLink, ScrollArea, Text, Button, Center, Badge } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconLayoutDashboard, IconUsers, IconFileDollar, IconClipboardList, IconFlask, IconFileCertificate, IconReceipt, IconCash,
  IconBook, IconListDetails, IconSettings, IconLogout, IconPlus, IconBox, IconTool, IconTemplate, IconUserCog, IconChecklist,
} from '@tabler/icons-react';
import { ROLES } from '@suite/shared';
import { api } from './api';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { ClientsPage, ClientDetail } from './pages/Clients';
import { DocumentsList } from './pages/DocumentsList';
import { DocumentPage } from './pages/DocumentPage';
import { WorkOrdersPage, WorkOrderDetail } from './pages/WorkOrders';
import { SamplesPage } from './pages/Samples';
import { TestsPage, TestSheetPage } from './pages/Tests';
import { PrepareReport } from './pages/PrepareReport';
import { PaymentsPage } from './pages/Payments';
import { LedgerPage, ClientLedger } from './pages/Ledger';
import { RegistersPage } from './pages/Registers';
import { CompanySettings } from './pages/settings/Company';
import { UsersSettings } from './pages/settings/Users';
import { CatalogSettings } from './pages/settings/Catalog';
import { EquipmentPage } from './pages/settings/Equipment';
import { TemplatesPage, TemplateDesigner } from './pages/settings/Templates';
import { GlobalSearch } from './components/GlobalSearch';

export interface Me { user: { id: number; name: string; email: string; role: string }; company: { id: number; name: string; stateCode: string; logo?: string } }
const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx)!;
export const hasRole = (me: Me, ...roles: string[]) => me.user.role === 'owner' || roles.includes(me.user.role);

const NAV: { label: string; to: string; icon: React.ComponentType<{ size?: number | string }>; roles?: string[]; section?: string }[] = [
  { label: 'Home', to: '/', icon: IconLayoutDashboard },
  { label: 'Clients', to: '/clients', icon: IconUsers, section: 'Sales' },
  { label: 'Quotations', to: '/quotes', icon: IconFileDollar },
  { label: 'Work orders', to: '/workorders', icon: IconClipboardList },
  { label: 'Sample register', to: '/samples', icon: IconBox, section: 'Laboratory' },
  { label: 'Tests & observations', to: '/tests', icon: IconFlask },
  { label: 'Prepare report', to: '/reports/prepare', icon: IconChecklist },
  { label: 'Reports', to: '/reports', icon: IconFileCertificate },
  { label: 'Invoices', to: '/invoices', icon: IconReceipt, section: 'Accounts' },
  { label: 'Payments', to: '/payments', icon: IconCash },
  { label: 'Ledgers', to: '/ledger', icon: IconBook },
  { label: 'Registers', to: '/registers', icon: IconListDetails },
  { label: 'Company & branding', to: '/settings/company', icon: IconSettings, section: 'Settings' },
  { label: 'Rate card', to: '/settings/catalog', icon: IconFileDollar },
  { label: 'Equipment', to: '/equipment', icon: IconTool },
  { label: 'Templates', to: '/settings/templates', icon: IconTemplate },
  { label: 'Users & roles', to: '/settings/users', icon: IconUserCog },
];

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const loc = useLocation();
  useEffect(() => {
    if (loc.pathname === '/login') { setMe(null); return; }
    api<Me>('/auth/me', { quiet: true }).then(setMe).catch(() => setMe(null));
  }, [loc.pathname === '/login']);
  if (me === undefined) return <Center h="100vh"><Loader /></Center>;
  if (!me) return <Routes><Route path="/login" element={<Login onLogin={() => api<Me>('/auth/me').then(setMe)} />} /><Route path="*" element={<Navigate to="/login" />} /></Routes>;
  return <MeCtx.Provider value={me}><Shell /></MeCtx.Provider>;
}

function Shell() {
  const me = useMe();
  const [opened, { toggle, close }] = useDisclosure();
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(close, [loc.pathname]);
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); window.location.href = '/login'; };
  const roleLabel = ROLES.find((r) => r.key === me.user.role)?.label ?? me.user.role;
  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 236, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header className="no-print">
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            {me.company.logo && <img src={me.company.logo} alt="" style={{ height: 32 }} />}
            <Text fw={700} size="sm" visibleFrom="xs" lineClamp={1}>{me.company.name}</Text>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <GlobalSearch />
            <Menu position="bottom-end">
              <Menu.Target><Button leftSection={<IconPlus size={16} />}>New</Button></Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => nav('/quotes/new')}>Quotation</Menu.Item>
                <Menu.Item onClick={() => nav('/samples?new=1')}>Sample (inward)</Menu.Item>
                <Menu.Item onClick={() => nav('/clients?new=1')}>Client</Menu.Item>
                <Menu.Item onClick={() => nav('/invoices/new')}>Invoice</Menu.Item>
                <Menu.Item onClick={() => nav('/payments?new=1')}>Payment received</Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <Menu position="bottom-end">
              <Menu.Target><Avatar color="navy" radius="xl" style={{ cursor: 'pointer' }}>{me.user.name.slice(0, 2).toUpperCase()}</Avatar></Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{me.user.name}<br /><Badge size="xs" variant="light">{roleLabel}</Badge></Menu.Label>
                <Menu.Item leftSection={<IconLogout size={16} />} onClick={logout}>Sign out</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar className="no-print">
        <ScrollArea p="xs">
          {NAV.map((n) => (
            <div key={n.to}>
              {n.section && <Text size="xs" c="dimmed" fw={600} tt="uppercase" mt="md" mb={4} px="sm">{n.section}</Text>}
              <NavLink component={RLink} to={n.to} label={n.label} leftSection={<n.icon size={18} />}
                active={n.to === '/' ? loc.pathname === '/' : loc.pathname === n.to || (loc.pathname.startsWith(n.to + '/') && !NAV.some((o) => o.to !== n.to && o.to.startsWith(n.to) && loc.pathname.startsWith(o.to)))} />
            </div>
          ))}
        </ScrollArea>
      </AppShell.Navbar>
      <AppShell.Main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
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
          <Route path="/settings/templates/:id" element={<TemplateDesigner />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}
