import { enUS, fr as frFns } from 'date-fns/locale';
import { postNative } from '@/lib/native';

/**
 * ZMail speaks French and English. The French text is the key: `t('Boîte de réception')`
 * returns it as is in French, and its translation from lib/locales/en/*.ts in English
 * (French when a translation is missing; `pnpm i18n:check` lists those).
 * Placeholders: `t('Bonjour {name}', { name })`. Plurals: `tp(n, '{n} mail', '{n} mails')`.
 * One French word, two English ones: add a context after a bar, `t('Annuler|undo')` shows
 * « Annuler » in French and its own translation in English.
 */
export type Locale = 'fr' | 'en';
export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' },
];

const STORAGE_KEY = 'zmail.locale';

const EN: Record<string, string> = Object.assign(
  {},
  ...Object.values(import.meta.glob<{ default: Record<string, string> }>('./locales/en/*.ts', { eager: true })).map((m) => m.default),
);

function detect(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'fr' || saved === 'en') return saved;
  } catch {}
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export const locale: Locale = typeof window === 'undefined' ? 'fr' : detect();
/** BCP 47 tag for Intl and toLocaleString. */
export const intlLocale = locale === 'fr' ? 'fr-FR' : 'en-US';
/** date-fns locale. */
export const dateLocale = locale === 'fr' ? frFns : enUS;

if (typeof document !== 'undefined') document.documentElement.lang = locale;

const fill = (text: string, vars?: Record<string, string | number>) => (vars ? text.replace(/\{(\w+)\}/g, (all, key) => (key in vars ? String(vars[key]) : all)) : text);

const base = (key: string) => (key.includes('|') ? key.slice(0, key.indexOf('|')) : key);

export function t(fr: string, vars?: Record<string, string | number>): string {
  return fill(locale === 'en' ? (EN[fr] ?? base(fr)) : base(fr), vars);
}

/** Plural: the French singular and plural forms, `{n}` filled with the count. */
export function tp(n: number, one: string, other: string, vars?: Record<string, string | number>): string {
  const plural = locale === 'fr' ? Math.abs(n) >= 2 : Math.abs(n) !== 1;
  return t(plural ? other : one, { n, ...vars });
}

/** Formats a number for the current language. */
export const num = (value: number, options?: Intl.NumberFormatOptions) => value.toLocaleString(intlLocale, options);

/** Switches language: remembered here, told to the engine and the Mac app, then the page reloads. */
export function setLocale(next: Locale, tellEngine: (l: Locale) => Promise<unknown>) {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {}
  postNative({ type: 'setLocale', locale: next });
  return tellEngine(next).finally(() => window.location.reload());
}
