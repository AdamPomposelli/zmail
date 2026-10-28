import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Check, Inbox, Loader2, RefreshCw, Send, SkipForward, Trash2, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { SolarIcon } from '@/components/ui/solar-icon';
import { Textarea } from '@/components/ui/textarea';
import { useTRPC, type Outputs } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { num, t, tp } from '@/lib/i18n';

type Run = NonNullable<Outputs['cleanup']['run']>;
type Reply = NonNullable<Run['replies']>[number];

const DONE = new Set(['sent', 'skipped', 'archived']);

/**
 * « Trier et répondre », once the agent has sorted: one conversation at a time with the reply the
 * AI wrote, to send, rewrite, archive or skip without leaving the overview. Replies the AI is
 * unsure about, and the mails it has a question on, wait in « À vérifier » below.
 */
export function ReplyCockpit({ runId, onClose }: { runId: string; onClose: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: run } = useQuery({
    ...trpc.cleanup.run.queryOptions({ id: runId }),
    // Drafts are written in the background: poll until they are all there.
    refetchInterval: (q) => (q.state.data?.replies?.some((r) => r.status === 'drafting') ? 1500 : false),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.cleanup.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.mail.counts.queryKey() });
  };
  const reply = useMutation(trpc.cleanup.reply.mutationOptions({ onSuccess: refresh, onError: (e) => toast.error(e.message) }));
  const resolve = useMutation(trpc.cleanup.resolve.mutationOptions({ onSuccess: refresh, onError: (e) => toast.error(e.message) }));
  const undo = useMutation(
    trpc.cleanup.undo.mutationOptions({
      onSuccess: () => (refresh(), toast(t('Tri annulé : les mails sont revenus dans la boîte de réception'))),
      onError: (e) => toast.error(e.message),
    }),
  );

  const replies = run?.replies ?? [];
  const unsure = (r: Reply) => r.status === 'failed' || (r.status !== 'drafting' && !r.confident);
  const queue = replies.filter((r) => !unsure(r) || DONE.has(r.status));
  const review = replies.filter((r) => unsure(r) && !DONE.has(r.status));
  const questions = (run?.questions ?? []).filter((q) => !q.resolved);
  // The user can pull a mail from « À vérifier » into the cockpit.
  const [focus, setFocus] = useState<string | null>(null);
  const current = (focus ? replies.find((r) => r.threadId === focus && !DONE.has(r.status)) : null) ?? queue.find((r) => !DONE.has(r.status)) ?? null;
  const done = queue.filter((r) => DONE.has(r.status)).length;
  const sent = replies.filter((r) => r.status === 'sent').length;

  if (!run) {
    return (
      <section className="border-border mt-3 flex items-center justify-center gap-2 rounded-2xl border p-8 text-[13px]">
        <Loader2 className="size-4 animate-spin" /> {t('Je trie et je rédige vos réponses…')}
      </section>
    );
  }
  const finished = !current && review.length === 0 && questions.length === 0;

  return (
    <section className="border-ai/25 from-ai/[0.06] mt-3 rounded-2xl border bg-gradient-to-b to-transparent p-5">
      <div className="flex items-center gap-2">
        <span className="bg-ai/10 text-ai flex size-7 items-center justify-center rounded-lg">
          <SolarIcon name="_ai" className="size-4" />
        </span>
        <p className="min-w-0 flex-1 text-[13px]">
          <span className="font-semibold">{tp(run.tidied.length, '{n} mail rangé', '{n} mails rangés')}</span>
          <span className="text-muted-foreground"> · {tp(replies.length, '{n} réponse rédigée', '{n} réponses rédigées')}</span>
        </p>
        {run.tidied.length && !run.undone ? (
          <button type="button" onClick={() => undo.mutate({ runId })} className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[12px]" title={t('Remettre les mails rangés dans la boîte de réception')}>
            <Undo2 className="size-3.5" /> {t('Annuler le tri')}
          </button>
        ) : null}
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground -mr-1 rounded p-1" aria-label={t('Fermer')}>
          <X className="size-4" />
        </button>
      </div>

      {queue.length ? (
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-[12px]">
            <span className="font-medium">{t('Réponses')}</span>
            <span className="text-muted-foreground tabular-nums">{t('{done} sur {total}', { done: num(done), total: num(queue.length) })}</span>
          </div>
          <div className="bg-muted mt-1.5 flex h-2 overflow-hidden rounded-full">
            <span className="bg-ai h-full rounded-full transition-all duration-500" style={{ width: `${(done / queue.length) * 100}%` }} />
          </div>
        </div>
      ) : null}

      {current ? (
        <ReplyCard key={current.threadId} item={current} busy={reply.isPending && reply.variables?.threadId === current.threadId} onAction={(action, text, instruction) => reply.mutate({ runId, threadId: current.threadId, action, text, instruction }, { onSuccess: () => action !== 'rewrite' && setFocus(null) })} />
      ) : finished ? (
        <div className="py-6 text-center">
          <p className="text-[30px]">🎉</p>
          <p className="mt-1 text-[15px] font-semibold">{t('Tout est traité')}</p>
          <p className="text-muted-foreground text-[13px]">{tp(sent, '{n} réponse envoyée.', '{n} réponses envoyées.')} {t('Votre boîte est à jour.')}</p>
          <button type="button" onClick={onClose} className="bg-foreground text-background hover:bg-foreground/90 mt-4 h-9 rounded-lg px-4 text-[13px] font-semibold">
            {t('Terminer')}
          </button>
        </div>
      ) : queue.length ? (
        <p className="text-muted-foreground mt-4 flex items-center gap-1.5 text-[13px]">
          <Check className="text-success size-4" /> {t('Plus de réponse sûre à valider. Il reste ce qui est à vérifier, juste en dessous.')}
        </p>
      ) : (
        <p className="text-muted-foreground mt-4 text-[13px]">{t('Aucune conversation n’attend de réponse. Il reste ce qui est à vérifier, juste en dessous.')}</p>
      )}

      {review.length || questions.length ? (
        <div className="mt-5">
          <h4 className="text-warning mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase">
            <span className="bg-warning size-1.5 rounded-full" />
            {t('À vérifier')} · {num(review.length + questions.length)}
          </h4>
          <div className="border-border divide-border divide-y overflow-hidden rounded-xl border bg-background/60">
            {review.map((r) => (
              <button key={r.threadId} type="button" onClick={() => setFocus(r.threadId)} className={cn('hover:bg-accent/50 flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition-colors', current?.threadId === r.threadId && 'bg-accent/60')}>
                <Send className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    {r.from} <span className="text-muted-foreground font-normal">· {r.subject}</span>
                  </span>
                  <span className="text-warning block truncate text-[12px]">{r.reason || t('Réponse à relire avant l’envoi')}</span>
                </span>
                <span className="text-muted-foreground shrink-0 text-[11.5px]">{t('Relire')}</span>
              </button>
            ))}
            {questions.map((q) => (
              <div key={q.threadId} className="flex items-start gap-3 px-3.5 py-2.5">
                <Inbox className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                <Link to={`?thread=${q.threadId}`} className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium hover:underline">
                    {q.from} <span className="text-muted-foreground font-normal">· {q.subject}</span>
                  </span>
                  <span className="text-muted-foreground block truncate text-[12px]">{q.reason}</span>
                </Link>
                <span className="flex shrink-0 gap-1">
                  {(
                    [
                      { id: 'archive', icon: Archive, label: t('Archiver') },
                      { id: 'keep', icon: Inbox, label: t('Garder') },
                      { id: 'trash', icon: Trash2, label: t('Supprimer') },
                    ] as const
                  ).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      title={d.label}
                      aria-label={d.label}
                      disabled={resolve.isPending}
                      onClick={() => resolve.mutate({ runId, threadId: q.threadId, decision: d.id })}
                      className={cn('hover:bg-accent flex size-7 items-center justify-center rounded-md ring-1 ring-border', q.proposal === d.id && 'ring-primary/50 text-primary')}
                    >
                      <d.icon className="size-3.5" />
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** One conversation and its draft: the four decisions, ⌘↵ to send. */
function ReplyCard({ item, busy, onAction }: { item: Reply; busy: boolean; onAction: (action: 'send' | 'rewrite' | 'skip' | 'archive', text?: string, instruction?: string) => void }) {
  const [text, setText] = useState(item.draft ?? '');
  const [rewriting, setRewriting] = useState(false);
  const [instruction, setInstruction] = useState('');
  // A new draft (written in the background, or rewritten) replaces the text.
  useEffect(() => setText(item.draft ?? ''), [item.draft]);
  const drafting = item.status === 'drafting';
  const disabled = busy || drafting;
  const send = () => text.trim() && !disabled && onAction('send', text);
  const words = useMemo(() => text.trim().split(/\s+/).filter(Boolean).length, [text]);

  return (
    <div className="animate-in fade-in slide-in-from-right-4 bg-background mt-4 rounded-xl border border-border p-4 shadow-sm duration-300">
      <Link to={`?thread=${item.threadId}`} className="group block">
        <p className="truncate text-[13.5px] font-semibold group-hover:underline">{item.from}</p>
        <p className="truncate text-[13px]">{item.subject}</p>
        {item.summary ? <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[12px]">{item.summary}</p> : null}
      </Link>
      <div className="relative mt-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), send());
          }}
          disabled={drafting}
          placeholder={drafting ? t('L’IA rédige la réponse…') : t('Votre réponse')}
          className="min-h-[120px] text-[13px] leading-relaxed"
        />
        {drafting ? <Loader2 className="text-ai absolute top-3 right-3 size-4 animate-spin" /> : null}
      </div>
      {item.reason && !drafting ? <p className={cn('mt-1.5 text-[11.5px]', item.confident && item.status !== 'failed' ? 'text-muted-foreground' : 'text-warning')}>{item.reason}</p> : null}

      {rewriting ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onAction('rewrite', text, instruction.trim() || undefined);
            setRewriting(false);
            setInstruction('');
          }}
        >
          <input
            autoFocus
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setRewriting(false)}
            placeholder={t('Ex. : plus court, accepte pour mardi, tutoie-le…')}
            className="border-border bg-background focus:ring-ring h-8 min-w-0 flex-1 rounded-md border px-2.5 text-[12.5px] outline-none focus:ring-2"
          />
          <button type="submit" className="bg-ai text-white h-8 shrink-0 rounded-md px-3 text-[12.5px] font-medium">
            {t('Réécrire')}
          </button>
        </form>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={send} disabled={disabled || !text.trim()} className="bg-foreground text-background hover:bg-foreground/90 flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold disabled:opacity-50">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          {t('Envoyer')}
          <kbd className="text-background/60 ml-0.5 text-[10.5px]">⌘↵</kbd>
        </button>
        <button type="button" onClick={() => setRewriting((v) => !v)} disabled={disabled} className="hover:bg-accent flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] ring-1 ring-border disabled:opacity-50">
          <RefreshCw className="size-3.5" /> {t('Réécrire')}
        </button>
        <button type="button" onClick={() => onAction('archive')} disabled={busy} className="hover:bg-accent flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] ring-1 ring-border disabled:opacity-50" title={t('Archiver sans répondre')}>
          <Archive className="size-3.5" /> {t('Sans réponse')}
        </button>
        <button type="button" onClick={() => onAction('skip')} disabled={busy} className="text-muted-foreground hover:text-foreground ml-auto flex h-9 items-center gap-1.5 px-2 text-[12.5px]" title={t('Garder dans la boîte de réception pour plus tard')}>
          <SkipForward className="size-3.5" /> {t('Plus tard')}
        </button>
      </div>
      {words ? <p className="text-muted-foreground/70 mt-2 text-right text-[10.5px] tabular-nums">{tp(words, '{n} mot', '{n} mots')}</p> : null}
    </div>
  );
}
