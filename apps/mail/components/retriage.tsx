import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, RotateCw, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { toast } from 'sonner';
import { GhostButton } from '@/components/settings/ui';
import { formatDuration } from '@/lib/savings';
import { useTRPC, type Outputs } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { num, t, tp } from '@/lib/i18n';

type Run = NonNullable<Outputs['ai']['retriageStatus']>;

const running = (run: Run | null | undefined): run is Run => Boolean(run && !run.finishedAt);

/**
 * « Relancer le tri IA »: the AI re-reads every mail it sorted with the current mode,
 * categories and rules. It runs in the engine, mail by mail; this follows it.
 */
export function useRetriage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const status = useQuery({ ...trpc.ai.retriageStatus.queryOptions(), refetchInterval: (q) => (running(q.state.data) ? 1000 : false) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: trpc.ai.retriageStatus.queryKey() });
  const start = useMutation(trpc.ai.retriageAll.mutationOptions({ onSuccess: refresh, onError: (e) => toast.error(e.message) }));
  const cancel = useMutation(trpc.ai.cancelRetriage.mutationOptions({ onSuccess: refresh }));
  // Mail lists and counts catch up once it is over.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running(status.data)) void queryClient.invalidateQueries();
    wasRunning.current = running(status.data);
  }, [status.data, queryClient]);
  return { run: status.data ?? null, isRunning: running(status.data), start: () => start.mutate(), starting: start.isPending, cancel: () => cancel.mutate() };
}

const remaining = (run: Run) => {
  const elapsed = (Date.now() - run.startedAt) / 1000;
  if (run.done < 3 || elapsed < 3) return null;
  return ((run.total - run.done) / run.done) * elapsed;
};

/** The header button: starts it, and shows how far it is while it runs. */
export function RetriageButton() {
  const { run, isRunning, start, starting } = useRetriage();
  return (
    <GhostButton onClick={start} disabled={isRunning || starting} title={t('L’IA relit tous vos mails avec le mode, les catégories et les règles actuels. Vos corrections manuelles sont gardées.')}>
      {isRunning || starting ? <Loader2 className="animate-spin" /> : <RotateCw />}
      {isRunning && run ? t('Tri IA · {percent} %', { percent: Math.floor((run.done / Math.max(run.total, 1)) * 100) }) : t('Relancer le tri IA')}
    </GhostButton>
  );
}

/** Progress while it runs, then what changed. Closable once finished. */
export function RetriagePanel({ className }: { className?: string }) {
  const { run, isRunning, cancel } = useRetriage();
  const [closed, setClosed] = useState<number | null>(null);
  if (!run || closed === run.startedAt) return null;
  // A finished run stays visible a while, then leaves.
  if (!isRunning && run.finishedAt && Date.now() - run.finishedAt > 10 * 60_000) return null;
  const percent = Math.floor((run.done / Math.max(run.total, 1)) * 100);
  const eta = isRunning ? remaining(run) : null;

  return (
    <section className={cn('border-border bg-card rounded-xl border px-5 py-4', className)}>
      <div className="flex items-start gap-3">
        <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full', isRunning ? 'bg-ai/10 text-ai' : 'bg-success/10 text-success')}>
          {isRunning ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold">
            {isRunning
              ? t('L’IA relit vos mails : {done} sur {total}', { done: num(run.done), total: num(run.total) })
              : run.cancelled
                ? t('Tri IA arrêté : {done} mails relus sur {total}', { done: num(run.done), total: num(run.total) })
                : tp(run.total, 'Tri IA terminé : {n} mail relu', 'Tri IA terminé : {n} mails relus')}
          </p>
          <p className="text-muted-foreground mt-0.5 text-[12.5px]">
            {isRunning
              ? t('Catégories, priorité, spam, codes et résumés sont recalculés avec le mode et les catégories actuels. Vos corrections manuelles sont gardées. Vous pouvez continuer à utiliser ZMail.')
              : run.changed
                ? tp(run.changed, '{n} mail a changé de catégorie, de priorité ou de statut spam.', '{n} mails ont changé de catégorie, de priorité ou de statut spam.')
                : t('Aucun changement : vos mails étaient déjà bien triés.')}
          </p>
          {isRunning ? (
            <>
              <div className="bg-muted mt-3 h-1.5 overflow-hidden rounded-full">
                <div className="bg-ai h-full rounded-full transition-all duration-700" style={{ width: `${percent}%` }} />
              </div>
              <div className="text-muted-foreground mt-1.5 flex items-center gap-3 text-[11.5px] tabular-nums">
                <span>{percent} %</span>
                {run.changed ? <span>{tp(run.changed, '{n} changement', '{n} changements')}</span> : null}
                <span className="ml-auto">{eta === null ? t('Estimation du temps restant…') : t('≈ {duration} restantes', { duration: formatDuration(Math.max(eta, 5)) })}</span>
              </div>
            </>
          ) : null}
        </div>
        {isRunning ? (
          <GhostButton onClick={cancel} title={t('Les mails déjà relus gardent leur nouveau tri, les autres l’ancien.')}>
            <Square className="fill-current" /> {t('Arrêter')}
          </GhostButton>
        ) : (
          <button type="button" onClick={() => setClosed(run.startedAt)} className="text-muted-foreground hover:text-foreground -mr-1 rounded p-1" aria-label={t('Fermer')}>
            <X className="size-4" />
          </button>
        )}
      </div>
    </section>
  );
}

/** Shown right after the AI mode changed: the mails sorted before used the old one. */
export function RetriageSuggestion({ mode, onClose }: { mode: string; onClose: () => void }) {
  const { isRunning, start } = useRetriage();
  if (isRunning) return null;
  return (
    <div className="border-warning/30 bg-warning/[0.07] flex items-start gap-3 rounded-xl border px-4 py-3">
      <RotateCw className="text-warning mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{t('Mode « {mode} » activé pour les prochains mails', { mode })}</p>
        <p className="text-muted-foreground mt-0.5 text-[12.5px]">{t('Vos mails déjà triés l’ont été avec l’ancien mode, qui a pu se tromper. Relancez le tri IA pour les relire avec le nouveau.')}</p>
        <button type="button" onClick={() => (start(), onClose())} className="bg-foreground text-background hover:bg-foreground/90 mt-2.5 flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium">
          <RotateCw className="size-3.5" /> {t('Relancer le tri IA')}
        </button>
      </div>
      <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground -mt-0.5 -mr-1 rounded p-1" aria-label={t('Fermer')}>
        <X className="size-4" />
      </button>
    </div>
  );
}

/** Anywhere else in the app: a toast follows the run and says when it is done. */
export function RetriageToast() {
  const { run, isRunning } = useRetriage();
  const { pathname } = useLocation();
  const onSettings = pathname.startsWith('/settings/ai') || pathname.startsWith('/settings/tags');
  const shown = useRef<number | null>(null);
  useEffect(() => {
    if (!run) return;
    if (isRunning && !onSettings) {
      shown.current = run.startedAt;
      toast.loading(t('Tri IA : {done} sur {total}', { done: num(run.done), total: num(run.total) }), { id: 'retriage', description: t('L’IA relit vos mails en arrière-plan.') });
    } else if (isRunning) {
      toast.dismiss('retriage');
    } else if (shown.current === run.startedAt) {
      shown.current = null;
      toast.success(run.cancelled ? t('Tri IA arrêté') : tp(run.changed, 'Tri IA terminé : {n} mail reclassé', 'Tri IA terminé : {n} mails reclassés'), { id: 'retriage', description: tp(run.done, '{n} mail relu', '{n} mails relus') });
    }
  }, [run, isRunning, onSettings]);
  return null;
}
