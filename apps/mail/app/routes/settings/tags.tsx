import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Palette, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { TagStylePopover } from '@/components/tag-style-picker';
import { IconPicker } from '@/components/icon-picker';
import { useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { TagChip } from '@/components/mail/chips';
import { CategoryPacks } from '@/components/category-packs';
import { RetriageButton, RetriagePanel } from '@/components/retriage';
import { Card, GhostButton, PrimaryButton, SettingsPage } from '@/components/settings/ui';
import { useCatalog } from '@/hooks/use-catalog';
import { MAIN_SPACE, useSpaces } from '@/hooks/use-space';
import { useTRPC, type Tag } from '@/lib/trpc';
import { PALETTE } from '@/lib/utils';
import { t, tp } from '@/lib/i18n';

type Draft = { id?: string; name: string; color: string; description: string; icon: string | null };

export default function TagSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const [draft, setDraft] = useState<Draft | null>(null);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.catalog.tags.queryKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.catalog.hiddenTags.queryKey() });
  };
  const save = useMutation(trpc.catalog.saveTag.mutationOptions({ onSuccess: invalidate }));
  const remove = useMutation(trpc.catalog.removeTag.mutationOptions({ onSuccess: invalidate }));
  const restore = useMutation(trpc.catalog.restoreTag.mutationOptions({ onSuccess: invalidate }));
  const { data: allHidden } = useQuery(trpc.catalog.hiddenTags.queryOptions());
  const { data: packs } = useQuery(trpc.catalog.packs.queryOptions());
  // Template categories not added yet are offered in « Modèles », not listed as removed.
  const inPacks = new Set<string>(packs?.flatMap((p) => p.tags.map((x) => x.id)) ?? []);
  const hidden = allHidden?.filter((tag) => !inPacks.has(tag.id));
  const system = catalog.tags.filter((tag) => tag.kind === 'system');
  const custom = catalog.tags.filter((tag) => tag.kind === 'custom');
  const { spaces, space, spaceId } = useSpaces();

  const row = (tag: Tag) => (
    <li key={tag.id} className="flex items-start gap-3 py-2.5">
      <div className="w-[170px] shrink-0 space-y-1 pt-0.5">
        <TagChip tag={tag} size="md" />
        {tag.spaceId ? <span className="text-muted-foreground block text-[11px]">{t('Espace « {space} »', { space: spaces.find((sp) => sp.id === tag.spaceId)?.name ?? '' })}</span> : null}
      </div>
      <p className="text-muted-foreground min-w-0 flex-1 text-[12.5px] leading-relaxed">{(tag.kind === 'system' && tag.description ? t(tag.description) : tag.description) || '—'}</p>
      <div className="flex gap-1">
        {tag.kind === 'system' ? (
          <TagStylePopover tag={tag} align="end">
            <GhostButton aria-label={t('Icône et couleur de {name}', { name: t(tag.name) })}>
              <Palette className="size-3.5" />
              {t('Icône')}
            </GhostButton>
          </TagStylePopover>
        ) : null}
        <GhostButton onClick={() => setDraft({ id: tag.id, name: tag.kind === 'system' ? t(tag.name) : tag.name, color: tag.color, description: tag.kind === 'system' && tag.description ? t(tag.description) : tag.description, icon: tag.icon ?? null })}>{t('Modifier')}</GhostButton>
        <GhostButton
          className="hover:text-destructive"
          title={t('Supprimer')}
          onClick={() =>
            window.confirm(
              tag.kind === 'system'
                ? t('Supprimer la catégorie « {name} » ? L’IA ne l’utilisera plus. Vous pourrez la rétablir plus bas.', { name: t(tag.name) })
                : t('Supprimer la catégorie « {name} » ? Les mails restent, ils perdent seulement cette catégorie.', { name: t(tag.name) }),
            ) && remove.mutate({ id: tag.id })
          }
        >
          <Trash2 className="size-3.5" />
        </GhostButton>
      </div>
    </li>
  );

  return (
    <SettingsPage
      title={t('Catégories')}
      description={t('L’IA range chaque mail dans des catégories génériques et vos catégories personnalisées. Décrivez une catégorie en langage naturel : la description sert de consigne au modèle.')}
      actions={
        <div className="flex gap-2">
          <RetriageButton />
          <PrimaryButton onClick={() => setDraft({ name: '', color: PALETTE[custom.length % PALETTE.length]!, description: '', icon: 'tag' })}>
            <Plus className="size-4" />
            {t('Nouvelle catégorie')}
          </PrimaryButton>
        </div>
      }
    >
      <RetriagePanel />
      <Card title={t('Mes catégories')} description={t('Créées par vous ou par l’agent.')}>
        {custom.length ? <ul className="-my-1 divide-y divide-border">{custom.map(row)}</ul> : <p className="text-muted-foreground text-[13px]">{t('Aucun tag personnalisé pour l’instant.')}</p>}
      </Card>
      <Card title={t('Catégories génériques')} description={t('Toujours disponibles pour le tri automatique.')}>
        <ul className="-my-1 divide-y divide-border">{system.map(row)}</ul>
      </Card>
      <Card title={t('Modèles de catégories')} description={t('Des catégories prêtes à l’emploi, perso ou pro. Ajoutez seulement celles qui vous servent : moins de catégories, moins de bruit.')}>
        <CategoryPacks allTags={[...catalog.tags, ...(allHidden ?? [])]} />
      </Card>
      {hidden?.length ? (
        <Card title={t('Catégories supprimées')} description={t('Catégories génériques que vous avez retirées : l’IA ne les utilise plus.')}>
          <ul className="-my-1 divide-y divide-border">
            {hidden.map((tag) => (
              <li key={tag.id} className="flex items-center gap-3 py-2.5">
                <div className="w-[170px] shrink-0 opacity-60">
                  <TagChip tag={tag} size="md" />
                </div>
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-[12.5px]">{tag.description ? t(tag.description) : '—'}</span>
                <GhostButton onClick={() => restore.mutate({ id: tag.id }, { onSuccess: () => toast.success(t('Catégorie « {name} » rétablie', { name: t(tag.name) })) })}>
                  <RotateCcw className="size-3.5" />
                  {t('Rétablir')}
                </GhostButton>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent showOverlay className="max-w-[420px]">
          <DialogTitle>{draft?.id ? t('Modifier la catégorie') : t('Nouvelle catégorie')}</DialogTitle>
          <DialogDescription>{t('Sans IA connectée, les mots-clés séparés par des virgules dans la description sont utilisés.')}</DialogDescription>
          {draft ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t('Nom')}</Label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('Fournisseurs')} autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label>{t('Description pour l’IA')}</Label>
                <Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={3} placeholder={t('Factures et échanges avec nos fournisseurs : grossiste, imprimeur, transporteur')} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('Icône et couleur')}</Label>
                <div className="border-border rounded-xl border p-3">
                  <IconPicker
                    title={draft.name || t('Nouvelle catégorie')}
                    value={draft.icon}
                    color={draft.color}
                    dot
                    fallback={<span className="size-2.5 rounded-full" style={{ backgroundColor: draft.color }} />}
                    onChange={(icon) => setDraft({ ...draft, icon })}
                    onColor={(color) => setDraft({ ...draft, color })}
                  />
                </div>
              </div>
              {!draft.id && spaces.length > 1 && space ? (
                <p className="text-muted-foreground text-[12px]">
                  {space.id === MAIN_SPACE ? t('Visible dans tous les espaces.') : t('Créée dans l’espace « {space} » : visible seulement là.', { space: space.name })}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <GhostButton onClick={() => setDraft(null)}>{t('Annuler')}</GhostButton>
                <PrimaryButton disabled={!draft.name.trim()} onClick={() => save.mutate({ ...draft, name: draft.name.trim(), ...(draft.id ? {} : { spaceId }) }, { onSuccess: () => setDraft(null) })}>
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
