import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, ArrowLeft, BellOff, ChevronDown, MailCheck, MailMinus, ShieldCheck, ShieldX, Star, Tag, Trash2, Loader2, type LucideIcon } from 'lucide-react';
import { EmailBody } from '@/components/mail/email-body';
import { cn, formatListDate } from '@/lib/utils';
import { useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { describeCondition, describeRuleAction } from '@/lib/rules';
import { useSpaces } from '@/hooks/use-space';
import { useTRPC } from '@/lib/trpc';
import { t, tp } from '@/lib/i18n';

/** The icon of what the rule will do: the dialog says it before reading a word. */
const ACTION_ICONS: Record<string, LucideIcon> = { trash: Trash2, archive: Archive, spam: ShieldX, markRead: MailCheck, star: Star, addTag: Tag, unsubscribe: BellOff };
/** Exceptions the engine adds to every rule that makes mail disappear (finance, disputes, codes…). */
const isGuard = (c: { field: string; op: string }) => (c.field === 'tag' || c.field === 'otp') && c.op === 'isNot';

/**
 * When the engine spots a repeated action, it proposes a rule. This modal asks, one
 * suggestion at a time: “from now on, should these mails be handled automatically?”
 */
export function SuggestionModal() {
  const { spaces } = useSpaces();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: folders } = useQuery(trpc.accounts.folders.queryOptions());
  const { data: suggestions } = useQuery({ ...trpc.rules.suggestions.queryOptions(), refetchInterval: 30_000 });
  const [applyExisting, setApplyExisting] = useState(true);
  const [hidden, setHidden] = useState<string[]>([]);
  const [showMails, setShowMails] = useState<boolean | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const suggestion = suggestions?.find((s) => !hidden.includes(s.id));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.rules.suggestions.queryKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.rules.list.queryKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.mail.list.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.mail.counts.queryKey() });
  };
  const accept = useMutation(
    trpc.rules.acceptSuggestion.mutationOptions({
      onSuccess: ({ rule, applied }) => {
        toast.success(t('Règle « {name} » activée', { name: rule.name }), { description: applied ? tp(applied, 'Appliquée à {n} conversation existante.', 'Appliquée à {n} conversations existantes.') : t('Elle s’appliquera aux prochains mails.') });
        invalidate();
      },
    }),
  );
  const dismiss = useMutation(trpc.rules.dismissSuggestion.mutationOptions({ onSuccess: invalidate }));

  if (!suggestion) return null;
  const close = (forever: boolean) => {
    setHidden((h) => [...h, suggestion.id]);
    dismiss.mutate({ id: suggestion.id, forever });
  };

  const main = suggestion.rule.actions.find((a) => a.type !== 'unsubscribe') ?? suggestion.rule.actions[0];
  const Icon = ACTION_ICONS[main?.type ?? ''] ?? MailMinus;
  const [seen, ...checked] = suggestion.description.split('\n');
  const conditions = suggestion.rule.conditions.filter((c) => !isGuard(c));
  const guarded = suggestion.rule.conditions.some(isGuard);
  // Unsubscribing happens on the sender's site: ZMail cannot subscribe you back. Deleting and
  // spam are hard to notice once done. For those, the mails are shown before deciding.
  const unsubscribes = suggestion.rule.actions.some((a) => a.type === 'unsubscribe');
  const critical = unsubscribes || suggestion.rule.actions.some((a) => a.type === 'trash' || a.type === 'spam');
  const mailsOpen = showMails ?? critical;

  return (
    <Dialog open onOpenChange={(open) => !open && close(false)}>
      <DialogContent className={cn('max-h-[90vh] gap-0 overflow-y-auto p-0 transition-[max-width]', reading ? 'max-w-[640px]' : 'max-w-[480px]')} showOverlay>
        <div className="px-6 pt-6 pb-5">
          <div className="flex items-start gap-3.5">
            <span className="bg-muted text-foreground ring-border flex size-10 shrink-0 items-center justify-center rounded-xl ring-1">
              <Icon className="size-[18px]" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="text-muted-foreground text-[12px] font-medium">{t('Habitude repérée')}</p>
              <DialogTitle className="mt-0.5 text-[16.5px] leading-snug font-semibold tracking-tight">{suggestion.title}</DialogTitle>
            </div>
          </div>
          <DialogDescription className="text-muted-foreground mt-3 mb-0 text-[13.5px] leading-relaxed">{seen}</DialogDescription>
          {checked.length ? (
            <p className="text-success mt-3 flex items-start gap-2 text-[12.5px] leading-relaxed">
              <ShieldCheck className="mt-px size-4 shrink-0" strokeWidth={1.75} />
              <span>{checked.join(' ')}</span>
            </p>
          ) : null}
        </div>

        <div className="space-y-3 px-6 pb-5">
          <div className="border-border rounded-xl border px-4 py-3 text-[13px] leading-relaxed">
            <p>
              <span className="text-muted-foreground">{t('Si')} </span>
              {conditions.slice(0, 3).map((c) => describeCondition(c)).join(suggestion.rule.match === 'any' ? ` ${t('ou')} ` : ` ${t('et')} `)}
              {conditions.length > 3 ? ` (+${conditions.length - 3})` : ''}
            </p>
            <p>
              <span className="text-muted-foreground">{t('alors')} </span>
              {suggestion.rule.actions.map((a) => describeRuleAction(a, { space: (id) => spaces.find((sp) => sp.id === id)?.name, folder: (id) => folders?.find((f) => f.id === id)?.path })).join(`, ${t('puis')} `)}
            </p>
            {guarded ? <p className="text-muted-foreground mt-1.5 text-[12px]">{t('Jamais pour une facture, un litige, un code ou un mail important.')}</p> : null}
          </div>
          {unsubscribes ? (
            <p className="text-warning flex items-start gap-2 text-[12.5px] leading-relaxed">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {t('La désinscription se fait sur le site de l’expéditeur : ZMail ne pourra pas vous réabonner. Regardez un mail avant de décider.')}
            </p>
          ) : null}
          <SampleMails suggestionId={suggestion.id} open={mailsOpen} onToggle={() => (setShowMails(!mailsOpen), setReading(null))} reading={reading} onRead={setReading} />
          {suggestion.matching > 0 ? (
            <label className="flex items-center justify-between gap-3 text-[13px]">
              <span>
                {/* {b} marks where the bold count goes. */}
                {tp(suggestion.matching, 'L’appliquer aussi aux {b} conversation déjà dans la boîte', 'L’appliquer aussi aux {b} conversations déjà dans la boîte')
                  .split('{b}')
                  .map((part, i) => (i ? [<b key="n">{suggestion.matching}</b>, part] : part))}
              </span>
              <Switch checked={applyExisting} onCheckedChange={setApplyExisting} />
            </label>
          ) : null}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-6 py-3.5">
          <button onClick={() => close(true)} className="text-muted-foreground hover:text-foreground text-[13px]">
            {t('Jamais')}
          </button>
          <button onClick={() => close(false)} className="text-muted-foreground hover:text-foreground ml-3 text-[13px]">
            {t('Plus tard')}
          </button>
          <button
            onClick={() => {
              setHidden((h) => [...h, suggestion.id]);
              accept.mutate({ id: suggestion.id, applyToExisting: applyExisting });
            }}
            disabled={accept.isPending}
            className="bg-foreground text-background hover:bg-foreground/90 ml-auto flex h-9 items-center gap-2 rounded-lg px-4 text-[13px] font-medium shadow-sm transition"
          >
            {accept.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('Oui, automatiser')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The mails the rule would act on: who, what, when; one click shows a mail in full, right here,
 * so the decision is made knowing what it is about (images stay blocked, nothing is marked read).
 */
function SampleMails({ suggestionId, open, onToggle, reading, onRead }: { suggestionId: string; open: boolean; onToggle: () => void; reading: string | null; onRead: (id: string | null) => void }) {
  const trpc = useTRPC();
  const { data: mails, isLoading } = useQuery({ ...trpc.rules.suggestionSamples.queryOptions({ id: suggestionId }), enabled: open });
  return (
    <div className="border-border overflow-hidden rounded-xl border">
      <button type="button" onClick={onToggle} className="hover:bg-accent/40 flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] font-medium">
        {t('Voir les mails concernés')}
        <ChevronDown className={cn('text-muted-foreground ml-auto size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        reading ? (
          <MailPreview threadId={reading} onBack={() => onRead(null)} />
        ) : isLoading ? (
          <p className="text-muted-foreground flex items-center gap-2 px-4 pb-3 text-[12.5px]">
            <Loader2 className="size-3.5 animate-spin" /> {t('Chargement…')}
          </p>
        ) : mails?.length ? (
          <ul className="divide-border border-border max-h-60 divide-y overflow-y-auto border-t">
            {mails.map((m) => (
              <li key={m.threadId}>
                <button type="button" onClick={() => onRead(m.threadId)} className="hover:bg-accent/50 flex w-full items-start gap-3 px-4 py-2.5 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-[12.5px] font-medium">{m.from}</span>
                      <span className="text-muted-foreground ml-auto shrink-0 text-[11px] tabular-nums">{formatListDate(m.date)}</span>
                    </span>
                    <span className="block truncate text-[12.5px]">{m.subject || t('(sans objet)')}</span>
                    {m.summary ? <span className="text-muted-foreground block truncate text-[11.5px]">{m.summary}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground border-border border-t px-4 py-3 text-[12.5px]">{t('Aucun mail de cette source pour l’instant.')}</p>
        )
      ) : null}
    </div>
  );
}

function MailPreview({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  const trpc = useTRPC();
  const { data: thread } = useQuery(trpc.mail.thread.queryOptions({ id: threadId }));
  const message = thread?.messages.at(-1);
  return (
    <div className="border-border border-t">
      <div className="flex items-start gap-2 px-4 py-2.5">
        <button type="button" onClick={onBack} className="text-muted-foreground hover:text-foreground -ml-1 rounded p-1" aria-label={t('Retour à la liste')}>
          <ArrowLeft className="size-4" />
        </button>
        {message ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">{message.subject || t('(sans objet)')}</p>
            <p className="text-muted-foreground truncate text-[12px]">
              {message.from.name ? `${message.from.name} · ` : ''}
              {message.from.email}
            </p>
          </div>
        ) : (
          <Loader2 className="text-muted-foreground mt-1 size-4 animate-spin" />
        )}
      </div>
      {message ? (
        <div className="max-h-[42vh] overflow-y-auto px-2 pb-2">
          <EmailBody messageId={message.id} html={message.html} text={message.text} allowImages={false} />
        </div>
      ) : null}
    </div>
  );
}
