import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Card, GhostButton, PrimaryButton, SettingsPage } from '@/components/settings/ui';
import { SpaceDialog, SpaceIcon } from '@/components/sidebar/spaces';
import { AccountIcon } from '@/components/account-icon';
import { useCatalog } from '@/hooks/use-catalog';
import { MAIN_SPACE, useSpaces, type Space } from '@/hooks/use-space';
import { useTRPC } from '@/lib/trpc';
import { t, tp } from '@/lib/i18n';

/** Settings → Spaces: create them, say which mailboxes and businesses feed each, reorder. */
export default function SpacesSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const { spaces, select } = useSpaces();
  const [editing, setEditing] = useState<Space | 'new' | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.spaces.list.queryKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.mail.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.catalog.tags.queryKey() });
  };
  const reorder = useMutation(trpc.spaces.reorder.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.spaces.remove.mutationOptions({ onSuccess: refresh, onError: (e) => toast.error(e.message) }));
  const perBusiness = useMutation(
    trpc.spaces.createPerBusiness.mutationOptions({
      onSuccess: (created) => {
        refresh();
        toast.success(created.length ? tp(created.length, '{n} espace créé', '{n} espaces créés') : t('Chaque business a déjà son espace'));
      },
    }),
  );
  const freeBusinesses = catalog.businesses.filter((b) => !spaces.some((s) => s.businessIds.includes(b.id)));
  const move = (index: number, dir: -1 | 1) => {
    const ids = spaces.map((s) => s.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + dir, 0, id!);
    reorder.mutate({ ids });
  };
  const name = (s: Space) => (s.id === MAIN_SPACE ? t(s.name) : s.name);

  return (
    <SettingsPage
      title={t('Espaces')}
      description={t('Comme dans Arc : un espace par business, un pour vos mails personnels… Chacun a sa boîte de réception, ses favoris, ses abonnements et ses catégories, pour ne jamais mélanger les mails.')}
      actions={
        <PrimaryButton onClick={() => setEditing('new')}>
          <Plus className="size-4" /> {t('Nouvel espace')}
        </PrimaryButton>
      }
    >
      {freeBusinesses.length ? (
        <Card>
          <div className="flex items-center gap-3">
            <Sparkles className="text-ai size-4 shrink-0" />
            <p className="min-w-0 flex-1 text-[13px]">
              {tp(freeBusinesses.length, 'Créer un espace pour votre business {names} : ses mails quittent la boîte principale.', 'Créer un espace pour chacun de vos {n} business ({names}) : leurs mails quittent la boîte principale.', { names: freeBusinesses.map((b) => b.name).join(', ') })}
            </p>
            <GhostButton onClick={() => perBusiness.mutate()} disabled={perBusiness.isPending}>
              {t('Créer')}
            </GhostButton>
          </div>
        </Card>
      ) : null}

      <Card title={t('Vos espaces')} description={t('Dans cet ordre en bas de la barre latérale. ⌃1 à ⌃9 ou un glissement à deux doigts pour passer de l’un à l’autre.')}>
        <ul className="divide-border -my-1 divide-y">
          {spaces.map((space, i) => {
            const accounts = catalog.accounts.filter((a) => space.accountIds.includes(a.id));
            const businesses = catalog.businesses.filter((b) => space.businessIds.includes(b.id));
            return (
              <li key={space.id} className="flex items-center gap-3 py-3">
                <span className="bg-muted flex size-9 items-center justify-center rounded-lg">
                  <SpaceIcon space={space} size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[13.5px] font-medium">
                    {name(space)}
                    {i < 9 ? <kbd className="text-muted-foreground font-sans text-[11px]">⌃{i + 1}</kbd> : null}
                  </p>
                  <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
                    {space.id === MAIN_SPACE ? (
                      t('Tout ce qui n’est rangé dans aucun autre espace')
                    ) : accounts.length || businesses.length ? (
                      <>
                        {accounts.map((a) => (
                          <span key={a.id} className="inline-flex items-center gap-1">
                            <AccountIcon account={a} size={12} /> {a.label || a.email}
                          </span>
                        ))}
                        {businesses.map((b) => (
                          <span key={b.id} className="inline-flex items-center gap-1">
                            {b.emoji ?? '•'} {b.name}
                          </span>
                        ))}
                      </>
                    ) : (
                      t('Seulement les mails que vous y déplacez')
                    )}
                  </p>
                </div>
                <GhostButton onClick={() => move(i, -1)} disabled={i === 0} title={t('Monter')} aria-label={t('Monter')}>
                  <ArrowUp />
                </GhostButton>
                <GhostButton onClick={() => move(i, 1)} disabled={i === spaces.length - 1} title={t('Descendre')} aria-label={t('Descendre')}>
                  <ArrowDown />
                </GhostButton>
                <GhostButton onClick={() => setEditing(space)} title={t('Modifier')} aria-label={t('Modifier')}>
                  <Pencil />
                </GhostButton>
                {space.id !== MAIN_SPACE ? (
                  <GhostButton
                    className="hover:text-destructive"
                    title={t('Supprimer')}
                    aria-label={t('Supprimer')}
                    onClick={() => {
                      if (!window.confirm(t('Supprimer l’espace « {name} » ? Ses mails retournent dans les autres espaces, rien n’est supprimé.', { name: space.name }))) return;
                      remove.mutate({ id: space.id });
                    }}
                  >
                    <Trash2 />
                  </GhostButton>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title={t('Comment un mail choisit son espace')}>
        <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-[12.5px] leading-relaxed">
          <li>{t('Une conversation que vous avez déplacée (clic droit → « Déplacer vers l’espace », ou glissée sur l’icône d’un espace) y reste, réponses comprises.')}</li>
          <li>{t('Sinon, l’espace de son business : celui que l’IA a reconnu pour ce mail.')}</li>
          <li>{t('Sinon, l’espace du compte qui l’a reçu.')}</li>
          <li>{t('Sinon, l’espace principal.')}</li>
        </ol>
        <p className="text-muted-foreground mt-2 text-[12px]">
          {t('Déplacer deux fois les mails d’un même expéditeur vers un espace : ZMail propose une règle pour le faire tout seul.')}
        </p>
      </Card>

      <SpaceDialog space={editing === 'new' ? null : editing} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} onCreated={(id) => select(id)} />
    </SettingsPage>
  );
}
