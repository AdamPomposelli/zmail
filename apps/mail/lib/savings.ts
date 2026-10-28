import { intlLocale, t } from '@/lib/i18n';
/** « 45 s », « 7 min », « 3 h 20 », « 2 j 4 h » : time saved, read at a glance. */
export function formatDuration(seconds: number) {
  if (seconds < 60) return t('{n} s', { n: Math.max(0, Math.round(seconds)) });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('{n} min', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? t('{h} h {m}', { h: hours, m: String(minutes % 60).padStart(2, '0') }) : t('{h} h', { h: hours });
  return hours % 24 ? t('{d} j {h} h', { d: Math.floor(hours / 24), h: hours % 24 }) : t('{d} j', { d: Math.floor(hours / 24) });
}

export const formatEuros = (value: number) => new Intl.NumberFormat(intlLocale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
