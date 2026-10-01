import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { en, type MessageKey, type Dict } from './en';
import { ru } from './ru';

export type Locale = 'en' | 'ru';
const dicts: Record<Locale, Dict> = { en, ru };

export type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function makeT(locale: Locale): TFn {
  const d = dicts[locale] ?? en;
  return (key, vars) => {
    let s: string = d[key] ?? en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

interface I18nValue { locale: Locale; t: TFn }
const I18nContext = createContext<I18nValue>({ locale: 'en', t: makeT('en') });

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeT(locale) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export type { MessageKey };
