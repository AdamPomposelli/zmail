import { useQuery } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { SolarIcon } from '@/components/ui/solar-icon';
import { formatDuration } from '@/lib/savings';
import { useTRPC, type Outputs } from '@/lib/trpc';
import { useCatalog } from '@/hooks/use-catalog';
import { cn } from '@/lib/utils';
import { num, t } from '@/lib/i18n';

type Progress = Outputs['accounts']['progress'][number];

const busy = (p: Progress) => Boolean(p.sync) || p.ai.pending > 0;

/** Each mailbox's progress, refreshed every second while something runs. */
export function useAccountsProgress() {
  const trpc = useTRPC();
  const { data } = useQuery({
    ...trpc.accounts.progress.queryOptions(),
    refetchInterval: (q) => (q.state.data?.some(busy) ? 1500 : 15_000),
  });
  return data ?? [];
}

const FOLDERS: Record<string, string> = {
  inbox: t('Boîte de réception'),
  archive: t('Archives'),
  all: t('Tous les messages'),
  junk: t('Spam'),
  sent: t('Envoyés'),
  drafts: t('Brouillons'),
  trash: t('Corbeille'),
};

/**
 * Under an account in Settings → Accounts: its two steps, downloading the mail from the server,
 * then the AI sorting it. Hidden once both are done.
 */
export function AccountProgress({ progress }: { progress: Progress | undefined }) {
  if (!progress || !busy(progress)) return null;
  const { sync, ai } = progress;
  const aiPercent = ai.total ? Math.floor((ai.done / ai.total) * 100) : 0;
  const syncPercent = sync?.toFetch ? Math.floor((sync.fetched / sync.toFetch) * 100) : 0;
  return (
    <div className="animate-in fade-in slide-in-from-top-1 bg-muted/40 border-border mt-2.5 space-y-3 rounded-lg border px-3 py-2.5 duration-300">
      <Step
        state={sync ? 'run' : 'done'}
        icon={<SolarIcon name="_inbox" className="size-3.5" />}
        title={sync ? t('Récupération des mails') : t('Mails récupérés')}
        detail={
          sync
            ? t('{folder} · dossier {index} sur {count}', { folder: FOLDERS[sync.folder] ?? sync.folder, index: sync.folderIndex, count: sync.folders }) +
              (sync.toFetch ? ` · ${t('{done} sur {total}', { done: num(sync.fetched), total: num(sync.toFetch) })}` : '')
            : null
        }
        percent={sync ? syncPercent : 100}
        tone="bg-primary"
      />
      <Step
        state={ai.pending ? 'run' : 'done'}
        icon={<SolarIcon name="_ai" className="size-3.5" />}
        title={ai.pending ? t('Tri par l’IA') : t('Triés par l’IA')}
        detail={
          ai.pending
            ? `${t('{done} sur {total}', { done: num(ai.done), total: num(ai.total) })} · ${aiPercent} %` +
              (ai.etaSeconds ? ` · ${t('≈ {duration} restantes', { duration: formatDuration(Math.max(ai.etaSeconds, 5)) })}` : '')
            : null
        }
        percent={aiPercent}
        tone="bg-ai"
      />
    </div>
  );
}

function Step({ state, icon, title, detail, hint, percent, tone }: { state: 'run' | 'done'; icon: React.ReactNode; title: string; detail: string | null; hint?: string | null; percent: number; tone: string }) {
  return (
    <div className="flex gap-2.5">
      <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full', state === 'done' ? 'bg-success/15 text-success' : 'bg-background text-foreground ring-1 ring-border')}>
        {state === 'done' ? <Check className="size-3" /> : icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[12.5px] font-medium">
          {title}
          {state === 'run' ? <Loader2 className="text-muted-foreground size-3 animate-spin" /> : null}
          {detail ? <span className="text-muted-foreground truncate font-normal tabular-nums">· {detail}</span> : null}
        </p>
        {state === 'run' ? (
          <div className="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full">
            <div className={cn('h-full rounded-full transition-all duration-700', tone, percent === 0 && 'w-1/4 animate-pulse')} style={percent ? { width: `${percent}%` } : undefined} />
          </div>
        ) : null}
        {hint && state === 'run' ? <p className="text-muted-foreground mt-1 text-[11px]">{hint}</p> : null}
      </div>
    </div>
  );
}

/** Settings → AI: the mailboxes the AI is still sorting (a mailbox just imported), with their progress. */
export function AiBacklog() {
  const { accounts } = useCatalog();
  const progress = useAccountsProgress().filter((p) => p.ai.pending > 0);
  if (!progress.length) return null;
  return (
    <section className="border-border bg-card rounded-xl border px-5 py-4">
      <p className="flex items-center gap-2 text-[13.5px] font-semibold">
        <Loader2 className="text-ai size-4 animate-spin" />
        {t('L’IA trie vos mails')}
      </p>
      <p className="text-muted-foreground mt-0.5 text-[12.5px]">{t('Les nouveaux mails passent en premier : codes et réponses arrivent sans attendre.')}</p>
      <div className="mt-3 space-y-2.5">
        {progress.map((p) => {
          const account = accounts.find((a) => a.id === p.id);
          const percent = p.ai.total ? Math.floor((p.ai.done / p.ai.total) * 100) : 0;
          return (
            <div key={p.id}>
              <p className="flex items-baseline gap-2 text-[12.5px]">
                <span className="truncate font-medium">{account?.label || account?.email}</span>
                <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">
                  {t('{done} sur {total}', { done: num(p.ai.done), total: num(p.ai.total) })}
                  {p.ai.etaSeconds ? ` · ${t('≈ {duration} restantes', { duration: formatDuration(Math.max(p.ai.etaSeconds, 5)) })}` : ''}
                </span>
              </p>
              <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
                <div className="bg-ai h-full rounded-full transition-all duration-700" style={{ width: `${percent}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
