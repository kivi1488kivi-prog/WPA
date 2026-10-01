import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { Banner } from '@astryxdesign/core/Banner';
import { VStack } from '@astryxdesign/core/VStack';
import { CalendarCheck, CalendarPlus, House, MessageCircle } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useTenant } from './tenant';
import { cn } from '@/lib/utils';

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function ClientLayout() {
  const { slug, shop } = useTenant();
  const { t } = useI18n();
  const online = useOnline();
  const base = `/s/${slug}`;
  const items = [
    { to: `${base}/`, label: t('nav.home'), icon: House, end: true },
    { to: `${base}/book`, label: t('nav.book'), icon: CalendarPlus, end: false },
    { to: `${base}/my`, label: t('nav.my'), icon: CalendarCheck, end: false },
    ...(shop.tenant.ai_enabled ? [{ to: `${base}/assistant`, label: t('nav.assistant'), icon: MessageCircle, end: false }] : []),
  ];

  return (
    <VStack className="min-h-dvh bg-body pt-safe pl-safe pr-safe">
      <VStack as="main" id="main" className="mx-auto w-full max-w-xl flex-1 pb-bottom-nav">
        {shop.tenant.status === 'preview' && <Banner status="warning" title={t('app.preview')} container="section" />}
        {!online && <Banner status="info" title={t('app.offline')} container="section" />}
        <Outlet />
        <footer className="mt-6 px-4 pb-4">
          <nav aria-label={t('legal.footer')} className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-secondary">
            <Link className="underline-offset-2 hover:underline" to={`${base}/impressum`}>{t('legal.impressum')}</Link>
            <Link className="underline-offset-2 hover:underline" to={`${base}/datenschutz`}>{t('legal.privacy')}</Link>
          </nav>
        </footer>
      </VStack>
      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-safe backdrop-blur supports-[backdrop-filter]:bg-surface/80"
      >
        <ul className="mx-auto flex max-w-xl">
          {items.map((it) => (
            <li key={it.to} className="flex-1">
              <NavLink
                to={it.to}
                end={it.end}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium text-secondary transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-[-4px]',
                    isActive && 'text-accent',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <it.icon aria-hidden size={22} strokeWidth={isActive ? 2.4 : 1.8} />
                    <span>{it.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </VStack>
  );
}
