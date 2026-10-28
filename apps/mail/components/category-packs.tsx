import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { TagChip } from '@/components/mail/chips';
import { useTRPC, type Tag } from '@/lib/trpc';
import { t, tp } from '@/lib/i18n';

type PackId = 'personal' | 'business';

const PACKS: Record<PackId, { title: string; hint: string }> = {
  personal: { title: t('Vie perso'), hint: t('Pour une boîte personnelle : famille et amis, démarches, voyages.') },
  business: { title: t('Business'), hint: t('Pour une boîte pro : opportunités, litiges de paiement, réunions.') },
};

function useAddPack() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(trpc.catalog.addPack.mutationOptions({ onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.catalog.pathKey() }) }));
}

/** The category templates: what each adds, and one click to add the missing ones. */
export function CategoryPacks({ allTags }: { allTags: Tag[] }) {
  const trpc = useTRPC();
  const { data: packs } = useQuery(trpc.catalog.packs.queryOptions());
  const add = useAddPack();
  if (!packs) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {packs.map((pack) => (
        <div key={pack.id} className="border-border flex flex-col rounded-xl border p-3.5">
          <p className="text-[13.5px] font-semibold">{PACKS[pack.id].title}</p>
          <p className="text-muted-foreground mt-0.5 text-[12px]">{PACKS[pack.id].hint}</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {pack.tags.map(({ id, missing }) => {
              const tag = allTags.find((x) => x.id === id);
              return tag ? (
                <span key={id} className={missing ? 'opacity-50' : undefined}>
                  <TagChip tag={tag} />
                </span>
              ) : null;
            })}
          </div>
          <div className="mt-auto pt-3">
            {pack.missing ? (
              <button
                type="button"
                disabled={add.isPending}
                onClick={() => add.mutate({ id: pack.id }, { onSuccess: () => toast.success(tp(pack.missing, '{n} catégorie ajoutée', '{n} catégories ajoutées')) })}
                className="bg-foreground text-background hover:bg-foreground/90 flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium disabled:opacity-60"
              >
                <Plus className="size-3.5" />
                {tp(pack.missing, 'Ajouter {n} catégorie', 'Ajouter les {n} catégories')}
              </button>
            ) : (
              <span className="text-success flex items-center gap-1 text-[12.5px]">
                <Check className="size-3.5" /> {t('Déjà dans vos catégories')}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * After a business is created: offers the business categories when they are not in use yet
 * (a personal setup that starts handling a company's mail).
 */
export function useSuggestBusinessPack() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const add = useAddPack();
  return async () => {
    const packs = await queryClient.fetchQuery(trpc.catalog.packs.queryOptions());
    const business = packs.find((p) => p.id === 'business');
    if (!business?.missing) return;
    toast(t('Ajouter les catégories pro ?'), {
      description: t('Opportunités, litiges de paiement et réunions, pour trier le courrier de ce business.'),
      duration: 12_000,
      action: { label: t('Ajouter'), onClick: () => add.mutate({ id: 'business' }, { onSuccess: () => toast.success(t('Catégories pro ajoutées')) }) },
    });
  };
}
