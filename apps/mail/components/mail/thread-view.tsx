import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowLeft,
  Briefcase,
  Check,
  ChevronDown,
  ChevronRight,
  CornerUpLeft,
  Copy,
  Download,
  Flame,
  Forward,
  Inbox,
  KeyRound,
  Loader2,
  MailOpen,
  Paperclip,
  Plus,
  Reply,
  ReplyAll,
  ShieldAlert,
  ShieldBan,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BlockedImagesNotice, EmailBody } from './email-body';
import { Composer, type ComposeMode } from './composer';
import { BusinessBadge, PRIORITY_META, SenderAvatar, TagChip } from './chips';
import { ReplyTree, type ReplyNode } from './reply-tree';
import { useCatalog } from '@/hooks/use-catalog';
import { useThreadActions, type ThreadAction } from '@/hooks/use-thread-actions';
import { useTRPC, type Message, type Thread } from '@/lib/trpc';
import { copyText, openExternal } from '@/lib/native';
import { cn, displayName, formatFullDate, formatListDate } from '@/lib/utils';
import { BrandLogo, brandForModel } from '@/components/brand-logo';
import { InfoHint } from '@/components/ui/info-hint';
import { FreeBadge } from '@/components/ui/free-badge';
import { t } from '@/lib/i18n';

function ToolbarButton({ label, onClick, children, danger }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn('text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-lg transition hover:bg-accent [&_svg]:size-4', danger && 'hover:text-destructive')}
          aria-label={label}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ThreadView({ threadId, focusMessageId, onClose }: { threadId: string; focusMessageId?: string | null; onClose: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { run, patchLists, refresh } = useThreadActions();
  const { data: thread, isPending, error } = useQuery(trpc.mail.thread.queryOptions({ id: threadId }));
  const open = useMutation(trpc.mail.open.mutationOptions());
  const opened = useRef<string | null>(null);
  const [composer, setComposer] = useState<{ mode: ComposeMode; message: Message } | null>(null);
  // The message to bring into view: picked in the list's reply tree, the map, or an "in reply to" link.
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(focusMessageId ? { id: focusMessageId, n: 1 } : null);
  const focusOn = (id: string) => setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  useEffect(() => {
    if (focusMessageId) setFocus((f) => (f?.id === focusMessageId ? f : { id: focusMessageId, n: (f?.n ?? 0) + 1 }));
  }, [focusMessageId]);

  useEffect(() => {
    if (!thread || opened.current === thread.id) return;
    opened.current = thread.id;
    setComposer(null);
    if (thread.unread) {
      patchLists([thread.id], (item) => ({ ...item, unread: false }));
      void open.mutateAsync({ threadId: thread.id }).then(() => queryClient.invalidateQueries({ queryKey: trpc.mail.counts.queryKey() }));
    }
  }, [thread, open, patchLists, queryClient, trpc]);

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }
  if (error || !thread) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-sm">
        {t('Conversation introuvable.')}
        <button onClick={onClose} className="underline">
          {t('Fermer')}
        </button>
      </div>
    );
  }

  const act = (action: ThreadAction) => {
    void run(action, [thread.id]);
    if (['archive', 'trash', 'spam', 'notSpam', 'restore', 'deleteForever'].includes(action)) onClose();
  };
  const inSpam = thread.spam || thread.mailbox === 'junk';
  const inTrash = thread.mailbox === 'trash';
  const latest = thread.messages.at(-1)!;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div data-drag-region className="flex h-12 shrink-0 items-center gap-0.5 border-b border-border px-3">
        <ToolbarButton label={t('Fermer (Échap)')} onClick={onClose}>
          <ArrowLeft />
        </ToolbarButton>
        <div className="bg-border mx-1 h-4 w-px" />
        {inTrash || thread.mailbox === 'archive' || thread.mailbox === 'all' ? (
          <ToolbarButton label={t('Remettre dans la boîte de réception')} onClick={() => act('restore')}>
            <Inbox />
          </ToolbarButton>
        ) : (
          <ToolbarButton label={t('Archiver (E)')} onClick={() => act('archive')}>
            <Archive />
          </ToolbarButton>
        )}
        {inSpam ? (
          <ToolbarButton label={t('Ce n’est pas un spam')} onClick={() => act('notSpam')}>
            <ShieldAlert />
          </ToolbarButton>
        ) : (
          <ToolbarButton label={t('Spam (!)')} onClick={() => act('spam')}>
            <ShieldBan />
          </ToolbarButton>
        )}
        <ToolbarButton label={inTrash ? t('Supprimer définitivement') : t('Supprimer (#)')} onClick={() => act(inTrash ? 'deleteForever' : 'trash')} danger>
          <Trash2 />
        </ToolbarButton>
        <div className="bg-border mx-1 h-4 w-px" />
        <ToolbarButton label={t('Marquer comme non lu (U)')} onClick={() => act('unread')}>
          <MailOpen />
        </ToolbarButton>
        <ToolbarButton label={thread.starred ? t('Ne plus suivre') : t('Suivre (S)')} onClick={() => act(thread.starred ? 'unstar' : 'star')}>
          <Star className={cn(thread.starred && 'fill-warning text-warning')} />
        </ToolbarButton>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setComposer({ mode: 'reply', message: latest })} className="hover:bg-accent hover:text-accent-foreground flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium">
            <Reply className="size-4" />
            {t('Répondre')}
          </button>
        </div>
      </div>

      <div className="scrollbar scrollbar-w-1 scrollbar-thumb-border min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[860px] px-6 pt-5 pb-10">
          <h2 className="text-[19px] leading-snug font-semibold tracking-tight text-balance">{thread.subject || t('(sans objet)')}</h2>
          <TriageBar thread={thread} onChanged={refresh} />

          {thread.otp ? <OtpCard code={thread.otp} date={latest.date} /> : null}
          <InsightCard thread={thread} />

          <ThreadMap thread={thread} activeId={focus?.id ?? null} onSelect={focusOn} />

          <div className="mt-4 space-y-3">
            {thread.messages.map((message, index) => (
              <MessageCard
                key={message.id}
                message={message}
                parent={message.parentId ? thread.messages.find((m) => m.id === message.parentId) : undefined}
                previousId={thread.messages[index - 1]?.id}
                onShowParent={focusOn}
                focusToken={focus?.id === message.id ? focus.n : 0}
                defaultOpen={index === thread.messages.length - 1 || message.unread || focus?.id === message.id}
                onReply={(mode) => setComposer({ mode, message })}
                unsubscribe={thread.newsletter && thread.unsubscribe && index === thread.messages.length - 1 ? <UnsubscribeLink threadId={thread.id} /> : null}
              />
            ))}
          </div>

          {composer ? (
            <Composer key={`${composer.mode}-${composer.message.id}`} className="mt-4" mode={composer.mode} thread={thread} message={composer.message} onClose={() => setComposer(null)} />
          ) : (
            <div className="mt-4 flex gap-2">
              {[
                { mode: 'reply' as const, label: t('Répondre'), icon: Reply },
                { mode: 'replyAll' as const, label: t('Répondre à tous'), icon: ReplyAll },
                { mode: 'forward' as const, label: t('Transférer'), icon: Forward },
              ].map(({ mode, label, icon: Icon }) => (
                <button
                  key={mode}
                  onClick={() => setComposer({ mode, message: latest })}
                  className="text-foreground/80 hover:text-foreground flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] border border-border transition hover:bg-accent"
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TriageBar({ thread, onChanged }: { thread: Thread; onChanged: () => void }) {
  const trpc = useTRPC();
  const catalog = useCatalog();
  const setTags = useMutation(trpc.mail.setTags.mutationOptions({ onSuccess: onChanged }));
  const setBusiness = useMutation(trpc.mail.setBusiness.mutationOptions({ onSuccess: onChanged }));
  const setPriority = useMutation(trpc.mail.setPriority.mutationOptions({ onSuccess: onChanged }));
  const reclassify = useMutation(trpc.mail.reclassify.mutationOptions({ onSuccess: () => (onChanged(), toast.success(t('Mail reclassé par l’IA'))) }));
  const business = thread.businessId ? catalog.businessById.get(thread.businessId) : undefined;
  const tags = thread.tags.map((id) => catalog.tagById.get(id)).filter((t) => t !== undefined);
  const priority = PRIORITY_META[thread.priority]!;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger className={cn('inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs font-semibold', priority.badge)}>
          <Flame className="size-3" strokeWidth={2.4} />
          {t('Priorité {level}', { level: priority.label.toLowerCase() })}
          <ChevronDown className="size-3 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{t('Priorité')}</DropdownMenuLabel>
          {[3, 2, 1, 0].map((p) => (
            <DropdownMenuItem key={p} onClick={() => setPriority.mutate({ threadIds: [thread.id], priority: p as 0 | 1 | 2 | 3 })}>
              <span className={cn('size-2 rounded-full', PRIORITY_META[p]!.dot)} />
              {PRIORITY_META[p]!.label}
              {thread.priority === p ? <Check className="ml-auto size-3.5" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex items-center">
          {business ? (
            <BusinessBadge business={business} />
          ) : (
            <span className="text-muted-foreground inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] border border-dashed border-border">
              <Briefcase className="size-3" />
              {t('Business')}
            </span>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{t('Rattacher au business')}</DropdownMenuLabel>
          {catalog.businesses.map((b) => (
            <DropdownMenuItem key={b.id} onClick={() => setBusiness.mutate({ threadIds: [thread.id], businessId: b.id })}>
              <span>{b.emoji ?? '•'}</span>
              {b.name}
              {thread.businessId === b.id ? <Check className="ml-auto size-3.5" /> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setBusiness.mutate({ threadIds: [thread.id], businessId: null })}>{t('Aucun')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {tags.map((tag) => (
        <TagChip key={tag.id} tag={tag} onRemove={() => setTags.mutate({ threadIds: [thread.id], add: [], remove: [tag.id] })} />
      ))}

      <Popover>
        <PopoverTrigger className="text-muted-foreground hover:text-foreground inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] border border-border">
          <Plus className="size-3" />
          {t('Catégorie')}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1">
          {catalog.tags
            .filter((tg) => !thread.tags.includes(tg.id))
            .map((tg) => (
              <button key={tg.id} onClick={() => setTags.mutate({ threadIds: [thread.id], add: [tg.id], remove: [] })} className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]">
                <span className="size-2 rounded-full" style={{ backgroundColor: tg.color }} />
                {t(tg.name)}
              </button>
            ))}
        </PopoverContent>
      </Popover>

      <button
        onClick={() => reclassify.mutate({ threadIds: [thread.id] })}
        className="text-muted-foreground hover:text-foreground ml-auto inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px]"
        title={t('Relancer la classification IA')}
      >
        {reclassify.isPending ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
        {t('Re-classer')}
      </button>
    </div>
  );
}

function OtpCard({ code, date }: { code: string; date: number }) {
  const [copied, setCopied] = useState(false);
  const minutes = Math.round((Date.now() - date) / 60000);
  const stale = minutes > 15;
  return (
    <div className="mt-4 flex items-center gap-4 rounded-xl bg-ai/10 p-4 border border-ai/20">
      <div className="flex size-10 items-center justify-center rounded-lg bg-ai/15 text-ai">
        <KeyRound className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground text-xs">{t('Code de vérification détecté')} {stale ? t('· reçu il y a {age}, sans doute expiré', { age: minutes > 90 ? `${Math.round(minutes / 60)} h` : `${minutes} min` }) : ''}</p>
        <p className={cn('font-mono text-[26px] leading-tight font-semibold tracking-[0.18em]', stale && 'opacity-50')}>{code}</p>
      </div>
      <button
        onClick={() =>
          void copyText(code).then(() => {
            setCopied(true);
            toast.success(t('Code copié'));
            setTimeout(() => setCopied(false), 2000);
          })
        }
        className="flex h-9 items-center gap-2 rounded-lg bg-ai px-3.5 text-[13px] font-medium text-ai-foreground shadow-sm transition hover:bg-ai/90"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? t('Copié') : t('Copier le code')}
      </button>
    </div>
  );
}

function InsightCard({ thread }: { thread: Thread }) {
  const engine = thread.messages.at(-1)?.triage?.engine;
  const engineLabel = engine === 'apple' ? 'Apple Intelligence' : engine === 'heuristic' ? t('Moteur local') : engine?.startsWith('consensus:') ? t('Double vérification') : engine?.startsWith('typesafe/') ? `Jev ${engine.replace(/^typesafe\/jev-/, '')}` : engine ? engine.replace(/^[^/]+\//, '') : null;
  if (!thread.summary && !thread.opportunity && !thread.spam) return null;
  // Jev and the local engine sort but write no text: their « summary » is the mail's first sentence.
  const written = Boolean(engine && engine !== 'heuristic' && !/^typesafe\//.test(engine));
  return (
    <div className="mt-4 rounded-xl bg-muted p-4 border border-border">
      <div className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase">
        <Sparkles className="size-3 text-ai" />
        {thread.summary ? (written ? t('Résumé IA') : t('En bref')) : t('Détecté par l’IA')}
        {thread.summary ? (
          <span className="tracking-normal normal-case">
            <InfoHint>
              {written
                ? t('Ce que l’expéditeur veut, en une phrase, écrit par l’IA à l’arrivée du mail. Le même résumé s’affiche dans la liste, après l’icône ✦.')
                : t('La première phrase du mail. Le modèle qui trie vos mails décide (spam, priorité, tags, code) mais n’écrit pas de texte.')}
            </InfoHint>
          </span>
        ) : null}
        {engineLabel ? (
          <span className="ml-auto flex items-center gap-1 font-normal tracking-normal normal-case opacity-80">
            <BrandLogo brand={engine === 'apple' ? 'apple-intelligence' : brandForModel(engine)} size={12} />
            {engineLabel}
            {engine === 'apple' ? <FreeBadge /> : null}
          </span>
        ) : null}
      </div>
      {thread.summary ? <p className="text-[14px] leading-relaxed">{thread.summary}</p> : null}
      {thread.opportunity ? (
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-success/10 px-3 py-2 text-[13px] text-success">
          <Sparkles className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <b className="font-semibold">{t('Opportunité business')}</b> — {thread.opportunityReason}
          </span>
        </p>
      ) : null}
      {thread.spam ? (
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <b className="font-semibold">{t('Spam probable')}</b> — {t('{reason}. Il a été retiré de votre boîte de réception.', { reason: thread.spamReason ?? t('contenu suspect') })}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** A discreet « Se désinscrire » next to the sender, like Gmail; the agent does the work. */
function UnsubscribeLink({ threadId }: { threadId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const unsubscribe = useMutation(
    trpc.mail.unsubscribe.mutationOptions({
      onSuccess: (outcome) => {
        void queryClient.invalidateQueries({ queryKey: trpc.mail.subscriptions.queryKey() });
        if (outcome.status === 'success') toast.success(t('Désinscription réussie'), { description: outcome.detail });
        else toast.error(t('Désinscription impossible'), { description: outcome.detail, action: outcome.manualUrl ? { label: t('Ouvrir la page'), onClick: () => openExternal(outcome.manualUrl!) } : undefined });
      },
    }),
  );
  const result = unsubscribe.data;
  const base = 'shrink-0 text-xs underline-offset-2';
  if (result?.status === 'success')
    return (
      <span className={cn(base, 'flex items-center gap-1 text-success')}>
        <Check className="size-3" /> {t('Désinscrit')}
      </span>
    );
  if (result?.status === 'failed' && result.manualUrl)
    return (
      <button onClick={(e) => (e.stopPropagation(), openExternal(result.manualUrl!))} className={cn(base, 'text-destructive hover:underline')}>
        {t('Terminer sur le site')}
      </button>
    );
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        unsubscribe.mutate({ threadId });
      }}
      disabled={unsubscribe.isPending}
      title={t('L’agent ZMail se désinscrit pour vous')}
      className={cn(base, 'text-muted-foreground hover:text-foreground flex items-center gap-1 hover:underline disabled:no-underline')}
    >
      {unsubscribe.isPending ? <Loader2 className="size-3 animate-spin" /> : null}
      {unsubscribe.isPending ? t('Désinscription…') : t('Se désinscrire')}
    </button>
  );
}

/**
 * The conversation's tree (who answers whom), above the messages when there are enough of them
 * for the order to matter. A click brings that message into view.
 */
function ThreadMap({ thread, activeId, onSelect }: { thread: Thread; activeId: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(thread.messages.length <= 12);
  if (thread.messages.length < 3) return null;
  const byId = new Map(thread.messages.map((m) => [m.id, m]));
  const nodes: ReplyNode[] = thread.tree.flatMap((node) => {
    const m = byId.get(node.id);
    return m
      ? [{ ...node, subject: m.subject, from: { name: m.from.name, email: m.from.email }, date: m.date, unread: m.unread, starred: m.starred, mailbox: m.mailbox, isReply: Boolean(m.parentId) || m.references.length > 0, hasAttachments: m.attachments.some((a) => !a.inline) }]
      : [];
  });
  const deepest = Math.max(...thread.tree.map((n) => n.depth));
  const branches = thread.tree.filter((n) => n.depth > 0 && !n.last).length;

  return (
    <section className="border-border mt-4 rounded-xl border">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="hover:bg-accent/50 flex w-full items-center gap-2 rounded-xl px-3.5 py-2.5 text-left">
        <ChevronRight className={cn('text-muted-foreground size-3.5 transition-transform duration-200', open && 'rotate-90')} />
        <span className="text-[12.5px] font-medium">{t('Fil de la conversation')}</span>
        <span className="text-muted-foreground text-[12px]">
          {t('{n} messages', { n: thread.messages.length })}
          {deepest > 1 ? ` · ${t('{n} niveaux de réponses', { n: deepest })}` : ''}
          {branches ? ` · ${t('{n} branches', { n: branches + 1 })}` : ''}
        </span>
      </button>
      {open ? <ReplyTree className="zm-unfold px-1.5 pb-1.5" nodes={nodes} activeId={activeId} onSelect={(node) => onSelect(node.id)} /> : null}
    </section>
  );
}

function MessageCard({
  message,
  parent,
  previousId,
  onShowParent,
  focusToken,
  defaultOpen,
  onReply,
  unsubscribe,
}: {
  message: Message;
  parent?: Message;
  previousId?: string;
  onShowParent: (id: string) => void;
  focusToken: number;
  defaultOpen: boolean;
  onReply: (mode: ComposeMode) => void;
  unsubscribe?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = card.current;
    if (!focusToken || !node) return;
    setOpen(true);
    requestAnimationFrame(() => {
      node.scrollIntoView({ block: 'start', behavior: 'smooth' });
      node.classList.remove('zm-focus-message');
      void node.offsetWidth; // restart the highlight when the same message is picked again
      node.classList.add('zm-focus-message');
    });
  }, [focusToken]);
  const [allowImages, setAllowImages] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const catalog = useCatalog();
  const account = catalog.accountById.get(message.accountId);
  const files = message.attachments.filter((a) => !a.inline);
  const recipients = [...message.to, ...message.cc].map((a) => (a.email === account?.email ? t('moi') : displayName(a))).join(', ');

  return (
    <article ref={card} data-message-id={message.id} className={cn('scroll-mt-4 rounded-xl border border-border transition', !open && 'hover:bg-accent/50')}>
      <header className="flex cursor-default items-center gap-3 px-4 py-3" onClick={() => setOpen(!open)}>
        <SenderAvatar name={message.from.name} email={message.from.email} size={34} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[13.5px] font-semibold">{displayName(message.from)}</span>
            <span className="text-muted-foreground truncate text-xs">{message.from.email}</span>
            {unsubscribe ? (
              <>
                <span className="text-muted-foreground/50 text-xs">·</span>
                {unsubscribe}
              </>
            ) : null}
            {message.mailbox === 'sent' ? <span className="rounded-sm bg-primary/10 px-1 text-[10px] font-medium text-primary">{t('Envoyé')}</span> : null}
          </div>
          <p className="text-muted-foreground truncate text-xs">{open ? t('À {recipients}', { recipients: recipients || '—' }) : message.text.replace(/\s+/g, ' ').slice(0, 140)}</p>
          {/* When the mail it answers is not the one just above (a branch), say which one it is. */}
          {parent && parent.id !== previousId ? (
            <button
              type="button"
              onClick={(e) => (e.stopPropagation(), onShowParent(parent.id))}
              className="text-ai hover:text-foreground mt-0.5 flex max-w-full items-center gap-1 text-[11.5px]"
              title={t('Afficher le message auquel celui-ci répond')}
            >
              <CornerUpLeft className="size-3 shrink-0" />
              <span className="truncate">
                {t('En réponse à {name} · {date}', { name: displayName(parent.from), date: formatListDate(parent.date) })}
              </span>
            </button>
          ) : null}
        </div>
        <time className="text-muted-foreground shrink-0 text-xs" title={formatFullDate(message.date)}>
          {formatListDate(message.date)}
        </time>
        {open ? (
          <DropdownMenu>
            <DropdownMenuTrigger onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-md hover:bg-accent">
              <ChevronDown className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onReply('reply')}>
                <Reply /> {t('Répondre')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onReply('replyAll')}>
                <ReplyAll /> {t('Répondre à tous')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onReply('forward')}>
                <Forward /> {t('Transférer')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>
      {open ? (
        <div className="px-4 pb-4">
          {blocked && !allowImages ? <BlockedImagesNotice onAllow={() => setAllowImages(true)} /> : null}
          <EmailBody messageId={message.id} html={message.html} text={message.text} allowImages={allowImages} onBlockedImages={setBlocked} />
          {files.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {files.map((file) => (
                <a
                  key={file.index}
                  href={`/api/messages/${message.id}/attachments/${file.index}?download=1`}
                  className="flex h-10 items-center gap-2 rounded-lg px-3 text-[13px] border border-border transition hover:bg-accent"
                >
                  <Paperclip className="text-muted-foreground size-3.5" />
                  <span className="max-w-[220px] truncate">{file.filename}</span>
                  <span className="text-muted-foreground text-xs">{file.size > 1048576 ? t('{size} Mo', { size: (file.size / 1048576).toFixed(1) }) : t('{size} Ko', { size: Math.ceil(file.size / 1024) })}</span>
                  <Download className="text-muted-foreground size-3.5" />
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
