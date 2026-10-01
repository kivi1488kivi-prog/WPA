import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { Scissors } from 'lucide-react';
import { makeT } from '@/lib/i18n';
import { TenantTheme } from './TenantTheme';

function locale(): 'en' | 'ru' {
  return (document.documentElement.lang || navigator.language).startsWith('ru') ? 'ru' : 'en';
}

/** "/" — the shared build has no default tenant; each shop lives at /s/{slug}/. */
export function RootIndex() {
  const t = makeT(locale());
  return (
    <TenantTheme slug="root" accent="#C8A165">
      <EmptyState title={t('app.notFound.title')} description={t('app.notFound.body')} icon={<Icon icon={Scissors} size="lg" />} />
    </TenantTheme>
  );
}

export function NotFoundPage() {
  const t = makeT(locale());
  return (
    <TenantTheme slug="root" accent="#C8A165">
      <EmptyState
        title={t('app.notFound.title')}
        description={t('app.notFound.body')}
        icon={<Icon icon={Scissors} size="lg" />}
        headingLevel={1}
      />
    </TenantTheme>
  );
}
