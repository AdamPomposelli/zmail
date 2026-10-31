import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Play, Plus, Sparkles, Trash2, User, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, GhostButton, PrimaryButton, SettingsPage } from '@/components/settings/ui';
import { useCatalog } from '@/hooks/use-catalog';
import { useSpaces } from '@/hooks/use-space';
import { ACTION_LABELS, FIELD_LABELS, OP_LABELS, describeCondition, describeRuleAction } from '@/lib/rules';
import { useTRPC, type Rule } from '@/lib/trpc';
import { formatListDate } from '@/lib/utils';
import { t, tp } from '@/lib/i18n';

type Draft = Pick<Rule, 'name' | 'match' | 'conditions' | 'actions' | 'enabled'> & { id?: string };
type Condition = Rule['conditions'][number];
type Action = Rule['actions'][number];

const SOURCE = {
  user: { label: t('Vous'), icon: User },
  suggestion: { label: t('Suggestion'), icon: Sparkles },
  agent: { label: t('Agent'), icon: Bot },
} as const;

const PRIORITIES = [['3', t('Urgente')], ['2', t('Haute')], ['1', t('Normale')], ['0', t('Basse')]];

const OPS_FOR: Record<Condition['field'], Condition['op'][]> = {
  from: ['equals', 'contains', 'notContains'],
  fromDomain: ['equals', 'contains'],
  to: ['equals', 'contains'],
  subject: ['contains', 'notContains', 'equals'],
  body: ['contains', 'notContains'],
  tag: ['is', 'isNot'],
  business: ['is', 'isNot'],
  account: ['is', 'isNot'],
  listId: ['contains', 'equals'],
  newsletter: ['is'],
  opportunity: ['is'],
  otp: ['is'],
  priority: ['gte', 'is'],
};

export default function RulesSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const { data: rules } = useQuery(trpc.rules.list.queryOptions());
  const { data: suggestions } = useQuery(trpc.rules.allSuggestions.queryOptions());
  const [draft, setDraft] = useState<Draft | null>(null);
  const { spaces } = useSpaces();
  const folders = useFolderNames();
  const names = { tag: (id: string) => { const name = catalog.tagById.get(id)?.name; return name && t(name); }, business: (id: string) => catalog.businessById.get(id)?.name, space: (id: string) => spaces.find((sp) => sp.id === id)?.name, folder: (id: string) => folders.get(id) };
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.rules.list.queryKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.rules.allSuggestions.queryKey() });
  };
  const create = useMutation(trpc.rules.create.mutationOptions({ onSuccess: invalidate }));
  const update = useMutation(trpc.rules.update.mutationOptions({ onSuccess: invalidate }));
  const remove = useMutation(trpc.rules.remove.mutationOptions({ onSuccess: invalidate }));
  const applyNow = useMutation(trpc.rules.applyNow.mutationOptions({ onSuccess: (n) => toast.success(n ? tp(n, 'Appliquée à {n} conversation', 'Appliquée à {n} conversations') : t('Aucune conversation concernée')) }));

  const save = () => {
    if (!draft) return;
    const input = { name: draft.name.trim(), enabled: draft.enabled, match: draft.match, conditions: draft.conditions.filter((c) => c.value !== ''), actions: draft.actions };
    const done = { onSuccess: () => (setDraft(null), toast.success(t('Règle enregistrée'))), onError: (e: { message: string }) => toast.error(e.message) };
    if (draft.id) update.mutate({ id: draft.id, patch: input }, done);
    else create.mutate(input, done);
  };

  return (
    <SettingsPage
      title={t('Règles')}
      description={t('Appliquées à chaque nouveau mail, après le tri IA. Elles naissent de vos habitudes (suggestions), de l’agent, ou de vous.')}
      actions={
        <PrimaryButton onClick={() => setDraft({ name: '', enabled: true, match: 'all', conditions: [{ field: 'from', op: 'equals', value: '' }], actions: [{ type: 'archive' }] })}>
          <Plus className="size-4" />
          {t('Nouvelle règle')}
        </PrimaryButton>
      }
    >
      <Card>
        {rules?.length ? (
          <ul className="-my-1 divide-y divide-border">
            {rules.map((rule) => {
              const Source = SOURCE[rule.source].icon;
              return (
                <li key={rule.id} className="flex items-start gap-3 py-3">
                  <Switch className="mt-0.5" checked={rule.enabled} onCheckedChange={(enabled) => update.mutate({ id: rule.id, patch: { enabled } })} />
                  <button className="min-w-0 flex-1 text-left" onClick={() => setDraft({ ...rule })}>
                    <p className="flex items-center gap-2 text-[13.5px] font-medium">
                      {rule.name}
                      <span className="text-muted-foreground inline-flex items-center gap-1 bg-muted rounded-sm px-1.5 text-[10.5px] font-normal">
                        <Source className="size-2.5" />
                        {SOURCE[rule.source].label}
                      </span>
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-[12.5px] leading-relaxed">
                      {t('Si {conditions} → {actions}', {
                        conditions:
                          rule.conditions.slice(0, 3).map((c) => describeCondition(c, names)).join(rule.match === 'any' ? ` ${t('ou')} ` : ` ${t('et')} `) +
                          (rule.conditions.length > 3 ? ` (+${rule.conditions.length - 3})` : ''),
                        actions: rule.actions.map((a) => describeRuleAction(a, names)).join(', '),
                      })}
                    </p>
                    <p className="text-muted-foreground/70 mt-0.5 text-[11.5px]">
                      {rule.hits ? t('Appliquée {n} fois · dernière {date}', { n: rule.hits, date: formatListDate(rule.lastHitAt!) }) : t('Jamais appliquée pour l’instant')}
                    </p>
                  </button>
                  <GhostButton onClick={() => applyNow.mutate({ id: rule.id })} title={t('Appliquer aux mails déjà reçus')}>
                    <Play className="size-3.5" />
                  </GhostButton>
                  <GhostButton className="hover:text-destructive" onClick={() => window.confirm(t('Supprimer « {name} » ?', { name: rule.name })) && remove.mutate({ id: rule.id })}>
                    <Trash2 className="size-3.5" />
                  </GhostButton>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground py-6 text-center text-[13px]">{t('Aucune règle. Triez normalement : l’agent vous proposera des règles dès qu’il repère une habitude.')}</p>
        )}
      </Card>

      <Card title={t('Suggestions de l’agent')} description={t('Chaque action est journalisée. Quand un geste se répète (supprimer, archiver, marquer comme lu… le même expéditeur), l’agent propose une règle.')}>
        {suggestions?.length ? (
          <ul className="-my-1 divide-y divide-border">
            {suggestions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5 text-[13px]">
                <Sparkles className="text-ai size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <span
                  className={`rounded-sm px-1.5 text-[11px] ${s.status === 'accepted' ? 'bg-success/10 text-success' : s.status === 'pending' ? 'bg-ai/10 text-ai' : 'text-muted-foreground bg-muted'}`}
                >
                  {{ accepted: t('Acceptée'), pending: t('En attente'), dismissed: t('Refusée'), snoozed: t('Plus tard') }[s.status]}
                </span>
                <span className="text-muted-foreground w-16 shrink-0 text-right text-[11.5px]">{formatListDate(s.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-[13px]">{t('Pas encore de suggestion.')}</p>
        )}
      </Card>

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent showOverlay className="max-w-[640px]">
          <DialogTitle>{draft?.id ? t('Modifier la règle') : t('Nouvelle règle')}</DialogTitle>
          <DialogDescription>{t('Conditions évaluées sur chaque nouveau mail de la boîte de réception.')}</DialogDescription>
          {draft ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t('Nom')}</Label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('Archiver les reçus Uber')} />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[13px]">
                  {t('Si')}
                  <Select value={draft.match} onValueChange={(match) => setDraft({ ...draft, match: match as Draft['match'] })}>
                    <SelectTrigger className="h-7 w-auto gap-1.5 text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('toutes les conditions')}</SelectItem>
                      <SelectItem value="any">{t('au moins une condition')}</SelectItem>
                    </SelectContent>
                  </Select>
                  {t('sont remplies :')}
                </div>
                {draft.conditions.map((c, i) => (
                  <ConditionEditor
                    key={i}
                    condition={c}
                    onChange={(next) => setDraft({ ...draft, conditions: draft.conditions.map((x, j) => (j === i ? next : x)) })}
                    onRemove={draft.conditions.length > 1 ? () => setDraft({ ...draft, conditions: draft.conditions.filter((_, j) => j !== i) }) : undefined}
                  />
                ))}
                <button onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, { field: 'subject', op: 'contains', value: '' }] })} className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[12.5px]">
                  <Plus className="size-3.5" /> {t('Condition')}
                </button>
              </div>
              <div className="space-y-2">
                <p className="text-[13px]">{t('Alors :')}</p>
                {draft.actions.map((a, i) => (
                  <ActionEditor
                    key={i}
                    action={a}
                    onChange={(next) => setDraft({ ...draft, actions: draft.actions.map((x, j) => (j === i ? next : x)) })}
                    onRemove={draft.actions.length > 1 ? () => setDraft({ ...draft, actions: draft.actions.filter((_, j) => j !== i) }) : undefined}
                  />
                ))}
                <button onClick={() => setDraft({ ...draft, actions: [...draft.actions, { type: 'notify' }] })} className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[12.5px]">
                  <Plus className="size-3.5" /> {t('Action')}
                </button>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <GhostButton onClick={() => setDraft(null)}>{t('Annuler')}</GhostButton>
                <PrimaryButton disabled={!draft.name.trim() || create.isPending || update.isPending} onClick={save}>
                  {t('Enregistrer')}
                </PrimaryButton>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </SettingsPage>
  );
}

function ConditionEditor({ condition, onChange, onRemove }: { condition: Condition; onChange: (c: Condition) => void; onRemove?: () => void }) {
  const catalog = useCatalog();
  const boolean = ['newsletter', 'opportunity', 'otp'].includes(condition.field);
  return (
    <div className="flex items-center gap-2">
      <Select value={condition.field} onValueChange={(field) => onChange({ field: field as Condition['field'], op: OPS_FOR[field as Condition['field']][0]!, value: ['newsletter', 'opportunity', 'otp'].includes(field) ? 'true' : '' })}>
        <SelectTrigger className="w-[190px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(FIELD_LABELS).map(([k, v]) => (
            <SelectItem key={k} value={k}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {boolean ? (
        <Select value={condition.value} onValueChange={(value) => onChange({ ...condition, value })}>
          <SelectTrigger className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">{t('oui')}</SelectItem>
            <SelectItem value="false">{t('non')}</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <>
          <Select value={condition.op} onValueChange={(op) => onChange({ ...condition, op: op as Condition['op'] })}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPS_FOR[condition.field].map((op) => (
                <SelectItem key={op} value={op}>
                  {OP_LABELS[op]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {condition.field === 'tag' || condition.field === 'business' || condition.field === 'account' || condition.field === 'priority' ? (
            <Select value={condition.value} onValueChange={(value) => onChange({ ...condition, value })}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder={t('Choisir…')} />
              </SelectTrigger>
              <SelectContent>
                {(condition.field === 'tag'
                  ? catalog.tags.map((tag) => [tag.id, t(tag.name)])
                  : condition.field === 'business'
                    ? catalog.businesses.map((b) => [b.id, b.name])
                    : condition.field === 'account'
                      ? catalog.accounts.map((a) => [a.id, a.email])
                      : PRIORITIES
                ).map(([value, label]) => (
                  <SelectItem key={value} value={value!}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input value={condition.value} onChange={(e) => onChange({ ...condition, value: e.target.value })} className="flex-1" placeholder={t('valeur')} />
          )}
        </>
      )}
      {onRemove ? (
        <button onClick={onRemove} className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

function ActionEditor({ action, onChange, onRemove }: { action: Action; onChange: (a: Action) => void; onRemove?: () => void }) {
  const catalog = useCatalog();
  const { spaces } = useSpaces();
  const folders = useFolderNames();
  const needs = action.type === 'moveToFolder' ? [...folders.entries()] : action.type === 'addTag' ? catalog.tags.map((tag) => [tag.id, t(tag.name)]) : action.type === 'setBusiness' ? catalog.businesses.map((b) => [b.id, b.name]) : action.type === 'setSpace' ? spaces.map((sp) => [sp.id, t(sp.name)]) : action.type === 'setPriority' ? PRIORITIES : null;
  return (
    <div className="flex items-center gap-2">
      <Select value={action.type} onValueChange={(type) => onChange({ type: type as Action['type'] })}>
        <SelectTrigger className="w-[240px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(ACTION_LABELS).map(([k, v]) => (
            <SelectItem key={k} value={k}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {needs ? (
        <Select value={action.value ?? ''} onValueChange={(value) => onChange({ ...action, value })}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder={t('Choisir…')} />
          </SelectTrigger>
          <SelectContent>
            {needs.map(([value, label]) => (
              <SelectItem key={value} value={value!}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="flex-1" />
      )}
      {onRemove ? (
        <button onClick={onRemove} className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

/** Every account's folders, by id: « adam@shop.com › Receipts ». */
function useFolderNames() {
  const trpc = useTRPC();
  const catalog = useCatalog();
  const { data } = useQuery(trpc.accounts.folders.queryOptions());
  return new Map(
    (data ?? [])
      .filter((f) => !['sent', 'drafts', 'all', 'trash'].includes(f.specialUse ?? ''))
      .map((f) => {
        const account = catalog.accountById.get(f.accountId);
        return [f.id, `${account?.label || account?.email || ''} › ${f.path}`] as [string, string];
      }),
  );
}
