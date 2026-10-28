import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, AtSign, BadgeCheck, Copy, Download, FileCode2, FilePen, Forward, Info, Loader2, MoreHorizontal, Reply, ReplyAll, ShieldAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ComposeMode } from './composer';
import { copyText } from '@/lib/native';
import { useTRPC, type Message } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

type Auth = Message['auth'];

/**
 * Who really sent it, at a glance: a blue seal when the sender's own domain signed the mail
 * (the provider's DMARC/DKIM check), a red warning when the check failed (possible spoofing),
 * « via … » when a mailing service signed for the sender. Nothing when there is no result.
 */
export function AuthBadge({ auth }: { auth: Auth }) {
  if (auth.status === 'none') return null;
  const tip =
    auth.status === 'verified'
      ? t('Expéditeur vérifié : {domain} a signé ce mail (contrôle {by}).', { domain: auth.signedBy ?? auth.fromDomain, by: auth.checkedBy ?? 'DKIM' })
      : auth.status === 'failed'
        ? t('Authentification échouée : rien ne prouve que ce mail vient de {domain}. Méfiez-vous des liens et pièces jointes.', { domain: auth.fromDomain })
        : t('Signé par {domain}, un service d’envoi, pour le compte de l’expéditeur.', { domain: auth.signedBy ?? '' });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {auth.status === 'verified' ? (
          <BadgeCheck className="text-primary fill-primary/15 size-4 shrink-0 self-center" aria-label={t('Expéditeur vérifié')} />
        ) : auth.status === 'failed' ? (
          <span className="bg-destructive/10 text-destructive inline-flex h-[18px] shrink-0 items-center gap-1 self-center rounded-full px-1.5 text-[10.5px] font-medium">
            <ShieldAlert className="size-3" /> {t('Non authentifié')}
          </span>
        ) : (
          <span className="text-muted-foreground shrink-0 text-[11px]">{t('via {domain}', { domain: auth.signedBy ?? '' })}</span>
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-[280px]">{tip}</TooltipContent>
    </Tooltip>
  );
}

const CHECK_TONE: Record<string, string> = { pass: 'bg-success/10 text-success', fail: 'bg-destructive/10 text-destructive', softfail: 'bg-warning/10 text-warning' };

/** Every header that helps tell a real mail from a fake one (the « info » button). */
export function MessageInfo({ id }: { id: string }) {
  const trpc = useTRPC();
  const { data, isPending } = useQuery(trpc.mail.details.queryOptions({ id }));
  if (isPending) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 px-4 pb-3 text-[12px]">
        <Loader2 className="size-3.5 animate-spin" /> {t('Lecture des en-têtes…')}
      </div>
    );
  }
  if (!data) return null;
  const rows: [string, string | null][] = [
    [t('De'), data.from],
    [t('À'), data.to],
    [t('Cc'), data.cc],
    [t('Répondre à'), data.replyTo],
    [t('Reçu sur'), data.receivedOn],
    [t('Dossier'), data.folder],
    [t('Date'), data.date],
    [t('Objet'), data.subject],
    [t('Envoyé par (serveur)'), data.returnPath],
    [t('Logiciel d’envoi'), data.mailer],
    ['Message-ID', data.messageId],
    [t('Taille'), data.size > 1048576 ? `${(data.size / 1048576).toFixed(1)} Mo` : `${Math.ceil(data.size / 1024)} Ko`],
  ];
  const auth = data.auth;
  return (
    <div className="border-border bg-muted/40 mx-4 mb-3 rounded-lg border px-3.5 py-2.5 text-[12px]" onClick={(e) => e.stopPropagation()}>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words select-text">{value}</dd>
            </div>
          ))}
        <dt className="text-muted-foreground">{t('Authentification')}</dt>
        <dd className="flex flex-wrap items-center gap-1.5">
          {(['spf', 'dkim', 'dmarc'] as const).map((check) => (
            <span key={check} className={cn('rounded px-1.5 py-px text-[11px] font-medium uppercase', CHECK_TONE[auth[check]] ?? 'bg-muted text-muted-foreground')}>
              {check} {auth[check] === 'none' ? '—' : auth[check]}
            </span>
          ))}
          {auth.checkedBy ? <span className="text-muted-foreground text-[11px]">{t('contrôlé par {server}', { server: auth.checkedBy })}</span> : null}
          {auth.signedBy ? <span className="text-muted-foreground text-[11px]">· {t('signé par {domain}', { domain: auth.signedBy })}</span> : null}
        </dd>
      </dl>
    </div>
  );
}

/** « View source »: the raw message, copyable, with the .eml download. */
export function SourceDialog({ id, open, onOpenChange }: { id: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const trpc = useTRPC();
  const { data, isPending } = useQuery({ ...trpc.mail.source.queryOptions({ id }), enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showOverlay className="flex max-h-[86vh] max-w-[880px] flex-col gap-3">
        <DialogTitle className="text-[15px]">{t('Source du message')}</DialogTitle>
        <DialogDescription className="sr-only">{t('Le message brut, tel que reçu du serveur')}</DialogDescription>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!data}
            onClick={() => data && void copyText(data.text).then(() => toast.success(t('Source copiée')))}
            className="hover:bg-accent flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12.5px] disabled:opacity-50"
          >
            <Copy className="size-3.5" /> {t('Copier')}
          </button>
          <a href={`/api/messages/${id}/source`} className="hover:bg-accent flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12.5px]">
            <Download className="size-3.5" /> {t('Télécharger (.eml)')}
          </a>
          {data?.truncated ? <span className="text-muted-foreground self-center text-[12px]">{t('Aperçu limité à 2 Mo : téléchargez le fichier pour tout voir.')}</span> : null}
        </div>
        <pre className="bg-muted/50 border-border min-h-[200px] flex-1 overflow-auto rounded-lg border p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all select-text">
          {isPending ? t('Chargement…') : (data?.text ?? t('Source introuvable.'))}
        </pre>
      </DialogContent>
    </Dialog>
  );
}

/** The « ⋯ » of one message: everything Betterbird offers there, for this message only. */
export function MessageMenu({ message, onReply, onInfo, infoOpen }: { message: Message; onReply: (mode: ComposeMode) => void; onInfo: () => void; infoOpen: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [source, setSource] = useState(false);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.mail.thread.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.mail.list.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.mail.counts.queryKey() });
  };
  const archive = useMutation(trpc.mail.archiveMessage.mutationOptions({ onSuccess: () => (refresh(), toast.success(t('Message archivé'))) }));
  const trash = useMutation(trpc.mail.trashMessage.mutationOptions({ onSuccess: () => (refresh(), toast.success(t('Message supprimé'))) }));
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(e) => (e.stopPropagation(), onInfo())}
            aria-pressed={infoOpen}
            className={cn('text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-md hover:bg-accent', infoOpen && 'bg-accent text-foreground')}
            aria-label={t('Détails du message')}
          >
            <Info className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t('Détails : expéditeur, destinataires, authentification')}</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-md hover:bg-accent" aria-label={t('Plus d’actions')}>
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={() => onReply('reply')}>
            <Reply /> {t('Répondre')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onReply('replyAll')}>
            <ReplyAll /> {t('Répondre à tous')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onReply('forward')}>
            <Forward /> {t('Transférer')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onReply('editAsNew')}>
            <FilePen /> {t('Modifier comme nouveau')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {message.mailbox === 'inbox' ? (
            <DropdownMenuItem onClick={() => archive.mutate({ id: message.id })}>
              <Archive /> {t('Archiver ce message')}
            </DropdownMenuItem>
          ) : null}
          {message.mailbox !== 'trash' ? (
            <DropdownMenuItem onClick={() => trash.mutate({ id: message.id })} className="text-destructive focus:text-destructive">
              <Trash2 /> {t('Supprimer ce message')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onInfo}>
            <Info /> {infoOpen ? t('Masquer les détails') : t('Afficher les détails')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTimeout(() => setSource(true), 0)}>
            <FileCode2 /> {t('Voir la source')}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`/api/messages/${message.id}/source`}>
              <Download /> {t('Télécharger (.eml)')}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void copyText(message.from.email).then(() => toast.success(t('Adresse copiée')))}>
            <AtSign /> {t('Copier l’adresse de l’expéditeur')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {source ? <SourceDialog id={message.id} open={source} onOpenChange={setSource} /> : null}
    </>
  );
}
