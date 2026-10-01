import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { AppShell } from '@astryxdesign/core/AppShell';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { LinkProvider } from '@astryxdesign/core/Link';
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { Text } from '@astryxdesign/core/Text';
import { TopNav, TopNavHeading } from '@astryxdesign/core/TopNav';
import { VStack } from '@astryxdesign/core/VStack';
import { BarChart3, Bot, CalendarDays, CalendarOff, ExternalLink, Image, LogOut, Scissors, Settings, ShieldX, UserRound, Users } from 'lucide-react';
import { useTenant } from '@/app/tenant';
import { useI18n } from '@/lib/i18n';
import { getSupabase } from '@/lib/supabase';
import { myTenants, ownerApi } from '@/lib/api/owner';
import { registerServiceWorker } from '@/lib/push';
import { ErrorState, FullscreenSpinner } from '@/components/States';
import { OwnerContext, can, type OwnerCtx } from './context';
import { LoginPage } from './LoginPage';
import { RouterLink } from './RouterLink';
import { CalendarPage } from './calendar/CalendarPage';
import { ClientsPage } from './clients/ClientsPage';
import { BarbersPage } from './barbers/BarbersPage';
import { ServicesPage } from './services/ServicesPage';
import { SchedulePage } from './schedule/SchedulePage';
import { StatsPage } from './stats/StatsPage';
import { PhotosPage } from './photos/PhotosPage';
import { SettingsPage } from './settings/SettingsPage';
import { StaffPushToggle } from './StaffPushToggle';
import { OwnerAssistant } from './OwnerAssistant';

function useSession(slug: string) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    const sb = getSupabase(slug);
    void sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [slug]);
  return session;
}

export default function OwnerApp() {
  const { slug, shop } = useTenant();
  const { t } = useI18n();
  const session = useSession(slug);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const base = `/s/${slug}/owner`;

  useEffect(() => {
    void registerServiceWorker(slug, 'owner');
  }, [slug]);

  const userId = session?.user.id ?? null;
  const memberships = useQuery({
    queryKey: ['owner', slug, userId, 'memberships'],
    queryFn: () => myTenants(slug),
    enabled: !!userId,
  });
  const membership = memberships.data?.find((m) => m.tenant_id === shop.tenant.id) ?? null;
  const api = useMemo(() => (membership ? ownerApi(slug, membership.tenant_id) : null), [slug, membership]);
  const workspace = useQuery({
    queryKey: ['owner', slug, userId, 'workspace'],
    queryFn: () => (api as NonNullable<typeof api>).workspace(),
    enabled: !!api,
  });

  const signOut = async () => {
    await getSupabase(slug).auth.signOut();
    // Private data lives only in the in-memory query cache: drop all of it.
    queryClient.clear();
    navigate(base, { replace: true });
  };

  if (session === undefined) return <FullscreenSpinner />;
  if (!session) return <LoginPage />;
  if (memberships.isPending || (membership && workspace.isPending)) return <FullscreenSpinner />;
  if (memberships.isError) return <ErrorState error={memberships.error} onRetry={() => void memberships.refetch()} />;
  if (!membership || !api) {
    return (
      <VStack className="min-h-dvh items-center justify-center p-4">
        <EmptyState
          title={t('owner.noAccess')}
          icon={<Icon icon={ShieldX} size="lg" />}
          actions={<Button label={t('owner.signOut')} onClick={() => void signOut()} />}
        />
      </VStack>
    );
  }
  if (workspace.isError || !workspace.data) return <ErrorState error={workspace.error} onRetry={() => void workspace.refetch()} />;

  const ctx: OwnerCtx = {
    tenantId: membership.tenant_id,
    role: workspace.data.role,
    myBarberId: workspace.data.my_barber_id,
    api,
    workspace: workspace.data,
    refreshWorkspace: () => workspace.refetch(),
    base,
  };
  const role = ctx.role;
  const path = location.pathname.replace(/\/$/, '');
  const item = (to: string, label: string, icon: typeof CalendarDays, show = true) =>
    show ? <SideNavItem key={to} label={label} icon={icon} href={`${base}${to}`} isSelected={to === '' ? path === base : path.startsWith(`${base}${to}`)} /> : null;

  return (
    <OwnerContext.Provider value={ctx}>
      <LinkProvider component={RouterLink}>
        <AppShell
          height="fill"
          contentPadding={0}
          topNav={
            <TopNav
              label={t('owner.title')}
              heading={<TopNavHeading heading={shop.tenant.short_name} subheading={t(`owner.role.${role}`)} headingHref={base} />}
              endContent={<Button label={t('owner.signOut')} icon={<Icon icon={LogOut} />} variant="ghost" size="sm" onClick={() => void signOut()} />}
            />
          }
          sideNav={
            <SideNav aria-label={t('owner.title')}>
              <SideNavSection title={t('owner.title')} isHeaderHidden>
                {item('', t('owner.nav.calendar'), CalendarDays)}
                {item('/clients', t('owner.nav.clients'), Users)}
                {item('/schedule', t('owner.nav.schedule'), CalendarOff)}
                {item('/stats', t('owner.nav.stats'), BarChart3)}
                {item('/assistant', t('ai.title'), Bot, shop.tenant.ai_enabled)}
              </SideNavSection>
              {can(role, 'manage') ? (
                <SideNavSection title={t('settings.general')}>
                  {item('/barbers', t('owner.nav.barbers'), UserRound)}
                  {item('/services', t('owner.nav.services'), Scissors)}
                  {item('/photos', t('owner.nav.photos'), Image)}
                  {item('/settings', t('owner.nav.settings'), Settings)}
                </SideNavSection>
              ) : null}
              <SideNavSection title="—" isHeaderHidden>
                <SideNavItem label={t('owner.nav.clientSite')} icon={ExternalLink} href={`/s/${slug}/`} />
              </SideNavSection>
            </SideNav>
          }
        >
          <VStack gap={0} className="min-h-full">
            {shop.tenant.status === 'preview' ? <Banner status="warning" title={t('app.preview')} container="section" /> : null}
            <Routes>
              <Route index element={<CalendarPage />} />
              <Route path="clients" element={<ClientsPage />} />
              <Route path="clients/:customerId" element={<ClientsPage />} />
              <Route path="schedule" element={<SchedulePage />} />
              <Route path="stats" element={<StatsPage />} />
              <Route path="assistant" element={<OwnerAssistant />} />
              {can(role, 'manage') ? (
                <>
                  <Route path="barbers" element={<BarbersPage />} />
                  <Route path="services" element={<ServicesPage />} />
                  <Route path="photos" element={<PhotosPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                </>
              ) : null}
              <Route path="*" element={<Navigate to={base} replace />} />
            </Routes>
            <VStack padding={4} gap={2}>
              <StaffPushToggle />
              <Text type="supporting">{session.user.email}</Text>
            </VStack>
          </VStack>
        </AppShell>
      </LinkProvider>
    </OwnerContext.Provider>
  );
}
