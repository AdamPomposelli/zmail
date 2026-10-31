import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, AtSign, Check, CheckCheck, Layers, Download, Eye, FilePen, Flag, FolderInput, Forward, GitBranch, Mail, MailOpen, Reply, ReplyAll, Star, Tag as TagIcon2, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCatalog } from '@/hooks/use-catalog';
import { useSpaces } from '@/hooks/use-space';
import { SpaceIcon } from '@/components/sidebar/spaces';
import { useMailRoute } from '@/hooks/use-mail-route';
import type { ThreadAction } from '@/hooks/use-thread-actions';
import { copyText } from '@/lib/native';
import { TagIcon } from '@/lib/tag-icons';
import { useTRPC, type ThreadItem } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { flushViews } from '@/lib/track';

type Folder = { id: string; accountId: string; path: string; name: string; specialUse: string | null; delimiter: string | null };

/**
 * Right-click on a conversation of the list (also a two-finger click): what Betterbird offers on a
 * message, in ZMail's own menu. A row of one-click actions on top, then everything else.
 */
export function ThreadMenu({
  thread,
  onAction,
  onToggleExpand,
  expanded,
  children,
}: {
  thread: ThreadItem;
  onAction: (action: ThreadAction, id: string) => void;
  onToggleExpand?: (id: string) => void;
  expanded: boolean;
  children: ReactNode;
}) {
  return (
    // Non-modal: a modal menu that opens a dialog can leave the page unclickable (Radix lock).
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60" onClick={(e) => e.stopPropagation()}>
        <MenuBody thread={thread} onAction={onAction} onToggleExpand={onToggleExpand} expanded={expanded} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function MenuBody({ thread, onAction, onToggleExpand, expanded }: { thread: ThreadItem; onAction: (action: ThreadAction, id: string) => void; onToggleExpand?: (id: string) => void; expanded: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const route = useMailRoute();
  const catalog = useCatalog();
  const { data: folders } = useQuery(trpc.accounts.folders.queryOptions());
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.mail.list.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.mail.counts.queryKey() });
  };
  const move = useMutation(trpc.mail.moveToFolder.mutationOptions({ onSuccess: refresh, onError: (e) => toast.error(e.message) }));
  const setTags = useMutation(trpc.mail.setTags.mutationOptions({ onSuccess: refresh }));
  const setPriority = useMutation(trpc.mail.setPriority.mutationOptions({ onSuccess: refresh }));
  const { spaces } = useSpaces();
  const spaceMove = useMutation(trpc.mail.moveToSpace.mutationOptions({ onSuccess: refresh, onError: (e) => toast.error(e.message) }));
  const moveToSpace = (spaceId: string, name: string) => spaceMove.mutate({ threadIds: [thread.id], spaceId }, { onSuccess: () => toast.success(t('Déplacé vers l’espace {space}', { space: name })) });
  const inSpam = thread.spam || thread.mailbox === 'junk';
  const open = (compose?: string) => route.update({ thread: thread.id, msg: null, compose: compose ?? null });

  const quick: { label: string; icon: typeof Mail; run: () => void; danger?: boolean }[] = [
    { label: thread.unread ? t('Marquer comme lu') : t('Marquer comme non lu'), icon: thread.unread ? CheckCheck : Mail, run: () => onAction(thread.unread ? 'read' : 'unread', thread.id) },
    { label: t('Répondre'), icon: Reply, run: () => open('reply') },
    { label: t('Archiver'), icon: Archive, run: () => onAction('archive', thread.id) },
    { label: inSpam ? t('Ce n’est pas un spam') : t('Spam'), icon: Flag, run: () => onAction(inSpam ? 'notSpam' : 'spam', thread.id), danger: !inSpam },
    { label: t('Supprimer'), icon: Trash2, run: () => onAction(thread.mailbox === 'trash' ? 'deleteForever' : 'trash', thread.id), danger: true },
  ];

  // This account's folders, standard ones first, then the user's tree (indented).
  const boxes = ((folders ?? []) as Folder[]).filter((f) => f.accountId === thread.accountId && f.specialUse !== 'sent' && f.specialUse !== 'drafts');
  const standard = boxes.filter((f) => f.specialUse);
  const own = boxes
    .filter((f) => !f.specialUse)
    .map((f) => {
      const path = f.path.replace(/^\[(Gmail|Google Mail)\][/.]/, '');
      const parts = f.delimiter ? path.split(f.delimiter) : [path];
      return { ...f, depth: parts.length - 1, label: parts.at(-1) || f.name, key: parts.join('\u0000').toLowerCase() };
    })
    .filter((f) => !f.path.startsWith('ZMail'))
    .sort((a, b) => a.key.localeCompare(b.key));
  const STANDARD_LABEL: Record<string, string> = { inbox: t('Boîte de réception'), archive: t('Archives'), all: t('Archives'), junk: t('Spam'), trash: t('Corbeille') };
  const moveTo = (f: { id: string; specialUse: string | null; label?: string; name: string }) => {
    const special = { archive: 'archive', all: 'archive', junk: 'spam', trash: 'trash', inbox: 'restore' }[f.specialUse ?? ''] as ThreadAction | undefined;
    if (special) return onAction(special, thread.id);
    flushViews([thread.id]);
    move.mutate({ threadIds: [thread.id], mailboxId: f.id }, { onSuccess: () => toast.success(t('Déplacé dans {folder}', { folder: f.label ?? f.name })) });
  };

  return (
    <>
      <div className="flex items-center justify-between gap-0.5 px-1 pt-0.5 pb-1">
        {quick.map(({ label, icon: Icon, run, danger }) => (
          <Tooltip key={label}>
            <TooltipTrigger asChild>
              <ContextMenuItem
                onSelect={run}
                aria-label={label}
                className={cn('size-9 justify-center rounded-md p-0', danger && 'hover:text-destructive focus:text-destructive')}
              >
                <Icon />
              </ContextMenuItem>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => open()}>
        <Eye /> {t('Ouvrir')}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Reply /> {t('Répondre')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onSelect={() => open('reply')}>
            <Reply /> {t('Répondre')}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => open('replyAll')}>
            <ReplyAll /> {t('Répondre à tous')}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem onSelect={() => open('forward')}>
        <Forward /> {t('Transférer')}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => open('editAsNew')}>
        <FilePen /> {t('Modifier comme nouveau')}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <FolderInput /> {t('Déplacer vers')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-56">
          {standard.map((f) => (
            <ContextMenuItem key={f.id} disabled={thread.mailbox === f.specialUse} onSelect={() => moveTo({ ...f, label: STANDARD_LABEL[f.specialUse!] })}>
              {STANDARD_LABEL[f.specialUse!] ?? f.name}
            </ContextMenuItem>
          ))}
          {own.length ? <ContextMenuSeparator /> : null}
          {own.map((f) => (
            <ContextMenuItem key={f.id} onSelect={() => moveTo(f)} style={{ paddingLeft: 8 + f.depth * 14 }}>
              <span className="truncate">{f.label}</span>
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {spaces.length > 1 ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Layers /> {t('Déplacer vers l’espace')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-52">
            {spaces.map((space) => (
              <ContextMenuItem key={space.id} disabled={thread.spaceId === space.id} onSelect={() => moveToSpace(space.id, space.id === 'main' ? t(space.name) : space.name)}>
                <SpaceIcon space={space} size={15} />
                <span className="flex-1 truncate">{space.id === 'main' ? t(space.name) : space.name}</span>
                {thread.spaceId === space.id ? <Check className="size-3.5" /> : null}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <TagIcon2 /> {t('Catégorie')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-56">
          {catalog.tags.map((tag) => {
            const on = thread.tags.includes(tag.id);
            return (
              <ContextMenuCheckboxItem
                key={tag.id}
                checked={on}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={() => setTags.mutate({ threadIds: [thread.id], add: on ? [] : [tag.id], remove: on ? [tag.id] : [] })}
              >
                <TagIcon icon={tag.icon} color={tag.color} className="size-3.5" />
                <span className="truncate">{tag.name}</span>
              </ContextMenuCheckboxItem>
            );
          })}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <MailOpen /> {t('Marquer')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onSelect={() => onAction(thread.unread ? 'read' : 'unread', thread.id)}>
            {thread.unread ? <CheckCheck /> : <Mail />} {thread.unread ? t('Comme lu') : t('Comme non lu')}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onAction(thread.starred ? 'unstar' : 'star', thread.id)}>
            <Star /> {thread.starred ? t('Retirer des favoris') : t('Ajouter aux favoris')}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => setPriority.mutate({ threadIds: [thread.id], priority: thread.priority >= 2 ? 1 : 2 })}>
            <Flag /> {thread.priority >= 2 ? t('Pas important') : t('Important')}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onAction(inSpam ? 'notSpam' : 'spam', thread.id)}>
            <Flag /> {inSpam ? t('Ce n’est pas un spam') : t('Spam')}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {thread.count > 1 && onToggleExpand ? (
        <ContextMenuItem onSelect={() => onToggleExpand(thread.id)}>
          <GitBranch /> {expanded ? t('Replier la conversation') : t('Déplier la conversation')}
        </ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem asChild>
        <a href={`/api/messages/${thread.latestMessageId}/source`}>
          <Download /> {t('Enregistrer (.eml)')}
        </a>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void copyText(thread.from.email).then(() => toast.success(t('Adresse copiée')))}>
        <AtSign /> {t('Copier l’adresse de l’expéditeur')}
      </ContextMenuItem>
    </>
  );
}
