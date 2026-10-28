import { AlertCircle } from 'lucide-react';
import { solar, type IconComponent } from '@/components/ui/solar-icon';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { BrandLogo, brandForProvider } from '@/components/brand-logo';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Plus, RotateCcw as RefreshIcon } from 'lucide-react';
import { TagStyleGrid, TagStylePopover } from '@/components/tag-style-picker';
import { CategoryDialog } from '@/components/category-dialog';
import { AccountWizard } from '@/components/onboarding/account-wizard';
import { ContextMenuItem, ContextMenuLabel, ContextMenuSeparator } from '@/components/ui/context-menu';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { NavItem, RowAction, Section } from './nav';
import { useSidebarDrag, type DropTarget } from './use-sidebar-drag';
import { useCatalog } from '@/hooks/use-catalog';
import { useTRPC, type Tag, type View } from '@/lib/trpc';
import { TagIcon } from '@/lib/tag-icons';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

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
const Briefcase = solar('_business');
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
  'view:starred': { label: t('Suivis'), icon: Star, to: '/mail/starred', view: 'starred' },
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

/** Pinned order and the order of the other categories, saved with the UI preferences. */
function useSidebarLayout() {
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
  const stored = Array.isArray(ui?.sidebarPinned) ? (ui.sidebarPinned as string[]) : DEFAULT_PINNED;
  // The fixed views can never get lost, even from an older saved order.
  const pinned = [...stored.filter((k, i) => stored.indexOf(k) === i), ...Object.keys(FIXED_VIEWS).filter((k) => !stored.includes(k))];
  const order = Array.isArray(ui?.categoryOrder) ? (ui.categoryOrder as string[]) : [];
  // Your own name and icon for the fixed views (inbox, followed, subscriptions).
  const viewStyle = (ui?.viewStyle ?? {}) as Record<string, ViewStyle>;
  return {
    pinned,
    order,
    viewStyle,
    save: (patch: { sidebarPinned?: string[]; categoryOrder?: string[] }) => save.mutate(patch),
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

/** Icon picker for a fixed view: any category icon, or back to the original one. */
function ViewIconPopover({ value, onChange, children, open, onOpenChange }: { value?: ViewStyle; onChange: (s: ViewStyle | null) => void; children: ReactNode; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" side="right" className="w-[330px] p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">{t('Icône')}</p>
          {value?.icon ? (
            <button type="button" className="text-muted-foreground hover:text-foreground text-[11.5px]" onClick={() => onChange({ ...value, icon: null })}>
              {t('Icône d’origine')}
            </button>
          ) : null}
        </div>
        <TagStyleGrid value={{ icon: value?.icon ?? null, color: value?.color ?? '#71717a' }} onChange={({ icon, color }) => onChange({ ...value, icon, color })} />
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

export function MailNav({ counts }: { counts?: Counts }) {
  const catalog = useCatalog();
  const { pathname } = useLocation();
  const [search] = useSearchParams();
  const layout = useSidebarLayout();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const refreshTags = () => void queryClient.invalidateQueries({ queryKey: trpc.catalog.tags.queryKey() });
  const saveTag = useMutation(trpc.catalog.saveTag.mutationOptions({ onSuccess: refreshTags, onError: (e) => toast.error(e.message) }));
  const removeTag = useMutation(trpc.catalog.removeTag.mutationOptions({ onSuccess: refreshTags, onError: (e) => toast.error(e.message) }));
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

  const tags = catalog.tags;
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
        onDoubleClick={() => setRenaming(key)}
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
          <ViewIconPopover value={style} onChange={(next) => layout.setViewStyle(key, next && (next.label || next.icon) ? next : null)} open={styling === key} onOpenChange={(o) => setStyling(o ? key : null)}>
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

      {catalog.businesses.length > 0 ? (
        <Section
          title={t('Business')}
          action={
            <Link to="/settings/businesses" className="text-muted-foreground hover:text-foreground opacity-0 transition group-hover/section:opacity-100" aria-label={t('Réglages des business')}>
              <Settings className="size-3" />
            </Link>
          }
        >
          {catalog.businesses.map((b) => (
            <NavItem
              key={b.id}
              to={`/mail/inbox?business=${b.id}`}
              active={business === b.id}
              icon={
                b.emoji ? (
                  // The emoji is user data; no coloured backdrop, it sits bare like the other icons.
                  <span className="flex size-4 items-center justify-center text-[13px] leading-none">{b.emoji}</span>
                ) : (
                  <Briefcase />
                )
              }
              label={b.name}
              count={counts?.businesses[b.id]}
            />
          ))}
        </Section>
      ) : null}

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: folders } = useQuery(trpc.accounts.folders.queryOptions());
  const syncFolder = useMutation(trpc.accounts.syncFolder.mutationOptions());
  const refreshAccounts = () => void queryClient.invalidateQueries({ queryKey: trpc.accounts.list.queryKey() });
  const update = useMutation(trpc.accounts.update.mutationOptions({ onSuccess: refreshAccounts, onError: (e) => toast.error(e.message) }));
  const resync = useMutation(trpc.accounts.resync.mutationOptions({ onSuccess: () => toast.success(t('Synchronisation relancée')) }));
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const settingsOf = (id: string, edit?: 'connection') => navigate(`/settings/accounts?account=${id}${edit ? `&edit=${edit}` : ''}`);

  // « + » next to the title, the title's menu and a double-click on it: three ways to add a mailbox.
  const sectionProps = {
    title: t('Comptes'),
    onTitleDoubleClick: () => setAdding(true),
    menu: (
      <ContextMenuItem onSelect={() => setTimeout(() => setAdding(true), 0)}>
        <Plus /> {t('Ajouter un compte')}
      </ContextMenuItem>
    ),
    action: (
      <button type="button" onClick={() => setAdding(true)} className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent flex size-5 items-center justify-center rounded-md transition" aria-label={t('Ajouter un compte')} title={t('Ajouter un compte')}>
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
  const { drag, onPointerDown, ghost } = useSidebarDrag({
    canDrop: (key, list) => groupOf.current.get(key) === list,
    onDrop: (key, _from, to) => reorder.current(key, to),
  });
  groupOf.current = new Map();
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
  const accounts = [...catalog.accounts].sort((a, b) => rank(a.id) - rank(b.id));
  for (const a of accounts) groupOf.current.set(`acct:${a.id}`, 'accounts');
  reorder.current = (dragKey, to) => {
    if (dragKey.startsWith('acct:')) {
      const id = dragKey.slice(5);
      const ids = accounts.map((a) => a.id).filter((x) => x !== id);
      ids.splice(to.index, 0, id);
      tree.setAccountOrder(ids);
      return;
    }
    const [accountId, ...rest] = dragKey.split(':');
    reorderFor.get(accountId!)?.(rest.join(':'), to.index);
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
      <div data-drop-list="accounts" className="relative space-y-px">
      {(() => {
        const target = drag?.target?.list === 'accounts' ? drag.target.index : null;
        let position = 0;
        return accounts.map((a) => {
        const accountDrag = `acct:${a.id}`;
        const accountDragged = drag?.key === accountDrag;
        const dropHere = !accountDragged && target === position;
        if (!accountDragged) position++;
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
              <NavItem tree={{ depth: 1 }} to={`/mail/${s.view}?account=${a.id}`} active={currentView === s.view && account === a.id && !filtered} icon={<s.icon />} label={s.label} count={s.special === 'inbox' ? counts?.accounts[a.id] : undefined} onPointerDown={handle} />
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
                  to={`/mail/folder?account=${a.id}&mailbox=${f.id}`}
                  onClick={() => syncFolder.mutate({ accountId: a.id, mailboxId: f.id })}
                  active={mailbox === f.id}
                  icon={<Folder />}
                  label={f.label}
                  count={counts?.mailboxes?.[f.id]}
                  onPointerDown={handle}
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
        for (const r of rows) groupOf.current.set(`${a.id}:${r.key}`, `folders:${a.id}:${r.parent}`);
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
                    <div data-drag-key={dragKey} className={cn('relative', dragged && 'opacity-30')}>
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
              onPointerDown={onPointerDown(accountDrag, 'accounts')}
              tree={{ depth: 0, open: expanded, onToggle: () => tree.set(accountKey, !expanded), label: a.label || a.email }}
              to={`/mail/inbox?account=${a.id}`}
              // Unfolded, its « Boîte de réception » row carries the highlight instead.
              active={!expanded && currentView === 'inbox' && account === a.id && !mailbox && !filtered}
              icon={
                <span className="relative flex size-4 items-center justify-center">
                  {brandForProvider(a.provider) ? (
                    // Bare mark (no tile): sits on the sidebar like the other row icons.
                    <BrandLogo brand={brandForProvider(a.provider)} size={15} />
                  ) : (
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: a.color }} />
                  )}
                  {a.status === 'error' ? <AlertCircle className="text-destructive absolute -right-1 -bottom-1 size-2.5" /> : null}
                </span>
              }
              label={a.label || a.email}
              count={counts?.accounts[a.id]}
              onDoubleClick={() => settingsOf(a.id)}
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
                  <ContextMenuItem onSelect={() => settingsOf(a.id)}>
                    <Settings /> {t('Réglages du compte')}
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => settingsOf(a.id, 'connection')}>
                    <PlugIcon /> {t('Modifier la connexion…')}
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => resync.mutate({ id: a.id })}>
                    <RefreshIcon /> {t('Resynchroniser')}
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
        }).concat(target !== null && target === position ? [<DropLine key="end" className="-bottom-px" />] : []);
      })()}
      </div>
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
  const layout = useSidebarLayout();
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
