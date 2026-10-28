import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, isToday, isYesterday, isThisYear, differenceInMinutes } from 'date-fns';
import { dateLocale, locale, t } from '@/lib/i18n';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

export function formatListDate(ms: number) {
  const date = new Date(ms);
  if (isToday(date)) {
    const minutes = differenceInMinutes(new Date(), date);
    if (minutes < 1) return t('à l’instant');
    if (minutes < 60) return t('il y a {n} min', { n: minutes });
    return format(date, locale === 'fr' ? 'HH:mm' : 'h:mm a');
  }
  if (isYesterday(date)) return t('Hier');
  if (locale === 'en') return format(date, isThisYear(date) ? 'MMM d' : 'MMM d, yyyy', { locale: dateLocale });
  return format(date, isThisYear(date) ? 'd MMM' : 'd MMM yyyy', { locale: dateLocale });
}

export function formatFullDate(ms: number) {
  return format(new Date(ms), locale === 'fr' ? "EEEE d MMMM yyyy 'à' HH:mm" : "EEEE, MMMM d, yyyy 'at' h:mm a", { locale: dateLocale });
}

export function initials(name: string | undefined, email: string) {
  const source = (name || email.split('@')[0] || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase();
}

const AVATAR_COLORS = ['#6366F1', '#8B5CF6', '#EC4899', '#F43F5E', '#F97316', '#F59E0B', '#10B981', '#14B8A6', '#06B6D4', '#3B82F6'];

export function colorFor(seed: string) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

export const displayName = (address: { name?: string; email: string }) => address.name || address.email.split('@')[0] || address.email;

export const PALETTE = ['#6366F1', '#8B5CF6', '#EC4899', '#F43F5E', '#F97316', '#F59E0B', '#84CC16', '#10B981', '#14B8A6', '#06B6D4', '#3B82F6', '#64748B'];
