import { useEffect, useMemo } from 'react';
import { Outlet, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { publicApi } from '@/lib/api/public';
import { toApiError } from '@/lib/api/errors';
import { envError } from '@/lib/env';
import { I18nProvider, makeT } from '@/lib/i18n';
import { registerServiceWorker } from '@/lib/push';
import { TenantContext, intlLocale, type TenantCtx } from './tenant';
import { TenantTheme } from './TenantTheme';
import { ErrorState, FullscreenSpinner } from '@/components/States';
import { NotFoundPage } from './StaticPages';

function bootLocale(): 'en' | 'ru' {
  const fromShell = document.documentElement.lang;
  return fromShell.startsWith('ru') ? 'ru' : 'en';
}

export function TenantRoot() {
  const slug = (useParams().slug ?? '').toLowerCase();
  const shopQuery = useQuery({
    queryKey: ['shop', slug],
    queryFn: () => publicApi.shop(slug),
    staleTime: 60_000,
    enabled: !envError && slug.length > 0,
  });

  const shop = shopQuery.data;
  const ctx = useMemo<TenantCtx | null>(
    () =>
      shop
        ? {
            slug,
            shop,
            tz: shop.tenant.timezone,
            locale: shop.tenant.locale,
            intl: intlLocale(shop.tenant.locale),
            refetch: () => void shopQuery.refetch(),
          }
        : null,
    [slug, shop, shopQuery],
  );

  useEffect(() => {
    if (!shop) return;
    document.documentElement.lang = shop.tenant.locale;
    if (!location.pathname.includes('/owner')) void registerServiceWorker(slug, 'client');
  }, [shop, slug]);

  if (envError) {
    const t = makeT(bootLocale());
    return (
      <TenantTheme slug="boot" accent="#C8A165">
        <ErrorState error={new Error(envError)} title={t('app.configMissing', { vars: envError })} />
      </TenantTheme>
    );
  }

  if (shopQuery.isPending) {
    return (
      <TenantTheme slug="boot" accent="#C8A165">
        <FullscreenSpinner />
      </TenantTheme>
    );
  }

  if (shopQuery.isError || !ctx || !shop) {
    const err = shopQuery.error;
    if (toApiError(err).code === 'tenant_not_found') return <NotFoundPage />;
    return (
      <TenantTheme slug="boot" accent="#C8A165">
        <I18nProvider locale={bootLocale()}>
          <ErrorState error={err} onRetry={() => void shopQuery.refetch()} />
        </I18nProvider>
      </TenantTheme>
    );
  }

  return (
    <TenantTheme slug={slug} accent={shop.tenant.accent_color}>
      <I18nProvider locale={shop.tenant.locale}>
        <TenantContext.Provider value={ctx}>
          <Outlet />
        </TenantContext.Provider>
      </I18nProvider>
    </TenantTheme>
  );
}
