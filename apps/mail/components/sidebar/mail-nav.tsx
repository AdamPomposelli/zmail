import { AlertCircle } from 'lucide-react';
import { solar, type IconComponent } from '@/components/ui/solar-icon';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BrandLogo, brandForProvider } from '@/components/brand-logo';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowRightLeft as MoveIcon, ArrowUpToLine, Check, CheckCheck, EyeOff, FolderPlus, ImageIcon, Plus, RotateCcw as RefreshIcon } from 'lucide-react';
import { TagStylePopover } from '@/components/tag-style-picker';
import { CategoryDialog } from '@/components/category-dialog';
import { AccountWizard } from '@/components/onboarding/account-wizard';
import { ContextMenuCheckboxItem, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from '@/components/ui/context-menu';
import { SpaceIcon } from '@/components/sidebar/spaces';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { NavItem, RowAction, Section } from './nav';
import { DeleteFolderDialog, NewFolderDialog } from './folder-dialogs';
import { AccountIcon, AccountIconPopover } from '@/components/account-icon';
import { IconPicker } from '@/components/icon-picker';
import { useSidebarDrag, type DropTarget } from './use-sidebar-drag';
import { useCatalog } from '@/hooks/use-catalog';
import { MAIN_SPACE, useScopedSpaceId, useSpaces } from '@/hooks/use-space';
import { useTRPC, type Tag, type View } from '@/lib/trpc';
import { TagIcon } from '@/lib/tag-icons';
import { cn } from '@/lib/utils';
import { t, tp } from '@/lib/i18n';

const Inbox = solar('_inbox');
const Star = solar('_starred');
const UserMinus = solar('_unsubscribe');
const Send = solar('_sent');
const FileEdit = solar('_drafts');
const Archive = solar('_archive');
const ShieldBan = solar('_spam');
const Trash2 = solar('_trash');
const Folder = solar('_folder');
const Settings = solar('_settings');
const Mailbox = solar('_mailbox');
const Pin = solar('_pin');
const PinOff = solar('_unpin');
const Pencil = solar('_signatures');
const Palette = solar('_appearance');
const TrashIcon = solar('_trash');
const PlugIcon = solar('_mcp');

type Counts = {
  views: Partial<Record<View, number>>;
  mailboxes?: Record<string, number>;
  businesses: Record<string, number>;
  tags: Record<string, number>;
  accounts: Record<string, number>;
};

/** Views that always stay in the pinned section (they can be reordered, not removed). */
const FIXED_VIEWS = {
  'view:inbox': { label: t('Boîte de réception'), icon: Inbox, to: '/mail/inbox', view: 'inbox' },
  'view:starred': { label: t('Favoris'), icon: Star, to: '/mail/starred', view: 'starred' },
  'view:subscriptions': { label: t('Abonnements'), icon: UserMinus, to: '/subscriptions', view: null },
} as const;
type FixedKey = keyof typeof FIXED_VIEWS;
const isFixed = (key: string): key is FixedKey => key in FIXED_VIEWS;
const DEFAULT_PINNED = ['view:inbox', 'tag:important', 'tag:to-respond', 'view:starred', 'view:subscriptions'];

/** A server folder's standard role, shown with the usual name and icon. */
const SPECIAL_FOLDERS: { special: string; view: View; label: string; icon: IconComponent }[] = [
  // Each account's own inbox, first, as in every mail client (the account row also opens it).
  { special: 'inbox', view: 'inbox', label: t('Boîte de réception'), icon: Inbox },
  { special: 'sent', view: 'sent', label: t('Envoyés'), icon: Send },
  { special: 'drafts', view: 'drafts', label: t('Brouillons'), icon: FileEdit },
  { special: 'archive', view: 'archive', label: t('Archives'), icon: Archive },
  { special: 'junk', view: 'spam', label: t('Spam'), icon: ShieldBan },
  { special: 'trash', view: 'trash', label: t('Corbeille'), icon: Trash2 },
];

type Folder = { id: string; accountId: string; path: string; name: string; specialUse: string | null; delimiter: string | null };

type ViewStyle = { label?: string; icon?: string | null; color?: string };

type SpaceLayout = { pinned?: string[]; order?: string[] };

/** Pinned order and the order of the other categories, saved with the UI preferences, per space. */
function useSidebarLayout(spaceId: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: ui } = useQuery(trpc.settings.get.queryOptions());
  const key = trpc.settings.get.queryKey();
  const save = useMutation(
    trpc.settings.save.mutationOptions({
      onMutate: (patch) => queryClient.setQueryData(key, (prev: Record<string, unknown> | undefined) => ({ ...prev, ...patch })),
      onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
    }),
  );
  // Each space keeps its own pinned rows; « main » inherits the layout saved before spaces existed.
  const layouts = (ui?.spaceLayouts ?? {}) as Record<string, SpaceLayout>;
  const mine = layouts[spaceId];
  const legacy = spaceId === MAIN_SPACE;
  const stored = Array.isArray(mine?.pinned) ? mine.pinned : legacy && Array.isArray(ui?.sidebarPinned) ? (ui.sidebarPinned as string[]) : DEFAULT_PINNED;
  // The fixed views can never get lost, even from an older saved order.
  const pinned = [...stored.filter((k, i) => stored.indexOf(k) === i), ...Object.keys(FIXED_VIEWS).filter((k) => !stored.includes(k))];
  const order = Array.isArray(mine?.order) ? mine.order : legacy && Array.isArray(ui?.categoryOrder) ? (ui.categoryOrder as string[]) : [];
  // Your own name and icon for the fixed views (inbox, followed, subscriptions).
  const viewStyle = (ui?.viewStyle ?? {}) as Record<string, ViewStyle>;
  return {
    pinned,
    order,
    viewStyle,
    save: (patch: { sidebarPinned?: string[]; categoryOrder?: string[] }) =>
      save.mutate({ spaceLayouts: { ...layouts, [spaceId]: { pinned: patch.sidebarPinned ?? stored, order: patch.categoryOrder ?? order } } }),
    setViewStyle: (key: string, style: ViewStyle | null) => {
      const next = { ...viewStyle };
      if (style) next[key] = style;
      else delete next[key];
      save.mutate({ viewStyle: next });
    },
  };
}

/** A fixed view's name and icon, with the user's own choices applied. */
function viewLook(key: FixedKey, style?: ViewStyle) {
  const v = FIXED_VIEWS[key];
  return { label: style?.label?.trim() || v.label, icon: style?.icon ? <TagIcon icon={style.icon} color={style.color ?? 'currentColor'} /> : <v.icon /> };
}

/** Icon picker for a fixed view: any icon, an emoji or an image, or back to the original one. */
function ViewIconPopover({ value, title, fallback, onChange, children, open, onOpenChange }: { value?: ViewStyle; title: string; fallback: ReactNode; onChange: (s: ViewStyle | null) => void; children: ReactNode; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" side="right" className="w-auto p-3">
        <IconPicker
          title={title}
          value={value?.icon ?? null}
          color={value?.color ?? '#71717a'}
          fallback={fallback}
          onChange={(icon) => onChange({ ...value, icon })}
          onColor={(color) => onChange({ ...value, color })}
        />
      </PopoverContent>
    </Popover>
  );
}

/** The row icon, as a button opening the icon & colour picker. */
function StyleableIcon({ tag, icon, open, onOpenChange }: { tag: Tag; icon: ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  return (
    <TagStylePopover tag={tag} open={open} onOpenChange={onOpenChange}>
      <button
        type="button"
        data-no-drag
        className="hover:bg-sidebar-accent focus-visible:ring-ring/50 flex size-6 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
        aria-label={t('Icône et couleur de {name}', { name: t(tag.name) })}
        title={t('Changer l’icône et la couleur')}
      >
        {icon}
      </button>
    </TagStylePopover>
  );
}

/** Two clicks closer than this on an account rename it (faster than the system's double-click). */
const DOUBLE_CLICK_MS = 250;

export function MailNav({ counts }: { counts?: Counts }) {
  const catalog = useCatalog();
  const { pathname } = useLocation();
  const [search] = useSearchParams();
  const spaceId = useScopedSpaceId();
  const layout = useSidebarLayout(spaceId);
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const refreshTags = () => void queryClient.invalidateQueries({ queryKey: trpc.catalog.tags.queryKey() });
  const saveTag = useMutation(trpc.catalog.saveTag.mutationOptions({ onSuccess: refreshTags, onError: (e) => toast.error(e.message) }));
  const removeTag = useMutation(trpc.catalog.removeTag.mutationOptions({ onSuccess: refreshTags, onError: (e) => toast.error(e.message) }));
  const setHide = useMutation(
    trpc.catalog.setHideFromInbox.mutationOptions({
      onSuccess: () => {
        refreshTags();
        void queryClient.invalidateQueries({ queryKey: trpc.mail.pathKey() });
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  // Which row is being renamed in place, whose icon picker is open, which category is edited.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [styling, setStyling] = useState<string | null>(null);
  const [editing, setEditing] = useState<Tag | null>(null);

  const currentView = pathname.startsWith('/mail/') ? (pathname.split('/')[2] as View) : null;
  const business = search.get('business');
  const tag = search.get('tag');
  const account = search.get('account');
  const mailbox = search.get('mailbox');
  const plain = !business && !tag && !account && !mailbox;

  // The shared categories, and the current space's own.
  const tags = catalog.tags.filter((tg) => !tg.spaceId || tg.spaceId === spaceId);
  const tagKey = (t: Tag) => `tag:${t.id}`;
  const pinnedItems = layout.pinned.filter((k) => isFixed(k) || tags.some((t) => tagKey(t) === k));
  const rank = (t: Tag) => {
    const i = layout.order.indexOf(tagKey(t));
    return i === -1 ? layout.order.length + tags.indexOf(t) : i;
  };
  const categories = tags.filter((t) => !layout.pinned.includes(tagKey(t))).sort((a, b) => rank(a) - rank(b));
  const categoryKeys = categories.map(tagKey);

  const insert = (list: string[], key: string, index: number) => {
    const rest = list.filter((k) => k !== key);
    return [...rest.slice(0, index), key, ...rest.slice(index)];
  };
  const move = (key: string, to: DropTarget) => {
    if (to.list === 'pinned') layout.save({ sidebarPinned: insert(pinnedItems, key, to.index), categoryOrder: categoryKeys.filter((k) => k !== key) });
    else layout.save({ sidebarPinned: pinnedItems.filter((k) => k !== key), categoryOrder: insert(categoryKeys, key, to.index) });
  };
  const pin = (key: string) => move(key, { list: 'pinned', index: pinnedItems.length });
  const unpin = (key: string) => move(key, { list: 'categories', index: 0 });

  // Fixed views stay pinned; categories move freely between the two lists.
  const { drag, onPointerDown, ghost } = useSidebarDrag({ canDrop: (key, list) => list === 'pinned' || !isFixed(key), onDrop: (key, _from, to) => move(key, to) });

  const deleteCategory = (row: Tag) => {
    const builtIn = row.kind === 'system';
    const message = builtIn
      ? t('Supprimer la catégorie « {name} » ? L’IA ne l’utilisera plus. Vous pourrez la rétablir dans Réglages → Catégories.', { name: t(row.name) })
      : t('Supprimer la catégorie « {name} » ? Les mails restent, ils perdent seulement cette catégorie.', { name: t(row.name) });
    if (!window.confirm(message)) return;
    removeTag.mutate({ id: row.id }, { onSuccess: () => toast.success(t('Catégorie « {name} » supprimée', { name: t(row.name) })) });
  };

  const categoryRow = (row: Tag, pinnedRow: boolean) => {
    const key = tagKey(row);
    return (
      <NavItem
        to={`/mail/inbox?tag=${row.id}`}
        active={tag === row.id}
        icon={<TagIcon icon={row.icon} color={row.color} />}
        iconWrap={(icon) => <StyleableIcon tag={row} icon={icon} open={styling === key} onOpenChange={(o) => setStyling(o ? key : null)} />}
        label={t(row.name)}
        count={counts?.tags[row.id]}
        onPointerDown={onPointerDown(key, pinnedRow ? 'pinned' : 'categories')}
        // Double-click: the category's settings (name, what it is about, icon, hidden from the inbox).
        onDoubleClick={() => setEditing(row)}
        badge={
          row.hideFromInbox ? (
            <EyeOff className="text-muted-foreground/70 size-3 shrink-0" aria-label={t('Masquée de la boîte de réception')}>
              <title>{t('Masquée de la boîte de réception')}</title>
            </EyeOff>
          ) : undefined
        }
        renaming={
          renaming === key
            ? {
                value: t(row.name),
                onDone: (name) => {
                  setRenaming(null);
                  if (name) saveTag.mutate({ id: row.id, name, description: row.description, color: row.color, icon: row.icon ?? null });
                },
              }
            : undefined
        }
        menu={
          <>
            <ContextMenuLabel>{t(row.name)}</ContextMenuLabel>
            <ContextMenuItem onSelect={() => setRenaming(key)}>
              <Pencil /> {t('Renommer')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => setTimeout(() => setStyling(key), 0)}>
              <Palette /> {t('Icône et couleur…')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => setTimeout(() => setEditing(row), 0)}>
              <Settings /> {t('Modifier la catégorie…')}
            </ContextMenuItem>
            <ContextMenuCheckboxItem
              checked={row.hideFromInbox}
              onCheckedChange={(hide) =>
                setHide.mutate(
                  { id: row.id, hide: Boolean(hide) },
                  { onSuccess: () => toast.success(hide ? t('« {name} » n’apparaît plus dans la boîte de réception', { name: t(row.name) }) : t('« {name} » réapparaît dans la boîte de réception', { name: t(row.name) })) },
                )
              }
            >
              {t('Masquer de la boîte de réception')}
            </ContextMenuCheckboxItem>
            <ContextMenuSeparator />
            {pinnedRow ? (
              <ContextMenuItem onSelect={() => unpin(key)}>
                <PinOff /> {t('Désépingler')}
              </ContextMenuItem>
            ) : (
              <ContextMenuItem onSelect={() => pin(key)}>
                <Pin /> {t('Épingler en haut')}
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem destructive onSelect={() => deleteCategory(row)}>
              <TrashIcon /> {t('Supprimer')}
            </ContextMenuItem>
          </>
        }
        actions={
          pinnedRow ? (
            <RowAction label={t('Désépingler')} onClick={() => unpin(key)}>
              <PinOff />
            </RowAction>
          ) : (
            <RowAction label={t('Épingler en haut')} onClick={() => pin(key)}>
              <Pin />
            </RowAction>
          )
        }
      />
    );
  };

  const fixedRow = (key: FixedKey) => {
    const v = FIXED_VIEWS[key];
    const style = layout.viewStyle[key];
    const look = viewLook(key, style);
    const active = v.view ? currentView === v.view && plain : pathname === v.to;
    return (
      <NavItem
        to={v.to}
        active={active}
        icon={look.icon}
        iconWrap={(icon) => (
          <ViewIconPopover value={style} title={look.label} fallback={(() => { const Default = FIXED_VIEWS[key].icon; return <Default className="size-5" />; })()} onChange={(next) => layout.setViewStyle(key, next && (next.label || next.icon) ? next : null)} open={styling === key} onOpenChange={(o) => setStyling(o ? key : null)}>
            <button type="button" data-no-drag className="hover:bg-sidebar-accent focus-visible:ring-ring/50 flex size-6 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none" aria-label={t('Changer l’icône de {name}', { name: look.label })} title={t('Changer l’icône')}>
              {icon}
            </button>
          </ViewIconPopover>
        )}
        label={look.label}
        count={v.view === 'inbox' ? counts?.views.inbox : undefined}
        onPointerDown={onPointerDown(key, 'pinned')}
        onDoubleClick={() => setRenaming(key)}
        renaming={
          renaming === key
            ? {
                value: look.label,
                onDone: (name) => {
                  setRenaming(null);
                  if (name) layout.setViewStyle(key, { ...style, label: name === v.label ? undefined : name });
                },
              }
            : undefined
        }
        menu={
          <>
            <ContextMenuLabel>{look.label}</ContextMenuLabel>
            <ContextMenuItem onSelect={() => setRenaming(key)}>
              <Pencil /> {t('Renommer')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => setTimeout(() => setStyling(key), 0)}>
              <Palette /> {t('Changer l’icône…')}
            </ContextMenuItem>
            {style ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => layout.setViewStyle(key, null)}>
                  <RefreshIcon /> {t('Nom et icône d’origine')}
                </ContextMenuItem>
              </>
            ) : null}
          </>
        }
      />
    );
  };

  /** A list of draggable rows with the drop indicator at the hovered position. */
  const list = (id: 'pinned' | 'categories', keys: string[], render: (key: string) => ReactNode) => {
    const target = drag?.target?.list === id ? drag.target.index : null;
    let position = 0;
    const line = <span className="bg-primary pointer-events-none absolute right-1 left-1 z-20 h-0.5 rounded-full" aria-hidden />;
    return (
      <div data-drop-list={id} className={cn('relative -mx-1 space-y-px rounded-lg px-1 py-px transition-colors', drag && target !== null && drag.list !== id && 'bg-primary/5 ring-primary/30 ring-1')}>
        {keys.map((key) => {
          const dragged = drag?.key === key;
          const here = !dragged && target === position;
          if (!dragged) position++;
          return (
            <div key={key} data-drag-key={key} className={cn('relative', dragged && 'opacity-30')}>
              {here ? <div className="-top-px absolute inset-x-0">{line}</div> : null}
              {render(key)}
            </div>
          );
        })}
        {target !== null && target === position ? <div className="relative h-0">{line}</div> : null}
        {id === 'categories' && keys.length === 0 ? (
          // Only shown while a category is dragged: a ghost place to put it back.
          <div className={cn('text-muted-foreground flex h-8 items-center justify-center rounded-lg border border-dashed text-[12px] transition-colors', target !== null ? 'border-primary/60 text-primary bg-primary/5' : 'border-border')}>
            {t('Déposez ici pour ranger')}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <>
      {ghost}
      <div aria-label={t('Épinglés')}>
        {list('pinned', pinnedItems, (key) => (isFixed(key) ? fixedRow(key) : categoryRow(tags.find((t) => tagKey(t) === key)!, true)))}
      </div>

      {/* Businesses no longer have their own section: the « Business » and « Personnel » groups
          under « Comptes » say which mailbox is which, without saying it twice. */}

      {/* No category left out of the pinned list: the section goes away, and comes back as a
          ghost while a category is dragged, so it can be put back. */}
      {categoryKeys.length > 0 || (drag && !isFixed(drag.key)) ? (
      <Section
        title={t('Catégories')}
        action={
          <Link to="/settings/tags" className="text-muted-foreground hover:text-foreground opacity-0 transition group-hover/section:opacity-100" aria-label={t('Réglages des catégories')}>
            <Settings className="size-3" />
          </Link>
        }
      >
        {list('categories', categoryKeys, (key) => (
          <Fragment>{categoryRow(categories.find((t) => tagKey(t) === key)!, false)}</Fragment>
        ))}
      </Section>
      ) : null}

      <CategoryDialog tag={editing} open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} />

      <AccountsSection counts={counts} currentView={currentView} account={account} mailbox={mailbox} filtered={Boolean(business || tag)} />
    </>
  );
}

/** Folded accounts and folders, remembered with the UI preferences. */
function useTreeState() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: ui } = useQuery(trpc.settings.get.queryOptions());
  const key = trpc.settings.get.queryKey();
  const save = useMutation(
    trpc.settings.save.mutationOptions({
      onMutate: (patch) => queryClient.setQueryData(key, (prev: Record<string, unknown> | undefined) => ({ ...prev, ...patch })),
    }),
  );
  const state = (ui?.sidebarTree ?? {}) as Record<string, boolean>;
  // The order of each account's folders, kept in ZMail only: the server's folders are untouched.
  const order = (ui?.folderOrder ?? {}) as Record<string, string[]>;
  return {
    isOpen: (id: string, fallback: boolean) => state[id] ?? fallback,
    set: (id: string, open: boolean) => save.mutate({ sidebarTree: { ...state, [id]: open } }),
    order: (accountId: string) => order[accountId] ?? [],
    setOrder: (accountId: string, keys: string[]) => save.mutate({ folderOrder: { ...order, [accountId]: keys } }),
    // The accounts' own order in the sidebar, by drag (kept in ZMail).
    accountOrder: Array.isArray(ui?.accountOrder) ? (ui.accountOrder as string[]) : [],
    setAccountOrder: (ids: string[]) => save.mutate({ accountOrder: ids }),
  };
}

function AccountsSection({
  counts,
  currentView,
  account,
  mailbox,
  filtered,
}: {
  counts?: Counts;
  currentView: View | null;
  account: string | null;
  mailbox: string | null;
  filtered: boolean;
}) {
  const trpc = useTRPC();
  const catalog = useCatalog();
  const tree = useTreeState();
  // A mail dragged from the list: its account unfolds, so its folders are there to drop on.
  const treeRef = useRef(tree);
  const accountClick = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastAccountClick = useRef<{ id: string; at: number } | null>(null);
  treeRef.current = tree;
  useEffect(() => {
    const open = (e: Event) => {
      const id = (e as CustomEvent<{ accountId: string }>).detail.accountId;
      if (!treeRef.current.isOpen(`account:${id}`, false)) treeRef.current.set(`account:${id}`, true);
    };
    window.addEventListener('zmail:mail-drag-start', open);
    return () => window.removeEventListener('zmail:mail-drag-start', open);
  }, []);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: folders } = useQuery(trpc.accounts.folders.queryOptions());
  const syncFolder = useMutation(trpc.accounts.syncFolder.mutationOptions());
  // Folder management (menu on right-click or double-click), done on the server.
  const refreshFolders = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.accounts.folders.queryKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.mail.counts.queryKey() });
  };
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<{ accountId: string; parentId: string | null; parentLabel: string | null } | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<{ id: string; label: string } | null>(null);
  const folderMutation = { onSettled: refreshFolders, onError: (e: { message: string }) => toast.error(e.message) };
  const renameFolder = useMutation(trpc.accounts.renameFolder.mutationOptions(folderMutation));
  const createFolder = useMutation(trpc.accounts.createFolder.mutationOptions(folderMutation));
  const deleteFolder = useMutation(trpc.accounts.deleteFolder.mutationOptions(folderMutation));
  const markFolderRead = useMutation(trpc.accounts.markFolderRead.mutationOptions(folderMutation));
  const refreshAccounts = () => void queryClient.invalidateQueries({ queryKey: trpc.accounts.list.queryKey() });
  const update = useMutation(trpc.accounts.update.mutationOptions({ onSuccess: refreshAccounts, onError: (e) => toast.error(e.message) }));
  const [iconFor, setIconFor] = useState<string | null>(null);
  const moveAccount = useMutation(
    trpc.spaces.moveAccount.mutationOptions({
      onSuccess: (_r, { spaceId }) => {
        void queryClient.invalidateQueries({ queryKey: trpc.spaces.list.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.mail.pathKey() });
        refreshAccounts();
        const space = spaces.find((x) => x.id === spaceId);
        toast.success(t('Compte déplacé vers {space}', { space: space ? (space.id === MAIN_SPACE ? t(space.name) : space.name) : '' }));
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const setKind = useMutation(trpc.accounts.setKind.mutationOptions({ onSuccess: () => (refreshAccounts(), void queryClient.invalidateQueries({ queryKey: trpc.catalog.pathKey() })), onError: (e) => toast.error(e.message) }));
  const resync = useMutation(trpc.accounts.resync.mutationOptions({ onSuccess: () => toast.success(t('Synchronisation relancée')) }));
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const settingsOf = (id: string, edit?: 'connection') => navigate(`/settings/accounts?account=${id}${edit ? `&edit=${edit}` : ''}`);

  // « + » next to the title and the title's menu add a mailbox. Not a double-click on the title:
  // that one folds and unfolds the section, and two quick clicks would open the wizard.
  const sectionProps = {
    title: t('Comptes'),
    menu: (
      <ContextMenuItem onSelect={() => setTimeout(() => setAdding(true), 0)}>
        <Plus /> {t('Ajouter un compte')}
      </ContextMenuItem>
    ),
    action: (
      <button type="button" onClick={() => setAdding(true)} className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent -mr-1.5 flex size-5 items-center justify-center rounded-md transition" aria-label={t('Ajouter un compte')} title={t('Ajouter un compte')}>
        <Plus className="size-3.5" />
      </button>
    ),
  };
  const addDialog = (
    <Dialog open={adding} onOpenChange={setAdding}>
      <DialogContent showOverlay className="max-h-[92vh] max-w-[640px] overflow-y-auto">
        <DialogTitle className="sr-only">{t('Connecter une boîte mail')}</DialogTitle>
        <DialogDescription className="sr-only">{t('Assistant pas à pas')}</DialogDescription>
        {adding ? <AccountWizard variant="dialog" onDone={() => setAdding(false)} onCancel={() => setAdding(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
  // Accounts reorder by drag (list `accounts`, rows `acct:<id>`), each with its folders.
  // Folders reorder by drag, among their siblings only: the nesting comes from the server.
  // Drop lists are `folders:<account>:<parent key>`; rows are `<account>:<row key>`.
  const groupOf = useRef(new Map<string, string>());
  const reorder = useRef<(key: string, to: DropTarget) => void>(() => undefined);
  // Each folder row's parent (`<account>:<row key>` → parent row key, '' at the top) and label.
  const parentOf = useRef(new Map<string, string>());
  const labelOf = useRef(new Map<string, string>());
  // Each folder level's rows in their shown order (`<account>:<parent row key>`).
  const levelRows = useRef(new Map<string, string[]>());
  /** Can this folder go under `parent`? Not a system folder, not into itself or its own subfolders. */
  const canNest = (dragKey: string, parent: string) => {
    const [accountId, ...rest] = dragKey.split(':');
    const key = rest.join(':');
    if (key.startsWith('special:') || parent.startsWith('special:') || !parentOf.current.has(dragKey)) return false;
    for (let p = parent; p; p = parentOf.current.get(`${accountId}:${p}`) ?? '') if (p === key) return false;
    return true;
  };
  const { drag, onPointerDown, ghost } = useSidebarDrag({
    // An account moves within and between its groups (Business, Personnel, neither). A folder
    // reorders among its siblings, or moves to another level of its account (on the server too).
    canDrop: (key, list) => {
      if (key.startsWith('acct:')) return list.startsWith('accounts:');
      if (groupOf.current.get(key) === list) return true;
      const prefix = `folders:${key.split(':')[0]}:`;
      return list.startsWith(prefix) && canNest(key, list.slice(prefix.length));
    },
    canDropInto: (key, into) => !key.startsWith('acct:') && into.split(':')[0] === key.split(':')[0] && canNest(key, into.split(':').slice(1).join(':')),
    onDrop: (key, _from, to) => reorder.current(key, to),
  });
  groupOf.current = new Map();
  parentOf.current = new Map();
  labelOf.current = new Map();
  levelRows.current = new Map();
  const moveFolder = useMutation(
    trpc.accounts.moveFolder.mutationOptions({
      onSettled: () => void queryClient.invalidateQueries({ queryKey: trpc.accounts.folders.queryKey() }),
      onError: (e) => toast.error(e.message),
    }),
  );
  const byAccount = useMemo(() => {
    const map = new Map<string, Folder[]>();
    for (const f of (folders ?? []) as Folder[]) map.set(f.accountId, [...(map.get(f.accountId) ?? []), f]);
    return map;
  }, [folders]);

  const reorderFor = new Map<string, (key: string, index: number) => void>();
  const rank = (id: string) => {
    const i = tree.accountOrder.indexOf(id);
    return i === -1 ? tree.accountOrder.length + catalog.accounts.findIndex((a) => a.id === id) : i;
  };
  // The mailboxes of the current space: linked to it, or through their business; « main »
  // shows those linked to no space.
  const { spaces } = useSpaces();
  const spaceId = useScopedSpaceId();
  const spaceOfAccount = (a: (typeof catalog.accounts)[number]) =>
    spaces.find((sp) => sp.accountIds.includes(a.id))?.id ?? (a.businessId ? spaces.find((sp) => sp.businessIds.includes(a.businessId!))?.id : undefined) ?? MAIN_SPACE;
  const accounts = [...catalog.accounts].filter((a) => spaces.length < 2 || spaceOfAccount(a) === spaceId).sort((a, b) => rank(a.id) - rank(b.id));
  // Business and personal mailboxes, and those in neither (dragged out of both).
  const GROUPS = [
    { list: 'accounts:none', kind: null, title: null },
    { list: 'accounts:business', kind: 'business', title: t('Business') },
    { list: 'accounts:personal', kind: 'personal', title: t('Personnel') },
  ] as const;
  const inGroup = (kind: string | null) => accounts.filter((a) => (a.kind ?? null) === kind);
  reorder.current = (dragKey, to) => {
    if (dragKey.startsWith('acct:')) {
      const id = dragKey.slice(5);
      const group = GROUPS.find((g) => g.list === to.list) ?? GROUPS[0];
      const moved = accounts.find((a) => a.id === id);
      if (moved && (moved.kind ?? null) !== group.kind) setKind.mutate({ id, kind: group.kind });
      // One saved order for all accounts, group after group.
      const ids = GROUPS.flatMap((g) => {
        const members = inGroup(g.kind).map((a) => a.id).filter((x) => x !== id);
        if (g.list === group.list) members.splice(to.index, 0, id);
        return members;
      });
      tree.setAccountOrder(ids);
      return;
    }
    const [accountId, ...rest] = dragKey.split(':');
    const key = rest.join(':');
    const from = parentOf.current.get(dragKey) ?? '';
    const parent = to.into ? to.into.split(':').slice(1).join(':') : to.list.split(':').slice(2).join(':');
    if (parent !== from) {
      // Another level: the folder moves on the server (an IMAP rename), then takes its place.
      const name = labelOf.current.get(dragKey) ?? '';
      if (parent) tree.set(`folder:${parent}`, true);
      // Its place among its new siblings (ids stay the same after the move, so the order holds).
      const siblings = (levelRows.current.get(`${accountId}:${parent}`) ?? []).filter((k) => k !== key);
      siblings.splice(to.into ? siblings.length : to.index, 0, key);
      const saved = tree.order(accountId!).filter((k) => !siblings.includes(k));
      moveFolder.mutate(
        { mailboxId: key, parentId: parent || null },
        {
          onSuccess: () => {
            tree.setOrder(accountId!, [...siblings, ...saved]);
            toast.success(parent ? t('« {name} » déplacé dans « {parent} »', { name, parent: labelOf.current.get(`${accountId}:${parent}`) ?? '' }) : t('« {name} » déplacé au premier niveau', { name }));
          },
        },
      );
      return;
    }
    reorderFor.get(accountId!)?.(key, to.index);
  };

  if (catalog.accounts.length === 0) {
    return (
      <Section {...sectionProps}>
        {addDialog}
        <NavItem to="/settings/accounts" active={false} icon={<Mailbox />} label={t('Connecter une boîte')} onClick={() => setAdding(true)} />
      </Section>
    );
  }

  return (
    <Section {...sectionProps}>
      {addDialog}
      {ghost}
      <NewFolderDialog
        open={Boolean(newFolder)}
        parentLabel={newFolder?.parentLabel ?? null}
        pending={createFolder.isPending}
        onCancel={() => setNewFolder(null)}
        onCreate={(name) => {
          const target = newFolder!;
          createFolder.mutate(
            { accountId: target.accountId, parentId: target.parentId, name },
            {
              onSuccess: () => {
                setNewFolder(null);
                if (target.parentId) tree.set(`folder:${target.parentId}`, true);
                toast.success(t('Dossier « {name} » créé', { name }));
              },
            },
          );
        }}
      />
      <DeleteFolderDialog
        folder={deletingFolder}
        pending={deleteFolder.isPending}
        onCancel={() => setDeletingFolder(null)}
        onDelete={(toTrash) => {
          const target = deletingFolder!;
          deleteFolder.mutate(
            { mailboxId: target.id, toTrash },
            {
              onSuccess: (result) => {
                setDeletingFolder(null);
                if (mailbox === target.id) navigate('/mail/inbox');
                toast.success(t('Dossier « {name} » supprimé', { name: target.label }), { description: result.moved ? tp(result.moved, '{n} mail mis dans la corbeille', '{n} mails mis dans la corbeille') : undefined });
              },
            },
          );
        }}
      />
      {(() => {
        const accountRow = (a: (typeof accounts)[number], listId: string, dropHere: boolean, accountDragged: boolean) => {
        const accountDrag = `acct:${a.id}`;
        const boxes = byAccount.get(a.id) ?? [];
        const accountKey = `account:${a.id}`;
        const expanded = tree.isOpen(accountKey, catalog.accounts.length <= 2 || account === a.id);
        const specials = SPECIAL_FOLDERS.filter((s) => boxes.some((b) => b.specialUse === s.special || (s.special === 'archive' && b.specialUse === 'all')));
        // The user's folders as a tree: Gmail's "[Gmail]/" prefix dropped, nesting from the delimiter.
        const custom = boxes
          .filter((b) => !b.specialUse)
          .map((b) => {
            const path = b.path.replace(/^\[(Gmail|Google Mail)\][/.]/, '');
            const parts = b.delimiter ? path.split(b.delimiter) : [path];
            return { ...b, parts, key: parts.join('\u0000').toLowerCase(), depth: parts.length - 1, label: parts.at(-1) || b.name };
          })
          .sort((x, y) => x.key.localeCompare(y.key));
        const byKey = new Map(custom.map((f) => [f.key, f]));
        const hasChildren = new Set(custom.filter((f) => f.depth > 0).map((f) => f.parts.slice(0, -1).join('\u0000').toLowerCase()));
        // Rows of the account: its special folders and its own folders, each under its parent.
        type Row = { key: string; parent: string; node: (dragHandle: ReturnType<typeof onPointerDown>) => ReactNode };
        const rows: Row[] = [
          ...specials.map((s) => ({
            key: `special:${s.special}`,
            parent: '',
            node: (handle: ReturnType<typeof onPointerDown>) => (
              <NavItem tree={{ depth: 1 }} to={`/mail/${s.view}?account=${a.id}`} active={currentView === s.view && account === a.id && !filtered} icon={<s.icon />} label={s.label} count={s.special === 'inbox' ? counts?.accounts[a.id] : undefined} onPointerDown={handle} drop={s.special === 'sent' || s.special === 'drafts' ? { accountId: a.id } : { accountId: a.id, special: s.special }} />
            ),
          })),
          ...custom.map((f) => {
            const parentKey = f.parts.slice(0, -1).join('\u0000').toLowerCase();
            const folderKey = `folder:${f.id}`;
            const open = tree.isOpen(folderKey, true);
            return {
              key: f.id,
              // A folder whose parent is not a real folder stays with the top level.
              parent: byKey.has(parentKey) ? byKey.get(parentKey)!.id : '',
              node: (handle: ReturnType<typeof onPointerDown>) => (
                <NavItem
                  tree={{ depth: 1 + f.depth, ...(hasChildren.has(f.key) ? { open, onToggle: () => tree.set(folderKey, !open), label: f.label } : {}) }}
                  drop={{ accountId: a.id, mailboxId: f.id }}
                  to={`/mail/folder?account=${a.id}&mailbox=${f.id}`}
                  onClick={() => syncFolder.mutate({ accountId: a.id, mailboxId: f.id })}
                  active={mailbox === f.id}
                  icon={<Folder />}
                  label={f.label}
                  count={counts?.mailboxes?.[f.id]}
                  onPointerDown={handle}
                  menuOnDoubleClick
                  renaming={
                    renamingFolder === f.id
                      ? {
                          value: f.label,
                          onDone: (name) => {
                            setRenamingFolder(null);
                            if (name) renameFolder.mutate({ mailboxId: f.id, name }, { onSuccess: () => toast.success(t('Dossier renommé en « {name} »', { name })) });
                          },
                        }
                      : undefined
                  }
                  menu={
                    <>
                      <ContextMenuLabel>{f.path}</ContextMenuLabel>
                      <ContextMenuItem onSelect={() => setRenamingFolder(f.id)}>
                        <Pencil /> {t('Renommer')}
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => setTimeout(() => setNewFolder({ accountId: a.id, parentId: f.id, parentLabel: f.label }), 0)}>
                        <FolderPlus /> {t('Nouveau sous-dossier…')}
                      </ContextMenuItem>
                      {f.depth > 0 ? (
                        <ContextMenuItem onSelect={() => moveFolder.mutate({ mailboxId: f.id, parentId: null }, { onSuccess: () => toast.success(t('« {name} » déplacé au premier niveau', { name: f.label })) })}>
                          <ArrowUpToLine /> {t('Sortir au premier niveau')}
                        </ContextMenuItem>
                      ) : null}
                      <ContextMenuSeparator />
                      <ContextMenuItem disabled={!counts?.mailboxes?.[f.id]} onSelect={() => markFolderRead.mutate({ mailboxId: f.id })}>
                        <CheckCheck /> {t('Tout marquer comme lu')}
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => syncFolder.mutate({ accountId: a.id, mailboxId: f.id })}>
                        <RefreshIcon /> {t('Synchroniser')}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem destructive onSelect={() => setTimeout(() => setDeletingFolder({ id: f.id, label: f.label }), 0)}>
                        <TrashIcon /> {t('Supprimer le dossier…')}
                      </ContextMenuItem>
                    </>
                  }
                />
              ),
            };
          }),
        ];
        const saved = tree.order(a.id);
        const rank = (key: string) => {
          const i = saved.indexOf(key);
          return i === -1 ? saved.length + rows.findIndex((r) => r.key === key) : i;
        };
        const childrenOf = (parent: string) => rows.filter((r) => r.parent === parent).sort((x, y) => rank(x.key) - rank(y.key));
        for (const parent of new Set(['', ...rows.map((r) => r.parent)])) levelRows.current.set(`${a.id}:${parent}`, childrenOf(parent).map((r) => r.key));
        for (const r of rows) groupOf.current.set(`${a.id}:${r.key}`, `folders:${a.id}:${r.parent}`);
        for (const f of custom) {
          parentOf.current.set(`${a.id}:${f.id}`, rows.find((r) => r.key === f.id)!.parent);
          labelOf.current.set(`${a.id}:${f.id}`, f.label);
        }
        reorderFor.set(a.id, (key, index) => {
          const parent = rows.find((r) => r.key === key)!.parent;
          const siblings = childrenOf(parent).map((r) => r.key).filter((k) => k !== key);
          siblings.splice(index, 0, key);
          // Saved as one list for the account: every sibling group keeps its own relative order.
          const others = rows.filter((r) => r.parent !== parent).sort((x, y) => rank(x.key) - rank(y.key)).map((r) => r.key);
          tree.setOrder(a.id, [...siblings, ...others]);
        });

        const renderGroup = (parent: string): ReactNode => {
          const listId = `folders:${a.id}:${parent}`;
          const items = childrenOf(parent);
          const target = drag?.target?.list === listId ? drag.target.index : null;
          let position = 0;
          return (
            <div data-drop-list={listId} className="relative space-y-px">
              {items.map((r) => {
                const dragKey = `${a.id}:${r.key}`;
                const dragged = drag?.key === dragKey;
                const here = !dragged && target === position;
                if (!dragged) position++;
                // A folded folder hides its subfolders; so does a folder being dragged.
                const showChildren = !r.key.startsWith('special:') && tree.isOpen(`folder:${r.key}`, true) && rows.some((c) => c.parent === r.key);
                return (
                  <Fragment key={r.key}>
                    <div
                      data-drag-key={dragKey}
                      data-drop-into={r.key.startsWith('special:') ? undefined : dragKey}
                      className={cn('relative rounded-lg', dragged && 'opacity-30', drag?.target?.into === dragKey && 'bg-primary/10 ring-primary/40 ring-1')}
                    >
                      {here ? <DropLine className="-top-px" /> : null}
                      {r.node(onPointerDown(dragKey, listId))}
                    </div>
                    {showChildren && !dragged ? renderGroup(r.key) : null}
                  </Fragment>
                );
              })}
              {target !== null && target === position ? <DropLine className="-bottom-px" /> : null}
            </div>
          );
        };

        return (
          <div key={a.id} data-drag-key={accountDrag} className={cn('relative', accountDragged && 'opacity-30')}>
            {dropHere ? <DropLine className="-top-px" /> : null}
            <NavItem
              onPointerDown={onPointerDown(accountDrag, listId)}
              tree={{ depth: 0, open: expanded, onToggle: () => tree.set(accountKey, !expanded), label: a.label || a.email }}
              drop={{ accountId: a.id }}
              to={`/mail/inbox?account=${a.id}`}
              // A click opens the account and unfolds it (its « Boîte de réception » lights up); on an
              // account already unfolded, it folds it. It waits a beat so a double-click (rename)
              // does not fold and unfold it on the way.
              onClick={(e) => {
                // ZMail's own double-click, tighter than macOS's (often ~0.5 s): two clicks less than
                // 250 ms apart on the same account rename it; anything slower folds or unfolds.
                clearTimeout(accountClick.current);
                const last = lastAccountClick.current;
                const now = e.timeStamp;
                lastAccountClick.current = { id: a.id, at: now };
                if (last && last.id === a.id && now - last.at < DOUBLE_CLICK_MS) {
                  lastAccountClick.current = null;
                  setRenaming(a.id);
                  return;
                }
                accountClick.current = setTimeout(() => tree.set(accountKey, !expanded), DOUBLE_CLICK_MS);
              }}
              // Unfolded, its « Boîte de réception » row carries the highlight instead.
              active={!expanded && currentView === 'inbox' && account === a.id && !mailbox && !filtered}
              icon={
                <span className="relative flex size-4 items-center justify-center">
                  <AccountIcon account={a} />
                  {a.status === 'error' ? <AlertCircle className="text-destructive absolute -right-1 -bottom-1 size-2.5" /> : null}
                </span>
              }
              // The icon opens its picker (an icon, a brand's logo, the company's own logo).
              iconWrap={(icon) => (
                <AccountIconPopover account={a} open={iconFor === a.id} onOpenChange={(o) => setIconFor(o ? a.id : null)}>
                  <button
                    type="button"
                    data-no-drag
                    className="hover:bg-sidebar-accent flex size-6 items-center justify-center rounded-md transition-colors"
                    aria-label={t('Changer l’icône du compte')}
                    title={t('Changer l’icône du compte')}
                  >
                    {icon}
                  </button>
                </AccountIconPopover>
              )}
              label={a.label || a.email}
              count={counts?.accounts[a.id]}
              // Double-click renames, like every row of the sidebar; settings are in the right-click menu.
              renaming={
                renaming === a.id
                  ? {
                      value: a.label || a.email,
                      onDone: (name) => {
                        setRenaming(null);
                        // Typing the address back (or nothing) returns to showing the address.
                        if (name !== null) update.mutate({ id: a.id, patch: { label: name === a.email ? null : name } });
                      },
                    }
                  : undefined
              }
              menu={
                <>
                  <ContextMenuLabel>{a.email}</ContextMenuLabel>
                  <ContextMenuItem onSelect={() => setRenaming(a.id)}>
                    <Pencil /> {t('Renommer')}
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => setTimeout(() => setIconFor(a.id), 0)}>
                    <ImageIcon /> {t('Changer l’icône…')}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  {spaces.length > 1 ? (
                    // « Déplacer vers » → the spaces, drawn as in the switcher (icon, colour, name).
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>
                        <MoveIcon /> {t('Déplacer vers')}
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent className="min-w-48">
                        {spaces.map((space) => {
                          const here = (spaces.find((x) => x.accountIds.includes(a.id))?.id ?? MAIN_SPACE) === space.id;
                          return (
                            <ContextMenuItem key={space.id} disabled={here} onSelect={() => moveAccount.mutate({ accountId: a.id, spaceId: space.id })}>
                              <SpaceIcon space={space} size={16} />
                              <span className="min-w-0 flex-1 truncate">{space.id === MAIN_SPACE ? t(space.name) : space.name}</span>
                              {here ? <Check className="text-muted-foreground ml-2 !size-3.5" /> : null}
                            </ContextMenuItem>
                          );
                        })}
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                  ) : null}
                  <ContextMenuItem onSelect={() => settingsOf(a.id)}>
                    <Settings /> {t('Réglages du compte')}
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => settingsOf(a.id, 'connection')}>
                    <PlugIcon /> {t('Modifier la connexion…')}
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => resync.mutate({ id: a.id })}>
                    <RefreshIcon /> {t('Resynchroniser')}
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => setTimeout(() => setNewFolder({ accountId: a.id, parentId: null, parentLabel: null }), 0)}>
                    <FolderPlus /> {t('Nouveau dossier…')}
                  </ContextMenuItem>
                  {a.label ? (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuItem onSelect={() => update.mutate({ id: a.id, patch: { label: null } })}>{t('Afficher l’adresse')}</ContextMenuItem>
                    </>
                  ) : null}
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => setTimeout(() => setAdding(true), 0)}>
                    <Plus /> {t('Ajouter un compte')}
                  </ContextMenuItem>
                </>
              }
            />
            {expanded && !accountDragged ? renderGroup('') : null}
          </div>
        );
        };

        // One drop list per group; an empty group shows only while an account is dragged.
        const dragging = drag?.key.startsWith('acct:') ?? false;
        // A space fed only by businesses (or by moved mail) has no mailbox of its own.
        if (!accounts.length && !dragging) return <p className="text-muted-foreground/70 px-2 py-1 text-[11.5px]">{t('Aucun compte dans cet espace : ses mails viennent de ses business et de vos déplacements.')}</p>;
        return GROUPS.map((g) => {
          const items = inGroup(g.kind);
          if (!items.length && !dragging) return null;
          const target = drag?.target?.list === g.list ? drag.target.index : null;
          let position = 0;
          return (
            <div key={g.list} data-drop-list={g.list} className={cn('relative space-y-px', g.title && 'pt-1.5', !items.length && 'rounded-md border border-dashed border-sidebar-border pb-1')}>
              {g.title ? <p className="text-muted-foreground/80 px-2 pb-0.5 text-[10.5px] font-semibold tracking-wide uppercase">{g.title}</p> : !items.length ? <p className="text-muted-foreground/70 px-2 py-1 text-[11px]">{t('Ni business ni personnel')}</p> : null}
              {items.map((a) => {
                const accountDragged = drag?.key === `acct:${a.id}`;
                const dropHere = !accountDragged && target === position;
                if (!accountDragged) position++;
                return accountRow(a, g.list, dropHere, accountDragged);
              })}
              {target !== null && target === position ? <DropLine className="-bottom-px" /> : null}
            </div>
          );
        });
      })()}
    </Section>
  );
}

function DropLine({ className }: { className?: string }) {
  return <span className={cn('bg-primary pointer-events-none absolute right-1 left-1 z-20 h-0.5 rounded-full', className)} aria-hidden />;
}

export type FlowStep = { key: string; label: string; to: string; icon: ReactNode; unread: number };

/**
 * The sidebar's reading order, top to bottom: pinned views and categories, then the other
 * categories. At the end of a list, the next step with unread mail is offered, so going
 * through the inbox flows category by category in the order the user chose.
 */
export function useCategoryFlow(counts?: Counts): FlowStep[] {
  const catalog = useCatalog();
  const { spaceId } = useSpaces();
  const layout = useSidebarLayout(spaceId);
  const tagKey = (t: Tag) => `tag:${t.id}`;
  const step = (key: string): FlowStep | null => {
    if (isFixed(key)) {
      const v = FIXED_VIEWS[key];
      // Subscriptions is a management page, not a list of mails to go through.
      if (!v.view) return null;
      return { key, label: v.label, to: v.to, icon: <v.icon />, unread: counts?.views[v.view as View] ?? 0 };
    }
    const tag = catalog.tags.find((t) => tagKey(t) === key);
    return tag ? { key, label: t(tag.name), to: `/mail/inbox?tag=${tag.id}`, icon: <TagIcon icon={tag.icon} color={tag.color} />, unread: counts?.tags[tag.id] ?? 0 } : null;
  };
  const rank = (t: Tag) => {
    const i = layout.order.indexOf(tagKey(t));
    return i === -1 ? layout.order.length + catalog.tags.indexOf(t) : i;
  };
  const rest = catalog.tags
    .filter((t) => !layout.pinned.includes(tagKey(t)))
    .sort((a, b) => rank(a) - rank(b))
    .map(tagKey);
  return [...layout.pinned, ...rest].map(step).filter((s): s is FlowStep => s !== null);
}
