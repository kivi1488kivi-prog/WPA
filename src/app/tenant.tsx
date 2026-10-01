import { createContext, useContext } from 'react';
import type { ShopPayload } from '@/lib/api/schemas';

export interface TenantCtx {
  slug: string;
  shop: ShopPayload;
  tz: string;
  locale: 'de' | 'en' | 'ru';
  /** BCP-47 locale for Intl formatting. */
  intl: string;
  refetch: () => void;
}

export const TenantContext = createContext<TenantCtx | null>(null);

export function useTenant(): TenantCtx {
  const v = useContext(TenantContext);
  if (!v) throw new Error('useTenant outside TenantRoot');
  return v;
}

export function intlLocale(locale: 'de' | 'en' | 'ru'): string {
  return locale === 'ru' ? 'ru-RU' : locale === 'de' ? 'de-DE' : 'en-US';
}
