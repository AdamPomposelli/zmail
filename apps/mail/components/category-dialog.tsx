import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { IconPicker } from '@/components/icon-picker';
import { TagIcon } from '@/lib/tag-icons';
import { useTRPC, type Tag } from '@/lib/trpc';
import { t } from '@/lib/i18n';

/** Everything a category can be: name, what it is about (it guides the AI), icon and colour. */
export function CategoryDialog({ tag, open, onOpenChange }: { tag: Tag | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [style, setStyle] = useState<{ icon: string | null; color: string }>({ icon: null, color: '#6366F1' });
  const [hideFromInbox, setHideFromInbox] = useState(false);
  useEffect(() => {
    if (!tag || !open) return;
    setName(t(tag.name));
    setDescription(tag.kind === 'system' && tag.description ? t(tag.description) : tag.description);
    setStyle({ icon: tag.icon ?? null, color: tag.color });
    setHideFromInbox(tag.hideFromInbox);
  }, [tag, open]);
  const save = useMutation(
    trpc.catalog.saveTag.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.catalog.tags.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.mail.pathKey() });
        onOpenChange(false);
        toast.success(t('Catégorie enregistrée'));
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  if (!tag) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]">
        <DialogTitle className="flex items-center gap-2 text-[15px]">
          <TagIcon icon={style.icon} color={style.color} />
          {t('Modifier la catégorie')}
        </DialogTitle>
        <DialogDescription className="sr-only">{t('Nom, description, icône et couleur')}</DialogDescription>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save.mutate({ id: tag.id, name: name.trim(), description: description.trim(), ...style, hideFromInbox });
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-[12.5px] font-medium">{t('Nom')}</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus className="h-9" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[12.5px] font-medium">{t('De quoi parlent ces mails ?')}</span>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[64px] text-[13px]" placeholder={t('Ex. : factures et relances de nos fournisseurs')} />
            <span className="text-muted-foreground block text-[11.5px]">{t('L’IA s’en sert pour ranger les mails dans cette catégorie.')}</span>
          </label>
          <div className="space-y-1.5">
            <span className="text-[12.5px] font-medium">{t('Icône et couleur')}</span>
            <div className="border-border rounded-xl border p-3">
              <IconPicker
                title={name || t('Nouvelle catégorie')}
                value={style.icon}
                color={style.color}
                dot
                fallback={<span className="size-2.5 rounded-full" style={{ backgroundColor: style.color }} />}
                onChange={(icon) => setStyle((s) => ({ ...s, icon }))}
                onColor={(color) => setStyle((s) => ({ ...s, color }))}
              />
            </div>
          </div>
          <label className="border-border flex cursor-pointer items-start gap-3 rounded-xl border p-3">
            <Switch checked={hideFromInbox} onCheckedChange={setHideFromInbox} className="mt-0.5" />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{t('Masquer de la boîte de réception')}</span>
              <span className="text-muted-foreground block text-[12px] leading-relaxed">{t('Ses mails ne s’affichent plus dans la boîte de réception (de leur espace) : vous les retrouvez dans cette catégorie, et la recherche les trouve toujours.')}</span>
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('Annuler')}
            </Button>
            <Button type="submit" disabled={!name.trim() || save.isPending}>
              {t('Enregistrer')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
