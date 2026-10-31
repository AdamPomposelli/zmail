import { Check, Download, Loader2, RotateCw, TriangleAlert } from 'lucide-react';
import type { AppUpdate } from '@/hooks/use-app-update';
import { num, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** The phases worth taking the sidebar's status line for. */
export const showsUpdate = (u: AppUpdate | null): u is AppUpdate => Boolean(u && u.phase !== 'idle');

/**
 * The sidebar's live status line while ZMail updates itself: progress while it downloads in
 * the background, then a "Restart to update" button once the new version is ready.
 */
export function UpdateStatus({ update, onInstall, onCheck }: { update: AppUpdate; onInstall: () => void; onCheck: () => void }) {
  const version = update.version ?? '';
  const pct = Math.round(update.progress * 100);

  if (update.phase === 'ready' || update.phase === 'manual') {
    return (
      <button
        type="button"
        onClick={onInstall}
        className="zm-update-ready bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/50 flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-[12px] font-semibold shadow-sm transition focus-visible:ring-2 focus-visible:outline-none"
        title={update.phase === 'manual' ? t('ZMail ne peut pas se remplacer à cet emplacement : téléchargez la nouvelle version.') : t('ZMail redémarre sur la version {version}.', { version })}
      >
        {update.phase === 'manual' ? <Download className="size-3.5 shrink-0" /> : <RotateCw className="size-3.5 shrink-0" />}
        <span className="truncate">{update.phase === 'manual' ? t('Télécharger la mise à jour') : t('Redémarrer pour mettre à jour')}</span>
        <span className="text-primary-foreground/70 ml-auto font-normal tabular-nums">{version}</span>
      </button>
    );
  }

  if (update.phase === 'failed') {
    return (
      <button type="button" onClick={onCheck} className="text-muted-foreground hover:text-foreground flex min-h-7 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] transition-colors" title={update.error}>
        <TriangleAlert className="text-warning size-3 shrink-0" />
        <span className="truncate">{t('Mise à jour impossible · réessayer')}</span>
      </button>
    );
  }

  const busy = update.phase === 'downloading' || update.phase === 'preparing' || update.phase === 'checking';
  const label =
    update.phase === 'downloading'
      ? t('Téléchargement de ZMail {version}… {pct} %', { version, pct: num(pct) })
      : update.phase === 'preparing'
        ? t('Préparation de ZMail {version}…', { version })
        : update.phase === 'checking'
          ? t('Recherche de mises à jour…')
          : t('ZMail est à jour ({version})', { version: update.current });

  return (
    <div className="text-muted-foreground flex min-h-7 flex-col justify-center gap-1 rounded-md px-2 py-1 text-[11px]" aria-live="polite">
      <span className="flex items-center gap-2">
        {busy ? <Loader2 className="text-primary size-3 shrink-0 animate-spin" /> : <Check className="text-success size-3 shrink-0" />}
        <span className="truncate">{label}</span>
      </span>
      {update.phase === 'downloading' || update.phase === 'preparing' ? (
        <span className="bg-sidebar-accent ml-5 h-1 overflow-hidden rounded-full">
          <span
            className={cn('bg-primary block h-full rounded-full transition-[width] duration-500', update.phase === 'preparing' && 'zm-update-shimmer')}
            style={{ width: update.phase === 'preparing' ? '100%' : `${Math.max(3, pct)}%` }}
          />
        </span>
      ) : null}
    </div>
  );
}
