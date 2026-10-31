import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useTRPC } from '@/lib/trpc';
import { t, tp } from '@/lib/i18n';

/** Name of a new folder, at the top of an account or inside another folder. */
export function NewFolderDialog({ open, parentLabel, pending, onCancel, onCreate }: { open: boolean; parentLabel: string | null; pending: boolean; onCancel: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState('');
  useEffect(() => {
    if (open) setName('');
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-[400px]">
        <DialogTitle className="text-[15px]">{parentLabel ? t('Nouveau dossier dans « {parent} »', { parent: parentLabel }) : t('Nouveau dossier')}</DialogTitle>
        <DialogDescription className="text-muted-foreground text-[12.5px]">{t('Il est créé sur le serveur : vos autres apps de mail le verront aussi.')}</DialogDescription>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onCreate(name.trim());
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Nom du dossier')} autoFocus className="h-9" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t('Annuler')}
            </Button>
            <Button type="submit" disabled={!name.trim() || pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('Créer')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Deleting a folder on the server. An IMAP DELETE erases its mails for good, so by default they
 * go to the Trash first; the user can choose to erase them with it.
 */
export function DeleteFolderDialog({ folder, pending, onCancel, onDelete }: { folder: { id: string; label: string } | null; pending: boolean; onCancel: () => void; onDelete: (toTrash: boolean) => void }) {
  const trpc = useTRPC();
  const [toTrash, setToTrash] = useState(true);
  useEffect(() => {
    if (folder) setToTrash(true);
  }, [folder]);
  const { data } = useQuery({ ...trpc.accounts.folderContents.queryOptions({ mailboxId: folder?.id ?? '' }), enabled: Boolean(folder) });
  return (
    <Dialog open={Boolean(folder)} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-[440px]">
        <DialogTitle className="text-[15px]">{t('Supprimer le dossier « {name} » ?', { name: folder?.label ?? '' })}</DialogTitle>
        <DialogDescription className="text-muted-foreground text-[12.5px]">
          {t('Il est supprimé sur le serveur, donc aussi dans vos autres apps de mail.')}{' '}
          {data?.subfolders ? tp(data.subfolders, 'Son sous-dossier aussi.', 'Ses {n} sous-dossiers aussi.') : null}
        </DialogDescription>
        <label className="flex items-start gap-2.5 rounded-lg border border-border p-3 text-[13px]">
          <input type="checkbox" checked={toTrash} onChange={(e) => setToTrash(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
          <span>
            <span className="font-medium">{t('Mettre ses mails dans la corbeille')}</span>
            <span className="text-muted-foreground block text-[12px]">
              {data ? tp(data.mails, '{n} mail connu de ZMail. ', '{n} mails connus de ZMail. ') : null}
              {toTrash ? t('Vous pourrez encore les récupérer.') : t('Sans cette option, ils sont effacés définitivement avec le dossier.')}
            </span>
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('Annuler')}
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={() => onDelete(toTrash)}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('Supprimer le dossier')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
