import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Link } from 'react-router';
import { SolarIcon, solar } from '@/components/ui/solar-icon';
import { InfoHint } from '@/components/ui/info-hint';
import { SuiteBanner } from '@/components/zippy/suite-promo';
import { useCatalog } from '@/hooks/use-catalog';
import { TagIcon } from '@/lib/tag-icons';
import { formatDuration } from '@/lib/savings';
import { ReplyCockpit } from '@/components/mail/reply-cockpit';
import { useTRPC, type Outputs } from '@/lib/trpc';
import { useSpaces } from '@/hooks/use-space';
import { cn, formatListDate } from '@/lib/utils';
import { intlLocale, num, t, tp } from '@/lib/i18n';

const Bell = solar('_notifications');
const Unsubscribe = solar('_unsubscribe');

/**
 * The reading pane when no conversation is open. Three questions, answered at a glance:
 * what has ZMail already saved me, what is left, and the one click that clears most of it.
 */
export function Overview() {
  const trpc = useTRPC();
  const catalog = useCatalog();
  const { spaceId } = useSpaces();
  const { data: counts } = useQuery(trpc.mail.counts.queryOptions({ spaceId }));
  const { data: savings } = useQuery(trpc.cleanup.savings.queryOptions());
  const { data: left } = useQuery(trpc.cleanup.remaining.queryOptions({ spaceId }));
  const { data: latest } = useQuery(trpc.cleanup.latest.queryOptions());
  // The run shown in the cockpit: the one just started, or today's still open after a reload.
  const [closed, setClosed] = useState<string | null>(() => {
    try {
      return localStorage.getItem('zmail:overview:closedRun');
    } catch {
      return null;
    }
  });
  const [runId, setRunId] = useState<string | null>(null);
  const shown = runId ?? (latest && latest.id !== closed && latest.replies ? latest.id : null);
  const close = () => {
    if (shown) {
      setClosed(shown);
      try {
        localStorage.setItem('zmail:overview:closedRun', shown);
      } catch {
        /* private mode */
      }
    }
    setRunId(null);
  };
  // The AI agent's own messages live behind the IA button (with a badge), not among the alerts.
  const { data: allNotifications } = useQuery(trpc.notifications.list.queryOptions());
  const notifications = allNotifications?.filter((n) => n.kind !== 'agent');
  const { data: status } = useQuery(trpc.ai.status.queryOptions());
  const hour = new Date().getHours();
  const greeting = hour < 6 ? t('Bonne nuit') : hour < 18 ? t('Bonjour') : t('Bonsoir');
  const tag = (id: string) => catalog.tagById.get(id);
  const unreadOf = (id: string) => counts?.tags[id] ?? 0;

  // Next steps that need the person, most valuable first; the cleaning agent handles the rest.
  const steps: { key: string; to: string; icon: ReactNode; title: string; hint: string }[] = [];
  const stepFor = (id: string, title: (n: number) => string, hint: string) => {
    const n = unreadOf(id);
    const tg = tag(id);
    if (n && tg) steps.push({ key: id, to: `/mail/inbox?tag=${id}`, icon: <TagIcon icon={tg.icon} color={tg.color} className="size-4" />, title: title(n), hint });
  };
  stepFor('to-respond', (n) => tp(n, 'Répondre à la personne qui attend', 'Répondre aux {n} personnes qui attendent'), t('Le composeur à la voix rédige la réponse pour vous'));
  stepFor('opportunity', (n) => tp(n, '{n} opportunité à saisir', '{n} opportunités à saisir'), t('Devis, partenariats, leads entrants'));
  stepFor('important', (n) => tp(n, '{n} mail important à lire', '{n} mails importants à lire'), t('Décisions, échéances, personnes clés'));
  stepFor('chargeback', (n) => tp(n, '{n} litige de paiement à traiter', '{n} litiges de paiement à traiter'), t('Le délai de réponse est court'));
  if ((counts?.views.newsletters ?? 0) > 2) {
    steps.push({ key: 'subs', to: '/subscriptions', icon: <Unsubscribe className="size-4" />, title: t('Vous désinscrire des newsletters que vous ne lisez plus'), hint: t('En un clic par expéditeur, ZMail s’occupe du lien') });
  }

  return (
    <div className="scrollbar-none h-full overflow-y-auto">
      <div data-drag-region className="h-12" />
      <div className="mx-auto max-w-[620px] px-8 pt-4 pb-12">
        <p className="text-muted-foreground text-[13px] first-letter:uppercase">{new Intl.DateTimeFormat(intlLocale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</p>
        <h2 className="mt-1 text-[26px] font-semibold tracking-tight">{greeting} 👋</h2>

        {savings ? <Kpis savings={savings} /> : null}
        {shown ? <ReplyCockpit runId={shown} onClose={close} /> : left ? <RemainingCard left={left} onStarted={setRunId} /> : null}

        {steps.length ? (
          <section className="mt-8">
            <h3 className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wide uppercase">{t('Ensuite, ce qui compte pour vous')}</h3>
            <div className="border-border divide-border divide-y overflow-hidden rounded-xl border">
              {steps.slice(0, 4).map((s) => (
                <Link key={s.key} to={s.to} className="group hover:bg-accent/50 flex items-center gap-3 px-3.5 py-3 transition-colors">
                  <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">{s.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{s.title}</span>
                    <span className="text-muted-foreground block truncate text-[12px]">{s.hint}</span>
                  </span>
                  <ChevronRight className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {notifications?.length ? (
          <section className="mt-8">
            <h3 className="text-muted-foreground mb-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase">
              <Bell className="size-3" /> {t('Dernières alertes')}
            </h3>
            <div className="space-y-0.5">
              {notifications.slice(0, 3).map((n) => (
                <Link
                  key={n.id}
                  to={n.threadId?.startsWith('agent:') ? `?agent=${n.threadId.slice(6)}` : n.threadId ? `?thread=${n.threadId}` : '#'}
                  className="flex items-start gap-3 rounded-lg px-3 py-2 transition hover:bg-accent"
                >
                  <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', n.read ? 'bg-muted-foreground/40' : 'bg-primary')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{n.title}</span>
                    <span className="text-muted-foreground block truncate text-[12px]">{n.body}</span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-[11px]">{formatListDate(n.at)}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {status?.apple?.guidance && status.apple.guidance.cause !== 'browser' ? (
          <Link to="/settings/ai" className="text-warning mt-6 block text-[12px] underline-offset-2 hover:underline">
            {t('Apple Intelligence indisponible : {reason}', { reason: status.apple.guidance.title.charAt(0).toLowerCase() + status.apple.guidance.title.slice(1) })}
          </Link>
        ) : null}

        <SuiteBanner />
      </div>
    </div>
  );
}

type Savings = Outputs['cleanup']['savings'];

/** What ZMail has done so far, as big plain numbers. */
function Kpis({ savings }: { savings: Savings }) {
  const tiles = [
    { n: savings.sorted, label: t('mails triés'), tone: 'text-foreground' },
    { n: savings.spam, label: t('spams bloqués'), tone: 'text-destructive' },
    { n: savings.otp, label: t('codes repérés'), tone: 'text-primary' },
    { n: savings.unsubscribed, label: t('désinscriptions'), tone: 'text-warning' },
    { n: savings.replied, label: t('réponses envoyées'), tone: 'text-ai' },
    { n: savings.tidied, label: t('rangés par l’IA'), tone: 'text-success' },
    { n: savings.shortcuts, label: t('raccourcis ⌘K et @'), tone: 'text-primary' },
  ].filter((f, i) => i === 0 || f.n > 0);
  const minutes = Math.round(savings.seconds / 60);
  return (
    <section className="mt-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiles.map((f) => (
          <div key={f.label} className="border-border bg-card rounded-xl border px-3.5 py-3">
            <p className={cn('text-[28px] leading-none font-semibold tracking-tight tabular-nums', f.tone)}>{num(f.n)}</p>
            <p className="text-muted-foreground mt-1.5 text-[12px]">{f.label}</p>
          </div>
        ))}
      </div>
      {minutes > 0 ? (
        <p className="text-muted-foreground mt-2 flex items-center gap-1 text-[11.5px]">
          {t('Environ {duration} de tri évitées', { duration: formatDuration(savings.seconds) })}
          <InfoHint>{t('Estimation prudente : 4 s par mail trié, 8 s par spam, 20 s par code, 1 min 30 par désinscription et par réponse, 6 s par mail rangé, 12 s par raccourci (filtre ou mention par Tab, @agent depuis ⌘K).')}</InfoHint>
        </p>
      ) : null}
    </section>
  );
}

type Remaining = Outputs['cleanup']['remaining'];

/**
 * What is left, split by who should handle it, each part summed up by the AI in one sentence,
 * and the one button that sorts and drafts the replies.
 */
function RemainingCard({ left, onStarted }: { left: Remaining; onStarted: (runId: string) => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { spaceId: cleanSpace } = useSpaces();
  const { data: recap, isLoading } = useQuery({ ...trpc.cleanup.recap.queryOptions({ spaceId: cleanSpace }), enabled: left.unread > 0, staleTime: 5 * 60_000 });
  const start = useMutation(
    trpc.cleanup.start.mutationOptions({
      onSuccess: (run) => {
        onStarted(run.id);
        void queryClient.invalidateQueries();
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  // ⌘↵ anywhere on the overview starts it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !start.isPending && left.unread > 0 && !(e.target as HTMLElement).closest('input, textarea, [contenteditable]')) start.mutate({ notify: false, spaceId: cleanSpace });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start, left.unread]);

  if (left.unread === 0) {
    return (
      <section className="border-border mt-3 rounded-2xl border p-5 text-center">
        <p className="text-[28px]">🎉</p>
        <p className="mt-1 text-[15px] font-semibold">{t('Inbox zéro')}</p>
        <p className="text-muted-foreground text-[13px]">{t('Plus rien à trier. Profitez de votre deep work.')}</p>
      </section>
    );
  }
  const parts = [
    { key: 'tidy' as const, n: left.tidy, label: t('que l’IA range seule'), color: 'bg-success' },
    { key: 'ask' as const, n: left.ask, label: t('sur lesquels elle vous demandera'), color: 'bg-warning' },
    { key: 'mine' as const, n: left.mine, label: t('qui ont besoin de vous'), color: 'bg-primary' },
  ];
  return (
    <section className="border-border mt-3 rounded-2xl border p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[15px] font-semibold">{tp(left.unread, 'Il vous reste {n} mail non lu', 'Il vous reste {n} mails non lus')}</p>
        <p className="text-muted-foreground shrink-0 text-[12px]">{t('≈ {duration} à la main', { duration: formatDuration(left.manualSeconds) })}</p>
      </div>
      <div className="bg-muted mt-3 flex h-2 overflow-hidden rounded-full" aria-hidden>
        {parts.map((p) => (p.n ? <span key={p.key} className={cn('h-full transition-all', p.color)} style={{ width: `${(p.n / left.unread) * 100}%` }} /> : null))}
      </div>
      <ul className="mt-3.5 space-y-2.5">
        {parts
          .filter((p) => p.n > 0)
          .map((p) => (
            <li key={p.key} className="flex gap-2.5 text-[13px]">
              <span className={cn('mt-[7px] size-2 shrink-0 rounded-full', p.color)} />
              <span className="min-w-0">
                <span className="font-semibold tabular-nums">{num(p.n)}</span> {p.label}
                {recap?.[p.key] ? (
                  <span className="text-muted-foreground block text-[12.5px] leading-snug">{recap[p.key]}</span>
                ) : isLoading ? (
                  <span className="bg-muted mt-1 block h-3 w-3/4 animate-pulse rounded" />
                ) : null}
              </span>
            </li>
          ))}
      </ul>
      <button
        type="button"
        disabled={start.isPending}
        onClick={() => start.mutate({ notify: false, spaceId: cleanSpace })}
        className="group bg-foreground text-background hover:bg-foreground/90 mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[14px] font-semibold shadow-sm transition-colors disabled:opacity-70"
      >
        {start.isPending ? <Loader2 className="size-4.5 animate-spin" /> : <SolarIcon name="_ai" className="size-4.5" />}
        {start.isPending ? t('Tri et rédaction en cours…') : t('Trier et répondre avec l’IA')}
        {start.isPending ? null : <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />}
      </button>
      <p className="text-muted-foreground mt-2 text-center text-[11.5px]">{t('Elle range ce qui est sûr, rédige vos réponses et vous les présente une par une. Rien ne part sans vous, tout s’annule.')}</p>
    </section>
  );
}
