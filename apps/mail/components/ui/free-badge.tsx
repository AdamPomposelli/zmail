import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/** Marks what costs nothing — Apple Intelligence runs on the Mac, for free. */
export function FreeBadge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex h-4 shrink-0 items-center rounded-full bg-success/10 text-success px-1.5 text-[10px] font-semibold tracking-normal normal-case', className)} title={t('Apple Intelligence tourne sur votre Mac : aucun coût, aucune donnée envoyée')}>
      {t('Gratuit')}
    </span>
  );
}
