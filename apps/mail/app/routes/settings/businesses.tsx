import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, ColorPicker, GhostButton, PrimaryButton, SettingsPage } from '@/components/settings/ui';
import { useCatalog } from '@/hooks/use-catalog';
import { useTRPC, type Business } from '@/lib/trpc';
import { useSuggestBusinessPack } from '@/components/category-packs';
import { PALETTE } from '@/lib/utils';
import { t } from '@/lib/i18n';

type Matcher = Business['matchers'][number];
type Draft = { id?: string; name: string; emoji: string; color: string; description: string; matchers: Omit<Matcher, 'id'>[] };

const MATCHER_LABELS: Record<Matcher['type'], string> = {
  account: t('Compte de réception'),
  address: t('Adresse de destination'),
  domain: t('Domaine'),
  sender: t('Expéditeur'),
};

export default function BusinessSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const [draft, setDraft] = useState<Draft | null>(null);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.catalog.businesses.queryKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.mail.list.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.mail.counts.queryKey() });
  };
  const reassign = useMutation(trpc.catalog.reassignBusinesses.mutationOptions({ onSuccess: invalidate }));
  const suggestPack = useSuggestBusinessPack();
  const save = useMutation(
    trpc.catalog.saveBusiness.mutationOptions({
      onSuccess: (_business, input) => {
        reassign.mutate();
        invalidate();
        // A new business may need the business categories (opportunities, disputes, meetings).
        if (!input.id) void suggestPack();
      },
    }),
  );
  const remove = useMutation(trpc.catalog.removeBusiness.mutationOptions({ onSuccess: invalidate }));

  return (
    <SettingsPage
      title={t('Business')}
      description={t('Regroupez vos boîtes par activité. Chaque mail est rattaché à un business selon sa provenance : compte, adresse ou domaine de destination, expéditeur.')}
      actions={
        <PrimaryButton onClick={() => setDraft({ name: '', emoji: '🏢', color: PALETTE[catalog.businesses.length % PALETTE.length]!, description: '', matchers: [] })}>
          <Plus className="size-4" />
          {t('Nouveau business')}
        </PrimaryButton>
      }
    >
      {catalog.businesses.length === 0 ? (
        <Card>
          <p className="text-muted-foreground py-6 text-center text-[13px]">{t('Créez votre premier business (ex. votre agence, votre boutique, « Perso »).')}</p>
        </Card>
      ) : (
        catalog.businesses.map((b) => (
          <Card
            key={b.id}
            title={`${b.emoji ?? ''} ${b.name}`.trim()}
            description={b.description || undefined}
            action={
              <div className="flex gap-1.5">
                <GhostButton onClick={() => setDraft({ id: b.id, name: b.name, emoji: b.emoji ?? '', color: b.color, description: b.description, matchers: b.matchers.map(({ type, value }) => ({ type, value })) })}>{t('Modifier')}</GhostButton>
                <GhostButton
                  className="hover:text-destructive"
                  onClick={() => window.confirm(t('Supprimer « {name} » ?', { name: b.name })) && remove.mutate({ id: b.id }, { onSuccess: () => toast(t('{name} supprimé', { name: b.name })) })}
                >
                  <Trash2 className="size-3.5" />
                </GhostButton>
              </div>
            }
          >
            <div className="flex flex-wrap gap-1.5">
              <span className="size-3 rounded-full" style={{ backgroundColor: b.color }} />
              {b.matchers.length === 0 ? <span className="text-muted-foreground text-[12.5px]">{t('Aucune règle de rattachement')}</span> : null}
              {b.matchers.map((m) => (
                <span key={m.id} className="bg-muted rounded-md px-2 py-0.5 text-[12px]">
                  <span className="text-muted-foreground">{t('{label} :', { label: MATCHER_LABELS[m.type] })}</span> {m.type === 'account' ? (catalog.accountById.get(m.value)?.email ?? m.value) : m.value}
                </span>
              ))}
            </div>
          </Card>
        ))
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent showOverlay className="max-w-[540px]">
          <DialogTitle>{draft?.id ? t('Modifier le business') : t('Nouveau business')}</DialogTitle>
          <DialogDescription>{t('La description aide l’IA à repérer les opportunités propres à ce business.')}</DialogDescription>
          {draft ? (
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="w-20 space-y-1.5">
                  <Label>{t('Emoji')}</Label>
                  <Input value={draft.emoji} onChange={(e) => setDraft({ ...draft, emoji: e.target.value.slice(0, 4) })} className="text-center" />
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label>{t('Nom')}</Label>
                  <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('Mon agence')} autoFocus />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t('Description')}</Label>
                <Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder={t('Agence de développement web : devis, clients, partenaires…')} rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('Couleur')}</Label>
                <ColorPicker value={draft.color} onChange={(color) => setDraft({ ...draft, color })} colors={PALETTE} />
              </div>
              <div className="space-y-2">
                <Label>{t('Rattacher les mails…')}</Label>
                {draft.matchers.map((m, i) => (
                  <div key={i} className="flex gap-2">
                    <Select value={m.type} onValueChange={(type) => setDraft({ ...draft, matchers: draft.matchers.map((x, j) => (j === i ? { type: type as Matcher['type'], value: '' } : x)) })}>
                      <SelectTrigger className="w-[190px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(MATCHER_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {m.type === 'account' ? (
                      <Select value={m.value} onValueChange={(value) => setDraft({ ...draft, matchers: draft.matchers.map((x, j) => (j === i ? { ...x, value } : x)) })}>
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder={t('Choisir un compte')} />
                        </SelectTrigger>
                        <SelectContent>
                          {catalog.accounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={m.value}
                        onChange={(e) => setDraft({ ...draft, matchers: draft.matchers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                        placeholder={m.type === 'domain' ? t('monagence.fr') : m.type === 'sender' ? t('client@exemple.com') : t('contact@monagence.fr')}
                        className="flex-1"
                      />
                    )}
                    <button onClick={() => setDraft({ ...draft, matchers: draft.matchers.filter((_, j) => j !== i) })} className="text-muted-foreground hover:text-foreground px-1">
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
                <button onClick={() => setDraft({ ...draft, matchers: [...draft.matchers, { type: 'domain', value: '' }] })} className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[12.5px]">
                  <Plus className="size-3.5" /> {t('Ajouter une correspondance')}
                </button>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <GhostButton onClick={() => setDraft(null)}>{t('Annuler')}</GhostButton>
                <PrimaryButton
                  disabled={!draft.name.trim() || save.isPending}
                  onClick={() =>
                    save.mutate(
                      { id: draft.id, name: draft.name.trim(), emoji: draft.emoji || null, color: draft.color, description: draft.description, matchers: draft.matchers.filter((m) => m.value.trim()) },
                      { onSuccess: () => (setDraft(null), toast.success(t('Business enregistré'), { description: t('Les mails existants ont été rattachés à nouveau.') })) },
                    )
                  }
                >
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
