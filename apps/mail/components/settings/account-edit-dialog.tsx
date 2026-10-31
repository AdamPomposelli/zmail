import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { BrandLogo, brandForProvider } from '@/components/brand-logo';
import { useTRPC, type Outputs } from '@/lib/trpc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCatalog } from '@/hooks/use-catalog';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

type Account = Outputs['accounts']['list'][number];
type Server = { host: string; port: string; secure: boolean };

/**
 * An existing mailbox: its name in ZMail, the sender name, and the connection (servers, login,
 * password). Connection changes are tested before they are saved; the account then reconnects.
 */
export function AccountEditDialog({ account, open, onOpenChange, focus }: { account: Account | null; open: boolean; onOpenChange: (o: boolean) => void; focus?: 'connection' }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const [label, setLabel] = useState('');
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [imap, setImap] = useState<Server>({ host: '', port: '993', secure: true });
  const [smtp, setSmtp] = useState<Server>({ host: '', port: '465', secure: true });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => {
    if (!account || !open) return;
    setLabel(account.label ?? '');
    setBusinessId(account.businessId ?? null);
    setName(account.name);
    setImap({ host: account.imapHost, port: String(account.imapPort), secure: account.imapSecure });
    setSmtp({ host: account.smtpHost, port: String(account.smtpPort), secure: account.smtpSecure });
    setUsername(account.username);
    setPassword('');
    test.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, open]);

  const connection = { imapHost: imap.host.trim(), imapPort: Number(imap.port), imapSecure: imap.secure, smtpHost: smtp.host.trim(), smtpPort: Number(smtp.port), smtpSecure: smtp.secure, username: username.trim() };
  const connectionChanged =
    Boolean(account) &&
    (password !== '' ||
      connection.imapHost !== account!.imapHost ||
      connection.imapPort !== account!.imapPort ||
      connection.imapSecure !== account!.imapSecure ||
      connection.smtpHost !== account!.smtpHost ||
      connection.smtpPort !== account!.smtpPort ||
      connection.smtpSecure !== account!.smtpSecure ||
      connection.username !== account!.username);

  const test = useMutation(trpc.accounts.testExisting.mutationOptions());
  const save = useMutation(
    trpc.accounts.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.accounts.list.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.mail.list.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.mail.counts.queryKey() });
        onOpenChange(false);
        toast.success(connectionChanged ? t('Compte enregistré, reconnexion en cours') : t('Compte enregistré'));
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  if (!account) return null;

  const tested = test.data && test.data.imap.ok && test.data.smtp.ok;
  const submit = async () => {
    // A new connection is only saved once it works.
    if (connectionChanged) {
      const result = await test.mutateAsync({ id: account.id, patch: { ...connection, password: password || undefined } });
      if (!result.imap.ok || !result.smtp.ok) return;
    }
    save.mutate({ id: account.id, patch: { label: label.trim() || null, name: name.trim(), businessId, ...(connectionChanged ? { ...connection, ...(password ? { password } : {}) } : {}) } });
  };

  const server = (title: string, value: Server, set: (s: Server) => void) => (
    <div className="space-y-1.5">
      <span className="text-[12px] font-medium">{title}</span>
      <div className="flex gap-2">
        <Input value={value.host} onChange={(e) => set({ ...value, host: e.target.value })} placeholder="imap.exemple.com" className="h-8 flex-1 font-mono text-[12.5px]" />
        <Input value={value.port} onChange={(e) => set({ ...value, port: e.target.value.replace(/\D/g, '') })} className="h-8 w-20 font-mono text-[12.5px]" aria-label={t('Port')} />
        <div className="bg-muted flex rounded-md p-0.5 text-[11.5px]">
          {[true, false].map((secure) => (
            <button key={String(secure)} type="button" onClick={() => set({ ...value, secure })} className={cn('rounded px-2', value.secure === secure ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground')}>
              {secure ? 'SSL/TLS' : 'STARTTLS'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[520px] overflow-y-auto">
        <DialogTitle className="flex items-center gap-2.5 text-[15px]">
          <BrandLogo brand={brandForProvider(account.provider)} tile size={26} fallback={account.email} />
          <span className="min-w-0 truncate">{account.email}</span>
        </DialogTitle>
        <DialogDescription className="sr-only">{t('Nom du compte, nom d’expéditeur et connexion')}</DialogDescription>
        <form
          // A little inner margin so the focus rings are never cut by the scrolling edge.
          className="-mx-1 space-y-5 px-1"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-[12px] font-medium">{t('Nom dans ZMail')}</span>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={account.email} autoFocus={focus !== 'connection'} className="h-8" />
              <span className="text-muted-foreground block text-[11px]">{t('Ex. : « Pro », « Perso ». Vide : l’adresse s’affiche.')}</span>
            </label>
            <label className="block space-y-1.5">
              <span className="text-[12px] font-medium">{t('Nom d’expéditeur')}</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
              <span className="text-muted-foreground block text-[11px]">{t('Ce que voient vos destinataires.')}</span>
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium">{t('Business')}</span>
            <Select value={businessId ?? 'personal'} onValueChange={(v) => setBusinessId(v === 'personal' ? null : v)}>
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="personal">{t('Personnel (aucun business)')}</SelectItem>
                {catalog.businesses.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {`${b.emoji ?? ''} ${b.name}`.trim()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground block text-[11px]">{t('Les mails reçus sur ce compte sont rattachés à ce business. Créez-en un en bas de la page Comptes.')}</span>
          </label>

          <fieldset className="space-y-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-[12.5px] font-semibold">{t('Connexion')}</legend>
            <p className="text-muted-foreground text-[11.5px]">{t('Pour corriger des réglages erronés ou un mot de passe changé. La nouvelle connexion est testée avant d’être enregistrée.')}</p>
            {server(t('Réception (IMAP)'), imap, setImap)}
            {server(t('Envoi (SMTP)'), smtp, setSmtp)}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-[12px] font-medium">{t('Identifiant')}</span>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} className="h-8 text-[12.5px]" autoComplete="off" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[12px] font-medium">{t('Mot de passe')}</span>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('Inchangé')} autoFocus={focus === 'connection'} className="h-8" autoComplete="new-password" />
              </label>
            </div>
            {test.data ? (
              <div className="space-y-1 text-[12px]">
                {(['imap', 'smtp'] as const).map((k) => (
                  <p key={k} className={cn('flex items-start gap-1.5', test.data![k].ok ? 'text-success' : 'text-destructive')}>
                    {test.data![k].ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <XCircle className="mt-0.5 size-3.5 shrink-0" />}
                    {k === 'imap' ? t('Réception') : t('Envoi')} : {test.data![k].ok ? t('connexion réussie') : test.data![k].error}
                  </p>
                ))}
              </div>
            ) : null}
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[12px] ring-1 ring-border" disabled={test.isPending} onClick={() => test.mutate({ id: account.id, patch: { ...connection, password: password || undefined } })}>
              {test.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t('Tester la connexion')}
            </Button>
          </fieldset>

          <div className="flex items-center justify-end gap-2">
            {connectionChanged && test.data && !tested ? <span className="text-destructive mr-auto text-[12px]">{t('La connexion échoue : corrigez avant d’enregistrer.')}</span> : null}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('Annuler')}
            </Button>
            <Button type="submit" disabled={save.isPending || test.isPending || !name.trim()}>
              {save.isPending || test.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {connectionChanged ? t('Tester et enregistrer') : t('Enregistrer')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
