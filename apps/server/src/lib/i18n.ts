import en from './locales/en';

/**
 * The engine speaks the user's language (notifications, tag names, errors, AI summaries).
 * Same convention as the UI (apps/mail/lib/i18n.ts): the French text is the key, English
 * translations live in lib/locales/en/*.ts, `{name}` placeholders, `tp()` for plurals.
 * The language is the one the UI last set (setting `locale`), else ZMAIL_LOCALE, else the
 * system's.
 */
export type Locale = 'fr' | 'en';

let current: () => Locale = () => systemLocale();

export function systemLocale(): Locale {
  const tag = process.env.ZMAIL_LOCALE || Intl.DateTimeFormat().resolvedOptions().locale || '';
  return tag.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

/** Called once by the engine context, so the language follows the stored setting. */
export function setLocaleSource(source: () => Locale) {
  current = source;
}

export const getLocale = (): Locale => current();
export const intlLocale = () => (current() === 'fr' ? 'fr-FR' : 'en-US');
/** The language AI answers must be written in, in words a model understands. */
export const outputLanguage = () => (current() === 'fr' ? 'French' : 'English');

const fill = (text: string, vars?: Record<string, string | number>) => (vars ? text.replace(/\{(\w+)\}/g, (all, key) => (key in vars ? String(vars[key]) : all)) : text);

export function t(fr: string, vars?: Record<string, string | number>): string {
  return fill(current() === 'en' ? (en[fr] ?? fr) : fr, vars);
}

export function tp(n: number, one: string, other: string, vars?: Record<string, string | number>): string {
  const plural = current() === 'fr' ? Math.abs(n) >= 2 : Math.abs(n) !== 1;
  return t(plural ? other : one, { n, ...vars });
}
