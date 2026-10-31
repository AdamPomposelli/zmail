import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Check, ChevronRight, Inbox, Loader2, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { SolarIcon } from '@/components/ui/solar-icon';
import { useTRPC, type Outputs } from '@/lib/trpc';
import { useSpaces } from '@/hooks/use-space';
import { cn, formatListDate } from '@/lib/utils';
import { formatDuration } from '@/lib/savings';
import { t, tp } from '@/lib/i18n';

type Run = NonNullable<Outputs['cleanup']['run']>;
type Question = Run['questions'][number];

const DECISIONS = [
  { id: 'archive' as const, label: t('Archiver'), icon: Archive },
  { id: 'keep' as const, label: t('Garder'), icon: Inbox },
  { id: 'trash' as const, label: t('Supprimer'), icon: Trash2 },
];

/**
 * A run of the inbox cleaning agent, in its own chat tab: what it tidied (undoable), what it
 * leaves to the user, and the mails it is unsure about — one tap each, with the option to make
 * the answer a habit or to give it context in plain words.
 */
export function CleanupView({ runId, onStarted }: { runId: string | null; onStarted: (runId: string) => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { spaceId } = useSpaces();
  const start = useMutation(trpc.cleanup.start.mutationOptions());
  const started = useRef(false);
  const remaining = useQuery({ ...trpc.cleanup.remaining.queryOptions({ spaceId }), enabled: !runId });

  useEffect(() => {
    if (runId || started.current) return;
    started.current = true;
    start.mutate({ spaceId }, {
      onSuccess: (run) => {
        onStarted(run.id);
        void queryClient.invalidateQueries();
      },
      onError: (error) => toast.error(error.message),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const { data: run } = useQuery({ ...trpc.cleanup.run.queryOptions({ id: runId ?? '' }), enabled: Boolean(runId) });

  if (!runId || !run) {
    return (
      <div className="flex flex-col items-center px-6 pt-16 text-center">
        <span className="bg-ai/10 text-ai relative mb-4 flex size-12 items-center justify-center rounded-2xl">
          <SolarIcon name="_ai" className="size-6 animate-pulse" />
        </span>
        <p className="text-[14px] font-semibold">{t('Je trie votre boîte de réception…')}</p>
        <p className="text-muted-foreground mt-1 text-[12.5px]">
          {remaining.data ? tp(remaining.data.unread, '{n} mail non lu à passer en revue.', '{n} mails non lus à passer en revue.') : t('Je passe en revue vos mails non lus.')} {t('Je range ce qui est sûr et je vous demande pour le reste.')}
        </p>
        <Loader2 className="text-muted-foreground mt-5 size-4 animate-spin" />
      </div>
    );
  }
  return <RunReport run={run} />;
}

function RunReport({ run }: { run: Run }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const undo = useMutation(trpc.cleanup.undo.mutationOptions());
  const [showTidied, setShowTidied] = useState(false);
  const open = run.questions.filter((q) => !q.resolved);
  const saved = run.tidied.length * 25;

  const refresh = () => void queryClient.invalidateQueries();

  return (
    <div className="space-y-4">
      <section className="border-success/25 bg-success/[0.06] rounded-xl border p-3.5">
        <div className="flex items-start gap-3">
          <span className="bg-success/15 text-success flex size-8 shrink-0 items-center justify-center rounded-lg">
            <Check className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold">{run.undone ? t('Tri annulé') : run.tidied.length ? tp(run.tidied.length, '{n} mail rangé pour vous', '{n} mails rangés pour vous') : t('Rien à ranger automatiquement')}</p>
            <p className="text-muted-foreground text-[12px]">
              {run.undone
                ? t('Ils sont revenus dans votre boîte, non lus.')
                : run.tidied.length
                  ? t('Archivés et marqués lus, rien n’est supprimé · ≈ {duration} gagnées', { duration: formatDuration(saved) })
                  : t('Tout ce qui reste mérite votre regard.')}
            </p>
          </div>
          {run.tidied.length && !run.undone ? (
            <button
              type="button"
              onClick={() => undo.mutate({ runId: run.id }, { onSuccess: () => (refresh(), toast(t('Tri annulé : les mails sont revenus.'))) })}
              disabled={undo.isPending}
              className="text-muted-foreground hover:text-foreground hover:bg-accent flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[12px]"
            >
              <Undo2 className="size-3.5" /> {t('Annuler|undo')}
            </button>
          ) : null}
        </div>
        {run.tidied.length ? (
          <>
            <button type="button" onClick={() => setShowTidied(!showTidied)} className="text-muted-foreground hover:text-foreground mt-2 flex items-center gap-1 text-[12px]">
              <ChevronRight className={cn('size-3 transition-transform', showTidied && 'rotate-90')} /> {t('Voir le détail')}
            </button>
            {showTidied ? (
              <ul className="mt-1.5 space-y-1">
                {run.tidied.map((t) => (
                  <li key={t.threadId} className="flex items-baseline gap-2 text-[12px]">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{t.from}</span> <span className="text-muted-foreground">· {t.subject}</span>
                    </span>
                    <span className="text-muted-foreground shrink-0 text-[11px]">{t.reason}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </section>

      {run.questions.length ? (
        <section>
          <h4 className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold">
            {open.length ? <span className="bg-primary size-2 rounded-full" /> : null}
            {open.length ? tp(open.length, 'J’ai besoin de vous pour {n} mail', 'J’ai besoin de vous pour {n} mails') : t('Tout est réglé, merci !')}
          </h4>
          <div className="space-y-2">
            {run.questions.map((q) => (
              <QuestionCard key={q.threadId} runId={run.id} question={q} onDone={refresh} />
            ))}
          </div>
        </section>
      ) : null}

      {run.mine.length ? (
        <section>
          <h4 className="mb-1.5 text-[12.5px] font-semibold">{t('Je vous laisse ceux-là ({n})', { n: run.mine.length })}</h4>
          <p className="text-muted-foreground mb-2 text-[12px]">{t('Ils comptent : réponse attendue, opportunité ou mail important.')}</p>
          <div className="border-border overflow-hidden rounded-xl border">
            {run.mine.map((m) => (
              <button
                key={m.threadId}
                type="button"
                onClick={() => navigate(`/mail/inbox?thread=${m.threadId}`)}
                className="border-border hover:bg-accent flex w-full items-center gap-2 border-b px-3 py-2 text-left last:border-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium">{m.from}</span>
                  <span className="text-muted-foreground block truncate text-[12px]">{m.subject}</span>
                </span>
                <span className="text-muted-foreground shrink-0 text-[11px]">{formatListDate(m.date)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function QuestionCard({ runId, question, onDone }: { runId: string; question: Question; onDone: () => void }) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const resolve = useMutation(trpc.cleanup.resolve.mutationOptions());
  const [remember, setRemember] = useState(false);
  const [context, setContext] = useState('');
  const [note, setNote] = useState('');

  const decide = (decision: Question['proposal']) =>
    resolve.mutate(
      { runId, threadId: question.threadId, decision, remember, context: context.trim() || undefined },
      { onSuccess: (r) => (setNote(r.note), onDone()), onError: (e) => toast.error(e.message) },
    );

  if (question.resolved) {
    const done = DECISIONS.find((d) => d.id === question.resolved)!;
    return (
      <div className="border-border flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px]">
        <Check className="text-success size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{question.from}</span> <span className="text-muted-foreground">· {done.id === 'keep' ? t('gardé') : done.id === 'archive' ? t('archivé') : t('supprimé')}</span>
        </span>
        {note ? <span className="text-muted-foreground max-w-[55%] truncate" title={note}>{note}</span> : null}
      </div>
    );
  }
  return (
    <div className="border-border bg-card rounded-xl border p-3">
      <button type="button" onClick={() => navigate(`/mail/inbox?thread=${question.threadId}`)} className="block w-full text-left">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-semibold">{question.from}</span>
          <span className="text-muted-foreground ml-auto shrink-0 text-[11px]">{formatListDate(question.date)}</span>
        </span>
        <span className="block truncate text-[12.5px]">{question.subject}</span>
        <span className="text-muted-foreground mt-0.5 line-clamp-2 block text-[12px]">{question.summary}</span>
      </button>
      <p className="text-ai mt-2 flex items-center gap-1 text-[11.5px]">
        <SolarIcon name="_ai" className="size-3" /> {question.reason}
      </p>
      <div className="mt-2.5 flex gap-1.5">
        {DECISIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            disabled={resolve.isPending}
            onClick={() => decide(id)}
            className={cn(
              'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-medium transition-colors disabled:opacity-50',
              id === question.proposal ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border-border hover:bg-accent border',
            )}
            title={id === question.proposal ? t('Ce que je propose') : undefined}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>
      <label className="text-muted-foreground mt-2 flex items-center gap-1.5 text-[11.5px]">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-primary size-3.5" />
        {t('Toujours faire ça pour cet expéditeur')}
      </label>
      <input
        value={context}
        onChange={(e) => setContext(e.target.value)}
        placeholder={t('Ou dites-moi quoi en faire, en vos mots…')}
        className="bg-muted placeholder:text-muted-foreground focus:ring-ring/50 mt-2 h-8 w-full rounded-lg px-2.5 text-[12px] outline-none focus:ring-1"
      />
    </div>
  );
}
