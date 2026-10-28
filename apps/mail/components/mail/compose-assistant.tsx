import { useMutation } from '@tanstack/react-query';
import { ArrowUp, Loader2, Mic, Square, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { SolarIcon } from '@/components/ui/solar-icon';
import { useDictation } from '@/hooks/use-dictation';
import { useTRPC, type Outputs } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

export type AssistDraft = Outputs['compose']['assist'];

/** After this much silence, a dictated instruction is sent on its own: talk, pause, done. */
const SILENCE_MS = 1800;

const EXAMPLES = [t('Réponds au dernier mail de Stripe que c’est réglé'), t('Écris à Claire de chez Acme et joins mon devis'), t('Envoie la facture de mars à la compta')];

/**
 * The composer's assistant: say (or type) what the mail should do — who it goes to, what it
 * answers, which files from the Mac to attach — and every field is filled, ready to review.
 */
export function ComposeAssistant({
  context,
  onDraft,
  onClose,
  autoListen,
}: {
  context: { accountId?: string | null; threadId?: string | null; draft: { to: string[]; cc: string[]; subject: string; body: string } };
  onDraft: (draft: AssistDraft) => Promise<void> | void;
  onClose: () => void;
  autoListen: boolean;
}) {
  const trpc = useTRPC();
  const dictation = useDictation();
  const assist = useMutation(trpc.compose.assist.mutationOptions());
  const input = useRef<HTMLTextAreaElement>(null);
  const lastChange = useRef(Date.now());

  const run = async (instruction = dictation.text) => {
    const text = instruction.trim();
    if (!text || assist.isPending) return;
    dictation.stop();
    try {
      const draft = await assist.mutateAsync({ instruction: text, accountId: context.accountId, threadId: context.threadId, draft: context.draft });
      await onDraft(draft);
      if (draft.note) toast(draft.note);
      dictation.setText('');
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  // Opening the assistant by its microphone starts listening straight away.
  useEffect(() => {
    if (autoListen && dictation.supported) dictation.start();
    else input.current?.focus();
    return () => dictation.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Talk, pause: it writes. Each new word restarts the countdown.
  useEffect(() => {
    lastChange.current = Date.now();
    if (!dictation.listening || !dictation.text.trim()) return;
    const id = setTimeout(() => Date.now() - lastChange.current >= SILENCE_MS && void run(), SILENCE_MS + 50);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictation.text, dictation.listening]);

  const busy = assist.isPending;
  // Five bars following the voice, tallest in the middle.
  const bars = [0.5, 0.8, 1, 0.8, 0.5].map((weight) => Math.min(1, 0.2 + dictation.level * weight));

  return (
    <div className="border-border bg-ai/[0.04] relative border-b px-4 py-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => (dictation.listening ? dictation.stop() : dictation.start(dictation.text))}
          disabled={!dictation.supported || busy}
          className={cn(
            'relative mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-40',
            dictation.listening ? 'bg-ai text-ai-foreground' : 'bg-ai/10 text-ai hover:bg-ai/20',
          )}
          aria-label={dictation.listening ? t('Arrêter la dictée') : t('Dicter')}
          title={dictation.supported ? (dictation.listening ? t('Arrêter la dictée') : t('Dicter')) : t('Dictée indisponible ici : écrivez la consigne')}
        >
          {dictation.listening ? (
            <>
              <span className="zm-mic-ring" style={{ '--level': dictation.level } as React.CSSProperties} aria-hidden />
              <Square className="size-3.5 fill-current" />
            </>
          ) : (
            <Mic className="size-4" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="text-ai mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase">
            <SolarIcon name="_ai" className="size-3.5" />
            {t('Assistant de rédaction')}
            {dictation.listening ? (
              <span className="ml-1 flex h-3 items-end gap-[2px]" aria-hidden>
                {bars.map((h, i) => (
                  <span key={i} className="bg-ai w-[3px] rounded-full transition-[height] duration-75" style={{ height: `${Math.round(h * 12)}px` }} />
                ))}
              </span>
            ) : null}
          </div>
          <textarea
            ref={input}
            value={dictation.text}
            onChange={(e) => dictation.setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), void run());
              if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), onClose());
            }}
            rows={2}
            placeholder={dictation.listening ? t('Je vous écoute…') : t('Dites ou écrivez ce que vous voulez envoyer. Ex. « {example} »', { example: EXAMPLES[Math.floor(Date.now() / 60000) % EXAMPLES.length]! })}
            className="placeholder:text-muted-foreground/80 w-full resize-none bg-transparent text-[13.5px] leading-relaxed outline-none"
            aria-label={t('Consigne pour l’assistant')}
          />
          {dictation.error ? <p className="text-destructive mt-1 text-[12px]">{dictation.error}</p> : null}
          {busy ? (
            <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-[12px]">
              <Loader2 className="size-3.5 animate-spin" />
              {t('Je cherche les destinataires, le mail concerné et vos documents, puis je rédige…')}
            </p>
          ) : (
            <p className="text-muted-foreground mt-1 text-[11.5px]">
              {t('Destinataires de vos contacts, réponse à un mail reçu, documents du Mac en pièce jointe.')} {dictation.listening ? t('Une courte pause et je rédige.') : t('Entrée pour rédiger.')}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void run()}
            disabled={!dictation.text.trim() || busy}
            className="bg-ai text-ai-foreground hover:bg-ai/90 flex size-8 items-center justify-center rounded-lg transition-colors disabled:opacity-30"
            aria-label={t('Rédiger')}
            title={t('Rédiger (Entrée)')}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </button>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-8 items-center justify-center rounded-lg" aria-label={t('Fermer l’assistant')}>
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
