import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AccountWizard } from '@/components/onboarding/account-wizard';
import { Card, GhostButton, PrimaryButton, SettingsPage } from '@/components/settings/ui';
import { BusinessBadge } from '@/components/mail/chips';
import { useCatalog } from '@/hooks/use-catalog';
import { useTRPC } from '@/lib/trpc';
import { formatListDate } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { BrandLogo, brandForProvider } from '@/components/brand-logo';
import { AccountEditDialog } from '@/components/settings/account-edit-dialog';
import { AccountIcon } from '@/components/account-icon';
import { AccountProgress, useAccountsProgress } from '@/components/settings/account-progress';
import { BusinessesSection } from './businesses';
import { cn } from '@/lib/utils';

export default function AccountsSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const [adding, setAdding] = useState(false);
  // `?add=1` (from the settings search) opens the wizard directly.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('add') !== '1') return;
    setAdding(true);
    setParams({}, { replace: true });
  }, [params, setParams]);
  // `?account=<id>` (double-click or menu in the sidebar) highlights that account;
  // `&edit=connection` opens its connection settings right away.
  const [editing, setEditing] = useState<{ id: string; focus?: 'connection' } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  useEffect(() => {
    const id = params.get('account');
    if (!id) return;
    setHighlight(id);
    if (params.get('edit') === 'connection') setEditing({ id, focus: 'connection' });
    requestAnimationFrame(() => document.getElementById(`account-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    const timer = setTimeout(() => setHighlight(null), 2200);
    setParams({}, { replace: true });
    return () => clearTimeout(timer);
  }, [params, setParams]);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: trpc.accounts.list.queryKey() });
  const progress = useAccountsProgress();
  const resync = useMutation(trpc.accounts.resync.mutationOptions({ onSuccess: invalidate }));
  const remove = useMutation(trpc.accounts.remove.mutationOptions({ onSuccess: () => (invalidate(), void queryClient.invalidateQueries({ queryKey: trpc.mail.list.pathKey() })) }));

  return (
    <SettingsPage
      title={t('Comptes mail')}
      description={t('Toutes vos boîtes IMAP/SMTP — Gmail, mailbox.org, Namecheap, iCloud, vos serveurs — réunies dans une seule boîte de réception.')}
      actions={
        <PrimaryButton onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          {t('Ajouter')}
        </PrimaryButton>
      }
    >
      <Card>
        {catalog.accounts.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-[13px]">{t('Aucun compte connecté.')}</p>
        ) : (
          <ul className="-my-1 divide-y divide-border">
            {catalog.accounts.map((a) => {
              const business = a.businessId ? catalog.businessById.get(a.businessId) : undefined;
              return (
                <li key={a.id} id={`account-${a.id}`} className={cn('-mx-2 flex items-start gap-3 rounded-lg px-2 py-3 transition-colors duration-700', highlight === a.id && 'bg-primary/10')}>
                  <span className="relative">
                    {a.icon ? (
                      // The icon picked in the sidebar (an icon, a brand, the company's logo).
                      <span className="bg-card ring-border flex size-9 items-center justify-center rounded-xl ring-1">
                        <AccountIcon account={a} size={20} />
                      </span>
                    ) : brandForProvider(a.provider) ? (
                      <BrandLogo brand={brandForProvider(a.provider)} tile size={36} />
                    ) : (
                      <span className="flex size-9 items-center justify-center rounded-xl text-[13px] font-semibold text-white" style={{ backgroundColor: a.color }}>
                        {a.email[0]?.toUpperCase()}
                      </span>
                    )}
                    <span className="ring-card absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2" style={{ backgroundColor: a.color }} title={t('Couleur du compte')} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[13.5px] font-medium">
                      <span className="truncate">{a.label || a.email}</span>
                      {a.label ? <span className="text-muted-foreground truncate font-normal">{a.email}</span> : null}
                      {/* Same groups as the sidebar: its business, « Business » with none named, or « Personnel ». */}
                      {business ? (
                        <BusinessBadge business={business} />
                      ) : a.kind ? (
                        <span className="bg-muted text-muted-foreground rounded-full px-2 py-px text-[11px] font-normal">{a.kind === 'business' ? t('Business') : t('Personnel')}</span>
                      ) : null}
                    </p>
                    <p className="text-muted-foreground flex items-center gap-1.5 text-[12px]">
                      {a.status === 'error' ? (
                        <>
                          <AlertCircle className="text-destructive size-3" />
                          <span className="text-destructive truncate">{a.lastError}</span>
                        </>
                      ) : a.status === 'syncing' ? (
                        <>
                          <Loader2 className="size-3 animate-spin" /> {t('Synchronisation…')}
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="text-success size-3" /> {t('{host} · synchronisé {date} · temps réel (IDLE)', { host: a.imapHost, date: a.lastSyncAt ? formatListDate(a.lastSyncAt) : '—' })}
                        </>
                      )}
                    </p>
                    <AccountProgress progress={progress.find((p) => p.id === a.id)} />
                  </div>
                  <GhostButton onClick={() => setEditing({ id: a.id })} title={t('Modifier le nom et la connexion')}>
                    <Pencil className="size-3.5" />
                    {t('Modifier')}
                  </GhostButton>
                  <GhostButton onClick={() => resync.mutate({ id: a.id })} title={t('Resynchroniser')}>
                    <RefreshCw className={resync.isPending && resync.variables?.id === a.id ? 'size-3.5 animate-spin' : 'size-3.5'} />
                  </GhostButton>
                  <GhostButton
                    onClick={() => {
                      if (window.confirm(t('Déconnecter {email} ? Les mails locaux de ce compte seront supprimés de ZMail (rien n’est supprimé sur le serveur).', { email: a.email }))) {
                        remove.mutate({ id: a.id }, { onSuccess: () => toast(t('{email} déconnecté', { email: a.email })) });
                      }
                    }}
                    className="hover:text-destructive"
                    title={t('Déconnecter')}
                  >
                    <Trash2 className="size-3.5" />
                  </GhostButton>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <BusinessesSection />
      <Card title={t('Comment ça marche')} description={t('Chaque compte garde une connexion IMAP IDLE ouverte : les nouveaux mails arrivent en temps réel, sont triés par l’IA, puis les règles s’appliquent. Vos actions (archiver, supprimer…) sont répercutées sur le serveur.')}>
        <p className="text-muted-foreground text-[12.5px]">
          {t('Gmail : activez la validation en deux étapes puis créez un mot de passe d’application. Les alias Gmail (« envoyer en tant que ») arrivent dans la même boîte et sont rattachés à leur business par adresse de destination.')}
        </p>
      </Card>

      <AccountEditDialog account={catalog.accounts.find((a) => a.id === editing?.id) ?? null} open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} focus={editing?.focus} />

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent showOverlay className="max-h-[92vh] max-w-[640px] overflow-y-auto">
          <DialogTitle className="sr-only">{t('Connecter une boîte mail')}</DialogTitle>
          <DialogDescription className="sr-only">{t('Assistant pas à pas')}</DialogDescription>
          {adding ? <AccountWizard variant="dialog" onDone={() => setAdding(false)} onCancel={() => setAdding(false)} /> : null}
        </DialogContent>
      </Dialog>
    </SettingsPage>
  );
}
