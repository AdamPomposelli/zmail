import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Sparkles, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { describeCondition, describeRuleAction } from '@/lib/rules';
import { useTRPC } from '@/lib/trpc';
import { t, tp } from '@/lib/i18n';

/**
 * When the engine spots a repeated action, it proposes a rule. This modal asks, one
 * suggestion at a time: “from now on, should these mails be handled automatically?”
 */
export function SuggestionModal() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: suggestions } = useQuery({ ...trpc.rules.suggestions.queryOptions(), refetchInterval: 30_000 });
  const [applyExisting, setApplyExisting] = useState(true);
  const [hidden, setHidden] = useState<string[]>([]);
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

  return (
    <Dialog open onOpenChange={(open) => !open && close(false)}>
      <DialogContent className="max-w-[460px] gap-0 overflow-hidden p-0" showOverlay>
        <div className="bg-ai/10 relative px-6 pt-6 pb-5">
          <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-ai/15 text-ai">
            <Wand2 className="size-5" />
          </div>
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-ai uppercase">
            <Sparkles className="size-3" /> {t('L’agent a repéré une habitude')}
          </p>
          <DialogTitle className="text-[17px] leading-snug font-semibold tracking-tight">{suggestion.title}</DialogTitle>
          <DialogDescription className="text-muted-foreground mt-2 mb-0 text-[13.5px] leading-relaxed">{suggestion.description}</DialogDescription>
        </div>

        <div className="space-y-3 px-6 py-4">
          <div className="rounded-lg bg-muted p-3 text-[13px]">
            <p className="text-muted-foreground mb-1 text-[11px] font-medium tracking-wide uppercase">{t('Règle proposée')}</p>
            <p>
              <span className="text-muted-foreground">{t('Si')} </span>
              {suggestion.rule.conditions.slice(0, 3).map((c) => describeCondition(c)).join(suggestion.rule.match === 'any' ? ` ${t('ou')} ` : ` ${t('et')} `)}
              {suggestion.rule.conditions.length > 3 ? ` (+${suggestion.rule.conditions.length - 3})` : ''}
            </p>
            <p>
              <span className="text-muted-foreground">{t('alors')} </span>
              {suggestion.rule.actions.map((a) => describeRuleAction(a)).join(`, ${t('puis')} `)}
            </p>
          </div>
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
            className="ml-auto flex h-9 items-center gap-2 rounded-lg bg-ai px-4 text-[13px] font-medium text-ai-foreground shadow-sm transition hover:bg-ai/90"
          >
            {accept.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('Oui, automatiser')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
